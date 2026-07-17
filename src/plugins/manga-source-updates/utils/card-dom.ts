import { domAttr } from "../../../_utils/dom-read";

export type CardAttrs = { mediaId: number; progress: number };

export async function readCardAttrs(el: $ui.DOMElement): Promise<CardAttrs> {
  const fromAttr = Number((await domAttr(el, "data-media-id")) ?? 0);
  let progress = 0;
  let mediaId = fromAttr;
  try {
    const ld = (await domAttr(el, "data-list-data")) ?? "";
    if (ld) {
      const parsed = JSON.parse(ld) as {
        progress?: number;
        mediaId?: number;
        media?: { id?: number };
      };
      progress = Number(parsed.progress ?? 0);
      if (!mediaId) {
        mediaId = Number(parsed.mediaId ?? parsed.media?.id ?? 0);
      }
    }
  } catch {
    /* attrs stay at defaults */
  }
  return { mediaId, progress };
}
