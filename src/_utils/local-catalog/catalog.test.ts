import { describe, expect, test } from "bun:test";
import {
  catalogsEqual,
  coerceTitle,
  diffCatalog,
  mergeCatalog,
  parseCatalog,
  resolveUserPreferred,
  serializeCatalog,
} from "./catalog.ts";

const log = {
  log() {},
  info() {},
  warn() {},
  error() {},
  debug() {},
} as unknown as Console;

describe("parseCatalog", () => {
  test("reads manga + anime arrays; coerces string title to object", () => {
    const out = parseCatalog(
      {
        version: 2,
        manga: [{ id: 1, title: "A" }],
        anime: [{ id: 9, title: "B" }],
      },
      log,
    );
    expect(out.manga).toHaveLength(1);
    expect(out.manga[0].id).toBe(1);
    expect(out.manga[0].title).toEqual({ userPreferred: "A", english: "A" });
    expect(out.anime).toHaveLength(1);
    expect(out.anime[0].id).toBe(9);
  });

  test("bare array → manga, empty anime", () => {
    const out = parseCatalog([{ id: 5, title: "B" }], log);
    expect(out.manga.map((e) => e.id)).toEqual([5]);
    expect(out.anime).toEqual([]);
  });

  test("JSON string input; bad JSON → empty doc", () => {
    const ok = parseCatalog(
      '{"version":2,"manga":[{"id":1,"title":"A"}]}',
      log,
    );
    expect(ok.manga.map((e) => e.id)).toEqual([1]);
    const bad = parseCatalog("not json", log);
    expect(bad).toEqual({ manga: [], anime: [] });
  });

  test("skips invalid ids", () => {
    const out = parseCatalog(
      [
        { id: 0, title: "zero" },
        { id: -1, title: "neg" },
        { title: "noid" },
        { id: 2, title: "ok" },
      ],
      log,
    );
    expect(out.manga.map((e) => e.id)).toEqual([2]);
  });

  test("skips entries with no resolvable title", () => {
    const out = parseCatalog(
      [{ id: 1 }, { id: 2, title: "" }, { id: 3, title: { english: "x" } }],
      log,
    );
    expect(out.manga.map((e) => e.id)).toEqual([3]);
  });

  test("dedupes by id, last wins", () => {
    const out = parseCatalog(
      [
        { id: 1, title: "first" },
        { id: 1, title: "second" },
      ],
      log,
    );
    expect(out.manga).toHaveLength(1);
    expect(out.manga[0].title).toEqual({
      userPreferred: "second",
      english: "second",
    });
  });

  test("coerces a numeric-string id", () => {
    const out = parseCatalog([{ id: "5", title: "S" }], log);
    expect(out.manga[0].id).toBe(5);
  });

  test("preserves per-record updatedAt", () => {
    const out = parseCatalog([{ id: 1, title: "A", updatedAt: 123 }], log);
    expect(out.manga[0].updatedAt).toBe(123);
  });

  test("survives null / non-object items", () => {
    const out = parseCatalog([null, 5, "x", { id: 1, title: "ok" }], log);
    expect(out.manga.map((e) => e.id)).toEqual([1]);
  });

  test("garbage parsed input → empty doc", () => {
    expect(parseCatalog(null, log)).toEqual({ manga: [], anime: [] });
    expect(parseCatalog(42, log)).toEqual({ manga: [], anime: [] });
    expect(parseCatalog({}, log)).toEqual({ manga: [], anime: [] });
  });
});

describe("coerceTitle", () => {
  test("string → { userPreferred, english }", () => {
    expect(coerceTitle("  Hi  ")).toEqual({
      userPreferred: "Hi",
      english: "Hi",
    });
  });
  test("object fills userPreferred from priority chain", () => {
    expect(coerceTitle({ english: "E", romaji: "R" })).toEqual({
      english: "E",
      romaji: "R",
      userPreferred: "E",
    });
  });
  test("non-title → empty object", () => {
    expect(coerceTitle(null)).toEqual({});
    expect(coerceTitle(42)).toEqual({});
  });
});

describe("resolveUserPreferred", () => {
  test("string title trims, blank → undefined", () => {
    expect(resolveUserPreferred("  Hello  ")).toBe("Hello");
    expect(resolveUserPreferred("   ")).toBeUndefined();
  });
  test("object prefers userPreferred → english → romaji → native", () => {
    expect(resolveUserPreferred({ userPreferred: "U", english: "E" })).toBe(
      "U",
    );
    expect(resolveUserPreferred({ english: "E", romaji: "R" })).toBe("E");
    expect(resolveUserPreferred({ native: "N" })).toBe("N");
    expect(resolveUserPreferred({})).toBeUndefined();
  });
  test("non-string/non-object → undefined", () => {
    expect(resolveUserPreferred(null)).toBeUndefined();
    expect(resolveUserPreferred(42)).toBeUndefined();
  });
});

