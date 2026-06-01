// src/plugins/mangaupdates-sync/modules/on-post-update-entry.ts
var onPostUpdateEntry = (...args) => {
  var EXT_ID_OFFSET = 2147483648;
  var LOCAL_ID_RANGE = 1099511627776;
  function isCustomSourceId(mediaId) {
    return mediaId >= EXT_ID_OFFSET;
  }
  function decodeLocalId(mediaId) {
    return (mediaId - EXT_ID_OFFSET) % LOCAL_ID_RANGE;
  }
  var SHARED_LIB_NAME = "mangaupdates-sync";
  var SOURCE_PREFIX = "ext_custom_source_mangaupdates|END|";
  var LINK_PREFIX = "mu_link_";
  function getMULink(mediaId) {
    return $storage.get(`${LINK_PREFIX}${mediaId}`);
  }
  function setMULink(mediaId, link) {
    $storage.set(`${LINK_PREFIX}${mediaId}`, link);
  }
  var onPostUpdateEntry2 = (event) => {
    const { MUClient, createLogger } = $shared.use(SHARED_LIB_NAME);
    const log = createLogger();
    try {
      const mediaId = event.mediaId;
      if (mediaId == null) {
        event.next();
        return;
      }
      const key = `mu_pending_${mediaId}`;
      const update = $store.get(key);
      if (!update) {
        event.next();
        return;
      }
      $store.remove(key);
      (async () => {
        let manga;
        try {
          manga = $anilist.getManga(mediaId);
        } catch (_) {
          manga = undefined;
        }
        const mu = new MUClient((url, init) => fetch(url, init));
        let externalId;
        if (isCustomSourceId(mediaId)) {
          const siteUrl = manga?.siteUrl;
          if (siteUrl && siteUrl.indexOf(SOURCE_PREFIX) === 0) {
            const localId = decodeLocalId(mediaId);
            if (localId > 0) {
              externalId = String(localId);
              log.info("custom-source mangaupdates media " + mediaId + " -> series_id=" + externalId);
            }
          }
        }
        if (!externalId) {
          const link = getMULink(mediaId);
          if (link?.id)
            externalId = link.id;
        }
        if (!externalId && ($getUserPreference("autoMatchFallback") ?? "false") === "true") {
          const title = manga?.title && (manga.title.english || manga.title.romaji || manga.title.userPreferred);
          if (title) {
            const match = (await mu.search(title, 25))[0];
            if (match) {
              externalId = match.id;
              setMULink(mediaId, { ...match, linkedAt: Date.now() });
            }
          }
        }
        if (!externalId) {
          log.warn("no MU link for media " + mediaId + " — open the entry page and click 'Link to MangaUpdates' to set one." + " Alternatively enable 'Auto-match fallback' in plugin settings.");
          return;
        }
        const seriesIdNum = Number(externalId);
        await mu.pushListEntry(seriesIdNum, {
          status: update.status,
          progress: update.progress
        });
        const syncScore = ($getUserPreference("syncScore") ?? "true") !== "false";
        if (syncScore && update.scoreRaw != null) {
          await mu.pushRating(seriesIdNum, update.scoreRaw);
        }
        log.info("pushed media " + mediaId + " -> MU " + externalId + " (status=" + (update.status || "-") + " chapter=" + (update.progress != null ? update.progress : "-") + " score=" + (update.scoreRaw != null ? update.scoreRaw : "-") + ")");
      })().catch((err) => {
        log.error(`push failed for media ${mediaId}:`, err);
      });
    } catch (e) {
      log.error("post hook error:", e);
    }
    event.next();
  };
  return onPostUpdateEntry2(...args);
};

