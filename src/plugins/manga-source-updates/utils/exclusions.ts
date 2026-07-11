import type { ExcludedRecord, PinRecord } from "./types";

// Exclusion + pin RECORD maps, keyed by mediaId (string) then providerId.
export type ExcludedMap = Record<string, Record<string, ExcludedRecord>>;
export type PinnedMap = Record<string, Record<string, PinRecord>>;

// Tombstone the LIVE exclusion + pin records in scope, so the next scan
// re-discovers every source from 0 while the clear can still propagate to
// other instances later (tombstones are kept, not deleted). Pins are cleared
// alongside exclusions — otherwise a previously-toggled source would stay
// immune to auto-exclude and "affect" the from-scratch rediscovery. Omit
// mediaId to clear ALL manga, pass one to clear a single manga. Pure (new
// maps, no $storage) so it can be tested.
export function clearedExclusions(
  excluded: ExcludedMap,
  pinned: PinnedMap,
  mediaId: number | undefined,
  now: number,
): { excluded: ExcludedMap; pinned: PinnedMap } {
  const scopeKeys = mediaId == null ? Object.keys(excluded) : [String(mediaId)];
  const pinScopeKeys =
    mediaId == null ? Object.keys(pinned) : [String(mediaId)];

  const nextExcluded = { ...excluded };
  for (const key of scopeKeys) {
    const providers = nextExcluded[key];
    if (!providers) continue;
    const nextProviders: Record<string, ExcludedRecord> = { ...providers };
    for (const [pid, rec] of Object.entries(providers)) {
      if (rec.deletedAt == null) {
        nextProviders[pid] = { ...rec, updatedAt: now, deletedAt: now };
      }
    }
    nextExcluded[key] = nextProviders;
  }

  const nextPinned = { ...pinned };
  for (const key of pinScopeKeys) {
    const providers = nextPinned[key];
    if (!providers) continue;
    const nextProviders: Record<string, PinRecord> = { ...providers };
    for (const [pid, rec] of Object.entries(providers)) {
      if (rec.deletedAt == null) {
        nextProviders[pid] = { ...rec, updatedAt: now, deletedAt: now };
      }
    }
    nextPinned[key] = nextProviders;
  }

  return { excluded: nextExcluded, pinned: nextPinned };
}
