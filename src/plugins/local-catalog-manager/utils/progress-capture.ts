// Pre-hook helpers: filter local-catalog entries and build partial progress
// payloads without clobbering fields the event didn't carry.

import { progressSkipKey } from "./constants";

export function isLocalCatalogEntry(
  siteUrl: string | undefined,
  sourcePrefix: string,
): boolean {
  return (siteUrl ?? "").indexOf(sourcePrefix) === 0;
}

export function buildProgressPayload(
  event: {
    status?: $app.AL_MediaListStatus;
    progress?: number;
    scoreRaw?: number;
  },
  includeScore = false,
): Partial<MangaProgressEntry> | null {
  const payload: Partial<MangaProgressEntry> = {};
  if (event.status != null) payload.status = event.status;
  if (event.progress != null) payload.progress = event.progress;
  if (includeScore && event.scoreRaw != null && event.scoreRaw > 0) {
    payload.score = event.scoreRaw;
  }
  if (Object.keys(payload).length === 0) return null;
  return payload;
}

export function wrapUpdateEntryWithSkip(mediaId: number, fn: () => void): void {
  $store.set(progressSkipKey(mediaId), true);
  try {
    fn();
  } finally {
    $store.remove(progressSkipKey(mediaId));
  }
}
