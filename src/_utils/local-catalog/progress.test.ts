import { describe, expect, test } from "bun:test";
import {
  decodeLocalId,
  mergeProgress,
  parseProgress,
  progressMangaEquals,
  serializeProgress,
} from "./progress.ts";

describe("decodeLocalId", () => {
  test("decodes the worked example from CLAUDE.md (TBATE)", () => {
    // mediaId 609192324283839 → localId 60735012287 (MU series_id)
    expect(decodeLocalId(609192324283839)).toBe(60735012287);
  });

  test("decodes a minimal example (extId 0, localId 1)", () => {
    // mediaId = 0x80000000 + (0 << 40) + 1 = 2147483649
    expect(decodeLocalId(2147483649)).toBe(1);
  });

  test("decodes localId = 0 (offset itself, extId 0)", () => {
    expect(decodeLocalId(0x80000000)).toBe(0);
  });
});

const EMPTY_DOC = { version: 1, updatedAt: 0, manga: {} };

describe("parseProgress", () => {
  test("returns empty doc for empty string / null / bad JSON", () => {
    expect(parseProgress("")).toEqual(EMPTY_DOC);
    expect(parseProgress(null)).toEqual(EMPTY_DOC);
    expect(parseProgress("not json")).toEqual(EMPTY_DOC);
  });

  test("parses a valid doc with manga entries", () => {
    const out = parseProgress({
      version: 1,
      updatedAt: 1000,
      manga: {
        "42": { status: "CURRENT", progress: 10, updatedAt: 1000 },
      },
    });
    expect(out.version).toBe(1);
    expect(out.updatedAt).toBe(1000);
    expect(out.manga["42"]).toEqual({
      status: "CURRENT",
      progress: 10,
      updatedAt: 1000,
    });
  });

  test("parses from a JSON string", () => {
    expect(parseProgress('{"version":1,"updatedAt":5,"manga":{}}')).toEqual({
      version: 1,
      updatedAt: 5,
      manga: {},
    });
  });

  test("missing `manga` field → empty manga map", () => {
    expect(parseProgress({ version: 1, updatedAt: 1 })).toEqual({
      version: 1,
      updatedAt: 1,
      manga: {},
    });
  });

  test("entry missing updatedAt → treated as 0 (warned)", () => {
    const out = parseProgress({
      version: 1,
      updatedAt: 0,
      manga: { "1": { progress: 5 } },
    });
    expect(out.manga["1"].updatedAt).toBe(0);
    expect(out.manga["1"].progress).toBe(5);
  });

  test("version mismatch → keep entries, warn", () => {
    const out = parseProgress({
      version: 99,
      updatedAt: 1,
      manga: { "1": { progress: 1, updatedAt: 1 } },
    });
    expect(Object.keys(out.manga)).toEqual(["1"]);
  });

  test("legacy `entries` field migrates to `manga` on read", () => {
    // V2-B initial wire format used `entries`. Old gist files / $storage
    // payloads should be readable so existing installs don't lose data.
    const out = parseProgress({
      version: 1,
      updatedAt: 7,
      entries: { "1": { progress: 5, updatedAt: 7 } },
    });
    expect(out.manga["1"]).toEqual({ progress: 5, updatedAt: 7 });
  });

  test("if both `manga` and `entries` are present, `manga` wins", () => {
    const out = parseProgress({
      version: 1,
      updatedAt: 0,
      manga: { "1": { progress: 99, updatedAt: 1 } },
      entries: { "1": { progress: 1, updatedAt: 1 } },
    });
    expect(out.manga["1"].progress).toBe(99);
  });
});

describe("serializeProgress", () => {
  test("serializes to a JSON string with version, updatedAt, manga", () => {
    const doc: ProgressDoc = {
      version: 1,
      updatedAt: 123,
      manga: {
        "1": { progress: 5, updatedAt: 123 },
      },
    };
    const s = serializeProgress(doc);
    const parsed = JSON.parse(s);
    expect(parsed.version).toBe(1);
    expect(parsed.updatedAt).toBe(123);
    expect(parsed.manga["1"]).toEqual({ progress: 5, updatedAt: 123 });
  });

  test("round-trip: parse(serialize(doc)) === doc", () => {
    const doc: ProgressDoc = {
      version: 1,
      updatedAt: 999,
      manga: {
        "1": { status: "CURRENT", progress: 10, scoreRaw: 850, updatedAt: 1 },
        "2": { updatedAt: 2 },
      },
    };
    expect(parseProgress(serializeProgress(doc))).toEqual(doc);
  });

  test("output is byte-stable across key-order permutations", () => {
    // Same values, deliberately distinct insertion order — must produce
    // byte-identical JSON. Reproduces the symptom of $storage's Go-map
    // round-trip producing a different key order each time, which caused
    // every push to create a new gist revision.
    const a: ProgressDoc = {
      version: 1,
      updatedAt: 100,
      manga: {
        "2": {
          progress: 166,
          scoreRaw: 0,
          status: "CURRENT",
          updatedAt: 200,
        },
        "1": {
          progress: 227,
          scoreRaw: 0,
          status: "CURRENT",
          updatedAt: 50,
        },
      },
    };
    const b: ProgressDoc = {
      version: 1,
      updatedAt: 100,
      manga: {
        "1": {
          updatedAt: 50,
          status: "CURRENT",
          scoreRaw: 0,
          progress: 227,
        },
        "2": {
          status: "CURRENT",
          updatedAt: 200,
          progress: 166,
          scoreRaw: 0,
        },
      },
    };
    expect(serializeProgress(a)).toBe(serializeProgress(b));
  });

  test("manga entries serialized in numeric localId order, not lexicographic", () => {
    const doc: ProgressDoc = {
      version: 1,
      updatedAt: 0,
      manga: {
        "10": { updatedAt: 1 },
        "2": { updatedAt: 2 },
        "1": { updatedAt: 3 },
      },
    };
    const s = serializeProgress(doc);
    // "1" comes before "2" which comes before "10" by NUMERIC sort
    const i1 = s.indexOf('"1":');
    const i2 = s.indexOf('"2":');
    const i10 = s.indexOf('"10":');
    expect(i1).toBeLessThan(i2);
    expect(i2).toBeLessThan(i10);
  });
});

