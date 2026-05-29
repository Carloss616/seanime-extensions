// src/plugins/mangaupdates-sync/modules/on-post-update-entry.ts
var onPostUpdateEntry = (...args) => {
  class MUTokenExpiredError extends Error {
    constructor() {
      super("MU session expired");
      this.name = "MUTokenExpiredError";
    }
  }

  class MUClient {
    constructor(fetchFn) {
      this.base = "https://api.mangaupdates.com/v1";
      this.tokenKey = "mu_session_token";
      this.statusList = {
        CURRENT: 0,
        PLANNING: 1,
        COMPLETED: 2,
        DROPPED: 3,
        PAUSED: 4,
        REPEATING: 0,
      };
      this.fetchFn = fetchFn;
    }
    async req(token, method, path, body) {
      const headers = { Accept: "application/json" };
      if (token) headers.Authorization = `Bearer ${token}`;
      if (body !== undefined) headers["Content-Type"] = "application/json";
      const res = await this.fetchFn(this.base + path, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      if (res.status === 401) throw new MUTokenExpiredError();
      if (!res.ok) {
        throw new Error(`MU ${method} ${path} -> ${res.status} ${res.text()}`);
      }
      if ((res.contentType || "").includes("application/json"))
        return res.json();
      return null;
    }
    async login(username, password) {
      const res = await this.fetchFn(`${this.base}/account/login`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        throw new Error(`MU login -> ${res.status} ${res.text()}`);
      }
      const data = res.json();
      const token =
        data?.context?.session_token || data?.session_token || data?.token;
      if (!token) throw new Error("MU login: response missing session token");
      return token;
    }
    async ensureToken() {
      let token = $storage.get(this.tokenKey) || "";
      const username = $getUserPreference("username") || "";
      const password = $getUserPreference("password") || "";
      if (!token) {
        if (!username || !password) {
          throw new Error(
            "Missing MangaUpdates credentials in plugin settings.",
          );
        }
        token = await this.login(username, password);
        $storage.set(this.tokenKey, token);
        return token;
      }
      try {
        await this.req(token, "GET", "/account/profile");
        return token;
      } catch (err) {
        if (!(err instanceof MUTokenExpiredError)) throw err;
        if (!username || !password) {
          $storage.remove(this.tokenKey);
          throw new Error(
            "MangaUpdates session expired and no credentials to re-login.",
          );
        }
        token = await this.login(username, password);
        $storage.set(this.tokenKey, token);
        return token;
      }
    }
    async pushListEntry(token, seriesId, payload) {
      const item = { series: { id: seriesId } };
      if (payload.status != null) {
        const mapped = this.statusList[payload.status];
        item.list_id = mapped !== undefined ? mapped : this.statusList.CURRENT;
      }
      if (payload.progress !== undefined) {
        item.status = { chapter: payload.progress };
      }
      try {
        await this.req(token, "POST", "/lists/series/update", [item]);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.indexOf("isn't on your list") >= 0) {
          await this.req(token, "POST", "/lists/series", [item]);
        } else {
          throw err;
        }
      }
    }
    async pushRating(token, seriesId, scoreRaw) {
      if (scoreRaw <= 0) return;
      const rating = Math.min(10, Math.max(0, Math.round(scoreRaw) / 10));
      try {
        await this.req(token, "PUT", `/series/${seriesId}/rating`, { rating });
      } catch (err) {
        console.warn("[mangaupdates-sync] rating push failed:", err);
      }
    }
  }
  var onPostUpdateEntry2 = (event) => {
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
        const EXT_ID_OFFSET = 2147483648;
        const LOCAL_ID_RANGE = 1099511627776;
        let manga;
        try {
          manga = $anilist.getManga(mediaId);
        } catch (_) {
          manga = undefined;
        }
        const mu = new MUClient((url, init) => fetch(url, init));
        const token = await mu.ensureToken();
        let externalId;
        if (mediaId >= EXT_ID_OFFSET) {
          const siteUrl = manga?.siteUrl;
          if (
            siteUrl &&
            siteUrl.indexOf("ext_custom_source_mangaupdates|END|") === 0
          ) {
            const localId = (mediaId - EXT_ID_OFFSET) % LOCAL_ID_RANGE;
            if (localId > 0) {
              externalId = String(localId);
              console.log(
                `[mangaupdates-sync] custom-source mangaupdates media ${mediaId} -> series_id=${externalId}`,
              );
            }
          }
        }
        if (!externalId) {
          const link = $storage.get(`mu_link_${mediaId}`);
          if (link?.seriesId) externalId = link.seriesId;
        }
        if (
          !externalId &&
          ($getUserPreference("autoMatchFallback") ?? "false") === "true"
        ) {
          const title =
            manga?.title &&
            (manga.title.english ||
              manga.title.romaji ||
              manga.title.userPreferred);
          if (title) {
            const data = await mu.req(token, "POST", "/series/search", {
              search: title,
              perpage: 25,
            });
            const sid = data?.results?.[0]?.record?.series_id;
            if (sid) {
              externalId = String(sid);
              $storage.set(`mu_link_${mediaId}`, {
                seriesId: externalId,
                linkedAt: Date.now(),
                source: "auto",
              });
            }
          }
        }
        if (!externalId) {
          console.warn(
            `[mangaupdates-sync] no MU link for media ${mediaId} — open the entry page and click 'Link to MangaUpdates' to set one. Alternatively enable 'Auto-match fallback' in plugin settings.`,
          );
          return;
        }
        const seriesIdNum = Number(externalId);
        await mu.pushListEntry(token, seriesIdNum, {
          status: update.status,
          progress: update.progress,
        });
        const syncScore =
          ($getUserPreference("syncScore") ?? "true") !== "false";
        if (syncScore && update.scoreRaw != null) {
          await mu.pushRating(token, seriesIdNum, update.scoreRaw);
        }
        console.log(
          `[mangaupdates-sync] pushed media ${mediaId} -> MU ${externalId} (status=${update.status || "-"} chapter=${update.progress != null ? update.progress : "-"} score=${update.scoreRaw != null ? update.scoreRaw : "-"})`,
        );
      })().catch((err) => {
        console.error(
          `[mangaupdates-sync] push failed for media ${mediaId}:`,
          err,
        );
      });
    } catch (e) {
      console.error("[mangaupdates-sync] post hook error:", e);
    }
    event.next();
  };
  return onPostUpdateEntry2(...args);
};

