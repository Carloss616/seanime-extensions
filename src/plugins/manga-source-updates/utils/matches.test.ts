import { describe, expect, test } from "bun:test";
import {
  liveLocalMatchPairs,
  type ManualMatch,
  type MatchMap,
  matchDivergence,
  resolveMatchAction,
  tombstoneMatch,
  upsertMatch,
} from "./matches";

describe("resolveMatchAction", () => {
  const live: ManualMatch = { mappedId: "abc", updatedAt: 1 };
  const dead: ManualMatch = { mappedId: "abc", updatedAt: 1, deletedAt: 2 };

  test("concrete id, no existing → upsert", () => {
    expect(resolveMatchAction("abc", undefined)).toEqual({
      type: "upsert",
      mappedId: "abc",
    });
  });
  test("concrete id, live existing with SAME id → none (idempotent, no churn)", () => {
    expect(resolveMatchAction("abc", live)).toEqual({ type: "none" });
  });
  test("concrete id, live existing with DIFFERENT id → upsert", () => {
    expect(resolveMatchAction("xyz", live)).toEqual({
      type: "upsert",
      mappedId: "xyz",
    });
  });
  test("concrete id, tombstoned existing → upsert (re-match)", () => {
    expect(resolveMatchAction("abc", dead)).toEqual({
      type: "upsert",
      mappedId: "abc",
    });
  });
  test('"present" (unparseable id) → upsert with empty mappedId', () => {
    expect(resolveMatchAction("present", undefined)).toEqual({
      type: "upsert",
      mappedId: "",
    });
  });
  test('"none", live existing → tombstone', () => {
    expect(resolveMatchAction("none", live)).toEqual({ type: "tombstone" });
  });
  test('"none", no existing → none (do not write an empty tombstone)', () => {
    expect(resolveMatchAction("none", undefined)).toEqual({ type: "none" });
  });
  test('"none", already-tombstoned existing → none', () => {
    expect(resolveMatchAction("none", dead)).toEqual({ type: "none" });
  });
});

describe("upsertMatch (3-level, per instance)", () => {
  test("writes only this instance's leaf and clears its prior tombstone", () => {
    const start: MatchMap = {
      "1": {
        asura: {
          A: { mappedId: "x", updatedAt: 1, deletedAt: 9 },
          B: { mappedId: "z", updatedAt: 1 },
        },
      },
    };
    const out = upsertMatch(start, 1, "asura", "A", "y", 100);
    expect(out["1"].asura.A).toEqual({ mappedId: "y", updatedAt: 100 });
    // B's leaf untouched
    expect(out["1"].asura.B).toEqual({ mappedId: "z", updatedAt: 1 });
    // input not mutated
    expect(start["1"].asura.A.mappedId).toBe("x");
  });
});

describe("tombstoneMatch (3-level, per instance)", () => {
  test("stamps deletedAt on this instance's leaf only", () => {
    const start: MatchMap = {
      "1": {
        asura: {
          A: { mappedId: "x", updatedAt: 1 },
          B: { mappedId: "x", updatedAt: 1 },
        },
      },
    };
    const out = tombstoneMatch(start, 1, "asura", "A", 100);
    expect(out["1"].asura.A.deletedAt).toBe(100);
    expect(out["1"].asura.A.updatedAt).toBe(100);
    expect(out["1"].asura.B.deletedAt).toBeUndefined();
  });
  test("no-op when this instance never recorded", () => {
    expect(tombstoneMatch({}, 1, "asura", "A", 100)).toEqual({
      "1": { asura: {} },
    });
  });
});

describe("matchDivergence", () => {
  test("undefined / single instance / all-agree → no divergence", () => {
    expect(matchDivergence(undefined)).toEqual({ diverges: false, reason: "" });
    expect(matchDivergence({ A: { mappedId: "x", updatedAt: 1 } })).toEqual({
      diverges: false,
      reason: "",
    });
    expect(
      matchDivergence({
        A: { mappedId: "x", updatedAt: 1 },
        B: { mappedId: "x", updatedAt: 2 },
      }),
    ).toEqual({ diverges: false, reason: "" });
  });

  test("two live ids that differ → different", () => {
    expect(
      matchDivergence({
        A: { mappedId: "x", updatedAt: 1 },
        B: { mappedId: "y", updatedAt: 1 },
      }),
    ).toEqual({ diverges: true, reason: "different" });
  });

  test("one live + one removed → missing", () => {
    expect(
      matchDivergence({
        A: { mappedId: "x", updatedAt: 1 },
        B: { mappedId: "x", updatedAt: 1, deletedAt: 5 },
      }),
    ).toEqual({ diverges: true, reason: "missing" });
  });

  test("all removed → no divergence (they agree on 'no match')", () => {
    expect(
      matchDivergence({
        A: { mappedId: "x", updatedAt: 1, deletedAt: 5 },
        B: { mappedId: "y", updatedAt: 1, deletedAt: 6 },
      }),
    ).toEqual({ diverges: false, reason: "" });
  });

  test("unparsed 'present' matches agree with each other", () => {
    expect(
      matchDivergence({
        A: { mappedId: "", updatedAt: 1 },
        B: { mappedId: "", updatedAt: 2 },
      }),
    ).toEqual({ diverges: false, reason: "" });
  });
});

describe("liveLocalMatchPairs", () => {
  test("only THIS instance's live leaves, keyed mediaId\\0provider", () => {
    const map: MatchMap = {
      "1": {
        asura: { A: { mappedId: "x", updatedAt: 1 } }, // A live → included
        comick: { A: { mappedId: "y", updatedAt: 1, deletedAt: 2 } }, // A removed
      },
      "2": {
        mangadex: { B: { mappedId: "z", updatedAt: 1 } }, // other instance → no
      },
    };
    expect(liveLocalMatchPairs(map, "A")).toEqual(new Set(["1\0asura"]));
  });

  test("empty map → empty set", () => {
    expect(liveLocalMatchPairs({}, "A").size).toBe(0);
  });
});
