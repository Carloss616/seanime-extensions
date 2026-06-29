import { trayHeader } from "../../../_components/tray-header";

// Tray UI that overrides the column count of seanime's media library grids
// (manga + anime), per screen-size scope. seanime fixes columns per breakpoint
// via Tailwind grid-cols-* classes on the grid container; we read the live
// viewport width (ctx.dom.viewport, synchronous) and set an inline
// grid-template-columns matching the active scope. Inline beats the class rule
// on specificity (inline > class) — no !important, no <style>/@media needed,
// and it re-applies on resize so each width tier shows its own column count.
// A toggle restores seanime's native layout by removing our inline style.
export const register = (ctx: $ui.Context) => {
  const K_COLS = "columnsByScope";
  const K_USE_DEFAULT = "useSeanimeDefault";
  const ABS_MIN = 1;
  const ABS_MAX = 12;

  // Ordered by min width ascending. A scope applies when viewport >= its min
  // (and below the next scope's min).
  const SCOPES = [
    { key: "mobile", label: "Mobile", min: 0 },
    { key: "tablet", label: "Tablet", min: 768 },
    { key: "laptop", label: "Laptop", min: 1280 },
    { key: "desktop", label: "Desktop", min: 1920 },
  ];
  const DEFAULTS: Record<string, number> = {
    mobile: 4,
    tablet: 6,
    laptop: 8,
    desktop: 12,
  };

  // seanime renders small libraries (<=48 items) with [data-media-card-grid]
  // and larger ones with the virtualized [data-media-card-lazy-grid] — both
  // carry the grid-cols-* classes we override, so target both.
  const SELECTOR = "[data-media-card-grid], [data-media-card-lazy-grid]";

  // Force a valid, monotonic config: each value clamped to [ABS_MIN, ABS_MAX]
  // and never below a smaller screen's value (columns only grow with width).
  const sanitize = (raw: unknown): Record<string, number> => {
    const src = (raw ?? {}) as Record<string, unknown>;
    const cfg: Record<string, number> = {};
    let floor = ABS_MIN;
    for (const s of SCOPES) {
      let v = Number(src[s.key] ?? DEFAULTS[s.key]);
      if (!Number.isFinite(v)) v = DEFAULTS[s.key];
      v = Math.max(ABS_MIN, Math.min(ABS_MAX, Math.round(v)));
      v = Math.max(floor, v);
      cfg[s.key] = v;
      floor = v;
    }
    return cfg;
  };

  const colsByScope = ctx.state<Record<string, number>>(
    sanitize($storage.get<Record<string, number>>(K_COLS)),
  );
  const useDefault = ctx.state<boolean>(
    $storage.get<boolean>(K_USE_DEFAULT) ?? false,
  );

  const scopeForWidth = (w: number) => {
    let chosen = SCOPES[0];
    for (const s of SCOPES) if (w >= s.min) chosen = s;
    return chosen;
  };

  // Skip redundant DOM writes when a resize doesn't cross a breakpoint.
  let lastValue = "";

  const applyToGrids = (
    grids: $ui.DOMElement[],
    cfg: Record<string, number>,
  ) => {
    // Toggle on → hand the grids back to seanime by dropping our inline style.
    if (useDefault.get()) {
      lastValue = "__default__";
      for (const g of grids) g.removeStyle("grid-template-columns");
      return;
    }
    const w = ctx.dom.viewport.getSize().width;
    const n = cfg[scopeForWidth(w).key];
    const value = `repeat(${n}, minmax(0, 1fr))`;
    lastValue = value;
    for (const g of grids) {
      g.setStyle("grid-template-columns", value);
    }
  };

  // Must `await` ctx.dom.query: it's a Go-bound API that is awaitable but has
  // no `.then()` (calling it throws).
  const reapply = async () => {
    const grids = await ctx.dom.query(SELECTOR);
    applyToGrids(grids, colsByScope.get());
  };

  // The $ui.register callback runs in a single runtime, so closing over
  // `colsByScope`/`useDefault` in these handlers is safe (unlike $app hooks).
  ctx.dom.observe(SELECTOR, (grids) => {
    applyToGrids(grids, colsByScope.get());
  });
  // Fresh page load gives a new main tab; re-apply against the new DOM.
  ctx.dom.onMainTabReady(() => {
    reapply();
  });
  // Resize: only touch the DOM when the active breakpoint actually changes.
  ctx.dom.viewport.onResize((size) => {
    if (useDefault.get()) return;
    const n = colsByScope.get()[scopeForWidth(size.width).key];
    if (`repeat(${n}, minmax(0, 1fr))` === lastValue) return;
    reapply();
  });

  // Step a scope's columns by delta, kept monotonic: a scope can't drop below
  // a smaller screen's value, nor exceed a larger screen's value.
  const setScope = async (key: string, delta: number) => {
    const idx = SCOPES.findIndex((s) => s.key === key);
    const cfg = { ...colsByScope.get() };
    const lower = idx > 0 ? cfg[SCOPES[idx - 1].key] : ABS_MIN;
    const upper = idx < SCOPES.length - 1 ? cfg[SCOPES[idx + 1].key] : ABS_MAX;
    const next = Math.max(lower, Math.min(upper, cfg[key] + delta));
    if (next === cfg[key]) return;
    cfg[key] = next;
    colsByScope.set(cfg);
    $storage.set(K_COLS, cfg);
    const grids = await ctx.dom.query(SELECTOR);
    applyToGrids(grids, cfg);
  };

  // Controlled switch: flip the authoritative state on each toggle (reading
  // fieldRef.current here would be stale by one event and invert the behavior).
  ctx.registerEventHandler("lgl-toggle-default", () => {
    const v = !useDefault.get();
    useDefault.set(v);
    $storage.set(K_USE_DEFAULT, v);
    reapply();
  });

  ctx.registerEventHandler("lgl-reset", async () => {
    const cfg = sanitize(DEFAULTS);
    colsByScope.set(cfg);
    $storage.set(K_COLS, cfg);
    const grids = await ctx.dom.query(SELECTOR);
    applyToGrids(grids, cfg);
  });

  const tray = ctx.newTray({ iconUrl: __MANIFEST_ICON__, withContent: true });

  tray.render(() => {
    const usingDefault = useDefault.get();
    const cfg = colsByScope.get();
    const vw = ctx.dom.viewport.getSize().width;
    const active = scopeForWidth(vw);
    const activeN = cfg[active.key];

    const scopeRow = (s: { key: string; label: string; min: number }) => {
      const idx = SCOPES.findIndex((x) => x.key === s.key);
      const lower = idx > 0 ? cfg[SCOPES[idx - 1].key] : ABS_MIN;
      const upper =
        idx < SCOPES.length - 1 ? cfg[SCOPES[idx + 1].key] : ABS_MAX;
      const val = cfg[s.key];
      const isActive = s.key === active.key;
      return tray.flex(
        [
          tray.stack(
            [
              tray.text(s.label, {
                style: { fontWeight: "600", fontSize: "0.9rem" },
              }),
              tray.text(s.min === 0 ? "any width" : `≥ ${s.min}px`, {
                style: { fontSize: "0.68rem", opacity: "0.5" },
              }),
            ],
            { gap: 1 },
          ),
          tray.flex(
            [
              tray.button("−", {
                onClick: ctx.eventHandler(`lgl-${s.key}-dec`, () =>
                  setScope(s.key, -1),
                ),
                size: "sm",
                disabled: val <= lower,
              }),
              tray.text(String(val), {
                style: {
                  fontWeight: "700",
                  fontSize: "1.05rem",
                  minWidth: "2ch",
                  textAlign: "center",
                },
              }),
              tray.button("+", {
                onClick: ctx.eventHandler(`lgl-${s.key}-inc`, () =>
                  setScope(s.key, +1),
                ),
                size: "sm",
                disabled: val >= upper,
              }),
            ],
            { gap: 2, style: { alignItems: "center" } },
          ),
        ],
        {
          style: {
            justifyContent: "space-between",
            alignItems: "center",
            padding: "8px 10px",
            borderRadius: "8px",
            background: isActive ? "rgba(124,58,237,0.18)" : "transparent",
            border: isActive
              ? "1px solid rgba(167,139,250,0.5)"
              : "1px solid rgba(255,255,255,0.06)",
          },
        },
      );
    };

    const items: unknown[] = [
      tray.css(`
        .lgl-monitor { border: 1px solid rgba(255,255,255,0.12); border-radius: 12px; padding: 12px 12px 8px; background: rgba(255,255,255,0.04); }
        .lgl-screen { display: grid; gap: 6px; }
        .lgl-card { aspect-ratio: 3 / 4; border-radius: 5px; background: linear-gradient(160deg, rgba(167,139,250,0.85), rgba(124,58,237,0.85)); box-shadow: 0 1px 2px rgba(0,0,0,0.25); }
        .lgl-caption { margin-top: 8px; font-size: 0.7rem; opacity: 0.55; text-align: center; }
        .lgl-heading { font-size: 0.72rem; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; opacity: 0.55; }
      `),

      tray.switch("Use seanime's default layout", {
        value: usingDefault,
        onChange: "lgl-toggle-default",
        side: "left",
      }),
    ];

    if (usingDefault) {
      items.push(
        tray.alert({
          intent: "info",
          title: "Seanime default layout is active",
          description:
            "The native responsive grid is in control. Turn off the switch above to set your own columns per screen size.",
        }),
      );
    } else {
      const cards: unknown[] = [];
      for (let i = 0; i < activeN; i++)
        cards.push(tray.div([], { className: "lgl-card" }));

      items.push(
        tray.div(
          [
            tray.div(cards, {
              className: "lgl-screen",
              style: { gridTemplateColumns: `repeat(${activeN}, 1fr)` },
            }),
            tray.div(
              [
                tray.text(
                  `Your screen now: ${active.label} (${vw}px) → ${activeN} columns`,
                ),
              ],
              { className: "lgl-caption" },
            ),
          ],
          { className: "lgl-monitor" },
        ),

        // Heading + its scope rows stay grouped (8px); the page gap (16px)
        // separates this group from the surrounding sections.
        tray.stack(
          [
            tray.text("Adjust each size", { className: "lgl-heading" }),
            tray.stack(SCOPES.map(scopeRow), { gap: 2 }),
          ],
          { gap: 2 },
        ),

        tray.flex(
          [
            tray.button("Reset to defaults", {
              onClick: "lgl-reset",
              size: "sm",
              intent: "gray-subtle",
            }),
          ],
          { style: { justifyContent: "center" } },
        ),

        tray.alert({
          intent: "info",
          title: "How it works",
          description:
            "Each screen size uses its own column count, applied as you resize the window. A tier can't have fewer columns than a smaller one, so each control's limits depend on its neighbors.",
        }),
      );
    }

    return tray.stack(
      [
        trayHeader(tray, {
          subtitle: "Columns per screen size",
          right: [
            usingDefault
              ? tray.badge("seanime default", { intent: "gray", size: "md" })
              : tray.badge(`${active.label}: ${activeN}`, {
                  intent: "primary",
                  size: "md",
                }),
          ],
        }),
        ...items,
      ],
      { gap: 4 },
    );
  });
};