// src/plugins/mangaupdates-sync/modules/on-pre-update-entry.ts
var onPreUpdateEntry = (...args) => {
  var onPreUpdateEntry2 = (event) => {
    try {
      const auto =
        ($getUserPreference("autoSyncOnProgress") ?? "true") !== "false";
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
        ...("scoreRaw" in event ? { scoreRaw: event.scoreRaw } : {}),
      });
    } catch (e) {
      console.error("[mangaupdates-sync] pre-edit error:", e);
    }
    event.next();
  };
  return onPreUpdateEntry2(...args);
};

// src/plugins/mangaupdates-sync/modules/register.ts
var register = (...args) => {
  var GITHUB_RAW_WORKSPACE =
    "https://raw.githubusercontent.com/Carloss616/seanime-extensions/main";

  class MUTokenExpiredError extends Error {
    constructor() {
      super("MU session expired");
      this.name = "MUTokenExpiredError";
    }
  }

  class MUClient {
    constructor(fetchFn) {
      this.base = "https://api.mangaupdates.com/v1";
      this.tokenKey = "mu_session_token";
      this.statusList = {
        CURRENT: 0,
        PLANNING: 1,
        COMPLETED: 2,
        DROPPED: 3,
        PAUSED: 4,
        REPEATING: 0,
      };
      this.fetchFn = fetchFn;
    }
    async req(token, method, path, body) {
      const headers = { Accept: "application/json" };
      if (token) headers.Authorization = `Bearer ${token}`;
      if (body !== undefined) headers["Content-Type"] = "application/json";
      const res = await this.fetchFn(this.base + path, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      if (res.status === 401) throw new MUTokenExpiredError();
      if (!res.ok) {
        throw new Error(`MU ${method} ${path} -> ${res.status} ${res.text()}`);
      }
      if ((res.contentType || "").includes("application/json"))
        return res.json();
      return null;
    }
    async login(username, password) {
      const res = await this.fetchFn(`${this.base}/account/login`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        throw new Error(`MU login -> ${res.status} ${res.text()}`);
      }
      const data = res.json();
      const token =
        data?.context?.session_token || data?.session_token || data?.token;
      if (!token) throw new Error("MU login: response missing session token");
      return token;
    }
    async ensureToken() {
      let token = $storage.get(this.tokenKey) || "";
      const username = $getUserPreference("username") || "";
      const password = $getUserPreference("password") || "";
      if (!token) {
        if (!username || !password) {
          throw new Error(
            "Missing MangaUpdates credentials in plugin settings.",
          );
        }
        token = await this.login(username, password);
        $storage.set(this.tokenKey, token);
        return token;
      }
      try {
        await this.req(token, "GET", "/account/profile");
        return token;
      } catch (err) {
        if (!(err instanceof MUTokenExpiredError)) throw err;
        if (!username || !password) {
          $storage.remove(this.tokenKey);
          throw new Error(
            "MangaUpdates session expired and no credentials to re-login.",
          );
        }
        token = await this.login(username, password);
        $storage.set(this.tokenKey, token);
        return token;
      }
    }
    async pushListEntry(token, seriesId, payload) {
      const item = { series: { id: seriesId } };
      if (payload.status != null) {
        const mapped = this.statusList[payload.status];
        item.list_id = mapped !== undefined ? mapped : this.statusList.CURRENT;
      }
      if (payload.progress !== undefined) {
        item.status = { chapter: payload.progress };
      }
      try {
        await this.req(token, "POST", "/lists/series/update", [item]);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.indexOf("isn't on your list") >= 0) {
          await this.req(token, "POST", "/lists/series", [item]);
        } else {
          throw err;
        }
      }
    }
    async pushRating(token, seriesId, scoreRaw) {
      if (scoreRaw <= 0) return;
      const rating = Math.min(10, Math.max(0, Math.round(scoreRaw) / 10));
      try {
        await this.req(token, "PUT", `/series/${seriesId}/rating`, { rating });
      } catch (err) {
        console.warn("[mangaupdates-sync] rating push failed:", err);
      }
    }
  }
  var register2 = (ctx) => {
    const tray = ctx.newTray({
      tooltipText: "MangaUpdates Sync — linking",
      iconUrl: `${GITHUB_RAW_WORKSPACE}/src/plugins/mangaupdates-sync/assets/icon.png`,
      withContent: true,
    });
    const currentMediaId = ctx.state(0);
    const searchInputRef = ctx.fieldRef("");
    const searchResults = ctx.state([]);
    const isSearching = ctx.state(false);
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
    const btn = ctx.action.newMangaPageButton({
      label: "Link to MangaUpdates",
      intent: "primary-subtle",
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
      if (
        media?.siteUrl &&
        media.siteUrl.indexOf("ext_custom_source_mangaupdates|END|") === 0
      ) {
        btn.unmount();
        tray.updateBadge({ number: 0 });
        return;
      }
      btn.mount();
      const link = $storage.get(`mu_link_${id}`);
      if (!link) {
        btn.setLabel("Link to MangaUpdates");
        tray.updateBadge({ number: 0 });
      } else if (link.source === "manual") {
        btn.setLabel(`Linked: ${link.seriesTitle || `#${link.seriesId}`}`);
        tray.updateBadge({ number: 0 });
      } else {
        btn.setLabel("Linked: ? (verify)");
        tray.updateBadge({ number: 1, intent: "warning" });
      }
    }, [currentMediaId]);
    const MU_ICON_KEY = "mu";
    const MU_ICON_SVG =
      '<svg stroke="currentColor" fill="currentColor" stroke-width="0" role="img" viewBox="0 0 24 24" class="text-lg" height="1em" width="1em" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M0.5,21 L0.5,3 L4.5,3 L7.5,11 L10.5,3 L14.5,3 L14.5,21 L11.5,21 L11.5,11.5 L8.5,17 L6.5,17 L3.5,11.5 L3.5,21 Z M16.5,21 L16.5,3 L18.5,3 L18.5,17 L21.5,17 L21.5,3 L23.5,3 L23.5,21 Z"/>' +
      "</svg>";
    const resolveMULink = (mediaId) => {
      let media;
      try {
        media = $anilist.getManga(mediaId);
      } catch (_) {
        media = undefined;
      }
      if (!media) return {};
      const customPrefix = "ext_custom_source_mangaupdates|END|";
      if (media.siteUrl && media.siteUrl.indexOf(customPrefix) === 0) {
        return {};
      }
      const link = $storage.get(`mu_link_${mediaId}`);
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
        let mediaId;
        try {
          const raw = (await el.getDataAttribute("media")) ?? "{}";
          const data = JSON.parse(raw);
          if (typeof data.id === "number") mediaId = data.id;
        } catch (_) {}
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
        a.setInnerHTML(
          `<button type="button" class="UI-Button_root whitespace-nowrap font-semibold rounded-lg inline-flex items-center transition ease-in text-center justify-center focus-visible:outline-none focus-visible:ring-2 ring-offset-1 ring-offset-[--background] focus-visible:ring-[--ring] disabled:opacity-50 disabled:pointer-events-none shadow-none text-[--gray] border border-transparent bg-transparent hover:underline active:text-gray-700 dark:text-gray-300 dark:active:text-gray-200 UI-IconButton_root p-0 flex-none text-xl h-8 w-8 px-0"><span class="md:inline-block">${MU_ICON_SVG}</span></button>`,
        );
        ctx.dom.asElement(btnALId).after(a);
      },
      { withInnerHTML: true, identifyChildren: true },
    );
    const mu = new MUClient((url, init) => ctx.fetch(url, init));
    async function syncStatsToMU(mediaId) {
      const link = $storage.get(`mu_link_${mediaId}`);
      if (!link?.seriesId) return false;
      let listData;
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
    async function runSearch(query) {
      const q = (query || "").trim();
      if (q.length < 2) {
        searchResults.set([]);
        return;
      }
      isSearching.set(true);
      try {
        const token = $storage.get("mu_session_token") || "";
        const headers = {
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
        const data = res.json();
        const out = [];
        const arr = data?.results || [];
        for (const r of arr) {
          const sid = r?.record?.series_id;
          if (!sid) continue;
          const rec = r.record;
          const year = rec.year ? parseInt(rec.year, 10) : undefined;
          out.push({
            id: String(sid),
            title: rec.title || "(untitled)",
            year: !Number.isNaN(year) ? year : undefined,
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
      currentMediaId.set(id);
      refetchEntryPage();
    });
    btn.onClick(async (event) => {
      const media = event.media;
      if (!media) return;
      if (media.id) currentMediaId.set(media.id);
      const title =
        (media.title &&
          (media.title.english ||
            media.title.romaji ||
            media.title.userPreferred)) ||
        "";
      searchInputRef.setValue(title);
      const existingLink = media.id
        ? $storage.get(`mu_link_${media.id}`)
        : undefined;
      if (!existingLink) {
        await runSearch(title);
      } else {
        searchResults.set([]);
      }
      try {
        tray.open();
      } catch (_) {
        ctx.toast.info(
          "Pin the MangaUpdates Sync tray icon to open the linker.",
        );
      }
    });
    btn.mount();
    tray.render(() => {
      const id = currentMediaId.get();
      if (!id) {
        return tray.stack([
          tray.text("Open a manga entry page to link it to MangaUpdates."),
        ]);
      }
      let media;
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
      const link = $storage.get(`mu_link_${id}`);
      const title =
        (media.title &&
          (media.title.english ||
            media.title.userPreferred ||
            media.title.romaji)) ||
        `#${id}`;
      const items = [tray.text(`Manga: ${title}`)];
      if (link) {
        items.push(
          tray.flex(
            [
              tray.text(
                `Linked: ${link.seriesTitle || `#${link.seriesId}`} (${link.source})`,
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
      const allTitles = [];
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
      const seen = {};
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
                    intent: "success-subtle",
                    size: "sm",
                    style: { opacity: "0.7", pointerEvents: "none" },
                  })
                : tray.button("Pick", {
                    onClick: ctx.eventHandler(`mu-pick-${r.id}`, () => {
                      const linkValue = {
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
                      currentMediaId.set(id);
                      refetchEntryPage();
                      tray.close();
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
  return register2(...args);
};

// src/plugins/mangaupdates-sync/code.ts
function init() {
  $app.onPreUpdateEntryProgress(onPreUpdateEntry);
  $app.onPreUpdateEntry(onPreUpdateEntry);
  $app.onPostUpdateEntryProgress(onPostUpdateEntry);
  $app.onPostUpdateEntry(onPostUpdateEntry);
  console.log("[mangaupdates-sync] initialized");
  $ui.register(register);
}
