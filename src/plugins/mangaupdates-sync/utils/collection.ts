// Scan a manga collection for listData on a specific mediaId.

export function findListData(
  collection: $app.Manga_Collection,
  mediaId: number,
): $app.Manga_EntryListData | undefined {
  for (const list of collection.lists ?? []) {
    for (const entry of list.entries ?? []) {
      if (entry?.media && Number(entry.media.id) === Number(mediaId)) {
        return entry.listData;
      }
    }
  }
  return undefined;
}
