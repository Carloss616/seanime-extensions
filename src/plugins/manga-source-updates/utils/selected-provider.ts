import { domAttr } from "../../../_utils/dom-read";

/** Strip JSON-style quotes from data-selected-provider values. */
export function normalizeProviderId(raw: string): string {
  return String(raw ?? "")
    .trim()
    .replace(/^["']|["']$/g, "");
}

export async function readSelectedProvider(
  ctx: $ui.Context,
  container?: $ui.DOMElement,
): Promise<string> {
  try {
    const cont =
      container ?? (await ctx.dom.query("[data-chapter-list-container]"))?.[0];
    if (!cont) return "";
    return normalizeProviderId(
      String((await domAttr(cont, "data-selected-provider")) ?? ""),
    );
  } catch {
    return "";
  }
}
