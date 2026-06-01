// Write-side catalog ops (manager-only). The wire shape + reader-side
// parse/serialize live in src/_utils/local-catalog/parse.ts, used by both
// this plugin and the local-catalog source.

export function nextId(entries: CatalogEntry[]): number {
  let max = 0;
  for (const e of entries) {
    if (e.id > max) max = e.id;
  }
  return max + 1;
}

export function upsertEntry(
  entries: CatalogEntry[],
  entry: CatalogEntry,
): CatalogEntry[] {
  const out = entries.filter((e) => e.id !== entry.id);
  out.push(entry);
  out.sort((a, b) => a.id - b.id);
  return out;
}

export function removeEntry(
  entries: CatalogEntry[],
  id: number,
): CatalogEntry[] {
  return entries.filter((e) => e.id !== id);
}

export function validateEntry(entry: CatalogEntry): string | null {
  if (!Number.isInteger(entry.id) || entry.id < 1) {
    return "id must be a positive integer";
  }
  const t = entry.title;
  const titleStr =
    typeof t === "string"
      ? t
      : t?.userPreferred || t?.english || t?.romaji || t?.native || "";
  if (titleStr.trim().length === 0) {
    return "title is required";
  }
  return null;
}
