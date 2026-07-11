// Plugin-only sync ops for V2-B progress sync. The pure pieces
// (parseProgress/serializeProgress/mergeProgress) live in
// src/_utils/local-catalog/progress.ts and the mediaId codec in
// src/_utils/custom-source-id.ts; this module wires them to the
// GistClient and to the live library.

import {
  decodeExtId,
  isCustomSourceId,
} from "../../../_utils/custom-source-id";
import type { GistClient } from "../../../_utils/gist/client";
import {
  mergeProgress,
  parseProgress,
  serializeProgress,
} from "../../../_utils/local-catalog/progress";
import { createLogger } from "../../../_utils/logger";

const log = createLogger();

export interface ApplyDeps {
  updateEntry: (
    mediaId: number,
    status: $app.AL_MediaListStatus | undefined,
    scoreRaw: number | undefined,
    progress: number | undefined,
    startedAt?: { year?: number; month?: number; day?: number } | undefined,
    completedAt?: { year?: number; month?: number; day?: number } | undefined,
  ) => void;
  mediaIdByLocalId: Map<number, number>;
}

export function applyRemote(
  merged: LocalProgress,
  local: LocalProgress,
  deps: ApplyDeps,
): { applied: number; skipped: number } {
  let applied = 0;
  let skipped = 0;
  for (const [localIdStr, entry] of Object.entries(merged.manga)) {
    const before = local.manga[localIdStr];
    if (before && (before.updatedAt ?? 0) >= (entry.updatedAt ?? 0)) continue;
    const mediaId = deps.mediaIdByLocalId.get(Number(localIdStr));
    if (mediaId == null) {
      skipped++;
      log.warn(`orphan progress for localId ${localIdStr} (not in collection)`);
      continue;
    }
    deps.updateEntry(
      mediaId,
      entry.status,
      // updateEntry's 3rd param is the $anilist API name "scoreRaw"; we feed entry.score (raw POINT_100).
      entry.score,
      entry.progress,
      undefined,
      undefined,
    );
    applied++;
  }
  return { applied, skipped };
}

// localId → mediaId for entries the user has in their seanime list that
// belong to our custom-source.
//
// Two filtering strategies — when `extId` is provided we decode the mediaId
// and match its embedded extension identifier directly (robust to missing
// siteUrl, which seanime omits on some collection responses). Without
// extId we fall back to the siteUrl-prefix check used before — works in
// most cases but leaves entries out when seanime ships a bare media object.
export function buildMediaIdLookup(
  collection: $app.Manga_Collection,
  prefix: string,
  decodeLocalId: (mediaId: number) => number,
  opts: { extId?: number } = {},
): Map<number, number> {
  const map = new Map<number, number>();
  const lists = collection.lists ?? [];
  for (const l of lists) {
    const entries = l.entries ?? [];
    for (const e of entries) {
      const mediaId = e.media?.id;
      if (typeof mediaId !== "number") continue;
      if (opts.extId != null) {
        // Decode-and-match: works even when siteUrl is missing. Cheap early
        // skip for AniList-range ids (a non-custom-source id never matches a
        // valid extId 1-1023).
        if (!isCustomSourceId(mediaId)) continue;
        if (decodeExtId(mediaId) !== opts.extId) continue;
      } else {
        const siteUrl = e.media?.siteUrl;
        if (!siteUrl || siteUrl.indexOf(prefix) !== 0) continue;
      }
      map.set(decodeLocalId(mediaId), mediaId);
    }
  }
  return map;
}

export function detectOrphans(
  local: LocalProgress,
  catalogIds: Set<number>,
): number[] {
  const out: number[] = [];
  for (const key of Object.keys(local.manga)) {
    const n = Number(key);
    if (!Number.isFinite(n)) continue;
    if (!catalogIds.has(n)) out.push(n);
  }
  return out;
}

export function pruneOrphans(
  local: LocalProgress,
  orphans: number[],
  now: number,
): LocalProgress {
  const orphanSet = new Set(orphans.map(String));
  const cleaned: LocalProgress = {
    version: 1,
    updatedAt: now,
    manga: {},
    anime: local.anime ?? {},
  };
  for (const [k, v] of Object.entries(local.manga)) {
    // Shallow-spread so callers can mutate cleaned.manga without
    // touching the input doc (same defensive copy as mergeProgress).
    if (!orphanSet.has(k)) cleaned.manga[k] = { ...v };
  }
  return cleaned;
}

