import { describe, expect, test } from "bun:test";
import { mangaTitles, pickBestMatch } from "./match";
import type { MUResult } from "./mu-client";

const r = (id: string, title: string): MUResult => ({ id, title, url: "" });

// goja exposes $scannerUtils; bun doesn't. Stub it with a Dice-coefficient matcher.
const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .trim()
    .split(/\s+/);
// biome-ignore lint/suspicious/noExplicitAny: test-only global stub
(globalThis as any).$scannerUtils = {
  compareTitles(a: string, b: string) {
    const A = new Set(norm(a));
    const B = new Set(norm(b));
    const inter = [...A].filter((w) => B.has(w)).length;
    return (2 * inter) / (A.size + B.size);
  },
};

describe("pickBestMatch", () => {
  test("picks the highest-scoring result, not the first", () => {
    const results = [
      r("1", "Completely Unrelated Series"),
      r("2", "Kimetsu no Yaiba"),
    ];
    expect(pickBestMatch(["Kimetsu no Yaiba"], results, 0.8)?.id).toBe("2");
  });

  test("rejects when nothing clears the threshold", () => {
    const results = [r("1", "Some Other Manga"), r("2", "A Different Thing")];
    expect(pickBestMatch(["Kimetsu no Yaiba"], results, 0.8)).toBeUndefined();
  });

  test("matches via any of the candidate titles (synonyms)", () => {
    const results = [r("9", "Demon Slayer Kimetsu no Yaiba")];
    // english title alone is a weak match; the romaji synonym carries it.
    const titles = ["Demon Slayer", "Demon Slayer Kimetsu no Yaiba"];
    expect(pickBestMatch(titles, results, 0.8)?.id).toBe("9");
  });

  test("empty inputs -> undefined", () => {
    expect(pickBestMatch([], [r("1", "x")], 0.8)).toBeUndefined();
    expect(pickBestMatch(["x"], [], 0.8)).toBeUndefined();
  });
});

describe("mangaTitles", () => {
  test("collects english/romaji/userPreferred + synonyms, de-duped & trimmed", () => {
    const manga = {
      title: {
        english: "Demon Slayer",
        romaji: "Kimetsu no Yaiba",
        userPreferred: "Demon Slayer",
      },
      synonyms: ["KnY", " Demon Slayer "],
    } as unknown as $app.AL_BaseManga;
    expect(mangaTitles(manga)).toEqual([
      "Demon Slayer",
      "Kimetsu no Yaiba",
      "KnY",
    ]);
  });

  test("undefined manga -> empty", () => {
    expect(mangaTitles(undefined)).toEqual([]);
  });
});
