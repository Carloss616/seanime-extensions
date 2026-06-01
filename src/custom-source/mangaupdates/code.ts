import { MUClient } from "./utils/mu-client";

export class Provider implements CustomSource {
  // Read client (search + series lookup + normalization). `fetch` is the goja
  // global available in custom-source runtimes.
  private client = new MUClient(fetch);

  getSettings(): Settings {
    return { supportsAnime: false, supportsManga: true };
  }

  async listManga(
    search: string,
    page: number,
    perPage: number,
  ): Promise<ListResponse<$app.AL_BaseManga>> {
    return this.client.search(search, page, perPage);
  }

  async getManga(ids: number[]): Promise<$app.AL_BaseManga[]> {
    return this.client.getManga(ids);
  }

  async getMangaDetails(
    id: number,
  ): Promise<$app.AL_MangaDetailsById_Media | null> {
    return this.client.getMangaDetails(id);
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
