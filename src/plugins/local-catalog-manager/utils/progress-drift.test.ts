import { describe, expect, test } from "bun:test";
import { hasEntryProgressDrift } from "./progress-drift";

describe("hasEntryProgressDrift", () => {
  const row: MangaProgressEntry = {
    status: "CURRENT",
    progress: 5,
    score: 80,
    updatedAt: 1,
  };

  test("no row progress is not drift", () => {
    expect(hasEntryProgressDrift(undefined, { status: "CURRENT" }, true)).toBe(
      false,
    );
  });

  test("lookup not ready is drift", () => {
    expect(hasEntryProgressDrift(row, undefined, false)).toBe(true);
  });

  test("missing seanime row is drift", () => {
    expect(hasEntryProgressDrift(row, undefined, true)).toBe(true);
  });

  test("in sync is not drift", () => {
    expect(
      hasEntryProgressDrift(
        row,
        { status: "CURRENT", progress: 5, score: 80 },
        true,
      ),
    ).toBe(false);
  });

  test("status mismatch is drift", () => {
    expect(
      hasEntryProgressDrift(row, { status: "PLANNING", progress: 5 }, true),
    ).toBe(true);
  });
});
