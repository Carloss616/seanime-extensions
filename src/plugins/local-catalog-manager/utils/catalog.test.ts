import { describe, expect, test } from "bun:test";
import { nextId, removeEntry, upsertEntry, validateEntry } from "./catalog.ts";

// parseCatalog / serializeCatalog / resolveUserPreferred live in
// src/_utils/local-catalog/parse.test.ts (shared with the v1 source).

describe("nextId", () => {
  test("empty -> 1, else max+1", () => {
    expect(nextId([])).toBe(1);
    expect(
      nextId([
        { id: 1, title: "a" },
        { id: 4, title: "b" },
      ]),
    ).toBe(5);
  });
});

describe("upsertEntry", () => {
  test("inserts a new entry", () => {
    const out = upsertEntry([{ id: 1, title: "a" }], { id: 2, title: "b" });
    expect(out.map((e) => e.id)).toEqual([1, 2]);
  });
  test("replaces an entry with the same id (no duplicate)", () => {
    const out = upsertEntry([{ id: 1, title: "a" }], { id: 1, title: "a2" });
    expect(out).toEqual([{ id: 1, title: "a2" }]);
  });
});

describe("removeEntry", () => {
  test("drops the entry with the id", () => {
    expect(
      removeEntry(
        [
          { id: 1, title: "a" },
          { id: 2, title: "b" },
        ],
        1,
      ),
    ).toEqual([{ id: 2, title: "b" }]);
  });
});

describe("validateEntry", () => {
  test("requires a positive integer id and a non-empty title", () => {
    expect(validateEntry({ id: 1, title: "a" })).toBeNull();
    expect(validateEntry({ id: 0, title: "a" })).toBeTypeOf("string");
    expect(validateEntry({ id: 1, title: "  " })).toBeTypeOf("string");
  });
  test("accepts an object title with a resolvable string", () => {
    expect(
      validateEntry({ id: 1, title: { english: "E" } as CatalogTitle }),
    ).toBeNull();
    expect(validateEntry({ id: 1, title: {} as CatalogTitle })).toBeTypeOf(
      "string",
    );
  });
});
