// List-item header at the top of a tray modal. Identifies the owning extension
// and merges with the layout plugins already used:
//   [icon?]  Title              [right nodes?]
//            subtitle?
//
// Layout mirrors seanime's own entry headers: a flex-1 left column (icon+title
// row, then the subtitle tucked under the title) that pushes the optional right
// nodes to the far edge — no justify-content gap games.
//
// `title` defaults to the manifest `name`, `iconUrl` to the manifest `icon`
// (both injected at build time as __MANIFEST_NAME__ / __MANIFEST_ICON__).
// `right` takes pre-built nodes (tray.badge / tray.button / …) so the caller
// composes whatever it needs — one slot instead of separate badge/button params.
//
// PURE FUNCTION over `tray` so the build can inline it into serialized goja
// callbacks (see CLAUDE.md "Splitting an extension across multiple files").

export interface TrayHeaderOptions {
  /** Header title. Defaults to the manifest `name`. */
  title?: string;
  /** Secondary line under the title. */
  subtitle?: string;
  /** Left icon image URL (raster — SeaImage blocks .svg). Defaults to the
   *  manifest `icon`; pass an empty string to render no icon. */
  iconUrl?: string;
  /** Right-aligned pre-built nodes: badges, buttons, menus, etc. */
  right?: unknown[];
}

const ICON_PX = 36;
export function trayHeader(
  tray: $ui.Tray,
  opts: TrayHeaderOptions = {},
): unknown {
  const title = opts.title ?? __MANIFEST_NAME__;
  const iconUrl = opts.iconUrl ?? __MANIFEST_ICON__;

  // Title + subtitle stacked; the flex-1 makes this column push the right nodes
  // to the far edge.
  const textCol: unknown[] = [
    tray.text(title, {
      style: {
        fontWeight: "700",
        fontSize: "1.15rem",
        lineHeight: "1.2",
        letterSpacing: "0.01em",
      },
    }),
  ];
  if (opts.subtitle) {
    textCol.push(
      tray.text(opts.subtitle, {
        style: {
          fontSize: "0.8rem",
          lineHeight: "1.3",
          opacity: "0.55",
        },
      }),
    );
  }

  // Icon is a sibling of the text column (not inside the title row) so the flex
  // `alignItems: center` centers it vertically against the whole title+subtitle
  // block, not just the title line.
  const row: unknown[] = [];
  if (iconUrl) {
    row.push(
      tray.img(iconUrl, {
        width: `${ICON_PX}px`,
        height: `${ICON_PX}px`,
        style: { borderRadius: "8px", objectFit: "contain", flexShrink: "0" },
      }),
    );
  }
  row.push(
    // gap: 1 (4px) between title and subtitle.
    tray.stack(textCol, { gap: 1, style: { flex: "1", minWidth: "0" } }),
  );
  if (opts.right?.length) {
    row.push(
      tray.flex(opts.right, {
        gap: 2,
        style: { alignItems: "center", flexShrink: "0" },
      }),
    );
  }

  // paddingBottom 8px sets the gap between the header content and the rule;
  // spacing below the rule comes from the parent stack's gap.
  return tray.div(
    [tray.flex(row, { gap: 3, style: { alignItems: "center" } })],
    {
      style: {
        paddingBottom: "8px",
        borderBottom: "1px solid rgba(255,255,255,0.1)",
      },
    },
  );
}
