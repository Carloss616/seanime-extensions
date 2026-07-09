import { describe, expect, test } from "bun:test";
import { ent, formatListStatus, formatTs } from "./format";

describe("formatTs", () => {
  test("zero returns em dash", () => {
    expect(formatTs(0)).toBe("—");
  });

  test("formats local datetime", () => {
    const ms = new Date(2024, 0, 15, 9, 5).getTime();
    expect(formatTs(ms)).toBe("2024-01-15 09:05");
  });
});

describe("formatListStatus", () => {
  test("empty becomes em dash", () => {
    expect(formatListStatus(undefined)).toBe("—");
  });

  test("underscores to words", () => {
    expect(formatListStatus("CURRENTLY_PUBLISHING")).toBe(
      "currently publishing",
    );
  });
});

describe("ent", () => {
  test("singular", () => {
    expect(ent(1)).toBe("1 entry");
  });

  test("plural", () => {
    expect(ent(3)).toBe("3 entries");
  });
});
