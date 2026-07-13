import { describe, expect, test } from "bun:test";
import { toBaseResult } from "./mu-client.ts";

function rec(overrides: Partial<$mu.Search.Record> = {}): $mu.Search.Record {
  return {
    series_id: 42,
    title: "Example",
    url: "https://www.mangaupdates.com/series/abc/example",
    description: null,
    image: {
      url: { original: "https://img/orig.jpg", thumb: "https://img/thumb.jpg" },
      height: 0,
      width: 0,
    },
    type: "Manga",
    year: "2020",
    bayesian_rating: null,
    rating_votes: 0,
    genres: [],
    last_updated: { timestamp: 0, as_rfc3339: "", as_string: "" },
    ...overrides,
  };
}

describe("toBaseResult", () => {
  test("maps a record to the MUResult shape (thumb-preferred cover)", () => {
    expect(toBaseResult(rec())).toEqual({
      id: "42",
      title: "Example",
      year: 2020,
      cover: "https://img/thumb.jpg",
      url: "https://www.mangaupdates.com/series/abc/example",
    });
  });

  test("falls back to '???' for a missing title", () => {
    expect(toBaseResult(rec({ title: "" })).title).toBe("???");
  });

  test("derives the public site url when the record has none", () => {
    expect(toBaseResult(rec({ url: "", series_id: 7 })).url).toBe(
      "https://www.mangaupdates.com/series.html?id=7",
    );
  });

  test("handles a record with no image without throwing", () => {
    const r = toBaseResult(rec({ image: undefined as unknown as $mu.Image }));
    expect(r.cover).toBeUndefined();
    expect(r.id).toBe("42");
  });
});
