const VOCALLAB_BASE = 'https://api.vocallab.ai/api';

import { resolveApiKey } from '@/lib/services/api-key-resolver';

export function getVocalLabKey(): string | undefined {
  return resolveApiKey('vocallab', 'VOCALLAB_API_KEY');
}

export interface VocalLabTtsParams {
  text: string;
  voice: string;
  format?: 'MP3' | 'WAV' | 'PCM';
  speed?: number;
  temperature?: number;
}

export async function vocallabTts(params: VocalLabTtsParams): Promise<Buffer> {
  const key = getVocalLabKey();
  if (!key) throw new Error('VOCALLAB_API_KEY not set');

  const body: Record<string, unknown> = {
    text: params.text,
    voice: params.voice,
    format: params.format || 'MP3',
  };
  if (params.speed !== undefined) body.speed = params.speed;
  if (params.temperature !== undefined) body.temperature = params.temperature;

  const res = await fetch(`${VOCALLAB_BASE}/v1/tts`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`VocalLab ${res.status}: ${text.slice(0, 300)}`);
  }

  // VocalLab does NOT stream raw audio. It returns JSON containing a base64 data
  // URL, e.g.
  //   { "id": "...", "status": "pending",
  //     "audio_base64": "data:audio/mpeg;base64,//uUxAAC..." }
  // The previous implementation returned res.arrayBuffer() directly, so callers
  // received the JSON *text* labelled as audio/mpeg — which silently corrupted
  // every avatar voice uploaded to ComfyUI. Parse the payload properly, and stay
  // defensive in case the API ever returns real audio bytes.
  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  const looksJson = contentType.includes('application/json') || contentType.includes('text/');

  if (!looksJson) {
    const buf = Buffer.from(await res.arrayBuffer());
    // A real MP3 starts 0xFF 0xFB/0xF3/0xF2; anything starting '{' is JSON we missed.
    if (buf.length > 0 && buf[0] !== 0x7b) return buf;
  }

  const raw = await res.text();
  let data: { status?: string; audio_base64?: string; audio_url?: string; id?: string; error?: string };
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`VocalLab returned an unreadable response: ${raw.slice(0, 200)}`);
  }

  if (data.error) throw new Error(`VocalLab: ${data.error}`);

  if (data.audio_base64) {
    const comma = data.audio_base64.indexOf(',');
    const payload =
      data.audio_base64.startsWith('data:') && comma !== -1
        ? data.audio_base64.slice(comma + 1)
        : data.audio_base64;
    return Buffer.from(payload, 'base64');
  }

  if (data.audio_url) {
    const audioRes = await fetch(data.audio_url);
    if (!audioRes.ok) throw new Error(`VocalLab audio download failed: ${audioRes.status}`);
    return Buffer.from(await audioRes.arrayBuffer());
  }

  throw new Error(
    `VocalLab returned no audio (status: ${data.status || 'unknown'}, id: ${data.id || 'n/a'})`
  );
}

export async function vocallabListVoices(): Promise<unknown> {
  const key = getVocalLabKey();
  if (!key) throw new Error('VOCALLAB_API_KEY not set');
  const res = await fetch(`${VOCALLAB_BASE}/v1/voices?limit=50`, {
    headers: { 'Authorization': `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`VocalLab ${res.status}`);
  return res.json();
}

export async function vocallabPing(): Promise<{ ok: boolean; points?: number; error?: string }> {
  const key = getVocalLabKey();
  if (!key) return { ok: false, error: 'VOCALLAB_API_KEY not set' };
  try {
    const res = await fetch(`${VOCALLAB_BASE}/v1/ping`, {
      headers: { 'Authorization': `Bearer ${key}` },
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = await res.json();
    return { ok: true, points: data.points };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unreachable' };
  }
}