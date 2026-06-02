// Shared types for the local-catalog format.
//
// Used by both:
//   - the `local-catalog` custom-source (READER) — fetches the JSON and
//     maps entries to AniList shapes.
//   - the `local-catalog-manager` plugin (WRITER + CRUD) — edits the catalog
//     and pushes it to a GitHub Gist.
//
// Both sides treat title resolution identically — see `resolveUserPreferred`
// and `parseCatalog` in src/_utils/local-catalog/catalog.ts.

// Catalog entries ARE native seanime AniList shapes ($app.AL_BaseManga /
// $app.AL_BaseAnime), plus a per-record `updatedAt` (epoch ms) used purely as
// merge-metadata. `updatedAt` has no AniList equivalent; the reader strips it
// before handing the entry to seanime (see normalizeEntry). `id` is already
// required by AL_BaseManga; a non-empty `title` is additionally enforced at
// runtime by parseCatalog (since AL_BaseManga.title is optional in the type).
type MangaCatalogEntry = $app.AL_BaseManga & { updatedAt?: number };
type AnimeCatalogEntry = $app.AL_BaseAnime & { updatedAt?: number };

interface LocalCatalog {
  version?: number;
  // Envelope-level: last write to the whole document.
  updatedAt?: number;
  manga: MangaCatalogEntry[];
  // RESERVED: parsed + round-trippable, but not served by the source and not
  // edited by the manager yet (anime serving is a follow-up spec).
  anime: AnimeCatalogEntry[];
}

// V2-B: reading-progress sync. Written to `progress.json` in the same gist as
// `catalog.json`. Keyed by `MangaCatalogEntry.id` / `AnimeCatalogEntry.id`
// (a.k.a. `localId`) so it survives custom-source `extensionIdentifier`
// reassignment across installs.
//
// The payload is seanime's native list-data shape. `updatedAt` (REQUIRED — drives
// per-entry last-write-wins; missing → treated as 0) is wrapper merge-metadata
// with no AniList equivalent. NOTE: `score` carries the AniList RAW score
// (POINT_100) — that is what the update hooks expose (event.scoreRaw) and what
// $anilist.updateEntry consumes; progress.json is a private round-trip.
type MangaProgressEntry = $app.Manga_EntryListData & { updatedAt: number };
type AnimeProgressEntry = $app.Anime_EntryListData & { updatedAt: number };

interface LocalProgress {
  version: number;
  // Informational. Set on each write; not used for merge.
  updatedAt: number;
  manga: Record<string, MangaProgressEntry>; // key = stringified localId
  // RESERVED: mirrors catalog.json's anime namespace; not populated yet.
  anime: Record<string, AnimeProgressEntry>;
}
