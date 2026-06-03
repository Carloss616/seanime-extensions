import { describe, expect, test } from "bun:test";
import { type PillIntent, pill } from "./pill.ts";

type FakeNode = {
  kind: string;
  arg?: unknown;
  opts?: { style?: Record<string, string> };
};
function fakeTray() {
  return {
    span: (arg: unknown, opts: unknown): FakeNode => ({
      kind: "span",
      arg,
      opts: opts as { style?: Record<string, string> },
    }),
  };
}

// pill() returns the (opaque) Tray.span type; the fake records a FakeNode, so
// cast back for assertions.
const mkPill = (label: string, intent?: PillIntent): FakeNode =>
  pill(fakeTray() as unknown as $ui.Tray, label, intent) as unknown as FakeNode;

describe("pill", () => {
  test("renders a span with the given label", () => {
    const node = mkPill("releasing", "success");
    expect(node.kind).toBe("span");
    expect(node.arg).toBe("releasing");
  });

  test("maps each intent to its palette colors", () => {
    const success = mkPill("x", "success");
    expect(success.opts?.style?.background).toBe("rgba(80,200,120,0.15)");
    expect(success.opts?.style?.color).toBe("rgba(140,220,160,1)");

    const warning = mkPill("x", "warning");
    expect(warning.opts?.style?.background).toBe("rgba(255,200,0,0.15)");
  });

  test("defaults to the gray intent when none is given", () => {
    const node = mkPill("x");
    expect(node.opts?.style?.background).toBe("rgba(255,255,255,0.06)");
    expect(node.opts?.style?.color).toBe("rgba(255,255,255,0.6)");
  });

  test("uses the pill style envelope (rounded, small, padded)", () => {
    const node = mkPill("x", "info");
    expect(node.opts?.style?.borderRadius).toBe("10px");
    expect(node.opts?.style?.fontSize).toBe("0.7rem");
    expect(node.opts?.style?.padding).toBe("2px 8px");
  });
});
