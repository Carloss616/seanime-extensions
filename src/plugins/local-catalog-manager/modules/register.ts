import { alertActions } from "../../../_components/alert-actions";
import { divider, joinDividers } from "../../../_components/divider";
import { type EntryListRow, entryList } from "../../../_components/entry-list";
import { githubConnect } from "../../../_components/github-connect";
import {
  ALERT_MENU_ITEM_STYLE,
  CAPTION_STYLE,
  LABEL_STYLE,
} from "../../../_components/text";
import { trayHeader } from "../../../_components/tray-header";
import { statusToPill } from "../../../_utils/anilist-status";
import { GITHUB_CLIENT_ID } from "../../../_utils/gist/constants";
import { DeviceFlowClient } from "../../../_utils/gist/device-flow";
import {
  type ClientCacheScope,
  clientCacheQueryKeys,
} from "../utils/client-cache";
import {
  CATALOG_FILENAME,
  GIST_DESCRIPTION,
  K_CATALOG,
  K_DRIFT_FRESH_GIST,
  K_DRIFT_REMOTE,
  K_EXT_ID,
  K_GIST_ID,
  K_NEXT_ID,
  K_OAUTH_TOKEN,
  K_OWNER,
  K_PROGRESS,
  K_PROGRESS_DRIFT_REMOTE,
  K_PROGRESS_UPDATED_AT,
  K_RAW_URL,
  K_SYNC_PAUSED,
  K_UPDATED_AT,
  PROGRESS_FILENAME,
  SHARED_LIB_NAME,
  SILENT_SYNC_COOLDOWN_MS,
  SOURCE_PREFIX,
  STORE_DRIFT_NOTIFIED,
} from "../utils/constants";
import {
  discoverExtId as discoverExtIdImpl,
  localIdFromMediaId as localIdFromMediaIdImpl,
  mediaIdFor as mediaIdForImpl,
  resolveMediaId as resolveMediaIdImpl,
} from "../utils/ext-id";
import {
  type CatalogFormRefs,
  catalogEntryFromFormFields,
  catalogFormFieldsFromEntry,
  readCatalogFormFields,
  writeCatalogFormFields,
} from "../utils/form-entry";
import {
  FORMAT_OPTS,
  MONTH_OPTS,
  PREFERRED_OPTS,
  STATUS_OPTS,
} from "../utils/form-options";
import { ent, formatListStatus, formatTs } from "../utils/format";
import { parseGistId } from "../utils/gist-parse";
import { detectImportKind } from "../utils/import-detect";
import { migrateStorageKeys } from "../utils/migrate";
import { wrapUpdateEntryWithSkip } from "../utils/progress-capture";
import {
  hasEntryProgressDrift as entryHasProgressDrift,
  type SeanimeListData,
} from "../utils/progress-drift";
import { syncProgressRoundTrip } from "../utils/progress-roundtrip";
import { oauthToken, patToken } from "../utils/token";
import type { sharedLib } from "./shared-lib";