describe("serializeCatalog", () => {
  test("v2 envelope; anime always present ([] when empty)", () => {
    const json = serializeCatalog(
      [{ id: 1, title: { userPreferred: "a" } }],
      1234,
    );
    expect(JSON.parse(json)).toEqual({
      version: 2,
      updatedAt: 1234,
      manga: [{ id: 1, title: { userPreferred: "a" } }],
      anime: [],
    });
  });
  test("includes anime when present", () => {
    const json = serializeCatalog([], 1, [
      { id: 9, title: { userPreferred: "x" } },
    ]);
    expect(JSON.parse(json).anime).toEqual([
      { id: 9, title: { userPreferred: "x" } },
    ]);
  });

  test("drops null/undefined fields (e.g. blanks round-tripped through $storage as null)", () => {
    const json = serializeCatalog(
      [
        {
          id: 1,
          title: { userPreferred: "a", english: "a", romaji: undefined },
          bannerImage: null,
          coverImage: null,
          chapters: null,
          startDate: null,
          siteUrl: "u",
        } as unknown as MangaCatalogEntry,
      ],
      0,
    );
    expect(JSON.parse(json).manga[0]).toEqual({
      id: 1,
      title: { userPreferred: "a", english: "a" },
      siteUrl: "u",
    });
  });

  test("entry keys: id + title first, rest alphabetical; byte-stable across input order", () => {
    const a = serializeCatalog(
      [
        {
          status: "RELEASING",
          siteUrl: "u",
          countryOfOrigin: "JP",
          id: 1,
          title: { userPreferred: "a" },
        } as MangaCatalogEntry,
      ],
      0,
    );
    expect(Object.keys(JSON.parse(a).manga[0])).toEqual([
      "id",
      "title",
      "countryOfOrigin",
      "siteUrl",
      "status",
    ]);
    // Same data, different input key order → byte-identical output.
    const b = serializeCatalog(
      [
        {
          id: 1,
          countryOfOrigin: "JP",
          title: { userPreferred: "a" },
          status: "RELEASING",
          siteUrl: "u",
        } as MangaCatalogEntry,
      ],
      0,
    );
    expect(b).toBe(a);
  });
});

describe("mergeCatalog (per-entry last-write-wins)", () => {
  test("disjoint ids: both survive, sorted", () => {
    const out = mergeCatalog(
      [{ id: 2, title: { userPreferred: "l" }, updatedAt: 1 }],
      [{ id: 1, title: { userPreferred: "r" }, updatedAt: 1 }],
    );
    expect(out.map((e) => e.id)).toEqual([1, 2]);
  });
  test("same id: newer updatedAt wins", () => {
    const out = mergeCatalog(
      [{ id: 1, title: { userPreferred: "local-old" }, updatedAt: 10 }],
      [{ id: 1, title: { userPreferred: "remote-new" }, updatedAt: 20 }],
    );
    expect(out[0].title?.userPreferred).toBe("remote-new");
  });
  test("same id: local newer wins", () => {
    const out = mergeCatalog(
      [{ id: 1, title: { userPreferred: "local-new" }, updatedAt: 30 }],
      [{ id: 1, title: { userPreferred: "remote-old" }, updatedAt: 10 }],
    );
    expect(out[0].title?.userPreferred).toBe("local-new");
  });
  test("missing updatedAt treated as 0; tie → local", () => {
    const out = mergeCatalog(
      [{ id: 1, title: { userPreferred: "local" } }],
      [{ id: 1, title: { userPreferred: "remote" } }],
    );
    expect(out[0].title?.userPreferred).toBe("local");
  });
  test("both empty → empty", () => {
    expect(mergeCatalog([], [])).toEqual([]);
  });
});

describe("diffCatalog", () => {
  test("counts localOnly / remoteOnly / conflicts", () => {
    const out = diffCatalog(
      [
        { id: 1, title: {} },
        { id: 2, title: {} },
      ],
      [
        { id: 2, title: {} },
        { id: 3, title: {} },
      ],
    );
    expect(out).toEqual({ localOnly: 1, remoteOnly: 1, conflicts: 1 });
  });
  test("empty / empty → all zero", () => {
    expect(diffCatalog([], [])).toEqual({
      localOnly: 0,
      remoteOnly: 0,
      conflicts: 0,
    });
  });
});

describe("catalogsEqual", () => {
  test("same entries, different array order → equal", () => {
    const a = [
      { id: 2, title: { userPreferred: "B" }, updatedAt: 9 },
      { id: 1, title: { userPreferred: "A" }, updatedAt: 9 },
    ];
    const b = [
      { id: 1, title: { userPreferred: "A" }, updatedAt: 9 },
      { id: 2, title: { userPreferred: "B" }, updatedAt: 9 },
    ];
    expect(catalogsEqual(a, b)).toBe(true);
  });

  test("null fields (storage round-trip) match dropped fields", () => {
    const local = [{ id: 1, title: { userPreferred: "A" }, coverImage: null }];
    const remote = [{ id: 1, title: { userPreferred: "A" } }];
    expect(catalogsEqual(local as never, remote)).toBe(true);
  });

  test("differing length / field value → not equal", () => {
    const a = [{ id: 1, title: { userPreferred: "A" } }];
    expect(catalogsEqual(a, [])).toBe(false);
    expect(catalogsEqual(a, [{ id: 1, title: { userPreferred: "Z" } }])).toBe(
      false,
    );
  });
});
