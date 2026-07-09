import { describe, expect, test } from "bun:test";
import { readingEntries } from "./collection";

describe("readingEntries", () => {
  test("keeps CURRENT entries with media only", () => {
    const col = {
      lists: [
        {
          status: "CURRENT",
          entries: [
            { mediaId: 1, media: { id: 1 } },
            { mediaId: 2, media: null },
          ],
        },
        {
          status: "PLANNING",
          entries: [{ mediaId: 3, media: { id: 3 } }],
        },
      ],
    } as $app.Manga_Collection;

    const ids = readingEntries(col).map((e) => Number(e.mediaId));
    expect(ids).toEqual([1]);
  });
});
