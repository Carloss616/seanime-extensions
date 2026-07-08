import { joinDividers } from "../../../_components/divider";
import { createDomDecorator } from "../../../_components/dom-decorator";
import {
  type EntryListIntent,
  type EntryListRow,
  entryList,
} from "../../../_components/entry-list";
import { trayHeader } from "../../../_components/tray-header";
import scanPanelHtml from "../assets/scan-panel.html";

// Scan the reading list (all CURRENT entries) and, per manga, probe every
// installed source to find new chapters. Traffic is cut by TTL (skip a manga
// scanned recently) and auto-exclude (a source that returns no match / errors /
// sits far behind the reading progress is remembered and skipped next time).
// There is NO per-manga "selected provider": seanime owns the reader's source
// selection, so we just report the best (most unread) across the user's sources.

// $storage keys.
const K_EXCLUDED = "excludedProviders"; // Record<mediaId, Record<providerId, reason>>
const K_RESULTS = "lastResults"; // Record<mediaId, StoredResult>
const K_PINNED = "pinnedProviders"; // Record<mediaId, providerId[]> — user-locked
const K_PROBES = "lastProbes"; // Record<mediaId, Record<providerId, ProviderProbe>> — per-source detail

// The three outcomes that both classify a source AND are reasons to auto-exclude
// it — the shared base of ResultKind and ExcludeReason.
type AutoBadKind = "not-matched" | "error-found" | "outdated";

// Per-manga / per-source classification outcome.
type ResultKind = AutoBadKind | "new" | "up-to-date" | "all-excluded";

// Why a source is excluded: the auto-exclude kinds plus manual-only reasons.
type ExcludeReason = AutoBadKind | "bad-numbering" | "other";

// Persisted per-manga scan outcome — reused on a TTL-fresh rescan AND to
// rehydrate the tray after a reload (the in-memory state is otherwise empty).
interface StoredResult {
  title: string;
  cover?: string;
  latest: number; // highest chapter across the matched sources
  read: number;
  sources: number; // how many sources have this manga
  kind: ResultKind;
  checkedAt: number; // ms epoch
}

type ResultRowMedia = Pick<StoredResult, "title" | "cover">;

interface MangaResult extends StoredResult {
  mediaId: number;
  isNew: boolean;
  fromCache: boolean;
}

// One probed source in the per-manga detail view.
interface ProviderProbe {
  provider: string;
  providerName: string;
  latest: number;
  count: number;
  matched: boolean; // true = returned chapters
  errored: boolean; // true = fetch threw (vs. simply no match)
}

// Build a probe entry from a getChapterContainer read (null = thrown/error).
function makeProbe(
  provider: string,
  providerName: string,
  chapters: $app.HibikeManga_ChapterDetails[] | null,
): ProviderProbe {
  return {
    provider,
    // Coerce: providerName comes from the Go-bound getProviders() map, and it's
    // used in charCodeAt (avatar hash) + tray.text — a raw wrapper misbehaves.
    providerName: String(providerName),
    latest: chapters ? latestChapter(chapters) : 0,
    count: chapters?.length ?? 0,
    matched: !!chapters && chapters.length > 0,
    errored: chapters == null,
  };
}

// Whole chapters still unread — chapter numbers are floats (e.g. 12.5), so the
// badge count floors the gap; classification must use the same rule or a manga
// with +0 can stay "new" (green) and in the New chapters list.
function unreadChapters(read: number, latest: number): number {
  return Math.max(0, Math.floor(latest - read));
}

// Classify a source's result for a manga. `read` is the user's progress; `gap`
// the far-behind threshold. Shared by the scan and the detail probe.
function classify(
  read: number,
  latest: number,
  count: number,
  errored: boolean,
  gap: number,
): ResultKind {
  if (errored) return "error-found";
  if (count === 0) return "not-matched";
  if (read > 0 && read - latest >= gap) return "outdated";
  return unreadChapters(read, latest) > 0 ? "new" : "up-to-date";
}

