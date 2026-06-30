// Thin horizontal separator between tray sections.
//
// A plain 1px line with NO margin/padding: spacing around it comes from the
// parent stack's `gap` (the repo's spacing convention — see CLAUDE.md). This
// keeps vertical rhythm consistent instead of each divider baking in its own.
//
// PURE FUNCTION over `tray` so the build can inline it into serialized goja
// callbacks (see CLAUDE.md "Splitting an extension across multiple files").

export function divider(tray: $ui.Tray): unknown {
  return tray.div([], {
    style: { borderTop: "1px solid rgba(255,255,255,0.1)" },
  });
}

// Interleave dividers between page-level blocks: a bare rule between each pair
// of present blocks, none before the first and none around absent (null/
// undefined) blocks. Returns the flat child list for a page `tray.stack` so the
// stack's own `gap` spaces every divider equally on both sides — the uniform
// 12px rhythm (see CLAUDE.md). Replaces the old per-section `leadingDivider`
// flag: callers list their sections and the rules fall where blocks meet.
export function joinDividers(tray: $ui.Tray, blocks: unknown[]): unknown[] {
  const out: unknown[] = [];
  for (const b of blocks) {
    if (b == null) continue;
    if (out.length > 0) out.push(divider(tray));
    out.push(b);
  }
  return out;
}
