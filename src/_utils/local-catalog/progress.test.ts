import { describe, expect, test } from "bun:test";
import {
  mergeProgress,
  parseProgress,
  progressMangaEquals,
  serializeProgress,
} from "./progress.ts";

// The mediaId codec (decodeLocalId/encodeMediaId/…) is tested in
// src/_utils/custom-source-id.test.ts.

const EMPTY_DOC = { version: 1, updatedAt: 0, manga: {}, anime: {} };

// parseProgress takes a Console for warnings (version mismatch, missing
// updatedAt). These tests assert on parse output, not logging, so route it to
// a silent stub to keep test output clean.
const log = {
  log() {},
  info() {},
  warn() {},
  error() {},
  debug() {},
} as unknown as Console;

describe("parseProgress", () => {
  test("returns empty doc for empty string / null / bad JSON", () => {
    expect(parseProgress("", log)).toEqual(EMPTY_DOC);
    expect(parseProgress(null, log)).toEqual(EMPTY_DOC);
    expect(parseProgress("not json", log)).toEqual(EMPTY_DOC);
  });

  test("empty-doc returns are fresh (not aliased to a shared singleton)", () => {
    const a = parseProgress("", log);
    a.manga["1"] = { updatedAt: 1 };
    const b = parseProgress("", log);
    expect(Object.keys(b.manga)).toEqual([]);
  });

  test("parses a valid doc with manga entries", () => {
    const out = parseProgress(
      {
        version: 1,
        updatedAt: 1000,
        manga: {
          "42": { status: "CURRENT", progress: 10, updatedAt: 1000 },
        },
      },
      log,
    );
    expect(out.version).toBe(1);
    expect(out.updatedAt).toBe(1000);
    expect(out.manga["42"]).toEqual({
      status: "CURRENT",
      progress: 10,
      updatedAt: 1000,
    });
  });

  test("parses the anime namespace symmetrically", () => {
    const out = parseProgress(
      {
        version: 1,
        updatedAt: 1,
        anime: { "7": { status: "COMPLETED", progress: 24, updatedAt: 9 } },
      },
      log,
    );
    expect(out.anime["7"]).toEqual({
      status: "COMPLETED",
      progress: 24,
      updatedAt: 9,
    });
    expect(out.manga).toEqual({});
  });

  test("spread-preserves unknown/forward-compat entry fields", () => {
    const out = parseProgress(
      {
        version: 1,
        updatedAt: 0,
        manga: { "1": { progress: 3, futureField: "x", updatedAt: 5 } },
      },
      log,
    );
    expect(
      (out.manga["1"] as unknown as Record<string, unknown>).futureField,
    ).toBe("x");
  });

  test("migrates legacy `scoreRaw` → `score` and drops the stale key", () => {
    const out = parseProgress(
      {
        version: 1,
        updatedAt: 0,
        manga: { "1": { progress: 3, scoreRaw: 80, updatedAt: 5 } },
      },
      log,
    );
    expect(out.manga["1"].score).toBe(80);
    expect(
      (out.manga["1"] as unknown as Record<string, unknown>).scoreRaw,
    ).toBeUndefined();
  });

  test("legacy migration: existing `score` wins over `scoreRaw`", () => {
    const out = parseProgress(
      {
        version: 1,
        updatedAt: 0,
        manga: { "1": { score: 90, scoreRaw: 80, updatedAt: 5 } },
      },
      log,
    );
    expect(out.manga["1"].score).toBe(90);
    expect(
      (out.manga["1"] as unknown as Record<string, unknown>).scoreRaw,
    ).toBeUndefined();
  });

  test("parses from a JSON string", () => {
    expect(
      parseProgress('{"version":1,"updatedAt":5,"manga":{}}', log),
    ).toEqual({
      version: 1,
      updatedAt: 5,
      manga: {},
      anime: {},
    });
  });

  test("missing `manga` field → empty manga map", () => {
    expect(parseProgress({ version: 1, updatedAt: 1 }, log)).toEqual({
      version: 1,
      updatedAt: 1,
      manga: {},
      anime: {},
    });
  });

  test("entry missing updatedAt → treated as 0 (warned)", () => {
    const out = parseProgress(
      {
        version: 1,
        updatedAt: 0,
        manga: { "1": { progress: 5 } },
      },
      log,
    );
    expect(out.manga["1"].updatedAt).toBe(0);
    expect(out.manga["1"].progress).toBe(5);
  });

  test("version mismatch → keep entries, warn", () => {
    const out = parseProgress(
      {
        version: 99,
        updatedAt: 1,
        manga: { "1": { progress: 1, updatedAt: 1 } },
      },
      log,
    );
    expect(Object.keys(out.manga)).toEqual(["1"]);
  });
});

