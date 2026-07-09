import type { MUResult } from "./types";

// De-duped, non-empty AniList titles to score a MU candidate against.
// Skips `native` (CJK) — MU titles are latin/english, so it never matches.
export function mangaTitles(manga: $app.AL_BaseManga | undefined): string[] {
  if (!manga) return [];
  const t = manga.title;
  const list = [
    t?.english,
    t?.romaji,
    t?.userPreferred,
    ...(manga.synonyms ?? []),
  ];
  return [
    ...new Set(list.map((s) => s?.trim()).filter((v): v is string => !!v)),
  ];
}

// Picks the MU result whose title best matches ANY of the AniList titles,
// using seanime's native scanner matcher ($scannerUtils.compareTitles, 0..1).
// Returns undefined when nothing clears `minScore` — a missing link is recoverable
// (manual link button); a wrong auto-link gets cached and silently corrupts syncs.
export function pickBestMatch(
  titles: string[],
  results: MUResult[],
  minScore = 0.8,
): MUResult | undefined {
  let best: MUResult | undefined;
  let bestScore = 0;
  for (const r of results) {
    let score = 0;
    for (const t of titles)
      score = Math.max(score, $scannerUtils.compareTitles(t, r.title));
    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }
  // ponytail: fixed 0.8 threshold. Make it a userConfig field only if real titles miss it.
  return bestScore >= minScore ? best : undefined;
}
