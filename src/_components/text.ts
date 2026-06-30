// Shared typography tokens for tray UIs. Two roles for the small dim text that
// recurs across every plugin — collapses the four ad-hoc sizes (0.65 / 0.68 /
// 0.70 / 0.72rem) that had drifted apart into one scale.
//
//   LABEL_STYLE   — uppercase, tracked section headers & stat labels
//   CAPTION_STYLE — plain dim sub-labels & captions
//
// Plain style objects (typed Record<string,string> to match the tray node
// `style` param) so they inline into serialized goja callbacks like any other
// helper (see CLAUDE.md "Splitting an extension across multiple files").

export const LABEL_STYLE: Record<string, string> = {
  fontSize: "0.7rem",
  fontWeight: "700",
  opacity: "0.55",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
};

export const CAPTION_STYLE: Record<string, string> = {
  fontSize: "0.7rem",
  opacity: "0.55",
};
