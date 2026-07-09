import { describe, expect, test } from "bun:test";
import { parseGistId } from "./gist-parse.ts";

describe("parseGistId", () => {
  test("accepts bare hex id", () => {
    expect(parseGistId("abc123def")).toBe("abc123def");
  });

  test("parses gist.github.com share URL", () => {
    expect(parseGistId("https://gist.github.com/user/abc123def456")).toBe(
      "abc123def456",
    );
  });

  test("returns null for empty input", () => {
    expect(parseGistId("")).toBeNull();
    expect(parseGistId("   ")).toBeNull();
  });
});
