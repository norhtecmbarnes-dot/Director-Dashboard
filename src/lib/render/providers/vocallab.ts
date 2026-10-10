import { vocallabPing, vocallabListVoices, vocallabTts } from '@/lib/vocallab/client';
import type { ProbeResult, RenderProvider, TtsRequest, TtsResult } from '../types';

/**
 * VocalLab (vocallab.ai) — hosted TTS API.
 *
 * This adapter adds NO new integration: the client and its route already exist.
 * It exists to prove the registry pattern — a provider that is "already wired"
 * becomes just another entry, and the Director can prefer or ignore it without
 * any special-casing.
 *
 * Unlike Vois this one is metered (the ping returns a points balance), which is
 * exactly why a user may want to order providers differently.
 */

async function probe(): Promise<ProbeResult> {
  if (!process.env.VOCALLAB_API_KEY) {
    // resolveApiKey also checks the DB (Settings UI) — ping() covers that path,
    // so a missing env var is only a hint, not the verdict.
  }
  try {
    const res = await vocallabPing();
    if (!res.ok) {
      const reason = !process.env.VOCALLAB_API_KEY ? 'no-api-key' : 'api-error';
      return {
        available: false,
        reason,
        detail:
          reason === 'no-api-key'
            ? 'No VocalLab API key found. Add one in Settings, or set VOCALLAB_API_KEY.'
            : res.error || 'VocalLab is unreachable.',
      };
    }
    return {
      available: true,
      reason: 'ok',
      detail: typeof res.points === 'number' ? `${res.points} points remaining.` : 'Reachable.',
    };
  } catch (e) {
    return {
      available: false,
      reason: 'unreachable',
      detail: e instanceof Error ? e.message : 'VocalLab unreachable',
    };
  }
}

async function tts(req: TtsRequest): Promise<TtsResult> {
  if (!req.voice) throw new Error('VocalLab requires a voice id');
  const audio = await vocallabTts({
    text: req.text,
    voice: req.voice,
    speed: req.speed,
    temperature: undefined,
  });
  return { provider: 'vocallab', audio, mimeType: 'audio/mpeg' };
}

export const vocalLabProvider: RenderProvider = {
  id: 'vocallab',
  label: 'VocalLab (API)',
  summary: 'Hosted text-to-speech API. Metered — costs points per call.',
  capabilities: ['tts'],
  requiresKey: 'VOCALLAB_API_KEY',
  setup: 'Add a VocalLab API key in Settings (stored as api_key_vocallab) or set VOCALLAB_API_KEY.',
  probe,
  listVoices: () => vocallabListVoices(),
  tts,
};
