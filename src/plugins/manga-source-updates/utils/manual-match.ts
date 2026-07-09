// Manual-match modal signatures — the main panel shows either "Current mapping:
// <id>" (after save) or `<p class="…">No manual match</p>`; nested confirm is separate.

/** `null` = still loading / not the main panel body yet. */
export function mappingSigFromHtml(html: string): string | null {
  const h = html.toLowerCase();
  if (h.includes("no manual match")) return "none";
  const m = /current mapping:\s*<span[^>]*>([^<]*)<\/span>/i.exec(html);
  if (m) {
    const id = m[1].trim();
    return id || "empty";
  }
  if (h.includes("current mapping:")) return "present";
  return null;
}

/** Nested "Are you sure…" confirm — not the mapping-status panel. */
export function isManualMatchConfirmDialog(html: string): boolean {
  const h = html.toLowerCase();
  return h.includes("are you sure") && !h.includes("current mapping:");
}