// src/plugins/mangaupdates-sync/modules/on-pre-update-entry.ts
var onPreUpdateEntry = (...args) => {
  var SHARED_LIB_NAME = "mangaupdates-sync";
  var onPreUpdateEntry2 = (event) => {
    const { createLogger } = $shared.use(SHARED_LIB_NAME);
    const log = createLogger();
    try {
      const auto = ($getUserPreference("autoSyncOnProgress") ?? "true") !== "false";
      if (!auto || event.mediaId == null) {
        event.next();
        return;
      }
      let isMng = false;
      try {
        isMng = !!$anilist.getManga(event.mediaId);
      } catch (_) {
        isMng = false;
      }
      if (!isMng) {
        event.next();
        return;
      }
      $store.set(`mu_pending_${event.mediaId}`, {
        status: event.status,
        progress: event.progress,
        ..."scoreRaw" in event ? { scoreRaw: event.scoreRaw } : {}
      });
    } catch (e) {
      log.error("pre-edit error:", e);
    }
    event.next();
  };
  return onPreUpdateEntry2(...args);
};

// src/plugins/mangaupdates-sync/modules/register.ts
var register = (...args) => {
  function divider(tray) {
    return tray.div([], {
      style: {
        borderTop: "1px solid rgba(255,255,255,0.1)",
        marginTop: "10px",
        paddingTop: "8px"
      }
    });
  }
  var PILL_PALETTE = {
    success: { bg: "rgba(80,200,120,0.15)", fg: "rgba(140,220,160,1)" },
    info: { bg: "rgba(120,170,255,0.15)", fg: "rgba(160,200,255,1)" },
    warning: { bg: "rgba(255,200,0,0.15)", fg: "rgba(255,220,80,1)" },
    alert: { bg: "rgba(255,120,120,0.15)", fg: "rgba(255,150,150,1)" },
    gray: { bg: "rgba(255,255,255,0.06)", fg: "rgba(255,255,255,0.6)" }
  };
  function pill(tray, label, intent = "gray") {
    const { bg, fg } = PILL_PALETTE[intent] ?? PILL_PALETTE.gray;
    return tray.span(label, {
      style: {
        fontSize: "0.7rem",
        fontWeight: "500",
        padding: "2px 8px",
        borderRadius: "10px",
        background: bg,
        color: fg
      }
    });
  }
  function renderEntryListSection(tray, cfg) {
    const coverBox = (src) => src ? tray.img({
      src,
      style: {
        width: "44px",
        height: "62px",
        objectFit: "cover",
        borderRadius: "4px",
        flexShrink: "0"
      }
    }) : tray.div([], {
      style: {
        width: "44px",
        height: "62px",
        background: "rgba(255,255,255,0.05)",
        borderRadius: "4px",
        flexShrink: "0"
      }
    });
    const dotSep = () => tray.span("·", {
      style: { opacity: "0.35", fontSize: "0.75rem", margin: "0 2px" }
    });
    const subLineSegments = (row) => {
      const segs = [];
      if (row.year != null) {
        segs.push(tray.span(String(row.year), {
          style: { opacity: "0.55", fontSize: "0.75rem" }
        }));
      }
      if (row.status) {
        segs.push(pill(tray, row.status.label, row.status.intent));
      }
      if (row.chapter != null && row.chapter !== "") {
        segs.push(tray.span(`c.${row.chapter}`, {
          style: { opacity: "0.7", fontSize: "0.75rem" }
        }));
      }
      const linkStyle = {
        background: "transparent",
        border: "none",
        padding: "0",
        height: "auto",
        minHeight: "0",
        fontSize: "0.75rem",
        fontWeight: "500",
        opacity: "0.75",
        textDecoration: "underline",
        whiteSpace: "nowrap"
      };
      if (row.openExternal) {
        const link = tray.a([tray.span("Open ↗")], {
          href: row.openExternal.href,
          target: "_blank",
          rel: "noopener noreferrer",
          style: linkStyle
        });
        segs.push(row.openExternal.tooltip ? tray.tooltip(link, { text: row.openExternal.tooltip }) : link);
      }
      if (row.openInPlace) {
        const button = tray.button("Open →", {
          onClick: row.openInPlace.onClick,
          size: "sm",
          intent: "gray-subtle",
          style: linkStyle
        });
        segs.push(row.openInPlace.tooltip ? tray.tooltip(button, { text: row.openInPlace.tooltip }) : button);
      }
      return segs;
    };
    const entryRow = (row) => {
      const segs = subLineSegments(row);
      const subLineChildren = [];
      segs.forEach((seg, i) => {
        if (i > 0)
          subLineChildren.push(dotSep());
        subLineChildren.push(seg);
      });
      const middle = tray.stack([
        tray.text(row.title, {
          style: {
            fontWeight: "600",
            fontSize: "0.9rem",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap"
          }
        }),
        tray.flex(subLineChildren, {
          gap: 0,
          style: { alignItems: "center", marginTop: "2px" }
        })
      ], { style: { flex: "1", minWidth: "0" } });
      const rowChildren = [coverBox(row.cover), middle];
      for (const a of row.actions ?? [])
        rowChildren.push(a);
      return tray.flex(rowChildren, {
        gap: 2,
        style: {
          alignItems: "center",
          padding: "6px 8px",
          borderRadius: "4px",
          background: "rgba(255,255,255,0.02)",
          opacity: row.opacity != null ? String(row.opacity) : "1"
        }
      });
    };
    const headerCount = cfg.searchActive ? `${cfg.rows.length} / ${cfg.totalCount}` : `${cfg.totalCount}`;
    const header = tray.flex([
      tray.div([
        tray.text(`${cfg.headerLabel} (${headerCount})`, {
          style: {
            fontSize: "0.7rem",
            fontWeight: "700",
            opacity: "0.55",
            letterSpacing: "0.1em"
          }
        })
      ], { style: { flex: "1", alignSelf: "center" } }),
      ...cfg.inlineActions ?? []
    ], {
      gap: 2,
      style: { alignItems: "center", marginTop: "10px", marginBottom: "6px" }
    });
    const out = [];
    if (cfg.leadingDivider !== false)
      out.push(divider(tray));
    out.push(header);
    if (cfg.showSearchRow !== false && cfg.totalCount > 0) {
      const searchRowChildren = [
        tray.div([
          tray.input(cfg.searchPlaceholder, {
            fieldRef: cfg.searchFieldRef
          })
        ], { style: { flex: "1", minWidth: "0" } }),
        tray.button(cfg.searchButtonLabel ?? "\uD83D\uDD0D Search", {
          onClick: cfg.onSearch,
          size: "sm"
        })
      ];
      if (cfg.searchActive) {
        searchRowChildren.push(tray.tooltip(tray.button("✕", { onClick: cfg.onClearSearch, size: "sm" }), { text: "Clear search" }));
      }
      out.push(tray.flex(searchRowChildren, {
        gap: 2,
        style: { alignItems: "end", marginBottom: "6px" }
      }));
    }
    if (cfg.totalCount === 0) {
      out.push(tray.text(cfg.emptyText, {
        style: {
          fontSize: "0.8rem",
          opacity: "0.5",
          textAlign: "center",
          padding: "10px 0"
        }
      }));
    } else if (cfg.rows.length === 0 && cfg.searchActive) {
      out.push(tray.text(cfg.noMatchText, {
        style: {
          fontSize: "0.8rem",
          opacity: "0.5",
          textAlign: "center",
          padding: "10px 0"
        }
      }));
    } else {
      for (const row of cfg.rows)
        out.push(entryRow(row));
    }
    return out;
  }
  var STATUS_INTENT = {
    RELEASING: "success",
    FINISHED: "info",
    HIATUS: "warning",
    CANCELLED: "alert",
    NOT_YET_RELEASED: "gray"
  };
  function statusToPill(status) {
    if (!status)
      return;
    return {
      label: status.replace(/_/g, " ").toLowerCase(),
      intent: STATUS_INTENT[status] ?? "gray"
    };
  }
  var GITHUB_RAW_WORKSPACE = "https://raw.githubusercontent.com/Carloss616/seanime-extensions/main";
  var mu_letter_default = '<svg stroke="currentColor" fill="currentColor" stroke-width="0" role="img" viewBox="0 0 24 24" class="text-lg" height="1em" width="1em" xmlns="http://www.w3.org/2000/svg"><path d="M0.5,21 L0.5,3 L4.5,3 L7.5,11 L10.5,3 L14.5,3 L14.5,21 L11.5,21 L11.5,11.5 L8.5,17 L6.5,17 L3.5,11.5 L3.5,21 Z M16.5,21 L16.5,3 L18.5,3 L18.5,17 L21.5,17 L21.5,3 L23.5,3 L23.5,21 Z"/></svg>';
  var SHARED_LIB_NAME = "mangaupdates-sync";
  var SOURCE_PREFIX = "ext_custom_source_mangaupdates|END|";
  var LINK_PREFIX = "mu_link_";
  function getMULink(mediaId) {
    return $storage.get(`${LINK_PREFIX}${mediaId}`);
  }
  function setMULink(mediaId, link) {
    $storage.set(`${LINK_PREFIX}${mediaId}`, link);
  }
  function removeMULink(mediaId) {
    $storage.remove(`${LINK_PREFIX}${mediaId}`);
  }
  function listMULinkIds() {
    const seen = {};
    const ids = [];
    for (const k of $storage.keys()) {
      if (k.indexOf(LINK_PREFIX) !== 0)
        continue;
      const rest = k.slice(LINK_PREFIX.length);
      if (!/^\d+$/.test(rest))
        continue;
      if (seen[rest])
        continue;
      seen[rest] = true;
      ids.push(parseInt(rest, 10));
    }
    return ids;
  }
  var register2 = (ctx) => {
    const { MUClient, createLogger } = $shared.use(SHARED_LIB_NAME);
    const log = createLogger();
    const tray = ctx.newTray({
      tooltipText: "MangaUpdates Sync — linking",
      iconUrl: `${GITHUB_RAW_WORKSPACE}/src/plugins/mangaupdates-sync/assets/icon.png`,
      withContent: true
    });
    const currentMediaId = ctx.state(0);
    const searchInputRef = ctx.fieldRef("");
    const searchResults = ctx.state([]);
    const isSearching = ctx.state(false);
    const linkedFilter = ctx.state("");
    const fLinkedFilter = ctx.fieldRef("");
    const linkedRefresh = ctx.state(0);
    const bumpLinked = () => linkedRefresh.set(linkedRefresh.get() + 1);
    const showAllLinked = ctx.state(false);
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
      intent: "primary-subtle"
    });
    ctx.effect(() => {
      const id = currentMediaId.get();
      if (!id) {
        btn.unmount();
        tray.updateBadge({ number: 0 });
        return;
      }
      let media;
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
    const MU_ICON_KEY = "mu";
    const resolveMULink = (mediaId) => {
      let media;
      try {
        media = $anilist.getManga(mediaId);
      } catch (_) {
        media = undefined;
      }
      if (!media)
        return {};
      if (media.siteUrl && media.siteUrl.indexOf(SOURCE_PREFIX) === 0) {
        return {};
      }
      const link = getMULink(mediaId);
      if (!link)
        return {};
      return { url: link.url, title: link.title };
    };
    const [, refetchEntryPage] = ctx.dom.observe("[data-manga-entry-page]", async (els) => {
      if (($getUserPreference("injectEntryIcon") ?? "true") === "false") {
        return;
      }
      const el = els[0];
      if (!el)
        return;
      let mediaId;
      try {
        const raw = await el.getDataAttribute("media") ?? "{}";
        const data = JSON.parse(raw);
        if (typeof data.id === "number")
          mediaId = data.id;
      } catch (_) {}
      if (!mediaId)
        return;
      const linkInfo = resolveMULink(mediaId);
      if (!linkInfo.url)
        return;
      const $ = LoadDoc(el.innerHTML ?? "");
      const btnALId = $("[data-manga-meta-section-buttons-container] a").attr("id");
      if (!btnALId)
        return;
      const existingId = $(`[data-manga-meta-section-buttons-container] [data-mu-sync-key="${MU_ICON_KEY}"]`).attr("id");
      const titleAttr = linkInfo.title ? `MangaUpdates: ${linkInfo.title}` : "View on MangaUpdates";
      if (existingId) {
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
      a.setInnerHTML('<button type="button" class="UI-Button_root whitespace-nowrap font-semibold rounded-lg inline-flex items-center transition ease-in text-center justify-center focus-visible:outline-none focus-visible:ring-2 ring-offset-1 ring-offset-[--background] focus-visible:ring-[--ring] disabled:opacity-50 disabled:pointer-events-none shadow-none text-[--gray] border border-transparent bg-transparent hover:underline active:text-gray-700 dark:text-gray-300 dark:active:text-gray-200 UI-IconButton_root p-0 flex-none text-xl h-8 w-8 px-0">' + '<span class="md:inline-block">' + mu_letter_default.trim() + "</span>" + "</button>");
      ctx.dom.asElement(btnALId).after(a);
    }, { withInnerHTML: true, identifyChildren: true });
    const unlinkMedia = (id) => {
      removeMULink(id);
      ctx.toast.info("Link cleared");
      bumpLinked();
      if (id === currentMediaId.get()) {
        searchResults.set([]);
        currentMediaId.set(id);
        refetchEntryPage();
      }
    };
    const mu = new MUClient((url, init) => ctx.fetch(url, init));
    async function syncStatsToMU(mediaId) {
      const link = getMULink(mediaId);
      if (!link?.id)
        return false;
      let listData;
      try {
        const collection = await ctx.manga.getCollection();
        outer:
          for (const list of collection.lists || []) {
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
      if (!listData)
        return false;
      const seriesIdNum = Number(link.id);
      await mu.pushListEntry(seriesIdNum, {
        status: listData.status,
        progress: listData.progress
      });
      const syncScore = ($getUserPreference("syncScore") ?? "true") !== "false";
      if (syncScore && listData.scoreRaw != null) {
        await mu.pushRating(seriesIdNum, listData.scoreRaw);
      }
      return true;
    }
    async function runSearch(query) {
      const q = (query || "").trim();
      if (q.length < 2) {
        searchResults.set([]);
        return;
      }
      isSearching.set(true);
      try {
        searchResults.set(await mu.search(q));
      } catch (e) {
        ctx.toast.alert(`MangaUpdates search error: ${e instanceof Error ? e.message : "Unknown error"}`);
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
    ctx.registerEventHandler("mu-show-all", () => showAllLinked.set(true));
    ctx.registerEventHandler("mu-show-current", () => showAllLinked.set(false));
    btn.onClick(async (event) => {
      const media = event.media;
      if (!media)
        return;
      showAllLinked.set(false);
      if (media.id)
        currentMediaId.set(media.id);
      const title = media.title && (media.title.english || media.title.romaji || media.title.userPreferred) || "";
      searchInputRef.setValue(title);
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
    const buildLinkedRow = (mediaId, link) => {
      let alMedia;
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
          onClick: ctx.eventHandler(`mu-open-${mediaId}`, () => {
            ctx.screen.navigateTo("/manga/entry", { id: String(mediaId) });
            tray.close();
          }),
          tooltip: "Open in seanime"
        },
        actions: [
          tray.tooltip(tray.button("⛔", {
            onClick: ctx.eventHandler(`mu-unlink-${mediaId}`, () => unlinkMedia(mediaId)),
            size: "sm",
            intent: "alert-subtle"
          }), { text: "Unlink" })
        ]
      };
    };
    const renderLinkedList = (inlineActions = [], leadingDivider = true) => {
      const filter = linkedFilter.get().toLowerCase();
      const allLinked = listMULinkIds().map((mediaId) => ({ mediaId, link: getMULink(mediaId) })).filter((x) => !!x.link && Number.isFinite(x.mediaId));
      allLinked.sort((a, b) => (a.link.title || "").localeCompare(b.link.title || ""));
      const filtered = filter ? allLinked.filter((x) => (x.link.title || `#${x.link.id}`).toLowerCase().includes(filter)) : allLinked;
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
        emptyText: "No linked manga yet. Open a manga entry page and use the “Link to MangaUpdates” button.",
        noMatchText: `No linked manga match "${linkedFilter.get()}".`
      });
    };
    const renderSearchUI = (media, id, link) => {
      const out = [];
      const currentInput = (searchInputRef.current || "").trim();
      out.push(divider(tray));
      const searchRow = [
        tray.div([tray.input("Search MangaUpdates", { fieldRef: searchInputRef })], { style: { flex: "1", minWidth: "0" } }),
        tray.button(isSearching.get() ? "Searching..." : "Search", {
          onClick: "mu-do-search",
          intent: "primary",
          size: "sm"
        })
      ];
      if (searchResults.get().length > 0 || currentInput) {
        searchRow.push(tray.tooltip(tray.button("✕", { onClick: "mu-clear-search", size: "sm" }), { text: "Clear search" }));
      }
      out.push(tray.flex(searchRow, { gap: 2, style: { alignItems: "end" } }));
      const allTitles = [];
      if (media.title) {
        if (media.title.english)
          allTitles.push({ label: "English", value: media.title.english });
        if (media.title.romaji)
          allTitles.push({ label: "Romaji", value: media.title.romaji });
        if (media.title.userPreferred)
          allTitles.push({
            label: "Preferred",
            value: media.title.userPreferred
          });
      }
      const seen = {};
      const altTitles = allTitles.filter((t) => {
        const v = (t.value || "").trim();
        if (!v)
          return false;
        if (v === currentInput)
          return false;
        if (seen[v])
          return false;
        seen[v] = true;
        return true;
      });
      if (altTitles.length > 0) {
        out.push(tray.flex([
          tray.text("Search as", {
            style: {
              fontSize: "0.8rem",
              opacity: "0.6",
              alignSelf: "center"
            }
          }),
          ...altTitles.map((t) => tray.button(t.label, {
            onClick: ctx.eventHandler(`mu-search-as-${t.label}`, () => {
              searchInputRef.setValue(t.value);
              runSearch(t.value).catch((e) => log.error("alt search failed:", e));
            }),
            intent: "gray-subtle",
            size: "sm"
          }))
        ], { gap: 1, style: { flexWrap: "wrap", alignItems: "center" } }));
      }
      const results = searchResults.get();
      if (results.length > 0) {
        const resultRows = results.map((r) => {
          const alreadyLinked = !!link && link.id === r.id;
          return {
            cover: r.cover,
            title: r.title,
            year: r.year,
            openExternal: { href: r.url, tooltip: "View on MangaUpdates" },
            actions: [
              alreadyLinked ? tray.button("Linked", {
                intent: "success-subtle",
                size: "sm",
                style: { opacity: "0.7", pointerEvents: "none" }
              }) : tray.button("Pick", {
                onClick: ctx.eventHandler(`mu-pick-${r.id}`, () => {
                  const linkValue = { ...r, linkedAt: Date.now() };
                  setMULink(id, linkValue);
                  ctx.toast.success(`Linked to ${r.title}`);
                  searchResults.set([]);
                  bumpLinked();
                  currentMediaId.set(id);
                  refetchEntryPage();
                  tray.close();
                  syncStatsToMU(id).then((pushed) => {
                    if (pushed)
                      ctx.toast.info("Stats synced to MangaUpdates");
                  }).catch((err) => {
                    log.error("link-time sync failed:", err);
                    const msg = err instanceof Error ? err.message : String(err);
                    ctx.toast.alert(`Sync failed: ${msg}`);
                  });
                }),
                intent: "primary-subtle",
                size: "sm"
              })
            ]
          };
        });
        out.push(...renderEntryListSection(tray, {
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
          showSearchRow: false
        }));
      }
      return out;
    };
    tray.render(() => {
      linkedRefresh.get();
      const expanded = showAllLinked.get();
      const items = [];
      const id = currentMediaId.get();
      let media;
      if (id) {
        try {
          media = $anilist.getManga(id);
        } catch (_) {
          media = undefined;
        }
      }
      const isCustomSource = !!media?.siteUrl && media.siteUrl.indexOf(SOURCE_PREFIX) === 0;
      const onEntry = !!id && !!media && !isCustomSource;
      if (onEntry && media && !expanded) {
        const link = getMULink(id);
        const title = media.title && (media.title.english || media.title.userPreferred || media.title.romaji) || `#${id}`;
        items.push(tray.text(`Manga: ${title}`, { style: { fontWeight: "600" } }));
        const totalLinked = listMULinkIds().length;
        const showAllBtn = tray.button(`Show all (${totalLinked})`, {
          onClick: "mu-show-all",
          size: "sm",
          intent: "gray-subtle"
        });
        if (link) {
          items.push(...renderEntryListSection(tray, {
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
            showSearchRow: false
          }));
        } else {
          items.push(tray.text("Not linked yet."));
          if (totalLinked > 0)
            items.push(showAllBtn);
        }
        items.push(...renderSearchUI(media, id, link));
      } else {
        if (id && media && isCustomSource) {
          items.push(tray.text("This entry already comes from the MangaUpdates custom-source."), tray.text("Sync uses the embedded series_id — no linking needed."));
        } else if (id && !media) {
          items.push(tray.text(`Could not load entry #${id}.`));
        }
        const collapseBtn = onEntry && expanded ? [
          tray.button("Show current", {
            onClick: "mu-show-current",
            size: "sm",
            intent: "gray-subtle"
          })
        ] : [];
        items.push(...renderLinkedList(collapseBtn, items.length > 0));
      }
      return tray.stack(items);
    });
  };
  return register2(...args);
};

// src/plugins/mangaupdates-sync/modules/shared-lib.ts
var sharedLib = (...args) => {
  function createLogger() {
    const prefix = `[${"mangaupdates-sync"}]`;
    return {
      log: (...args2) => console.log(prefix, ...args2),
      info: (...args2) => console.info(prefix, ...args2),
      warn: (...args2) => console.warn(prefix, ...args2),
      error: (...args2) => console.error(prefix, ...args2),
      debug: (...args2) => console.debug(prefix, ...args2)
    };
  }

  class MUTokenExpiredError extends Error {
    constructor() {
      super("MU session expired");
      this.name = "MUTokenExpiredError";
    }
  }

  class MUClientBase {
    constructor() {
      this.baseUrl = "https://api.mangaupdates.com/v1";
    }
    async _req(method, path, options = {}) {
      const {
        body,
        token,
        onRefreshToken,
        maxRefreshTokenAttempts = 2
      } = options;
      const attempt = "attempt" in options ? Number(options.attempt) : 1;
      const headers = { Accept: "application/json" };
      if (token)
        headers.Authorization = `Bearer ${token}`;
      if (body !== undefined)
        headers["Content-Type"] = "application/json";
      const res = await this.fetchFn(this.baseUrl + path, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined
      });
      if (res.status === 401) {
        if (!onRefreshToken || attempt >= maxRefreshTokenAttempts)
          throw new MUTokenExpiredError;
        const token2 = await onRefreshToken();
        const _options = { ...options, token: token2, attempt: attempt + 1 };
        return this._req(method, path, _options);
      }
      if (!res.ok) {
        throw new Error(`MU ${method} ${path} -> ${res.status} ${res.text()}`);
      }
      if ((res.contentType || "").includes("application/json"))
        return res.json();
      return null;
    }
    async _search(query, options) {
      const { page, perPage, token } = options || {};
      return this._req("POST", "/series/search", {
        body: { search: query, page, perpage: perPage },
        token
      });
    }
  }
  function muRecordYear(record) {
    const year = record.year ? parseInt(record.year, 10) : undefined;
    return Number.isNaN(year) ? undefined : year;
  }
  function muRecordUrl(record) {
    return record.url || `https://www.mangaupdates.com/series.html?id=${record.series_id}`;
  }
  var log = createLogger();
  function toBaseResult(record) {
    const cover = record.image?.url || {};
    return {
      id: String(record.series_id),
      title: record.title || "???",
      year: muRecordYear(record),
      cover: cover.thumb || cover.original,
      url: muRecordUrl(record)
    };
  }

  class MUClient extends MUClientBase {
    constructor(fetchFn) {
      super();
      this.tokenKey = "mu_session_token";
      this.statusList = {
        CURRENT: 0,
        PLANNING: 1,
        COMPLETED: 2,
        DROPPED: 3,
        PAUSED: 4,
        REPEATING: 0
      };
      this.fetchFn = fetchFn;
    }
    async req(method, path, options = {}) {
      return this._req(method, path, {
        token: options.token,
        body: options.body,
        onRefreshToken: () => this.ensureToken(true)
      });
    }
    async search(query, page = 1, perpage = 10) {
      const token = await this.ensureToken();
      const data = await this._search(query, { page, perPage: perpage, token });
      return data?.results.map((r) => toBaseResult(r.record)) || [];
    }
    async login(username, password) {
      const data = await this.req("PUT", "/account/login", {
        body: { username, password }
      });
      const token = data?.context?.session_token;
      if (!token)
        throw new Error("MU login: response missing session token");
      return token;
    }
    async ensureToken(refresh = false) {
      let token = refresh ? undefined : $storage.get(this.tokenKey);
      const username = $getUserPreference("username");
      const password = $getUserPreference("password");
      if (!token) {
        if (!username || !password) {
          $storage.remove(this.tokenKey);
          throw new Error("Missing MangaUpdates credentials in plugin settings.");
        }
        token = await this.login(username, password);
        $storage.set(this.tokenKey, token);
        return token;
      }
      return token;
    }
    async pushListEntry(seriesId, payload) {
      const token = await this.ensureToken();
      const item = { series: { id: seriesId } };
      if (payload.status != null) {
        const mapped = this.statusList[payload.status];
        item.list_id = mapped !== undefined ? mapped : this.statusList.CURRENT;
      }
      if (payload.progress !== undefined) {
        item.status = { chapter: payload.progress };
      }
      try {
        await this.req("POST", "/lists/series/update", { token, body: [item] });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.indexOf("isn't on your list") >= 0) {
          await this.req("POST", "/lists/series", { token, body: [item] });
        } else {
          throw err;
        }
      }
    }
    async pushRating(seriesId, scoreRaw) {
      if (scoreRaw <= 0)
        return;
      const token = await this.ensureToken();
      const rating = Math.min(10, Math.max(0, Math.round(scoreRaw) / 10));
      try {
        await this.req("PUT", `/series/${seriesId}/rating`, {
          token,
          body: { rating }
        });
      } catch (err) {
        log.warn("rating push failed:", err);
      }
    }
  }
  var sharedLib2 = () => ({
    MUClient,
    createLogger
  });
  return sharedLib2(...args);
};

// src/plugins/mangaupdates-sync/utils/constants.ts
var SHARED_LIB_NAME = "mangaupdates-sync";

// src/plugins/mangaupdates-sync/code.ts
function init() {
  $shared.define(SHARED_LIB_NAME, sharedLib);
  $app.onPreUpdateEntryProgress(onPreUpdateEntry);
  $app.onPreUpdateEntry(onPreUpdateEntry);
  $app.onPostUpdateEntryProgress(onPostUpdateEntry);
  $app.onPostUpdateEntry(onPostUpdateEntry);
  $ui.register(register);
}
