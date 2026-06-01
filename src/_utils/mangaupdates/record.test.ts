import { describe, expect, test } from "bun:test";
import { muRecordUrl, muRecordYear } from "./record.ts";

function rec(overrides: Partial<MUSearch.Record> = {}): MUSearch.Record {
  return {
    series_id: 555,
    title: "Test",
    url: "https://www.mangaupdates.com/series/abc/test",
    description: null,
    image: {
      url: { original: "https://img/orig.jpg", thumb: "https://img/thumb.jpg" },
      height: 0,
      width: 0,
    },
    type: "Manga",
    year: "2019",
    bayesian_rating: null,
    rating_votes: 0,
    genres: [],
    last_updated: { timestamp: 0, as_rfc3339: "", as_string: "" },
    ...overrides,
  };
}

describe("muRecordYear", () => {
  test("parses a numeric year string", () => {
    expect(muRecordYear(rec({ year: "2019" }))).toBe(2019);
  });
  test("returns undefined for empty / missing year", () => {
    expect(muRecordYear(rec({ year: "" }))).toBeUndefined();
    expect(
      muRecordYear(rec({ year: undefined as unknown as string })),
    ).toBeUndefined();
  });
  test("returns undefined for a non-numeric year", () => {
    expect(muRecordYear(rec({ year: "abc" }))).toBeUndefined();
  });
});

describe("muRecordUrl", () => {
  test("uses the record url when present", () => {
    expect(muRecordUrl(rec({ url: "https://mu/series/x" }))).toBe(
      "https://mu/series/x",
    );
  });
  test("falls back to the public site link from series_id", () => {
    expect(muRecordUrl(rec({ url: "", series_id: 123 }))).toBe(
      "https://www.mangaupdates.com/series.html?id=123",
    );
  });
});
