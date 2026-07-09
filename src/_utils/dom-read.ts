// Denshi/goja-safe DOM reads: try the synchronous snapshot first, then the async
// bridge when the snapshot is empty (observe/query nodes often lack attributes
// or textContent until getAttribute / getText runs).

/** Read a data-* attribute: `el.attributes` first, then `await getAttribute`. */
export async function domAttr(
  el: $ui.DOMElement,
  key: string,
): Promise<string | undefined> {
  const sync = el.attributes?.[key];
  if (sync != null && sync !== "") return String(sync);
  try {
    const async = await el.getAttribute(key);
    if (async != null && async !== "") return String(async);
  } catch {
    /* keep undefined */
  }
  return undefined;
}

/** Parse numeric text: `textContent` first, then `await getText`. */
export async function parseDomNumber(
  el?: $ui.DOMElement | null,
): Promise<number | null> {
  if (!el) return null;
  const sync = String(el.textContent ?? "").trim();
  if (sync && !Number.isNaN(Number(sync))) return Number(sync);
  try {
    const async = String((await el.getText()) ?? "").trim();
    if (async && !Number.isNaN(Number(async))) return Number(async);
  } catch {
    /* keep null */
  }
  return null;
}
