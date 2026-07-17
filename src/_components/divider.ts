// Thin 1px separator between tray sections. NO margin/padding: spacing comes
// from the parent stack's `gap` (the repo spacing convention) so vertical
// rhythm stays uniform instead of each divider baking in its own.
// PURE over `tray` so the build can inline it into serialized goja callbacks.

export function divider(tray: $ui.Tray): unknown {
  return tray.div([], {
    style: { borderTop: "1px solid rgba(255,255,255,0.1)" },
  });
}

// Interleave dividers between page-level blocks: a rule between each pair of
// present blocks, none before the first or around null/undefined blocks.
// Returns the flat child list for a page `tray.stack` so the stack's `gap`
// spaces every rule equally on both sides.
export function joinDividers(tray: $ui.Tray, blocks: unknown[]): unknown[] {
  const out: unknown[] = [];
  for (const b of blocks) {
    if (b == null) continue;
    if (out.length > 0) out.push(divider(tray));
    out.push(b);
  }
  return out;
}