describe("serializeProgress", () => {
  test("serializes to a JSON string with version, updatedAt, manga, anime", () => {
    const doc: LocalProgress = {
      version: 1,
      updatedAt: 123,
      manga: {
        "1": { progress: 5, updatedAt: 123 },
      },
      anime: {},
    };
    const s = serializeProgress(doc);
    const parsed = JSON.parse(s);
    expect(parsed.version).toBe(1);
    expect(parsed.updatedAt).toBe(123);
    expect(parsed.manga["1"]).toEqual({ progress: 5, updatedAt: 123 });
    expect(parsed.anime).toEqual({});
  });

  test("round-trip: parse(serialize(doc)) === doc", () => {
    const doc: LocalProgress = {
      version: 1,
      updatedAt: 999,
      manga: {
        "1": { status: "CURRENT", progress: 10, score: 850, updatedAt: 1 },
        "2": { updatedAt: 2 },
      },
      anime: {},
    };
    expect(parseProgress(serializeProgress(doc), log)).toEqual(doc);
  });

  test("round-trips repeat / startedAt / completedAt and anime entries", () => {
    const doc: LocalProgress = {
      version: 1,
      updatedAt: 1,
      manga: {
        "1": {
          status: "COMPLETED",
          progress: 12,
          score: 700,
          repeat: 2,
          startedAt: "2024-01-01",
          completedAt: "2024-02-01",
          updatedAt: 5,
        },
      },
      anime: {
        "9": { status: "CURRENT", progress: 3, updatedAt: 8 },
      },
    };
    expect(parseProgress(serializeProgress(doc), log)).toEqual(doc);
  });

  test("output is byte-stable across key-order permutations", () => {
    // Same values, deliberately distinct insertion order — must produce
    // byte-identical JSON. Reproduces the symptom of $storage's Go-map
    // round-trip producing a different key order each time, which caused
    // every push to create a new gist revision.
    const a: LocalProgress = {
      version: 1,
      updatedAt: 100,
      manga: {
        "2": { progress: 166, score: 0, status: "CURRENT", updatedAt: 200 },
        "1": { progress: 227, score: 0, status: "CURRENT", updatedAt: 50 },
      },
      anime: {},
    };
    const b: LocalProgress = {
      version: 1,
      updatedAt: 100,
      manga: {
        "1": { updatedAt: 50, status: "CURRENT", score: 0, progress: 227 },
        "2": { status: "CURRENT", updatedAt: 200, progress: 166, score: 0 },
      },
      anime: {},
    };
    expect(serializeProgress(a)).toBe(serializeProgress(b));
  });

  test("manga entries serialized in numeric localId order, not lexicographic", () => {
    const doc: LocalProgress = {
      version: 1,
      updatedAt: 0,
      manga: {
        "10": { updatedAt: 1 },
        "2": { updatedAt: 2 },
        "1": { updatedAt: 3 },
      },
      anime: {},
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
  manga: Record<string, MangaProgressEntry>,
  updatedAt = 0,
): LocalProgress => ({ version: 1, updatedAt, manga, anime: {} });

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

  test("merges the anime namespace with the same LWW rule", () => {
    const local: LocalProgress = {
      version: 1,
      updatedAt: 0,
      manga: {},
      anime: { "5": { progress: 1, updatedAt: 30 } },
    };
    const remote: LocalProgress = {
      version: 1,
      updatedAt: 0,
      manga: {},
      anime: {
        "5": { progress: 9, updatedAt: 10 },
        "6": { progress: 2, updatedAt: 5 },
      },
    };
    const out = mergeProgress(local, remote);
    expect(out.anime["5"].progress).toBe(1); // local newer
    expect(out.anime["6"].progress).toBe(2); // remote-only
  });

  test("tolerates docs missing the anime namespace", () => {
    const local = { version: 1, updatedAt: 0, manga: {} } as LocalProgress;
    const remote = { version: 1, updatedAt: 0, manga: {} } as LocalProgress;
    const out = mergeProgress(local, remote);
    expect(out.anime).toEqual({});
  });
});

describe("progressMangaEquals", () => {
  test("identical maps → true", () => {
    const a = {
      "1": { progress: 165, score: 0, status: "CURRENT", updatedAt: 100 },
    } as Record<string, MangaProgressEntry>;
    const b = {
      "1": { status: "CURRENT", updatedAt: 100, progress: 165, score: 0 },
    } as Record<string, MangaProgressEntry>;
    // key order differs but values match
    expect(progressMangaEquals(a, b)).toBe(true);
  });

  test("differing progress → false", () => {
    const a = { "1": { progress: 165, updatedAt: 100 } } as Record<
      string,
      MangaProgressEntry
    >;
    const b = { "1": { progress: 166, updatedAt: 100 } } as Record<
      string,
      MangaProgressEntry
    >;
    expect(progressMangaEquals(a, b)).toBe(false);
  });

  test("differing updatedAt → false", () => {
    const a = { "1": { progress: 165, updatedAt: 100 } } as Record<
      string,
      MangaProgressEntry
    >;
    const b = { "1": { progress: 165, updatedAt: 200 } } as Record<
      string,
      MangaProgressEntry
    >;
    expect(progressMangaEquals(a, b)).toBe(false);
  });

  test("extra entry on one side → false", () => {
    const a = { "1": { progress: 1, updatedAt: 1 } } as Record<
      string,
      MangaProgressEntry
    >;
    const b = {
      "1": { progress: 1, updatedAt: 1 },
      "2": { progress: 2, updatedAt: 2 },
    } as Record<string, MangaProgressEntry>;
    expect(progressMangaEquals(a, b)).toBe(false);
  });

  test("score=0 equivalent to undefined", () => {
    const a = { "1": { progress: 1, score: 0, updatedAt: 1 } } as Record<
      string,
      MangaProgressEntry
    >;
    const b = { "1": { progress: 1, updatedAt: 1 } } as Record<
      string,
      MangaProgressEntry
    >;
    expect(progressMangaEquals(a, b)).toBe(true);
  });

  test("empty maps → true", () => {
    expect(progressMangaEquals({}, {})).toBe(true);
  });
});
