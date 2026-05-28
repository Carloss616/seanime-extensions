import { describe, expect, test } from "bun:test";
import { normalizeEntry, searchAndPaginate } from "./code.ts";

// parseCatalog / resolveUserPreferred / serializeCatalog now live in
// src/_shared/local-catalog/parse.test.ts (shared with the manager plugin).

describe("normalizeEntry", () => {
  test("expands a string title to english + userPreferred", () => {
    const m = normalizeEntry({ id: 1, title: "Solo" });
    expect(m.id).toBe(1);
    expect(m.type).toBe("MANGA");
    expect(m.title).toEqual({ english: "Solo", userPreferred: "Solo" });
  });

  test("fills userPreferred from an object title", () => {
    const m = normalizeEntry({
      id: 2,
      title: { english: "E", romaji: "R" },
    });
    expect(m.title?.userPreferred).toBe("E");
    expect(m.title?.romaji).toBe("R");
  });

  test("maps cover to all coverImage sizes", () => {
    const m = normalizeEntry({ id: 3, title: "X", cover: "http://c/x.png" });
    expect(m.coverImage).toEqual({
      extraLarge: "http://c/x.png",
      large: "http://c/x.png",
      medium: "http://c/x.png",
    });
  });

  test("maps year to startDate.year and passes through optional fields", () => {
    const m = normalizeEntry({
      id: 4,
      title: "Y",
      year: 2021,
      banner: "http://b/y.png",
      chapters: 120,
      volumes: 12,
      genres: ["Action"],
      status: "RELEASING",
      format: "MANGA",
      isAdult: true,
      country: "JP",
      siteUrl: "http://s/y",
    });
    expect(m.startDate).toEqual({ year: 2021 });
    expect(m.bannerImage).toBe("http://b/y.png");
    expect(m.chapters).toBe(120);
    expect(m.volumes).toBe(12);
    expect(m.genres).toEqual(["Action"]);
    expect(m.status).toBe("RELEASING");
    expect(m.format).toBe("MANGA");
    expect(m.isAdult).toBe(true);
    expect(m.countryOfOrigin).toBe("JP");
    expect(m.siteUrl).toBe("http://s/y");
  });

  test("omits empty optional collections and missing fields", () => {
    const m = normalizeEntry({ id: 5, title: "Z", genres: [], synonyms: [] });
    expect(m.genres).toBeUndefined();
    expect(m.synonyms).toBeUndefined();
    expect(m.coverImage).toBeUndefined();
    expect(m.startDate).toBeUndefined();
  });
});

const entries = [
  { id: 1, title: "Omniscient Reader", synonyms: ["전지적 독자 시점"] },
  {
    id: 2,
    title: { english: "Solo Leveling", romaji: "Na Honjaman Level Up" },
  },
  { id: 3, title: "Tower of God" },
];

describe("searchAndPaginate", () => {
  test("empty search returns all (mapped), with totals", () => {
    const r = searchAndPaginate(entries, "", 1, 10);
    expect(r.total).toBe(3);
    expect(r.totalPages).toBe(1);
    expect(r.page).toBe(1);
    expect(r.media.map((m) => m.id)).toEqual([1, 2, 3]);
  });

  test("matches title case-insensitively", () => {
    const r = searchAndPaginate(entries, "solo", 1, 10);
    expect(r.media.map((m) => m.id)).toEqual([2]);
  });

  test("matches romaji and synonyms", () => {
    expect(searchAndPaginate(entries, "honjaman", 1, 10).total).toBe(1);
    expect(searchAndPaginate(entries, "전지적", 1, 10).total).toBe(1);
  });

  test("paginates", () => {
    const p1 = searchAndPaginate(entries, "", 1, 2);
    expect(p1.media.map((m) => m.id)).toEqual([1, 2]);
    expect(p1.totalPages).toBe(2);
    const p2 = searchAndPaginate(entries, "", 2, 2);
    expect(p2.media.map((m) => m.id)).toEqual([3]);
    expect(p2.page).toBe(2);
  });

  test("no match returns empty media but correct totals", () => {
    const r = searchAndPaginate(entries, "zzzz", 1, 10);
    expect(r.media).toEqual([]);
    expect(r.total).toBe(0);
    expect(r.totalPages).toBe(0);
  });
});
