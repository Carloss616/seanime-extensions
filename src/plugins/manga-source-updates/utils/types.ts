// The three outcomes that both classify a source AND are reasons to auto-exclude
// it — the shared base of ResultKind and ExcludeReason.
export type AutoBadKind = "not-matched" | "error-found" | "outdated";

// Per-manga / per-source classification outcome.
export type ResultKind = AutoBadKind | "new" | "up-to-date" | "all-excluded";

// Why a source is excluded: the auto-exclude kinds plus manual-only reasons.
export type ExcludeReason = AutoBadKind | "bad-numbering" | "other";

// Persisted per-manga scan outcome — reused on a TTL-fresh rescan AND to
// rehydrate the tray after a reload (the in-memory state is otherwise empty).
export interface StoredResult {
  title: string;
  cover?: string;
  latest: number; // highest chapter across the matched sources
  read: number;
  sources: number; // how many sources have this manga (matched, non-excluded)
  newSources?: number; // of those, how many have unread chapters (drives the M in "+N · M")
  kind: ResultKind;
  checkedAt: number; // ms epoch
}

export type ResultRowMedia = Pick<StoredResult, "title" | "cover">;

export interface MangaResult extends StoredResult {
  mediaId: number;
  isNew: boolean;
  fromCache: boolean;
}

// One probed source in the per-manga detail view.
export interface ProviderProbe {
  provider: string;
  providerName: string;
  latest: number;
  count: number;
  matched: boolean; // true = returned chapters
  errored: boolean; // true = fetch threw (vs. simply no match)
}

export type ProbeMap = Record<string, ProviderProbe>;
