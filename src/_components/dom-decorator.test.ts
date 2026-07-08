import { describe, expect, test } from "bun:test";
import { decideDecoration } from "./dom-decorator";

describe("decideDecoration", () => {
  test("no existing marker → rebuild", () => {
    expect(decideDecoration([], "a:1")).toBe("rebuild");
  });

  test("exactly one marker with the desired sig → skip (no mutation, no loop)", () => {
    expect(decideDecoration(["a:1"], "a:1")).toBe("skip");
  });

  test("one marker with a stale sig → rebuild", () => {
    expect(decideDecoration(["a:0"], "a:1")).toBe("rebuild");
  });

  test("duplicates (even with the right sig) → rebuild (self-heal a race)", () => {
    expect(decideDecoration(["a:1", "a:1"], "a:1")).toBe("rebuild");
    expect(decideDecoration(["a:1", "a:0"], "a:1")).toBe("rebuild");
  });

  test("empty-state sig round-trips like any other (hidden marker stays put)", () => {
    expect(decideDecoration(["x:none"], "x:none")).toBe("skip");
    expect(decideDecoration([], "x:none")).toBe("rebuild");
  });
});
