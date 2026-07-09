import { joinDividers } from "../../../_components/divider";
import { type EntryListRow, entryList } from "../../../_components/entry-list";
import { LABEL_STYLE } from "../../../_components/text";
import { trayHeader } from "../../../_components/tray-header";
import { statusToPill } from "../../../_utils/anilist-status";
import muLetterSvg from "../assets/mu-letter.svg";
import { findListData } from "../utils/collection";
import { SHARED_LIB_NAME } from "../utils/constants";
import {
  getMULink,
  listMULinkIds,
  removeMULink,
  setMULink,
} from "../utils/link-store";
import {
  isMuCustomSourceEntry,
  resolveLinkedMuInfo,
} from "../utils/resolve-series-id";
import type { MULink, MUResult } from "../utils/types";
import type { sharedLib } from "./shared-lib";

// UI: explicit AniList ↔ MangaUpdates linking.
export const register = (ctx: $ui.Context) => {
  // $shared.use re-evals the factory in this runtime, so MUClient is a
  // runtime-local copy of the class defined in code.ts init().
  const { MUClient, createLogger } =
    $shared.use<ReturnType<typeof sharedLib>>(SHARED_LIB_NAME);
  const log = createLogger();

  const tray = ctx.newTray({ iconUrl: __MANIFEST_ICON__, withContent: true });

  const currentMediaId = ctx.state(0);
  const searchInputRef = ctx.fieldRef<string>("");
  const searchResults = ctx.state<MUResult[]>([]);
  const isSearching = ctx.state(false);
  // Local filter over the linked-mangas list (Section B in tray.render).
  // Separate from the MU API search above — this only narrows what's already
  // linked, it never hits the network.
  const linkedFilter = ctx.state("");
  const fLinkedFilter = ctx.fieldRef<string>("");
  // $storage is NOT reactive: tray.render only re-runs when a ctx.state read
  // inside it changes. Bump this after every link/unlink so the linked list
  // re-reads the mu_link_* keys.
  const linkedRefresh = ctx.state(0);
  const bumpLinked = () => linkedRefresh.set(linkedRefresh.get() + 1);
  // Per-entry detail view: when set, the tray renders link + search for that
  // manga instead of the full LINKED list.
  const detailId = ctx.state<number | null>(null);

  const getMedia = (id: number): $app.AL_BaseManga | undefined => {
    try {
      return $anilist.getManga(id);
    } catch (_) {
      return undefined;
    }
  };

  const isLinkableEntry = (id: number): boolean => {
    if (id <= 0) return false;
    const media = getMedia(id);
    if (!media) return false;
    return !isMuCustomSourceEntry(media.siteUrl);
  };

  const resolveEntryTitle = (media: $app.AL_BaseManga, id: number): string =>
    (media.title &&
      (media.title.english ||
        media.title.userPreferred ||
        media.title.romaji)) ||
    `#${id}`;

  // mediaId of the manga entry page the user is viewing (0 = not on one),
  // tracked via onNavigate — same source of truth as manga-source-updates.
  // The icon injector reads this instead of parsing data-media off the DOM.

  const btn = ctx.action.newMangaPageButton({
    label: "🔓",
    intent: "gray-subtle",
    tooltipText: "Link to MangaUpdates",
  });

  // Recompute the button label from $storage. Hides the button for
  // mangaupdates custom-source entries (sync uses the embedded id, no
  // linking needed — detected via the SOURCE_PREFIX siteUrl prefix).
  ctx.effect(() => {
    const id = currentMediaId.get();
    if (!id) {
      btn.unmount();
      tray.updateBadge({ number: 0 });
      return;
    }
    let media: $app.AL_BaseManga | undefined;
    try {
      media = $anilist.getManga(id);
    } catch (_) {
      media = undefined;
    }
    if (isMuCustomSourceEntry(media?.siteUrl)) {
      btn.unmount();
      tray.updateBadge({ number: 0 });
      return;
    }
    btn.mount();
    const link = getMULink(id);
    if (!link) {
      btn.setLabel("🔓");
      btn.setTooltipText("Link to MangaUpdates");
    } else {
      btn.setLabel("🔗");
      btn.setTooltipText(
        `Linked to MangaUpdates · ${link.title || `#${link.id}`}`,
      );
    }
    tray.updateBadge({ number: 0 });
  }, [currentMediaId]);

  // MU icon injected next to the AniList icon on the manga entry page.
  // Pattern (cribbed from the `quick-access` plugin):
  //   1. ctx.dom.observe (withInnerHTML + identifyChildren) gives a sync
  //      snapshot plus auto-assigned child ids for re-acquiring live handles
  //      via ctx.dom.asElement(id).
  //   2. LoadDoc parses the snapshot; the buttons container is located via
  //      data-manga-meta-section-buttons-container.
  //   3. Idempotency: each injected icon carries data-mu-sync-key="mu". If
  //      the snapshot already has it in the right slot we only refresh its href;
  //      if it was nested inside another icon's tooltip (custom-source entries),
  //      remove and re-insert as a sibling wrapper div.
  const MU_ICON_KEY = "mu";
  let muIconInjecting = false;

  const muIconInnerHtml =
    '<button type="button" class="UI-Button_root whitespace-nowrap font-semibold rounded-lg inline-flex items-center transition ease-in text-center justify-center focus-visible:outline-none focus-visible:ring-2 ring-offset-1 ring-offset-[--background] focus-visible:ring-[--ring] disabled:opacity-50 disabled:pointer-events-none shadow-none text-[--gray] border border-transparent bg-transparent hover:underline active:text-gray-700 dark:text-gray-300 dark:active:text-gray-200 UI-IconButton_root p-0 flex-none text-xl h-8 w-8 px-0">' +
    '<span class="md:inline-block">' +
    muLetterSvg.trim() +
    "</span>" +
    "</button>";

  const isMuIconMisplaced = (
    $doc: ReturnType<typeof LoadDoc>,
    anchorId: string,
  ): boolean => $doc(`#${anchorId}`).parent().children("a").length() > 1;

  const [, refetchEntryPage] = ctx.dom.observe(
    "[data-manga-entry-page]",
    async (els) => {
      if (($getUserPreference("injectEntryIcon") ?? "true") === "false") {
        return;
      }
      const el = els[0];
      if (!el) return;
      if (muIconInjecting) return;
      muIconInjecting = true;

      try {
        const mediaId = currentMediaId.get();
        if (!mediaId) return;

        const linkInfo = resolveLinkedMuInfo(mediaId);
        if (!linkInfo.url) return;

        const $ = LoadDoc(String(el.innerHTML ?? ""));
        const containerId = $(
          "[data-manga-meta-section-buttons-container]",
        ).attr("id");
        if (!containerId) return;

        const titleAttr = linkInfo.title
          ? `MangaUpdates: ${linkInfo.title}`
          : "View on MangaUpdates";

        const containerEl = ctx.dom.asElement(containerId);
        const liveMarkers =
          (await containerEl.query(`[data-mu-sync-key="${MU_ICON_KEY}"]`)) ??
          [];

        // Live DOM is the source of truth — LoadDoc can miss plugin-injected nodes.
        let keeperId: string | undefined;
        for (const marker of liveMarkers) {
          const anchorId = String(marker.id ?? "");
          if (!anchorId) continue;
          const misplaced = isMuIconMisplaced($, anchorId);
          if (!misplaced && !keeperId) {
            keeperId = anchorId;
            continue;
          }
          try {
            ctx.dom.asElement(anchorId).remove();
          } catch {
            /* already gone */
          }
        }

        if (keeperId) {
          const existing = ctx.dom.asElement(keeperId);
          existing.setAttribute("href", linkInfo.url);
          existing.setAttribute("title", titleAttr);
          return;
        }

        const a = await ctx.dom.createElement("a");
        a.setAttribute("href", linkInfo.url);
        a.setAttribute("target", "_blank");
        a.setAttribute("rel", "noopener noreferrer");
        a.setAttribute("data-mu-sync-key", MU_ICON_KEY);
        a.setAttribute("title", titleAttr);
        a.setProperty("className", ["cursor-pointer"]);
        a.setInnerHTML(muIconInnerHtml);
        const wrap = await ctx.dom.createElement("div");
        wrap.setAttribute("data-state", "closed");
        wrap.append(a);
        containerEl.append(wrap);
      } catch (err) {
        log.warn("MU icon injection failed:", err);
      } finally {
        muIconInjecting = false;
      }
    },
    { withInnerHTML: true, identifyChildren: true },
  );

  ctx.screen.onNavigate((e) => {
    const isManga = String(e.pathname ?? "").includes("/manga/");
    const raw = isManga ? e.searchParams?.id : "";
    const id = raw ? parseInt(String(raw), 10) : 0;
    const mediaId = Number.isFinite(id) ? id : 0;
    currentMediaId.set(mediaId);
    if (mediaId > 0) refetchEntryPage();
  });
  ctx.screen.loadCurrent();

  // Shared unlink body for both the per-entry "Unlink" button and the per-row
  // ⛔ buttons — they differ only in how the id is bound.
  const unlinkMedia = (id: number) => {
    removeMULink(id);
    ctx.toast.info("Link cleared");
    bumpLinked();
    // If we just unlinked the entry we're viewing, drop its stale picker,
    // refresh its button label (re-setting currentMediaId re-runs the effect)
    // and re-run the icon observer so the MU icon vanishes without a
    // navigate-away-and-back.
    if (id === currentMediaId.get()) {
      searchResults.set([]);
      currentMediaId.set(id);
      refetchEntryPage();
    }
  };

  const mu = new MUClient((url, init) => ctx.fetch(url, init));

  // Pushes the current AniList listData (status / progress / score) to the
  // linked MU series at link-time so MU mirrors AL immediately; subsequent AL
  // edits are handled by the post-update hook.
  async function syncStatsToMU(mediaId: number): Promise<boolean> {
    const link = getMULink(mediaId);
    if (!link?.id) return false;

    // Scan the (client-cached) manga collection for listData — cheaper than
    // refetching from AniList.
    let listData: $app.Manga_EntryListData | undefined;
    try {
      const collection = await ctx.manga.getCollection();
      listData = findListData(collection, mediaId);
    } catch (err) {
      log.warn("getCollection failed:", err);
    }
    // Nothing on the AL list yet — nothing to mirror.
    if (!listData) return false;

    const seriesIdNum = Number(link.id);
    await mu.pushListEntry(seriesIdNum, {
      status: listData.status,
      progress: listData.progress,
    });

    const syncScore = ($getUserPreference("syncScore") ?? "true") !== "false";
    if (syncScore && listData.score != null) {
      await mu.pushRating(seriesIdNum, listData.score);
    }
    return true;
  }

  // Drives the reactive UI state around mu.search (which does the HTTP +
  // response-shaping).
  async function runSearch(query: string) {
    const q = (query || "").trim();
    if (q.length < 2) {
      searchResults.set([]);
      return;
    }
    isSearching.set(true);
    try {
      searchResults.set(await mu.search(q));
    } catch (e) {
      ctx.toast.warning(
        `MangaUpdates search error: ${e instanceof Error ? e.message : "Unknown error"}`,
      );
      searchResults.set([]);
    } finally {
      isSearching.set(false);
    }
  }

  ctx.registerEventHandler("mu-do-search", async () => {
    await runSearch(searchInputRef.current || "");
  });

  ctx.registerEventHandler("mu-linked-search", () => {
    linkedFilter.set((fLinkedFilter.current || "").trim());
  });
  ctx.registerEventHandler("mu-linked-search-clear", () => {
    linkedFilter.set("");
    fLinkedFilter.setValue("");
  });
  ctx.registerEventHandler("mu-clear-search", () => {
    searchInputRef.setValue("");
    searchResults.set([]);
  });

  ctx.registerEventHandler("mu-back", () => {
    detailId.set(null);
  });

  // Open the per-entry detail view. Seeds the search input and auto-runs MU
  // search when the entry isn't linked yet (same rules as the page button).
  async function openEntryDetail(id: number) {
    detailId.set(id);
    const media = getMedia(id);
    if (!media) return;
    const title =
      (media.title &&
        (media.title.english ||
          media.title.romaji ||
          media.title.userPreferred)) ||
      "";
    searchInputRef.setValue(title);
    const existingLink = getMULink(id);
    if (!existingLink) {
      await runSearch(title);
    } else {
      searchResults.set([]);
    }
  }

  // Seeds currentMediaId from event.media (onNavigate may not have fired for
  // the route, e.g. opening the page directly), opens the detail view, and
  // tries to open the tray — which only works if the user has pinned it.
  btn.onClick(async (event) => {
    const media = event.media;
    if (!media?.id) return;
    currentMediaId.set(media.id);
    await openEntryDetail(media.id);
    try {
      tray.open();
    } catch (_) {
      ctx.toast.info("Pin the MangaUpdates Sync tray icon to open the linker.");
    }
  });
  btn.mount();

  // One linked-manga row for the full list (MU identity + AL list metadata).
  const buildLinkedRow = (mediaId: number, link: MULink): EntryListRow => {
    let alMedia: $app.AL_BaseManga | undefined;
    try {
      alMedia = $anilist.getManga(mediaId);
    } catch (_) {
      alMedia = undefined;
    }
    return {
      cover: link.cover,
      title: link.title || `#${link.id}`,
      year: alMedia?.startDate?.year,
      status: statusToPill(alMedia?.status),
      openExternal: { href: link.url, tooltip: "View on MangaUpdates" },
      openInPlace: {
        // The $storage key IS the seanime mediaId — navigate directly,
        // no extId decode needed.
        onClick: ctx.eventHandler(`mu-open-${mediaId}`, () => {
          ctx.screen.navigateTo("/manga/entry", { id: String(mediaId) });
          tray.close();
        }),
        tooltip: "Open in seanime",
      },
      actions: [
        tray.tooltip(
          tray.button("⚙️", {
            onClick: ctx.eventHandler(`mu-detail-${mediaId}`, () => {
              currentMediaId.set(mediaId);
              void openEntryDetail(mediaId);
            }),
            size: "sm",
            intent: "gray-subtle",
          }),
          { text: "Link & details" },
        ),
        tray.tooltip(
          tray.button("⛔", {
            onClick: ctx.eventHandler(`mu-unlink-${mediaId}`, () =>
              unlinkMedia(mediaId),
            ),
            size: "sm",
            intent: "alert-subtle",
          }),
          { text: "Unlink" },
        ),
      ],
    };
  };

  // Detail-view row: MangaUpdates series only (header above is the AniList entry).
  const buildMULinkRow = (mediaId: number, link: MULink): EntryListRow => ({
    cover: link.cover,
    title: link.title || `#${link.id}`,
    year: link.year,
    status: { label: "MangaUpdates", intent: "warning" },
    openExternal: { href: link.url, tooltip: "View on MangaUpdates" },
    actions: [
      tray.tooltip(
        tray.button("⛔", {
          onClick: ctx.eventHandler(`mu-unlink-${mediaId}`, () =>
            unlinkMedia(mediaId),
          ),
          size: "sm",
          intent: "alert-subtle",
        }),
        { text: "Unlink" },
      ),
    ],
  });

  // The full, locally-filterable "LINKED (N)" list section.
  const renderLinkedListSection = (): unknown => {
    const filter = linkedFilter.get().toLowerCase();
    // listMULinkIds() enumerates only top-level `mu_link_<id>` keys — it skips
    // the dotted sub-keys $storage produces for object values
    // (mu_link_<id>.cover, …) and dedupes them back to the parent id.
    const allLinked = listMULinkIds()
      .map((mediaId) => ({ mediaId, link: getMULink(mediaId) }))
      .filter(
        (x): x is { mediaId: number; link: MULink } =>
          !!x.link && Number.isFinite(x.mediaId),
      );
    allLinked.sort((a, b) =>
      (a.link.title || "").localeCompare(b.link.title || ""),
    );
    const filtered = filter
      ? allLinked.filter((x) =>
          (x.link.title || `#${x.link.id}`).toLowerCase().includes(filter),
        )
      : allLinked;
    return entryList(tray, {
      headerLabel: "LINKED",
      rows: filtered.map((x) => buildLinkedRow(x.mediaId, x.link)),
      totalCount: allLinked.length,
      searchActive: filter.length > 0,
      searchFieldRef: fLinkedFilter,
      searchPlaceholder: "Filter linked manga…",
      onSearch: "mu-linked-search",
      onClearSearch: "mu-linked-search-clear",
      emptyText:
        "No linked manga yet. Open a manga entry page and use the “Link to MangaUpdates” button.",
      noMatchText: `No linked manga match "${linkedFilter.get()}".`,
    });
  };

  const sectionLabelRow = (label: string, right: unknown[] = []) =>
    tray.flex(
      [
        tray.div([tray.text(label, { style: LABEL_STYLE })], {
          style: { flex: "1", alignSelf: "center" },
        }),
        ...right,
      ],
      { gap: 2, style: { alignItems: "center" } },
    );

  // Search-MangaUpdates UI for the current entry: search row + "Search as"
  // title shortcuts + the results picker. Pass `sectioned` to wrap with a
  // MANGAUPDATES section label (detail view).
  const renderSearchUI = (
    media: $app.AL_BaseManga,
    id: number,
    link: MULink | undefined,
    sectioned = false,
  ): unknown => {
    const out: unknown[] = [];
    const currentInput = (searchInputRef.current || "").trim();

    const searchRow: unknown[] = [
      tray.div(
        [
          tray.input(
            sectioned ? "Search on MangaUpdates" : "Search MangaUpdates",
            { fieldRef: searchInputRef },
          ),
        ],
        { style: { flex: "1", minWidth: "0" } },
      ),
      tray.button(isSearching.get() ? "Searching..." : "Search", {
        onClick: "mu-do-search",
        intent: "primary",
        size: "sm",
      }),
    ];
    if (searchResults.get().length > 0 || currentInput) {
      searchRow.push(
        tray.tooltip(
          tray.button("✕", { onClick: "mu-clear-search", size: "sm" }),
          { text: "Clear search" },
        ),
      );
    }
    out.push(tray.flex(searchRow, { gap: 2, style: { alignItems: "end" } }));

    // "Search as" per-title buttons (English / Romaji / Preferred), deduped
    // and minus whatever is already in the input box.
    const allTitles: Array<{ label: string; value: string }> = [];
    if (media.title) {
      if (media.title.english)
        allTitles.push({ label: "English", value: media.title.english });
      if (media.title.romaji)
        allTitles.push({ label: "Romaji", value: media.title.romaji });
      if (media.title.userPreferred)
        allTitles.push({
          label: "Preferred",
          value: media.title.userPreferred,
        });
    }
    const seen: Record<string, boolean> = {};
    const altTitles = allTitles.filter((t) => {
      const v = (t.value || "").trim();
      if (!v) return false;
      if (v === currentInput) return false;
      if (seen[v]) return false;
      seen[v] = true;
      return true;
    });
    if (altTitles.length > 0) {
      out.push(
        tray.flex(
          [
            tray.text("Search as", {
              style: {
                fontSize: "0.8rem",
                opacity: "0.6",
                alignSelf: "center",
              },
            }),
            ...altTitles.map((t) =>
              tray.button(t.label, {
                onClick: ctx.eventHandler(`mu-search-as-${t.label}`, () => {
                  searchInputRef.setValue(t.value);
                  runSearch(t.value).catch((e) =>
                    log.error("alt search failed:", e),
                  );
                }),
                intent: "gray-subtle",
                size: "sm",
              }),
            ),
          ],
          { gap: 1, style: { flexWrap: "wrap", alignItems: "center" } },
        ),
      );
    }

    // Results picker. Pick / Linked trailing action, external-link only — no
    // in-place open (the series isn't in seanime yet) and no search row.
    const results = searchResults.get();
    if (results.length > 0) {
      const resultRows = results.map((r): EntryListRow => {
        const alreadyLinked = !!link && link.id === r.id;
        return {
          cover: r.cover,
          title: r.title,
          year: r.year,
          openExternal: { href: r.url, tooltip: "View on MangaUpdates" },
          actions: [
            alreadyLinked
              ? tray.button("Linked", {
                  intent: "success-subtle",
                  size: "sm",
                  style: { opacity: "0.7", pointerEvents: "none" },
                })
              : tray.button("Pick", {
                  onClick: ctx.eventHandler(`mu-pick-${r.id}`, () => {
                    const linkValue: MULink = { ...r, linkedAt: Date.now() };
                    setMULink(id, linkValue);
                    ctx.toast.success(`Linked to ${r.title}`);
                    searchResults.set([]);
                    bumpLinked();
                    // Re-render the button label.
                    currentMediaId.set(id);
                    // Re-run the icon observer so the MU icon appears next to
                    // the AL one without a navigate-away-and-back.
                    refetchEntryPage();
                    tray.close();
                    // Fire-and-forget: mirror current AL listData to MU.
                    syncStatsToMU(id)
                      .then((pushed) => {
                        if (pushed)
                          ctx.toast.info("Stats synced to MangaUpdates");
                      })
                      .catch((err) => {
                        log.error("link-time sync failed:", err);
                        const msg =
                          err instanceof Error ? err.message : String(err);
                        ctx.toast.warning(`Sync failed: ${msg}`);
                      });
                  }),
                  intent: "primary-subtle",
                  size: "sm",
                }),
          ],
        };
      });
      out.push(
        entryList(tray, {
          headerLabel: "RESULTS",
          rows: resultRows,
          totalCount: results.length,
          searchActive: false,
          searchFieldRef: searchInputRef,
          searchPlaceholder: "",
          onSearch: "",
          onClearSearch: "",
          emptyText: "",
          noMatchText: "",
          showSearchRow: false,
        }),
      );
    }
    const body = tray.stack(out, { gap: 2 });
    if (!sectioned) return body;
    const sectionTitle = link ? "RELINK TO" : "LINK TO";
    return tray.stack([sectionLabelRow(sectionTitle), body], { gap: 2 });
  };

  const openInSeanimeButton = (id: number) =>
    tray.tooltip(
      tray.button("Open →", {
        onClick: ctx.eventHandler(`mu-detail-open-${id}`, () => {
          ctx.screen.navigateTo("/manga/entry", { id: String(id) });
          tray.close();
        }),
        size: "sm",
        intent: "gray-subtle",
      }),
      { text: "Open in seanime" },
    );

  // AniList entry header for the detail view (link badge + back only).
  function renderAniListDetailHeader(
    media: $app.AL_BaseManga,
    id: number,
    link: MULink | undefined,
  ): unknown {
    const entryTitle = resolveEntryTitle(media, id);
    const cover = String(
      media.coverImage?.large ?? media.coverImage?.extraLarge ?? "",
    );
    return trayHeader(tray, {
      title: entryTitle,
      subtitle: link ? undefined : "Not linked to MangaUpdates",
      iconUrl: cover || undefined,
      right: [
        link
          ? tray.badge("🔗 Linked", { intent: "success" })
          : tray.badge("🔓 Not linked", { intent: "gray" }),
        tray.button("← Back", {
          onClick: "mu-back",
          size: "sm",
          intent: "gray-subtle",
        }),
      ],
    });
  }

  // LINKED WITH block: MU row when linked, or a short not-linked note.
  function renderLinkedWithDetailSection(
    id: number,
    link: MULink | undefined,
  ): unknown {
    const openBtn = openInSeanimeButton(id);
    if (link) {
      return entryList(tray, {
        headerLabel: "LINKED WITH",
        inlineActions: [openBtn],
        rows: [buildMULinkRow(id, link)],
        totalCount: 1,
        showHeaderCount: false,
        searchActive: false,
        searchFieldRef: fLinkedFilter,
        searchPlaceholder: "",
        onSearch: "",
        onClearSearch: "",
        emptyText: "",
        noMatchText: "",
        showSearchRow: false,
      });
    }
    return tray.stack(
      [
        sectionLabelRow("LINKED WITH", [openBtn]),
        tray.text("Not linked to a MangaUpdates series yet.", {
          style: { fontSize: "0.8rem", opacity: "0.5", textAlign: "center" },
        }),
      ],
      { gap: 2 },
    );
  }

  // Root list view: plugin identity header + optional notes + full LINKED list.
  function renderLinkedList(): unknown {
    const id = currentMediaId.get();
    const media = id ? getMedia(id) : undefined;
    const isCustomSource = isMuCustomSourceEntry(media?.siteUrl);
    const blocks: unknown[] = [
      trayHeader(tray, {
        subtitle: "Link AniList entries to MangaUpdates",
      }),
    ];
    const notes: unknown[] = [];
    if (id && media && isCustomSource) {
      notes.push(
        tray.text(
          "This entry already comes from the MangaUpdates custom-source.",
        ),
        tray.text("Sync uses the embedded series_id — no linking needed."),
      );
    } else if (id && !media) {
      notes.push(tray.text(`Could not load entry #${id}.`));
    }
    if (notes.length > 0) blocks.push(tray.stack(notes, { gap: 2 }));
    blocks.push(renderLinkedListSection());
    return tray.stack(joinDividers(tray, blocks), { gap: 3 });
  }

  // Per-entry detail: AniList section + MU link + search.
  function renderEntryDetail(): unknown {
    const id = detailId.get();
    if (id == null) return null;
    const media = getMedia(id);
    if (!media) return null;
    const link = getMULink(id);

    const blocks: unknown[] = [
      renderAniListDetailHeader(media, id, link),
      renderLinkedWithDetailSection(id, link),
    ];
    blocks.push(renderSearchUI(media, id, link, true));
    return tray.stack(joinDividers(tray, blocks), { gap: 3 });
  }

  // Opening the tray while on a linkable manga entry page jumps to that
  // entry's detail; opening it anywhere else shows the full linked list.
  tray.onOpen(() => {
    void (async () => {
      const id = currentMediaId.get();
      if (id > 0 && isLinkableEntry(id)) {
        await openEntryDetail(id);
      } else {
        detailId.set(null);
      }
    })();
  });

  tray.render(() => {
    linkedRefresh.get();
    isSearching.get();
    if (detailId.get() != null) return renderEntryDetail();
    return renderLinkedList();
  });
};
