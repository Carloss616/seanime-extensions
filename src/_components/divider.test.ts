import { describe, expect, test } from "bun:test";
import { divider } from "./divider.ts";

type FakeNode = {
  kind: string;
  children?: unknown[];
  opts?: { style?: Record<string, string> };
};
function fakeTray() {
  return {
    div: (children: unknown[], opts: unknown): FakeNode => ({
      kind: "div",
      children,
      opts: opts as { style?: Record<string, string> },
    }),
  };
}
// divider() returns the opaque Tray.div type; the fake records a FakeNode.
const mk = (): FakeNode =>
  divider(fakeTray() as unknown as Tray) as unknown as FakeNode;

describe("divider", () => {
  test("renders an empty div", () => {
    const node = mk();
    expect(node.kind).toBe("div");
    expect(node.children).toEqual([]);
  });

  test("draws a top border as the separator", () => {
    expect(mk().opts?.style?.borderTop).toContain("1px solid");
  });
});
