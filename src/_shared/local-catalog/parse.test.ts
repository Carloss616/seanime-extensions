import { describe, expect, test } from "bun:test";
import {
  parseCatalog,
  resolveUserPreferred,
  serializeCatalog,
} from "./parse.ts";

describe("parseCatalog", () => {
  test("reads the manga array from an object", () => {
    const out = parseCatalog({
      version: 1,
      manga: [{ id: 1, title: "A" }],
    });
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe(1);
  });

  test("accepts a bare array", () => {
    const out = parseCatalog([{ id: 5, title: "B" }]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe(5);
  });

  test("accepts a JSON string and returns [] on bad JSON", () => {
    expect(
      parseCatalog('{"version":1,"manga":[{"id":1,"title":"A"}]}'),
    ).toEqual([{ id: 1, title: "A" }]);
    expect(parseCatalog("not json")).toEqual([]);
  });

  test("skips entries with no valid id", () => {
    const out = parseCatalog([
      { id: 0, title: "zero" },
      { id: -1, title: "neg" },
      { title: "noid" },
      { id: 2, title: "ok" },
    ]);
    expect(out.map((e) => e.id)).toEqual([2]);
  });

  test("skips entries with no resolvable title", () => {
    const out = parseCatalog([
      { id: 1 },
      { id: 2, title: "" },
      { id: 3, title: { english: "x" } },
    ]);
    expect(out.map((e) => e.id)).toEqual([3]);
  });

  test("dedupes by id, last wins", () => {
    const out = parseCatalog([
      { id: 1, title: "first" },
      { id: 1, title: "second" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("second");
  });

  test("coerces a numeric-string id to a number", () => {
    const out = parseCatalog([{ id: "5", title: "S" }]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe(5);
  });

  test("survives null / non-object array items", () => {
    const out = parseCatalog([null, 5, "x", { id: 1, title: "ok" }]);
    expect(out.map((e) => e.id)).toEqual([1]);
  });

  test("returns empty for garbage parsed input", () => {
    expect(parseCatalog(null)).toEqual([]);
    expect(parseCatalog(42)).toEqual([]);
    expect(parseCatalog({})).toEqual([]);
  });
});

describe("resolveUserPreferred", () => {
  test("string title returns trimmed value, or undefined when blank", () => {
    expect(resolveUserPreferred("  Hello  ")).toBe("Hello");
    expect(resolveUserPreferred("")).toBeUndefined();
    expect(resolveUserPreferred("   ")).toBeUndefined();
  });

  test("object title prefers userPreferred → english → romaji → native", () => {
    expect(
      resolveUserPreferred({ userPreferred: "U", english: "E", romaji: "R" }),
    ).toBe("U");
    expect(resolveUserPreferred({ english: "E", romaji: "R" })).toBe("E");
    expect(resolveUserPreferred({ romaji: "R", native: "N" })).toBe("R");
    expect(resolveUserPreferred({ native: "N" })).toBe("N");
    expect(resolveUserPreferred({})).toBeUndefined();
  });

  test("non-string/non-object → undefined", () => {
    expect(resolveUserPreferred(null)).toBeUndefined();
    expect(resolveUserPreferred(42)).toBeUndefined();
  });
});

describe("serializeCatalog", () => {
  test("wraps entries with version + updatedAt", () => {
    const json = serializeCatalog([{ id: 1, title: "a" }], 1234);
    expect(JSON.parse(json)).toEqual({
      version: 1,
      updatedAt: 1234,
      manga: [{ id: 1, title: "a" }],
    });
  });
});
