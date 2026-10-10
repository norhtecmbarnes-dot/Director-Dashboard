export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { probeAll, resolveFor, explainMissing, providerOrder, disabledProviders } from '@/lib/render/registry';
import { CAPABILITY_LABELS, type Capability } from '@/lib/render/types';
import { getComfyUIBaseUrl } from '@/lib/comfyui/client';

/**
 * Provider discovery and dispatch.
 *
 * GET  /api/providers
 *   Reports every registered provider, what it can do, and whether it is usable on
 *   THIS machine right now — plus which provider would be chosen per capability.
 *   This is what a Settings page renders so each user can see their own toolset.
 *
 * POST /api/providers
 *   { capability: 'tts', text, voice?, language?, engine?, speed?, seed?, upload? }
 *   Resolves the best AVAILABLE provider, runs the work, and (by default) uploads
 *   the audio into ComfyUI so avatar/lip-sync graphs can consume it — matching the
 *   behaviour of the existing /api/vocallab/tts route.
 *
 * Nothing is hardcoded to one vendor: change RENDER_PROVIDER_ORDER and the same
 * call routes elsewhere.
 */

const CAPABILITIES: Capability[] = ['tts', 'voice-clone', 'image', 'video', 'image-to-video', 'talking-head'];

export async function GET() {
  const reports = await probeAll();
  const order = providerOrder();

  // Which provider would be chosen, per capability?
  const selection: Record<string, string | null> = {};
  for (const cap of CAPABILITIES) {
    const chosen = reports.find(r => r.available && r.capabilities.includes(cap));
    if (reports.some(r => r.capabilities.includes(cap))) {
      selection[cap] = chosen ? chosen.id : null;
    }
  }

  return NextResponse.json({
    ok: true,
    order,
    disabled: disabledProviders(),
    providers: reports,
    selection,
    capabilityLabels: CAPABILITY_LABELS,
    hint: 'Set RENDER_PROVIDER_ORDER to change preference, RENDER_PROVIDERS_DISABLED to force one off.',
  });
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const capability = String(body.capability || 'tts') as Capability;
  if (capability !== 'tts') {
    return NextResponse.json(
      { ok: false, error: `Capability "${capability}" is not implemented yet. Only "tts" is wired.` },
      { status: 501 }
    );
  }

  const text = typeof body.text === 'string' ? body.text : '';
  if (!text.trim()) {
    return NextResponse.json({ ok: false, error: 'Missing text' }, { status: 400 });
  }

  const resolved = await resolveFor('tts');
  if (!resolved || !resolved.provider.tts) {
    return NextResponse.json(
      {
        ok: false,
        error: 'No text-to-speech provider is available on this machine.',
        why: await explainMissing('tts'),
      },
      { status: 503 }
    );
  }

  const started = Date.now();
  try {
    const result = await resolved.provider.tts({
      text,
      voice: typeof body.voice === 'string' ? body.voice : undefined,
      language: typeof body.language === 'string' ? body.language : undefined,
      engine: typeof body.engine === 'string' ? body.engine : undefined,
      speed: typeof body.speed === 'number' ? body.speed : undefined,
      seed: typeof body.seed === 'number' ? body.seed : undefined,
    });

    const ext = result.mimeType.includes('wav') ? 'wav' : result.mimeType.includes('mpeg') ? 'mp3' : 'bin';
    const upload = body.upload !== false; // default true, like the vocallab route

    const payload: Record<string, unknown> = {
      ok: true,
      provider: resolved.provider.id,
      providerLabel: resolved.provider.label,
      mimeType: result.mimeType,
      bytes: result.audio.length,
      durationMs: Date.now() - started,
      meta: result.meta ?? null,
    };

    if (upload) {
      const comfyRoot = getComfyUIBaseUrl().replace(/\/$/, '');
      const filename = `${resolved.provider.id}_tts_${Date.now()}.${ext}`;
      const form = new FormData();
      form.append(
        'image',
        new Blob([new Uint8Array(result.audio)], { type: result.mimeType }),
        filename
      );
      const up = await fetch(`${comfyRoot}/upload/image`, { method: 'POST', body: form });
      if (!up.ok) {
        const txt = await up.text().catch(() => '');
        // The audio generation succeeded — report that clearly rather than
        // pretending the whole call failed.
        return NextResponse.json(
          {
            ...payload,
            ok: false,
            error: `Audio generated, but the ComfyUI upload failed: ${up.status} ${txt.slice(0, 200)}`,
          },
          { status: 502 }
        );
      }
      payload.comfy = await up.json();
      payload.filename = filename;
    } else {
      payload.audioBase64 = result.audio.toString('base64');
    }

    return NextResponse.json(payload);
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        provider: resolved.provider.id,
        error: e instanceof Error ? e.message : 'Provider call failed',
        durationMs: Date.now() - started,
      },
      { status: 502 }
    );
  }
}
