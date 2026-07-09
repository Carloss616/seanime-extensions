import { parseDomNumber } from "../../../_utils/dom-read";

/** Entry-page progress reader with a nav-scoped cache for decorateBar passes. */
export function createHeaderProgressReader(ctx: $ui.Context) {
  let cache: number | null = null;

  const read = async (
    badgeEl?: $ui.DOMElement | null,
  ): Promise<number | null> => {
    const fromBadge = await parseDomNumber(badgeEl);
    if (fromBadge != null) return fromBadge;
    // Only trust the cache when not reacting to a specific badge node — a
    // provided badgeEl with a failed parse must not return a stale cache.
    if (badgeEl == null && cache != null) return cache;
    try {
      const els = await ctx.dom.query(
        "[data-media-page-header-progress-badge-progress]",
      );
      return await parseDomNumber(els?.[0]);
    } catch {
      return null;
    }
  };

  return {
    read,
    setCache: (v: number) => {
      cache = v;
    },
    clearCache: () => {
      cache = null;
    },
  };
}
