import { MUClient } from "../utils/mu-client";

interface MULink {
  seriesId: string;
  seriesTitle?: string;
  seriesUrl?: string;
  seriesCover?: string;
  linkedAt: number;
  source: "manual" | "auto";
}

// UI: explicit AniList ↔ MangaUpdates linking.
//
// The plugin uses only primitives documented at
// https://seanime.gitbook.io/seanime-extensions:
//   - ctx.action.newMangaPageButton (per-page status + entry trigger)
//   - ctx.newTray + tray.* (search UI; user must pin the tray icon)
//   - ctx.fetch (UI-context HTTP — domain is whitelisted in the manifest)
//   - ctx.state, ctx.effect, ctx.fieldRef, ctx.registerEventHandler,
//     ctx.eventHandler, ctx.toast, ctx.screen.{onNavigate, loadCurrent}
//   - $storage, $anilist (per-plugin storage + AniList lookup)
export const register = (ctx: PluginContext) => {
  const tray = ctx.newTray({
    tooltipText: "MangaUpdates Sync — linking",
    // SeaImage (seanime's image component) silently blocks non-raster
    // suffixes, and `.ico` falls into that bucket — points at the
    // extension's own `icon.png` from the github raw URL instead.
    iconUrl:
      "https://raw.githubusercontent.com/Carloss616/seanime-extensions/main/src/plugins/mangaupdates-sync/assets/icon.png",
    withContent: true,
  });

  interface MUResult {
    id: string;
    title: string;
    year?: number;
    cover?: string;
    url?: string;
  }

  // Reactive state
  const currentMediaId = ctx.state(0);
  const searchInputRef = ctx.fieldRef<string>("");
  const searchResults = ctx.state<MUResult[]>([]);
  const isSearching = ctx.state(false);

  // Track current entry via screen.onNavigate. We don't filter by
  // pathname — any navigation event carrying an `id` searchParam is
  // treated as a media entry. The button click handler also seeds
  // currentMediaId from `event.media.id` as a belt-and-suspenders.
  ctx.screen.onNavigate((e) => {
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

  // MangaPageButton — only documented props (no tooltipText / setLoading).
  const btn = ctx.action.newMangaPageButton({
    label: "Link to MangaUpdates",
    intent: "primary-subtle",
  });

  // Recompute the button label from $storage. Hides the button when the
  // entry comes from the mangaupdates custom-source (sync uses the
  // embedded id, no linking needed).
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
    if (
      media?.siteUrl &&
      media.siteUrl.indexOf("ext_custom_source_mangaupdates|END|") === 0
    ) {
      btn.unmount();
      tray.updateBadge({ number: 0 });
      return;
    }
    btn.mount();
    const link = $storage.get<MULink>(`mu_link_${id}`);
    if (!link) {
      btn.setLabel("Link to MangaUpdates");
      tray.updateBadge({ number: 0 });
    } else if (link.source === "manual") {
      btn.setLabel(`Linked: ${link.seriesTitle || `#${link.seriesId}`}`);
      tray.updateBadge({ number: 0 });
    } else {
      // "auto" — title-search fallback, unverified.
      btn.setLabel("Linked: ? (verify)");
      tray.updateBadge({ number: 1, intent: "warning" });
    }
  }, [currentMediaId]);

  // MU icon injected next to the AniList icon on the manga entry page.
  //
  // Pattern (cribbed from the `quick-access` plugin):
  //   1. `ctx.dom.observe` on `[data-manga-entry-page]` with
  //      `withInnerHTML + identifyChildren`. Each tick gives us a
  //      synchronous snapshot of the entry page and auto-assigned ids
  //      on every child so we can re-acquire live handles via
  //      `ctx.dom.asElement(id)`.
  //   2. `LoadDoc` parses the snapshot. We look up the AniList button
  //      via the documented `data-manga-meta-section-buttons-container`
  //      attribute (NOT a href match — robust to AL link changes).
  //   3. Idempotency: each injected icon is marked with
  //      `data-mu-sync-key="mu"`. If the snapshot already contains it,
  //      we only update its href; otherwise we insert one. No
  //      remove-and-reinsert dance, no async races — fixes the
  //      duplicate-icon bug.
  const MU_ICON_KEY = "mu";
  // Path-based "MU" letterform — same approach as the AniList icon.
  // SVG `<text>` rendering depends on the user's system font fallback
  // chain (gets jagged/clipped at icon scale); paths render crisp at
  // any size. Geometry is sized to fill ~75% of the 24x24 viewBox so
  // the rendered height matches the AL icon (~13.5px in `text-lg`).
  // Color is `currentColor` so it inherits the button's `text-[--gray]`.
  const MU_ICON_SVG =
    '<svg stroke="currentColor" fill="currentColor" stroke-width="0" role="img" viewBox="0 0 24 24" class="text-lg" height="1em" width="1em" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M0.5,21 L0.5,3 L4.5,3 L7.5,11 L10.5,3 L14.5,3 L14.5,21 L11.5,21 L11.5,11.5 L8.5,17 L6.5,17 L3.5,11.5 L3.5,21 Z M16.5,21 L16.5,3 L18.5,3 L18.5,17 L21.5,17 L21.5,3 L23.5,3 L23.5,21 Z"/>' +
    "</svg>";

  const resolveMULink = (mediaId: number): { url?: string; title?: string } => {
    let media: $app.AL_BaseManga | undefined;
    try {
      media = $anilist.getManga(mediaId);
    } catch (_) {
      media = undefined;
    }
    if (!media) return {};
    // Custom-source mangaupdates entries: skip injection. seanime already
    // renders its own native external-link button for custom-source entries
    // (pointing at the same series URL it stored in siteUrl), so adding our
    // MU icon here would just duplicate it.
    const customPrefix = "ext_custom_source_mangaupdates|END|";
    if (media.siteUrl && media.siteUrl.indexOf(customPrefix) === 0) {
      return {};
    }
    const link = $storage.get<MULink>(`mu_link_${mediaId}`);
    if (!link) return {};
    const url =
      link.seriesUrl ||
      `https://www.mangaupdates.com/series.html?id=${link.seriesId}`;
    return { url, title: link.seriesTitle };
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
        // Already present — just refresh href + title (handles
        // entry-to-entry navigation and link changes).
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
          MU_ICON_SVG +
          "</span>" +
          "</button>",
      );
      ctx.dom.asElement(btnALId).after(a);
    },
    { withInnerHTML: true, identifyChildren: true },
  );

  const mu = new MUClient((url, init) => ctx.fetch(url, init));

  // Pushes the current AniList listData (status / progress / score) to
  // the linked MU series. Used at link-time so MU mirrors AL immediately;
  // subsequent AL edits are handled by the post-update hook.
  async function syncStatsToMU(mediaId: number): Promise<boolean> {
    const link = $storage.get<MULink>(`mu_link_${mediaId}`);
    if (!link?.seriesId) return false;

    // Locate the listData by scanning the manga collection. Cheaper than
    // refetching from AniList — the collection is already cached client-side.
    let listData: MangaListEntry["listData"] | undefined;
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
      console.warn("[mangaupdates-sync] getCollection failed:", err);
    }
    // Nothing on the AL list yet — nothing to mirror.
    if (!listData) return false;

    const token = await mu.ensureToken();
    const seriesIdNum = Number(link.seriesId);
    await mu.pushListEntry(token, seriesIdNum, {
      status: listData.status,
      progress: listData.progress,
    });

    const syncScore = ($getUserPreference("syncScore") ?? "true") !== "false";
    if (syncScore && listData.scoreRaw != null) {
      await mu.pushRating(token, seriesIdNum, listData.scoreRaw);
    }
    return true;
  }

  // Search MangaUpdates. Uses ctx.fetch (UI-context) — the doc requires
  // it inside $ui.register, and the domain is whitelisted in the manifest.
  async function runSearch(query: string) {
    const q = (query || "").trim();
    if (q.length < 2) {
      searchResults.set([]);
      return;
    }
    isSearching.set(true);
    try {
      const token = $storage.get<string>("mu_session_token") || "";
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "application/json",
      };
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await ctx.fetch(
        "https://api.mangaupdates.com/v1/series/search",
        {
          method: "POST",
          headers,
          body: JSON.stringify({ search: q, perpage: 10 }),
        },
      );
      if (!res.ok) {
        ctx.toast.alert(`MangaUpdates search failed (${res.status})`);
        searchResults.set([]);
        return;
      }
      const data = res.json<MUSearchResponse>();
      const out: MUResult[] = [];
      const arr = data?.results || [];
      for (const r of arr) {
        const sid = r?.record?.series_id;
        if (!sid) continue;
        const rec = r.record;
        const year = rec.year ? parseInt(rec.year, 10) : undefined;
        out.push({
          id: String(sid),
          title: rec.title || "(untitled)",
          year: !Number.isNaN(year as number) ? year : undefined,
          cover: rec.image?.url
            ? rec.image.url.thumb || rec.image.url.original
            : undefined,
          url: rec.url,
        });
      }
      searchResults.set(out);
    } catch (e) {
      ctx.toast.alert(
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

  ctx.registerEventHandler("mu-clear-link", () => {
    const id = currentMediaId.get();
    if (!id) return;
    $storage.remove(`mu_link_${id}`);
    searchResults.set([]);
    ctx.toast.info("Link cleared");
    // Force a re-render of the effect above by re-setting the state.
    currentMediaId.set(id);
    // Re-run the icon observer so the MU button vanishes immediately,
    // without requiring the user to navigate away and back.
    refetchEntryPage();
  });

  // Button click: seed the input, run an initial search, and try to open
  // the tray (works only if the user has pinned it — documented limitation).
  // Also force currentMediaId from event.media: depending on the route the
  // user took (e.g. opening the page directly), onNavigate may not have
  // fired with a recognized pathname yet, leaving the tray with id=0.
  btn.onClick(async (event) => {
    const media = event.media;
    if (!media) return;
    if (media.id) currentMediaId.set(media.id);
    // English title takes priority — MangaUpdates is an English-language
    // database, so matches are most reliable against English titles.
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
    const existingLink = media.id
      ? $storage.get<MULink>(`mu_link_${media.id}`)
      : undefined;
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

  // Tray content — the actual picker.
  tray.render(() => {
    const id = currentMediaId.get();
    if (!id) {
      return tray.stack([
        tray.text("Open a manga entry page to link it to MangaUpdates."),
      ]);
    }
    let media: $app.AL_BaseManga | undefined;
    try {
      media = $anilist.getManga(id);
    } catch (_) {
      media = undefined;
    }
    if (!media) {
      return tray.stack([tray.text(`Unknown media #${id}`)]);
    }
    if (
      media.siteUrl &&
      media.siteUrl.indexOf("ext_custom_source_mangaupdates|END|") === 0
    ) {
      return tray.stack([
        tray.text(
          "This entry already comes from the MangaUpdates custom-source.",
        ),
        tray.text("Sync uses the embedded series_id — no linking needed."),
      ]);
    }
    const link = $storage.get<MULink>(`mu_link_${id}`);
    // Display title: english-first too (matches the search priority).
    const title =
      (media.title &&
        (media.title.english ||
          media.title.userPreferred ||
          media.title.romaji)) ||
      `#${id}`;

    const items = [tray.text(`Manga: ${title}`)];
    if (link) {
      // "Linked: X (source)" sits next to an Unlink button so the
      // remove action is co-located with the linked-state indicator.
      items.push(
        tray.flex(
          [
            tray.text(
              "Linked: " +
                (link.seriesTitle || `#${link.seriesId}`) +
                " (" +
                link.source +
                ")",
              {
                style: { flex: "1", minWidth: "0" },
              },
            ),
            tray.button("Unlink", {
              onClick: "mu-clear-link",
              intent: "alert-subtle",
              size: "sm",
            }),
          ],
          { gap: 2, style: { alignItems: "center" } },
        ),
      );
    } else {
      items.push(tray.text("Not linked yet."));
    }
    items.push(
      tray.input("Search MangaUpdates", { fieldRef: searchInputRef }),
      tray.button(isSearching.get() ? "Searching..." : "Search", {
        onClick: "mu-do-search",
        intent: "primary",
      }),
    );

    // "Search as:" shortcuts for the remaining AniList titles, deduped
    // and minus whatever is already in the input box. MU often indexes
    // a series under its romaji or original title only, so giving the
    // user one click to retry is much faster than retyping.
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
    const currentInput = (searchInputRef.current || "").trim();
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
      const altRow = tray.flex(
        altTitles.map((t) =>
          tray.button(`Search as ${t.label}`, {
            onClick: ctx.eventHandler(`mu-search-as-${t.label}`, () => {
              searchInputRef.setValue(t.value);
              runSearch(t.value).catch((e) =>
                console.error("[mangaupdates-sync] alt search failed:", e),
              );
            }),
            intent: "gray-subtle",
            size: "sm",
          }),
        ),
        { gap: 1, style: { flexWrap: "wrap" } },
      );
      items.push(altRow);
    }
    const results = searchResults.get();
    if (results.length > 0) {
      items.push(tray.text("Pick the matching series:"));
      for (const r of results) {
        const titleLine = r.title + (r.year ? ` (${r.year})` : "");
        const subLine = `#${r.id}`;
        // Official MangaUpdates series page, so the user can open it and
        // confirm the match before picking. Falls back to the legacy
        // id-query URL when the search record didn't include a `url`.
        const openUrl =
          r.url || `https://www.mangaupdates.com/series.html?id=${r.id}`;
        const row = tray.flex(
          [
            r.cover
              ? tray.img({
                  src: r.cover,
                  style: {
                    width: "44px",
                    height: "62px",
                    objectFit: "cover",
                    borderRadius: "4px",
                    flexShrink: "0",
                  },
                })
              : tray.div([], {
                  style: {
                    width: "44px",
                    height: "62px",
                    background: "rgba(255,255,255,0.05)",
                    borderRadius: "4px",
                    flexShrink: "0",
                  },
                }),
            tray.stack(
              [
                tray.text(titleLine, { style: { fontWeight: "600" } }),
                tray.flex(
                  [
                    // `tray.span` (not `tray.text`) — text renders as a
                    // `w-full` <p>, which would stretch and shove the link to
                    // the far edge. span is inline so the id + link sit
                    // together on the left.
                    tray.span(subLine, {
                      style: { opacity: "0.6", fontSize: "0.8rem" },
                    }),
                    tray.a([tray.span("Open ↗")], {
                      href: openUrl,
                      target: "_blank",
                      rel: "noopener noreferrer",
                      style: {
                        fontSize: "0.8rem",
                        opacity: "0.85",
                        textDecoration: "underline",
                        whiteSpace: "nowrap",
                      },
                    }),
                  ],
                  { gap: 3, style: { alignItems: "center" } },
                ),
              ],
              { style: { flex: "1", minWidth: "0" } },
            ),
            link && link.seriesId === r.id
              ? tray.button("Linked", {
                  // Already the current link — give explicit visual
                  // feedback (success intent + pointer-events off so
                  // the button looks/feels disabled). No onClick.
                  intent: "success-subtle",
                  size: "sm",
                  style: { opacity: "0.7", pointerEvents: "none" },
                })
              : tray.button("Pick", {
                  // ctx.eventHandler with a unique id key per item is the
                  // documented pattern for inline handlers (Tray doc).
                  onClick: ctx.eventHandler(`mu-pick-${r.id}`, () => {
                    const linkValue: MULink = {
                      seriesId: r.id,
                      seriesTitle: r.title,
                      seriesUrl: r.url,
                      seriesCover: r.cover,
                      linkedAt: Date.now(),
                      source: "manual",
                    };
                    $storage.set(`mu_link_${id}`, linkValue);
                    ctx.toast.success(`Linked to ${r.title}`);
                    searchResults.set([]);
                    // Re-render the button label
                    currentMediaId.set(id);
                    // Re-run the icon observer so the MU icon
                    // appears next to the AL one immediately.
                    refetchEntryPage();
                    tray.close();
                    // Fire-and-forget: mirror the current AL
                    // listData (status / progress / score) to
                    // MU right away, so the user doesn't have
                    // to re-save the AL entry just to seed MU.
                    syncStatsToMU(id)
                      .then((pushed) => {
                        if (pushed)
                          ctx.toast.info("Stats synced to MangaUpdates");
                      })
                      .catch((err) => {
                        console.error(
                          "[mangaupdates-sync] link-time sync failed:",
                          err,
                        );
                        const msg =
                          err instanceof Error ? err.message : String(err);
                        ctx.toast.alert(`Sync failed: ${msg}`);
                      });
                  }),
                  intent: "primary-subtle",
                  size: "sm",
                }),
          ],
          { gap: 2, style: { alignItems: "center", padding: "6px 0" } },
        );
        items.push(row);
      }
    }
    return tray.stack(items);
  });
};
