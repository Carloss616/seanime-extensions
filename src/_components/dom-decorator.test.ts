import { describe, expect, test } from "bun:test";
import { createDomDecorator, decideDecoration } from "./dom-decorator";

// Flush the pending microtask chain (the fire-and-forget re-run is a few
// `await` hops deep) without a timer — setTimeout isn't in the project libs.
const tick = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

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

describe("decorate — queued re-run targets the latest element", () => {
  // A fake DOM element with no existing markers (query → []).
  const fakeEl = (id: string) => ({
    id,
    attributes: {} as Record<string, string>,
    query: async () => [] as unknown[],
    getAttribute: async () => null,
    remove: async () => {},
    append: async () => {},
    setStyle: () => {},
    setInnerHTML: () => {},
    setAttribute: () => {},
  });
  const ctx = {
    dom: {
      observe: () => [() => {}],
      onMainTabReady: () => {},
      onReady: () => {},
      createElement: async () => ({ setAttribute: () => {} }),
    },
  };

  // Regression: while a decorate for lockKey "k" is in flight, a second call
  // for the SAME key but a NEW element (virtualized remount) must re-run
  // against that new element, not the first (now-detached) one.
  test("re-run uses the newest (el, opts), not the first caller's", async () => {
    const dec = createDomDecorator(ctx as unknown as $ui.Context);
    const elA = fakeEl("A");
    const elB = fakeEl("B");
    const rendered: string[] = [];
    let openGate: () => void = () => {};
    const gate = new Promise<void>((r) => {
      openGate = r;
    });

    const opts = (el: ReturnType<typeof fakeEl>) => ({
      marker: "m",
      lockKey: "k",
      // First call (A) blocks in sig() to hold the lock open; B resolves at once.
      sig: async () => {
        if (el.id === "A") await gate;
        return "s";
      },
      render: async () => {
        rendered.push(el.id);
      },
    });

    const p1 = dec.decorate(elA as unknown as $ui.DOMElement, opts(elA));
    await tick(); // let A acquire the lock and park on the gate
    await dec.decorate(elB as unknown as $ui.DOMElement, opts(elB)); // queued
    openGate();
    await p1;
    await tick(); // let the queued re-run finish

    expect(rendered).toEqual(["A", "B"]);
  });
});
