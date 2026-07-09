import { describe, expect, test } from "bun:test";
import {
  applyScopeDelta,
  DEFAULTS,
  sanitizeColumns,
  scopeBounds,
  scopeForWidth,
} from "./scopes";

describe("sanitizeColumns", () => {
  test("fills defaults when raw is empty", () => {
    expect(sanitizeColumns(undefined)).toEqual(DEFAULTS);
  });

  test("enforces monotonicity across scopes", () => {
    expect(
      sanitizeColumns({
        mobile: 8,
        tablet: 4,
        laptop: 6,
        desktop: 10,
      }),
    ).toEqual({
      mobile: 8,
      tablet: 8,
      laptop: 8,
      desktop: 10,
    });
  });

  test("clamps to absolute min and max", () => {
    expect(
      sanitizeColumns({
        mobile: 0,
        tablet: 99,
        laptop: 8,
        desktop: 12,
      }),
    ).toEqual({
      mobile: 1,
      tablet: 12,
      laptop: 12,
      desktop: 12,
    });
  });

  test("replaces non-finite values with defaults", () => {
    expect(
      sanitizeColumns({
        mobile: Number.NaN,
        tablet: "x",
        laptop: 8,
        desktop: 12,
      }),
    ).toEqual({
      mobile: 4,
      tablet: 6,
      laptop: 8,
      desktop: 12,
    });
  });
});

describe("scopeForWidth", () => {
  test("picks mobile below tablet breakpoint", () => {
    expect(scopeForWidth(767).key).toBe("mobile");
  });

  test("picks tablet at 768px", () => {
    expect(scopeForWidth(768).key).toBe("tablet");
  });

  test("picks laptop at 1280px", () => {
    expect(scopeForWidth(1280).key).toBe("laptop");
  });

  test("picks desktop at 1920px", () => {
    expect(scopeForWidth(1920).key).toBe("desktop");
  });
});

describe("scopeBounds", () => {
  test("mobile is bounded by ABS_MIN and tablet value", () => {
    const cfg = { ...DEFAULTS };
    expect(scopeBounds(0, cfg)).toEqual({ lower: 1, upper: 6 });
  });

  test("desktop is bounded by laptop and ABS_MAX", () => {
    const cfg = { ...DEFAULTS };
    expect(scopeBounds(3, cfg)).toEqual({ lower: 8, upper: 12 });
  });
});

describe("applyScopeDelta", () => {
  test("increments within neighbor bounds", () => {
    const cfg = { ...DEFAULTS };
    expect(applyScopeDelta(cfg, "tablet", 1)).toEqual({
      ...cfg,
      tablet: 7,
    });
  });

  test("returns null at lower bound", () => {
    const cfg = { mobile: 1, tablet: 4, laptop: 8, desktop: 12 };
    expect(applyScopeDelta(cfg, "mobile", -1)).toBeNull();
  });

  test("returns null when blocked by smaller scope", () => {
    const cfg = { mobile: 4, tablet: 4, laptop: 8, desktop: 12 };
    expect(applyScopeDelta(cfg, "tablet", -1)).toBeNull();
  });

  test("returns null at upper bound", () => {
    const cfg = { mobile: 4, tablet: 6, laptop: 8, desktop: 12 };
    expect(applyScopeDelta(cfg, "desktop", 1)).toBeNull();
  });
});