const makeDoc = (
  manga: Record<string, ProgressEntry>,
  updatedAt = 0,
): ProgressDoc => ({ version: 1, updatedAt, manga });

describe("mergeProgress", () => {
  test("local-only entry survives", () => {
    const local = makeDoc({ "1": { progress: 5, updatedAt: 10 } });
    const remote = makeDoc({});
    const out = mergeProgress(local, remote);
    expect(out.manga["1"]).toEqual({ progress: 5, updatedAt: 10 });
  });

  test("remote-only entry comes through", () => {
    const local = makeDoc({});
    const remote = makeDoc({ "1": { progress: 7, updatedAt: 20 } });
    const out = mergeProgress(local, remote);
    expect(out.manga["1"]).toEqual({ progress: 7, updatedAt: 20 });
  });

  test("local newer wins", () => {
    const local = makeDoc({ "1": { progress: 9, updatedAt: 30 } });
    const remote = makeDoc({ "1": { progress: 3, updatedAt: 10 } });
    const out = mergeProgress(local, remote);
    expect(out.manga["1"].progress).toBe(9);
  });

  test("remote newer wins", () => {
    const local = makeDoc({ "1": { progress: 9, updatedAt: 10 } });
    const remote = makeDoc({ "1": { progress: 3, updatedAt: 30 } });
    const out = mergeProgress(local, remote);
    expect(out.manga["1"].progress).toBe(3);
  });

  test("tie goes to local", () => {
    const local = makeDoc({ "1": { progress: 9, updatedAt: 10 } });
    const remote = makeDoc({ "1": { progress: 3, updatedAt: 10 } });
    const out = mergeProgress(local, remote);
    expect(out.manga["1"].progress).toBe(9);
  });

  test("merge is symmetric except for tie rule", () => {
    const a = makeDoc({
      "1": { progress: 1, updatedAt: 30 },
      "2": { progress: 2, updatedAt: 10 },
    });
    const b = makeDoc({
      "1": { progress: 11, updatedAt: 10 },
      "2": { progress: 22, updatedAt: 30 },
    });
    const m1 = mergeProgress(a, b);
    const m2 = mergeProgress(b, a);
    expect(m1.manga["1"].progress).toBe(1);
    expect(m1.manga["2"].progress).toBe(22);
    expect(m2.manga["1"].progress).toBe(1);
    expect(m2.manga["2"].progress).toBe(22);
  });
});

describe("progressMangaEquals", () => {
  test("identical maps → true", () => {
    const a = {
      "1": { progress: 165, scoreRaw: 0, status: "CURRENT", updatedAt: 100 },
    } as Record<string, ProgressEntry>;
    const b = {
      "1": { status: "CURRENT", updatedAt: 100, progress: 165, scoreRaw: 0 },
    } as Record<string, ProgressEntry>;
    // key order differs but values match
    expect(progressMangaEquals(a, b)).toBe(true);
  });

  test("differing progress → false", () => {
    const a = { "1": { progress: 165, updatedAt: 100 } } as Record<
      string,
      ProgressEntry
    >;
    const b = { "1": { progress: 166, updatedAt: 100 } } as Record<
      string,
      ProgressEntry
    >;
    expect(progressMangaEquals(a, b)).toBe(false);
  });

  test("differing updatedAt → false", () => {
    const a = { "1": { progress: 165, updatedAt: 100 } } as Record<
      string,
      ProgressEntry
    >;
    const b = { "1": { progress: 165, updatedAt: 200 } } as Record<
      string,
      ProgressEntry
    >;
    expect(progressMangaEquals(a, b)).toBe(false);
  });

  test("extra entry on one side → false", () => {
    const a = { "1": { progress: 1, updatedAt: 1 } } as Record<
      string,
      ProgressEntry
    >;
    const b = {
      "1": { progress: 1, updatedAt: 1 },
      "2": { progress: 2, updatedAt: 2 },
    } as Record<string, ProgressEntry>;
    expect(progressMangaEquals(a, b)).toBe(false);
  });

  test("scoreRaw=0 equivalent to undefined", () => {
    const a = { "1": { progress: 1, scoreRaw: 0, updatedAt: 1 } } as Record<
      string,
      ProgressEntry
    >;
    const b = { "1": { progress: 1, updatedAt: 1 } } as Record<
      string,
      ProgressEntry
    >;
    expect(progressMangaEquals(a, b)).toBe(true);
  });

  test("empty maps → true", () => {
    expect(progressMangaEquals({}, {})).toBe(true);
  });
});