// Kinds that mark a source as a bad match for a manga -> auto-exclude.
function isBadKind(kind: ResultKind): boolean {
  return (
    kind === "not-matched" || kind === "error-found" || kind === "outdated"
  );
}

// One table per exclusion reason: `menu` = dropdown label, `badge` = short label
// on the EXCLUDED row, `intent` = badge color. Keys match the automatic
// auto-exclude reasons (not-matched / error-found / outdated) so manual + auto
// read the same, plus manual-only ones. Dropdown order = key order here.
const REASONS: Record<
  ExcludeReason,
  { menu: string; badge: string; intent: "alert" | "warning" | "gray" }
> = {
  outdated: { menu: "Behind / outdated", badge: "behind", intent: "warning" },
  // Sources that mangle numbering: fake gaps, invented far-future numbers,
  // duplicate chapters under different numbers, etc.
  "bad-numbering": {
    menu: "Wrong chapter numbers",
    badge: "bad numbers",
    intent: "warning",
  },
  "not-matched": { menu: "No match", badge: "no match", intent: "warning" },
  "error-found": { menu: "Fetch error", badge: "error", intent: "alert" },
  other: { menu: "Other", badge: "manual", intent: "gray" },
};
const reasonLabel = (key: ExcludeReason) => REASONS[key].badge;
const reasonIntent = (key: ExcludeReason) => REASONS[key].intent;

// Highest numeric chapter in a container. `chapter` is a Go-wrapped string
// (e.g. "12", "12.5"); coerce before parsing (see CLAUDE.md goja boundary).
function latestChapter(chapters: $app.HibikeManga_ChapterDetails[]): number {
  let max = 0;
  for (const ch of chapters) {
    const n = Number.parseFloat(String(ch.chapter));
    if (!Number.isNaN(n) && n > max) max = n;
  }
  return max;
}

// De-duped title list to help the provider match the manga (fuzzy search).
function collectTitles(media: $app.AL_BaseManga): string[] {
  const t = media.title ?? {};
  const raw = [t.userPreferred, t.english, t.romaji, ...(media.synonyms ?? [])];
  const seen: Record<string, true> = {};
  const out: string[] = [];
  for (const s of raw) {
    if (s == null) continue;
    const v = String(s).trim();
    if (v && !seen[v]) {
      seen[v] = true;
      out.push(v);
    }
  }
  return out;
}

function resolveTitle(media: $app.AL_BaseManga): string {
  const t = media.title ?? {};
  return String(t.userPreferred ?? t.english ?? t.romaji ?? "Unknown");
}

// Rebuild the last-scan rows from $storage so the tray shows them immediately
// after a plugin reload, without re-scanning. mediaId is the map key; every
// row is flagged fromCache.
function hydrateResults(): MangaResult[] {
  const stored = $storage.get<Record<string, StoredResult>>(K_RESULTS) ?? {};
  const out: MangaResult[] = [];
  for (const key of Object.keys(stored)) {
    const r = stored[key];
    out.push({
      ...r,
      mediaId: Number(key),
      isNew: r.kind === "new",
      fromCache: true,
    });
  }
  out.sort((a, b) =>
    String(a.title ?? "").localeCompare(String(b.title ?? "")),
  );
  return out;
}

// Rehydrate the per-source probes from $storage (keyed by provider id).
function hydrateProbes(): Record<number, Record<string, ProviderProbe>> {
  return (
    $storage.get<Record<number, Record<string, ProviderProbe>>>(K_PROBES) ?? {}
  );
}

