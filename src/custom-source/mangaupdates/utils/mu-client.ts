// MangaUpdates v1 read client for the custom-source.
//
// Wraps the public search + series endpoints and normalizes their records into
// the `$app.AL_BaseManga` shape seanime expects. The Provider (code.ts) is a
// thin delegate over this client. `fetchFn` is injected so the client is unit-
// testable without the network; the Provider passes the `fetch` global.
//
// (This is the READ side. The mangaupdates-sync plugin has its own auth/write
// client at src/plugins/mangaupdates-sync/utils/mu-client.ts — separate bundle,
// separate concern; they only share the endpoint constants.)

import { MUClientBase } from "../../../_utils/mangaupdates/client";
import { muRecordUrl, muRecordYear } from "../../../_utils/mangaupdates/record";

export function mapFormat(type?: string): $app.AL_MediaFormat | undefined {
  switch ((type || "").toLowerCase()) {
    case "":
      return undefined;
    case "novel":
    case "artbook":
      return "NOVEL";
    default:
      return "MANGA";
  }
}

export function toBaseManga(
  record: MUSearch.Record | MUSeries.Response,
): $app.AL_BaseManga {
  const title = record.title || "???";
  const year = muRecordYear(record);
  const synonyms = ("associated" in record ? record.associated : [])
    .map((a) => a.title)
    .filter((t): t is string => typeof t === "string" && t.length > 0);
  const { original: coverOriginal, thumb: coverThumb } =
    record.image?.url || {};
  const hasCover = !!(coverOriginal || coverThumb);
  const rating =
    typeof record.bayesian_rating === "number" && (record.rating_votes ?? 0) > 0
      ? Math.round(record.bayesian_rating * 10)
      : undefined;
  return {
    id: record.series_id,
    siteUrl: muRecordUrl(record),
    type: "MANGA",
    format: mapFormat(record.type),
    description: record.description ?? undefined,
    genres: (record.genres || []).map((g) => g.genre),
    synonyms: synonyms.length > 0 ? synonyms : undefined,
    meanScore: rating,
    title: { english: title, userPreferred: title },
    coverImage: hasCover
      ? {
          extraLarge: coverOriginal || coverThumb,
          large: coverOriginal || coverThumb,
          medium: coverThumb || coverOriginal,
        }
      : undefined,
    startDate: year !== undefined ? { year } : undefined,
  };
}

export class MUClient extends MUClientBase {
  constructor(fetchFn: typeof fetch) {
    super();
    this.fetchFn = fetchFn;
  }

  async req<T = unknown>(
    method: string,
    path: string,
    options: {
      body?: unknown;
    } = {},
  ): Promise<T | null> {
    return this._req<T>(method, path, {
      body: options?.body,
    });
  }

  async search(
    query: string,
    page: number,
    perPage: number,
  ): Promise<ListResponse<$app.AL_BaseManga>> {
    const data = await this._search(query, {
      page,
      perPage,
    }).catch(() => null);

    const results = data?.results || [];
    const per = data?.per_page || perPage;
    return {
      media: results.map((r) => toBaseManga(r.record)),
      page: data?.page || page,
      totalPages: per > 0 ? Math.ceil((data?.total_hits || 0) / per) : 0,
      total: data?.total_hits || 0,
    };
  }

  async getManga(ids: number[]): Promise<$app.AL_BaseManga[]> {
    const records = await Promise.all(
      (ids || []).map((id) => this.getSeries(id)),
    );
    return records
      .filter((r): r is MUSeries.Response => r !== null)
      .map(toBaseManga);
  }

  async getMangaDetails(
    id: number,
  ): Promise<$app.AL_MangaDetailsById_Media | null> {
    const record = await this.getSeries(id);
    if (!record) return null;
    return {
      id: record.series_id,
      siteUrl: record.url,
      genres: (record.genres || []).map((g) => g.genre),
    };
  }

  private async getSeries(id: number): Promise<MUSeries.Response | null> {
    return this.req<MUSeries.Response>("GET", `/series/${id}`).catch(
      () => null,
    );
  }
}
