import { describe, expect, test } from "bun:test";
import { deriveInstanceId } from "./instance";

describe("deriveInstanceId", () => {
  test("returns existing non-empty id unchanged", () => {
    expect(deriveInstanceId("abc-123", 999, 0.5)).toBe("abc-123");
  });
  test("mints an id when none exists", () => {
    const id = deriveInstanceId(null, 1000, 0.5);
    expect(id.startsWith("1000-")).toBe(true);
    expect(id.length).toBeGreaterThan("1000-".length);
  });
  test("empty / non-string existing → mints", () => {
    expect(deriveInstanceId("", 1000, 0.5).startsWith("1000-")).toBe(true);
    expect(deriveInstanceId(42 as never, 1000, 0.5).startsWith("1000-")).toBe(
      true,
    );
  });
});
