import { describe, expect, test } from "bun:test";
import { classify, isBadKind, isNoMatchError } from "./classify";

describe("classify", () => {
  const gap = 10;

  test("fetch error wins over everything else", () => {
    expect(classify(5, 100, 50, true, gap)).toBe("error-found");
  });

  test("empty container is not-matched", () => {
    expect(classify(0, 0, 0, false, gap)).toBe("not-matched");
  });

  test("read far ahead of latest is outdated", () => {
    expect(classify(50, 10, 20, false, gap)).toBe("outdated");
  });

  test("unread chapters → new", () => {
    expect(classify(10, 15.5, 5, false, gap)).toBe("new");
  });

  test("caught up → up-to-date (floors fractional gap)", () => {
    expect(classify(10, 10.9, 5, false, gap)).toBe("up-to-date");
  });
});

describe("isBadKind", () => {
  test("auto-exclude kinds", () => {
    expect(isBadKind("not-matched")).toBe(true);
    expect(isBadKind("error-found")).toBe(true);
    expect(isBadKind("outdated")).toBe(true);
  });

  test("good kinds", () => {
    expect(isBadKind("new")).toBe(false);
    expect(isBadKind("up-to-date")).toBe(false);
    expect(isBadKind("all-excluded")).toBe(false);
  });
});

describe("isNoMatchError", () => {
  test("no-match messages → true", () => {
    for (const m of [
      "no results found",
      "manga not found",
      "no chapters available",
      "couldn't find manga",
      "could not find manga",
      "no search results",
      "0 results",
    ]) {
      expect(isNoMatchError(m)).toBe(true);
    }
  });

  test("genuine fetch errors → false", () => {
    for (const m of [
      "dial tcp: connection refused",
      "context deadline exceeded",
      "unexpected status 503",
      "EOF",
      "invalid character '<' looking for beginning of value",
    ]) {
      expect(isNoMatchError(m)).toBe(false);
    }
  });
});