export async function pushProgress(
  client: GistClient,
  gistId: string,
  filename: string,
  local: LocalProgress,
  now: number,
): Promise<LocalProgress> {
  let remoteStr = "";
  try {
    remoteStr = await client.getGistFile(gistId, filename);
  } catch (_) {
    remoteStr = "";
  }
  const remote = parseProgress(remoteStr, log);
  const merged = mergeProgress(local, remote, now);
  await client.updateGistFile(gistId, filename, serializeProgress(merged));
  return merged;
}

export async function pullProgress(
  client: GistClient,
  gistId: string,
  filename: string,
  local: LocalProgress,
  now: number,
): Promise<LocalProgress> {
  let remoteStr = "";
  try {
    remoteStr = await client.getGistFile(gistId, filename);
  } catch (_) {
    remoteStr = "";
  }
  const remote = parseProgress(remoteStr, log);
  return mergeProgress(local, remote, now);
}

// Action taken by handlePostUpdate. Surface for logging / tests.
export type PostUpdateAction =
  | "push" //              local cache present → write-through + push
  | "restore" //           cache absent + remote has data → apply remote to seanime
  | "push-new" //          cache absent + remote also absent → genuinely new entry, push
  | "persist-local-only"; //  no Gist mode → write to $storage only

export interface PostUpdateContext {
  mediaId: number;
  localId: number;
  payload: Partial<MangaProgressEntry>;
  now: number;
  local: LocalProgress;
  // null when there's no Gist mode (no token / no gistId)
  client: GistClient | null;
  gistId: string;
  filename: string;
  // Wraps $anilist.updateEntry — caller sets/unsets skip flag around it
  // so the recursive hook fire doesn't re-process.
  applyToSeanime: (entry: MangaProgressEntry) => void;
  // Writes the local cache (e.g. $storage.set(K_PROGRESS, doc))
  persistLocal: (doc: LocalProgress, updatedAt: number) => void;
}

/**
 * The gist's progress.json is the source of truth; local $storage is a
 * write-through cache. When this hook sees an update for an entry we've
 * never touched on THIS device (cache absent), check the gist first — the
 * user may have prior progress from another device that this update would
 * clobber (e.g. clicking "Add to List" with defaults).
 */
export async function handlePostUpdate(
  ctx: PostUpdateContext,
): Promise<PostUpdateAction> {
  const {
    localId,
    payload,
    now,
    local,
    client,
    gistId,
    filename,
    applyToSeanime,
    persistLocal,
  } = ctx;
  const key = String(localId);

  // MERGE (not replace) the payload into the previous entry. The pre-hook
  // only captures fields that carried a meaningful value in this event — a
  // chapter-only update has no status/score, and we want to keep what
  // was previously known instead of erasing it. `local.manga[key]` may be
  // undefined here (cache-absent branches below), and `{ ...undefined }`
  // safely yields `{}`, so the merge works in all cases.
  const merge = (prev: MangaProgressEntry | undefined): MangaProgressEntry =>
    ({ ...prev, ...payload, updatedAt: now }) as MangaProgressEntry;

  // Local mode: no remote, no restoration possible. Just persist.
  if (!client) {
    local.manga[key] = merge(local.manga[key]);
    local.updatedAt = now;
    persistLocal(local, now);
    return "persist-local-only";
  }

  // Cache present → trust local edits, push.
  if (local.manga[key]) {
    local.manga[key] = merge(local.manga[key]);
    local.updatedAt = now;
    persistLocal(local, now);
    await pushProgress(client, gistId, filename, local, now);
    return "push";
  }

  // Cache absent → check remote before clobbering it.
  let remoteStr = "";
  try {
    remoteStr = await client.getGistFile(gistId, filename);
  } catch (_) {
    remoteStr = "";
  }
  const remote = parseProgress(remoteStr, log);
  const remoteEntry = remote.manga[key];
  if (remoteEntry) {
    // Restore from remote — this preserves the source of truth.
    const restored: MangaProgressEntry = { ...remoteEntry };
    local.manga[key] = restored;
    local.updatedAt = now;
    persistLocal(local, now);
    applyToSeanime(restored);
    return "restore";
  }

  // Neither side has it → genuinely new, push it.
  local.manga[key] = merge(undefined);
  local.updatedAt = now;
  persistLocal(local, now);
  await pushProgress(client, gistId, filename, local, now);
  return "push-new";
}
