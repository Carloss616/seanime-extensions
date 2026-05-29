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
  // Release date — matches AL_BaseManga_StartDate (year/month/day, each
  // independently optional). When the custom-source normalizes the entry it
  // forwards these as `startDate` to seanime; passing only `year` makes
  // seanime UI show "Jan YYYY" (defaults month to 0/January), so pass month
  // too when you know it.
  year?: number;
  month?: number;
  day?: number;
  isAdult?: boolean;
  country?: string;
  siteUrl?: string;
}

interface Catalog {
  version?: number;
  manga?: CatalogEntry[];
  updatedAt?: number;
}

// V2-B: reading-progress sync. Written to `progress.json` in the same gist
// as `catalog.json`. Keyed by `CatalogEntry.id` (a.k.a. `localId`) so it
// survives custom-source `extensionIdentifier` reassignment across installs.
interface ProgressEntry {
  status?: $app.AL_MediaListStatus;
  progress?: number;
  scoreRaw?: number;
  // REQUIRED — drives per-entry last-write-wins merge. Missing → treated as 0.
  updatedAt: number;
}

interface ProgressDoc {
  version: number;
  // Informational. Set on each write; not used for merge.
  updatedAt: number;
  // Mirrors catalog.json's "manga" namespace so the wire format stays
  // symmetric and forward-compatible with a future "anime" namespace.
  manga: Record<string, ProgressEntry>; // key = stringified localId
}
