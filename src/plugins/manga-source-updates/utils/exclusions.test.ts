import { describe, expect, test } from "bun:test";
import { clearedExclusions } from "./exclusions";

describe("clearedExclusions", () => {
  const excluded = {
    "1": { asura: "not-matched" },
    "2": { mangadex: "error-found" },
  };
  const pinned = { "1": ["asura"], "2": ["mangadex"] };

  test("no mediaId → wipes everything", () => {
    const next = clearedExclusions(excluded, pinned);
    expect(next.excluded).toEqual({});
    expect(next.pinned).toEqual({});
  });

  test("mediaId → clears only that manga, leaves the rest", () => {
    const next = clearedExclusions(excluded, pinned, 1);
    expect(next.excluded).toEqual({ "2": { mangadex: "error-found" } });
    expect(next.pinned).toEqual({ "2": ["mangadex"] });
  });

  test("does not mutate the inputs", () => {
    clearedExclusions(excluded, pinned, 1);
    expect(excluded["1"]).toEqual({ asura: "not-matched" });
    expect(pinned["1"]).toEqual(["asura"]);
  });

  test("clearing an absent mediaId is a no-op copy", () => {
    const next = clearedExclusions(excluded, pinned, 999);
    expect(next.excluded).toEqual(excluded);
    expect(next.pinned).toEqual(pinned);
  });
});
