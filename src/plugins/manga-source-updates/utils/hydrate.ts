import { getProbes, getResults, isLive } from "./store";
import type { MangaResult, ProviderProbe } from "./types";

// Rebuild the last-scan rows from $storage so the tray shows them immediately
// after a plugin reload. mediaId is the map key; every row is flagged fromCache.
// Tombstoned rows are skipped.
export function hydrateResults(): MangaResult[] {
  const stored = getResults();
  const out: MangaResult[] = [];
  for (const key of Object.keys(stored)) {
    const r = stored[key];
    if (!isLive(r)) continue;
    out.push({
      ...r,
      // `read` is off the wire, so a row discovered purely from a peer has none
      // until refreshProgress re-reads it from this instance's collection.
      // Default to 0 so unreadChapters()/classify() never see undefined → NaN.
      read: Number(r.read ?? 0),
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

export function hydrateProbes(): Record<number, Record<string, ProviderProbe>> {
  return getProbes() as unknown as Record<
    number,
    Record<string, ProviderProbe>
  >;
}
