import type { Capability, ProviderReport, RenderProvider } from './types';
import { voisCliProvider } from './providers/vois-cli';
import { vocalLabProvider } from './providers/vocallab';

/**
 * The provider registry.
 *
 * Every provider is OPTIONAL. This project is open source and each user has their
 * own tools, so the Director never assumes any particular one exists — it asks each
 * registered provider whether it is usable right now, and works with whatever is
 * there.
 *
 * Users shape their own setup with two environment variables (no code changes):
 *
 *   RENDER_PROVIDER_ORDER="vois-cli,vocallab"   comma-separated preference
 *   RENDER_PROVIDERS_DISABLED="vocallab"        force-off, even if available
 *
 * Providers named in ORDER are tried first, in that order; any other registered
 * provider follows in its default position. Disabled providers are never selected.
 * A provider that is unavailable is skipped, and the reason is reported so the UI
 * can tell the user how to enable it.
 */

/** Default preference: local and unlimited first, metered APIs after. */
const DEFAULT_ORDER = ['vois-cli', 'vocallab'];

const ALL_PROVIDERS: RenderProvider[] = [voisCliProvider, vocalLabProvider];

function parseList(value: string | undefined): string[] {
  return (value || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

export function providerOrder(): string[] {
  const configured = parseList(process.env.RENDER_PROVIDER_ORDER);
  const known = new Set(ALL_PROVIDERS.map(p => p.id));
  // Configured names first (ignoring unknown ones), then anything else registered.
  const first = configured.filter(id => known.has(id));
  const rest = ALL_PROVIDERS.map(p => p.id).filter(id => !first.includes(id));
  return first.length > 0 ? [...first, ...rest] : DEFAULT_ORDER.filter(id => known.has(id)).concat(
    ALL_PROVIDERS.map(p => p.id).filter(id => !DEFAULT_ORDER.includes(id))
  );
}

export function disabledProviders(): string[] {
  return parseList(process.env.RENDER_PROVIDERS_DISABLED);
}

export function getProvider(id: string): RenderProvider | undefined {
  return ALL_PROVIDERS.find(p => p.id === id);
}

export function listProviders(): RenderProvider[] {
  return ALL_PROVIDERS;
}

/** Probe every provider (never throws) and report availability in preference order. */
export async function probeAll(): Promise<ProviderReport[]> {
  const disabled = new Set(disabledProviders());
  const order = providerOrder();

  const reports = await Promise.all(
    order
      .map(id => getProvider(id))
      .filter((p): p is RenderProvider => Boolean(p))
      .map(async (p): Promise<ProviderReport> => {
        let probed;
        try {
          probed = await p.probe();
        } catch (e) {
          probed = {
            available: false,
            reason: 'probe-failed',
            detail: e instanceof Error ? e.message : 'probe threw',
          };
        }
        const isDisabled = disabled.has(p.id);
        return {
          id: p.id,
          label: p.label,
          summary: p.summary,
          capabilities: p.capabilities,
          requiresKey: p.requiresKey,
          setup: p.setup,
          ...probed,
          available: probed.available && !isDisabled,
          ...(isDisabled ? { reason: 'disabled', detail: 'Disabled via RENDER_PROVIDERS_DISABLED.' } : {}),
        };
      })
  );

  return reports;
}

export interface Resolution {
  provider: RenderProvider;
  report: ProviderReport;
}

/**
 * Pick the best AVAILABLE provider for a capability, honouring preference order.
 * Returns null when nothing can do the job — callers should surface the probe
 * reasons rather than pretend the work succeeded.
 */
export async function resolveFor(capability: Capability): Promise<Resolution | null> {
  const reports = await probeAll();
  for (const report of reports) {
    if (!report.available) continue;
    if (!report.capabilities.includes(capability)) continue;
    const provider = getProvider(report.id);
    if (provider) return { provider, report };
  }
  return null;
}

/** Human-readable explanation of why a capability cannot be served. */
export async function explainMissing(capability: Capability): Promise<string> {
  const reports = await probeAll();
  const capable = reports.filter(r => r.capabilities.includes(capability));
  if (capable.length === 0) {
    return `No registered provider offers "${capability}". Add one, or enable an integration.`;
  }
  return capable
    .map(r => `${r.label}: ${r.detail || r.reason || 'unavailable'}`)
    .join(' | ');
}
