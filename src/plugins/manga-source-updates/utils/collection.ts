/** Every CURRENT-list entry that has media (global scan input). */
export function readingEntries(
  col: $app.Manga_Collection,
): $app.Manga_CollectionEntry[] {
  const out: $app.Manga_CollectionEntry[] = [];
  for (const list of col.lists ?? []) {
    if (String(list.status) !== "CURRENT") continue;
    for (const e of list.entries ?? []) {
      if (e?.media) out.push(e);
    }
  }
  return out;
}
