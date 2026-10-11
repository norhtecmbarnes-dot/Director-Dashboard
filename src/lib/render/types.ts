/**
 * Render provider contract.
 *
 * This project is open source and every user has a different toolbox. One person
 * has Vois and a Paul Ponna lifetime suite; another has ElevenLabs and an API key;
 * a third has nothing but local ComfyUI. So NO provider is assumed to exist.
 *
 * A provider is something that can DO work for the Director (make a voice, make an
 * image, animate a shot, drive a talking head). Each one:
 *
 *   1. declares what it can do (`capabilities`),
 *   2. can say whether it is actually usable on THIS machine right now (`probe`),
 *   3. and if it is usable, does the work.
 *
 * The Director resolves work to a provider at call time, honouring the user's
 * preference order and skipping anything unavailable — so a missing tool degrades
 * to a clear message and the next option, never a hard crash.
 *
 * Add a provider = add a file and register it. Nothing else changes.
 */

export type Capability =
  | 'tts' /** text -> speech audio */
  | 'voice-clone' /** create a voice from a sample */
  | 'music' /** caption + lyrics -> a full song (MiniMax Music 3) */
  | 'image' /** text -> still image */
  | 'video' /** text -> video */
  | 'image-to-video' /** animate an existing still */
  | 'talking-head'; /** a face + audio -> lip-synced video */

export const CAPABILITY_LABELS: Record<Capability, string> = {
  tts: 'Text to speech',
  'voice-clone': 'Voice cloning',
  music: 'Music / song generation',
  image: 'Image generation',
  video: 'Video generation',
  'image-to-video': 'Image to video',
  'talking-head': 'Talking head / avatar',
};

/** Why a provider is or is not usable. Machine-readable `reason` + human `detail`. */
export interface ProbeResult {
  available: boolean;
  /** Short stable code: 'ok' | 'not-installed' | 'app-not-running' | 'no-api-key' | ... */
  reason?: string;
  /** Human sentence, ideally saying how to fix it. */
  detail?: string;
  version?: string;
}

export interface TtsRequest {
  text: string;
  /** Provider-specific voice id. If omitted, the provider uses its default voice. */
  voice?: string;
  language?: string;
  /** Provider-specific quality/engine tier (e.g. Vois: fast|standard|multilingual|omni). */
  engine?: string;
  speed?: number;
  /** Reproducible rendering, where the provider supports it. */
  seed?: number;
}

export interface TtsResult {
  provider: string;
  audio: Buffer;
  mimeType: string;
  /** Anything the provider learned that the caller may want (duration, voice used, ...). */
  meta?: Record<string, unknown>;
}

export interface RenderProvider {
  /** Stable id used in config (`RENDER_PROVIDER_ORDER`). */
  id: string;
  label: string;
  /** One line for the UI. */
  summary: string;
  capabilities: Capability[];
  /** True when the provider needs a key. Shown in setup help. */
  requiresKey?: string;
  /** How to make this provider available — surfaced when probe() says no. */
  setup?: string;
  /** Is it usable on this machine right now? Must never throw. */
  probe(): Promise<ProbeResult>;
  listVoices?(): Promise<unknown>;
  tts?(req: TtsRequest): Promise<TtsResult>;
}

/** What the UI/API reports for one provider. */
export interface ProviderReport extends ProbeResult {
  id: string;
  label: string;
  summary: string;
  capabilities: Capability[];
  requiresKey?: string;
  setup?: string;
}
