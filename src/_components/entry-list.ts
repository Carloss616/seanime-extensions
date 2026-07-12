// Reusable searchable entry-list section for plugin trays.
//
// PURE FUNCTION: it receives the `tray` instance plus a declarative row spec,
// so the build can inline it into a serialized $ui.register callback without
// closing over module scope (goja re-evals callbacks in a fresh runtime — see
// CLAUDE.md "Splitting an extension across multiple files").
//
// Opinionated rows: instead of arbitrary pre-built segments, a row declares
// what it HAS (year / status / chapter / external link / in-place open) and
// the component renders the present pieces, dot-separated, in a fixed order:
//
//   {year} · {status pill} · {warn pill} · c.{chapter} · Open ↗ · Open →
//
// Trailing `actions` (edit / delete / unlink / apply buttons) are still passed
// pre-built, because their onClick handlers close over per-plugin state.
//
// Cover slot: `cover` URL → tray.img; absent/empty → initials avatar tinted
// from the row title (stable HSL hash, up to two alphanumeric chars).

import { LABEL_STYLE } from "./text";

export interface EntryListRow {
  cover?: string;
  title: string;
  year?: number;
  // Rendered as a native tray.badge. `intent` drives the color.
  status?: { label: string; intent?: $ui.BadgeComponentIntent };
  // Optional warning pill after `status` (e.g. a cross-device manual-match
  // divergence). Same sub-line, defaults to `warning` intent.
  warn?: { label: string; tooltip?: string; intent?: $ui.BadgeComponentIntent };
  // Rendered as "c.{chapter}".
  chapter?: number | string;
  // "Open ↗" underlined external link (new tab) with an optional tooltip.
  openExternal?: { href: string; tooltip?: string };
  // "Open →" underlined in-place open. `onClick` is a registered handler id
  // (string) or the result of ctx.eventHandler(...) — the component can't make
  // handlers itself (it has no ctx), so the caller wires the navigation.
  openInPlace?: { onClick?: string; tooltip?: string };
  // Pre-built trailing buttons (edit / delete / unlink / apply …).
  actions?: unknown[];
  // Row dim factor (e.g. 0.5 while drifting).
  opacity?: number;
}

export interface EntryListConfig {
  headerLabel: string;
  rows: EntryListRow[];
  totalCount: number;
  searchActive: boolean;
  searchFieldRef: $ui.FieldRef<string>;
  searchPlaceholder: string;
  onSearch: string;
  onClearSearch: string;
  inlineActions?: unknown[];
  emptyText: string;
  noMatchText: string;
  showSearchRow?: boolean; // default true
  searchButtonLabel?: string; // default "🔍 Search"
  /** When false, header shows only `headerLabel` (no "(N)" count). Default true. */
  showHeaderCount?: boolean;
}

// Stable HSL tint + up to two initials when a row has no cover URL (e.g. a
// manga provider with no icon API). Pure so the build inlines it into serialized
// callbacks alongside entryList.
function initialsCover(tray: $ui.Tray, name: string): unknown {
  const label = String(name);
  const clean = label.replace(/[^a-zA-Z0-9]/g, "");
  const initials = (clean.slice(0, 2) || "?").toUpperCase();
  let h = 0;
  for (let i = 0; i < label.length; i++) {
    h = (h * 31 + label.charCodeAt(i)) % 360;
  }
  // tray.flex is already display:flex, so alignItems/justifyContent reliably
  // center the initials (a plain div's flex didn't always apply in the tray).
  return tray.flex(
    [
      tray.text(initials, {
        style: {
          fontSize: "0.85rem",
          fontWeight: "700",
          lineHeight: "1",
          textAlign: "center",
          color: "rgba(255,255,255,0.9)",
        },
      }),
    ],
    {
      style: {
        width: "44px",
        height: "62px",
        borderRadius: "4px",
        background: `hsl(${h}, 45%, 38%)`,
        alignItems: "center",
        justifyContent: "center",
        flexShrink: "0",
      },
    },
  );
}