export const register = (ctx: $ui.Context) => {
  const tray = ctx.newTray({ iconUrl: __MANIFEST_ICON__, withContent: true });

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
  // Global (whole-list) scan progress, synced to the floating webview panel so
  // "X/Y + current title" shows on every screen. null = no scan running.
  const scanStatus = ctx.state<{
    done: number;
    total: number;
    title: string;
  } | null>(null);
  // Per-manga source detail (keyed by provider id — one probe per provider),
  // seeded from $storage so a scanned manga shows its last per-source result
  // after a reload (unscanned providers render as "not scanned"). setProbes()
  // keeps the in-memory state and $storage in sync.
  type ProbeMap = Record<string, ProviderProbe>;
  const probeCache = ctx.state<Record<number, ProbeMap>>(hydrateProbes());
  function setProbes(mediaId: number, probes: ProbeMap) {
    const next = { ...probeCache.get(), [mediaId]: probes };
    probeCache.set(next);
    $storage.set(K_PROBES, next);
  }
  // mediaId of the manga entry the user is currently viewing (0 = not on one),
  // tracked via onNavigate so opening the tray on a manga page jumps to it.
  const currentMediaId = ctx.state<number>(0);

  // Collect every CURRENT reading entry across the collection's lists.
  function readingEntries(
    col: $app.Manga_Collection,
  ): $app.Manga_CollectionEntry[] {
    const out: $app.Manga_CollectionEntry[] = [];
    for (const list of col.lists ?? []) {
      if (String(list.status) !== "CURRENT") continue;
      for (const e of list.entries ?? []) {
        if (e?.media) out.push(e);
      }
    }
    return out;
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

  // Read a container for a single provider. When `skipCache` is false (default),
  // prefer seanime's cache / manual match; otherwise search with AniList titles.
  // Scan paths pass skipCache after emptyCache — the no-title call throws when
  // there is no binding, and a single outer catch used to mark that as "error".
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
        // no cache / manual match — fall through to title search
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
    } catch {
      return null; // thrown -> treat as provider error
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
    const providerIds = Object.keys(providers).filter(
      (p) => p !== "local-manga",
    );
    const matched = Object.values(probes).filter(
      (p) => p.matched && excluded[key]?.[p.provider] == null,
    );
    const maxLatest = matched.reduce((m, p) => Math.max(m, p.latest), 0);
    let kind: ResultKind;
    if (matched.length) {
      kind = classify(read, maxLatest, matched.length, false, gap);
    } else {
      const availableCount = providerIds.filter(
        (p) => excluded[key]?.[p] == null,
      ).length;
      kind = availableCount === 0 ? "all-excluded" : "not-matched";
    }
    return {
      title: media.title,
      cover: media.cover,
      latest: maxLatest,
      read,
      sources: matched.length,
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
    for (let i = 0; i < toScan.length; i += BATCH) {
      if (cancelRequested.get()) break;
      const batch = toScan.slice(i, i + BATCH);
      const fetched = await Promise.all(
        batch.map(async (pid) => ({
          pid,
          chs: await readContainer(mediaId, pid, titles, year, true),
        })),
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
      scanProgress.set({
        mediaId,
        done: Object.keys(probes).length,
        total: toScan.length,
      });
      onProgress?.(probes); // once per batch
    }
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
        // Advance the global progress (also counts TTL-cached manga below).
        scanStatus.set({ done: i + 1, total: entries.length, title });

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
      scanStatus.set(null);
    }
  }

  // A per-manga / per-source scan is in flight — the global scan must not start
  // on top of it (they'd fight over emptyCache + the shared scanProgress state).
  const individualScanRunning = () =>
    probingId.get() != null || scanningProvider.get() !== "";

  ctx.registerEventHandler("msu-scan", () => {
    if (scanning.get() || individualScanRunning()) return;
    void runScan(false);
  });

  ctx.registerEventHandler("msu-force", () => {
    if (scanning.get() || individualScanRunning()) return;
    void runScan(true);
  });

  ctx.registerEventHandler("msu-cancel", () => {
    if (!scanning.get()) return;
    cancelRequested.set(true);
    status.set("Cancelling…");
  });

  ctx.registerEventHandler("msu-clear-excl", () => {
    if (scanning.get()) return;
    $storage.set(K_EXCLUDED, {});
    status.set("Exclusions cleared — Force rescan to re-check every source");
    ctx.toast.success("Exclusions cleared");
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
    const existing = probeCache.get()[mediaId];
    if (!existing || !Object.keys(existing).length) return;

    const key = String(mediaId);
    const excluded =
      $storage.get<Record<string, Record<string, string>>>(K_EXCLUDED) ?? {};
    const providers = ctx.manga.getProviders();
    const next: ProbeMap = { ...existing };
    let changed = false;

    for (const pid of Object.keys(existing)) {
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
    }
  }

  // Scan ONE provider for a manga and merge its probe into the cache, leaving
  // every other provider's stored result untouched. Refreshes the list row.
  // Used by the per-source rescan button and the re-include flow.
  async function scanOneProvider(mediaId: number, provider: string) {
    // One scan at a time — same global guard as probeMangaDetail.
    if (scanning.get() || individualScanRunning()) return;
    scanningProvider.set(provider);
    try {
      const found = await findEntry(mediaId);
      if (!found) return;
      const providers = ctx.manga.getProviders();
      const titles = collectTitles(found.media);
      const year = found.media.startDate?.year;
      const gap = Number($getUserPreference("farBehindGap") ?? "10") || 10;
      await ctx.manga.emptyCache(mediaId);
      const chs = await readContainer(mediaId, provider, titles, year, true);
      const probe = makeProbe(provider, providers[provider] ?? provider, chs);
      // Replace just this provider's probe; keep the others as-is.
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

  // Reading-list status pill: `+N · M` where N = unread chapters on the best
  // source, M = how many sources have this manga. Non-matched states keep a word.
  function statusFor(r: MangaResult): {
    label: string;
    intent: EntryListIntent;
    tip: string;
  } {
    const m = r.sources ?? 0;
    const unread = unreadChapters(r.read, r.latest);
    const nm = `+${unread} · ${m}`;
    // `+N · M` tooltip decodes the compact badge; word states describe themselves.
    const nmTip = `${unread} unread · ${m} source${m === 1 ? "" : "s"}`;
    // The three "+N · M" kinds differ only by color; the rest are self-describing.
    const MAP: Record<
      ResultKind,
      { label: string; intent: EntryListIntent; tip: string }
    > = {
      new: { label: nm, intent: "success", tip: nmTip },
      "up-to-date": { label: nm, intent: "gray", tip: nmTip },
      outdated: { label: nm, intent: "warning", tip: nmTip },
      "not-matched": {
        label: "no match",
        intent: "warning",
        tip: "No source matched",
      },
      "all-excluded": {
        label: "all excluded",
        intent: "gray",
        tip: "All sources excluded",
      },
      "error-found": { label: "error", intent: "alert", tip: "Source errored" },
    };
    return MAP[r.kind] ?? MAP["error-found"];
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
    const busy = scanningThis || scanningProvider.get() !== "";
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
    ): { label: string; intent: EntryListIntent } => {
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
            tray.button(scanningProvider.get() === pid ? "⏳" : "↻", {
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
      const name = String(providers[pid] ?? pid);
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
      .sort((a, b) => {
        const byLatest = latestOf(b) - latestOf(a);
        if (byLatest !== 0) return byLatest;
        return String(providers[a] ?? a).localeCompare(
          String(providers[b] ?? b),
        );
      });
    const excludedIds = Object.keys(excludedForManga).sort((a, b) =>
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
  const panelStatus = ctx.state<{
    done: number;
    total: number;
    title: string;
  } | null>(null);
  ctx.effect(() => {
    const g = scanStatus.get();
    if (g) {
      panelStatus.set(g);
      return;
    }
    const p = scanProgress.get();
    if (p) {
      const title =
        detailTitle.get() ||
        results.get().find((r) => r.mediaId === p.mediaId)?.title ||
        "";
      panelStatus.set({ done: p.done, total: p.total, title });
      return;
    }
    panelStatus.set(null);
  }, [scanStatus, scanProgress, detailTitle]);

  // Floating scan panel (slot "fixed" → global, draggable) showing live "X/Y +
  // current title + progress bar" on every screen. Only visible while a scan
  // runs: the show/hide effect follows panelStatus, which channel.sync mirrors
  // into the iframe.
  const scanPanel = ctx.newWebview({
    slot: "fixed",
    width: "320px",
    height: "88px",
    hidden: true,
    window: { draggable: true, defaultPosition: "bottom-right" },
  });
  scanPanel.channel.sync("scan", panelStatus);
  scanPanel.setContent(() => scanPanelHtml);
  ctx.effect(() => {
    if (panelStatus.get()) scanPanel.show();
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
      let kind = r.kind;
      if (probes && Object.keys(probes).length > 0) {
        const summary = buildResult(r.mediaId, r, read, gap, probes);
        latest = summary.latest;
        sources = summary.sources;
        kind = summary.kind;
      } else if (r.sources > 0) {
        kind = classify(read, r.latest, r.sources, false, gap);
      }
      const isNew = kind === "new";
      if (
        Number(read) === Number(r.read) &&
        latest === r.latest &&
        sources === r.sources &&
        kind === r.kind &&
        isNew === r.isNew
      ) {
        return r;
      }
      changed = true;
      const row = { ...r, read, latest, sources, kind, isNew };
      stored[String(r.mediaId)] = {
        title: row.title,
        cover: row.cover,
        latest,
        read,
        sources,
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

  // Opening the tray while on a manga entry page jumps to that manga's source
  // detail; opening it anywhere else shows the list.
  ctx.screen.onNavigate((e) => {
    const isManga = String(e.pathname ?? "").includes("/manga/");
    const raw = isManga ? e.searchParams?.id : "";
    const id = raw ? parseInt(String(raw), 10) : 0;
    const mediaId = Number.isFinite(id) ? id : 0;
    currentMediaId.set(mediaId);
    if (mediaId > 0) void syncProbesFromCache(mediaId);
    dm.arm();
  });
  ctx.screen.loadCurrent();

  tray.onOpen(() => {
    void (async () => {
      const id = currentMediaId.get();
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
  // slot via ctx.action). Its label/tooltip reflect the last scan for the manga.
  const entryButton = ctx.action.newMangaPageButton({
    label: "MSU",
    intent: "gray-subtle",
    tooltipText: "Manga Source Updates",
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

  // Keep the button's label/tooltip in step with the current manga's scan row:
  // "MSU +3 · 4" when scanned, plain "MSU" otherwise.
  ctx.effect(() => {
    const id = currentMediaId.get();
    const row =
      id > 0 ? results.get().find((r) => r.mediaId === id) : undefined;
    if (row) {
      const s = statusFor(row);
      entryButton.setLabel(`MSU ${s.label}`);
      entryButton.setIntent(
        s.intent === "success" ? "success-subtle" : "gray-subtle",
      );
      entryButton.setTooltipText(`Manga Source Updates · ${s.tip}`);
    } else {
      entryButton.setLabel("MSU");
      entryButton.setIntent("gray-subtle");
      entryButton.setTooltipText(
        "Manga Source Updates — scan to check sources",
      );
    }
  }, [results, currentMediaId]);

  // §3: overlay a "+N · M" badge on scanned manga cards in the library grid.
  // Pure DOM (seanime has no card-badge API). The badge lives in the top-left
  // corner of the cover; each carries a data-msu-sig signature encoding its
  // desired content, so a re-fire whose signature already matches does nothing
  // (no mutation → no observer loop), while a scan/read that changes the numbers
  // produces a new signature and re-decorates. Unread is computed from the
  // card's own data-list-data progress, so reading a chapter updates the badge
  // with no gap (seanime re-renders the card → observer re-fires → fresh number).
  const cardBadgeColors = (
    intent: EntryListIntent,
  ): { bg: string; fg: string } => {
    switch (intent) {
      case "success":
        return { bg: "#16a34a", fg: "#ffffff" };
      case "warning":
        return { bg: "#d97706", fg: "#ffffff" };
      case "alert":
        return { bg: "#dc2626", fg: "#ffffff" };
      default:
        return { bg: "rgba(0,0,0,0.65)", fg: "#e5e7eb" };
    }
  };

  // §3: a "+N · M" badge on scanned manga cards in the library grid. Compute the
  // desired content, then hand off to the shared harness (loop/duplicate guard,
  // per-mediaId lock, denshi-safe query/append). Unread is derived from the
  // card's OWN live progress so a read updates it with no gap.
  const decorateCard = async (el: $ui.DOMElement) => {
    let mediaId = 0;
    try {
      mediaId = Number((await el.getAttribute("data-media-id")) ?? 0);
    } catch {
      return;
    }
    if (!mediaId) return;

    // Progress from the card's own list-data (String() guards the goja
    // wrapped-empty-string trap; inner catch keeps a bad attr from aborting).
    let progress = 0;
    try {
      const ld = String((await el.getAttribute("data-list-data")) ?? "");
      if (ld) progress = Number(JSON.parse(ld).progress ?? 0);
    } catch {
      /* progress stays 0 */
    }

    const row = results.get().find((r) => r.mediaId === mediaId);
    let sig: string;
    let label = "";
    let intent: EntryListIntent = "gray";
    let tip = "";
    if (row) {
      const gap = Number($getUserPreference("farBehindGap") ?? "10") || 10;
      // Reclassify against the card's live progress so +N is never stale; keep
      // terminal kinds (no-match / all-excluded / error) as-is.
      let kind = row.kind;
      if (kind === "new" || kind === "up-to-date" || kind === "outdated") {
        kind = classify(progress, row.latest, row.sources, false, gap);
      }
      const s = statusFor({ ...row, read: progress, kind });
      label = s.label;
      intent = s.intent;
      tip = s.tip;
      sig = `${mediaId}:${label}:${intent}`;
    } else {
      sig = `${mediaId}:none`;
    }

    await dm.decorate(el, {
      marker: "msu-card-badge",
      lockKey: String(mediaId),
      sig,
      render: (node) => {
        // Unscanned manga: hidden signed marker (no visible badge, not re-run).
        if (!row) {
          node.setStyle("display", "none");
          el.append(node);
          return;
        }
        // Inject into the card CONTAINER (el), NOT the card body: the body has
        // `isolate` (own stacking context) that traps a child below the hover
        // popup (z-15) at any z-index. As a sibling of the popup with z-16 the
        // badge stays visible; pointer-events:none so it doesn't eat hover/click.
        const { bg, fg } = cardBadgeColors(intent);
        node.setStyle("position", "absolute");
        node.setStyle("z-index", "16");
        node.setStyle("left", "0");
        node.setStyle("top", "0");
        node.setStyle("pointer-events", "none");
        node.setInnerHTML(
          `<span title="${tip}" style="display:inline-flex;align-items:center;height:1.15rem;padding:0 6px;font-size:0.7rem;font-weight:700;letter-spacing:0.02em;border-radius:4px 0 6px 0;background:${bg};color:${fg};box-shadow:0 1px 2px rgba(0,0,0,0.4);">${label}</span>`,
        );
        el.append(node);
      },
    });
  };

  // §2: a "New on: {source} +N" bar in the chapter-list header of the entry page
  // — ports the fork's data-chapter-list-unread-by-source to vanilla. Lists every
  // non-excluded, matched source with unread chapters; informational only (a
  // plugin can't flip the reader's Source dropdown). Progress is read live from
  // the entry header, so reading a chapter updates the counts with no gap.
  const escHtml = (s: string) =>
    String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/"/g, "&quot;");

  const decorateBar = async (container: $ui.DOMElement) => {
    const mediaId = currentMediaId.get();
    if (!mediaId) return; // not on a manga entry page

    // Fresh reader progress from the entry header (no gap on read); fall back to
    // the stored row's read if the badge isn't present.
    let read = results.get().find((r) => r.mediaId === mediaId)?.read ?? 0;
    try {
      const pEl = await ctx.dom.queryOne(
        "[data-media-page-header-progress-badge-progress]",
      );
      if (pEl) {
        const t = String((await pEl.getText()) ?? "").trim();
        if (t && !Number.isNaN(Number(t))) read = Number(t);
      }
    } catch {
      /* keep row read */
    }

    const key = String(mediaId);
    const probes = probeCache.get()[mediaId] ?? {};
    const excluded =
      $storage.get<Record<string, Record<string, string>>>(K_EXCLUDED)?.[key] ??
      {};
    const providers = ctx.manga.getProviders();
    const items = Object.keys(probes)
      .filter((pid) => pid !== "local-manga" && excluded[pid] == null)
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
      ? items.map((i) => `${i.pid}+${i.unread}`).join(",")
      : "none";

    await dm.decorate(container, {
      marker: "msu-bar",
      lockKey: "bar", // singleton per entry page
      sig,
      scope: container,
      render: async (node) => {
        // Anchor after the first header row (source selector) — always present.
        const headers = await container.query(
          "[data-chapter-list-header-container]",
        );
        const anchor = headers?.[0];
        if (!anchor) return; // chapter list not ready yet; a later pass retries
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
          `<span style="opacity:.55;font-size:.8rem">New on:</span>` +
            items
              .map(
                (i) =>
                  `<span title="${escHtml(i.name)}: ${i.unread} unread chapter${i.unread === 1 ? "" : "s"}" style="display:inline-flex;align-items:center;height:1.5rem;padding:0 8px;font-size:.75rem;font-weight:600;letter-spacing:.02em;border-radius:9999px;background:#16a34a;color:#fff">${escHtml(i.name)} +${i.unread}</span>`,
              )
              .join(""),
        );
        anchor.after(node);
      },
    });
  };

  // Explicit query→decorate passes (run on arm + refresh) — cover elements
  // already mounted before the observers ran; the sig guard keeps them idempotent.
  const redecorateCards = async () => {
    try {
      const cards = await ctx.dom.query(
        '[data-media-entry-card-container][data-media-type="manga"]',
      );
      for (const el of cards ?? []) void decorateCard(el);
    } catch {
      /* no cards on this screen */
    }
  };
  const redecorateBar = async () => {
    try {
      const cont = await ctx.dom.queryOne("[data-chapter-list-container]");
      if (cont) void decorateBar(cont);
    } catch {
      /* not on an entry page */
    }
  };

  // In-place read reactivity: reading a chapter changes the entry header's
  // progress number with no navigation / scan / state change. Push that fresh
  // progress into `results` so EVERYTHING that reads from state reacts — the
  // native [MSU] button, the tray detail, the list, and (via the effect) the
  // card badges + bar — not just the observed DOM.
  const applyProgressFromDom = async () => {
    const id = currentMediaId.get();
    if (!id) return;
    let read: number | null = null;
    try {
      const pEl = await ctx.dom.queryOne(
        "[data-media-page-header-progress-badge-progress]",
      );
      if (pEl) {
        const t = String((await pEl.getText()) ?? "").trim();
        if (t && !Number.isNaN(Number(t))) read = Number(t);
      }
    } catch {
      /* keep null */
    }
    if (read == null) return;
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
  dm.observe("[data-media-page-header-progress-badge-progress]", () => {
    void applyProgressFromDom();
    void redecorateBar();
  });
  dm.pass(redecorateCards);
  dm.pass(redecorateBar);
  dm.start();

  // A scan changes plugin state but NOT seanime's DOM, so nudge a repaint.
  ctx.effect(() => {
    results.get();
    probeCache.get();
    currentMediaId.get();
    dm.refresh();
  }, [results, probeCache, currentMediaId]);

  tray.render(() => {
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
            tray.button("↻ Scan", {
              onClick: "msu-scan",
              size: "sm",
              // Blocked while a per-manga scan (kicked off from a detail view)
              // is still running in the background.
              disabled: individualScanRunning(),
            }),
            tray.dropdownMenu({
              trigger: tray.button("…", {
                size: "sm",
                intent: "gray-subtle",
              }),
              items: [
                tray.dropdownMenuItem(tray.span("↻ Force rescan"), {
                  onClick: "msu-force",
                  disabled: individualScanRunning(),
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
