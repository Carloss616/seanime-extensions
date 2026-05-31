import { describe, expect, test } from "bun:test";
import { type AlertIntent, alertBox } from "./alert-box.ts";

type FakeNode = {
  kind: string;
  children?: unknown[];
  opts?: { style?: Record<string, string> };
};
function fakeTray() {
  return {
    div: (children: unknown, opts: unknown): FakeNode => ({
      kind: "div",
      children: children as unknown[],
      opts: opts as { style?: Record<string, string> },
    }),
  };
}

// alertBox() returns the (opaque) Tray.div type; the fake records a FakeNode,
// so cast back for assertions.
const mkAlert = (children: unknown[], intent?: AlertIntent): FakeNode =>
  alertBox(
    fakeTray() as unknown as Tray,
    children,
    intent ? { intent } : {},
  ) as unknown as FakeNode;

describe("alertBox", () => {
  test("wraps the children in a div", () => {
    const child = { kind: "text" };
    const node = mkAlert([child]);
    expect(node.kind).toBe("div");
    expect(node.children).toEqual([child]);
  });

  test("defaults to the warning intent (thick border, warning bg)", () => {
    const node = mkAlert([]);
    expect(node.opts?.style?.background).toBe("rgba(255,180,0,0.08)");
    expect(node.opts?.style?.borderLeft).toBe("3px solid rgba(255,180,0,0.7)");
    expect(node.opts?.style?.padding).toBe("10px 12px");
  });

  test("note intent uses the subtler palette", () => {
    const node = mkAlert([], "note");
    expect(node.opts?.style?.background).toBe("rgba(255,255,255,0.04)");
    expect(node.opts?.style?.borderLeft).toBe("2px solid rgba(255,180,0,0.5)");
    expect(node.opts?.style?.padding).toBe("8px 10px");
  });
});
