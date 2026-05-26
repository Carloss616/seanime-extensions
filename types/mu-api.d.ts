// Shared types for the MangaUpdates v1 public API (https://api.mangaupdates.com/v1).
//
// These cover the read-only series endpoints — `POST /series/search` and
// `GET /series/{id}` — that the `mangaupdates` custom-source and the
// `mangaupdates-sync` plugin both consume.
//
// Field names on MUSeriesRecord / MUSearchResponse below are verified at
// runtime by the `mangaupdates` custom-source (which consumes every one of
// them on each search/detail call). Auth-only list endpoints live in the
// tracker's own code.ts because they are not shared.

interface MUSeriesRecord {
  series_id: number;
  title: string;
  url: string;
  description?: string | null;
  image?: { url?: { original?: string; thumb?: string } };
  type?: string;
  year?: string;
  bayesian_rating?: number;
  rating_votes?: number;
  genres?: Array<{ genre: string }>;
  associated?: Array<{ title?: string }>;
  // SPIKE: not confirmed that MU exposes cross-ids on /series/{id}. Kept
  // optional so the tracker's resolveReverseMapping can probe for them.
  anilist_id?: number;
  mal_id?: number;
  external_ids?: { anilist?: number; mal?: number };
}

interface MUSearchResponse {
  total_hits: number;
  page: number;
  per_page: number;
  results?: Array<{ record: MUSeriesRecord }>;
}
