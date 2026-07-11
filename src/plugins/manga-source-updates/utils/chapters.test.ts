import { describe, expect, test } from "bun:test";
import { latestChapter, makeProbe, unreadChapters } from "./chapters";

function ch(n: number): $app.HibikeManga_ChapterDetails {
  return { chapter: String(n) } as $app.HibikeManga_ChapterDetails;
}

describe("latestChapter", () => {
  test("picks the max numeric chapter", () => {
    expect(latestChapter([ch(1), ch(12.5), ch(9)])).toBe(12.5);
  });

  test("empty list → 0", () => {
    expect(latestChapter([])).toBe(0);
  });
});

describe("unreadChapters", () => {
  test("floors the gap between latest and read", () => {
    expect(unreadChapters(10, 15.9)).toBe(5);
  });

  test("never negative", () => {
    expect(unreadChapters(20, 10)).toBe(0);
  });
});

describe("makeProbe", () => {
  test("null chapters → errored, unmatched", () => {
    expect(makeProbe("p1", "Provider", null)).toEqual({
      provider: "p1",
      providerName: "Provider",
      latest: 0,
      count: 0,
      matched: false,
      errored: true,
      updatedAt: 0,
    });
  });

  test("empty array → matched false, not errored", () => {
    const p = makeProbe("p1", "Provider", []);
    expect(p.errored).toBe(false);
    expect(p.matched).toBe(false);
    expect(p.count).toBe(0);
  });

  test("coerces Go-wrapped providerName", () => {
    const p = makeProbe("p1", { toString: () => "Name" } as unknown as string, [
      ch(3),
    ]);
    expect(p.providerName).toBe("Name");
    expect(p.latest).toBe(3);
    expect(p.matched).toBe(true);
  });
});
