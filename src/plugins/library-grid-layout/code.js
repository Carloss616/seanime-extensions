// src/plugins/library-grid-layout/modules/register.ts
var register = (...args) => {
  var GITHUB_RAW_WORKSPACE =
    "https://raw.githubusercontent.com/Carloss616/seanime-extensions/main";
  var register2 = (ctx) => {
    const K_COLS = "columnsByScope";
    const K_USE_DEFAULT = "useSeanimeDefault";
    const ABS_MIN = 1;
    const ABS_MAX = 12;
    const SCOPES = [
      { key: "mobile", label: "Mobile", min: 0 },
      { key: "tablet", label: "Tablet", min: 768 },
      { key: "laptop", label: "Laptop", min: 1280 },
      { key: "desktop", label: "Desktop", min: 1920 },
    ];
    const DEFAULTS = {
      mobile: 4,
      tablet: 6,
      laptop: 8,
      desktop: 12,
    };
    const SELECTOR = "[data-media-card-grid], [data-media-card-lazy-grid]";
    const sanitize = (raw) => {
      const src = raw ?? {};
      const cfg = {};
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
    const colsByScope = ctx.state(sanitize($storage.get(K_COLS)));
    const useDefault = ctx.state($storage.get(K_USE_DEFAULT) ?? false);
    const scopeForWidth = (w) => {
      let chosen = SCOPES[0];
      for (const s of SCOPES) if (w >= s.min) chosen = s;
      return chosen;
    };
    let lastValue = "";
    const applyToGrids = (grids, cfg) => {
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
    const reapply = async () => {
      const grids = await ctx.dom.query(SELECTOR);
      applyToGrids(grids, colsByScope.get());
    };
    ctx.dom.observe(SELECTOR, (grids) => {
      applyToGrids(grids, colsByScope.get());
    });
    ctx.dom.onMainTabReady(() => {
      reapply();
    });
    ctx.dom.viewport.onResize((size) => {
      if (useDefault.get()) return;
      const n = colsByScope.get()[scopeForWidth(size.width).key];
      if (`repeat(${n}, minmax(0, 1fr))` === lastValue) return;
      reapply();
    });
    const setScope = async (key, delta) => {
      const idx = SCOPES.findIndex((s) => s.key === key);
      const cfg = { ...colsByScope.get() };
      const lower = idx > 0 ? cfg[SCOPES[idx - 1].key] : ABS_MIN;
      const upper =
        idx < SCOPES.length - 1 ? cfg[SCOPES[idx + 1].key] : ABS_MAX;
      const next = Math.max(lower, Math.min(upper, cfg[key] + delta));
      if (next === cfg[key]) return;
      cfg[key] = next;
      colsByScope.set(cfg);
      $storage.set(K_COLS, cfg);
      const grids = await ctx.dom.query(SELECTOR);
      applyToGrids(grids, cfg);
    };
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
    const tray = ctx.newTray({
      iconUrl: `${GITHUB_RAW_WORKSPACE}/src/plugins/library-grid-layout/assets/icon.png`,
      withContent: true,
    });
    tray.render(() => {
      const usingDefault = useDefault.get();
      const cfg = colsByScope.get();
      const vw = ctx.dom.viewport.getSize().width;
      const active = scopeForWidth(vw);
      const activeN = cfg[active.key];
      const scopeRow = (s) => {
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
              { gap: 0 },
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
                    setScope(s.key, 1),
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
      const items = [
        tray.css(`
        .lgl-monitor { border: 1px solid rgba(255,255,255,0.12); border-radius: 12px; padding: 12px 12px 8px; background: rgba(255,255,255,0.04); }
        .lgl-screen { display: grid; gap: 6px; }
        .lgl-card { aspect-ratio: 3 / 4; border-radius: 5px; background: linear-gradient(160deg, rgba(167,139,250,0.85), rgba(124,58,237,0.85)); box-shadow: 0 1px 2px rgba(0,0,0,0.25); }
        .lgl-caption { margin-top: 10px; font-size: 0.7rem; opacity: 0.55; text-align: center; }
        .lgl-heading { font-size: 0.72rem; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; opacity: 0.55; }
      `),
        tray.flex(
          [
            tray.text("Library grid columns", {
              style: { fontWeight: "700", fontSize: "1.05rem" },
            }),
            usingDefault
              ? tray.badge("seanime default", { intent: "gray", size: "md" })
              : tray.badge(`${active.label}: ${activeN}`, {
                  intent: "primary",
                  size: "md",
                }),
          ],
          { style: { justifyContent: "space-between", alignItems: "center" } },
        ),
        tray.text(
          "Cards per row in the manga & anime libraries, per screen size.",
          {
            style: { fontSize: "0.8rem", opacity: "0.6" },
          },
        ),
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
        const cards = [];
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
          tray.text("Adjust each size", { className: "lgl-heading" }),
          tray.stack(SCOPES.map(scopeRow), { gap: 1 }),
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
      return tray.stack(items, { gap: 4 });
    });
  };
  return register2(...args);
};

// src/plugins/library-grid-layout/code.ts
function init() {
  $ui.register(register);
}
