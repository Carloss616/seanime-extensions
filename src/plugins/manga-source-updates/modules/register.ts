import { joinDividers } from "../../../_components/divider";
import { createDomDecorator } from "../../../_components/dom-decorator";
import { type EntryListRow, entryList } from "../../../_components/entry-list";
import { githubConnect } from "../../../_components/github-connect";
import { ALERT_MENU_ITEM_STYLE } from "../../../_components/text";
import { trayHeader } from "../../../_components/tray-header";
import { GistClient } from "../../../_utils/gist/client";
import { GITHUB_CLIENT_ID } from "../../../_utils/gist/constants";
import { DeviceFlowClient } from "../../../_utils/gist/device-flow";
import { createLogger } from "../../../_utils/logger";
import scanPanelHtml from "../assets/scan-panel.html";
import { readCardAttrs } from "../utils/card-dom";
import { makeProbe, unreadChapters } from "../utils/chapters";
import { classify, isBadKind, isNoMatchError } from "../utils/classify";
import { readingEntries } from "../utils/collection";
import {
  K_GIST_ID,
  K_OAUTH_TOKEN,
  K_SYNCED_AT,
  REASONS,
  reasonIntent,
  reasonLabel,
} from "../utils/constants";
import { clearedExclusions } from "../utils/exclusions";
import { buildManifestExtIdIndex, probeExtId } from "../utils/ext-id";
import { createHeaderProgressReader } from "../utils/header-progress";
import { hydrateProbes, hydrateResults } from "../utils/hydrate";
import { getInstanceId } from "../utils/instance";
import {
  isManualMatchConfirmDialog,
  mappingSigFromHtml,
} from "../utils/manual-match";
import {
  getMatches,
  liveLocalMatchPairs,
  matchDivergence,
  resolveMatchAction,
  setMatches,
  tombstoneMatch,
  upsertMatch,
} from "../utils/matches";
import { isActiveProvider, pruneInactiveProbes } from "../utils/providers";
import { readSelectedProvider } from "../utils/selected-provider";
import {
  buildSourceRef,
  getSources,
  setSources,
  upsertSourceRef,
} from "../utils/sources";
import { cardBadgeKind, statusFor } from "../utils/status";
import {
  getExcluded,
  getExcludedView,
  getPinned,
  getPinnedView,
  getResults,
  isLive,
  mergeProbeTimestamps,
  setProbes as persistProbes,
  setExcluded as setExcludedMap,
  setPinned as setPinnedMap,
  setResults,
  snapshotLocalMaps,
  writeLocalMaps,
} from "../utils/store";
import {
  ensureGist,
  omitCells,
  reinjectCells,
  type SyncSection,
  syncMsu,
} from "../utils/sync";
import { collectTitles, resolveTitle } from "../utils/titles";
import type {
  ExcludeReason,
  MangaResult,
  ProbeMap,
  ProviderProbe,
  ResultKind,
  ResultRowMedia,
  StoredResult,
} from "../utils/types";

// Scan the reading list (all CURRENT entries) and, per manga, probe every
// installed source to find new chapters. Traffic is cut by TTL (skip a manga
// scanned recently) and auto-exclude (a source that returns no match / errors /
// sits far behind the reading progress is remembered and skipped next time).
// There is NO per-manga "selected provider": seanime owns the reader's source
// selection, so we just report the best (most unread) across the user's sources.

