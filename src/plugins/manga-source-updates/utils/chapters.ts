import type { ProviderProbe } from "./types";

// Highest numeric chapter in a container. `chapter` is a Go-wrapped string
// (e.g. "12", "12.5"); coerce before parsing (see CLAUDE.md goja boundary).
export function latestChapter(
  chapters: $app.HibikeManga_ChapterDetails[],
): number {
  let max = 0;
  for (const ch of chapters) {
    const n = Number.parseFloat(String(ch.chapter));
    if (!Number.isNaN(n) && n > max) max = n;
  }
  return max;
}

// Whole chapters still unread — chapter numbers are floats (e.g. 12.5), so the
// badge count floors the gap; classification must use the same rule or a manga
// with +0 can stay "new" (green) and in the New chapters list.
export function unreadChapters(read: number, latest: number): number {
  return Math.max(0, Math.floor(latest - read));
}

// Build a probe entry from a getChapterContainer read (null = thrown/error).
export function makeProbe(
  provider: string,
  providerName: string,
  chapters: $app.HibikeManga_ChapterDetails[] | null,
): ProviderProbe {
  return {
    provider,
    // Coerce: providerName comes from the Go-bound getProviders() map, and it's
    // used in charCodeAt (avatar hash) + tray.text — a raw wrapper misbehaves.
    providerName: String(providerName),
    latest: chapters ? latestChapter(chapters) : 0,
    count: chapters?.length ?? 0,
    matched: !!chapters && chapters.length > 0,
    errored: chapters == null,
    // Stamped later at the setProbes/mergeProbeTimestamps persist boundary —
    // 0 is correct for a freshly-built, not-yet-persisted probe.
    updatedAt: 0,
  };
}