export function entryList(tray: $ui.Tray, cfg: EntryListConfig): unknown {
  const coverBox = (src: string | undefined, title: string) => {
    const url = src != null ? String(src).trim() : "";
    if (url) {
      return tray.img({
        // Coerce: `src` may be a Go-wrapped string (e.g. a Go-bound
        // media.coverImage.large), and tray.img's Go handler type-asserts a
        // plain string — passing the wrapped value throws "expected string,
        // got *...". See CLAUDE.md goja boundary.
        src: url,
        style: {
          width: "44px",
          height: "62px",
          objectFit: "cover",
          borderRadius: "4px",
          flexShrink: "0",
        },
      });
    }
    return initialsCover(tray, title);
  };

  const dotSep = () =>
    tray.span("·", {
      style: { opacity: "0.35", fontSize: "0.75rem", margin: "0 2px" },
    });

  const subLineSegments = (row: EntryListRow): unknown[] => {
    const segs: unknown[] = [];
    if (row.year != null) {
      segs.push(
        tray.span(String(row.year), {
          style: { opacity: "0.55", fontSize: "0.75rem" },
        }),
      );
    }
    if (row.status) {
      segs.push(
        tray.badge(row.status.label, {
          intent: row.status.intent ?? "gray",
          size: "sm",
        }),
      );
    }
    if (row.warn) {
      const badge = tray.badge(row.warn.label, {
        intent: row.warn.intent ?? "warning",
        size: "sm",
      });
      segs.push(
        row.warn.tooltip
          ? tray.tooltip(badge, { text: row.warn.tooltip })
          : badge,
      );
    }
    if (row.chapter != null && row.chapter !== "") {
      segs.push(
        tray.span(`c.${row.chapter}`, {
          style: { opacity: "0.7", fontSize: "0.75rem" },
        }),
      );
    }
    // Open ↗ (external <a>) and Open → (in-place <button>) share one style so
    // they read as a uniform pair AND match the metadata scale (year / c.N).
    // We do NOT change the button's `display` (that bloats its label size);
    // instead we collapse its UI-Button_root box height/padding so its
    // underline lines up with the inline anchor's. `fontSize: 0.75rem` keeps
    // both at the same small size as the rest of the sub-line.
    const linkStyle: Record<string, string> = {
      background: "transparent",
      border: "none",
      padding: "0",
      height: "auto",
      minHeight: "0",
      fontSize: "0.75rem",
      fontWeight: "500",
      opacity: "0.75",
      textDecoration: "underline",
      whiteSpace: "nowrap",
    };
    if (row.openExternal?.href) {
      const link = tray.a([tray.span("Open ↗")], {
        href: row.openExternal.href,
        target: "_blank",
        style: linkStyle,
      });
      segs.push(
        row.openExternal.tooltip
          ? tray.tooltip(link, { text: row.openExternal.tooltip })
          : link,
      );
    }
    if (row.openInPlace) {
      const button = tray.button("Open →", {
        onClick: row.openInPlace.onClick,
        size: "sm",
        intent: "gray-subtle",
        style: linkStyle,
      });
      segs.push(
        row.openInPlace.tooltip
          ? tray.tooltip(button, { text: row.openInPlace.tooltip })
          : button,
      );
    }
    return segs;
  };

  const entryRow = (row: EntryListRow) => {
    const segs = subLineSegments(row);
    const subLineChildren: unknown[] = [];
    segs.forEach((seg, i) => {
      if (i > 0) subLineChildren.push(dotSep());
      subLineChildren.push(seg);
    });
    const middle = tray.stack(
      [
        // Coerce at the trust boundary: row.title may arrive empty/null from
        // $storage or an AniList lookup, and tray.text panics on a falsy text.
        tray.text(String(row.title || "Untitled"), {
          style: {
            fontWeight: "600",
            fontSize: "0.9rem",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          },
        }),
        tray.flex(subLineChildren, {
          gap: 0,
          style: { alignItems: "center" },
        }),
      ],
      // gap: 1 (4px) between title and its metadata sub-line.
      { gap: 1, style: { flex: "1", minWidth: "0" } },
    );
    const rowChildren: unknown[] = [
      coverBox(row.cover, String(row.title || "Untitled")),
      middle,
    ];
    for (const a of row.actions ?? []) rowChildren.push(a);
    return tray.flex(rowChildren, {
      gap: 2,
      style: {
        alignItems: "center",
        padding: "8px",
        borderRadius: "4px",
        background: "rgba(255,255,255,0.02)",
        opacity: row.opacity != null ? String(row.opacity) : "1",
      },
    });
  };

  const headerCount = cfg.searchActive
    ? `${cfg.rows.length} / ${cfg.totalCount}`
    : `${cfg.totalCount}`;
  const headerText =
    cfg.showHeaderCount === false
      ? cfg.headerLabel
      : `${cfg.headerLabel} (${headerCount})`;
  const header = tray.flex(
    [
      tray.div(
        [
          tray.text(headerText, {
            style: LABEL_STYLE,
          }),
        ],
        { style: { flex: "1", alignSelf: "center" } },
      ),
      ...(cfg.inlineActions ?? []),
    ],
    {
      gap: 2,
      style: { alignItems: "center" },
    },
  );

  const out: unknown[] = [];
  out.push(header);

  if (cfg.showSearchRow !== false && cfg.totalCount > 0) {
    const searchRowChildren: unknown[] = [
      tray.div(
        [
          tray.input(cfg.searchPlaceholder, {
            fieldRef: cfg.searchFieldRef,
          }),
        ],
        { style: { flex: "1", minWidth: "0" } },
      ),
      tray.button(cfg.searchButtonLabel ?? "🔍 Search", {
        onClick: cfg.onSearch,
        size: "sm",
      }),
    ];
    if (cfg.searchActive) {
      searchRowChildren.push(
        tray.tooltip(
          tray.button("✕", { onClick: cfg.onClearSearch, size: "sm" }),
          { text: "Clear search" },
        ),
      );
    }
    out.push(
      tray.flex(searchRowChildren, {
        gap: 2,
        style: { alignItems: "end" },
      }),
    );
  }

  if (cfg.totalCount === 0) {
    out.push(
      tray.text(cfg.emptyText, {
        style: {
          fontSize: "0.8rem",
          opacity: "0.5",
          textAlign: "center",
          padding: "8px 0",
        },
      }),
    );
  } else if (cfg.rows.length === 0 && cfg.searchActive) {
    out.push(
      tray.text(cfg.noMatchText, {
        style: {
          fontSize: "0.8rem",
          opacity: "0.5",
          textAlign: "center",
          padding: "8px 0",
        },
      }),
    );
  } else {
    for (const row of cfg.rows) out.push(entryRow(row));
  }

  // A self-contained section: 8px internal rhythm regardless of how the caller
  // composes it (so the page-level gap can't leak into the rows). Any divider
  // above it is emitted by the caller as a page-stack sibling (see joinDividers).
  return tray.stack(out, { gap: 2 });
}
