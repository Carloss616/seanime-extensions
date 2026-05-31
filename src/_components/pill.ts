// Reusable rounded "pill" badge for plugin trays.
//
// PURE FUNCTION: receives the `tray` instance so the build can inline it into
// serialized $ui.register / hook callbacks without closing over module scope
// (see CLAUDE.md "Splitting an extension across multiple files").

export type PillIntent = "success" | "info" | "warning" | "alert" | "gray";

const PILL_PALETTE: Record<PillIntent, { bg: string; fg: string }> = {
  success: { bg: "rgba(80,200,120,0.15)", fg: "rgba(140,220,160,1)" },
  info: { bg: "rgba(120,170,255,0.15)", fg: "rgba(160,200,255,1)" },
  warning: { bg: "rgba(255,200,0,0.15)", fg: "rgba(255,220,80,1)" },
  alert: { bg: "rgba(255,120,120,0.15)", fg: "rgba(255,150,150,1)" },
  gray: { bg: "rgba(255,255,255,0.06)", fg: "rgba(255,255,255,0.6)" },
};

export function pill(tray: Tray, label: string, intent: PillIntent = "gray") {
  const { bg, fg } = PILL_PALETTE[intent] ?? PILL_PALETTE.gray;
  return tray.span(label, {
    style: {
      fontSize: "0.7rem",
      fontWeight: "500",
      padding: "2px 8px",
      borderRadius: "10px",
      background: bg,
      color: fg,
    },
  });
}
