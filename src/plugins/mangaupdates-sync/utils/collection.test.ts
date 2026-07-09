import { describe, expect, test } from "bun:test";
import { findListData } from "./collection.ts";

describe("findListData", () => {
  test("returns listData for matching mediaId", () => {
    const listData = { status: "CURRENT" as const, progress: 3 };
    const collection: $app.Manga_Collection = {
      lists: [
        {
          entries: [
            { mediaId: 100, media: { id: 100 }, listData },
            { mediaId: 200, media: { id: 200 }, listData: { progress: 1 } },
          ],
        },
      ],
    };
    expect(findListData(collection, 100)).toEqual(listData);
    expect(findListData(collection, 999)).toBeUndefined();
  });
});
