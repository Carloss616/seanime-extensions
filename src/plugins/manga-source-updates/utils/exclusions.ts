// Exclusion + pin maps, keyed by mediaId (string) then providerId.
export type ExcludedMap = Record<string, Record<string, string>>;
export type PinnedMap = Record<string, string[]>;

// Return the exclusion + pin maps with a scope cleared, so the next scan
// re-discovers every source from 0. Pins are wiped alongside exclusions —
// otherwise a previously-toggled source would stay immune to auto-exclude and
// "affect" the from-scratch rediscovery. Omit mediaId to clear ALL manga, pass
// one to clear a single manga. Pure (new maps, no $storage) so it can be tested.
export function clearedExclusions(
  excluded: ExcludedMap,
  pinned: PinnedMap,
  mediaId?: number,
): { excluded: ExcludedMap; pinned: PinnedMap } {
  if (mediaId == null) return { excluded: {}, pinned: {} };
  const key = String(mediaId);
  const nextExcluded = { ...excluded };
  const nextPinned = { ...pinned };
  delete nextExcluded[key];
  delete nextPinned[key];
  return { excluded: nextExcluded, pinned: nextPinned };
}
