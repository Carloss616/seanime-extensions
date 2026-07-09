// De-duped title list to help the provider match the manga (fuzzy search).
export function collectTitles(media: $app.AL_BaseManga): string[] {
  const t = media.title ?? {};
  const raw = [t.userPreferred, t.english, t.romaji, ...(media.synonyms ?? [])];
  const seen: Record<string, true> = {};
  const out: string[] = [];
  for (const s of raw) {
    if (s == null) continue;
    const v = String(s).trim();
    if (v && !seen[v]) {
      seen[v] = true;
      out.push(v);
    }
  }
  return out;
}

export function resolveTitle(media: $app.AL_BaseManga): string {
  const t = media.title ?? {};
  return String(t.userPreferred ?? t.english ?? t.romaji ?? "Unknown");
}
