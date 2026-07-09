import { K_PROBES, K_RESULTS } from "./constants";
import type { MangaResult, ProviderProbe, StoredResult } from "./types";

// Rebuild the last-scan rows from $storage so the tray shows them immediately
// after a plugin reload, without re-scanning. mediaId is the map key; every
// row is flagged fromCache.
export function hydrateResults(): MangaResult[] {
  const stored = $storage.get<Record<string, StoredResult>>(K_RESULTS) ?? {};
  const out: MangaResult[] = [];
  for (const key of Object.keys(stored)) {
    const r = stored[key];
    out.push({
      ...r,
      mediaId: Number(key),
      isNew: r.kind === "new",
      fromCache: true,
    });
  }
  out.sort((a, b) =>
    String(a.title ?? "").localeCompare(String(b.title ?? "")),
  );
  return out;
}

// Rehydrate the per-source probes from $storage (keyed by provider id).
export function hydrateProbes(): Record<number, Record<string, ProviderProbe>> {
  return (
    $storage.get<Record<number, Record<string, ProviderProbe>>>(K_PROBES) ?? {}
  );
}
