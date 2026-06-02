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

  test("defaults to the warning intent (pill warning palette)", () => {
    const node = mkAlert([]);
    expect(node.opts?.style?.background).toBe("rgba(255,200,0,0.15)");
    expect(node.opts?.style?.borderLeft).toBe("3px solid rgba(255,220,80,1)");
    expect(node.opts?.style?.padding).toBe("10px 12px");
  });

  test("intent colors mirror the pill palette (bg = pill bg, border = pill fg)", () => {
    const info = mkAlert([], "info");
    expect(info.opts?.style?.background).toBe("rgba(120,170,255,0.15)");
    expect(info.opts?.style?.borderLeft).toBe("3px solid rgba(160,200,255,1)");

    expect(mkAlert([], "success").opts?.style?.background).toBe(
      "rgba(80,200,120,0.15)",
    );
    expect(mkAlert([], "alert").opts?.style?.borderLeft).toBe(
      "3px solid rgba(255,150,150,1)",
    );
    expect(mkAlert([], "gray").opts?.style?.background).toBe(
      "rgba(255,255,255,0.06)",
    );
  });
});
