import { describe, expect, test } from "bun:test";
import { nextId, removeEntry, upsertEntry, validateEntry } from "./catalog.ts";

// parseCatalog / serializeCatalog / resolveUserPreferred / coerceTitle live in
// src/_utils/local-catalog/parse.test.ts (shared with the source).

describe("nextId", () => {
  test("empty -> 1, else max+1", () => {
    expect(nextId([])).toBe(1);
    expect(
      nextId([
        { id: 1, title: { userPreferred: "a" } },
        { id: 4, title: { userPreferred: "b" } },
      ]),
    ).toBe(5);
  });
});

describe("upsertEntry", () => {
  test("inserts a new entry", () => {
    const out = upsertEntry([{ id: 1, title: { userPreferred: "a" } }], {
      id: 2,
      title: { userPreferred: "b" },
    });
    expect(out.map((e) => e.id)).toEqual([1, 2]);
  });
  test("replaces an entry with the same id (no duplicate)", () => {
    const out = upsertEntry([{ id: 1, title: { userPreferred: "a" } }], {
      id: 1,
      title: { userPreferred: "a2" },
    });
    expect(out.map((e) => e.id)).toEqual([1]);
    expect(out[0].title?.userPreferred).toBe("a2");
  });
});

describe("removeEntry", () => {
  test("drops the entry with the id", () => {
    const out = removeEntry(
      [
        { id: 1, title: { userPreferred: "a" } },
        { id: 2, title: { userPreferred: "b" } },
      ],
      1,
    );
    expect(out.map((e) => e.id)).toEqual([2]);
  });
});

describe("validateEntry", () => {
  test("requires a positive integer id and a non-empty title", () => {
    expect(validateEntry({ id: 1, title: { userPreferred: "a" } })).toBeNull();
    expect(validateEntry({ id: 0, title: { userPreferred: "a" } })).toBeTypeOf(
      "string",
    );
    expect(validateEntry({ id: 1, title: { userPreferred: "  " } })).toBeTypeOf(
      "string",
    );
  });
  test("accepts an object title with a resolvable string", () => {
    expect(validateEntry({ id: 1, title: { english: "E" } })).toBeNull();
    expect(validateEntry({ id: 1, title: {} })).toBeTypeOf("string");
  });
});
