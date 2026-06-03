import { divider } from "../../../_components/divider";
import {
  type EntryListRow,
  renderEntryListSection,
} from "../../../_components/entry-list";
import { statusToPill } from "../../../_utils/anilist-status";
import { GITHUB_RAW_WORKSPACE } from "../../../_utils/constants";
import muLetterSvg from "../assets/mu-letter.svg";
import { SHARED_LIB_NAME, SOURCE_PREFIX } from "../utils/constants";
import {
  getMULink,
  listMULinkIds,
  type MULink,
  removeMULink,
  setMULink,
} from "../utils/link-store";
import type { MUResult } from "../utils/mu-client";
import type { sharedLib } from "./shared-lib";

// UI: explicit AniList ↔ MangaUpdates linking.
export const register = (ctx: $ui.Context) => {
  // $shared.use re-evals the factory in this runtime, so MUClient is a
  // runtime-local copy of the class defined in code.ts init().
  const { MUClient, createLogger } =
    $shared.use<ReturnType<typeof sharedLib>>(SHARED_LIB_NAME);
  const log = createLogger();

  const tray = ctx.newTray({
    // SeaImage silently blocks non-raster icon suffixes (incl. .ico), so
    // point at the extension's own icon.png raw URL instead.
    iconUrl: `${GITHUB_RAW_WORKSPACE}/src/plugins/mangaupdates-sync/assets/icon.png`,
    withContent: true,
  });

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
  // When on a manga entry the tray shows just that entry's link + search; this
  // toggles to the full "LINKED (N)" list (and hides the search). Reset to
  // collapsed on every navigation so each entry opens in entry-mode.
  const showAllLinked = ctx.state(false);

  // Any navigation carrying an `id` searchParam is treated as a media entry
  // (no pathname filter). The button click handler also seeds currentMediaId
  // from event.media.id, in case onNavigate didn't catch the route.
  ctx.screen.onNavigate((e) => {
    showAllLinked.set(false);
    const id = e.searchParams?.id;
    if (id) {
      const parsed = parseInt(id, 10);
      if (!Number.isNaN(parsed) && parsed > 0) {
        currentMediaId.set(parsed);
        return;
      }
    }
    currentMediaId.set(0);
  });
  ctx.screen.loadCurrent();

  const btn = ctx.action.newMangaPageButton({
    label: "Link to MangaUpdates",
    intent: "primary-subtle",
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
    if (media?.siteUrl && media.siteUrl.indexOf(SOURCE_PREFIX) === 0) {
      btn.unmount();
      tray.updateBadge({ number: 0 });
      return;
    }
    btn.mount();
    const link = getMULink(id);
    if (!link) {
      btn.setLabel("Link to MangaUpdates");
    } else {
      btn.setLabel(`Linked: ${link.title || `#${link.id}`}`);
    }
    tray.updateBadge({ number: 0 });
  }, [currentMediaId]);

  // MU icon injected next to the AniList icon on the manga entry page.
  // Pattern (cribbed from the `quick-access` plugin):
  //   1. ctx.dom.observe (withInnerHTML + identifyChildren) gives a sync
  //      snapshot plus auto-assigned child ids for re-acquiring live handles
  //      via ctx.dom.asElement(id).
  //   2. LoadDoc parses the snapshot; the AniList button is located via the
  //      data-manga-meta-section-buttons-container attribute (not a href
  //      match — robust to AL link changes).
  //   3. Idempotency: each injected icon carries data-mu-sync-key="mu". If
  //      the snapshot already has it we only refresh its href, else insert
  //      one — no remove/reinsert, no async races (fixes duplicate-icon bug).
  const MU_ICON_KEY = "mu";
  // Letterform is a path SVG, not <text>: <text> depends on the user's font
  // fallback chain and clips/jags at icon scale. Sized to ~75% of the 24x24
  // viewBox to match the AL icon height; currentColor inherits the button's
  // text-[--gray]. Markup is inlined from assets/mu-letter.svg as a string
  // literal at build time (Bun.build's `text` loader) — used as muLetterSvg.

  const resolveMULink = (mediaId: number): { url?: string; title?: string } => {
    let media: $app.AL_BaseManga | undefined;
    try {
      media = $anilist.getManga(mediaId);
    } catch (_) {
      media = undefined;
    }
    if (!media) return {};
    // Skip injection for custom-source entries: seanime already renders its
    // own external-link button pointing at the same series URL, so ours would
    // just duplicate it.
    if (media.siteUrl && media.siteUrl.indexOf(SOURCE_PREFIX) === 0) {
      return {};
    }
    const link = getMULink(mediaId);
    if (!link) return {};
    return { url: link.url, title: link.title };
  };

  const [, refetchEntryPage] = ctx.dom.observe(
    "[data-manga-entry-page]",
    async (els) => {
      if (($getUserPreference("injectEntryIcon") ?? "true") === "false") {
        return;
      }
      const el = els[0];
      if (!el) return;

      let mediaId: number | undefined;
      try {
        const raw = (await el.getDataAttribute("media")) ?? "{}";
        const data = JSON.parse(raw);
        if (typeof data.id === "number") mediaId = data.id;
      } catch (_) {
        /* ignore */
      }
      if (!mediaId) return;

      const linkInfo = resolveMULink(mediaId);
      if (!linkInfo.url) return;

      const $ = LoadDoc(el.innerHTML ?? "");
      const btnALId = $("[data-manga-meta-section-buttons-container] a").attr(
        "id",
      );
      if (!btnALId) return;

      const existingId = $(
        `[data-manga-meta-section-buttons-container] [data-mu-sync-key="${MU_ICON_KEY}"]`,
      ).attr("id");
      const titleAttr = linkInfo.title
        ? `MangaUpdates: ${linkInfo.title}`
        : "View on MangaUpdates";

      if (existingId) {
        // Refresh href + title in place (handles entry-to-entry navigation
        // and link changes).
        const existing = ctx.dom.asElement(existingId);
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
      // Re-uses seanime's own button styles so the icon visually
      // matches the AniList one (size, hover, focus ring, etc.).
      a.setInnerHTML(
        '<button type="button" class="UI-Button_root whitespace-nowrap font-semibold rounded-lg inline-flex items-center transition ease-in text-center justify-center focus-visible:outline-none focus-visible:ring-2 ring-offset-1 ring-offset-[--background] focus-visible:ring-[--ring] disabled:opacity-50 disabled:pointer-events-none shadow-none text-[--gray] border border-transparent bg-transparent hover:underline active:text-gray-700 dark:text-gray-300 dark:active:text-gray-200 UI-IconButton_root p-0 flex-none text-xl h-8 w-8 px-0">' +
          '<span class="md:inline-block">' +
          muLetterSvg.trim() +
          "</span>" +
          "</button>",
      );
      ctx.dom.asElement(btnALId).after(a);
    },
    { withInnerHTML: true, identifyChildren: true },
  );

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
      outer: for (const list of collection.lists || []) {
        for (const entry of list.entries || []) {
          if (entry?.media && entry.media.id === mediaId) {
            listData = entry.listData;
            break outer;
          }
        }
      }
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

  // Toggle between entry-mode (this entry's link + search) and the full
  // "LINKED (N)" list. See `showAllLinked`.
  ctx.registerEventHandler("mu-show-all", () => showAllLinked.set(true));
  ctx.registerEventHandler("mu-show-current", () => showAllLinked.set(false));

  // Seeds currentMediaId from event.media (onNavigate may not have fired for
  // the route, e.g. opening the page directly), seeds the input, runs an
  // initial search, and tries to open the tray — which only works if the user
  // has pinned it (a seanime limitation).
  btn.onClick(async (event) => {
    const media = event.media;
    if (!media) return;
    showAllLinked.set(false);
    if (media.id) currentMediaId.set(media.id);
    // English title first — MangaUpdates is an English-language DB, so matches
    // are most reliable against English titles.
    const title =
      (media.title &&
        (media.title.english ||
          media.title.romaji ||
          media.title.userPreferred)) ||
      "";
    searchInputRef.setValue(title);
    // Auto-search only when the entry isn't linked yet. For already-linked
    // entries the user is usually checking the link, not relinking, so
    // hold the results until they explicitly press Search.
    const existingLink = media.id ? getMULink(media.id) : undefined;
    if (!existingLink) {
      await runSearch(title);
    } else {
      searchResults.set([]);
    }
    try {
      tray.open();
    } catch (_) {
      ctx.toast.info("Pin the MangaUpdates Sync tray icon to open the linker.");
    }
  });
  btn.mount();

  // One linked-manga row, used in both tray modes. Publication status + year
  // come from AniList (the $storage key IS the AniList mediaId), not from MU.
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

  // The full, locally-filterable "LINKED (N)" list. inlineActions lets the
  // caller drop a header button (e.g. the "Show current" collapse toggle);
  // leadingDivider is suppressed when the list is rendered first.
  const renderLinkedList = (
    inlineActions: unknown[] = [],
    leadingDivider = true,
  ): unknown[] => {
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
    return renderEntryListSection(tray, {
      headerLabel: "LINKED",
      rows: filtered.map((x) => buildLinkedRow(x.mediaId, x.link)),
      totalCount: allLinked.length,
      searchActive: filter.length > 0,
      searchFieldRef: fLinkedFilter,
      searchPlaceholder: "Filter linked manga…",
      onSearch: "mu-linked-search",
      onClearSearch: "mu-linked-search-clear",
      inlineActions,
      leadingDivider,
      emptyText:
        "No linked manga yet. Open a manga entry page and use the “Link to MangaUpdates” button.",
      noMatchText: `No linked manga match "${linkedFilter.get()}".`,
    });
  };

  // Search-MangaUpdates UI for the current entry: search row + "Search as"
  // title shortcuts + the results picker.
  const renderSearchUI = (
    media: $app.AL_BaseManga,
    id: number,
    link: MULink | undefined,
  ): unknown[] => {
    const out: unknown[] = [];
    const currentInput = (searchInputRef.current || "").trim();

    out.push(divider(tray));

    const searchRow: unknown[] = [
      tray.div(
        [tray.input("Search MangaUpdates", { fieldRef: searchInputRef })],
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
        ...renderEntryListSection(tray, {
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
    return out;
  };

  // Tray content. Two modes:
  //   - On a linkable manga entry: that entry's link + Search MangaUpdates,
  //     with a "Show all (N)" toggle that expands into the full LINKED (N)
  //     list (and hides the search).
  //   - Otherwise (no entry / custom-source / load failure): just the full
  //     LINKED (N) list.
  tray.render(() => {
    // $storage isn't reactive; read linkedRefresh so pick/unlink/toggle
    // re-render.
    linkedRefresh.get();
    const expanded = showAllLinked.get();
    const items: unknown[] = [];

    const id = currentMediaId.get();
    let media: $app.AL_BaseManga | undefined;
    if (id) {
      try {
        media = $anilist.getManga(id);
      } catch (_) {
        media = undefined;
      }
    }
    const isCustomSource =
      !!media?.siteUrl && media.siteUrl.indexOf(SOURCE_PREFIX) === 0;
    const onEntry = !!id && !!media && !isCustomSource;

    if (onEntry && media && !expanded) {
      // ---- Entry mode (collapsed): this entry's link + search ----
      const link = getMULink(id);
      const title =
        (media.title &&
          (media.title.english ||
            media.title.userPreferred ||
            media.title.romaji)) ||
        `#${id}`;
      items.push(
        tray.text(`Manga: ${title}`, { style: { fontWeight: "600" } }),
      );

      const totalLinked = listMULinkIds().length;
      const showAllBtn = tray.button(`Show all (${totalLinked})`, {
        onClick: "mu-show-all",
        size: "sm",
        intent: "gray-subtle",
      });

      if (link) {
        // Single-row section for this entry's link, with the "Show all (N)"
        // toggle in its header.
        items.push(
          ...renderEntryListSection(tray, {
            headerLabel: "LINKED",
            rows: [buildLinkedRow(id, link)],
            totalCount: 1,
            searchActive: false,
            searchFieldRef: fLinkedFilter,
            searchPlaceholder: "",
            onSearch: "",
            onClearSearch: "",
            inlineActions: totalLinked > 1 ? [showAllBtn] : [],
            emptyText: "",
            noMatchText: "",
            showSearchRow: false,
          }),
        );
      } else {
        items.push(tray.text("Not linked yet."));
        if (totalLinked > 0) items.push(showAllBtn);
      }

      items.push(...renderSearchUI(media, id, link));
    } else {
      // ---- Full-list mode: not a linkable entry, or expanded via toggle ----
      if (id && media && isCustomSource) {
        items.push(
          tray.text(
            "This entry already comes from the MangaUpdates custom-source.",
          ),
          tray.text("Sync uses the embedded series_id — no linking needed."),
        );
      } else if (id && !media) {
        items.push(tray.text(`Could not load entry #${id}.`));
      }
      const collapseBtn =
        onEntry && expanded
          ? [
              tray.button("Show current", {
                onClick: "mu-show-current",
                size: "sm",
                intent: "gray-subtle",
              }),
            ]
          : [];
      // Suppress the leading divider when the list is the first thing in the
      // tray (no custom-source/load note above it) — else it shows as an
      // empty top line.
      items.push(...renderLinkedList(collapseBtn, items.length > 0));
    }

    return tray.stack(items);
  });
};
