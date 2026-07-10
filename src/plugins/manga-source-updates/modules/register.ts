import { joinDividers } from "../../../_components/divider";
import { createDomDecorator } from "../../../_components/dom-decorator";
import { type EntryListRow, entryList } from "../../../_components/entry-list";
import { trayHeader } from "../../../_components/tray-header";
import { createLogger } from "../../../_utils/logger";
import scanPanelHtml from "../assets/scan-panel.html";
import { readCardAttrs } from "../utils/card-dom";
import { makeProbe, unreadChapters } from "../utils/chapters";
import { classify, isBadKind, isNoMatchError } from "../utils/classify";
import { readingEntries } from "../utils/collection";
import {
  K_EXCLUDED,
  K_PINNED,
  K_PROBES,
  K_RESULTS,
  REASONS,
  reasonIntent,
  reasonLabel,
} from "../utils/constants";
import {
  clearedExclusions,
  type ExcludedMap,
  type PinnedMap,
} from "../utils/exclusions";
import { createHeaderProgressReader } from "../utils/header-progress";
import { hydrateProbes, hydrateResults } from "../utils/hydrate";
import {
  isManualMatchConfirmDialog,
  mappingSigFromHtml,
} from "../utils/manual-match";
import { isActiveProvider, pruneInactiveProbes } from "../utils/providers";
import { readSelectedProvider } from "../utils/selected-provider";
import { cardBadgeKind, statusFor } from "../utils/status";
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

  // Per-manga detail view: when detailId is set the tray renders the source
  // list for that manga. probeCache holds the on-demand probe per mediaId.
  const detailId = ctx.state<number | null>(null);
  const detailTitle = ctx.state<string>("");
  const detailCover = ctx.state<string>(""); // cover of the open manga (header)
  const detailRead = ctx.state<number>(0); // reader progress for the open manga
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
    const next = { ...probeCache.get(), [mediaId]: probes };
    probeCache.set(next);
    $storage.set(K_PROBES, next);
  }
  // mediaId of the manga entry the user is currently viewing (0 = not on one),
  // tracked via onNavigate so opening the tray on a manga page jumps to it.
  const currentMediaId = ctx.state<number>(0);
  // Confirm-before-global-scan modal (opened from the library page's "Refresh
  // sources" menu, which fires with no confirmation of its own). Lives in the
  // tray render tree, so opening it also opens the tray.
  const confirmGlobalOpen = ctx.state<boolean>(false);

  // Last seen manual-mapping sig per manga — detect save/remove in the modal.
  const lastMappingSigByMedia: Record<number, string | undefined> = {};

  // Recalculate list-row summaries ignoring inactive providers (probes stay in
  // storage — disabled / uninstalled sources are only hidden from the UI).
  function reconcileInactiveProviders(): void {
    const active = ctx.manga.getProviders();
    const gap = Number($getUserPreference("farBehindGap") ?? "10") || 10;
    const cache = probeCache.get();
    const stored = $storage.get<Record<string, StoredResult>>(K_RESULTS) ?? {};
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
        checkedAt: r.checkedAt,
      };
      stored[String(r.mediaId)] = {
        title: row.title,
        cover: row.cover,
        latest: row.latest,
        read: row.read,
        sources: row.sources,
        newSources: row.newSources,
        kind: row.kind,
        checkedAt: row.checkedAt,
      };
      return row;
    });
    if (rowsChanged) {
      results.set(nextResults);
      $storage.set(K_RESULTS, stored);
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
    const excluded =
      $storage.get<Record<string, Record<string, string>>>(K_EXCLUDED) ?? {};
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
    return {
      title: media.title,
      cover: media.cover,
      latest: maxLatest,
      read,
      sources: matched.length,
      newSources,
      kind,
      checkedAt: Date.now(),
    };
  }

  // The one per-manga scan, used by BOTH the full reload and the detail view.
  // Empties the cache, then fetches each NON-excluded source fresh (excluded
  // sources are never re-fetched — that's the whole point of excluding), auto-
  // excluding the bad ones (unless pinned) as it goes — persisting each exclusion
  // immediately so the detail view moves the row to the Excluded group live.
  // `onProgress` lets the detail update its list per source. Returns the probe
  // list (the included sources) + row result.
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
    const excluded =
      $storage.get<Record<string, Record<string, string>>>(K_EXCLUDED) ?? {};
    const pinnedForManga =
      $storage.get<Record<string, string[]>>(K_PINNED)?.[key] ?? [];

    await ctx.manga.emptyCache(mediaId);
    const probes: ProbeMap = {};
    // Fetch in parallel batches: readContainer is an async fn (a real Promise,
    // so Promise.all is safe in goja — unlike a raw Go-bound value), so a batch
    // hits up to BATCH providers at once instead of one-by-one.
    const toScan = providerIds.filter((pid) => excluded[key]?.[pid] == null);
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
            excluded[key][pid] = kind;
            $storage.set(K_EXCLUDED, excluded); // persist live for the visual
          }
        }
      }
      onProgress?.(probes); // once per batch
    }
    scanningProviders.set(null);
    $storage.set(K_EXCLUDED, excluded);

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

      const stored =
        $storage.get<Record<string, StoredResult>>(K_RESULTS) ?? {};

      // Seed the working list from what's already shown, so cancelling (or a
      // crash) leaves the prior rows intact — each manga is UPDATED in place as
      // it's scanned, never wiped up front. upsert replaces the row if present
      // (identity = mediaId) else appends, then re-renders.
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
          now - Number(prior.checkedAt) < ttlMs
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
            checkedAt: now,
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
        $storage.set(K_RESULTS, stored);
        upsert({
          ...result,
          mediaId,
          isNew: result.kind === "new",
          fromCache: false,
        });
        scanned++;
      }

      $storage.set(K_RESULTS, stored);

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

  // Open the confirm-before-global-scan modal (from the library "Refresh sources"
  // menu). Guarded so repeated clicks while a scan runs just toast.
  const requestGlobalScan = () => {
    if (rejectIfBusy()) return;
    confirmGlobalOpen.set(true);
    // The modal lives in the tray tree, so the tray must be open to show it.
    try {
      tray.open();
    } catch {
      /* tray unavailable (not pinned) — run without the modal as a fallback */
      void runScan(false);
    }
  };

  ctx.registerEventHandler("msu-gconfirm-close", () =>
    confirmGlobalOpen.set(false),
  );
  ctx.registerEventHandler("msu-gconfirm-run", () => {
    confirmGlobalOpen.set(false);
    if (rejectIfBusy()) return; // a scan slipped in while the modal was open
    void runScan(false);
  });

  // Tray "↻ Scan" — route through the same confirm view as the library menu.
  ctx.registerEventHandler("msu-scan", () => {
    requestGlobalScan();
  });

  ctx.registerEventHandler("msu-force", () => {
    if (rejectIfBusy()) return;
    void runScan(true);
  });

  ctx.registerEventHandler("msu-cancel", () => {
    if (!scanning.get()) return;
    cancelRequested.set(true);
    status.set("Cancelling…");
  });

  // Clear exclusions + pins for a scope so the next scan re-discovers every
  // source from 0 (pure map logic lives in utils/exclusions; this just does the
  // $storage I/O around it). Pass a mediaId for one manga, omit for all.
  function clearExclusions(mediaId?: number) {
    const next = clearedExclusions(
      $storage.get<ExcludedMap>(K_EXCLUDED) ?? {},
      $storage.get<PinnedMap>(K_PINNED) ?? {},
      mediaId,
    );
    $storage.set(K_EXCLUDED, next.excluded);
    $storage.set(K_PINNED, next.pinned);
  }

  // Global clear: wipe every exclusion + pin, then force-rescan the whole list
  // so it rediscovers from 0 (cancellable via the panel).
  ctx.registerEventHandler("msu-clear-excl", () => {
    if (rejectIfBusy()) return;
    clearExclusions();
    ctx.toast.success("Exclusions cleared — rediscovering from scratch");
    void runScan(true);
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
    const stored = $storage.get<Record<string, StoredResult>>(K_RESULTS) ?? {};
    stored[String(mediaId)] = result;
    $storage.set(K_RESULTS, stored);
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
    const excluded =
      $storage.get<Record<string, Record<string, string>>>(K_EXCLUDED) ?? {};
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

  // Detail probe = a per-manga scan (probeAll) with live list updates, plus a
  // refreshed list row. Same scanOneManga the full reload uses.
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
    const excluded =
      $storage.get<Record<string, Record<string, string>>>(K_EXCLUDED) ?? {};
    const pinned = $storage.get<Record<string, string[]>>(K_PINNED) ?? {};
    if (exclude) {
      if (!excluded[key]) excluded[key] = {};
      excluded[key][provider] = reason;
    } else if (excluded[key]) {
      delete excluded[key][provider];
    }
    const set = pinned[key] ?? [];
    if (!set.includes(provider)) set.push(provider);
    pinned[key] = set;
    $storage.set(K_EXCLUDED, excluded);
    $storage.set(K_PINNED, pinned);
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
    // Status pill lives in the trailing actions, just left of the details
    // button, with a tooltip decoding the compact `+N · M`.
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

  // Per-manga detail view: every probed source split into AVAILABLE / EXCLUDED
  // groups (alphabetical), each with an Exclude / Include control.
  function renderDetail(): unknown {
    const id = detailId.get();
    if (id == null) return null;
    const key = String(id);
    const cur = results.get().find((r) => r.mediaId === id);
    const excluded =
      $storage.get<Record<string, Record<string, string>>>(K_EXCLUDED) ?? {};
    const excludedForManga = excluded[key] ?? {};
    // Probes for this manga, keyed by provider id (empty = never scanned).
    const probeByProvider = probeCache.get()[id] ?? {};
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
    // A source is loading if it's the single-provider rescan target OR it's
    // in-flight in the active per-manga scan for THIS manga.
    const inflight = scanningProviders.get();
    const isPidScanning = (pid: string): boolean =>
      scanningProvider.get() === pid ||
      (inflight?.mediaId === id && inflight.pids.includes(pid));
    const title = cur?.title || detailTitle.get() || "Manga";
    const read = cur?.read ?? detailRead.get();
    const gap = Number($getUserPreference("farBehindGap") ?? "10") || 10;

    const head = trayHeader(tray, {
      // Manga name as the title; subtitle shows the reader's current chapter.
      title,
      subtitle: read > 0 ? `Read c.${read}` : "Not started",
      // Use the manga's cover as the header icon; fall back to the plugin icon.
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

    // Status pill for an available source: "+N new" once probed & matched (color
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
      return { label: `+${newCount} new`, intent };
    };

    // AVAILABLE row: every non-excluded provider (probed or not). status =
    // source state, chapter = its latest, actions = rescan + Exclude dropdown.
    const availableRow = (pid: string): EntryListRow => {
      const p = probeByProvider[pid];
      const name = p ? p.providerName : String(providers[pid] ?? pid);
      return {
        title: name,
        status: sourceStatus(p),
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
    // Already on this entry → just surface the detail in the tray.
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
    const stored = $storage.get<Record<string, StoredResult>>(K_RESULTS) ?? {};
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
        checkedAt: row.checkedAt,
      };
      return row;
    });
    if (changed) {
      $storage.set(K_RESULTS, stored);
      results.set(next);
    }
  }

  // Shared DOM-injection harness (loop/duplicate guard, per-target lock,
  // restartable observers, re-arm lifecycle). Decorations are registered further
  // down; onNavigate re-arms it (SPA nav doesn't fire onMainTabReady).
  const dm = createDomDecorator(ctx);
  const headerProgress = createHeaderProgressReader(ctx);

  const CARD_REDECORATE_YIELD_EVERY = 24;

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

    const { mediaId } = await readCardAttrs(el);
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
    const excluded =
      $storage.get<Record<string, Record<string, string>>>(K_EXCLUDED)?.[key] ??
      {};
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
      }))
      .sort((a, b) => b.latest - a.latest || a.name.localeCompare(b.name));

    const sig = items.length
      ? `${selectedPid ?? ""}|${items.map((i) => `${i.pid}+${i.unread}`).join(",")}`
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
                const title = `${escHtml(i.name)}: ${i.unread} unread chapter${i.unread === 1 ? "" : "s"}`;
                const label = `${escHtml(i.name)} +${i.unread}`;
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
  const redecorateCards = async () => {
    reconcileInactiveProviders();
    try {
      const cards = await ctx.dom.query(
        '[data-media-entry-card-container][data-media-type="manga"]',
      );
      const list = cards ?? [];
      for (let i = 0; i < list.length; i++) {
        void decorateCard(list[i]);
        if (i % CARD_REDECORATE_YIELD_EVERY === 0) $sleep(0);
      }
    } catch {
      /* no cards on this screen */
    }
  };
  const redecorateBar = async () => {
    try {
      const cont = (await ctx.dom.query("[data-chapter-list-container]"))?.[0];
      if (cont) void decorateBar(cont);
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

      const prev = lastMappingSigByMedia[mediaId];
      lastMappingSigByMedia[mediaId] = sig;
      if (prev === undefined || prev === sig) return;

      const provider = await readSelectedProvider(ctx);
      if (!provider) return;

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
  // (requestGlobalScan → confirmGlobalOpen). The menu item carries no data-* of
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
          requestGlobalScan();
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
    if (!cur || Number(cur.read) === read) return; // nothing new
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
      for (const el of els ?? []) void decorateCard(el);
    },
    { withInnerHTML: true },
  );
  dm.observe(
    "[data-chapter-list-container]",
    (els) => {
      const c = els[0];
      if (c) void decorateBar(c);
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
  function renderGlobalConfirm(): unknown {
    const head = trayHeader(tray, {
      title: "Refresh all sources?",
      subtitle:
        "Scans every manga in your reading list across all installed sources — this can take a while.",
    });
    const actionRow = tray.flex(
      [
        tray.button("Cancel", {
          onClick: "msu-gconfirm-close",
          size: "sm",
          intent: "gray-subtle",
        }),
        tray.button("↻ Scan all", {
          onClick: "msu-gconfirm-run",
          size: "sm",
          intent: "primary",
        }),
      ],
      { gap: 2, style: { alignItems: "center", justifyContent: "flex-end" } },
    );
    return tray.stack(joinDividers(tray, [head, actionRow]), { gap: 3 });
  }

  tray.render(() => {
    if (confirmGlobalOpen.get()) return renderGlobalConfirm();
    if (detailId.get() != null) return renderDetail();

    const header = trayHeader(tray, {
      // Live scan/status line when there is one; the tagline otherwise.
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
            // Opens the confirm view (msu-scan → requestGlobalScan). Kept
            // ENABLED even while a per-manga scan runs so the click registers and
            // rejectIfBusy can toast "a scan is already running" instead of the
            // button silently doing nothing.
            tray.button("↻ Scan", {
              onClick: "msu-scan",
              size: "sm",
            }),
            tray.dropdownMenu({
              trigger: tray.button("…", {
                size: "sm",
                intent: "gray-subtle",
              }),
              items: [
                tray.dropdownMenuItem(tray.span("↻ Force rescan"), {
                  onClick: "msu-force",
                }),
                tray.dropdownMenuItem(tray.span("Clear exclusions"), {
                  onClick: "msu-clear-excl",
                }),
              ],
            }),
          ],
    });
    const blocks = [header, renderNewOn(), renderResults()];
    return tray.stack(joinDividers(tray, blocks), { gap: 3 });
  });
};
