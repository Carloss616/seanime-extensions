import { LCClient, normalizeEntry, searchAndPaginate } from "./utils/lc-client";

export class Provider implements CustomSource {
  // `fetch` and `$getUserPreference` are the goja globals available in
  // custom-source runtimes.
  private client = new LCClient(fetch, $getUserPreference);

  getSettings(): Settings {
    return { supportsAnime: false, supportsManga: true };
  }

  async listManga(
    search: string,
    page: number,
    perPage: number,
  ): Promise<ListResponse<$app.AL_BaseManga>> {
    const entries = await this.client.loadCatalog();
    return searchAndPaginate(entries, search, page, perPage);
  }

  async getManga(ids: number[]): Promise<$app.AL_BaseManga[]> {
    const entries = await this.client.loadCatalog();
    const wanted = new Set(ids || []);
    return entries.filter((e) => wanted.has(e.id)).map(normalizeEntry);
  }

  async getMangaDetails(
    id: number,
  ): Promise<$app.AL_MangaDetailsById_Media | null> {
    const entries = await this.client.loadCatalog();
    const entry = entries.find((e) => e.id === id);
    if (!entry) return null;
    return {
      id: entry.id,
      siteUrl: entry.siteUrl,
      genres:
        entry.genres && entry.genres.length > 0 ? entry.genres : undefined,
    };
  }

  // Anime stubs: required by the abstract CustomSource shape. Seanime does
  // not gate calls on `supportsAnime`, so these are reachable in practice.
  async getAnime(_ids: number[]): Promise<$app.AL_BaseAnime[]> {
    return [];
  }
  async getAnimeMetadata(
    _id: number,
  ): Promise<$app.Metadata_AnimeMetadata | null> {
    return null;
  }
  async getAnimeWithRelations(_id: number): Promise<$app.AL_CompleteAnime> {
    const id = __MANIFEST_ID__;
    throw new Error(`[${id}]: anime not supported`);
  }
  async getAnimeDetails(
    _id: number,
  ): Promise<$app.AL_AnimeDetailsById_Media | null> {
    return null;
  }
  async listAnime(
    _search: string,
    _page: number,
    _perPage: number,
  ): Promise<ListResponse<$app.AL_BaseAnime>> {
    return { media: [], page: 1, totalPages: 0, total: 0 };
  }
}
