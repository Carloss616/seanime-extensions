import { describe, expect, test } from "bun:test";
import { clientCacheQueryKeys } from "./client-cache";

describe("clientCacheQueryKeys", () => {
  test("empty scope yields no keys", () => {
    expect(clientCacheQueryKeys({})).toEqual([]);
  });

  test("catalog scope", () => {
    expect(clientCacheQueryKeys({ catalog: true })).toEqual([
      "CUSTOM-SOURCE-custom-source-list-manga",
    ]);
  });

  test("progress scope", () => {
    expect(clientCacheQueryKeys({ progress: true })).toEqual([
      "MANGA-get-manga-collection",
      "MANGA-get-anilist-manga-collection",
      "MANGA-get-manga-entry",
    ]);
  });
});