export const register = (ctx: $ui.Context) => {
  const log = createLogger();
  const tray = ctx.newTray({ iconUrl: __MANIFEST_ICON__, withContent: true });
  // Track tray open state (no isOpen() in the API) so the panel-cover click can
  // reflect the detail into an already-open tray.
  let trayIsOpen = false;

  // The list sections have no search; entryList still requires a fieldRef, so
  // hand it an unused one and keep showSearchRow off.
  const noSearchRef = ctx.fieldRef<string>("");

  const scanning = ctx.state<boolean>(false);
  const cancelRequested = ctx.state<boolean>(false);
  // Seed from the last persisted scan so a reload shows results immediately.
  const hydrated = hydrateResults();
  const status = ctx.state<string>(
    hydrated.length ? "Showing last scan — Scan to refresh" : "",
  );
  const results = ctx.state<MangaResult[]>(hydrated);

  const detailId = ctx.state<number | null>(null);
  const detailTitle = ctx.state<string>("");
  const detailCover = ctx.state<string>("");
  const detailRead = ctx.state<number>(0);
  const probingId = ctx.state<number | null>(null);
  // Provider id being scanned individually (single-source rescan / include),
  // "" = none. One at a time keeps the merge simple.
  const scanningProvider = ctx.state<string>("");
  // Per-manga scan progress, shared by the global scan AND the manga-detail scan
  // (scanOneManga sets it). The detail button reads it when its manga is the one
  // being evaluated, so global/manga scans surface the same "done/total".
  const scanProgress = ctx.state<{
    mediaId: number;
    done: number;
    total: number;
  } | null>(null);
  // Providers currently being fetched in the active per-manga scan (global or
  // detail). Drives the live ⏳ on each source's rescan button. Keyed by mediaId
  // so a global scan on a DIFFERENT manga doesn't light up the open detail rows.
  const scanningProviders = ctx.state<{
    mediaId: number;
    pids: string[];
  } | null>(null);
  // Global (whole-list) scan progress, synced to the floating webview panel so
  // "X/Y + current title" shows on every screen. null = no scan running.
  const scanStatus = ctx.state<{
    done: number;
    total: number;
    title: string;
    cover?: string;
    mediaId: number;
  } | null>(null);
  // Per-manga source detail (keyed by provider id — one probe per provider),
  // seeded from $storage so a scanned manga shows its last per-source result
  // after a reload (unscanned providers render as "not scanned"). setProbes()
  // keeps the in-memory state and $storage in sync.
  const probeCache = ctx.state<Record<number, ProbeMap>>(hydrateProbes());
  function setProbes(mediaId: number, probes: ProbeMap) {
    const prev = probeCache.get()[mediaId] ?? {};
    const stamped = mergeProbeTimestamps(prev, probes, Date.now());
    const next = { ...probeCache.get(), [mediaId]: stamped };
    probeCache.set(next);
    persistProbes(next as Record<string, Record<string, ProviderProbe>>);
  }
  // mediaId of the manga entry the user is currently viewing (0 = not on one),
  // tracked via onNavigate so opening the tray on a manga page jumps to it.
  const currentMediaId = ctx.state<number>(0);
  // Confirm-before-run modal, shared by all three whole-list actions (plain
  // scan, force rescan, clear exclusions) — each fires with no confirmation of
  // its own (the library "Refresh sources" menu, the tray "…" dropdown items).
  // Holds which action is pending, or null when closed. Lives in the tray
  // render tree, so opening it also opens the tray.
  type ConfirmKind = "scan" | "force" | "clear";
  const pendingConfirm = ctx.state<ConfirmKind | null>(null);

  // Last seen manual-mapping sig per manga — detect save/remove in the modal.
  const lastMappingSigByMedia: Record<number, string | undefined> = {};
  const myInstanceId = getInstanceId();

  // Reactive mirror of the device-flow token so connect/disconnect re-render
  // the tray ($storage reads aren't reactive). $storage stays authoritative for
  // the hooks (separate runtimes) — both are written on connect/disconnect.
  const oauthTok = ctx.state<string>(
    ($storage.get<string>(K_OAUTH_TOKEN) ?? "").trim(),
  );
  // Effective token: device-flow OAuth token wins, else the PAT config field.
  const oauthToken = () => oauthTok.get();
  const patToken = () => ($getUserPreference("githubPat") ?? "").trim();
  const syncToken = () => oauthToken() || patToken();
  const hasSync = () => syncToken().length > 0;
  const syncClient = () =>
    new GistClient(syncToken(), (u, i) => ctx.fetch(u, i));

  const syncing = ctx.state<boolean>(false);
  const syncedAt = ctx.state<number>($storage.get<number>(K_SYNCED_AT) ?? 0);
  // GitHub OAuth Device Flow connect state: `connecting` guards against a
  // double-click starting two flows; `deviceStart` drives the "enter this code"
  // view in renderSyncSection while a flow is in progress.
  const connecting = ctx.state<boolean>(false);
  const deviceStart = ctx.state<$gh.Login.DeviceCode | null>(null);

  // Resolve this instance's extId for a manifest: local K_SOURCES index first
  // (free), then a probe seeded with the localId of the very record being
  // localized. Cached per sync run so the ≤1023-call probe runs at most once
  // per manifest.
  function makeExtIdResolver(): (
    manifestId: string,
    seedLocalId: number,
  ) => number | null {
    const index = buildManifestExtIdIndex(getSources());
    const cache: Record<string, number | null> = { ...index };
    return (manifestId: string, seedLocalId: number) => {
      if (manifestId in cache) return cache[manifestId];
      const extId = probeExtId(manifestId, seedLocalId, {
        getManga: (mediaId) => $anilist.getManga(mediaId),
        sleep: (ms) => $sleep(ms),
      });
      cache[manifestId] = extId;
      return extId;
    };
  }

  let lastSilentFullAt = 0;
  const SILENT_SYNC_COOLDOWN_MS = 10_000;

  // One gist round-trip. Always pull/merge/write-back EVERY section (pulling is
  // free — one GET — and safe); `pushSections` restricts only which files get
  // PATCHed. `null` = push all changed files. Concurrency/cooldown are owned by
  // requestSync, so this just does the work.
  async function performSync(
    pushSections: SyncSection[] | null,
    reason: string,
    silent: boolean,
  ): Promise<void> {
    const client = syncClient();
    // Providers this instance manually matched → their scan probe reflects a
    // manually-chosen series, so it's instance-relative. Keep those probes OUT
    // of the wire (and un-overwritten on pull) or two devices that matched a
    // provider differently ping-pong latest/count through probes.json forever.
    const matchedPairs = liveLocalMatchPairs(getMatches(), myInstanceId);
    const roundTrip = async () => {
      const gistId = await ensureGist({
        client,
        getGistId: () => $storage.get<string>(K_GIST_ID) ?? undefined,
        setGistId: (id) => $storage.set(K_GIST_ID, id),
      });
      const fullLocal = snapshotLocalMaps();
      const res = await syncMsu({
        client,
        gistId,
        local: {
          ...fullLocal,
          probes: omitCells(fullLocal.probes, matchedPairs),
        },
        sources: getSources(),
        // The resolver probes using the localId of the record being localized,
        // so no separate remote pre-read is needed to seed it.
        extIdForManifest: makeExtIdResolver(),
        log,
        pushSections: pushSections ? new Set(pushSections) : undefined,
      });
      return {
        ...res,
        writeBack: {
          ...res.writeBack,
          probes: reinjectCells(
            res.writeBack.probes,
            fullLocal.probes,
            matchedPairs,
          ),
        },
      };
    };
    try {
      let res: Awaited<ReturnType<typeof roundTrip>>;
      try {
        res = await roundTrip();
      } catch (e) {
        // A deleted / inaccessible gist 404s on the PATCH. Drop the stale cached
        // id so ensureGist re-discovers (by filename) or re-creates it, then
        // retry once — self-heals if the gist was deleted on GitHub.
        if (!String((e as Error).message).includes("404")) throw e;
        $storage.remove(K_GIST_ID);
        res = await roundTrip();
      }

      writeLocalMaps(res.writeBack);
      const now = Date.now();
      $storage.set(K_SYNCED_AT, now);
      syncedAt.set(now);

      // Re-hydrate the tray's in-memory state from the merged $storage so a
      // pull that changed rows is reflected without a manual rescan.
      results.set(hydrateResults());
      probeCache.set(hydrateProbes());
      // The digest's derived fields (latest/sources/newSources/kind) are NOT
      // synced — recompute them locally from the freshly-merged probes so a
      // pull (peer probes, a new remote row) is reflected in the counts right
      // away, and rows adopted from a peer don't display that peer's provider
      // count. Reads updatedAt-preserving, so this never re-dirties the digest.
      reconcileInactiveProviders();

      if (res.pushed) {
        // Always announce a real push (even a silent live one) with the maps it
        // uploaded — strip the `seanime-msu-`/`.json` wrapper to bare section
        // names. A no-op pull stays quiet unless it was a manual Sync now.
        const maps = res.changedFiles
          .map((f) => f.replace("seanime-msu-", "").replace(".json", ""))
          .join(", ");
        ctx.toast.info(`☁️ Synced: ${maps}`);
      } else if (!silent) {
        ctx.toast.success("Up to date");
      }
      // Nudge the frontend to refetch chapter/collection queries the merge may
      // have affected.
      try {
        $app.invalidateClientQuery([
          "MANGA-get-manga-collection",
          "MANGA-get-anilist-manga-collection",
          "MANGA-get-manga-entry",
        ]);
      } catch (e) {
        log.warn("invalidateClientQuery failed:", e);
      }
    } catch (e) {
      log.warn(`sync failed (${reason}):`, e);
      if (!silent) ctx.toast.error(`Sync failed: ${(e as Error).message}`);
    }
  }

  // Serialized, coalescing sync queue. Manual edits push their own file(s) the
  // instant they happen (`livePush`); scans push their sections at the end; the
  // tray/cron/connect paths request a full round-trip. goja has no timers, so
  // coalescing is a pending-set + in-flight guard: a request that arrives while
  // a drain is running just records its intent and returns, and the drain picks
  // it up — no edit is dropped, and no two round-trips overlap (concurrent gist
  // PATCHes would corrupt each other).
  let syncBusy = false;
  let queuedAll = false;
  const queuedSections = new Set<SyncSection>();
  // Loud = a non-silent request (the manual Sync-now button) is in the batch →
  // the drained round-trip shows a toast. `reason` is logging-only.
  let queuedLoud = false;

  async function requestSync(
    push: SyncSection[] | "all",
    reason: string,
    silent: boolean,
  ): Promise<void> {
    if (!hasSync()) {
      if (!silent) ctx.toast.error("Connect GitHub (or add a PAT) first");
      return;
    }
    // Throttle only the silent FULL round-trips (tray-open / cron / connect) so
    // reopening the tray doesn't spam GETs. Scoped live pushes always go through.
    if (push === "all" && silent) {
      const nowMs = Date.now();
      if (nowMs - lastSilentFullAt < SILENT_SYNC_COOLDOWN_MS) return;
      lastSilentFullAt = nowMs;
    }

    if (push === "all") queuedAll = true;
    else for (const s of push) queuedSections.add(s);
    if (!silent) queuedLoud = true;
    if (syncBusy) return;

    syncBusy = true;
    syncing.set(true);
    try {
      while (queuedAll || queuedSections.size > 0) {
        const loud = queuedLoud;
        const sections = queuedAll ? null : [...queuedSections];
        queuedAll = false;
        queuedSections.clear();
        queuedLoud = false;
        await performSync(sections, reason, !loud);
      }
    } finally {
      syncBusy = false;
      syncing.set(false);
    }
  }

  const livePush = (sections: SyncSection[]): void => {
    void requestSync(sections, "live", true);
  };

  // The HTTP POSTs live in DeviceFlowClient; this owns the poll cadence + UI state.
  // ponytail: the poll loop BLOCKS the UI runtime via $sleep between polls
  // (there is no setTimeout). Bounded by expires_in so it can't hang forever;
  // acceptable for a user-initiated one-time connect. Upgrade path: drive the
  // poll from cron ticks if the block ever bothers a user.
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
        void requestSync("all", "connected", true);
      } else if (result.type === "error") {
        ctx.toast.error(`GitHub login failed: ${result.message}`);
      } else {
        ctx.toast.error("GitHub login timed out — try again");
      }
      deviceStart.set(null);
    } catch (e) {
      log.warn("connectGitHub failed:", e);
      ctx.toast.error(`GitHub login failed: ${(e as Error).message}`);
      deviceStart.set(null);
    } finally {
      connecting.set(false);
    }
  }

  // Recalculate list-row summaries ignoring inactive providers (probes stay in
  // storage — disabled / uninstalled sources are only hidden from the UI).
  function reconcileInactiveProviders(): void {
    const active = ctx.manga.getProviders();
    const gap = Number($getUserPreference("farBehindGap") ?? "10") || 10;
    const cache = probeCache.get();
    const stored = getResults();
    let rowsChanged = false;
    const nextResults = results.get().map((r) => {
      const probes = pruneInactiveProbes(cache[r.mediaId] ?? {}, active);
      const summary = buildResult(r.mediaId, r, r.read, gap, probes);
      const isNew = summary.kind === "new";
      if (
        r.latest === summary.latest &&
        r.sources === summary.sources &&
        r.newSources === summary.newSources &&
        r.kind === summary.kind &&
        r.isNew === isNew
      ) {
        return r;
      }
      rowsChanged = true;
      const row: MangaResult = {
        ...summary,
        mediaId: r.mediaId,
        isNew,
        fromCache: r.fromCache,
        updatedAt: r.updatedAt,
      };
      stored[String(r.mediaId)] = {
        title: row.title,
        cover: row.cover,
        latest: row.latest,
        read: row.read,
        sources: row.sources,
        newSources: row.newSources,
        kind: row.kind,
        updatedAt: row.updatedAt,
        lastScannedAt: r.lastScannedAt,
      };
      return row;
    });
    if (rowsChanged) {
      results.set(nextResults);
      setResults(stored);
    }
  }

  // Read seanime's cached chapter list for a provider — respects manual match
  // bindings and never passes search titles (which would re-run auto-match).
  async function readCachedContainer(
    mediaId: number,
    provider: string,
  ): Promise<$app.HibikeManga_ChapterDetails[] | null> {
    try {
      const c = await ctx.manga.getChapterContainer({ mediaId, provider });
      return c?.chapters ?? [];
    } catch {
      return null;
    }
  }

  // Read a container for a single provider. Prefer cache / manual match; scan
  // paths pass skipCache after emptyCache and fall through to title search.
  async function readContainer(
    mediaId: number,
    provider: string,
    titles: string[],
    year: number | undefined,
    skipCache = false,
  ): Promise<$app.HibikeManga_ChapterDetails[] | null> {
    if (!skipCache) {
      try {
        const cached = await ctx.manga.getChapterContainer({
          mediaId,
          provider,
        });
        if (cached?.chapters?.length) return cached.chapters;
      } catch {
        /* no cache / manual match */
      }
    }

    if (!titles.length) return [];

    try {
      const c = await ctx.manga.getChapterContainer({
        mediaId,
        provider,
        titles,
        year,
      });
      return c?.chapters ?? [];
    } catch (e) {
      // seanime throws for BOTH "no series matched" and a genuine fetch error.
      // Only the message tells them apart — a no-match returns [] (matched:false,
      // errored:false → "no match" pill) so it isn't mislabeled "error".
      const msg = String((e as { message?: unknown })?.message ?? e);
      if (isNoMatchError(msg)) return [];
      // SPIKE: log unmatched messages so NO_MATCH_RX can be widened from real
      // seanime output. Remove once the pattern is confirmed complete.
      log.warn(`fetch error (${provider}): ${msg}`);
      return null; // genuine provider error
    }
  }

  // Build the list-row summary from a set of probes: the best (most unread)
  // across the currently non-excluded matched sources. Shared by the full scan,
  // the detail scan, and the single-provider rescan.
  function buildResult(
    mediaId: number,
    media: ResultRowMedia,
    read: number,
    gap: number,
    probes: ProbeMap,
  ): StoredResult {
    const key = String(mediaId);
    const excluded = getExcludedView();
    const providers = ctx.manga.getProviders();
    const providerIds = Object.keys(providers).filter((p) =>
      isActiveProvider(p, providers),
    );
    const matched = Object.values(probes).filter(
      (p) =>
        p.matched &&
        isActiveProvider(p.provider, providers) &&
        excluded[key]?.[p.provider] == null,
    );
    const maxLatest = matched.reduce((m, p) => Math.max(m, p.latest), 0);
    // M in "+N · M" = matched sources that actually have unread chapters, not the
    // total matched count.
    const newSources = matched.filter(
      (p) => unreadChapters(read, p.latest) > 0,
    ).length;
    let kind: ResultKind;
    if (matched.length) {
      kind = classify(read, maxLatest, matched.length, false, gap);
    } else {
      const availableCount = providerIds.filter(
        (p) => isActiveProvider(p, providers) && excluded[key]?.[p] == null,
      ).length;
      kind = availableCount === 0 ? "all-excluded" : "not-matched";
    }
    // `lastScannedAt` bumps every scan (drives the TTL). `updatedAt` (the synced
    // LWW clock) bumps ONLY when a synced field changed vs. the stored row, so a
    // rescan that finds the same title/cover leaves the digest gist file
    // byte-identical → no churn. `read` is deliberately NOT in this check: it's
    // off the wire (re-read locally per instance), so reading a chapter must not
    // bump the synced clock. (reconcile/refreshProgress cherry-pick fields and
    // keep their own timestamps, so this stamp only lands on real scans.)
    const prev = getResults()[key];
    const now = Date.now();
    const syncedSame =
      prev != null &&
      prev.title === media.title &&
      String(prev.cover ?? "") === String(media.cover ?? "");
    return {
      title: media.title,
      cover: media.cover,
      latest: maxLatest,
      read,
      sources: matched.length,
      newSources,
      kind,
      updatedAt: syncedSame ? prev.updatedAt : now,
      lastScannedAt: now,
    };
  }

  // The one per-manga scan, used by BOTH the full reload and the detail view.
  // Empties the cache, then fetches each NON-excluded source fresh (excluded
  // sources are never re-fetched — that's the whole point of excluding), auto-
  // excluding the bad ones (unless pinned) as it goes — persisting each exclusion
  // immediately so the detail view moves the row to the Excluded group live.
  // `onProgress` lets the detail update its list per source. Returns the probe
  // list (the included sources) + row result.
  // Record a custom-source entry's stable identity (manifestId + localId) so a
  // future cross-instance sync can remap it. Native AniList entries yield
  // undefined and are skipped. No network — reads the siteUrl already on the
  // collection media. Shared by the full scan and the per-manga detail scan;
  // idempotent, so it only writes the first time a source is seen.
  function captureSourceRef(mediaId: number, media: $app.AL_BaseManga) {
    const sref = buildSourceRef(mediaId, media.siteUrl, Date.now());
    if (!sref) return;
    const up = upsertSourceRef(getSources(), mediaId, sref);
    if (up.changed) setSources(up.map);
  }

  async function scanOneManga(
    mediaId: number,
    media: $app.AL_BaseManga,
    read: number,
    gap: number,
    onProgress?: (probes: ProbeMap) => void,
  ): Promise<{ probes: ProbeMap; result: StoredResult }> {
    const key = String(mediaId);
    const titles = collectTitles(media);
    const year = media.startDate?.year;
    const providers = ctx.manga.getProviders();
    const providerIds = Object.keys(providers).filter(
      (p) => p !== "local-manga",
    );
    const excluded = getExcluded();
    const pinnedForManga = getPinnedView()[key] ?? [];

    await ctx.manga.emptyCache(mediaId);
    const probes: ProbeMap = {};
    // Fetch in parallel batches: readContainer is an async fn (a real Promise,
    // so Promise.all is safe in goja — unlike a raw Go-bound value), so a batch
    // hits up to BATCH providers at once instead of one-by-one.
    const toScan = providerIds.filter((pid) => !isLive(excluded[key]?.[pid]));
    const BATCH = Math.max(
      1,
      Math.floor(Number($getUserPreference("parallelBatch") ?? "10")) || 10,
    );
    scanProgress.set({ mediaId, done: 0, total: toScan.length });
    // Track which providers are in-flight so the detail rows can show a live ⏳.
    const inflight = new Set<string>();
    const publishInflight = () =>
      scanningProviders.set({ mediaId, pids: [...inflight] });
    // Bump the counter the moment EACH source resolves, not after the whole
    // batch — otherwise the panel jumps 0→10→20 (by BATCH) and sits idle in
    // between. goja runs these continuations single-threaded, so `done++` needs
    // no locking.
    let done = 0;
    for (let i = 0; i < toScan.length; i += BATCH) {
      if (cancelRequested.get()) break;
      const batch = toScan.slice(i, i + BATCH);
      for (const pid of batch) inflight.add(pid);
      publishInflight();
      const fetched = await Promise.all(
        batch.map(async (pid) => {
          const chs = await readContainer(mediaId, pid, titles, year, true);
          done++;
          inflight.delete(pid);
          scanProgress.set({ mediaId, done, total: toScan.length });
          publishInflight();
          return { pid, chs };
        }),
      );
      for (const { pid, chs } of fetched) {
        const probe = makeProbe(pid, providers[pid], chs);
        probes[pid] = probe;
        // Auto-exclude a newly-bad, non-pinned source.
        if (!pinnedForManga.includes(pid)) {
          const kind = classify(
            read,
            probe.latest,
            probe.count,
            probe.errored,
            gap,
          );
          if (isBadKind(kind)) {
            if (!excluded[key]) excluded[key] = {};
            excluded[key][pid] = { reason: kind, updatedAt: Date.now() };
            setExcludedMap(excluded); // persist live for the visual
          }
        }
      }
      onProgress?.(probes);
    }
    scanningProviders.set(null);
    setExcludedMap(excluded);

    const result = buildResult(
      mediaId,
      {
        title: resolveTitle(media),
        cover: media.coverImage?.large ?? media.coverImage?.extraLarge,
      },
      read,
      gap,
      probes,
    );
    return { probes, result };
  }

  async function runScan(force: boolean) {
    scanning.set(true);
    cancelRequested.set(false);
    try {
      status.set("Loading collection…");
      const col = await ctx.manga.getCollection();
      const entries = readingEntries(col);
      if (!entries.length) {
        status.set("No manga in your reading list");
        return;
      }

      const providers = ctx.manga.getProviders();
      if (!Object.keys(providers).filter((p) => p !== "local-manga").length) {
        status.set("No manga providers installed");
        return;
      }

      // Start toast (mirrors the per-manga detail scan), fired only once we know
      // there's something to scan.
      ctx.toast.info(`Scanning ${entries.length} manga…`);

      const ttlMs =
        (Number($getUserPreference("ttlMinutes") ?? "60") || 60) * 60000;
      const gap = Number($getUserPreference("farBehindGap") ?? "10") || 10;
      const now = Date.now();

      const stored = getResults();

      // Seed the working list from what's already shown, so cancelling (or a
      // crash) leaves the prior rows intact — each manga is UPDATED in place as
      // it's scanned, never wiped up front.
      const out: MangaResult[] = [...results.get()];
      const upsert = (row: MangaResult) => {
        const idx = out.findIndex((r) => r.mediaId === row.mediaId);
        if (idx >= 0) out[idx] = row;
        else out.push(row);
        results.set([...out]);
      };
      let scanned = 0;
      let cached = 0;

      for (let i = 0; i < entries.length; i++) {
        if (cancelRequested.get()) break;
        const entry = entries[i];
        const media = entry.media as $app.AL_BaseManga;
        const mediaId = Number(entry.mediaId ?? media.id);
        const key = String(mediaId);
        const read = Number(entry.listData?.progress ?? 0);
        captureSourceRef(mediaId, media);
        const title = resolveTitle(media);
        const cover = media.coverImage?.large ?? media.coverImage?.extraLarge;
        // Advance the global progress (also counts TTL-cached manga below).
        scanStatus.set({
          done: i + 1,
          total: entries.length,
          title,
          cover,
          mediaId,
        });

        // TTL skip: a good, fresh prior result is reused without any network.
        const prior = stored[key];
        if (
          !force &&
          prior &&
          !isBadKind(prior.kind) &&
          now - Number(prior.lastScannedAt ?? prior.updatedAt) < ttlMs
        ) {
          upsert({
            ...prior,
            mediaId,
            title,
            isNew: prior.kind === "new",
            fromCache: true,
          });
          cached++;
          continue;
        }

        status.set(`Scanning ${i + 1}/${entries.length}: ${title}…`);
        // Keep the prior row visible while this manga is scanned (toRow overlays
        // a live "⏳" badge from scanProgress). Only insert a placeholder for a
        // manga with no existing row, so an established result never blanks out.
        if (!out.some((r) => r.mediaId === mediaId)) {
          upsert({
            title,
            cover: media.coverImage?.large ?? media.coverImage?.extraLarge,
            latest: 0,
            read,
            sources: 0,
            kind: "up-to-date",
            updatedAt: now,
            mediaId,
            isNew: false,
            fromCache: false,
          });
        }

        const { probes, result } = await scanOneManga(
          mediaId,
          media,
          read,
          gap,
          (partialProbes) => {
            setProbes(mediaId, partialProbes);
            const partial = buildResult(
              mediaId,
              {
                title,
                cover: media.coverImage?.large ?? media.coverImage?.extraLarge,
              },
              read,
              gap,
              partialProbes,
            );
            upsert({
              ...partial,
              mediaId,
              isNew: partial.kind === "new",
              fromCache: false,
            });
          },
        );
        // Persist the per-source probes too, so opening this manga's detail
        // shows each provider's result instead of "not scanned".
        setProbes(mediaId, probes);
        stored[key] = result;
        // Persist progressively: a cancel/crash mid-scan keeps the prior data
        // plus whatever was just scanned, instead of only writing at the end.
        setResults(stored);
        upsert({
          ...result,
          mediaId,
          isNew: result.kind === "new",
          fromCache: false,
        });
        scanned++;
      }

      setResults(stored);

      const newCount = out.filter((r) => r.isNew).length;
      const cancelled = cancelRequested.get();
      const summary = `${newCount} new · ${scanned} scanned · ${cached} cached`;
      status.set(`${cancelled ? "Cancelled" : "Done"} — ${summary}`);
      if (cancelled) ctx.toast.info(`Scan cancelled — ${summary}`);
      else if (newCount > 0)
        ctx.toast.success(`${newCount} manga with new chapters · ${summary}`);
      else ctx.toast.info(`No new chapters — ${summary}`);
    } catch (e) {
      status.set(`Error: ${String(e)}`);
      ctx.toast.error("Scan failed");
    } finally {
      scanning.set(false);
      scanProgress.set(null);
      scanningProviders.set(null);
      scanStatus.set(null);
      // Push the scan's output once, at the end (covers cancellation too).
      livePush(["digest", "probes", "exclusions"]);
    }
  }

  // A per-manga / per-source scan is in flight — the global scan must not start
  // on top of it (they'd fight over emptyCache + the shared scanProgress state).
  const individualScanRunning = () =>
    probingId.get() != null || scanningProvider.get() !== "";

  // Gate for wiring MSU scans onto seanime's OWN buttons ("Reload sources" on the
  // entry page, "Refresh sources" on the library). Default on. MSU's own tray
  // controls are unaffected — this only governs the native-button hooks.
  const syncNativeButtons = (): boolean =>
    ($getUserPreference("syncNativeButtons") ?? "true") !== "false";

  // A scan (global OR per-manga) is already running — reject a new trigger with a
  // toast instead of silently ignoring it (per the concurrency requirement). Any
  // user-initiated scan entry point routes through this first.
  const rejectIfBusy = (): boolean => {
    if (scanning.get() || individualScanRunning()) {
      ctx.toast.info(
        "A scan is already running — wait for it to finish before starting another",
      );
      return true;
    }
    return false;
  };

  // Per-action confirm copy + the work each one runs. clearExclusions/runScan
  // are hoisted declarations, so referencing them here (before their line) is
  // fine — .run only fires on confirmation, long after init.
  const CONFIRM: Record<
    ConfirmKind,
    { title: string; subtitle: string; button: string; run: () => void }
  > = {
    scan: {
      title: "Refresh all sources?",
      subtitle:
        "Scans every manga in your reading list across all installed sources — this can take a while.",
      button: "↻ Scan all",
      run: () => void runScan(false),
    },
    force: {
      title: "Force rescan all sources?",
      subtitle:
        "Re-probes every manga from scratch, ignoring cached results — this can take a while.",
      button: "↻ Force rescan",
      run: () => void runScan(true),
    },
    clear: {
      title: "Clear all exclusions?",
      subtitle:
        "Wipes every excluded/pinned source, then rediscovers all sources from scratch — this can take a while.",
      button: "Clear & rescan",
      run: () => {
        clearExclusions();
        ctx.toast.success("Exclusions cleared — rediscovering from scratch");
        void runScan(true);
      },
    },
  };

  // Open the confirm modal for a whole-list action (from the library menu, the
  // tray "↻ Scan", or the "…" dropdown). Guarded so repeated clicks while a
  // scan runs just toast.
  const requestConfirm = (kind: ConfirmKind) => {
    if (rejectIfBusy()) return;
    pendingConfirm.set(kind);
    // The modal lives in the tray tree, so the tray must be open to show it.
    try {
      tray.open();
    } catch {
      /* tray unavailable (not pinned) — run without the modal as a fallback */
      CONFIRM[kind].run();
    }
  };

  ctx.registerEventHandler("msu-gconfirm-close", () =>
    pendingConfirm.set(null),
  );
  ctx.registerEventHandler("msu-gconfirm-run", () => {
    const kind = pendingConfirm.get();
    pendingConfirm.set(null);
    if (!kind) return;
    if (rejectIfBusy()) return; // a scan slipped in while the modal was open
    CONFIRM[kind].run();
  });

  ctx.registerEventHandler("msu-scan", () => {
    requestConfirm("scan");
  });

  ctx.registerEventHandler("msu-force", () => {
    requestConfirm("force");
  });

  ctx.registerEventHandler("msu-cancel", () => {
    if (!scanning.get()) return;
    cancelRequested.set(true);
    status.set("Cancelling…");
  });

  ctx.registerEventHandler("msu-sync-now", () => {
    void requestSync("all", "manual", false);
  });

  ctx.registerEventHandler("msu-connect", () => {
    void connectGitHub();
  });

  ctx.registerEventHandler("msu-sync-disconnect", () => {
    $storage.set(K_OAUTH_TOKEN, "");
    oauthTok.set(""); // reactive: re-render even if syncedAt was already 0
    // Keep K_GIST_ID so re-connecting re-uses the same gist; clearing the token
    // is enough to stop syncing. (PAT is a config field the user manages.)
    syncedAt.set(0);
    ctx.toast.info("Disconnected. (Clear the PAT config field to fully stop.)");
  });

  // Clear exclusions + pins for a scope so the next scan re-discovers every
  // source from 0 (pure map logic lives in utils/exclusions; this just does the
  // $storage I/O around it). Pass a mediaId for one manga, omit for all.
  function clearExclusions(mediaId?: number) {
    const next = clearedExclusions(
      getExcluded(),
      getPinned(),
      mediaId,
      Date.now(),
    );
    setExcludedMap(next.excluded);
    setPinnedMap(next.pinned);
    livePush(["exclusions", "pins"]);
  }

  ctx.registerEventHandler("msu-clear-excl", () => {
    requestConfirm("clear");
  });

  ctx.registerEventHandler("msu-back", () => {
    const id = detailId.get();
    detailId.set(null);
    void (async () => {
      if (id != null) await syncProbesFromCache(id);
      await refreshProgress();
    })();
  });

  // Find a manga's media + progress for probing. Searches the WHOLE collection
  // (any status) so the detail works from a manga entry page too; falls back to
  // a direct AniList lookup for manga not in the user's list (progress → 0).
  async function findEntry(
    mediaId: number,
  ): Promise<{ media: $app.AL_BaseManga; read: number } | null> {
    const col = await ctx.manga.getCollection();
    for (const list of col.lists ?? []) {
      for (const e of list.entries ?? []) {
        const m = e?.media as $app.AL_BaseManga | undefined;
        if (m && Number(e.mediaId ?? m.id) === mediaId) {
          return { media: m, read: Number(e.listData?.progress ?? 0) };
        }
      }
    }
    try {
      const m = $anilist.getManga(mediaId);
      if (m) return { media: m, read: 0 };
    } catch {
      // not on AniList / lookup failed
    }
    return null;
  }

  // Persist a manga's row summary to $storage and update the in-memory list
  // (replace if present, else append). Shared by every scan path.
  function syncRow(mediaId: number, result: StoredResult) {
    const stored = getResults();
    stored[String(mediaId)] = result;
    setResults(stored);
    const row: MangaResult = {
      ...result,
      mediaId,
      isNew: result.kind === "new",
      fromCache: false,
    };
    const cur = results.get();
    results.set(
      cur.some((r) => r.mediaId === mediaId)
        ? cur.map((r) => (r.mediaId === mediaId ? row : r))
        : [...cur, row],
    );
  }

  // Recompute the list-row summary from cached per-source probes (respects
  // exclusions). The detail view already filters probes live; the stored row
  // must be updated too or a dropped wrong-match keeps inflating latest/+N.
  function rebuildStoredRow(mediaId: number, readOverride?: number) {
    const cur = results.get().find((r) => r.mediaId === mediaId);
    const probes = probeCache.get()[mediaId];
    if (!cur || !probes || !Object.keys(probes).length) return;
    const gap = Number($getUserPreference("farBehindGap") ?? "10") || 10;
    const read = readOverride ?? cur.read;
    syncRow(mediaId, buildResult(mediaId, cur, read, gap, probes));
  }

  // Pull per-source probes from seanime's chapter cache (manual match, reader,
  // Refresh sources) without emptyCache or title-based re-search — fixes stale
  // wrong-match counts left in K_PROBES after the user corrects a provider.
  async function syncProbesFromCache(mediaId: number) {
    if (scanning.get() || individualScanRunning()) return;

    const existing = probeCache.get()[mediaId] ?? {};
    const key = String(mediaId);
    const excluded = getExcludedView();
    const providers = ctx.manga.getProviders();
    const providerIds = Object.keys(existing).length
      ? Object.keys(existing)
      : Object.keys(providers).filter((p) => isActiveProvider(p, providers));
    if (!providerIds.length) return;

    const next: ProbeMap = { ...existing };
    let changed = false;

    for (const pid of providerIds) {
      if (excluded[key]?.[pid] != null) continue;
      const chs = await readCachedContainer(mediaId, pid);
      // Only UPGRADE from a cache read that actually returned chapters. A miss
      // (null = thrown, [] = no cached container) must NOT downgrade a
      // previously-good probe to error/no-match — that made opening the detail
      // flip every source to "error" when seanime had no cache. Re-fetching a
      // source stays strictly on-demand (the Scan buttons).
      if (!chs || chs.length === 0) continue;
      const probe = makeProbe(pid, providers[pid] ?? pid, chs);
      const prev = existing[pid];
      if (
        !prev ||
        prev.latest !== probe.latest ||
        prev.count !== probe.count ||
        prev.matched !== probe.matched ||
        prev.errored !== probe.errored
      ) {
        next[pid] = probe;
        changed = true;
      }
    }

    if (!changed) return;
    setProbes(mediaId, next);
    const cur = results.get().find((r) => r.mediaId === mediaId);
    if (cur) {
      rebuildStoredRow(mediaId, cur.read);
      return;
    }
    const found = await findEntry(mediaId);
    if (found) rebuildStoredRow(mediaId, found.read);
  }

  async function probeMangaDetail(mediaId: number) {
    // One scan at a time: never start on top of another per-manga / per-source
    // scan or the global scan — they'd share emptyCache + scanProgress and race.
    if (scanning.get() || individualScanRunning()) return;
    probingId.set(mediaId);
    // This is its own scan op with no cancel button — don't inherit a leftover
    // `true` from a previously-cancelled global scan (which would make
    // scanOneManga's loop break immediately and fetch nothing).
    cancelRequested.set(false);
    try {
      const found = await findEntry(mediaId);
      if (!found) return;
      captureSourceRef(mediaId, found.media);
      const title = resolveTitle(found.media);
      detailTitle.set(title);
      detailCover.set(
        String(
          found.media.coverImage?.large ??
            found.media.coverImage?.extraLarge ??
            "",
        ),
      );
      detailRead.set(found.read);
      const gap = Number($getUserPreference("farBehindGap") ?? "10") || 10;
      ctx.toast.info(`Checking sources for ${title}…`);

      const { result } = await scanOneManga(
        mediaId,
        found.media,
        found.read,
        gap,
        // Merge onto the prior probes so already-scanned sources keep their old
        // result until this run overwrites them — no blank "not scanned" gap.
        (probes) =>
          setProbes(mediaId, { ...probeCache.get()[mediaId], ...probes }),
      );

      syncRow(mediaId, result);

      ctx.toast.success(`${result.sources} sources have ${title}`);
    } catch {
      ctx.toast.error("Failed to probe sources");
    } finally {
      if (probingId.get() === mediaId) probingId.set(null);
      scanProgress.set(null);
      scanningProviders.set(null);
      // End-of-scan push (also fires when cancelled from the webview panel —
      // panel-cancel flips cancelRequested and this scan returns into finally).
      livePush(["digest", "probes", "exclusions"]);
    }
  }

  // Scan one provider (emptyCache + title search), merge probe, refresh list row.
  // Tray rescan, re-include, and manual-match hook all use this.
  async function scanOneProvider(mediaId: number, provider: string) {
    if (scanning.get() || individualScanRunning()) return;
    scanningProvider.set(provider);
    cancelRequested.set(false); // don't inherit a stale cancel from a prior scan
    // Single-source fetch — drive the floating panel with a 1-step progress so a
    // "Checking sources" indicator shows (this path also fires from the
    // manual-match hook / re-include, outside the detail view's own ⏳ button).
    scanProgress.set({ mediaId, done: 0, total: 1 });
    try {
      const found = await findEntry(mediaId);
      if (!found) return;
      const providers = ctx.manga.getProviders();
      const titles = collectTitles(found.media);
      const year = found.media.startDate?.year;
      await ctx.manga.emptyCache(mediaId);
      const chs = await readContainer(mediaId, provider, titles, year, true);
      scanProgress.set({ mediaId, done: 1, total: 1 });
      if (cancelRequested.get()) return; // cancelled mid-fetch — drop the result
      const probe = makeProbe(provider, providers[provider] ?? provider, chs);
      const gap = Number($getUserPreference("farBehindGap") ?? "10") || 10;
      const merged = {
        ...(probeCache.get()[mediaId] ?? {}),
        [provider]: probe,
      };
      setProbes(mediaId, merged);
      syncRow(
        mediaId,
        buildResult(
          mediaId,
          {
            title: resolveTitle(found.media),
            cover:
              found.media.coverImage?.large ??
              found.media.coverImage?.extraLarge,
          },
          found.read,
          gap,
          merged,
        ),
      );
    } catch {
      ctx.toast.error("Failed to scan source");
    } finally {
      scanningProvider.set("");
      scanProgress.set(null);
      // End-of-scan push (also on webview-panel cancel — see probeMangaDetail).
      livePush(["digest", "probes"]);
    }
  }

  // Load the detail header metadata (title / cover / progress) WITHOUT scanning
  // any provider — cheap collection/AniList lookup only. Used when opening the
  // detail for a manga that isn't already a scanned list row.
  async function loadDetailMeta(mediaId: number) {
    const found = await findEntry(mediaId);
    if (!found) return;
    detailTitle.set(resolveTitle(found.media));
    detailCover.set(
      String(
        found.media.coverImage?.large ??
          found.media.coverImage?.extraLarge ??
          "",
      ),
    );
    detailRead.set(found.read);
  }

  // Open the detail view for a manga. Does NOT scan — sources show "not scanned"
  // until the user hits Scan. Only loads header metadata when the manga isn't
  // already a scanned list row.
  function openDetail(mediaId: number) {
    detailId.set(mediaId);
    void syncProbesFromCache(mediaId);
    if (!results.get().some((r) => r.mediaId === mediaId)) {
      void loadDetailMeta(mediaId);
    }
  }

  // Re-scan just the manga currently shown in the detail view. Keeps the prior
  // per-source results visible and updates them in place as the scan resolves
  // (probeMangaDetail merges onto the existing probes), instead of blanking
  // everything to "not scanned" first.
  function rescanCurrent() {
    const id = detailId.get();
    if (id == null || probingId.get() === id) return;
    void probeMangaDetail(id);
  }

  // Manual exclude/include also pin the source so a later scan's auto-exclude
  // can't undo the user's choice (matches the fork's pin-on-toggle behavior).
  function setExcluded(
    mediaId: number,
    provider: string,
    exclude: boolean,
    reason: ExcludeReason = "other",
  ) {
    const key = String(mediaId);
    const excluded = getExcluded();
    const pinned = getPinned();
    if (exclude) {
      if (!excluded[key]) excluded[key] = {};
      excluded[key][provider] = { reason, updatedAt: Date.now() };
    } else {
      const prev = excluded[key]?.[provider];
      if (prev) {
        excluded[key][provider] = {
          ...prev,
          updatedAt: Date.now(),
          deletedAt: Date.now(),
        };
      }
    }
    if (!pinned[key]) pinned[key] = {};
    pinned[key][provider] = { updatedAt: Date.now() };
    setExcludedMap(excluded);
    setPinnedMap(pinned);
    // Live push the manual choice immediately. The digest/probes it also nudges
    // (via the rescan/rebuild below) ride the scan-scoped push, not this one.
    livePush(["exclusions", "pins"]);
    ctx.toast.info(exclude ? "Excluded source" : "Included source");
    // A re-included source wasn't probed (excluded ones are skipped), so it has
    // no chapter data yet — scan JUST that source to fetch it (this re-renders
    // and leaves the other providers' results untouched). Excluding drops the
    // source from the row summary immediately so a wrong-match can't keep +N.
    if (!exclude && detailId.get() === mediaId) {
      void scanOneProvider(mediaId, provider);
    } else {
      rebuildStoredRow(mediaId);
    }
  }

  function toRow(r: MangaResult): EntryListRow {
    // While the global scan is on this manga, a trailing badge shows live
    // progress alongside the status pill / details button.
    const prog = scanProgress.get();
    const scanning =
      prog != null && prog.mediaId === r.mediaId
        ? tray.badge(prog.total ? `⏳ ${prog.done}/${prog.total}` : "⏳", {
            intent: "gray",
          })
        : null;
    const actions: unknown[] = [];
    if (scanning) actions.push(scanning);
    const s = statusFor(r);
    actions.push(
      tray.tooltip(tray.badge(s.label, { intent: s.intent }), { text: s.tip }),
    );
    actions.push(
      tray.tooltip(
        tray.button("⚙️", {
          onClick: ctx.eventHandler(`msu-detail-${r.mediaId}`, () =>
            openDetail(r.mediaId),
          ),
          size: "sm",
          intent: "gray-subtle",
        }),
        { text: "Sources & details" },
      ),
    );
    return {
      cover: r.cover,
      title: r.title,
      chapter: r.read,
      openInPlace: {
        onClick: ctx.eventHandler(`msu-open-${r.mediaId}`, () => {
          ctx.screen.navigateTo("/manga/entry", { id: String(r.mediaId) });
          tray.close();
        }),
        tooltip: "Open in seanime",
      },
      actions,
    };
  }

  function listSection(headerLabel: string, rows: MangaResult[]): unknown {
    if (!rows.length) return null;
    return entryList(tray, {
      headerLabel,
      rows: rows.map(toRow),
      totalCount: rows.length,
      searchActive: false,
      searchFieldRef: noSearchRef,
      searchPlaceholder: "",
      onSearch: "",
      onClearSearch: "",
      showSearchRow: false,
      emptyText: "",
      noMatchText: "",
    });
  }

  function renderNewOn(): unknown {
    return listSection(
      "New chapters",
      results.get().filter((r) => r.isNew),
    );
  }

  // Reading list shows only the manga WITHOUT new chapters — the new ones live
  // in the section above, so nothing is listed twice (keeps the scroll short).
  function renderResults(): unknown {
    return listSection(
      "Reading list",
      results.get().filter((r) => !r.isNew),
    );
  }

  // Sync status + controls — a self-contained section composed as a page-stack
  // block (see the tray spacing convention). Not-connected state shows a
  // "Connect GitHub" button that starts the device flow; while a flow is in
  // progress this section is replaced entirely by the device-code prompt
  // (user code + "Open GitHub" link) so the user isn't shown stale controls.
  // The PAT config field remains a working auth path alongside device flow.
  function renderSyncSection(): unknown {
    const start = deviceStart.get();
    const connected = hasSync();
    const via = oauthToken() ? "GitHub login" : patToken() ? "PAT" : "";

    // Shared connect flow; "Sync now" rides along as a connected-state action.
    return githubConnect(tray, {
      deviceStart: start,
      title: "🌐 Sync",
      connecting: connecting.get(),
      connected,
      // Only the device-flow token is clearable here; a PAT lives in config.
      disconnectable: !!oauthToken(),
      connectEvent: "msu-connect",
      disconnectEvent: "msu-sync-disconnect",
      status: {
        connected,
        syncing: syncing.get(),
        lastSyncedAt: syncedAt.get(),
        via,
      },
      connectedActions: [
        {
          label: syncing.get() ? "Syncing…" : "Sync now",
          onClick: "msu-sync-now",
          disabled: syncing.get(),
        },
      ],
    });
  }

  // Per-manga detail view: every probed source split into AVAILABLE / EXCLUDED
  // groups (alphabetical), each with an Exclude / Include control.
  function renderDetail(): unknown {
    const id = detailId.get();
    if (id == null) return null;
    const key = String(id);
    const cur = results.get().find((r) => r.mediaId === id);
    const excluded = getExcludedView();
    const excludedForManga = excluded[key] ?? {};
    // Probes for this manga, keyed by provider id (empty = never scanned).
    const probeByProvider = probeCache.get()[id] ?? {};
    // Per-provider manual-match state across instances → an optional warn pill
    // when this device disagrees with another (different series / removed here).
    const matchesForManga = getMatches()[key] ?? {};
    const matchWarn = (pid: string): EntryListRow["warn"] => {
      const div = matchDivergence(matchesForManga[pid]);
      if (!div.diverges) return undefined;
      return div.reason === "different"
        ? {
            label: "⚠ ≠",
            tooltip:
              "Matched to a different series on another device — count may be off.",
          }
        : {
            label: "⚠ ?",
            tooltip:
              "Manually matched on another device, not here — count may be off.",
          };
    };
    // This manga is being scanned right now. probingId is set synchronously when
    // the manga scan starts (so the loading state shows on the first re-render,
    // before the awaits reach scanProgress); scanProgress carries done/total once
    // fetching begins (also covers the global scan reaching this manga).
    const prog = scanProgress.get();
    const hasProg = prog != null && prog.mediaId === id;
    const scanningThis = probingId.get() === id || hasProg;
    // Disable the scan controls whenever ANY scan is running — including a global
    // scan on another manga (scanning.get()) — since only one scan runs at a time
    // and a click would just be rejected with a toast.
    const busy =
      scanningThis || scanningProvider.get() !== "" || scanning.get();
    const inflight = scanningProviders.get();
    const isPidScanning = (pid: string): boolean =>
      scanningProvider.get() === pid ||
      (inflight?.mediaId === id && inflight.pids.includes(pid));
    const title = cur?.title || detailTitle.get() || "Manga";
    const read = cur?.read ?? detailRead.get();
    const gap = Number($getUserPreference("farBehindGap") ?? "10") || 10;

    const head = trayHeader(tray, {
      title,
      subtitle: read > 0 ? `Read c.${read}` : "Not started",
      // String() unwraps a goja-wrapped empty cover so `||` falls through to the
      // manifest icon instead of passing an empty (but truthy) src to tray.img.
      iconUrl: String(cur?.cover ?? "") || detailCover.get() || undefined,
      right: [
        tray.button("← Back", {
          onClick: "msu-back",
          size: "sm",
          intent: "gray-subtle",
        }),
      ],
    });

    const actionRow = tray.flex(
      [
        // Only when this manga has exclusions: wipe them + pins and re-discover
        // from 0 (probeMangaDetail re-fetches every source and re-runs auto-exclude).
        ...(Object.keys(excludedForManga).length > 0
          ? [
              tray.button("Clear exclusions", {
                onClick: ctx.eventHandler(`msu-clr-${id}`, () => {
                  if (scanning.get() || individualScanRunning()) {
                    ctx.toast.info("A scan is already running");
                    return;
                  }
                  clearExclusions(id);
                  ctx.toast.success("Exclusions cleared — rescanning sources");
                  void probeMangaDetail(id);
                }),
                size: "sm",
                intent: "alert-subtle",
                disabled: busy,
              }),
            ]
          : []),
        tray.button(
          scanningThis
            ? hasProg
              ? `⏳ Scanning ${prog.done}/${prog.total}`
              : "⏳ Scanning…"
            : "↻ Scan this manga",
          {
            onClick: ctx.eventHandler(`msu-rescan-${id}`, () =>
              rescanCurrent(),
            ),
            size: "sm",
            intent: "gray-subtle",
            disabled: busy,
          },
        ),
        tray.button("Open →", {
          onClick: ctx.eventHandler(`msu-dopen-${id}`, () => {
            ctx.screen.navigateTo("/manga/entry", { id: key });
            tray.close();
          }),
          size: "sm",
          intent: "gray-subtle",
        }),
      ],
      { gap: 2, style: { alignItems: "center", justifyContent: "flex-end" } },
    );

    const providers = ctx.manga.getProviders();

    // Status pill for an available source: "+N" once probed & matched (color
    // by kind), else the word state ("not scanned" / "error" / "no match"). The
    // source's latest chapter rides the row's separate `c.{chapter}` slot.
    const sourceStatus = (
      p: ProviderProbe | undefined,
    ): { label: string; intent: $ui.BadgeComponentIntent } => {
      if (!p) return { label: "not scanned", intent: "gray" };
      if (!p.matched)
        return p.errored
          ? { label: "error", intent: "alert" }
          : { label: "no match", intent: "warning" };
      const kind = classify(read, p.latest, p.count, p.errored, gap);
      const newCount = unreadChapters(read, p.latest);
      const intent =
        newCount > 0 ? "success" : kind === "outdated" ? "warning" : "gray";
      return { label: `+${newCount}`, intent };
    };

    // AVAILABLE row: every non-excluded provider (probed or not). status =
    // source state, chapter = its latest, actions = rescan + Exclude dropdown.
    const availableRow = (pid: string): EntryListRow => {
      const p = probeByProvider[pid];
      const name = p ? p.providerName : String(providers[pid] ?? pid);
      return {
        title: name,
        status: sourceStatus(p),
        warn: matchWarn(pid),
        chapter: p?.matched ? p.latest : undefined,
        actions: [
          tray.tooltip(
            tray.button(isPidScanning(pid) ? "⏳" : "↻", {
              onClick: ctx.eventHandler(`msu-rescan1-${id}-${pid}`, () =>
                scanOneProvider(id, pid),
              ),
              size: "sm",
              intent: "gray-subtle",
              // Disabled while the whole manga is scanning or any single-source
              // scan is in flight (one at a time).
              disabled: busy,
            }),
            { text: "Rescan this source" },
          ),
          tray.dropdownMenu({
            trigger: tray.button("Exclude ▾", {
              size: "sm",
              intent: "alert-subtle",
            }),
            items: (Object.keys(REASONS) as ExcludeReason[]).map((rk) =>
              // Positional form with a badge — the object `{ item }` form renders
              // as an empty-type component ("component type '' not found"). The
              // badge intent matches the EXCLUDED row badge for the same reason.
              tray.dropdownMenuItem(
                tray.badge(REASONS[rk].menu, { intent: reasonIntent(rk) }),
                {
                  onClick: ctx.eventHandler(`msu-exc-${id}-${pid}-${rk}`, () =>
                    setExcluded(id, pid, true, rk),
                  ),
                },
              ),
            ),
          }),
        ],
      };
    };

    // EXCLUDED row: name + why it was excluded (excluded sources aren't probed
    // for chapters, so no status count / chapter) + Include.
    const excludedRow = (pid: string): EntryListRow => {
      const p = probeByProvider[pid];
      const name = p ? p.providerName : String(providers[pid] ?? pid);
      const reason = excludedForManga[pid] as ExcludeReason;
      return {
        title: name,
        status: { label: reasonLabel(reason), intent: reasonIntent(reason) },
        warn: matchWarn(pid),
        actions: [
          tray.button("Include", {
            onClick: ctx.eventHandler(`msu-inc-${id}-${pid}`, () =>
              setExcluded(id, pid, false),
            ),
            size: "sm",
            intent: "primary-subtle",
          }),
        ],
      };
    };

    // AVAILABLE = every non-excluded provider (shown "not scanned" until probed);
    // EXCLUDED = the stored exclusion map. Probe data is looked up per provider.
    // Highest chapter first (sources with the most/newest chapters lead;
    // not-scanned sinks to the bottom), ties broken alphabetically.
    const latestOf = (pid: string) => probeByProvider[pid]?.latest ?? -1;
    const includedIds = Object.keys(providers)
      .filter((pid) => pid !== "local-manga" && excludedForManga[pid] == null)
      .filter((pid) => isActiveProvider(pid, providers))
      .sort((a, b) => {
        const byLatest = latestOf(b) - latestOf(a);
        if (byLatest !== 0) return byLatest;
        return String(providers[a] ?? a).localeCompare(
          String(providers[b] ?? b),
        );
      });
    const excludedIds = Object.keys(excludedForManga)
      .filter((pid) => isActiveProvider(pid, providers))
      .sort((a, b) =>
        String(providers[a] ?? a).localeCompare(String(providers[b] ?? b)),
      );
    // Both groups are entry-list sections. AVAILABLE always renders (its empty
    // state carries the "No sources" / "Scanning" caption); EXCLUDED only when
    // there's at least one excluded source (null → joinDividers skips it).
    const availableSection = entryList(tray, {
      headerLabel: "AVAILABLE",
      rows: includedIds.map(availableRow),
      totalCount: includedIds.length,
      searchActive: false,
      searchFieldRef: noSearchRef,
      searchPlaceholder: "",
      onSearch: "",
      onClearSearch: "",
      showSearchRow: false,
      emptyText: scanningThis ? "Scanning sources…" : "No sources",
      noMatchText: "",
    });
    const excludedSection = excludedIds.length
      ? entryList(tray, {
          headerLabel: "EXCLUDED",
          rows: excludedIds.map(excludedRow),
          totalCount: excludedIds.length,
          searchActive: false,
          searchFieldRef: noSearchRef,
          searchPlaceholder: "",
          onSearch: "",
          onClearSearch: "",
          showSearchRow: false,
          emptyText: "",
          noMatchText: "",
        })
      : null;

    const blocks = [head, actionRow, availableSection, excludedSection];
    return tray.stack(joinDividers(tray, blocks), { gap: 3 });
  }

  // Tray-icon badge (visible on every screen without opening the tray): how many
  // manga have new chapters — matches the "New chapters (N)" section count, and
  // rises live as scanning flips rows to isNew. Tinted "info" while a scan runs,
  // "success" when idle, cleared at 0.
  ctx.effect(() => {
    const newCount = results.get().filter((r) => r.isNew).length;
    if (scanning.get()) {
      tray.updateBadge({ number: newCount, intent: "info" });
      return;
    }
    tray.updateBadge(
      newCount > 0 ? { number: newCount, intent: "success" } : { number: 0 },
    );
  }, [results, scanning]);

  // What the floating panel shows: the global whole-list scan takes priority;
  // otherwise a single per-manga scan ("Scan this manga") drives the same panel.
  // scanProgress carries {done,total} per source but no title, so pull it from
  // the detail title / the manga's row.
  // `kind` disambiguates the panel's "x/y": a global scan counts MANGA across the
  // reading list ("library"), a single per-manga scan counts SOURCES ("sources").
  const panelStatus = ctx.state<{
    done: number;
    total: number;
    title: string;
    cover?: string;
    mediaId: number;
    cancelling: boolean;
    kind: "library" | "sources";
  } | null>(null);
  ctx.effect(() => {
    const cancelling = cancelRequested.get();
    const g = scanStatus.get();
    if (g) {
      panelStatus.set({ ...g, cancelling, kind: "library" });
      return;
    }
    const p = scanProgress.get();
    if (p) {
      const row = results.get().find((r) => r.mediaId === p.mediaId);
      const title = detailTitle.get() || row?.title || "";
      const cover = String(detailCover.get() || "") || row?.cover;
      panelStatus.set({
        done: p.done,
        total: p.total,
        title,
        cover,
        mediaId: p.mediaId,
        cancelling,
        kind: "sources",
      });
      return;
    }
    panelStatus.set(null);
  }, [scanStatus, scanProgress, detailTitle, detailCover, cancelRequested]);

  // Floating scan panel (slot "fixed" → global, draggable) showing live "X/Y +
  // current title + progress bar" on every screen. Only visible while a scan
  // runs: the show/hide effect follows panelStatus, which channel.sync mirrors
  // into the iframe.
  const scanPanel = ctx.newWebview({
    slot: "fixed",
    width: "320px",
    height: "108px",
    hidden: true,
    window: { draggable: true, defaultPosition: "bottom-right" },
  });
  scanPanel.channel.sync("scan", panelStatus);
  // Cancel button inside the floating panel — one flag covers every scan path:
  // the global loop (runScan) and the per-manga loop (scanOneManga) break on it,
  // and scanOneProvider drops its result. Only meaningful while a scan runs.
  scanPanel.channel.on("panel-cancel", () => {
    if (!scanning.get() && !individualScanRunning()) return;
    cancelRequested.set(true);
    status.set("Cancelling…");
  });
  // Click the panel cover → jump to that manga. If already on its entry page,
  // open the tray to its source detail; otherwise navigate to the entry.
  scanPanel.channel.on("panel-open", (mediaId: unknown) => {
    const id = Number(mediaId ?? 0);
    if (!Number.isFinite(id) || id <= 0) return;
    if (currentMediaId.get() === id) {
      openDetail(id);
      try {
        tray.open();
      } catch {
        /* tray unavailable (not pinned) */
      }
      return;
    }
    // Different manga → navigate to its entry. If the tray is already open, also
    // switch it to that manga's detail so it doesn't keep showing the old view.
    ctx.screen.navigateTo("/manga/entry", { id: String(id) });
    if (trayIsOpen) openDetail(id);
  });
  scanPanel.setContent(() => scanPanelHtml);
  // Toggle show/hide ONLY on the visibility transition, not on every counter
  // tick — calling show() each tick re-mounts the iframe (resetting it to the
  // 0% initial HTML before channel.sync re-pushes the value), which is the 0→N
  // flicker. The count itself flows to the already-mounted iframe via the sync.
  let panelVisible = false;
  ctx.effect(() => {
    const visible = panelStatus.get() != null;
    if (visible === panelVisible) return;
    panelVisible = visible;
    if (visible) scanPanel.show();
    else scanPanel.hide();
  }, [panelStatus]);

  // Re-read progress from the collection and recompute each row's summary from
  // cached probes (cheap, no provider fetch) so reading a chapter or toggling
  // exclusions stays in sync between the detail view and the list / tray badge.
  async function refreshProgress() {
    let col: $app.Manga_Collection;
    try {
      col = await ctx.manga.getCollection();
    } catch {
      return;
    }
    const readById: Record<number, number> = {};
    for (const list of col.lists ?? []) {
      for (const e of list.entries ?? []) {
        const m = e?.media as $app.AL_BaseManga | undefined;
        if (m)
          readById[Number(e.mediaId ?? m.id)] = Number(
            e.listData?.progress ?? 0,
          );
      }
    }
    const gap = Number($getUserPreference("farBehindGap") ?? "10") || 10;
    const stored = getResults();
    const probesById = probeCache.get();
    let changed = false;
    const next = results.get().map((r) => {
      const read = readById[r.mediaId] ?? r.read;
      const probes = probesById[r.mediaId];
      let latest = r.latest;
      let sources = r.sources;
      let newSources = r.newSources;
      let kind = r.kind;
      if (probes && Object.keys(probes).length > 0) {
        const summary = buildResult(r.mediaId, r, read, gap, probes);
        latest = summary.latest;
        sources = summary.sources;
        newSources = summary.newSources;
        kind = summary.kind;
      } else if (r.sources > 0) {
        kind = classify(read, r.latest, r.sources, false, gap);
      }
      const isNew = kind === "new";
      if (
        Number(read) === Number(r.read) &&
        latest === r.latest &&
        sources === r.sources &&
        newSources === r.newSources &&
        kind === r.kind &&
        isNew === r.isNew
      ) {
        return r;
      }
      changed = true;
      const row = { ...r, read, latest, sources, newSources, kind, isNew };
      stored[String(r.mediaId)] = {
        title: row.title,
        cover: row.cover,
        latest,
        read,
        sources,
        newSources,
        kind,
        updatedAt: row.updatedAt,
        lastScannedAt: r.lastScannedAt,
      };
      return row;
    });
    if (changed) {
      setResults(stored);
      results.set(next);
    }
  }

  // Shared DOM-injection harness (loop/duplicate guard, per-target lock,
  // restartable observers, re-arm lifecycle). Decorations are registered further
  // down; onNavigate re-arms it (SPA nav doesn't fire onMainTabReady).
  const dm = createDomDecorator(ctx);
  const headerProgress = createHeaderProgressReader(ctx);

  // Bounded concurrency for card decoration: fanning out ALL ~80 cards at once
  // stampedes the denshi DOM bridge (silent read/append failures → blank cards);
  // fully serial is reliable but slow. A small batch is the middle ground.
  // ponytail: 8 is a guess — lower if cards still drop, raise if it's slow.
  const CARD_DECORATE_BATCH = 8;

  // Opening the tray while on a manga entry page jumps to that manga's source
  // detail; opening it anywhere else shows the list.
  ctx.screen.onNavigate((e) => {
    const isManga = String(e.pathname ?? "").includes("/manga/");
    const raw = isManga ? e.searchParams?.id : "";
    const id = raw ? parseInt(String(raw), 10) : 0;
    const mediaId = Number.isFinite(id) ? id : 0;
    headerProgress.clearCache();
    currentMediaId.set(mediaId);
    delete lastMappingSigByMedia[mediaId];
    reconcileInactiveProviders();
    if (mediaId > 0) void syncProbesFromCache(mediaId);
    dm.arm();
  });
  ctx.screen.loadCurrent();

  tray.onClose(() => {
    trayIsOpen = false;
  });
  tray.onOpen(() => {
    trayIsOpen = true;
    void (async () => {
      const id = currentMediaId.get();
      reconcileInactiveProviders();
      for (const r of results.get()) {
        if (!r.isNew || r.mediaId === id) continue;
        await syncProbesFromCache(r.mediaId);
        $sleep(0);
      }
      await refreshProgress();
      if (id > 0) openDetail(id);
      else detailId.set(null);
      void requestSync("all", "tray opened", true);
    })();
  });

  // Native quick-access button on every manga entry page. Opens this manga's
  // source detail in the tray (no DOM injection — seanime provides the button
  // slot via ctx.action). Static 📚 label; the live per-manga status shows on
  // the card badge and the "New on:" bar, so the button stays a plain opener.
  const entryButton = ctx.action.newMangaPageButton({
    label: "📚",
    intent: "gray-subtle",
    tooltipText: "Manage source preferences",
  });
  entryButton.mount();
  entryButton.onClick((e) => {
    const id = Number(e.media?.id ?? 0);
    if (id > 0) {
      currentMediaId.set(id);
      openDetail(id);
    }
    // tray.open() works whether or not the tray icon is pinned.
    try {
      tray.open();
    } catch {
      /* tray unavailable */
    }
  });

  // §3: overlay a compact "+N" badge on scanned manga cards in the library grid.
  // Pure DOM (seanime has no card-badge API). The badge lives in the top-left
  // corner of the cover; each carries a data-msu-sig signature encoding its
  // desired content, so a re-fire whose signature already matches does nothing
  // (no mutation → no observer loop), while a scan/read that changes the numbers
  // produces a new signature and re-decorates. Unread is computed from the
  // card's own data-list-data progress, so reading a chapter updates the badge
  // with no gap (seanime re-renders the card → observer re-fires → fresh number).
  const cardBadgeBgClass = (intent: $ui.BadgeComponentIntent): string => {
    switch (intent) {
      case "success":
        return "bg-green-500";
      case "warning":
        return "bg-orange-500";
      case "alert":
        return "bg-red-500";
      default:
        return "bg-gray-500";
    }
  };

  const cardBadgeContent = (
    mediaId: number,
    progress: number,
  ): {
    sig: string;
    row: MangaResult | undefined;
    label: string;
    intent: $ui.BadgeComponentIntent;
    tip: string;
  } => {
    const row = results.get().find((r) => r.mediaId === mediaId);
    if (!row) {
      return {
        sig: `${mediaId}:none`,
        row: undefined,
        label: "",
        intent: "gray",
        tip: "",
      };
    }
    const gap = Number($getUserPreference("farBehindGap") ?? "10") || 10;
    const kind = cardBadgeKind(row, progress, gap);
    const s = statusFor({ ...row, read: progress, kind }, true);
    return {
      sig: `${mediaId}:${s.label}:${s.intent}`,
      row,
      label: s.label,
      intent: s.intent,
      tip: s.tip,
    };
  };

  // §3: a "+N · M" badge on scanned manga cards in the library grid. Compute the
  // desired content, then hand off to the shared harness (loop/duplicate guard,
  // per-mediaId lock, denshi-safe query/append). Unread is derived from the
  // card's OWN live progress so a read updates it with no gap.
  const decorateCard = async (el: $ui.DOMElement) => {
    let attrsCache: ReturnType<typeof readCardAttrs> | null = null;
    const cardAttrs = () => {
      if (!attrsCache) attrsCache = readCardAttrs(el);
      return attrsCache;
    };

    const { mediaId } = await cardAttrs();
    if (!mediaId) return;

    await dm.decorate(el, {
      marker: "msu-card-badge",
      lockKey: String(mediaId),
      sig: async () => {
        const { progress } = await cardAttrs();
        return cardBadgeContent(mediaId, progress).sig;
      },
      render: async (node) => {
        const { progress } = await cardAttrs();
        const { row, label, intent, tip } = cardBadgeContent(mediaId, progress);
        if (!row) {
          node.setStyle("display", "none");
          el.append(node);
          return;
        }
        const bgClass = cardBadgeBgClass(intent);
        node.setStyle("position", "absolute");
        node.setStyle("z-index", "16");
        node.setStyle("left", "0.25rem");
        node.setStyle("top", "0.5rem");
        node.setStyle("pointer-events", "none");
        node.setInnerHTML(
          `<span title="${tip}" class="UI-Badge__root inline-flex flex-none w-fit overflow-hidden justify-center items-center gap-2 group/badge text-white ${bgClass} h-7 px-1.5 text-xs font-semibold tracking-wide rounded-full shadow-md">${label}</span>`,
        );
        el.append(node);
      },
    });
  };

  // Decorate cards in small bounded batches with a yield between each, so badges
  // stream in progressively and the grid stays responsive instead of freezing on
  // one big fan-out (which stampedes the denshi bridge and injects "de golpe").
  const decorateCards = async (els: $ui.DOMElement[]) => {
    for (let i = 0; i < els.length; i += CARD_DECORATE_BATCH) {
      await Promise.all(
        els.slice(i, i + CARD_DECORATE_BATCH).map((el) => decorateCard(el)),
      );
      $sleep(0);
    }
  };

  // §2: a "New on: {source} +N" bar in the chapter-list header of the entry page
  // — ports the fork's data-chapter-list-unread-by-source to vanilla. Lists every
  // non-excluded, matched source with unread chapters; the reader's currently
  // selected source (data-selected-provider) is highlighted green, the rest blue.
  // Informational only (a plugin can't flip the reader's Source dropdown).
  // Progress is read live from the entry header, so reading a chapter updates the
  // counts with no gap.
  const escHtml = (s: string) =>
    String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/"/g, "&quot;");

  const buildBarItems = async (container: $ui.DOMElement, mediaId: number) => {
    const selectedPid = await readSelectedProvider(ctx, container);
    let read = results.get().find((r) => r.mediaId === mediaId)?.read ?? 0;
    const fromHeader = await headerProgress.read();
    if (fromHeader != null) read = fromHeader;

    const key = String(mediaId);
    const probes = probeCache.get()[mediaId] ?? {};
    const excluded = getExcludedView()[key] ?? {};
    const matchesForManga = getMatches()[key] ?? {};
    const providers = ctx.manga.getProviders();
    const items = Object.keys(probes)
      .filter(
        (pid) => isActiveProvider(pid, providers) && excluded[pid] == null,
      )
      .map((pid) => ({ pid, p: probes[pid] }))
      .filter((x) => x.p?.matched && unreadChapters(read, x.p.latest) > 0)
      .map((x) => ({
        pid: x.pid,
        name: String(providers[x.pid] ?? x.p.providerName ?? x.pid),
        unread: unreadChapters(read, x.p.latest),
        latest: x.p.latest,
        // "" | "different" | "missing" — marks the chip when instances disagree.
        warn: matchDivergence(matchesForManga[x.pid]).reason,
      }))
      .sort((a, b) => b.latest - a.latest || a.name.localeCompare(b.name));

    const sig = items.length
      ? `${selectedPid ?? ""}|${items.map((i) => `${i.pid}+${i.unread}${i.warn ? `!${i.warn}` : ""}`).join(",")}`
      : "none";

    return { items, selectedPid, sig };
  };

  const decorateBar = async (container: $ui.DOMElement) => {
    const mediaId = currentMediaId.get();
    if (!mediaId) return;

    await dm.decorate(container, {
      marker: "msu-bar",
      lockKey: "bar",
      sig: async () => (await buildBarItems(container, mediaId)).sig,
      scope: container,
      render: async (node) => {
        const { items, selectedPid } = await buildBarItems(container, mediaId);
        const headers = await container.query(
          "[data-chapter-list-header-container]",
        );
        const anchor = headers?.[0];
        if (!anchor) return;
        if (!items.length) {
          node.setStyle("display", "none");
          anchor.after(node);
          return;
        }
        node.setStyle("display", "flex");
        node.setStyle("flex-wrap", "wrap");
        node.setStyle("gap", "8px");
        node.setStyle("align-items", "center");
        node.setInnerHTML(
          `<span class="text-sm text-[--muted]">New on:</span>` +
            items
              .map((i) => {
                const warnNote = i.warn
                  ? ` · manual match ${i.warn === "different" ? "differs" : "missing"} across your devices`
                  : "";
                const title = `${escHtml(i.name)}: ${i.unread} unread chapter${i.unread === 1 ? "" : "s"}${warnNote}`;
                const label = `${escHtml(i.name)} +${i.unread}${i.warn ? " ⚠" : ""}`;
                const intentClass = selectedPid?.includes(i.pid)
                  ? "text-green bg-green-50 border-green-500 dark:text-green-300"
                  : "text-blue bg-blue-50 border-blue-500 dark:text-blue-300";

                return `<span title="${title}" class="UI-Badge__root inline-flex flex-none w-fit overflow-hidden justify-center items-center gap-2 group/badge ${intentClass} border border-opacity-40 dark:bg-opacity-10 h-6 px-2 text-xs font-semibold tracking-wide rounded-full">${label}</span>`;
              })
              .join(""),
        );
        anchor.after(node);
      },
    });
  };

  // Explicit query→decorate passes (run on arm + refresh) — cover elements
  // already mounted before the observers ran; the sig guard keeps them idempotent.
  // Coalesced: several triggers (grid observer, effect, arm) fire near-together;
  // without this each ran a full concurrent sweep over the SAME ~80 cards, doubling
  // the bridge load. Only one sweep runs at a time; a request mid-sweep re-runs once.
  let cardsSweeping = false;
  let cardsDirty = false;
  const redecorateCards = async () => {
    if (cardsSweeping) {
      cardsDirty = true;
      return;
    }
    cardsSweeping = true;
    try {
      do {
        cardsDirty = false;
        reconcileInactiveProviders();
        const cards = await ctx.dom.query(
          '[data-media-entry-card-container][data-media-type="manga"]',
        );
        await decorateCards(cards ?? []);
      } while (cardsDirty);
    } catch (e) {
      log.warn("redecorateCards failed:", e);
    } finally {
      cardsSweeping = false;
    }
  };
  const redecorateBar = async () => {
    try {
      const cont = (await ctx.dom.query("[data-chapter-list-container]"))?.[0];
      if (cont) {
        void decorateBar(cont);
        void hookRefreshSourceButton(cont);
      }
    } catch {
      /* not on an entry page */
    }
  };

  // Mirror seanime's own "Reload sources" flow. The header button only OPENS a
  // confirm modal (and only refetches the reader's SELECTED source on confirm),
  // so hook the modal's "Reload" button — firing on the actual confirmation, not
  // on opening or cancelling — to also kick off a full MSU scan of THIS manga
  // (every non-excluded source); the bar / card badges / detail refresh in one go.
  // The modal is a radix portal at the document root, so it's observed separately
  // (§ dm.observe [role=dialog]). Nothing in it carries a data-* of its own, so:
  //   • gate on the title (.UI-Modal__title === "Reload sources") to skip the
  //     Manual-match dialog and every other confirm modal;
  //   • the confirm button is the FIRST <button> that isn't the close (X) — DOM
  //     order is Reload, Cancel, then UI-Modal__close, so [0] is Reload.
  // Stamp data-msu-reload-hooked so repeated observer fires within one open don't
  // double-attach; each re-open is a fresh element (no attr) → re-hooked. query()
  // [0], never the denshi-broken queryOne. ponytail: attribute guard only, no
  // handle bookkeeping — the modal element is discarded on close.
  const dialogTitle = async (dialog: $ui.DOMElement): Promise<string> => {
    const titleEl = (await dialog.query(".UI-Modal__title"))[0];
    return titleEl
      ? String((await titleEl.getText()) ?? "")
          .trim()
          .toLowerCase()
      : "";
  };

  // Newer seanime dropped the entry-page "Reload sources" confirm modal for a
  // "Refresh source" button placed directly in the chapter-list header, firing
  // immediately with NO confirmation (unlike "Manual match", it has no
  // aria-haspopup="dialog"). hookReloadModal (below) never fires anymore because
  // that modal no longer mounts, so hook this button instead: it's a single-manga
  // action, so kick off the full MSU scan of THIS manga right away — exactly what
  // the old modal-confirm did. Match by text among the header's buttons ("Refresh
  // source" vs "Manual match"); stamp data-msu-refresh-source-hooked so repeated
  // observer fires within one mount don't double-attach (a re-mounted header loses
  // the attr → re-hooked). query()[0], never the denshi-broken queryOne.
  const hookRefreshSourceButton = async (container: $ui.DOMElement) => {
    if (!currentMediaId.get()) return;
    let buttons: $ui.DOMElement[] = [];
    try {
      buttons =
        (await container.query(
          "[data-chapter-list-header-container] button",
        )) ?? [];
    } catch {
      return;
    }
    for (const btn of buttons) {
      try {
        const text = String((await btn.getText()) ?? "")
          .trim()
          .toLowerCase();
        if (text !== "refresh source") continue;
        if (await btn.hasAttribute("data-msu-refresh-source-hooked")) return;
        btn.setAttribute("data-msu-refresh-source-hooked", "1");
        btn.addEventListener("click", () => {
          if (!syncNativeButtons()) return;
          const id = currentMediaId.get();
          if (id <= 0) return;
          if (rejectIfBusy()) return;
          void probeMangaDetail(id);
        });
      } catch {
        /* couldn't hook this button */
      }
      return;
    }
  };

  const hookReloadModal = async (dialog: $ui.DOMElement) => {
    if (!currentMediaId.get()) return;
    try {
      if ((await dialogTitle(dialog)) !== "reload sources") return;
      const btn = (await dialog.query("button:not(.UI-Modal__close)"))[0];
      if (!btn) return;
      if (await btn.hasAttribute("data-msu-reload-hooked")) return;
      btn.setAttribute("data-msu-reload-hooked", "1");
      btn.addEventListener("click", () => {
        if (!syncNativeButtons()) return;
        const id = currentMediaId.get();
        if (id <= 0) return;
        if (rejectIfBusy()) return;
        void probeMangaDetail(id);
      });
    } catch {
      /* couldn't hook this render */
    }
  };

  const watchManualMatchDialog = async (dialog: $ui.DOMElement) => {
    const mediaId = currentMediaId.get();
    if (mediaId <= 0) return;
    try {
      if ((await dialogTitle(dialog)) !== "manual match") return;

      const html = String(dialog.innerHTML ?? "");
      if (isManualMatchConfirmDialog(html)) return;

      const sig = mappingSigFromHtml(html);
      if (sig === null) return;

      const provider = await readSelectedProvider(ctx);
      if (!provider) return;

      // Record the mapping the moment the panel shows its state ("Current
      // mapping: …" or "No manual match") — NOT only when it changes — so an
      // already-matched manga is captured on open. resolveMatchAction is
      // idempotent, so re-observing the same state writes nothing.
      const now = Date.now();
      const matches = getMatches();
      // Compare against THIS instance's own leaf; each instance owns its slot.
      const action = resolveMatchAction(
        sig,
        matches[String(mediaId)]?.[provider]?.[myInstanceId],
      );
      if (action.type === "tombstone") {
        setMatches(
          tombstoneMatch(matches, mediaId, provider, myInstanceId, now),
        );
        livePush(["matches"]);
      } else if (action.type === "upsert") {
        setMatches(
          upsertMatch(
            matches,
            mediaId,
            provider,
            myInstanceId,
            action.mappedId,
            now,
          ),
        );
        livePush(["matches"]);
      }

      // Rescan the provider only when the mapping actually CHANGED (expensive) —
      // this keeps its own change guard, separate from the recording above.
      const prev = lastMappingSigByMedia[mediaId];
      lastMappingSigByMedia[mediaId] = sig;
      if (prev === undefined || prev === sig) return;

      void scanOneProvider(mediaId, provider).then(() => {
        dm.refresh();
        void redecorateBar();
      });
    } catch {
      /* modal parse failed */
    }
  };

  // Mirror the library page's "Refresh sources" dropdown item (a radix menu
  // portaled to the document root). Unlike the entry page's "Reload sources" it
  // fires with NO confirmation, so hooking it directly would launch the heavy
  // whole-list scan on a single click — instead open our own confirm modal
  // (requestConfirm). The menu item carries no data-* of
  // its own; match it by text (lowercased) among the menu's [role=menuitem]s, so
  // the sibling "Unread chapters only" and every other menu are skipped. Stamp
  // data-msu-refresh-hooked so repeated observer fires within one open don't
  // double-attach; each re-open is a fresh element → re-hooked. query()[0], never
  // the denshi-broken queryOne.
  const hookRefreshMenu = async (menu: $ui.DOMElement) => {
    let items: $ui.DOMElement[] = [];
    try {
      items = (await menu.query("[role='menuitem']")) ?? [];
    } catch {
      return;
    }
    for (const item of items) {
      try {
        const text = String((await item.getText()) ?? "")
          .trim()
          .toLowerCase();
        if (text !== "refresh sources") continue;
        if (await item.hasAttribute("data-msu-refresh-hooked")) return;
        item.setAttribute("data-msu-refresh-hooked", "1");
        item.addEventListener("click", () => {
          if (!syncNativeButtons()) return; // native-button sync disabled
          requestConfirm("scan");
        });
      } catch {
        /* couldn't hook this item */
      }
      return;
    }
  };

  // In-place read reactivity: reading a chapter changes the entry header's
  // progress number with no navigation / scan / state change. Push that fresh
  // progress into `results` so EVERYTHING that reads from state reacts — the
  // native [MSU] button, the tray detail, the list, and (via the effect) the
  // card badges + bar — not just the observed DOM.
  const applyProgressFromDom = async (badgeEl?: $ui.DOMElement) => {
    const id = currentMediaId.get();
    if (!id) return;
    const read = await headerProgress.read(badgeEl);
    if (read == null) return;
    headerProgress.setCache(read);
    const cur = results.get().find((r) => r.mediaId === id);
    if (!cur || Number(cur.read) === read) return;
    const gap = Number($getUserPreference("farBehindGap") ?? "10") || 10;
    const probes = probeCache.get()[id];
    if (probes && Object.keys(probes).length) {
      syncRow(id, buildResult(id, cur, read, gap, probes));
    } else {
      // No probes cached — just move progress + reclassify from stored latest.
      const kind = classify(read, cur.latest, cur.sources, false, gap);
      syncRow(id, { ...cur, read, kind });
    }
  };

  // Wire the decorations into the harness. Cards: observe the stable grid (bulk
  // add/remove) AND individual cards (in-place virtualization windowing). Bar:
  // observe the chapter-list container; the progress badge drives in-place read
  // reactivity. Explicit passes cover already-mounted nodes.
  dm.observe(
    "[data-media-card-grid], [data-media-card-lazy-grid]",
    () => void redecorateCards(),
  );
  dm.observe(
    '[data-media-entry-card-container][data-media-type="manga"]',
    (els) => {
      void decorateCards(els ?? []);
    },
    { withInnerHTML: true },
  );
  dm.observe(
    "[data-chapter-list-container]",
    (els) => {
      const c = els[0];
      if (c) {
        void decorateBar(c);
        void hookRefreshSourceButton(c);
      }
    },
    { withInnerHTML: true },
  );
  // The "Reload sources" confirm modal mounts as a document-root portal, so it's
  // observed on its own (not under the chapter-list container).
  dm.observe(
    "[role='dialog']",
    (els) => {
      for (const el of els ?? []) {
        void hookReloadModal(el);
        void watchManualMatchDialog(el);
      }
    },
    { withInnerHTML: true },
  );
  // The library page's "Refresh sources" dropdown is a radix menu portal — hook
  // its item on every open (radix re-mounts the menu each time).
  dm.observe("[role='menu']", (els) => {
    for (const el of els ?? []) void hookRefreshMenu(el);
  });
  dm.observe("[data-media-page-header-progress-badge-progress]", (els) => {
    void (async () => {
      await applyProgressFromDom(els?.[0]);
      await redecorateBar();
    })();
  });
  dm.pass(redecorateCards);
  dm.pass(redecorateBar);
  dm.start();

  // A scan changes plugin state but NOT seanime's DOM, so nudge a repaint.
  ctx.effect(() => {
    results.get();
    probeCache.get();
    scanProgress.get();
    currentMediaId.get();
    dm.refresh();
  }, [results, probeCache, scanProgress, currentMediaId]);

  // Confirm-before-global-scan view. A state-driven swap of the whole tray
  // content (like the reference extension's overlay) instead of a native
  // tray.modal — a controlled tray.modal didn't reliably close on Cancel/confirm,
  // whereas a plain state toggle + re-render always does.
  function renderGlobalConfirm(kind: ConfirmKind): unknown {
    const cfg = CONFIRM[kind];
    const head = trayHeader(tray, {
      title: cfg.title,
      subtitle: cfg.subtitle,
    });
    const actionRow = tray.flex(
      [
        tray.button("Cancel", {
          onClick: "msu-gconfirm-close",
          size: "sm",
          intent: "gray-subtle",
        }),
        tray.button(cfg.button, {
          onClick: "msu-gconfirm-run",
          size: "sm",
          intent: "primary",
        }),
      ],
      { gap: 2, style: { alignItems: "center", justifyContent: "flex-end" } },
    );
    return tray.stack(joinDividers(tray, [head, actionRow]), { gap: 3 });
  }

  const autoSync = ($getUserPreference("autoSync") ?? "false") === "true";
  if (autoSync && hasSync()) {
    const mins = Math.max(
      5,
      Number($getUserPreference("syncIntervalMinutes") ?? "30") || 30,
    );
    // cron minute field is 0-59; for >= 60 min use an hour-step expression.
    const expr =
      mins < 60 ? `*/${mins} * * * *` : `0 */${Math.round(mins / 60)} * * *`;
    try {
      ctx.cron.add("msu-auto-sync", expr, () => {
        void requestSync("all", "auto", true);
      });
      ctx.cron.start();
    } catch (e) {
      ctx.toast.error(`Auto-sync schedule failed: ${(e as Error).message}`);
    }
  }

  tray.render(() => {
    const pc = pendingConfirm.get();
    if (pc) return renderGlobalConfirm(pc);
    if (detailId.get() != null) return renderDetail();

    const header = trayHeader(tray, {
      subtitle: status.get() || "Detect new chapters across your reading list",
      right: scanning.get()
        ? [
            tray.button("⌫ Cancel", {
              onClick: "msu-cancel",
              size: "sm",
              intent: "alert-subtle",
              disabled: cancelRequested.get(),
            }),
          ]
        : [
            // Opens the confirm view (msu-scan → requestConfirm). Kept
            // ENABLED even while a per-manga scan runs so the click registers and
            // rejectIfBusy can toast "a scan is already running" instead of the
            // button silently doing nothing.
            tray.button("↻ Scan", {
              onClick: "msu-scan",
              size: "sm",
            }),
            tray.dropdownMenu({
              trigger: tray.button("⋮", {
                size: "sm",
                intent: "gray-subtle",
              }),
              items: [
                tray.dropdownMenuItem(tray.span("↻ Force rescan"), {
                  onClick: "msu-force",
                }),
                tray.dropdownMenuItem(tray.span("Clear exclusions"), {
                  onClick: "msu-clear-excl",
                  className: ALERT_MENU_ITEM_STYLE,
                }),
              ],
            }),
          ],
    });
    const blocks = [
      header,
      renderSyncSection(),
      renderNewOn(),
      renderResults(),
    ];
    return tray.stack(joinDividers(tray, blocks), { gap: 3 });
  });
};
