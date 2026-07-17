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
  const title = String(opts.title ?? __MANIFEST_NAME__);
  // Coerce like subtitle below: iconUrl may be a goja-wrapped empty string (a
  // Go-bound media.coverImage), which is TRUTHY — a bare `?? fallback` keeps it
  // and `if (iconUrl)` lets it through to tray.img(""), which panics with
  // "src is required". String() unwraps it so empty correctly means "no icon".
  const iconUrl =
    opts.iconUrl == null ? __MANIFEST_ICON__ : String(opts.iconUrl);
  // Coerce like iconUrl above: a wrapped empty subtitle is truthy and would
  // panic tray.text with "text is required". When the caller sets a custom title
  // but no subtitle, the manifest name drops here so the plugin identity stays
  // visible under the custom title.
  const subtitle =
    opts.subtitle != null
      ? String(opts.subtitle)
      : opts.title != null
        ? String(__MANIFEST_NAME__)
        : "";

  // Title + subtitle stacked; the flex-1 makes this column push the right nodes
  // to the far edge. overflowWrap + wordBreak keep long titles on word boundaries
  // (without them flex minWidth:0 can break mid-word, e.g. "…En" / "d").
  const wrapStyle = {
    overflowWrap: "break-word",
    wordBreak: "normal",
  } as const;
  const textCol: unknown[] = [
    tray.text(title, {
      style: {
        fontWeight: "700",
        fontSize: "1.15rem",
        lineHeight: "1.2",
        letterSpacing: "0.01em",
        ...wrapStyle,
      },
    }),
  ];
  if (subtitle) {
    textCol.push(
      tray.text(subtitle, {
        style: {
          fontSize: "0.8rem",
          lineHeight: "1.3",
          opacity: "0.55",
          ...wrapStyle,
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

  // No border/padding of its own: the caller emits a `divider(tray)` right
  // after this header (page-stack siblings), so the stack's gap spaces the rule
  // equally on both sides — the uniform rhythm (see CLAUDE.md). Returns just the
  // identity row.
  return tray.flex(row, { gap: 3, style: { alignItems: "center" } });
}