export const register = (ctx: $ui.Context) => {
  // Helpers (incl. the custom-source mediaId codec — see CLAUDE.md
  // "Custom-source mediaId encoding") come via $shared so the single
  // canonical implementation is re-evaluated into this UI runtime.
  const {
    createLogger,
    GistClient,
    parseCatalog,
    resolveUserPreferred,
    serializeCatalog,
    mergeCatalog,
    diffCatalog,
    catalogsEqual,
    nextId,
    removeEntry,
    upsertEntry,
    validateEntry,
    decodeLocalId,
    decodeExtId,
    encodeMediaId,
    isCustomSourceId,
    buildMediaIdLookup,
    applyRemote,
    detectOrphans,
    pruneOrphans,
    pullProgress,
    pushProgress,
    parseProgress,
    serializeProgress,
    mergeProgress,
    diffProgress,
  } = $shared.use<ReturnType<typeof sharedLib>>(SHARED_LIB_NAME);
  const log = createLogger();

  // TEMPORARY (see utils/migrate.ts): carry v2.2's lcm_ keys forward. First
  // thing, before any $storage read below.
  migrateStorageKeys();

  const tray = ctx.newTray({ iconUrl: __MANIFEST_ICON__, withContent: true });

  const view = ctx.state<"list" | "form" | "setup">("list");
  const entries = ctx.state<MangaCatalogEntry[]>(
    $storage.get<MangaCatalogEntry[]>(K_CATALOG) ?? [],
  );
  // Seed the id high-water mark from the loaded catalog on first run so a
  // delete-then-add right after upgrade can't reissue the just-deleted id.
  if (!$storage.has(K_NEXT_ID)) {
    $storage.set(K_NEXT_ID, nextId(entries.get()) - 1);
  }
  const editingId = ctx.state<number>(0);
  const rawUrl = ctx.state<string>($storage.get<string>(K_RAW_URL) ?? "");
  const status = ctx.state<string>("");

  const loadProgressDoc = (): LocalProgress =>
    parseProgress($storage.get<LocalProgress>(K_PROGRESS), log);
  const progress = ctx.state<LocalProgress>(loadProgressDoc());
  const progressUpdated = ctx.state<number>(
    $storage.get<number>(K_PROGRESS_UPDATED_AT) ?? 0,
  );
  const progressStatus = ctx.state<string>("");

  const localEntryCount = () => Object.keys(progress.get().manga).length;
  const orphanCount = () => {
    const catalogIds = new Set(entries.get().map((e) => e.id));
    return detectOrphans(progress.get(), catalogIds).length;
  };
  async function pushProgressNow() {
    const gistId = effectiveGistId();
    if (!hasToken() || !gistId) {
      ctx.toast.error("Reading progress sync requires Gist mode");
      return;
    }
    if (hasDrift()) {
      ctx.toast.warning("Resolve catalog drift first (see banner at top)");
      return;
    }
    await runBusy("push-progress", async () => {
      progressStatus.set("Pushing…");
      try {
        const now = Date.now();
        const merged = await pushProgress(
          client(),
          gistId,
          PROGRESS_FILENAME,
          progress.get(),
          now,
        );
        progress.set(merged);
        progressUpdated.set(now);
        $storage.set(K_PROGRESS, merged);
        $storage.set(K_PROGRESS_UPDATED_AT, now);
        progressStatus.set(
          `Pushed ${Object.keys(merged.manga).length} entries`,
        );
      } catch (e) {
        log.warn("push progress failed:", e);
        progressStatus.set(`Push failed: ${String(e)}`);
      }
    });
  }

  async function pullProgressNow() {
    const gistId = effectiveGistId();
    if (!hasToken() || !gistId) {
      ctx.toast.error("Reading progress sync requires Gist mode");
      return;
    }
    if (hasDrift()) {
      ctx.toast.warning("Resolve catalog drift first (see banner at top)");
      return;
    }
    await runBusy("pull-progress", async () => {
      progressStatus.set("Pulling…");
      try {
        const now = Date.now();
        const merged = await pullProgress(
          client(),
          gistId,
          PROGRESS_FILENAME,
          progress.get(),
          now,
        );
        const collection = await ctx.manga.getCollection();
        const lookup = buildMediaIdLookup(
          collection,
          SOURCE_PREFIX,
          decodeLocalId,
          { extId: $storage.get<number>(K_EXT_ID) ?? undefined },
        );
        const res = applyRemote(merged, progress.get(), {
          updateEntry: applyEntryViaSeanime,
          mediaIdByLocalId: lookup,
        });
        progress.set(merged);
        progressUpdated.set(now);
        $storage.set(K_PROGRESS, merged);
        $storage.set(K_PROGRESS_UPDATED_AT, now);
        progressStatus.set(
          `Pulled — applied ${res.applied}${res.skipped ? `, skipped ${res.skipped} orphan(s)` : ""}`,
        );
      } catch (e) {
        log.warn("pull progress failed:", e);
        progressStatus.set(`Pull failed: ${String(e)}`);
      }
    });
  }

  // Reload = fetch remote, merge with local (local wins ties), push merged
  // back so both sides converge. Idempotent.
  async function reloadCatalog() {
    const gistId = effectiveGistId();
    if (!hasToken() || !gistId) {
      ctx.toast.info(
        "Add an entry to create a Gist, or create one in Gist Binding.",
      );
      return;
    }
    if (hasDrift()) {
      ctx.toast.warning("Resolve catalog drift first (see banner at top)");
      return;
    }
    await runBusy("reload-catalog", async () => {
      try {
        const content = await client().getGistFile(gistId, CATALOG_FILENAME);
        const remote = parseCatalog(content, log).manga;
        const now = Date.now();
        const merged = mergeCatalog(entries.get(), remote);
        // Push only when the merge actually changed the remote content.
        // Otherwise we'd write a noise revision differing solely in the
        // envelope updatedAt — what autoSync produced on every tick.
        if (catalogsEqual(merged, remote)) {
          // Keep local in sync with remote without bumping K_UPDATED_AT, so the
          // next manual push doesn't re-serialize a newer date for free.
          persistLocal(merged, $storage.get<number>(K_UPDATED_AT) ?? now);
        } else {
          persistLocal(merged, now);
          await client().updateGistFile(
            gistId,
            CATALOG_FILENAME,
            serializeCatalog(merged, now),
          );
        }
        status.set(`Reloaded · ${ent(merged.length)}`);
        ctx.toast.success(`Catalog reloaded — ${ent(merged.length)}`);
        invalidateClientCaches({ catalog: true });
      } catch (e) {
        ctx.toast.error(`Reload failed: ${(e as Error).message}`);
      }
    });
  }

  // Wrap $anilist.updateEntry with a per-mediaId skip flag so the update
  // doesn't echo back through our own pre/post-update hooks. Without it, each
  // remote-applied entry re-triggered the hooks, which ran an out-of-band
  // pushProgress racing the surrounding sync's updateGistFile — the two then
  // disagreed on updatedAt, so the next pull saw "remote ahead", re-applied,
  // and re-fired the "Synced N progress updates" toast every time.
  const applyEntryViaSeanime = (
    mediaId: number,
    status: $app.AL_MediaListStatus | undefined,
    scoreRaw: number | undefined,
    prog: number | undefined,
  ): void => {
    wrapUpdateEntryWithSkip(mediaId, () => {
      $anilist.updateEntry(
        mediaId,
        status,
        scoreRaw,
        prog,
        undefined,
        undefined,
      );
    });
  };

  async function syncProgressInner(): Promise<{
    applied: number;
    skipped: number;
  }> {
    const gistId = effectiveGistId();
    const now = Date.now();
    const localDoc = progress.get();
    const collection = await ctx.manga.getCollection();
    const lookup = buildMediaIdLookup(
      collection,
      SOURCE_PREFIX,
      decodeLocalId,
      { extId: $storage.get<number>(K_EXT_ID) ?? undefined },
    );
    const result = await syncProgressRoundTrip({
      client: client(),
      gistId,
      filename: PROGRESS_FILENAME,
      local: localDoc,
      now,
      log,
      mediaIdByLocalId: lookup,
      updateEntry: applyEntryViaSeanime,
    });
    progress.set(result.merged);
    progressUpdated.set(now);
    $storage.set(K_PROGRESS, result.merged);
    $storage.set(K_PROGRESS_UPDATED_AT, now);
    if (result.applied > 0) {
      try {
        $anilist.refreshMangaCollection();
      } catch (e) {
        log.warn("refreshMangaCollection failed:", e);
      }
      invalidateClientCaches({ progress: true });
    }
    return { applied: result.applied, skipped: result.skipped };
  }

  // Silent background sync for event-triggered pulls. Toasts only when
  // something actually changed (never on no-op), and a soft cooldown prevents
  // spamming the network when multiple events fire in close succession (e.g.
  // tray.onOpen + navigate both fire within ~1s).
  let lastSilentSyncAt = 0;
  async function pullProgressSilent(reason: string): Promise<void> {
    const gistId = effectiveGistId();
    if (!hasToken() || !gistId) return;
    // Don't fight catalog drift — user needs to resolve that first.
    if (pendingDrift.get()) return;
    // runBusy would race against the user clicking a button — instead skip
    // when anything else is in flight (the next event will retry).
    if (busyAction.get()) return;
    const nowMs = Date.now();
    if (nowMs - lastSilentSyncAt < SILENT_SYNC_COOLDOWN_MS) return;
    lastSilentSyncAt = nowMs;
    try {
      const hadProgressDrift = pendingProgressDrift.get() !== null;
      const res = await syncProgressInner();
      if (hadProgressDrift) {
        pendingProgressDrift.set(null);
        pauseProgressSync(null);
      }
      if (res.applied > 0) {
        ctx.toast.info(
          `Synced ${res.applied} progress update${res.applied === 1 ? "" : "s"} from remote (${reason})`,
        );
      }
    } catch (e) {
      log.warn(`silent pull failed (${reason}):`, e);
    }
  }

  async function reloadProgress() {
    const gistId = effectiveGistId();
    if (!hasToken() || !gistId) {
      ctx.toast.error("Reading progress sync requires Gist mode");
      return;
    }
    // Catalog drift still blocks — a real conflict the user must resolve.
    // Progress drift does NOT block: clicking Reload is implicit consent
    // to the LWW merge, so we silently absorb a pending progress drift and
    // continue. This keeps cross-device sync fluid (the per-entry updatedAt
    // already prevents data loss).
    if (pendingDrift.get()) {
      ctx.toast.warning("Resolve catalog drift first (see banner at top)");
      return;
    }
    await runBusy("reload-progress", async () => {
      progressStatus.set("Reloading…");
      try {
        const hadProgressDrift = pendingProgressDrift.get() !== null;
        const res = await syncProgressInner();
        if (hadProgressDrift) {
          pendingProgressDrift.set(null);
          pauseProgressSync(null);
        }
        progressStatus.set(
          `Reloaded — applied ${res.applied}${res.skipped ? `, skipped ${res.skipped} orphan(s)` : ""}${hadProgressDrift ? " · drift merged" : ""}`,
        );
      } catch (e) {
        log.warn("reload progress failed:", e);
        progressStatus.set(`Reload failed: ${String(e)}`);
      }
    });
  }

  function invalidateClientCaches(opts: ClientCacheScope) {
    const keys = clientCacheQueryKeys(opts);
    if (keys.length === 0) return;
    try {
      $app.invalidateClientQuery(keys);
    } catch (e) {
      log.warn("invalidateClientQuery failed:", e);
    }
  }

  function persistProgress(next: LocalProgress, updatedAt: number) {
    progress.set(next);
    progressUpdated.set(updatedAt);
    $storage.set(K_PROGRESS, next);
    $storage.set(K_PROGRESS_UPDATED_AT, updatedAt);
    const gistId = effectiveGistId();
    if (hasToken() && gistId && !hasDrift()) {
      pushProgress(client(), gistId, PROGRESS_FILENAME, next, updatedAt).catch(
        (e: unknown) => {
          log.warn("progress push failed:", e);
        },
      );
    }
    invalidateClientCaches({ progress: true });
  }

  function cleanOrphans() {
    const catalogIds = new Set(entries.get().map((e) => e.id));
    const orphans = detectOrphans(progress.get(), catalogIds);
    if (!orphans.length) return;
    const now = Date.now();
    persistProgress(pruneOrphans(progress.get(), orphans, now), now);
    progressStatus.set(`Cleaned ${orphans.length} orphan(s)`);
  }

  function deleteOrphan(localId: number) {
    if (!progress.get().manga[String(localId)]) return;
    const now = Date.now();
    persistProgress(pruneOrphans(progress.get(), [localId], now), now);
    progressStatus.set(`Deleted orphan #${localId}`);
  }

  const getMangaSafe = (mediaId: number) => {
    try {
      return $anilist.getManga(mediaId);
    } catch {
      return undefined;
    }
  };

  const extIdDeps = () => ({
    getCachedExtId: () => $storage.get<number>(K_EXT_ID),
    setCachedExtId: (extId: number) => $storage.set(K_EXT_ID, extId),
    getLookupEntry: () => {
      const lookup = mediaIdLookup.get();
      if (!lookup || lookup.size === 0) return undefined;
      return lookup.entries().next().value as [number, number];
    },
    decodeExtId,
    getProbeLocalId: () => entries.get()[0]?.id,
    getManga: getMangaSafe,
    sourcePrefix: SOURCE_PREFIX,
    encodeMediaId,
    sleep: $sleep,
  });

  async function applyProgress(localId: number) {
    const entry = progress.get().manga[String(localId)];
    if (!entry) return;
    await runBusy(`apply-progress-${localId}`, async () => {
      try {
        const mediaId = await resolveMediaIdImpl(localId, extIdDeps());
        if (mediaId == null) {
          ctx.toast.warning(
            `Couldn't resolve seanime mediaId for #${localId}. Make sure the local-catalog custom-source is installed and has this entry.`,
          );
          return;
        }
        // If the manga isn't in the user's list yet, addMediaToCollection
        // creates it as PLANNING — then updateEntry overwrites with the
        // local progress values (status/score/progress). One-shot
        // "add-to-list + apply" instead of forcing the user to do both
        // manually from the manga page.
        const inCollection = mediaIdLookup.get()?.has(localId) ?? false;
        if (!inCollection) {
          $anilist.addMediaToCollection([mediaId]);
        }
        $anilist.updateEntry(
          mediaId,
          entry.status,
          entry.score,
          entry.progress,
          undefined,
          undefined,
        );
        // Refresh seanime's in-process anilist collection cache so getCollection
        // sees the new entry / progress immediately. Required by the docs after
        // any updateEntry / addMediaToCollection call. Also invalidates the
        // client-side React Query caches so the frontend refetches.
        try {
          $anilist.refreshMangaCollection();
        } catch (e) {
          log.warn("refreshMangaCollection failed:", e);
        }
        invalidateClientCaches({ progress: true });
        ctx.toast.success(
          inCollection
            ? `Applied progress for #${localId} to seanime`
            : `Added #${localId} to seanime + applied progress`,
        );
        // Refresh both lookups so the just-applied state hides the push button
        // (no stale "drift detected" badge right after a successful push).
        // goja's Promise interop accepts `await` on getCollection's return
        // but does NOT expose `.then` on it — keep this inline with await.
        try {
          const fresh = await ctx.manga.getCollection();
          refreshLookupsFromCollection(fresh);
        } catch (_) {
          // best-effort refresh, ignore failure
        }
      } catch (e) {
        ctx.toast.error(`Apply failed: ${(e as Error).message}`);
      }
    });
  }

  // Navigate the seanime UI to the manga entry page for this catalog entry.
  // Uses resolveMediaId so the link works even for entries the user hasn't
  // added to their list yet — the encoded mediaId is enough; seanime's
  // /manga/entry page renders straight from the custom-source.
  async function navigateToMangaEntry(localId: number) {
    await runBusy(`open-manga-${localId}`, async () => {
      try {
        const mediaId = await resolveMediaIdImpl(localId, extIdDeps());
        if (mediaId == null) {
          ctx.toast.warning(
            `Couldn't resolve seanime mediaId for #${localId}. Make sure the local-catalog custom-source is installed and has this entry.`,
          );
          return;
        }
        ctx.screen.navigateTo("/manga/entry", { id: String(mediaId) });
        tray.close();
      } catch (e) {
        ctx.toast.error(`Navigation failed: ${(e as Error).message}`);
      }
    });
  }

  // fPreferred picks which of romaji/english/native becomes userPreferred.
  const fRomaji = ctx.fieldRef<string>("");
  const fEnglish = ctx.fieldRef<string>("");
  const fNative = ctx.fieldRef<string>("");
  const fPreferred = ctx.fieldRef<string>("english");
  const fSynonyms = ctx.fieldRef<string>("");
  const fCover = ctx.fieldRef<string>("");
  const fBanner = ctx.fieldRef<string>("");
  const fDescription = ctx.fieldRef<string>("");
  const fGenres = ctx.fieldRef<string>("");
  const fStatus = ctx.fieldRef<string>("");
  const fFormat = ctx.fieldRef<string>("");
  const fChapters = ctx.fieldRef<string>("");
  const fVolumes = ctx.fieldRef<string>("");
  const fYear = ctx.fieldRef<string>("");
  const fMonth = ctx.fieldRef<string>("");
  const fDay = ctx.fieldRef<string>("");
  const fIsAdult = ctx.fieldRef<boolean>(false);
  const fCountry = ctx.fieldRef<string>("");
  const fSiteUrl = ctx.fieldRef<string>("");
  const fIdMal = ctx.fieldRef<string>("");
  const fMeanScore = ctx.fieldRef<string>("");
  const fEndYear = ctx.fieldRef<string>("");
  const fEndMonth = ctx.fieldRef<string>("");
  const fEndDay = ctx.fieldRef<string>("");
  const fJsonIn = ctx.fieldRef<string>("");
  const fGistLink = ctx.fieldRef<string>("");

  const catalogFormRefs: CatalogFormRefs = {
    romaji: fRomaji,
    english: fEnglish,
    native: fNative,
    preferred: fPreferred,
    synonyms: fSynonyms,
    cover: fCover,
    banner: fBanner,
    description: fDescription,
    genres: fGenres,
    status: fStatus,
    format: fFormat,
    chapters: fChapters,
    volumes: fVolumes,
    year: fYear,
    month: fMonth,
    day: fDay,
    endYear: fEndYear,
    endMonth: fEndMonth,
    endDay: fEndDay,
    isAdult: fIsAdult,
    country: fCountry,
    siteUrl: fSiteUrl,
    idMal: fIdMal,
    meanScore: fMeanScore,
  };

  // Armed catalog-entry id for the two-click entry-delete confirmation (0 =
  // none). First ⛔ click arms + warns (progress is lost too); second deletes.
  const deleteArmedId = ctx.state<number>(0);

  // Which gist-binding prompt is open below the header. Empty = none (the
  // binding actions live in the header ⋮ menu). "link" reveals the paste-gist
  // input (can't live inside a dropdown), "delete" the irreversible-confirm
  // banner. The menu items open these; a Cancel / the action itself closes it.
  const bindingPrompt = ctx.state<"" | "link" | "delete">("");

  // Local-only mode: whether the "can't sync directly" limitation + JSON output
  // blocks are expanded. Own toggle (⚠️ header button) since it reveals CONTENT,
  // not actions — unlike Gist mode's ⋮ actions menu.
  const localInfoExpanded = ctx.state<boolean>(false);

  const orphansExpanded = ctx.state<boolean>(false);

  const catalogJsonExpanded = ctx.state<boolean>(false);
  const progressJsonExpanded = ctx.state<boolean>(false);

  // localId → seanime mediaId cache, refreshed on tray.onOpen so renders/nav
  // skip the per-click getCollection() cost. Falls back to a fresh lookup at
  // click time when stale or missing.
  const mediaIdLookup = ctx.state<Map<number, number> | null>(null);

  // localId → seanime's tracked listData for entries in the user's collection.
  // Gates the per-row "📤 push" button: shown only when local progress drifts
  // from seanime's tracked state (or the entry isn't in the list yet), never
  // for already-in-sync rows where pushing is a no-op.
  const seanimeListDataLookup = ctx.state<Map<number, SeanimeListData> | null>(
    null,
  );

  // Single-pass rebuild of both lookups from a freshly fetched collection.
  // Prefers the cached extId for identifying our entries (works even when
  // seanime ships entries without the wrapped siteUrl, which was the cause
  // of the perpetual "📤 push" button on already-synced rows). Falls back
  // to the siteUrl-prefix check when extId hasn't been discovered yet.
  function refreshLookupsFromCollection(collection: $app.Manga_Collection) {
    const extId = $storage.get<number>(K_EXT_ID) ?? undefined;
    mediaIdLookup.set(
      buildMediaIdLookup(collection, SOURCE_PREFIX, decodeLocalId, {
        extId,
      }),
    );
    const listData = new Map<number, SeanimeListData>();
    for (const list of collection.lists ?? []) {
      for (const e of list.entries ?? []) {
        const mid = e.media?.id;
        if (typeof mid !== "number" || !isCustomSourceId(mid)) continue;
        let isOurs = false;
        if (extId != null) {
          isOurs = decodeExtId(mid) === extId;
        } else {
          const su = e.media?.siteUrl ?? "";
          isOurs = su.indexOf(SOURCE_PREFIX) === 0;
        }
        if (!isOurs) continue;
        listData.set(decodeLocalId(mid), e.listData ?? {});
      }
    }
    seanimeListDataLookup.set(listData);
  }

  const entrySearch = ctx.state<string>("");
  const fEntrySearch = ctx.fieldRef<string>("");

  // Drift detection state. Two flavors that can occur independently after
  // linking an existing gist with non-trivial data on both sides:
  //   - pendingDrift          → catalog disagreement (CatalogEntry[])
  //   - pendingProgressDrift  → reading-progress disagreement (ProgressDoc)
  // Until resolved (merge / local-wins / remote-wins / cancel), all sync ops
  // are blocked to avoid clobber.
  const pendingDrift = ctx.state<{
    local: MangaCatalogEntry[];
    remote: MangaCatalogEntry[];
  } | null>(null);
  const pendingProgressDrift = ctx.state<{
    local: LocalProgress;
    remote: LocalProgress;
  } | null>(null);
  // "Has any drift" — used everywhere we gate sync ops. The hooks read
  // K_SYNC_PAUSED for the same effect (cross-runtime), but in-tray code uses
  // this helper to also check the runtime states (in case storage hasn't
  // been written yet on the very first drift transition).
  const hasDrift = () =>
    pendingDrift.get() !== null || pendingProgressDrift.get() !== null;

  // Recompute K_SYNC_PAUSED from the persisted drift remotes. Called from
  // both pauseSync (catalog) and pauseProgressSync (progress) so the flag
  // stays correct when only one of two drifts resolves.
  const recomputeSyncPause = () => {
    const anyDrift =
      $storage.has(K_DRIFT_REMOTE) || $storage.has(K_PROGRESS_DRIFT_REMOTE);
    if (anyDrift) {
      $storage.set(K_SYNC_PAUSED, true);
    } else {
      $storage.remove(K_SYNC_PAUSED);
      // Clear the "drift toast notified" flag so the next drift session
      // gets one fresh notification.
      $store.remove(STORE_DRIFT_NOTIFIED);
    }
  };

  // Persist/clear the CATALOG drift state in $storage so it survives plugin
  // restart (pendingDrift itself is ctx.state — runtime-only).
  // pauseSync(remote, opts):
  //   remote = an array (possibly empty) → drift is active. Hooks fall back
  //            to local-only writes. UI shows drift banner.
  //   remote = null                       → clear drift state.
  // freshGist flag is recorded so cancelDriftLink can also delete the gist
  // we just created (if applicable).
  const pauseSync = (
    remote: MangaCatalogEntry[] | null,
    opts: { freshGist?: boolean } = {},
  ) => {
    if (remote !== null) {
      $storage.set(K_DRIFT_REMOTE, remote);
      if (opts.freshGist) $storage.set(K_DRIFT_FRESH_GIST, true);
    } else {
      $storage.remove(K_DRIFT_REMOTE);
      $storage.remove(K_DRIFT_FRESH_GIST);
    }
    recomputeSyncPause();
  };

  // Sibling of pauseSync for PROGRESS drift. Same persistence contract.
  const pauseProgressSync = (remote: LocalProgress | null) => {
    if (remote !== null) {
      $storage.set(K_PROGRESS_DRIFT_REMOTE, remote);
    } else {
      $storage.remove(K_PROGRESS_DRIFT_REMOTE);
    }
    recomputeSyncPause();
  };

  // On (re)load: restore drift state if it was active before a restart.
  // We check K_DRIFT_REMOTE / K_PROGRESS_DRIFT_REMOTE directly (the source
  // of truth) rather than K_SYNC_PAUSED, so the two drift kinds can be
  // restored independently.
  if ($storage.has(K_DRIFT_REMOTE)) {
    const persistedDriftRemote =
      $storage.get<MangaCatalogEntry[]>(K_DRIFT_REMOTE) ?? [];
    // Self-heal: a persisted drift whose remote now equals local is no longer
    // a conflict (resolved to the same data, or a spurious "both non-empty"
    // flag). Clear it + unpause instead of restoring a dead drift.
    if (catalogsEqual(entries.get(), persistedDriftRemote)) {
      pauseSync(null);
    } else {
      pendingDrift.set({ local: entries.get(), remote: persistedDriftRemote });
    }
  }
  if ($storage.has(K_PROGRESS_DRIFT_REMOTE)) {
    const persistedProgressRemote = $storage.get<LocalProgress>(
      K_PROGRESS_DRIFT_REMOTE,
    );
    if (persistedProgressRemote) {
      // Self-heal (mirror of the catalog path): a persisted progress drift that
      // no longer diverges from local is dead — clear it instead of restoring.
      const pd = diffProgress(progress.get(), persistedProgressRemote);
      if (pd.conflicts === 0 && pd.localOnly === 0 && pd.remoteOnly === 0) {
        pauseProgressSync(null);
      } else {
        pendingProgressDrift.set({
          local: progress.get(),
          remote: persistedProgressRemote,
        });
      }
    }
  }

  // Tag of the currently-running async action ("" when idle). Buttons match
  // their tag to swap to a loading label; a second click while busy short-
  // circuits so we don't queue duplicate ops.
  const busyAction = ctx.state<string>("");
  const connecting = ctx.state<boolean>(false);
  const deviceStart = ctx.state<$gh.Login.DeviceCode | null>(null);
  // Reactive mirror of the device-flow token: $storage reads aren't reactive,
  // so connect/disconnect update this state to re-render the tray. $storage
  // stays authoritative for the hooks (separate runtimes) — both are written.
  const oauthTok = ctx.state<string>(oauthToken());
  const runBusy = async (tag: string, fn: () => Promise<void>) => {
    if (busyAction.get()) {
      ctx.toast.info("Another operation is running — try again in a moment");
      return;
    }
    busyAction.set(tag);
    try {
      await fn();
    } finally {
      busyAction.set("");
    }
  };

  // Effective token: reactive device-flow OAuth mirror wins, else the PAT
  // config field. Reads oauthTok (state) so the render reacts to connect/
  // disconnect; equivalent to utils/token.ts's syncToken() the hooks use.
  const effToken = () => oauthTok.get() || patToken();
  const hasToken = () => effToken().length > 0;
  const client = () => new GistClient(effToken(), (u, i) => ctx.fetch(u, i));

  // MIGRATION (one-shot): legacy `gistUrl` userConfig field is gone from the
  // manifest. Existing installs may still have a value set; copy the parsed
  // id into $storage so the modern code path picks it up. New installs hit
  // the empty branch and stay there.
  const legacyGistUrl = ($getUserPreference("gistUrl") ?? "").trim();
  if (legacyGistUrl && !$storage.get<string>(K_GIST_ID)) {
    const parsed = parseGistId(legacyGistUrl);
    if (parsed) {
      $storage.set(K_GIST_ID, parsed);
      log.log("migrated legacy gistUrl config to $storage");
    }
  }
  const effectiveGistId = (): string => $storage.get<string>(K_GIST_ID) ?? "";

  // GitHub OAuth Device Flow. The HTTP POSTs live in DeviceFlowClient; this
  // owns the poll cadence + UI state.
  // ponytail: the poll loop BLOCKS the UI runtime via $sleep between polls
  // (there is no setTimeout). Bounded by expires_in so it can't hang forever —
  // acceptable for a user-initiated one-time connect.
  async function connectGitHub(): Promise<void> {
    if (connecting.get()) return;
    connecting.set(true);
    try {
      const auth = new DeviceFlowClient(GITHUB_CLIENT_ID, (u, i) =>
        ctx.fetch(u, i),
      );
      const parsed = await auth.requestDeviceCode("gist");
      if (!parsed.ok) {
        ctx.toast.error(`GitHub login failed: ${parsed.message}`);
        return;
      }
      deviceStart.set(parsed.start);
      const result = await auth.pollUntilToken(parsed.start, {
        sleep: (ms) => $sleep(ms),
      });
      if (result.type === "token") {
        $storage.set(K_OAUTH_TOKEN, result.token);
        oauthTok.set(result.token);
        ctx.toast.success("Connected to GitHub");
      } else if (result.type === "error") {
        ctx.toast.error(`GitHub login failed: ${result.message}`);
      } else {
        ctx.toast.error("GitHub login timed out — try again");
      }
    } catch (e) {
      log.warn("connectGitHub failed:", e);
      ctx.toast.error(`GitHub login failed: ${(e as Error).message}`);
    } finally {
      deviceStart.set(null);
      connecting.set(false);
    }
  }

  // Reset the armed "Delete remotely" state. Called from every other event
  // handler so accidental arms don't linger.
  const disarmDelete = () => {
    if (bindingPrompt.get() === "delete") bindingPrompt.set("");
    if (deleteArmedId.get() !== 0) deleteArmedId.set(0);
  };

  // Wipe all gist-related local state (cache + binding). Used by both
  // unlinkGist and the post-delete cleanup. Catalog + progress are LOCAL data,
  // not gist-derived — both survive an unlink or remote delete so the user
  // can re-link to a different gist later without losing their work.
  const clearGistLocalState = () => {
    $storage.remove(K_GIST_ID);
    $storage.remove(K_OWNER);
    $storage.remove(K_RAW_URL);
    rawUrl.set("");
    // Any pending drift was against the gist we're now forgetting (unlink /
    // remote-delete) — clear both kinds + unpause so their banners don't linger
    // after the binding is gone (they'd otherwise stay until resolved).
    pendingDrift.set(null);
    pauseSync(null);
    pendingProgressDrift.set(null);
    pauseProgressSync(null);
  };

  async function createGistNow() {
    disarmDelete();
    if (!hasToken()) {
      ctx.toast.error("Add a GitHub token first");
      return;
    }
    if (effectiveGistId()) {
      ctx.toast.info("Already linked — unlink first to create a new one");
      return;
    }
    await runBusy("create-gist", async () => {
      try {
        const localEntries = entries.get();
        // Seed with an empty catalog so the gist file is valid JSON immediately.
        const initial = serializeCatalog([], Date.now());
        const info = await client().createGist(
          CATALOG_FILENAME,
          initial,
          GIST_DESCRIPTION,
        );
        $storage.set(K_GIST_ID, info.id);
        $storage.set(K_OWNER, info.owner);
        $storage.set(K_RAW_URL, info.rawUrl);
        rawUrl.set(info.rawUrl);
        if (localEntries.length > 0) {
          // Local data exists — the new gist is empty, so the next push would
          // overwrite that emptiness onto remote. Surface the drift UI so the
          // user picks explicitly (and flag the gist as 'fresh' so Cancel can
          // delete the empty orphan from GitHub).
          pendingDrift.set({ local: localEntries, remote: [] });
          pauseSync([], { freshGist: true });
          ctx.toast.warning(
            `Created gist ${info.id} — ${ent(localEntries.length)} local pending. Resolve in tray.`,
          );
        } else {
          ctx.toast.success(`Created gist ${info.id}`);
        }
      } catch (e) {
        ctx.toast.error(`Create failed: ${(e as Error).message}`);
      }
    });
  }

  async function linkExistingGist() {
    disarmDelete();
    if (!hasToken()) {
      ctx.toast.error("Add a GitHub token first");
      return;
    }
    const input = (fGistLink.current ?? "").trim();
    if (!input) {
      ctx.toast.error("Paste a gist URL or ID");
      return;
    }
    const parsed = parseGistId(input);
    if (!parsed) {
      ctx.toast.error("Couldn't parse a gist ID from that input");
      return;
    }
    await runBusy("link-gist", async () => {
      // Fetch remote to detect drift vs local. We bind the gist BEFORE the
      // fetch so users can see "linked" state even if the fetch errors;
      // they can then use Pull / Unlink as appropriate.
      $storage.set(K_GIST_ID, parsed);
      $storage.set(K_OWNER, "");
      $storage.set(K_RAW_URL, "");
      rawUrl.set("");
      fGistLink.setValue("");
      bindingPrompt.set("");

      let remote: MangaCatalogEntry[] = [];
      try {
        // getGistFileWithInfo returns owner + computed raw URL in the same
        // GET we'd already be making — persist them so "Show raw catalog
        // URL" works right away (the empty K_RAW_URL from the pre-fetch bind
        // was the cause of "Raw URL not stored yet" after every link).
        const info = await client().getGistFileWithInfo(
          parsed,
          CATALOG_FILENAME,
        );
        $storage.set(K_OWNER, info.owner);
        $storage.set(K_RAW_URL, info.rawUrl);
        rawUrl.set(info.rawUrl);
        remote = parseCatalog(info.content, log).manga;
      } catch (e) {
        ctx.toast.error(
          `Linked, but couldn't fetch remote catalog: ${(e as Error).message}. Use Pull to retry.`,
        );
        return;
      }

      const local = entries.get();
      // Both empty → trivial silent link. Still pull progress in case there's
      // remote reading-progress from a previous catalog state.
      if (remote.length === 0 && local.length === 0) {
        await syncProgressOnLink(parsed, "both empty");
        return;
      }
      // Local empty + remote has entries → auto-pull (no data lost).
      if (local.length === 0) {
        persistLocal(remote, Date.now());
        await syncProgressOnLink(
          parsed,
          `pulled ${ent(remote.length)} from remote`,
        );
        return;
      }
      // Both sides hold the same data → nothing to resolve. Flagging drift
      // here is the bug where re-linking a clean gist paused sync forever.
      if (catalogsEqual(local, remote)) {
        await syncProgressOnLink(parsed, `in sync — ${ent(local.length)}`);
        return;
      }
      // Any other state (both have, OR local-has + remote-empty) is a real
      // mismatch — pushing/pulling would be destructive in one direction.
      // Surface the drift UI so the user picks explicitly + pause sync so
      // hooks don't clobber remote with local updates in the meantime.
      // Progress sync is DEFERRED until drift resolves: applyRemote uses the
      // catalog→mediaId lookup, which is unstable while drift is pending.
      pendingDrift.set({ local, remote });
      pauseSync(remote);
      ctx.toast.warning(
        `Drift detected: local ${ent(local.length)} vs remote ${ent(remote.length)}. Resolve in tray.`,
      );
    });
  }

  // Best-effort progress pull after a successful catalog link. Folds the
  // result into a single user-facing toast so the link feels atomic. Failure
  // here is non-fatal — the user can hit Reload progress later.
  //
  // Mirror of the catalog drift path: if BOTH local and remote progress
  // have entries, defer auto-merge and surface the progress drift banner
  // (let the user pick Merge / Local / Remote / Cancel explicitly). When
  // only one side has data — or both are empty — we auto-merge silently
  // since LWW per-entry can't lose information.
  async function syncProgressOnLink(
    gistId: string,
    catalogSummary: string,
  ): Promise<void> {
    try {
      const gistIdNow = effectiveGistId();
      if (!gistIdNow) {
        ctx.toast.success(`Linked to gist ${gistId} — ${catalogSummary}.`);
        return;
      }
      // Pull remote without merging yet so we can compare.
      let remoteRaw = "";
      try {
        remoteRaw = await client().getGistFile(gistIdNow, PROGRESS_FILENAME);
      } catch (_) {
        remoteRaw = "";
      }
      const remote = parseProgress(remoteRaw, log);
      const local = progress.get();
      const localCount = Object.keys(local.manga).length;
      const remoteCount = Object.keys(remote.manga).length;
      const d = diffProgress(local, remote);
      // Only a REAL divergence is a drift. Re-linking the SAME gist (or any
      // identical state) yields no diff — surfacing a banner there was the bug
      // where relinking a clean gist always nagged. Mirror catalogsEqual above.
      const progressDiverges =
        d.conflicts > 0 || d.localOnly > 0 || d.remoteOnly > 0;
      if (localCount > 0 && remoteCount > 0 && progressDiverges) {
        pendingProgressDrift.set({ local, remote });
        pauseProgressSync(remote);
        ctx.toast.warning(
          `Linked to gist ${gistId} — ${catalogSummary}. Progress drift: ${localCount} local vs ${remoteCount} remote (${d.conflicts} in conflict). Resolve in tray.`,
        );
        return;
      }
      const res = await syncProgressInner();
      const progSummary = `applied ${res.applied}${res.skipped ? `, skipped ${res.skipped} orphan(s)` : ""}`;
      ctx.toast.success(
        `Linked to gist ${gistId} — ${catalogSummary}. Progress ${progSummary}.`,
      );
    } catch (e) {
      log.warn("progress sync after link failed:", e);
      ctx.toast.warning(
        `Linked to gist ${gistId} — ${catalogSummary}. Progress sync failed: ${(e as Error).message}. Use Reload progress to retry.`,
      );
    }
  }

  function unlinkGist() {
    disarmDelete();
    if (!effectiveGistId()) return;
    clearGistLocalState();
    ctx.toast.success(
      "Unlinked. Catalog + reading progress kept locally. Create or link a gist to push them.",
    );
  }

  async function resolveDrift(mode: "merge" | "local" | "remote") {
    const drift = pendingDrift.get();
    if (!drift) return;
    await runBusy("resolve-drift", async () => {
      const now = Date.now();
      let resolved: MangaCatalogEntry[];
      if (mode === "merge") resolved = mergeCatalog(drift.local, drift.remote);
      else if (mode === "local") resolved = drift.local;
      else resolved = drift.remote;
      persistLocal(resolved, now);
      pendingDrift.set(null);
      pauseSync(null);
      // Push the resolved catalog so remote matches local immediately
      // (otherwise the next push could surprise the user again).
      const gistId = effectiveGistId();
      if (gistId) {
        try {
          await client().updateGistFile(
            gistId,
            CATALOG_FILENAME,
            serializeCatalog(resolved, now),
          );
          ctx.toast.success(
            `Drift resolved (${mode}) — ${ent(resolved.length)} on both sides`,
          );
          // Flush custom-source cache so the resolved catalog is visible
          // immediately rather than after the configured `cacheMinutes` TTL.
          invalidateClientCaches({ catalog: true });
        } catch (e) {
          ctx.toast.error(
            `Resolved locally but push failed: ${(e as Error).message}. Use Pull to retry.`,
          );
        }
      } else {
        ctx.toast.success(`Drift resolved (${mode})`);
      }
    });
  }

  // Progress drift resolution — sibling of resolveDrift, runs LWW merge OR
  // takes one side wholesale, then applies remote-side changes to seanime
  // and pushes the resolved doc to remote. Same Merge/Local/Remote/Cancel
  // contract, but Cancel here just defers (leaves drift pending) rather
  // than reverting the link — the gist link itself is fine, only the
  // progress sync is undecided.
  async function resolveProgressDrift(mode: "merge" | "local" | "remote") {
    const drift = pendingProgressDrift.get();
    if (!drift) return;
    await runBusy("resolve-progress-drift", async () => {
      const now = Date.now();
      let resolved: LocalProgress;
      if (mode === "merge") {
        resolved = mergeProgress(drift.local, drift.remote, now);
      } else if (mode === "local") {
        resolved = { ...drift.local, updatedAt: now };
      } else {
        resolved = { ...drift.remote, updatedAt: now };
      }
      try {
        const collection = await ctx.manga.getCollection();
        const lookup = buildMediaIdLookup(
          collection,
          SOURCE_PREFIX,
          decodeLocalId,
          { extId: $storage.get<number>(K_EXT_ID) ?? undefined },
        );
        const res = applyRemote(resolved, drift.local, {
          updateEntry: applyEntryViaSeanime,
          mediaIdByLocalId: lookup,
        });
        // Persist locally + push to gist. Clear drift state first so
        // persistProgress doesn't get blocked by the paused-sync guard.
        pendingProgressDrift.set(null);
        pauseProgressSync(null);
        persistProgress(resolved, now);
        const gistId = effectiveGistId();
        if (gistId) {
          try {
            await client().updateGistFile(
              gistId,
              PROGRESS_FILENAME,
              serializeProgress(resolved),
            );
          } catch (e) {
            log.warn("push after progress drift resolve failed:", e);
          }
        }
        ctx.toast.success(
          `Progress drift resolved (${mode}) — applied ${res.applied}${res.skipped ? `, skipped ${res.skipped} orphan(s)` : ""}`,
        );
      } catch (e) {
        ctx.toast.error(
          `Progress drift resolve failed: ${(e as Error).message}`,
        );
      }
    });
  }

  // Cancel the pending progress drift WITHOUT touching the gist link or
  // local data. Hooks resume normal push behavior immediately. Used when
  // the user wants to defer the decision (catalog drift cancel reverts
  // the whole link; progress cancel is lighter — the catalog is already
  // committed, only progress sync is on hold).
  function cancelProgressDrift() {
    if (!pendingProgressDrift.get()) return;
    pendingProgressDrift.set(null);
    pauseProgressSync(null);
    ctx.toast.info(
      "Progress drift dismissed. Local progress kept; remote untouched. Use Reload progress later to retry.",
    );
  }

  function cancelDriftLink() {
    // Revert the link entirely so the user's pre-link state is restored. If
    // we just created the gist for this drift session (freshGist flag),
    // also delete it from GitHub so we don't leave an empty orphan.
    const wasFresh = $storage.get<boolean>(K_DRIFT_FRESH_GIST) === true;
    const gistId = effectiveGistId();
    pendingDrift.set(null);
    pauseSync(null);
    $storage.remove(K_GIST_ID);
    $storage.remove(K_OWNER);
    $storage.remove(K_RAW_URL);
    rawUrl.set("");
    if (wasFresh && gistId) {
      // Fire-and-forget delete; user can clean up manually if it fails.
      client()
        .deleteGist(gistId)
        .then(() => {
          log.log(`cleaned up fresh gist ${gistId}`);
        })
        .catch((e) => {
          log.warn("cleanup of fresh gist failed:", e);
        });
      ctx.toast.info(
        "Link cancelled. Local catalog kept. Empty gist deleted from GitHub.",
      );
    } else {
      ctx.toast.info("Link cancelled. Local catalog kept unchanged.");
    }
  }

  async function deleteGistRemotely() {
    const gistId = effectiveGistId();
    if (!gistId || !hasToken()) {
      bindingPrompt.set("");
      return;
    }
    await runBusy("delete-gist", async () => {
      try {
        await client().deleteGist(gistId);
        clearGistLocalState();
        bindingPrompt.set("");
        ctx.toast.success(
          `Deleted gist ${gistId} from GitHub. Local catalog + progress kept.`,
        );
      } catch (e) {
        ctx.toast.error(`Delete failed: ${(e as Error).message}`);
      }
    });
  }

  function persistLocal(next: MangaCatalogEntry[], updatedAt: number) {
    entries.set(next);
    $storage.set(K_CATALOG, next);
    $storage.set(K_UPDATED_AT, updatedAt);
    // Keep the high-water mark ahead of every id ever persisted (covers
    // imports and pulls), so it never regresses when entries are deleted.
    const hw = $storage.get<number>(K_NEXT_ID) ?? 0;
    $storage.set(K_NEXT_ID, Math.max(hw, nextId(next) - 1));
    invalidateClientCaches({ catalog: true });
  }

  // Allocate a brand-new id that has never been used. Monotonic via the
  // persisted high-water mark — never reuses a deleted entry's id (see K_NEXT_ID).
  function allocId(): number {
    const hw = $storage.get<number>(K_NEXT_ID) ?? 0;
    const id = Math.max(hw, nextId(entries.get()) - 1) + 1;
    $storage.set(K_NEXT_ID, id);
    return id;
  }

  async function push(next: MangaCatalogEntry[]) {
    const updatedAt = Date.now();
    if (!hasToken()) {
      // Local-only mode: persist on this device. The user copies the
      // serialized JSON into the source's Inline catalog field by hand.
      persistLocal(next, updatedAt);
      status.set(next.length > 0 ? `Saved ${ent(next.length)} locally` : "");
      return;
    }
    if (hasDrift()) {
      ctx.toast.warning("Resolve catalog drift first (see banner at top)");
      return;
    }
    await runBusy("push-catalog", async () => {
      const json = serializeCatalog(next, updatedAt);
      try {
        let gistId = effectiveGistId();
        if (!gistId) {
          const info = await client().createGist(
            CATALOG_FILENAME,
            json,
            GIST_DESCRIPTION,
          );
          $storage.set(K_GIST_ID, info.id);
          $storage.set(K_OWNER, info.owner);
          $storage.set(K_RAW_URL, info.rawUrl);
          rawUrl.set(info.rawUrl);
          gistId = info.id;
          ctx.toast.success("Created Gist. Copy the raw URL into the source.");
        } else {
          await client().updateGistFile(gistId, CATALOG_FILENAME, json);
        }
        persistLocal(next, updatedAt);
        status.set(`Synced ${ent(next.length)}`);
        // Flush the custom-source cache so the next search reflects the
        // pushed catalog without waiting for its `cacheMinutes` TTL.
        invalidateClientCaches({ catalog: true });
      } catch (e) {
        ctx.toast.error(`Sync failed: ${(e as Error).message}`);
      }
    });
  }

  async function pull() {
    const gistId = effectiveGistId();
    if (!effToken() || !gistId) {
      ctx.toast.info("Nothing to pull yet — add an entry to create the Gist.");
      return;
    }
    if (hasDrift()) {
      ctx.toast.warning("Resolve catalog drift first (see banner at top)");
      return;
    }
    await runBusy("pull-catalog", async () => {
      try {
        const content = await client().getGistFile(gistId, CATALOG_FILENAME);
        const remote = parseCatalog(content, log).manga;
        persistLocal(remote, Date.now());
        ctx.toast.success(`Pulled ${ent(remote.length)}`);
      } catch (e) {
        ctx.toast.error(`Pull failed: ${(e as Error).message}`);
      }
    });
  }

  // Delete a catalog entry. The entry's progress is ALWAYS pruned in the same
  // op: ids are never reissued (allocId is monotonic), but a future pull/import
  // could legitimately reintroduce this id, and stale orphan progress would
  // then bind to it. The delete button warns about the loss first (two-click).
  function deleteEntry(id: number) {
    if (progress.get().manga[String(id)]) {
      const now = Date.now();
      persistProgress(pruneOrphans(progress.get(), [id], now), now);
    }
    void push(removeEntry(entries.get(), id));
  }

  function openForm(id: number) {
    editingId.set(id);
    const e = entries.get().find((x) => x.id === id);
    writeCatalogFormFields(catalogFormRefs, catalogFormFieldsFromEntry(e));
    view.set("form");
  }

  ctx.registerEventHandler("lcm-new", () => {
    disarmDelete();
    openForm(0);
  });
  ctx.registerEventHandler("lcm-cancel", () => {
    disarmDelete();
    view.set("list");
  });
  ctx.registerEventHandler("lcm-pull", () => {
    disarmDelete();
    void pull();
  });
  ctx.registerEventHandler("lcm-push-progress", () => {
    disarmDelete();
    void pushProgressNow();
  });
  ctx.registerEventHandler("lcm-pull-progress", () => {
    disarmDelete();
    void pullProgressNow();
  });
  ctx.registerEventHandler("lcm-reload-catalog", () => {
    disarmDelete();
    void reloadCatalog();
  });
  ctx.registerEventHandler("lcm-reload-progress", () => {
    disarmDelete();
    void reloadProgress();
  });
  ctx.registerEventHandler("lcm-clean-orphans", () => {
    disarmDelete();
    cleanOrphans();
  });
  ctx.registerEventHandler("lcm-create-gist", () => {
    void createGistNow();
  });
  ctx.registerEventHandler("lcm-link-gist", () => {
    void linkExistingGist();
  });
  ctx.registerEventHandler("lcm-drift-merge", () => {
    void resolveDrift("merge");
  });
  ctx.registerEventHandler("lcm-drift-local-wins", () => {
    void resolveDrift("local");
  });
  ctx.registerEventHandler("lcm-drift-remote-wins", () => {
    void resolveDrift("remote");
  });
  ctx.registerEventHandler("lcm-drift-cancel", () => {
    cancelDriftLink();
  });
  ctx.registerEventHandler("lcm-progress-drift-merge", () => {
    void resolveProgressDrift("merge");
  });
  ctx.registerEventHandler("lcm-progress-drift-local-wins", () => {
    void resolveProgressDrift("local");
  });
  ctx.registerEventHandler("lcm-progress-drift-remote-wins", () => {
    void resolveProgressDrift("remote");
  });
  ctx.registerEventHandler("lcm-progress-drift-cancel", () => {
    cancelProgressDrift();
  });
  ctx.registerEventHandler("lcm-unlink-gist", () => {
    unlinkGist();
  });
  ctx.registerEventHandler("lcm-show-raw-url", () => {
    disarmDelete();
    const url = rawUrl.get();
    if (!url) {
      ctx.toast.info(
        "Raw URL not stored yet — push once or pull to fetch it from GitHub",
      );
      return;
    }
    try {
      ctx.dom.clipboard.write(url);
      ctx.toast.success(`Raw URL copied — ${url}`);
    } catch (e) {
      log.warn("clipboard write failed:", e);
      ctx.toast.info(url);
    }
  });
  ctx.registerEventHandler("lcm-binding-link-open", () => {
    bindingPrompt.set("link");
  });
  ctx.registerEventHandler("lcm-binding-delete-open", () => {
    bindingPrompt.set("delete");
  });
  ctx.registerEventHandler("lcm-binding-cancel", () => {
    bindingPrompt.set("");
    fGistLink.setValue("");
  });
  ctx.registerEventHandler("lcm-toggle-local", () => {
    localInfoExpanded.set(!localInfoExpanded.get());
  });
  ctx.registerEventHandler("lcm-delete-gist-confirm", () => {
    void deleteGistRemotely();
  });
  ctx.registerEventHandler("lcm-connect-github", () => {
    void connectGitHub();
  });
  ctx.registerEventHandler("lcm-disconnect-github", () => {
    // Clear the device-flow token only. If a PAT is also set the plugin stays
    // in Gist mode via that; the gist binding is untouched so re-connecting
    // re-uses it. oauthTok.set drives the re-render ($storage isn't reactive).
    $storage.set(K_OAUTH_TOKEN, "");
    oauthTok.set("");
    // If a PAT remains we're still connected + syncing via it, so a real
    // pending drift must stay. Only when FULLY disconnecting (no PAT) do we drop
    // the drift state — otherwise its banner would resurface on reconnect even
    // though local mode hid it. The divergence re-detects on the next reload.
    if (!patToken()) {
      pendingDrift.set(null);
      pauseSync(null);
      pendingProgressDrift.set(null);
      pauseProgressSync(null);
      bindingPrompt.set("");
    }
    ctx.toast.info(
      patToken()
        ? "GitHub login cleared (still connected via PAT config)"
        : "Disconnected from GitHub",
    );
  });
  ctx.registerEventHandler("lcm-toggle-orphans", () => {
    disarmDelete();
    orphansExpanded.set(!orphansExpanded.get());
  });
  ctx.registerEventHandler("lcm-toggle-catalog-json", () => {
    catalogJsonExpanded.set(!catalogJsonExpanded.get());
  });
  ctx.registerEventHandler("lcm-toggle-progress-json", () => {
    progressJsonExpanded.set(!progressJsonExpanded.get());
  });
  ctx.registerEventHandler("lcm-entry-search", () => {
    disarmDelete();
    entrySearch.set((fEntrySearch.current ?? "").trim());
  });
  ctx.registerEventHandler("lcm-entry-search-clear", () => {
    disarmDelete();
    entrySearch.set("");
    fEntrySearch.setValue("");
  });

  ctx.registerEventHandler("lcm-save", () => {
    const current = entries.get();
    const id = editingId.get() > 0 ? editingId.get() : allocId();
    const existing = current.find((x) => x.id === id);
    const entry = catalogEntryFromFormFields(
      id,
      existing,
      readCatalogFormFields(catalogFormRefs),
    );
    const err = validateEntry(entry);
    if (err) {
      ctx.toast.error(err);
      return;
    }
    const next = upsertEntry(current, entry);
    view.set("list");
    void push(next);
  });

  // Single import handler — auto-detects catalog vs progress and dispatches
  // to the right merge / replace path. Merge semantics:
  //   catalog → mergeCatalog(local, imported)  // local wins on id conflicts
  //   progress → mergeProgress(local, imported) // per-entry LWW by updatedAt
  // Replace wipes the corresponding doc and uses the imported one as-is.
  const importFromField = (mode: "merge" | "replace") => {
    const raw = (fJsonIn.current ?? "").trim();
    if (!raw) {
      ctx.toast.error("Paste a catalog or progress JSON first.");
      return;
    }
    const kind = detectImportKind(raw);
    if (kind === "invalid") {
      ctx.toast.error(
        "Unrecognized JSON shape — expected a catalog or progress dump.",
      );
      return;
    }
    try {
      if (kind === "catalog") {
        const imported = parseCatalog(raw, log).manga;
        if (imported.length === 0) {
          ctx.toast.error("Catalog JSON has no valid entries.");
          return;
        }
        const next =
          mode === "merge" ? mergeCatalog(entries.get(), imported) : imported;
        void push(next);
        fJsonIn.setValue("");
        ctx.toast.success(
          mode === "merge"
            ? `Catalog merged · ${ent(next.length)} total`
            : `Catalog replaced · ${ent(next.length)}`,
        );
      } else {
        const imported = parseProgress(raw, log);
        const importedCount = Object.keys(imported.manga).length;
        if (importedCount === 0) {
          ctx.toast.error("Progress JSON has no entries.");
          return;
        }
        const now = Date.now();
        const next =
          mode === "merge"
            ? mergeProgress(progress.get(), imported, now)
            : { ...imported, updatedAt: now };
        persistProgress(next, now);
        fJsonIn.setValue("");
        const finalCount = Object.keys(next.manga).length;
        ctx.toast.success(
          mode === "merge"
            ? `Progress merged · ${finalCount} entries (LWW)`
            : `Progress replaced · ${finalCount} entries`,
        );
      }
    } catch (e) {
      ctx.toast.error(`Import failed: ${(e as Error).message}`);
    }
  };
  ctx.registerEventHandler("lcm-import-merge", () => importFromField("merge"));
  ctx.registerEventHandler("lcm-import-replace", () =>
    importFromField("replace"),
  );

  const sectionHeader = (label: string) =>
    tray.text(label, { style: LABEL_STYLE });

  const statCard = (value: string, label: string) =>
    tray.stack(
      [
        tray.text(value, {
          style: {
            fontWeight: "700",
            fontSize: "1.3rem",
            lineHeight: "1.3",
          },
        }),
        tray.text(label, { style: LABEL_STYLE }),
      ],
      {
        gap: 1,
        style: {
          flex: "1",
          padding: "12px",
          borderRadius: "6px",
          background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.06)",
          minWidth: "0",
        },
      },
    );

  function hasEntryProgressDrift(localId: number): boolean {
    return entryHasProgressDrift(
      progress.get().manga[String(localId)],
      seanimeListDataLookup.get()?.get(localId),
      seanimeListDataLookup.get() != null,
    );
  }

  function renderProgressSection() {
    // In local mode the stat cards still work (progress is cached in $storage
    // by the hooks); only the reload button hides, as there's no remote.
    const linked = hasToken() && !!effectiveGistId();
    const oCount = orphanCount();
    const oExpanded = orphansExpanded.get();
    const headerActions: unknown[] = [];
    if (linked) {
      headerActions.push(
        tray.button(
          busyAction.get() === "reload-progress" ? "Reloading…" : "↻ Reload",
          {
            onClick: "lcm-reload-progress",
            size: "sm",
            loading: busyAction.get() === "reload-progress",
          },
        ),
      );
    }
    if (oCount > 0) {
      headerActions.push(
        tray.tooltip(
          tray.button(`⚠️ ${oCount} orphan${oCount === 1 ? "" : "s"}`, {
            onClick: "lcm-toggle-orphans",
            size: "sm",
            intent: "warning-subtle",
          }),
          {
            text: oExpanded
              ? "Collapse orphan list"
              : "Expand to delete or apply each orphan",
          },
        ),
      );
    }
    const sub: unknown[] = [
      tray.flex(
        [
          tray.div([sectionHeader("📖 READING PROGRESS")], {
            style: { flex: "1", alignSelf: "center" },
          }),
          ...headerActions,
        ],
        { gap: 2, style: { alignItems: "center" } },
      ),
      tray.flex(
        [
          statCard(String(localEntryCount()), "local entries"),
          statCard(formatTs(progressUpdated.get()), "last updated"),
        ],
        { gap: 2 },
      ),
    ];
    if (oCount > 0 && oExpanded) {
      const catalogIds = new Set(entries.get().map((e) => e.id));
      const orphanIds = detectOrphans(progress.get(), catalogIds);
      const orphanRows = orphanIds.map((id) => {
        const e = progress.get().manga[String(id)] ?? { updatedAt: 0 };
        const parts: string[] = [];
        if (e.status) parts.push(e.status.toLowerCase());
        if (e.progress != null) parts.push(`prog ${e.progress}`);
        if (e.score != null) parts.push(`score ${e.score}`);
        const summary = parts.length > 0 ? parts.join(" · ") : "(no data)";
        const applyBusy = busyAction.get() === `apply-progress-${id}`;
        return tray.flex(
          [
            tray.div(
              [
                tray.span(`#${id}`, {
                  style: { fontWeight: "600", fontSize: "0.8rem" },
                }),
                tray.span(`  ${summary}`, {
                  style: { fontSize: "0.75rem", opacity: "0.65" },
                }),
              ],
              { style: { flex: "1", alignSelf: "center", minWidth: "0" } },
            ),
            tray.tooltip(
              tray.button(applyBusy ? "…" : "📤", {
                onClick: ctx.eventHandler(`lcm-apply-progress-${id}`, () => {
                  void applyProgress(id);
                }),
                size: "sm",
                loading: applyBusy,
              }),
              {
                text: "Try to apply this progress to seanime (works if catalog entry was re-added with same id)",
              },
            ),
            tray.tooltip(
              tray.button("⛔", {
                onClick: ctx.eventHandler(`lcm-orphan-delete-${id}`, () => {
                  deleteOrphan(id);
                }),
                size: "sm",
                intent: "alert-subtle",
              }),
              { text: "Delete this orphan from progress.json" },
            ),
          ],
          {
            gap: 2,
            style: {
              alignItems: "center",
              padding: "8px",
              borderRadius: "4px",
              background: "rgba(255,255,255,0.02)",
            },
          },
        );
      });
      sub.push(
        tray.stack(orphanRows, { gap: 2 }),
        tray.flex(
          [
            tray.button("⛔ Delete all orphans", {
              onClick: "lcm-clean-orphans",
              size: "sm",
              intent: "alert-subtle",
            }),
          ],
          { style: { justifyContent: "flex-end" } },
        ),
      );
    }
    if (progressStatus.get()) {
      sub.push(
        tray.text(progressStatus.get(), {
          style: {
            fontSize: "0.75rem",
            opacity: "0.6",
            fontStyle: "italic",
          },
        }),
      );
    }
    return tray.stack(sub, { gap: 2 });
  }

  function renderConnect(): unknown {
    const start = deviceStart.get();
    const oauth = oauthTok.get(); // reactive
    const connected = hasToken();
    const via = oauth ? "GitHub login" : patToken() ? "PAT" : "";
    return githubConnect(tray, {
      deviceStart: start,
      title: "🌐 Sync",
      connecting: connecting.get(),
      connected,
      // Only a device-flow token is clearable from the tray; a PAT lives in
      // config, so PAT-only shows the status but no Disconnect button.
      disconnectable: !!oauth,
      connectEvent: "lcm-connect-github",
      disconnectEvent: "lcm-disconnect-github",
      status: { connected, via },
      connectHint: "or set a GitHub PAT in the plugin config",
    });
  }

  function renderBindingPrompt(): unknown {
    if (!hasToken()) return null;
    const gid = effectiveGistId();
    const prompt = bindingPrompt.get();
    // "Link existing gist…" — hosts the paste input, which can't live inside the
    // ⋮ dropdown. Only meaningful while unlinked; a successful link clears it.
    if (prompt === "link" && !gid) {
      const linkBusy = busyAction.get() === "link-gist";
      return tray.flex(
        [
          tray.div(
            [tray.input("Paste gist URL or ID", { fieldRef: fGistLink })],
            { style: { flex: "1", minWidth: "0" } },
          ),
          tray.button(linkBusy ? "Linking…" : "🔗 Link", {
            onClick: "lcm-link-gist",
            size: "sm",
            loading: linkBusy,
          }),
          tray.button("Cancel", {
            onClick: "lcm-binding-cancel",
            size: "sm",
            intent: "gray-subtle",
          }),
        ],
        {
          gap: 2,
          style: {
            alignItems: "end",
          },
        },
      );
    }
    if (prompt === "delete" && gid) {
      const deleteBusy = busyAction.get() === "delete-gist";
      const shortId = gid.length > 12 ? `${gid.slice(0, 12)}…` : gid;
      return tray.stack(
        [
          tray.alert({
            title: `Delete gist ${shortId} from GitHub?`,
            description:
              "Irreversible. Your local catalog + reading progress are kept — only the remote gist is removed.",
            intent: "alert",
          }),
          alertActions(tray, [
            tray.flex(
              [
                tray.button(deleteBusy ? "Deleting…" : "⛔ Delete gist", {
                  onClick: "lcm-delete-gist-confirm",
                  intent: "alert",
                  loading: deleteBusy,
                }),
                tray.button("✕ Cancel", {
                  onClick: "lcm-binding-cancel",
                }),
              ],
              { gap: 2 },
            ),
          ]),
        ],
        { gap: 2 },
      );
    }
    return null;
  }

  function renderSync() {
    if (hasToken()) {
      // Show the status line only on an explicit op result ("Synced N",
      // "Reloaded · N", …); the ENTRIES header + Linked pill already convey
      // the steady state, so there's no static fallback.
      const statusLine = status.get();
      if (!statusLine) return null;
      return tray.stack(
        [
          tray.text(statusLine, {
            style: {
              fontSize: "0.75rem",
              opacity: "0.6",
            },
          }),
        ],
        { gap: 2 },
      );
    }
    const localCount = entries.get().length;
    const jsonOut = serializeCatalog(
      entries.get(),
      $storage.get<number>(K_UPDATED_AT) ?? Date.now(),
    );
    const expanded = localInfoExpanded.get();
    const items: unknown[] = [];
    if (expanded) {
      items.push(
        tray.alert({
          title: "Plugin and custom-source can't sync directly",
          description:
            "Seanime sandboxes extensions, so the plugin can't push to the source for you. Copy the JSON below into the custom-source's Inline catalog JSON field after each edit. 💡 Or Connect GitHub above for Gist mode — automatic sync, no copy-paste.",
          intent: "info",
        }),
      );
    }
    if (status.get()) {
      items.push(
        tray.text(status.get(), {
          style: { fontSize: "0.8rem", opacity: "0.7" },
        }),
      );
    }
    const hintStyle = {
      fontSize: "0.75rem",
      opacity: "0.6",
    };
    // Output: two read-only monospace code blocks (catalog + progress), both
    // collapsible. tray.input has no readOnly prop, so we render as styled
    // text + userSelect:all so a single click inside selects the whole JSON
    // ready for ⌘C / Ctrl+C. Helper keeps both sections symmetric.
    const renderCodeBlockSection = (opts: {
      label: string;
      content: string;
      expanded: boolean;
      toggleEvent: string;
      expandTooltip: string;
      hint: string;
    }): unknown[] => {
      const out: unknown[] = [
        tray.flex(
          [
            tray.div([sectionHeader(opts.label)], {
              style: { flex: "1", alignSelf: "center" },
            }),
            tray.tooltip(
              tray.button(opts.expanded ? "↑" : "↓", {
                onClick: opts.toggleEvent,
                size: "sm",
              }),
              {
                text: opts.expanded ? "Collapse" : opts.expandTooltip,
              },
            ),
          ],
          { gap: 2, style: { alignItems: "center" } },
        ),
      ];
      if (opts.expanded) {
        out.push(
          tray.div(
            [
              tray.text(opts.content, {
                style: {
                  fontFamily: "monospace",
                  fontSize: "0.7rem",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                  userSelect: "all",
                  cursor: "text",
                },
              }),
            ],
            {
              style: {
                padding: "8px",
                borderRadius: "4px",
                background: "rgba(255,255,255,0.04)",
                maxHeight: "160px",
                overflow: "auto",
              },
            },
          ),
          tray.text(opts.hint, { style: hintStyle }),
        );
      }
      return out;
    };
    // Section 1: catalog JSON. The user copies this into the custom-source's
    // 'Inline catalog JSON' setting (primary purpose of local mode).
    items.push(
      ...renderCodeBlockSection({
        label: "{...} GENERATED INLINE CATALOG JSON",
        content: jsonOut,
        expanded: catalogJsonExpanded.get(),
        toggleEvent: "lcm-toggle-catalog-json",
        expandTooltip:
          "Expand catalog JSON (copy & paste into custom-source's Inline catalog JSON setting)",
        hint: "Copy the content and paste into the custom-source's <Inline catalog JSON> setting.",
      }),
    );
    // Section 2: progress JSON. The custom-source doesn't read this — it's
    // the plugin's local cache of reading state (kept in sync by hooks even
    // without a gist). Surfaced here for manual save / cross-device backup.
    items.push(
      ...renderCodeBlockSection({
        label: "{...} GENERATED INLINE PROGRESS JSON",
        content: serializeProgress(progress.get()),
        expanded: progressJsonExpanded.get(),
        toggleEvent: "lcm-toggle-progress-json",
        expandTooltip:
          "Expand progress JSON (backup / inspection — not consumed by the custom-source)",
        hint: "Backup / inspection only — the custom-source doesn't consume this file. Reading state lives here regardless of gist mode.",
      }),
    );
    const localProgressCount = Object.keys(progress.get().manga).length;
    const hasLocalData = localCount > 0 || localProgressCount > 0;
    const importButtons: unknown[] = hasLocalData
      ? [
          tray.tooltip(
            tray.button("🔀 Merge", { onClick: "lcm-import-merge" }),
            {
              text: "Auto-detect catalog/progress: catalog keeps local on id conflicts; progress uses per-entry LWW by updatedAt",
            },
          ),
          tray.tooltip(
            tray.button("⤵️ Replace", {
              onClick: "lcm-import-replace",
              intent: "alert-subtle",
            }),
            {
              text: "Auto-detect catalog/progress: wipe local and use the JSON instead",
            },
          ),
        ]
      : [
          tray.button("📥 Import", {
            onClick: "lcm-import-replace",
            intent: "primary",
          }),
        ];
    items.push(
      tray.flex(
        [
          tray.div(
            [
              tray.input("{...} Paste a catalog or progress JSON", {
                fieldRef: fJsonIn,
              }),
            ],
            { style: { flex: "1", minWidth: "0" } },
          ),
          ...importButtons,
        ],
        { gap: 2, style: { alignItems: "end" } },
      ),
      tray.text(
        hasLocalData
          ? "Type is auto-detected. Merge keeps local data on conflicts; Replace wipes the corresponding doc only."
          : "Paste a catalog OR progress JSON — the type is auto-detected.",
        { style: hintStyle },
      ),
    );
    return tray.stack(items, { gap: 2 });
  }

  function renderList() {
    const allEntries = entries.get();
    const drifting = hasDrift();
    const q = entrySearch.get().toLowerCase();
    const list = q
      ? allEntries.filter((e) => {
          const title = (resolveUserPreferred(e.title) ?? "").toLowerCase();
          if (title.includes(q)) return true;
          const syns = e.synonyms ?? [];
          return syns.some((s) => s.toLowerCase().includes(q));
        })
      : allEntries;
    const rows: EntryListRow[] = list.map((e) => {
      const title = resolveUserPreferred(e.title) ?? "(untitled)";
      const rowProg = progress.get().manga[String(e.id)]?.progress;

      const row: EntryListRow = {
        cover: e.coverImage?.extraLarge ?? e.coverImage?.large,
        title,
        year: e.startDate?.year,
        chapter: rowProg ?? undefined,
        opacity: drifting ? 0.5 : 1,
      };
      row.status = statusToPill(e.status);
      if (!drifting) {
        const inListMediaId = mediaIdLookup.get()?.get(e.id);
        const computedMediaId = mediaIdForImpl(
          $storage.get<number>(K_EXT_ID),
          e.id,
          encodeMediaId,
        );
        const resolvedMediaId = inListMediaId ?? computedMediaId;
        const openBusy = busyAction.get() === `open-manga-${e.id}`;
        const tooltipText = openBusy
          ? "Opening …"
          : resolvedMediaId
            ? `Open in seanime · media #${resolvedMediaId}${inListMediaId == null ? " · not in your list" : ""}`
            : `Open in seanime · resolves on click`;
        row.openInPlace = {
          onClick: ctx.eventHandler(`lcm-open-manga-${e.id}`, () => {
            void navigateToMangaEntry(e.id);
          }),
          tooltip: tooltipText,
        };
      }

      const actions: unknown[] = [];
      if (!drifting) {
        // Apply-progress button: rendered ONLY when local progress for this
        // entry drifts from seanime's tracked state (or the entry isn't in
        // the user's list yet). When local matches seanime exactly the
        // push would be a no-op, so we hide the button rather than offering
        // a useless click target.
        const rowProgress = progress.get().manga[String(e.id)];
        if (rowProgress) {
          const seanimeData = seanimeListDataLookup.get()?.get(e.id);
          const inListForApply = seanimeData != null;
          const applyRowBusy = busyAction.get() === `apply-progress-${e.id}`;
          // A field counts as drifted only when LOCAL has a defined value
          // that differs from seanime's. Skipping local-undefined avoids
          // false positives when the pre-hook doesn't capture a field.
          const hasDriftRow = hasEntryProgressDrift(e.id);
          // Keep the button visible during the busy window even when drift
          // resolves to false mid-flight (applyProgress refreshes the lookup
          // synchronously after updateEntry — without this guard the loading
          // spinner would disappear before the user notices it).
          if (hasDriftRow || applyRowBusy) {
            const progSummary = [
              rowProgress.status?.toLowerCase(),
              rowProgress.progress != null
                ? `prog ${rowProgress.progress}`
                : "",
              rowProgress.score != null ? `score ${rowProgress.score}` : "",
            ]
              .filter(Boolean)
              .join(" · ");
            const applyTooltip = inListForApply
              ? `Push local progress to seanime · drift detected · ${progSummary || "(no data)"}`
              : `Add to your list + push local progress · ${progSummary || "(no data)"}`;
            actions.push(
              tray.tooltip(
                tray.button(applyRowBusy ? "…" : "📤", {
                  onClick: ctx.eventHandler(
                    `lcm-apply-progress-${e.id}`,
                    () => {
                      void applyProgress(e.id);
                    },
                  ),
                  size: "sm",
                  loading: applyRowBusy,
                }),
                { text: applyTooltip },
              ),
            );
          }
        }
        actions.push(
          tray.tooltip(
            tray.button("⚙️", {
              onClick: ctx.eventHandler(`lcm-edit-${e.id}`, () =>
                openForm(e.id),
              ),
              size: "sm",
            }),
            { text: "Edit" },
          ),
        );
        const delArmed = deleteArmedId.get() === e.id;
        actions.push(
          tray.tooltip(
            tray.button(delArmed ? "⛔?" : "⛔", {
              onClick: ctx.eventHandler(`lcm-del-${e.id}`, () => {
                if (deleteArmedId.get() === e.id) {
                  deleteArmedId.set(0);
                  deleteEntry(e.id);
                } else {
                  disarmDelete();
                  deleteArmedId.set(e.id);
                  ctx.toast.warning(
                    "Click ⛔ again to delete — also clears reading progress",
                  );
                }
              }),
              size: "sm",
              intent: delArmed ? "alert" : "alert-subtle",
            }),
            {
              text: delArmed
                ? "Click again to delete (also clears its reading progress)"
                : "Delete",
            },
          ),
        );
      }

      row.actions = actions;
      return row;
    });
    const inlineActions: unknown[] = drifting
      ? []
      : [
          tray.button("+ New", {
            onClick: "lcm-new",
            intent: "primary",
            size: "sm",
          }),
        ];
    if (!drifting && hasToken() && effectiveGistId()) {
      inlineActions.push(
        tray.button(
          busyAction.get() === "reload-catalog" ? "Reloading…" : "↻ Reload",
          {
            onClick: "lcm-reload-catalog",
            size: "sm",
            loading: busyAction.get() === "reload-catalog",
          },
        ),
      );
    }
    const entriesSection = entryList(tray, {
      headerLabel: "ENTRIES",
      rows,
      totalCount: allEntries.length,
      searchActive: q.length > 0,
      searchFieldRef: fEntrySearch,
      searchPlaceholder: "Search entries…",
      onSearch: "lcm-entry-search",
      onClearSearch: "lcm-entry-search-clear",
      inlineActions,
      emptyText: "No entries yet. Click + New to add one.",
      noMatchText: `No entries match "${q}".`,
      showSearchRow: !drifting,
    });
    if (hasToken()) {
      const layers: unknown[] = [];
      // tray.alert can't host child buttons, so an alert's actions live in a
      // bordered notch box right below it (alertActions, shared with the gist
      // delete-confirm). Rows are centered inside the box.
      const actionBox = (buttonRows: unknown[]) =>
        alertActions(tray, buttonRows);
      const drift = pendingDrift.get();
      if (drift) {
        const d = diffCatalog(drift.local, drift.remote);
        const resolveBusy = busyAction.get() === "resolve-drift";
        layers.push(
          tray.stack(
            [
              tray.alert({
                title: "Drift detected",
                description: `Local has ${ent(drift.local.length)}, remote has ${ent(drift.remote.length)}. ${d.conflicts > 0 ? `${d.conflicts} id(s) in conflict.` : "No id conflicts."} Sync is paused until you resolve — pick one:`,
                intent: "warning",
              }),
              actionBox([
                tray.flex(
                  [
                    tray.button(resolveBusy ? "Merging…" : "🔀 Merge", {
                      onClick: "lcm-drift-merge",
                      intent: "primary",
                      loading: resolveBusy,
                    }),
                    tray.button("↑ Local wins", {
                      onClick: "lcm-drift-local-wins",
                    }),
                  ],
                  { gap: 2 },
                ),
                tray.flex(
                  [
                    tray.button("↓ Remote wins", {
                      onClick: "lcm-drift-remote-wins",
                    }),
                    tray.button("✕ Cancel link", {
                      onClick: "lcm-drift-cancel",
                    }),
                  ],
                  { gap: 2 },
                ),
              ]),
            ],
            { gap: 2 },
          ),
        );
      }
      // Progress drift banner — same UX shape as the catalog one. Only the
      // progress section is hidden while it's pending (catalog is fine,
      // catalog edits + entry CRUD stay enabled).
      const progressDrift = pendingProgressDrift.get();
      if (progressDrift && !drift) {
        const pd = diffProgress(progressDrift.local, progressDrift.remote);
        const localCount = Object.keys(progressDrift.local.manga).length;
        const remoteCount = Object.keys(progressDrift.remote.manga).length;
        const resolveProgBusy = busyAction.get() === "resolve-progress-drift";
        layers.push(
          tray.stack(
            [
              tray.alert({
                title: "Reading progress drift",
                description: `Local has ${localCount} ${localCount === 1 ? "entry" : "entries"}, remote has ${remoteCount}. ${pd.conflicts > 0 ? `${pd.conflicts} id(s) in conflict.` : "No id conflicts."}${pd.localOnly + pd.remoteOnly > 0 ? ` ${pd.localOnly} local-only · ${pd.remoteOnly} remote-only.` : ""} Progress sync paused — Merge uses per-entry LWW (recommended); Local/Remote take one side wholesale.`,
                intent: "warning",
              }),
              actionBox([
                tray.flex(
                  [
                    tray.button(resolveProgBusy ? "Merging…" : "🔀 Merge", {
                      onClick: "lcm-progress-drift-merge",
                      intent: "primary",
                      loading: resolveProgBusy,
                    }),
                    tray.button("↑ Local wins", {
                      onClick: "lcm-progress-drift-local-wins",
                    }),
                  ],
                  { gap: 2 },
                ),
                tray.flex(
                  [
                    tray.button("↓ Remote wins", {
                      onClick: "lcm-progress-drift-remote-wins",
                    }),
                    tray.button("✕ Dismiss", {
                      onClick: "lcm-progress-drift-cancel",
                    }),
                  ],
                  { gap: 2 },
                ),
              ]),
            ],
            { gap: 2 },
          ),
        );
      }
      const bindingBanner = renderBindingPrompt();
      if (bindingBanner) layers.push(bindingBanner);
      const connect = renderConnect();
      if (connect) layers.push(connect);
      const sync = renderSync();
      if (sync) layers.push(sync);
      // READING PROGRESS goes BEFORE entries — it's the "live state"
      // surface (stats, drift, orphans). Hidden while any drift is pending
      // (catalog drift first, progress drift second — both have their own
      // banner above and the section's buttons would bail anyway).
      if (!drift && !progressDrift) {
        layers.push(renderProgressSection());
      }
      layers.push(entriesSection);
      return tray.stack(joinDividers(tray, layers), { gap: 3 });
    }
    // Local mode: progress still works (hooks save to $storage); the reload
    // button hides but stat cards + orphan cleanup remain. renderSync() may be
    // null → joinDividers skips it (no stray divider).
    const localSync = renderSync();
    return tray.stack(
      joinDividers(tray, [
        renderConnect(),
        localSync,
        renderProgressSection(),
        entriesSection,
      ]),
      { gap: 3 },
    );
  }

  function renderFormHeader(): unknown {
    const isNew = editingId.get() === 0;
    const back = tray.button("← Back", {
      onClick: "lcm-cancel",
      size: "sm",
      intent: "gray-subtle",
    });
    if (isNew) {
      return trayHeader(tray, {
        title: "New entry",
        iconUrl: "",
        right: [back],
      });
    }
    const id = editingId.get();
    const entry = entries.get().find((x) => x.id === id);
    const title = resolveUserPreferred(entry?.title) ?? `#${id}`;
    const cover = String(
      entry?.coverImage?.extraLarge ?? entry?.coverImage?.large ?? "",
    );
    return trayHeader(tray, {
      title,
      subtitle: "Edit catalog entry",
      iconUrl: cover || undefined,
      right: [back],
    });
  }

  function renderFormProgressSection(): unknown {
    const isNew = editingId.get() === 0;
    const id = editingId.get();
    const rowProgress = isNew ? undefined : progress.get().manga[String(id)];
    const applyBusy = busyAction.get() === `apply-progress-${id}`;
    const showApply =
      !isNew && !!rowProgress && (hasEntryProgressDrift(id) || applyBusy);
    const drifting = hasDrift();

    const headerActions: unknown[] = [];
    if (!isNew && !drifting) {
      const openBusy = busyAction.get() === `open-manga-${id}`;
      const inListMediaId = mediaIdLookup.get()?.get(id);
      const computedMediaId = mediaIdForImpl(
        $storage.get<number>(K_EXT_ID),
        id,
        encodeMediaId,
      );
      const resolvedMediaId = inListMediaId ?? computedMediaId;
      const openTooltip = openBusy
        ? "Opening …"
        : resolvedMediaId
          ? `Open in seanime · media #${resolvedMediaId}${inListMediaId == null ? " · not in your list" : ""}`
          : "Open in seanime · resolves on click";
      headerActions.push(
        tray.tooltip(
          tray.button(openBusy ? "Opening…" : "Open →", {
            onClick: ctx.eventHandler(`lcm-form-open-manga-${id}`, () => {
              void navigateToMangaEntry(id);
            }),
            size: "sm",
            intent: "gray-subtle",
            loading: openBusy,
          }),
          { text: openTooltip },
        ),
      );
    }
    if (showApply) {
      headerActions.push(
        tray.tooltip(
          tray.button(applyBusy ? "Applying…" : "📤 Apply", {
            onClick: ctx.eventHandler(`lcm-form-apply-progress-${id}`, () => {
              void applyProgress(id);
            }),
            size: "sm",
            intent: "primary-subtle",
            loading: applyBusy,
          }),
          { text: "Push local progress to seanime" },
        ),
      );
    }

    const headerRow = tray.flex(
      [
        tray.div([sectionHeader("READING PROGRESS")], {
          style: { flex: "1", alignSelf: "center" },
        }),
        ...headerActions,
      ],
      { gap: 2, style: { alignItems: "center" } },
    );

    if (isNew) {
      return tray.stack(
        [
          headerRow,
          tray.text("Tracked after the entry is saved.", {
            style: CAPTION_STYLE,
          }),
        ],
        { gap: 2 },
      );
    }

    if (!rowProgress) {
      return tray.stack(
        [
          headerRow,
          tray.text("No local reading progress yet.", {
            style: CAPTION_STYLE,
          }),
        ],
        { gap: 2 },
      );
    }

    const seanimeData = seanimeListDataLookup.get()?.get(id);
    const sub: unknown[] = [
      headerRow,
      tray.flex(
        [
          statCard(
            rowProgress.progress != null ? String(rowProgress.progress) : "—",
            "chapter",
          ),
          statCard(formatListStatus(rowProgress.status), "status"),
          statCard(
            rowProgress.score != null && rowProgress.score > 0
              ? String(rowProgress.score)
              : "—",
            "score",
          ),
        ],
        { gap: 2 },
      ),
    ];

    if (seanimeData) {
      const seanimeSummary = [
        formatListStatus(seanimeData.status),
        seanimeData.progress != null ? `c.${seanimeData.progress}` : "",
        seanimeData.score != null && Number(seanimeData.score) > 0
          ? `score ${seanimeData.score}`
          : "",
      ]
        .filter(Boolean)
        .join(" · ");
      sub.push(
        tray.text(`In seanime: ${seanimeSummary || "(no data)"}`, {
          style: CAPTION_STYLE,
        }),
      );
    } else if (seanimeListDataLookup.get() != null) {
      sub.push(
        tray.text("Not in your seanime list yet.", { style: CAPTION_STYLE }),
      );
    }

    return tray.stack(sub, { gap: 2 });
  }

  function renderForm() {
    const isNew = editingId.get() === 0;
    const gistMode = hasToken() && !!effectiveGistId();
    return tray.stack(
      [
        // Gist mode only: a new entry won't surface in the source if its Catalog
        // URL is pinned to a revision (…/raw/<sha>/…) — that snapshot never sees
        // later edits. Remind the user to use the unversioned raw URL.
        ...(isNew && gistMode
          ? [
              tray.alert({
                title: "New entries need the unversioned Catalog URL",
                description:
                  "New entries only show if the source's Catalog URL is the unversioned gist raw URL (no /<sha>/). Copy it with the 📋 button in Gist binding.",
                intent: "info",
              }),
            ]
          : []),
        tray.text("TITLE *", { style: LABEL_STYLE }),
        tray.input("English", {
          placeholder: "Solo Leveling",
          fieldRef: fEnglish,
        }),
        tray.input("Romaji", {
          placeholder: "Na Honjaman Level Up",
          fieldRef: fRomaji,
        }),
        tray.input("Native", {
          placeholder: "나 혼자만 레벨업",
          fieldRef: fNative,
        }),
        tray.select("Preferred display title", {
          options: PREFERRED_OPTS,
          fieldRef: fPreferred,
        }),
        divider(tray),
        tray.text("OPTIONAL", { style: LABEL_STYLE }),
        tray.input("Synonyms (comma-separated)", {
          placeholder: "e.g. Alias 1, Alias 2",
          fieldRef: fSynonyms,
        }),
        tray.input("Cover URL", {
          placeholder: "https://…",
          fieldRef: fCover,
        }),
        tray.input("Banner URL", {
          placeholder: "https://…",
          fieldRef: fBanner,
        }),
        tray.input("Description", { textarea: true, fieldRef: fDescription }),
        tray.input("Genres (comma-separated)", {
          placeholder: "e.g. Action, Adventure",
          fieldRef: fGenres,
        }),
        tray.flex(
          [
            tray.div(
              [
                tray.select("Status", {
                  options: STATUS_OPTS,
                  fieldRef: fStatus,
                }),
              ],
              { style: { flex: "1", minWidth: "0" } },
            ),
            tray.div(
              [
                tray.select("Format", {
                  options: FORMAT_OPTS,
                  fieldRef: fFormat,
                }),
              ],
              { style: { flex: "1", minWidth: "0" } },
            ),
          ],
          { gap: 2 },
        ),
        tray.input("Chapters", { fieldRef: fChapters }),
        tray.input("Volumes", { fieldRef: fVolumes }),
        // Start date stacked as a 3-col row — matches AL_BaseManga_StartDate
        // (year/month/day). Passing only Year shows "Jan YYYY" in seanime's
        // entry header (its date format defaults month to January when
        // missing), so set Month + Day too when known to get the right label.
        tray.flex(
          [
            tray.div(
              [
                tray.input("Start year", {
                  placeholder: "YYYY",
                  fieldRef: fYear,
                }),
              ],
              {
                style: { flex: "1", minWidth: "0" },
              },
            ),
            tray.div(
              [
                tray.select("Start month", {
                  options: MONTH_OPTS,
                  fieldRef: fMonth,
                }),
              ],
              { style: { flex: "1", minWidth: "0" } },
            ),
            tray.div(
              [tray.input("Start day", { placeholder: "DD", fieldRef: fDay })],
              {
                style: { flex: "1", minWidth: "0" },
              },
            ),
          ],
          { gap: 2 },
        ),
        tray.flex(
          [
            tray.div(
              [
                tray.input("End year", {
                  placeholder: "YYYY",
                  fieldRef: fEndYear,
                }),
              ],
              {
                style: { flex: "1", minWidth: "0" },
              },
            ),
            tray.div(
              [
                tray.select("End month", {
                  options: MONTH_OPTS,
                  fieldRef: fEndMonth,
                }),
              ],
              { style: { flex: "1", minWidth: "0" } },
            ),
            tray.div(
              [tray.input("End day", { placeholder: "DD", fieldRef: fEndDay })],
              {
                style: { flex: "1", minWidth: "0" },
              },
            ),
          ],
          { gap: 2 },
        ),
        tray.input("Country", { placeholder: "e.g. JP", fieldRef: fCountry }),
        tray.input("Site URL", {
          placeholder: "https://…",
          fieldRef: fSiteUrl,
        }),
        tray.flex(
          [
            tray.div(
              [
                tray.input("idMal", {
                  placeholder: "e.g. 113138",
                  fieldRef: fIdMal,
                }),
              ],
              { style: { flex: "1", minWidth: "0" } },
            ),
            tray.div(
              [
                tray.input("Mean score", {
                  placeholder: "0-100",
                  fieldRef: fMeanScore,
                }),
              ],
              {
                style: { flex: "1", minWidth: "0" },
              },
            ),
          ],
          { gap: 2 },
        ),
        tray.switch("Adult", { fieldRef: fIsAdult }),
        tray.flex(
          [
            tray.button("Save", { onClick: "lcm-save", intent: "primary" }),
            tray.button("Cancel", { onClick: "lcm-cancel" }),
          ],
          { gap: 2 },
        ),
      ],
      { gap: 2 },
    );
  }

  const currentLocalId = ctx.state<number>(0);

  const localIdFromMediaId = (mediaId: number): number =>
    localIdFromMediaIdImpl(mediaId, {
      isCustomSourceId,
      getManga: getMangaSafe,
      sourcePrefix: SOURCE_PREFIX,
      decodeLocalId,
    });

  const pageBtn = ctx.action.newMangaPageButton({
    label: "🗂️",
    intent: "gray-subtle",
    tooltipText: "Edit local entry",
  });
  pageBtn.onClick((e) => {
    const local = localIdFromMediaId(e.media.id);
    if (local && entries.get().some((x) => x.id === local)) {
      openForm(local);
      tray.open();
    } else {
      ctx.toast.info("This entry is not from local-catalog.");
    }
  });

  ctx.screen.onNavigate((e) => {
    const id = e.searchParams?.id ? parseInt(e.searchParams.id, 10) : 0;
    const local = id > 0 ? localIdFromMediaId(id) : 0;
    currentLocalId.set(local);
    // When the user navigates to a local-catalog manga entry (the page
    // that hosts the reader), pull any remote progress changes first so
    // the chapter list / "continue reading" position reflects the latest
    // cross-device state. Cooldown inside avoids re-firing on rapid
    // back-and-forth navigation.
    if (local > 0) {
      void pullProgressSilent("opened entry");
    }
  });
  ctx.screen.loadCurrent();

  ctx.effect(() => {
    if (currentLocalId.get() > 0) pageBtn.mount();
    else pageBtn.unmount();
  }, [currentLocalId]);

  const autoSync = ($getUserPreference("autoSync") ?? "false") === "true";
  if (autoSync && hasToken()) {
    const mins = Math.max(
      5,
      Number($getUserPreference("syncIntervalMinutes") ?? "30") || 30,
    );
    // cron minute field is 0-59; for >= 60 min use an hour-step expression.
    const expr =
      mins < 60 ? `*/${mins} * * * *` : `0 */${Math.round(mins / 60)} * * *`;
    try {
      ctx.cron.add("lcm-auto-pull", expr, () => {
        // Auto-sync = reload (pull + merge + push) on both files. Bails
        // internally if drift is pending.
        if (effectiveGistId()) {
          void reloadCatalog();
          void reloadProgress();
        }
      });
      ctx.cron.start();
    } catch (e) {
      ctx.toast.error(`Auto-sync schedule failed: ${(e as Error).message}`);
    }
  }

  // Refresh progress state from $storage every time the tray opens. Hooks
  // (onPostUpdateEntry / onPostUpdateEntryProgress) run in separate goja
  // runtimes and write directly to $storage; the tray's ctx.state was
  // initialized once at register() time so it doesn't observe those writes
  // until we re-read here.
  tray.onOpen(() => {
    progress.set(loadProgressDoc());
    progressUpdated.set($storage.get<number>(K_PROGRESS_UPDATED_AT) ?? 0);
    // Refresh localId → mediaId cache + discover extId if needed. goja's
    // Promise interop supports `await` on getCollection / discoverExtId
    // but the values they return do NOT expose `.then()` directly —
    // calling `.then` throws "Object has no member 'then'". Wrap the
    // fire-and-forget work in an async IIFE so we can use await.
    void (async () => {
      try {
        const collection = await ctx.manga.getCollection();
        refreshLookupsFromCollection(collection);
      } catch (e) {
        log.warn("mediaIdLookup refresh failed:", e);
      }
      // Discover the extId in the background if we haven't cached it yet —
      // makes the first "Open →" / "Push local progress" click feel instant
      // for entries that aren't in the user's list yet. discoverExtId may
      // probe via $anilist.getManga (up to 1023 sync calls) on first run.
      if ($storage.get<number>(K_EXT_ID) == null) {
        try {
          const result = await discoverExtIdImpl(extIdDeps());
          // After discovery, refresh lookups so the extId-based filter
          // actually applies (the prior refresh ran with extId=undefined
          // and fell back to siteUrl). Without this, the first tray.onOpen
          // leaves seanimeListDataLookup populated via the buggy path.
          if (result != null) {
            try {
              const fresh = await ctx.manga.getCollection();
              refreshLookupsFromCollection(fresh);
            } catch (_) {
              // best-effort
            }
          }
        } catch (e) {
          log.warn("extId discovery failed:", e);
        }
      }
      // After lookups are warm, pull any remote progress changes silently.
      // Cooldown inside pullProgressSilent prevents spamming when this fires
      // back-to-back with screen.onNavigate (e.g., user clicks Open → in the
      // tray, which closes+opens the tray AND triggers navigation).
      await pullProgressSilent("tray opened");
      const local = currentLocalId.get();
      if (
        view.get() === "list" &&
        local > 0 &&
        entries.get().some((x) => x.id === local)
      ) {
        openForm(local);
      }
    })();
  });

  // Collapse all expandable sections whenever the tray closes — the next
  // open starts with a clean compact view.
  tray.onClose(() => {
    bindingPrompt.set("");
    localInfoExpanded.set(false);
    orphansExpanded.set(false);
    catalogJsonExpanded.set(false);
    progressJsonExpanded.set(false);
    disarmDelete();
  });

  tray.render(() => {
    if (view.get() === "form") {
      return tray.stack(
        joinDividers(tray, [
          renderFormHeader(),
          renderFormProgressSection(),
          renderForm(),
        ]),
        { gap: 3 },
      );
    }
    const gid = effectiveGistId();
    let right: unknown[];
    if (hasToken()) {
      // Gist mode: badge + a ⋮ actions menu. The paste-input / delete-confirm
      // that some items need can't live in a dropdown, so those items open an
      // inline prompt (renderBindingPrompt, driven by bindingPrompt) instead.
      const menuItems: unknown[] = gid
        ? [
            tray.dropdownMenuItem(tray.text("📋 Copy raw catalog URL"), {
              onClick: "lcm-show-raw-url",
            }),
            tray.dropdownMenuItem(tray.text("🔓 Unlink gist"), {
              onClick: "lcm-unlink-gist",
            }),
            tray.dropdownMenuItem(tray.text("⛔ Delete gist remotely…"), {
              className: ALERT_MENU_ITEM_STYLE,
              onClick: "lcm-binding-delete-open",
            }),
          ]
        : [
            tray.dropdownMenuItem(tray.text("＋ Create new gist"), {
              onClick: "lcm-create-gist",
            }),
            tray.dropdownMenuItem(tray.text("🔗 Link existing gist…"), {
              onClick: "lcm-binding-link-open",
            }),
          ];
      right = [
        gid
          ? tray.badge("🔗 Linked", { intent: "success" })
          : tray.badge("🔓 Not linked", { intent: "gray" }),
        // Only CATALOG drift blocks binding management (link/create conflict
        // with the pending merge) → disable the trigger then. PROGRESS drift
        // leaves catalog + binding ops enabled, so the menu stays normal (it
        // was showing opaque-but-clickable, which is worse than either state).
        tray.dropdownMenu({
          trigger: tray.button("⋮", {
            size: "sm",
            intent: "gray-subtle",
            disabled: !!pendingDrift.get(),
          }),
          items: menuItems,
        }),
      ];
    } else {
      // Local mode: the ⚠️ button reveals CONTENT (limitation note + JSON
      // output), not actions — so it stays a plain content toggle.
      const expanded = localInfoExpanded.get();
      right = [
        tray.badge("💻 Device only", { intent: "gray" }),
        tray.tooltip(
          tray.button(expanded ? "△" : "⚠️", {
            onClick: "lcm-toggle-local",
            size: "sm",
          }),
          {
            text: expanded
              ? "Collapse local limitation"
              : "Show local limitation",
          },
        ),
      ];
    }
    const header = trayHeader(tray, {
      subtitle: hasToken() ? "Gist mode" : "Local mode",
      right,
    });
    return tray.stack(joinDividers(tray, [header, renderList()]), { gap: 3 });
  });
};
