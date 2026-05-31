// Thin horizontal separator between tray sections.
//
// PURE FUNCTION over `tray` so the build can inline it into serialized goja
// callbacks (see CLAUDE.md "Splitting an extension across multiple files").
// Shared by renderEntryListSection (its leading section divider) and the
// mangaupdates-sync search block, so the style lives in exactly one place.

export function divider(tray: Tray): unknown {
  return tray.div([], {
    style: {
      borderTop: "1px solid rgba(255,255,255,0.1)",
      marginTop: "10px",
      paddingTop: "8px",
    },
  });
}
