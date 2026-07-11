import { describe, expect, test } from "bun:test";
import { clearedExclusions } from "./exclusions";

describe("clearedExclusions", () => {
  const excluded = {
    "1": { asura: { reason: "not-matched" as const, updatedAt: 10 } },
    "2": { mangadex: { reason: "error-found" as const, updatedAt: 10 } },
  };
  const pinned = {
    "1": { asura: { updatedAt: 10 } },
    "2": { mangadex: { updatedAt: 10 } },
  };
  const now = 999;

  test("no mediaId → tombstones every live record", () => {
    const next = clearedExclusions(excluded, pinned, undefined, now);
    expect(next.excluded["1"].asura).toEqual({
      reason: "not-matched",
      updatedAt: now,
      deletedAt: now,
    });
    expect(next.excluded["2"].mangadex).toEqual({
      reason: "error-found",
      updatedAt: now,
      deletedAt: now,
    });
    expect(next.pinned["1"].asura).toEqual({ updatedAt: now, deletedAt: now });
    expect(next.pinned["2"].mangadex).toEqual({
      updatedAt: now,
      deletedAt: now,
    });
  });

  test("mediaId → tombstones only that manga, leaves the rest untouched", () => {
    const next = clearedExclusions(excluded, pinned, 1, now);
    expect(next.excluded["1"].asura).toEqual({
      reason: "not-matched",
      updatedAt: now,
      deletedAt: now,
    });
    expect(next.excluded["2"]).toEqual(excluded["2"]);
    expect(next.pinned["1"].asura).toEqual({ updatedAt: now, deletedAt: now });
    expect(next.pinned["2"]).toEqual(pinned["2"]);
  });

  test("does not mutate the inputs", () => {
    clearedExclusions(excluded, pinned, 1, now);
    expect(excluded["1"].asura).toEqual({
      reason: "not-matched",
      updatedAt: 10,
    });
    expect(pinned["1"].asura).toEqual({ updatedAt: 10 });
  });

  test("clearing an absent mediaId is a no-op copy", () => {
    const next = clearedExclusions(excluded, pinned, 999, now);
    expect(next.excluded).toEqual(excluded);
    expect(next.pinned).toEqual(pinned);
  });

  test("an already-tombstoned record is left as-is (its deletedAt doesn't move)", () => {
    const alreadyGone = {
      "1": {
        asura: { reason: "other" as const, updatedAt: 5, deletedAt: 7 },
      },
    };
    const next = clearedExclusions(alreadyGone, {}, 1, now);
    expect(next.excluded["1"].asura).toEqual({
      reason: "other",
      updatedAt: 5,
      deletedAt: 7,
    });
  });
});
