// Shared types for the local-catalog format.
//
// Used by both:
//   - the `local-catalog` custom-source (READER) — fetches the JSON and
//     maps entries to AniList shapes.
//   - the `local-catalog-manager` plugin (WRITER + CRUD) — edits the catalog
//     and pushes it to a GitHub Gist.
//
// The Gist file (`catalog.json`) is shaped as `Catalog`. Both sides treat
// title resolution identically — see `resolveUserPreferred` and
// `parseCatalog` in src/_shared/local-catalog/parse.ts.
//
// `Catalog.updatedAt` is written by the manager and ignored by the reader
// (the v1 source parses only `manga`), so the wire format stays compatible.

interface CatalogTitle {
  english?: string;
  romaji?: string;
  native?: string;
  userPreferred?: string;
}

interface CatalogEntry {
  id: number;
  title: string | CatalogTitle;
  synonyms?: string[];
  cover?: string;
  banner?: string;
  description?: string;
  genres?: string[];
  status?: $app.AL_MediaStatus;
  format?: $app.AL_MediaFormat;
  chapters?: number;
  volumes?: number;
  year?: number;
  isAdult?: boolean;
  country?: string;
  siteUrl?: string;
}

interface Catalog {
  version?: number;
  manga?: CatalogEntry[];
  updatedAt?: number;
}
