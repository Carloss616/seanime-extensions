import { divider } from "../../../_components/divider";
import { CAPTION_STYLE, LABEL_STYLE } from "../../../_components/text";
import { trayHeader } from "../../../_components/tray-header";
import {
  applyScopeDelta,
  DEFAULTS,
  GRID_SELECTOR,
  type GridScope,
  K_COLS,
  K_USE_DEFAULT,
  SCOPES,
  sanitizeColumns,
  scopeBounds,
  scopeForWidth,
} from "../utils/scopes";

export const register = (ctx: $ui.Context) => {
  const colsByScope = ctx.state<Record<string, number>>(
    sanitizeColumns($storage.get<Record<string, number>>(K_COLS)),
  );
  const useDefault = ctx.state<boolean>(
    $storage.get<boolean>(K_USE_DEFAULT) ?? false,
  );

  let lastValue = "";

  const applyToGrids = (
    grids: $ui.DOMElement[],
    cfg: Record<string, number>,
  ) => {
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

  const paint = async (cfg: Record<string, number>) => {
    applyToGrids(await ctx.dom.query(GRID_SELECTOR), cfg);
  };

  const reapply = async () => {
    await paint(colsByScope.get());
  };

  ctx.dom.observe(GRID_SELECTOR, (grids) => {
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

  const setScope = async (key: string, delta: number) => {
    const cfg = applyScopeDelta(colsByScope.get(), key, delta);
    if (!cfg) return;
    colsByScope.set(cfg);
    $storage.set(K_COLS, cfg);
    await paint(cfg);
  };

  ctx.registerEventHandler("lgl-toggle-default", () => {
    const v = !useDefault.get();
    useDefault.set(v);
    $storage.set(K_USE_DEFAULT, v);
    reapply();
  });

  ctx.registerEventHandler("lgl-reset", async () => {
    const cfg = sanitizeColumns(DEFAULTS);
    colsByScope.set(cfg);
    $storage.set(K_COLS, cfg);
    await paint(cfg);
  });

  const tray = ctx.newTray({ iconUrl: __MANIFEST_ICON__, withContent: true });

  tray.render(() => {
    const usingDefault = useDefault.get();
    const cfg = colsByScope.get();
    const vw = ctx.dom.viewport.getSize().width;
    const active = scopeForWidth(vw);
    const activeN = cfg[active.key];

    const scopeRow = (s: GridScope) => {
      const idx = SCOPES.findIndex((x) => x.key === s.key);
      const { lower, upper } = scopeBounds(idx, cfg);
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
                style: CAPTION_STYLE,
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
            padding: "8px 12px",
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
        .lgl-monitor { display: flex; flex-direction: column; gap: 8px; border: 1px solid rgba(255,255,255,0.12); border-radius: 12px; padding: 12px 12px 8px; background: rgba(255,255,255,0.04); }
        .lgl-screen { display: grid; gap: 4px; }
        .lgl-card { aspect-ratio: 3 / 4; border-radius: 5px; background: linear-gradient(160deg, rgba(167,139,250,0.85), rgba(124,58,237,0.85)); box-shadow: 0 1px 2px rgba(0,0,0,0.25); }
        .lgl-caption { font-size: 0.7rem; opacity: 0.55; text-align: center; }
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

        tray.stack(
          [
            tray.text("Adjust each size", { style: LABEL_STYLE }),
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
        divider(tray),
        ...items,
      ],
      { gap: 3 },
    );
  });
};
