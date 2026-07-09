import { describe, expect, test } from "bun:test";
import { detectImportKind } from "./import-detect";

describe("detectImportKind", () => {
  test("bare array is catalog", () => {
    expect(detectImportKind('[{"id":1}]')).toBe("catalog");
  });

  test("manga array wrapper is catalog", () => {
    expect(
      detectImportKind('{"version":1,"manga":[{"id":1}],"updatedAt":0}'),
    ).toBe("catalog");
  });

  test("manga object map is progress", () => {
    expect(
      detectImportKind('{"version":1,"manga":{"1":{"status":"CURRENT"}}}'),
    ).toBe("progress");
  });

  test("legacy entries key is progress", () => {
    expect(detectImportKind('{"entries":{"1":{}}}')).toBe("progress");
  });

  test("invalid JSON", () => {
    expect(detectImportKind("{not json")).toBe("invalid");
  });

  test("unrecognized object", () => {
    expect(detectImportKind('{"foo":1}')).toBe("invalid");
  });
});
