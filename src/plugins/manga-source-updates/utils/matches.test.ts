import { describe, expect, test } from "bun:test";
import {
  type ManualMatch,
  resolveMatchAction,
  shouldWarnMatch,
  tombstoneMatch,
  upsertMatch,
} from "./matches";

describe("resolveMatchAction", () => {
  const live: ManualMatch = { mappedId: "abc", by: "A", updatedAt: 1 };
  const dead: ManualMatch = {
    mappedId: "abc",
    by: "A",
    updatedAt: 1,
    deletedAt: 2,
  };

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
  test('"empty", live existing → tombstone', () => {
    expect(resolveMatchAction("empty", live)).toEqual({ type: "tombstone" });
  });
  test('"none", no existing → none (do not write an empty tombstone)', () => {
    expect(resolveMatchAction("none", undefined)).toEqual({ type: "none" });
  });
  test('"none", already-tombstoned existing → none', () => {
    expect(resolveMatchAction("none", dead)).toEqual({ type: "none" });
  });
});

describe("upsertMatch", () => {
  test("sets a record and clears any prior tombstone", () => {
    const start = {
      "1": { asura: { mappedId: "x", by: "A", updatedAt: 1, deletedAt: 9 } },
    };
    const out = upsertMatch(start, 1, "asura", "y", "A", 100);
    expect(out["1"].asura).toEqual({
      mappedId: "y",
      by: "A",
      updatedAt: 100,
    });
    // input not mutated
    expect(start["1"].asura.mappedId).toBe("x");
  });
});

describe("tombstoneMatch", () => {
  test("stamps deletedAt when the record exists", () => {
    const start = { "1": { asura: { mappedId: "x", by: "A", updatedAt: 1 } } };
    const out = tombstoneMatch(start, 1, "asura", 100);
    expect(out["1"].asura.deletedAt).toBe(100);
    expect(out["1"].asura.updatedAt).toBe(100);
  });
  test("no-op when the record is absent", () => {
    expect(tombstoneMatch({}, 1, "asura", 100)).toEqual({ "1": {} });
  });
});

describe("shouldWarnMatch", () => {
  const rec: ManualMatch = { mappedId: "x", by: "A", updatedAt: 1 };
  test("warns when authored on another instance", () => {
    expect(shouldWarnMatch(rec, "B")).toBe(true);
  });
  test("no warning on the authoring instance", () => {
    expect(shouldWarnMatch(rec, "A")).toBe(false);
  });
  test("no warning for a tombstoned or missing record", () => {
    expect(shouldWarnMatch({ ...rec, deletedAt: 5 }, "B")).toBe(false);
    expect(shouldWarnMatch(undefined, "B")).toBe(false);
  });
});
