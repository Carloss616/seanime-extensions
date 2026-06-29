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
