// Reusable left-bordered "alert" callout box for plugin trays.
//
// PURE FUNCTION: receives the `tray` instance so the build can inline it into
// serialized $ui.register / hook callbacks without closing over module scope
// (see CLAUDE.md "Splitting an extension across multiple files").
//
// Intents + colors mirror src/_components/pill.ts, so an alert and a pill of
// the same intent read as the same color: the pill's `bg` fills the box and the
// pill's `fg` is the left accent border.

export type AlertIntent = "success" | "info" | "warning" | "alert" | "gray";

const ALERT_PALETTE: Record<AlertIntent, { bg: string; border: string }> = {
  success: { bg: "rgba(80,200,120,0.15)", border: "rgba(140,220,160,1)" },
  info: { bg: "rgba(120,170,255,0.15)", border: "rgba(160,200,255,1)" },
  warning: { bg: "rgba(255,200,0,0.15)", border: "rgba(255,220,80,1)" },
  alert: { bg: "rgba(255,120,120,0.15)", border: "rgba(255,150,150,1)" },
  gray: { bg: "rgba(255,255,255,0.06)", border: "rgba(255,255,255,0.6)" },
};

export function alertBox(
  tray: $ui.Tray,
  children: unknown[],
  opts: { intent?: AlertIntent } = {},
) {
  const p = ALERT_PALETTE[opts.intent ?? "warning"] ?? ALERT_PALETTE.warning;
  return tray.div(children, {
    style: {
      padding: "10px 12px",
      borderRadius: "6px",
      background: p.bg,
      borderLeft: `3px solid ${p.border}`,
      marginBottom: "8px",
    },
  });
}
