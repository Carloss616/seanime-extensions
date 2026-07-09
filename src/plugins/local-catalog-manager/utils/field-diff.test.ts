import { describe, expect, test } from "bun:test";
import { numericFieldDiff, stringFieldDiff } from "./field-diff";

describe("stringFieldDiff", () => {
  test("undefined local is not drift", () => {
    expect(stringFieldDiff(undefined, "CURRENT")).toBe(false);
  });

  test("coerces goja-like values", () => {
    const goWrapped = { toString: () => "CURRENT" } as unknown as string;
    expect(stringFieldDiff("CURRENT", goWrapped)).toBe(false);
  });

  test("detects mismatch", () => {
    expect(stringFieldDiff("CURRENT", "PLANNING")).toBe(true);
  });
});

describe("numericFieldDiff", () => {
  test("undefined local is not drift", () => {
    expect(numericFieldDiff(undefined, 5)).toBe(false);
  });

  test("coerces string remote", () => {
    expect(numericFieldDiff(10, "10" as unknown as number)).toBe(false);
  });

  test("detects mismatch", () => {
    expect(numericFieldDiff(10, 5)).toBe(true);
  });
});
