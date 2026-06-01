import { describe, expect, test } from "bun:test";
import {
  diffCatalog,
  mergeCatalog,
  parseCatalog,
  resolveUserPreferred,
  serializeCatalog,
} from "./parse.ts";

// parseCatalog takes a Console for warnings (bad entries, version mismatch).
// These tests assert on parse output, not logging, so route it to a silent
// stub to keep test output clean.
const log = {
  log() {},
  info() {},
  warn() {},
  error() {},
  debug() {},
} as unknown as Console;

describe("parseCatalog", () => {
  test("reads the manga array from an object", () => {
    const out = parseCatalog(
      {
        version: 1,
        manga: [{ id: 1, title: "A" }],
      },
      log,
    );
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe(1);
  });

  test("accepts a bare array", () => {
    const out = parseCatalog([{ id: 5, title: "B" }], log);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe(5);
  });

  test("accepts a JSON string and returns [] on bad JSON", () => {
    expect(
      parseCatalog('{"version":1,"manga":[{"id":1,"title":"A"}]}', log),
    ).toEqual([{ id: 1, title: "A" }]);
    expect(parseCatalog("not json", log)).toEqual([]);
  });

  test("skips entries with no valid id", () => {
    const out = parseCatalog(
      [
        { id: 0, title: "zero" },
        { id: -1, title: "neg" },
        { title: "noid" },
        { id: 2, title: "ok" },
      ],
      log,
    );
    expect(out.map((e) => e.id)).toEqual([2]);
  });

  test("skips entries with no resolvable title", () => {
    const out = parseCatalog(
      [{ id: 1 }, { id: 2, title: "" }, { id: 3, title: { english: "x" } }],
      log,
    );
    expect(out.map((e) => e.id)).toEqual([3]);
  });

  test("dedupes by id, last wins", () => {
    const out = parseCatalog(
      [
        { id: 1, title: "first" },
        { id: 1, title: "second" },
      ],
      log,
    );
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("second");
  });

  test("coerces a numeric-string id to a number", () => {
    const out = parseCatalog([{ id: "5", title: "S" }], log);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe(5);
  });

  test("survives null / non-object array items", () => {
    const out = parseCatalog([null, 5, "x", { id: 1, title: "ok" }], log);
    expect(out.map((e) => e.id)).toEqual([1]);
  });

  test("returns empty for garbage parsed input", () => {
    expect(parseCatalog(null, log)).toEqual([]);
    expect(parseCatalog(42, log)).toEqual([]);
    expect(parseCatalog({}, log)).toEqual([]);
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

describe("mergeCatalog", () => {
  test("disjoint ids: both sides survive, sorted by id", () => {
    const out = mergeCatalog(
      [{ id: 1, title: "local-1" }],
      [{ id: 2, title: "remote-2" }],
    );
    expect(out).toEqual([
      { id: 1, title: "local-1" },
      { id: 2, title: "remote-2" },
    ]);
  });

  test("conflict on same id: local wins (tie-break)", () => {
    const out = mergeCatalog(
      [{ id: 1, title: "local-version" }],
      [{ id: 1, title: "remote-version" }],
    );
    expect(out).toEqual([{ id: 1, title: "local-version" }]);
  });

  test("empty local: returns remote (sorted)", () => {
    const out = mergeCatalog(
      [],
      [
        { id: 5, title: "e" },
        { id: 1, title: "a" },
      ],
    );
    expect(out.map((e) => e.id)).toEqual([1, 5]);
  });

  test("empty remote: returns local (sorted)", () => {
    const out = mergeCatalog([{ id: 3, title: "c" }], []);
    expect(out).toEqual([{ id: 3, title: "c" }]);
  });

  test("both empty: empty array", () => {
    expect(mergeCatalog([], [])).toEqual([]);
  });

  test("mixed: disjoint + conflict, local wins ties", () => {
    const out = mergeCatalog(
      [
        { id: 1, title: "local-1" },
        { id: 2, title: "local-2" },
      ],
      [
        { id: 2, title: "remote-2" },
        { id: 3, title: "remote-3" },
      ],
    );
    expect(out).toEqual([
      { id: 1, title: "local-1" },
      { id: 2, title: "local-2" },
      { id: 3, title: "remote-3" },
    ]);
  });
});

describe("diffCatalog", () => {
  test("counts localOnly / remoteOnly / conflicts", () => {
    const out = diffCatalog(
      [
        { id: 1, title: "a" },
        { id: 2, title: "b" },
      ],
      [
        { id: 2, title: "b" },
        { id: 3, title: "c" },
      ],
    );
    expect(out).toEqual({ localOnly: 1, remoteOnly: 1, conflicts: 1 });
  });

  test("identical lists: only conflicts", () => {
    const out = diffCatalog([{ id: 1, title: "a" }], [{ id: 1, title: "a" }]);
    expect(out).toEqual({ localOnly: 0, remoteOnly: 0, conflicts: 1 });
  });

  test("disjoint lists: no conflicts", () => {
    const out = diffCatalog([{ id: 1, title: "a" }], [{ id: 2, title: "b" }]);
    expect(out).toEqual({ localOnly: 1, remoteOnly: 1, conflicts: 0 });
  });

  test("empty / empty: all zero", () => {
    expect(diffCatalog([], [])).toEqual({
      localOnly: 0,
      remoteOnly: 0,
      conflicts: 0,
    });
  });
});
