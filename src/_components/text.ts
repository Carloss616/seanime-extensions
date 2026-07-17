// Shared typography tokens for tray UIs — one scale for the small dim text that
// recurs across every plugin:
//   LABEL_STYLE   — uppercase, tracked section headers & stat labels
//   CAPTION_STYLE — plain dim sub-labels & captions
// Plain style objects so they inline into serialized goja callbacks.

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

export const ALERT_MENU_ITEM_STYLE =
  "hover:bg-red-100 active:bg-red-200 dark:hover:bg-opacity-20 text-[--red]";
