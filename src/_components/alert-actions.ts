// The notch action box that sits under a `tray.alert` (which can't host child
// buttons of its own): a bordered box with an upward triangle pointing back at
// the alert above it, so every "alert + actions" pair reads identically.
// PURE over `tray` so the build can inline it into serialized goja callbacks.
export function alertActions(tray: $ui.Tray, rows: unknown[]): unknown {
  return tray.div(
    [
      // Upward triangle over the box's top border, so the box reads as
      // belonging to the alert above it.
      tray.div([], {
        style: {
          position: "absolute",
          top: "-7px",
          left: "50%",
          transform: "translateX(-50%)",
          width: "0",
          height: "0",
          borderLeft: "7px solid transparent",
          borderRight: "7px solid transparent",
          borderBottom: "7px solid rgba(255,255,255,0.18)",
        },
      }),
      tray.stack(rows, { gap: 2, style: { alignItems: "center" } }),
    ],
    {
      style: {
        position: "relative",
        padding: "12px",
        borderRadius: "8px",
        border: "1px solid rgba(255,255,255,0.18)",
        background: "rgba(255,255,255,0.04)",
      },
    },
  );
}
