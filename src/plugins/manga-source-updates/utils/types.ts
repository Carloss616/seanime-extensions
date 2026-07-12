// The three outcomes that both classify a source AND are reasons to auto-exclude
// it — the shared base of ResultKind and ExcludeReason.
export type AutoBadKind = "not-matched" | "error-found" | "outdated";

// Per-manga / per-source classification outcome.
export type ResultKind = AutoBadKind | "new" | "up-to-date" | "all-excluded";

// Why a source is excluded: the auto-exclude kinds plus manual-only reasons.
export type ExcludeReason = AutoBadKind | "bad-numbering" | "other";

// Merge metadata carried by every persisted record. `updatedAt` is epoch ms;
// `deletedAt` (epoch ms) marks a soft-deleted tombstone — the record is kept so
// the deletion can propagate across instances and be aged out later. A live
// record has `deletedAt == null` (covers the $storage undefined→null round-trip).
export interface TimestampMeta {
  updatedAt: number;
  deletedAt?: number;
}

// K_EXCLUDED value: the exclude reason plus merge metadata (was a bare string).
export interface ExcludedRecord extends TimestampMeta {
  reason: ExcludeReason;
}

// K_PINNED value: presence = pinned; only merge metadata is stored (was a
// providerId[] array per manga).
export type PinRecord = TimestampMeta;

// The SYNCED half of a digest row: the only fields that are instance-INVARIANT
// (the same on every device) and thus safe to put on the wire. This is exactly
// what rides the gist digest file — see utils/sync.ts `projectDigest`. Syncing
// anything else made the digest churn forever between instances.
export interface DigestWire extends TimestampMeta {
  title: string;
  cover?: string;
  read: number;
  // updatedAt (ms epoch — last written, was checkedAt) + deletedAt (tombstone)
  // come from TimestampMeta.
}

// Persisted per-manga scan outcome — reused on a TTL-fresh rescan AND to
// rehydrate the tray after a reload (the in-memory state is otherwise empty).
// Extends the synced base with the DERIVED / instance-relative fields, computed
// from THIS instance's installed providers + probes + live exclusions, so they
// differ per device and are NEVER put on the wire. Recomputed locally by
// buildResult / reconcileInactiveProviders from the synced `probes` map.
export interface StoredResult extends DigestWire {
  latest: number; // DERIVED — highest chapter across the matched sources
  sources: number; // DERIVED — how many sources have this manga (matched, non-excluded)
  newSources?: number; // DERIVED — of those, how many have unread chapters (drives the M in "+N · M")
  kind: ResultKind; // DERIVED
}

export type ResultRowMedia = Pick<StoredResult, "title" | "cover">;

export interface MangaResult extends StoredResult {
  mediaId: number;
  isNew: boolean;
  fromCache: boolean;
}

// One probed source in the per-manga detail view.
export interface ProviderProbe extends TimestampMeta {
  provider: string;
  providerName: string;
  latest: number;
  count: number;
  matched: boolean; // true = returned chapters
  errored: boolean; // true = fetch threw (vs. simply no match)
}

export type ProbeMap = Record<string, ProviderProbe>;
