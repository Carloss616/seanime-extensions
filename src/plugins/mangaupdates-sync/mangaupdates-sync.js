function init() {
  $app.onPreUpdateEntryProgress((event) => {
    var _a;
    try {
      const auto = ((_a = $getUserPreference("autoSyncOnProgress")) != null ? _a : "true") !== "false";
      if (!auto || event.mediaId == null || event.progress == null) {
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
      $store.set("mu_pending_" + event.mediaId, {
        progress: event.progress,
        status: event.status || "CURRENT"
      });
    } catch (e) {
      console.error("[mangaupdates-sync] pre-progress error:", e);
    }
    event.next();
  });
  $app.onPreUpdateEntry((event) => {
    var _a;
    try {
      const auto = ((_a = $getUserPreference("autoSyncOnProgress")) != null ? _a : "true") !== "false";
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
      $store.set("mu_pending_" + event.mediaId, {
        status: event.status,
        progress: event.progress,
        scoreRaw: event.scoreRaw
      });
    } catch (e) {
      console.error("[mangaupdates-sync] pre-edit error:", e);
    }
    event.next();
  });
  const onPost = (event) => {
    try {
      const mediaId = event.mediaId;
      if (mediaId == null) {
        event.next();
        return;
      }
      const key = "mu_pending_" + mediaId;
      const update = $store.get(key);
      if (!update) {
        event.next();
        return;
      }
      $store.remove(key);
      (async () => {
        var _a, _b, _c, _d, _e;
        const MU_API_BASE = "https://api.mangaupdates.com/v1";
        const TOKEN_KEY = "mu_session_token";
        const CACHE_KEY = "mu_external_id_cache";
        const EXT_ID_OFFSET = 2147483648;
        const LOCAL_ID_RANGE = 1099511627776;
        const CUSTOM_PREFIX = "ext_custom_source_mangaupdates|END|";
        const STATUS_LIST = {
          CURRENT: 0,
          // Reading
          PLANNING: 1,
          // Wish
          COMPLETED: 2,
          // Complete
          DROPPED: 3,
          // Unfinished
          PAUSED: 4,
          // On-Hold
          REPEATING: 0
          // Reading (MU has no separate re-read list)
        };
        class TokenExpiredError extends Error {
          constructor() {
            super("MU session expired");
            this.name = "TokenExpiredError";
          }
        }
        const reqMU = async (token2, method, path, body) => {
          const headers = {
            Accept: "application/json"
          };
          if (token2) headers["Authorization"] = "Bearer " + token2;
          if (body !== void 0)
            headers["Content-Type"] = "application/json";
          const res = await fetch(MU_API_BASE + path, {
            method,
            headers,
            body: body !== void 0 ? JSON.stringify(body) : void 0
          });
          if (res.status === 401) throw new TokenExpiredError();
          if (!res.ok) {
            throw new Error(
              "MU " + method + " " + path + " -> " + res.status + " " + res.text()
            );
          }
          if ((res.contentType || "").includes("application/json"))
            return res.json();
          return null;
        };
        const muLogin = async (username, password) => {
          var _a2, _b2, _c2;
          const res = await fetch(
            MU_API_BASE + "/account/login",
            {
              method: "PUT",
              headers: {
                "Content-Type": "application/json",
                Accept: "application/json"
              },
              body: JSON.stringify({ username, password })
            }
          );
          if (!res.ok) {
            throw new Error(
              "MU login -> " + res.status + " " + res.text()
            );
          }
          const data = res.json();
          const token2 = (_c2 = (_b2 = (_a2 = data == null ? void 0 : data.context) == null ? void 0 : _a2.session_token) != null ? _b2 : data == null ? void 0 : data.session_token) != null ? _c2 : data == null ? void 0 : data.token;
          if (!token2)
            throw new Error(
              "MU login: response missing session token"
            );
          return token2;
        };
        const ensureToken = async () => {
          let token2 = $storage.get(TOKEN_KEY) || "";
          const username = $getUserPreference("username") || "";
          const password = $getUserPreference("password") || "";
          if (!token2) {
            if (!username || !password) {
              throw new Error(
                "MangaUpdates: missing credentials and no stored session token"
              );
            }
            token2 = await muLogin(username, password);
            $storage.set(TOKEN_KEY, token2);
            return token2;
          }
          try {
            await reqMU(token2, "GET", "/account/profile");
            return token2;
          } catch (err) {
            if (!(err instanceof TokenExpiredError)) throw err;
            if (!username || !password) {
              $storage.remove(TOKEN_KEY);
              throw new Error(
                "MangaUpdates: session expired and no stored password to re-login"
              );
            }
            token2 = await muLogin(username, password);
            $storage.set(TOKEN_KEY, token2);
            return token2;
          }
        };
        let manga;
        try {
          manga = $anilist.getManga(mediaId);
        } catch (_) {
          manga = void 0;
        }
        const token = await ensureToken();
        let externalId;
        if (mediaId >= EXT_ID_OFFSET) {
          const siteUrl = manga && manga.siteUrl;
          if (siteUrl && siteUrl.indexOf(CUSTOM_PREFIX) === 0) {
            const localId = (mediaId - EXT_ID_OFFSET) % LOCAL_ID_RANGE;
            if (localId > 0) {
              externalId = String(localId);
              console.log(
                "[mangaupdates-sync] custom-source mangaupdates media " + mediaId + " -> series_id=" + externalId
              );
            }
          }
        }
        if (!externalId) {
          const cache = $storage.get(CACHE_KEY) || {};
          externalId = cache[String(mediaId)];
        }
        if (!externalId) {
          const title = manga && manga.title && (manga.title.romaji || manga.title.english || manga.title.userPreferred);
          if (title) {
            const data = await reqMU(
              token,
              "POST",
              "/series/search",
              { search: title, perpage: 25 }
            );
            const results = (_a = data == null ? void 0 : data.results) != null ? _a : [];
            const sid = (_c = (_b = results[0]) == null ? void 0 : _b.record) == null ? void 0 : _c.series_id;
            if (sid) {
              externalId = String(sid);
              const cache = $storage.get(
                CACHE_KEY
              ) || {};
              cache[String(mediaId)] = externalId;
              $storage.set(CACHE_KEY, cache);
            }
          }
        }
        if (!externalId) {
          console.warn(
            "[mangaupdates-sync] no MU mapping for media " + mediaId + "; skipping push"
          );
          return;
        }
        const syncScore = ((_d = $getUserPreference("syncScore")) != null ? _d : "true") !== "false";
        const listId = update.status != null ? (_e = STATUS_LIST[update.status]) != null ? _e : STATUS_LIST.CURRENT : void 0;
        let rating;
        if (syncScore && update.scoreRaw != null && update.scoreRaw > 0) {
          rating = Math.min(
            10,
            Math.max(0, Math.round(update.scoreRaw) / 10)
          );
        }
        const seriesIdNum = Number(externalId);
        const item = { series: { id: seriesIdNum } };
        if (listId !== void 0) item.list_id = listId;
        if (update.progress !== void 0)
          item.status = { chapter: update.progress };
        try {
          await reqMU(
            token,
            "POST",
            "/lists/series/update",
            [item]
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.indexOf("isn't on your list") >= 0) {
            await reqMU(
              token,
              "POST",
              "/lists/series",
              [item]
            );
          } else {
            throw err;
          }
        }
        if (rating !== void 0) {
          try {
            await reqMU(
              token,
              "PUT",
              "/series/" + seriesIdNum + "/rating",
              { rating }
            );
          } catch (err) {
            console.warn(
              "[mangaupdates-sync] rating push failed for media " + mediaId + ":",
              err
            );
          }
        }
        console.log(
          "[mangaupdates-sync] pushed media " + mediaId + " -> MU " + externalId + " (list=" + (listId != null ? listId : "-") + " chapter=" + (update.progress != null ? update.progress : "-") + " rating=" + (rating != null ? rating : "-") + ")"
        );
      })().catch((err) => {
        console.error(
          "[mangaupdates-sync] push failed for media " + mediaId + ":",
          err
        );
      });
    } catch (e) {
      console.error("[mangaupdates-sync] post hook error:", e);
    }
    event.next();
  };
  $app.onPostUpdateEntryProgress(onPost);
  $app.onPostUpdateEntry(onPost);
  console.log("[mangaupdates-sync] initialized");
}
