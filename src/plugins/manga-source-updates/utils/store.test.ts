import { describe, expect, test } from "bun:test";
import {
  isLive,
  liveExcludedView,
  livePinnedView,
  mergeProbeTimestamps,
} from "./store";

describe("isLive", () => {
  test("no deletedAt → live", () => {
    expect(isLive({ updatedAt: 1 })).toBe(true);
  });
  test("null deletedAt → live (storage round-trip)", () => {
    expect(isLive({ updatedAt: 1, deletedAt: undefined })).toBe(true);
    expect(isLive({ updatedAt: 1, deletedAt: null } as never)).toBe(true);
  });
  test("deletedAt set → not live", () => {
    expect(isLive({ updatedAt: 1, deletedAt: 5 })).toBe(false);
  });
  test("null/undefined record → not live", () => {
    expect(isLive(null)).toBe(false);
    expect(isLive(undefined)).toBe(false);
  });
});

describe("liveExcludedView", () => {
  test("drops tombstones, unwraps reason", () => {
    const view = liveExcludedView({
      "1": {
        asura: { reason: "outdated", updatedAt: 5 },
        flame: { reason: "other", updatedAt: 5, deletedAt: 9 },
      },
    });
    expect(view["1"]).toEqual({ asura: "outdated" });
  });
});

describe("livePinnedView", () => {
  test("drops tombstoned pins", () => {
    const view = livePinnedView({
      "1": { asura: { updatedAt: 5 }, flame: { updatedAt: 5, deletedAt: 9 } },
    });
    expect(view["1"]).toEqual(["asura"]);
  });
});

describe("mergeProbeTimestamps", () => {
  const base = {
    provider: "asura",
    providerName: "Asura",
    latest: 5,
    count: 5,
    matched: true,
    errored: false,
  };
  test("unchanged probe keeps its old updatedAt", () => {
    const prev = { asura: { ...base, updatedAt: 100 } };
    const next = { asura: { ...base, updatedAt: 0 } };
    const out = mergeProbeTimestamps(prev, next, 999);
    expect(out.asura.updatedAt).toBe(100);
  });
  test("changed probe gets now", () => {
    const prev = { asura: { ...base, updatedAt: 100 } };
    const next = { asura: { ...base, latest: 6, count: 6, updatedAt: 0 } };
    const out = mergeProbeTimestamps(prev, next, 999);
    expect(out.asura.updatedAt).toBe(999);
  });
  test("new probe gets now", () => {
    const out = mergeProbeTimestamps(
      {},
      { asura: { ...base, updatedAt: 0 } },
      999,
    );
    expect(out.asura.updatedAt).toBe(999);
  });
});
