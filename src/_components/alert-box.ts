// Reusable left-bordered "alert" / "note" callout box for plugin trays.
//
// PURE FUNCTION: receives the `tray` instance so the build can inline it into
// serialized $ui.register / hook callbacks without closing over module scope
// (see CLAUDE.md "Splitting an extension across multiple files").

export type AlertIntent = "warning" | "note";

const ALERT_PALETTE: Record<
  AlertIntent,
  { bg: string; border: string; borderW: string; padding: string }
> = {
  warning: {
    bg: "rgba(255,180,0,0.08)",
    border: "rgba(255,180,0,0.7)",
    borderW: "3px",
    padding: "10px 12px",
  },
  note: {
    bg: "rgba(255,255,255,0.04)",
    border: "rgba(255,180,0,0.5)",
    borderW: "2px",
    padding: "8px 10px",
  },
};

export function alertBox(
  tray: Tray,
  children: unknown[],
  opts: { intent?: AlertIntent } = {},
) {
  const p = ALERT_PALETTE[opts.intent ?? "warning"];
  return tray.div(children, {
    style: {
      padding: p.padding,
      borderRadius: "6px",
      background: p.bg,
      borderLeft: `${p.borderW} solid ${p.border}`,
      marginBottom: "8px",
    },
  });
}
