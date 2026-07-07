import { describe, expect, test } from "bun:test";
import { type EntryListConfig, entryList } from "./entry-list.ts";

// Minimal fake `tray`: every builder records a tagged node so the test can
// walk the returned tree. `img` takes a single opts arg; everything else is
// (childrenOrArg, opts).
type FakeNode = {
  kind: string;
  children?: unknown[];
  arg?: unknown;
  opts?: Record<string, unknown>;
};
function fakeTray() {
  const mk =
    (kind: string) =>
    (a?: unknown, b?: unknown): FakeNode =>
      Array.isArray(a)
        ? { kind, children: a, opts: b as Record<string, unknown> }
        : { kind, arg: a, opts: b as Record<string, unknown> };
  return {
    div: mk("div"),
    flex: mk("flex"),
    stack: mk("stack"),
    text: mk("text"),
    span: mk("span"),
    badge: mk("badge"),
    input: mk("input"),
    button: mk("button"),
    a: mk("a"),
    img: (opts: unknown): FakeNode => ({
      kind: "img",
      opts: opts as Record<string, unknown>,
    }),
    tooltip: (child: unknown, opts: unknown): FakeNode => ({
      kind: "tooltip",
      children: [child],
      opts: opts as Record<string, unknown>,
    }),
  };
}

function walk(node: unknown, acc: FakeNode[] = []): FakeNode[] {
  if (node == null) return acc;
  if (Array.isArray(node)) {
    for (const n of node) walk(n, acc);
    return acc;
  }
  if (typeof node === "object") {
    const n = node as FakeNode;
    acc.push(n);
    if (Array.isArray(n.children)) for (const c of n.children) walk(c, acc);
  }
  return acc;
}
const argsOf = (nodes: FakeNode[], kind: string) =>
  nodes.filter((n) => n.kind === kind).map((n) => n.arg);

const baseCfg: EntryListConfig = {
  headerLabel: "LINKED",
  searchFieldRef: {} as $ui.FieldRef<string>,
  searchPlaceholder: "Filter…",
  onSearch: "do-search",
  onClearSearch: "clear-search",
  emptyText: "Nothing here yet.",
  noMatchText: 'No match for "x".',
  rows: [],
  totalCount: 0,
  searchActive: false,
};

describe("entryList — header & search", () => {
  test("header shows total count when no filter is active", () => {
    const out = entryList(fakeTray() as unknown as $ui.Tray, {
      ...baseCfg,
      rows: [{ title: "A" }, { title: "B" }, { title: "C" }],
      totalCount: 3,
      searchActive: false,
    });
    expect(argsOf(walk(out), "text")).toContain("LINKED (3)");
  });

  test("header shows filtered / total when a filter is active", () => {
    const out = entryList(fakeTray() as unknown as $ui.Tray, {
      ...baseCfg,
      rows: [{ title: "A" }],
      totalCount: 3,
      searchActive: true,
    });
    expect(argsOf(walk(out), "text")).toContain("LINKED (1 / 3)");
  });

  test("never emits its own divider — header flex is the first child", () => {
    // Dividers are now page-stack siblings emitted by the caller (joinDividers),
    // so the section itself contains no leading rule.
    const out = entryList(fakeTray() as unknown as $ui.Tray, {
      ...baseCfg,
      rows: [{ title: "A" }],
      totalCount: 1,
      searchActive: false,
    }) as FakeNode;
    expect(out.kind).toBe("stack");
    expect((out.children as FakeNode[])[0].kind).toBe("flex");
    expect(
      walk(out).some(
        (n) =>
          n.kind === "div" &&
          (n.opts?.style as Record<string, string> | undefined)?.borderTop !==
            undefined,
      ),
    ).toBe(false);
  });

  test("passes inlineActions nodes into the output", () => {
    const act = { kind: "sentinel-inline" };
    const out = entryList(fakeTray() as unknown as $ui.Tray, {
      ...baseCfg,
      rows: [{ title: "A" }],
      totalCount: 1,
      searchActive: false,
      inlineActions: [act],
    });
    expect(walk(out).some((n) => n.kind === "sentinel-inline")).toBe(true);
  });

  test("renders the search row with a Clear button only when active", () => {
    const inactive = walk(
      entryList(fakeTray() as unknown as $ui.Tray, {
        ...baseCfg,
        rows: [{ title: "A" }],
        totalCount: 1,
        searchActive: false,
      }),
    );
    expect(inactive.some((n) => n.kind === "input")).toBe(true);
    expect(inactive.some((n) => n.kind === "button" && n.arg === "✕")).toBe(
      false,
    );

    const active = walk(
      entryList(fakeTray() as unknown as $ui.Tray, {
        ...baseCfg,
        rows: [{ title: "A" }],
        totalCount: 1,
        searchActive: true,
      }),
    );
    expect(active.some((n) => n.kind === "button" && n.arg === "✕")).toBe(true);
  });

  test("hides the search row when showSearchRow is false", () => {
    const out = entryList(fakeTray() as unknown as $ui.Tray, {
      ...baseCfg,
      rows: [{ title: "A" }],
      totalCount: 1,
      searchActive: false,
      showSearchRow: false,
    });
    expect(walk(out).some((n) => n.kind === "input")).toBe(false);
  });
});

