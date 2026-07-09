import {
  decodeLocalId,
  isCustomSourceId,
} from "../../../_utils/custom-source-id";
import { SOURCE_PREFIX } from "./constants";
import { getMULink, setMULink } from "./link-store";
import { mangaTitles, pickBestMatch } from "./match";
import type { MUClient } from "./mu-client";

export function isMuCustomSourceEntry(siteUrl: string | undefined): boolean {
  return !!siteUrl && siteUrl.indexOf(SOURCE_PREFIX) === 0;
}

export type MuSeriesIdResolve =
  | { seriesId: string; via: "custom-source" }
  | { seriesId: string; via: "link" }
  | { seriesId: string; via: "auto"; title: string }
  | { via: "auto-miss"; query: string }
  | { via: "unlinked" };

export async function resolveMuSeriesId(deps: {
  mediaId: number;
  manga: $app.AL_BaseManga | undefined;
  mu: MUClient;
  autoMatchEnabled: boolean;
}): Promise<MuSeriesIdResolve> {
  const { mediaId, manga, mu } = deps;

  if (isCustomSourceId(mediaId) && isMuCustomSourceEntry(manga?.siteUrl)) {
    const localId = decodeLocalId(mediaId);
    if (localId > 0) {
      return { seriesId: String(localId), via: "custom-source" };
    }
  }

  const link = getMULink(mediaId);
  if (link?.id) return { seriesId: link.id, via: "link" };

  if (!deps.autoMatchEnabled) return { via: "unlinked" };

  const titles = mangaTitles(manga);
  if (!titles.length) return { via: "unlinked" };

  const match = pickBestMatch(titles, await mu.search(titles[0], 25));
  if (match) {
    setMULink(mediaId, { ...match, linkedAt: Date.now() });
    return { seriesId: match.id, via: "auto", title: match.title };
  }

  return { via: "auto-miss", query: titles[0] };
}

export function resolveLinkedMuInfo(mediaId: number): {
  url?: string;
  title?: string;
} {
  let media: $app.AL_BaseManga | undefined;
  try {
    media = $anilist.getManga(mediaId);
  } catch (_) {
    media = undefined;
  }
  if (!media || isMuCustomSourceEntry(media.siteUrl)) return {};
  const link = getMULink(mediaId);
  if (!link) return {};
  return { url: link.url, title: link.title };
}
