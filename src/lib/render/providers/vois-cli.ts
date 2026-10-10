import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { ProbeResult, RenderProvider, TtsRequest, TtsResult } from '../types';

/**
 * Vois (vois.so) — local voice studio, driven by its own CLI.
 *
 * Verified shape (vois-cli 2.3.1):
 *   vois-cli status                                  exit 0 = ready, exit 2 = app not running
 *   vois-cli voice list --source all --format json
 *   vois-cli tts generate -t <text> -v <voiceId> -o <abs path> --format json [--engine ...]
 *
 * IMPORTANT: the CLI is an IPC client for the Vois desktop app. The app must be
 * running, on the same machine, as the same OS user — a containerised or cloud
 * agent cannot reach it. Hence probe() checks the app, not just the binary.
 *
 * Nothing here is assumed about the user's machine: if vois-cli is not installed,
 * or the app is closed, probe() says so and the Director falls through to the next
 * provider.
 */

const CLI_CANDIDATES = [
  process.env.VOIS_CLI, // explicit override wins
  path.join(process.env.LOCALAPPDATA || '', 'Vois', 'vois-cli.exe'),
  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'vois', 'vois-cli.exe'),
  'vois-cli', // on PATH
].filter(Boolean) as string[];

const CLI_TIMEOUT_MS = 20_000;

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** Run the CLI with an argument array (never a shell string — no injection). */
function runCli(cli: string, args: string[], timeoutMs = CLI_TIMEOUT_MS): Promise<RunResult> {
  return new Promise(resolve => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let child: ReturnType<typeof spawn>;

    const done = (code: number | null, timedOut = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    };

    try {
      child = spawn(cli, args, { windowsHide: true });
    } catch (e) {
      return done(null);
    }

    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      done(null, true);
    }, timeoutMs);

    child.stdout?.on('data', d => (stdout += d.toString()));
    child.stderr?.on('data', d => (stderr += d.toString()));
    child.on('error', () => done(null));
    child.on('close', code => done(code));
  });
}

/** First candidate that actually exists / resolves. Returns undefined if none. */
function findCli(): string | undefined {
  for (const c of CLI_CANDIDATES) {
    try {
      // A bare name ('vois-cli') is left to the OS PATH; anything with a separator
      // must exist on disk.
      if (!c.includes(path.sep) && !c.includes('/')) return c;
      if (fs.existsSync(c)) return c;
    } catch {
      /* keep looking */
    }
  }
  return undefined;
}

async function probe(): Promise<ProbeResult> {
  const cli = findCli();
  if (!cli) {
    return {
      available: false,
      reason: 'not-installed',
      detail: 'vois-cli was not found. Install Vois (the CLI ships inside the desktop app installer), or set VOIS_CLI to its path.',
    };
  }

  const version = await runCli(cli, ['--version'], 10_000);
  const v = (version.stdout || version.stderr).trim().split('\n')[0] || undefined;

  const status = await runCli(cli, ['status'], 10_000);
  if (status.code === 0) {
    return { available: true, reason: 'ok', detail: 'Vois desktop app is running.', version: v };
  }
  if (status.code === 2) {
    return {
      available: false,
      reason: 'app-not-running',
      detail: 'vois-cli is installed but the Vois desktop app is not running. Start Vois, then try again.',
      version: v,
    };
  }
  return {
    available: false,
    reason: 'cli-error',
    detail: (status.stderr || status.stdout || 'vois-cli status failed').trim().slice(0, 300),
    version: v,
  };
}

async function listVoices(): Promise<unknown> {
  const cli = findCli();
  if (!cli) throw new Error('vois-cli not found');
  const res = await runCli(cli, ['voice', 'list', '--source', 'all', '--format', 'json'], 30_000);
  // The CLI emits one JSON object per line (NDJSON): warnings, then the payload.
  const lines = (res.stdout + '\n' + res.stderr)
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);
  const objs: unknown[] = [];
  for (const line of lines) {
    try {
      objs.push(JSON.parse(line));
    } catch {
      /* not JSON — skip */
    }
  }
  return objs.length === 1 ? objs[0] : objs;
}

async function tts(req: TtsRequest): Promise<TtsResult> {
  const cli = findCli();
  if (!cli) throw new Error('vois-cli not found');

  // Write to a temp file rather than capturing audio from stdout: deterministic,
  // and it matches the vendor's guidance to pass absolute paths.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vois-tts-'));
  const outFile = path.join(dir, 'speech.wav');

  const args = ['tts', 'generate', '-t', req.text, '-o', outFile, '--format', 'json'];
  if (req.voice) args.push('-v', req.voice);
  if (req.language) args.push('-l', req.language);
  if (req.engine) args.push('--engine', req.engine);
  if (typeof req.speed === 'number') args.push('-s', String(req.speed));
  if (typeof req.seed === 'number') args.push('--seed', String(req.seed));

  try {
    const res = await runCli(cli, args, 180_000);
    if (res.code !== 0) {
      const why =
        res.code === 2
          ? 'Vois desktop app is not running.'
          : (res.stderr || res.stdout || 'vois-cli tts failed').trim().slice(0, 400);
      throw new Error(`Vois TTS failed (exit ${res.code ?? 'timeout'}): ${why}`);
    }
    if (!fs.existsSync(outFile)) {
      throw new Error(`Vois reported success but no file was written at ${outFile}`);
    }
    const audio = fs.readFileSync(outFile);

    // The CLI prints its result line on stderr/stdout as JSON; keep whatever parsed.
    let meta: Record<string, unknown> | undefined;
    for (const line of (res.stderr + '\n' + res.stdout).split('\n')) {
      const t = line.trim();
      if (!t.startsWith('{')) continue;
      try {
        meta = { ...(meta || {}), ...(JSON.parse(t) as Record<string, unknown>) };
      } catch {
        /* ignore non-JSON lines */
      }
    }

    return { provider: 'vois-cli', audio, mimeType: 'audio/wav', meta };
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
}

export const voisCliProvider: RenderProvider = {
  id: 'vois-cli',
  label: 'Vois (local CLI)',
  summary: 'Local, unlimited voice generation and cloning, driven by the Vois desktop app.',
  capabilities: ['tts', 'voice-clone'],
  setup: 'Install Vois from vois.so (the CLI ships inside the installer) and keep the desktop app running. Optionally set VOIS_CLI to the binary path.',
  probe,
  listVoices,
  tts,
};