describe("entryList — placeholders", () => {
  test("shows emptyText and no rows when totalCount is 0", () => {
    const out = entryList(fakeTray() as unknown as $ui.Tray, {
      ...baseCfg,
      rows: [],
      totalCount: 0,
      searchActive: false,
    });
    const t = argsOf(walk(out), "text");
    expect(t).toContain("Nothing here yet.");
    expect(t).not.toContain("A");
  });

  test("shows noMatchText only when the filter removed every row", () => {
    const matched = entryList(fakeTray() as unknown as $ui.Tray, {
      ...baseCfg,
      rows: [],
      totalCount: 5,
      searchActive: true,
    });
    expect(argsOf(walk(matched), "text")).toContain('No match for "x".');

    // rows empty + not searching → render nothing (no noMatch placeholder).
    const idle = entryList(fakeTray() as unknown as $ui.Tray, {
      ...baseCfg,
      rows: [],
      totalCount: 5,
      searchActive: false,
    });
    expect(argsOf(walk(idle), "text")).not.toContain('No match for "x".');
  });
});

describe("entryList — opinionated rows", () => {
  test("renders title, year, status pill, and chapter when present", () => {
    const out = entryList(fakeTray() as unknown as $ui.Tray, {
      ...baseCfg,
      rows: [
        {
          title: "Berserk",
          year: 2018,
          status: { label: "releasing", intent: "success" },
          chapter: 227,
        },
      ],
      totalCount: 1,
      searchActive: false,
    });
    const spans = argsOf(walk(out), "span");
    expect(argsOf(walk(out), "text")).toContain("Berserk");
    expect(spans).toContain("2018");
    expect(argsOf(walk(out), "badge")).toContain("releasing"); // status badge
    expect(spans).toContain("c.227");
  });

  test("status badge carries the intent", () => {
    const out = entryList(fakeTray() as unknown as $ui.Tray, {
      ...baseCfg,
      rows: [{ title: "A", status: { label: "auto", intent: "warning" } }],
      totalCount: 1,
      searchActive: false,
    });
    const badgeNode = walk(out).find(
      (n) => n.kind === "badge" && n.arg === "auto",
    );
    expect(
      (badgeNode?.opts as Record<string, unknown> | undefined)?.intent,
    ).toBe("warning");
  });

  test("renders Open ↗ external link (with tooltip) and Open → in-place button", () => {
    const out = entryList(fakeTray() as unknown as $ui.Tray, {
      ...baseCfg,
      rows: [
        {
          title: "A",
          openExternal: { href: "https://x/y", tooltip: "View on X" },
          openInPlace: { onClick: "open-a", tooltip: "Open in seanime" },
        },
      ],
      totalCount: 1,
      searchActive: false,
    });
    const nodes = walk(out);
    const anchor = nodes.find((n) => n.kind === "a");
    expect((anchor?.opts as Record<string, unknown> | undefined)?.href).toBe(
      "https://x/y",
    );
    expect(argsOf(nodes, "span")).toContain("Open ↗");
    const openBtn = nodes.find(
      (n) => n.kind === "button" && n.arg === "Open →",
    );
    expect(
      (openBtn?.opts as Record<string, unknown> | undefined)?.onClick,
    ).toBe("open-a");
    expect(
      nodes.some(
        (n) =>
          n.kind === "tooltip" &&
          (n.opts as Record<string, unknown> | undefined)?.text === "View on X",
      ),
    ).toBe(true);
  });

  test("omits absent fields and dot-separates only present segments", () => {
    // year + status + chapter = 3 segments → 2 dot separators.
    const out = entryList(fakeTray() as unknown as $ui.Tray, {
      ...baseCfg,
      rows: [
        {
          title: "A",
          year: 2020,
          status: { label: "finished", intent: "info" },
          chapter: 10,
        },
      ],
      totalCount: 1,
      searchActive: false,
    });
    const dots = walk(out).filter((n) => n.kind === "span" && n.arg === "·");
    expect(dots.length).toBe(2);
  });

  test("a bare row (only title) renders no sub-line segments", () => {
    const out = entryList(fakeTray() as unknown as $ui.Tray, {
      ...baseCfg,
      rows: [{ title: "Solo" }],
      totalCount: 1,
      searchActive: false,
    });
    const nodes = walk(out);
    expect(argsOf(nodes, "text")).toContain("Solo");
    expect(nodes.some((n) => n.kind === "span" && n.arg === "·")).toBe(false);
  });

  test("passes through trailing actions and applies row.opacity", () => {
    const action = { kind: "sentinel-action" };
    const out = entryList(fakeTray() as unknown as $ui.Tray, {
      ...baseCfg,
      rows: [{ title: "A", actions: [action], opacity: 0.5 }],
      totalCount: 1,
      searchActive: false,
    });
    const nodes = walk(out);
    expect(nodes.some((n) => n.kind === "sentinel-action")).toBe(true);
    const rowNode = nodes.find(
      (n) =>
        n.kind === "flex" &&
        (n.opts?.style as Record<string, unknown> | undefined)?.background ===
          "rgba(255,255,255,0.02)",
    );
    expect((rowNode?.opts?.style as Record<string, unknown>).opacity).toBe(
      "0.5",
    );
  });

  test("uses an img cover when provided, initials avatar otherwise", () => {
    const withCover = walk(
      entryList(fakeTray() as unknown as $ui.Tray, {
        ...baseCfg,
        rows: [{ title: "A", cover: "http://x/y.png" }],
        totalCount: 1,
        searchActive: false,
      }),
    );
    expect(withCover.some((n) => n.kind === "img")).toBe(true);

    const noCover = walk(
      entryList(fakeTray() as unknown as $ui.Tray, {
        ...baseCfg,
        rows: [{ title: "MangaDex" }],
        totalCount: 1,
        searchActive: false,
      }),
    );
    expect(noCover.some((n) => n.kind === "img")).toBe(false);
    const avatarFlex = noCover.find(
      (n) =>
        n.kind === "flex" &&
        (n.opts?.style as Record<string, unknown> | undefined)?.width ===
          "44px",
    );
    expect(avatarFlex).toBeDefined();
    const avatarText = walk(avatarFlex).find(
      (n) => n.kind === "text" && n.arg === "MA",
    );
    expect(avatarText).toBeDefined();
  });
});
