// src/plugins/local-catalog-manager/modules/on-get-manga-collection.ts
var onGetMangaCollection = (...args) => {
  var SHARED_LIB_NAME = "local-catalog-manager";
  var PROGRESS_FILENAME = "seanime-local-progress.json";
  var K_GIST = "lcm_gist_id";
  var K_PROGRESS = "lcm_progress";
  var K_PROGRESS_UPDATED = "lcm_progress_updated_at";
  var K_SYNC_PAUSED = "lcm_sync_paused";
  var K_EXT_ID = "lcm_ext_id";
  var onGetMangaCollection2 = (event) => {
    (async () => {
      const {
        createLogger,
        GistClient,
        parseProgress,
        mergeProgress,
        progressMangaEquals,
        serializeProgress,
        encodeMediaId,
      } = $shared.use(SHARED_LIB_NAME);
      const log = createLogger();
      try {
        const COOLDOWN_KEY = "lcm:silent-sync-at";
        const COOLDOWN_MS = 1e4;
        const lastAt = $store.get(COOLDOWN_KEY) ?? 0;
        const now = Date.now();
        if (now - lastAt < COOLDOWN_MS) return;
        $store.set(COOLDOWN_KEY, now);
        const token = ($getUserPreference("githubToken") ?? "").trim();
        const gistId = $storage.get(K_GIST) ?? "";
        if (!token || !gistId) return;
        if ($storage.get(K_SYNC_PAUSED)) return;
        const client = new GistClient(token, fetch);
        const local = parseProgress($storage.get(K_PROGRESS), log);
        let remoteStr = "";
        try {
          remoteStr = await client.getGistFile(gistId, PROGRESS_FILENAME);
        } catch (_) {
          remoteStr = "";
        }
        const remote = parseProgress(remoteStr, log);
        const merged = mergeProgress(local, remote, now);
        const extId = $storage.get(K_EXT_ID);
        let applied = 0;
        if (extId != null) {
          for (const [localIdStr, entry] of Object.entries(merged.manga)) {
            const before = local.manga[localIdStr];
            if (before && (before.updatedAt ?? 0) >= (entry.updatedAt ?? 0)) {
              continue;
            }
            const localId = Number(localIdStr);
            if (!Number.isFinite(localId)) continue;
            const mediaId = encodeMediaId(extId, localId);
            $store.set(`progress:skip:${mediaId}`, true);
            try {
              $anilist.updateEntry(
                mediaId,
                entry.status,
                entry.score,
                entry.progress,
                undefined,
                undefined,
              );
              applied++;
            } catch (e) {
              log.warn(`hook apply failed for localId ${localIdStr}:`, e);
            } finally {
              $store.remove(`progress:skip:${mediaId}`);
            }
          }
        }
        if (!progressMangaEquals(merged.manga, remote.manga)) {
          await client.updateGistFile(
            gistId,
            PROGRESS_FILENAME,
            serializeProgress(merged),
          );
        }
        $storage.set(K_PROGRESS, merged);
        $storage.set(K_PROGRESS_UPDATED, now);
        if (applied > 0) {
          try {
            $anilist.refreshMangaCollection();
          } catch (e) {
            log.warn("refreshMangaCollection failed:", e);
          }
          try {
            $app.invalidateClientQuery([
              "MANGA-get-manga-collection",
              "MANGA-get-anilist-manga-collection",
              "MANGA-get-manga-entry",
            ]);
          } catch (e) {
            log.warn("invalidateClientQuery failed:", e);
          }
        }
      } catch (e) {
        log.warn("on-get-manga-collection sync failed:", e);
      }
    })();
    event.next();
  };
  return onGetMangaCollection2(...args);
};

// src/plugins/local-catalog-manager/modules/on-post-update-entry.ts
var onPostUpdateEntry = (...args) => {
  var SHARED_LIB_NAME = "local-catalog-manager";
  var PROGRESS_FILENAME = "seanime-local-progress.json";
  var K_GIST = "lcm_gist_id";
  var K_PROGRESS = "lcm_progress";
  var K_PROGRESS_UPDATED = "lcm_progress_updated_at";
  var K_SYNC_PAUSED = "lcm_sync_paused";
  var onPostUpdateEntry2 = (event) => {
    const {
      createLogger,
      GistClient,
      decodeLocalId,
      handlePostUpdate,
      parseProgress,
    } = $shared.use(SHARED_LIB_NAME);
    const log = createLogger();
    try {
      if (event.mediaId == null) {
        event.next();
        return;
      }
      const key = `progress:${event.mediaId}`;
      const payload = $store.get(key);
      if (!payload) {
        event.next();
        return;
      }
      $store.remove(key);
      const localId = decodeLocalId(event.mediaId);
      const now = Date.now();
      const local = parseProgress($storage.get(K_PROGRESS), log);
      const token = ($getUserPreference("githubToken") ?? "").trim();
      const gistId = $storage.get(K_GIST) ?? "";
      const syncPaused = $storage.get(K_SYNC_PAUSED) ?? false;
      const client =
        !syncPaused && token && gistId ? new GistClient(token, fetch) : null;
      const mediaId = event.mediaId;
      if (syncPaused && token && gistId) {
        const notifiedKey = "lcm:drift-notified";
        if (!$store.get(notifiedKey)) {
          $store.set(notifiedKey, true);
          log.warn(
            "catalog drift pending — saved locally only. Resolve in tray.",
          );
        }
      }
      handlePostUpdate({
        mediaId,
        localId,
        payload,
        now,
        local,
        client,
        gistId,
        filename: PROGRESS_FILENAME,
        applyToSeanime: (entry) => {
          $store.set(`progress:skip:${mediaId}`, true);
          try {
            $anilist.updateEntry(
              mediaId,
              entry.status,
              entry.score,
              entry.progress,
              undefined,
              undefined,
            );
          } finally {
            $store.remove(`progress:skip:${mediaId}`);
          }
        },
        persistLocal: (doc, updatedAt) => {
          $storage.set(K_PROGRESS, doc);
          $storage.set(K_PROGRESS_UPDATED, updatedAt);
        },
      }).catch((e) => {
        log.warn("post-update-entry sync failed:", e);
      });
    } catch (e) {
      log.error("post-update-entry error:", e);
    }
    event.next();
  };
  return onPostUpdateEntry2(...args);
};

// src/plugins/local-catalog-manager/modules/on-post-update-entry-progress.ts
var onPostUpdateEntryProgress = (...args) => {
  var SHARED_LIB_NAME = "local-catalog-manager";
  var PROGRESS_FILENAME = "seanime-local-progress.json";
  var K_GIST = "lcm_gist_id";
  var K_PROGRESS = "lcm_progress";
  var K_PROGRESS_UPDATED = "lcm_progress_updated_at";
  var K_SYNC_PAUSED = "lcm_sync_paused";
  var onPostUpdateEntryProgress2 = (event) => {
    const {
      createLogger,
      GistClient,
      decodeLocalId,
      handlePostUpdate,
      parseProgress,
    } = $shared.use(SHARED_LIB_NAME);
    const log = createLogger();
    try {
      if (event.mediaId == null) {
        event.next();
        return;
      }
      const key = `progress:${event.mediaId}`;
      const payload = $store.get(key);
      if (!payload) {
        event.next();
        return;
      }
      $store.remove(key);
      const localId = decodeLocalId(event.mediaId);
      const now = Date.now();
      const local = parseProgress($storage.get(K_PROGRESS), log);
      const token = ($getUserPreference("githubToken") ?? "").trim();
      const gistId = $storage.get(K_GIST) ?? "";
      const syncPaused = $storage.get(K_SYNC_PAUSED) ?? false;
      const client =
        !syncPaused && token && gistId ? new GistClient(token, fetch) : null;
      const mediaId = event.mediaId;
      if (syncPaused && token && gistId) {
        const notifiedKey = "lcm:drift-notified";
        if (!$store.get(notifiedKey)) {
          $store.set(notifiedKey, true);
          log.warn(
            "catalog drift pending — saved locally only. Resolve in tray.",
          );
        }
      }
      handlePostUpdate({
        mediaId,
        localId,
        payload,
        now,
        local,
        client,
        gistId,
        filename: PROGRESS_FILENAME,
        applyToSeanime: (entry) => {
          $store.set(`progress:skip:${mediaId}`, true);
          try {
            $anilist.updateEntry(
              mediaId,
              entry.status,
              entry.score,
              entry.progress,
              undefined,
              undefined,
            );
          } finally {
            $store.remove(`progress:skip:${mediaId}`);
          }
        },
        persistLocal: (doc, updatedAt) => {
          $storage.set(K_PROGRESS, doc);
          $storage.set(K_PROGRESS_UPDATED, updatedAt);
        },
      }).catch((e) => {
        log.warn("post-update-entry-progress sync failed:", e);
      });
    } catch (e) {
      log.error("post-update-entry-progress error:", e);
    }
    event.next();
  };
  return onPostUpdateEntryProgress2(...args);
};

// src/plugins/local-catalog-manager/modules/on-pre-update-entry.ts
var onPreUpdateEntry = (...args) => {
  var SHARED_LIB_NAME = "local-catalog-manager";
  var SOURCE_PREFIX = "ext_custom_source_local-catalog";
  var onPreUpdateEntry2 = (event) => {
    const { createLogger, decodeLocalId } = $shared.use(SHARED_LIB_NAME);
    const log = createLogger();
    try {
      if (event.mediaId == null) {
        event.next();
        return;
      }
      if ($store.has(`progress:skip:${event.mediaId}`)) {
        event.next();
        return;
      }
      let m = null;
      try {
        m = $anilist.getManga(event.mediaId);
      } catch (_) {
        m = null;
      }
      const siteUrl = m?.siteUrl ?? "";
      if (siteUrl.indexOf(SOURCE_PREFIX) !== 0) {
        event.next();
        return;
      }
      const payload = {};
      if (event.status != null) payload.status = event.status;
      if (event.progress != null) payload.progress = event.progress;
      if (event.scoreRaw != null && event.scoreRaw > 0) {
        payload.score = event.scoreRaw;
      }
      if (Object.keys(payload).length === 0) {
        event.next();
        return;
      }
      $store.set(`progress:${event.mediaId}`, payload);
    } catch (e) {
      log.error("pre-update-entry error:", e);
    }
    event.next();
  };
  return onPreUpdateEntry2(...args);
};

// src/plugins/local-catalog-manager/modules/on-pre-update-entry-progress.ts
var onPreUpdateEntryProgress = (...args) => {
  var SHARED_LIB_NAME = "local-catalog-manager";
  var SOURCE_PREFIX = "ext_custom_source_local-catalog";
  var onPreUpdateEntryProgress2 = (event) => {
    const { createLogger, decodeLocalId } = $shared.use(SHARED_LIB_NAME);
    const log = createLogger();
    try {
      if (event.mediaId == null) {
        event.next();
        return;
      }
      if ($store.has(`progress:skip:${event.mediaId}`)) {
        event.next();
        return;
      }
      let m = null;
      try {
        m = $anilist.getManga(event.mediaId);
      } catch (_) {
        m = null;
      }
      const siteUrl = m?.siteUrl ?? "";
      if (siteUrl.indexOf(SOURCE_PREFIX) !== 0) {
        event.next();
        return;
      }
      const payload = {};
      if (event.status != null) payload.status = event.status;
      if (event.progress != null) payload.progress = event.progress;
      if (Object.keys(payload).length === 0) {
        event.next();
        return;
      }
      $store.set(`progress:${event.mediaId}`, payload);
    } catch (e) {
      log.error("pre-update-entry-progress error:", e);
    }
    event.next();
  };
  return onPreUpdateEntryProgress2(...args);
};

// src/plugins/local-catalog-manager/modules/register.ts
var register = (...args) => {
  function divider(tray) {
    return tray.div([], {
      style: { borderTop: "1px solid rgba(255,255,255,0.1)" },
    });
  }
  function joinDividers(tray, blocks) {
    const out = [];
    for (const b of blocks) {
      if (b == null) continue;
      if (out.length > 0) out.push(divider(tray));
      out.push(b);
    }
    return out;
  }
  var LABEL_STYLE = {
    fontSize: "0.7rem",
    fontWeight: "700",
    opacity: "0.55",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  };
  var CAPTION_STYLE = {
    fontSize: "0.7rem",
    opacity: "0.55",
  };
  function initialsCover(tray, name) {
    const label = String(name);
    const clean = label.replace(/[^a-zA-Z0-9]/g, "");
    const initials = (clean.slice(0, 2) || "?").toUpperCase();
    let h = 0;
    for (let i = 0; i < label.length; i++) {
      h = (h * 31 + label.charCodeAt(i)) % 360;
    }
    return tray.flex(
      [
        tray.text(initials, {
          style: {
            fontSize: "0.85rem",
            fontWeight: "700",
            lineHeight: "1",
            textAlign: "center",
            color: "rgba(255,255,255,0.9)",
          },
        }),
      ],
      {
        style: {
          width: "44px",
          height: "62px",
          borderRadius: "4px",
          background: `hsl(${h}, 45%, 38%)`,
          alignItems: "center",
          justifyContent: "center",
          flexShrink: "0",
        },
      },
    );
  }
  function entryList(tray, cfg) {
    const coverBox = (src, title) => {
      const url = src != null ? String(src).trim() : "";
      if (url) {
        return tray.img({
          src: url,
          style: {
            width: "44px",
            height: "62px",
            objectFit: "cover",
            borderRadius: "4px",
            flexShrink: "0",
          },
        });
      }
      return initialsCover(tray, title);
    };
    const dotSep = () =>
      tray.span("·", {
        style: { opacity: "0.35", fontSize: "0.75rem", margin: "0 2px" },
      });
    const subLineSegments = (row) => {
      const segs = [];
      if (row.year != null) {
        segs.push(
          tray.span(String(row.year), {
            style: { opacity: "0.55", fontSize: "0.75rem" },
          }),
        );
      }
      if (row.status) {
        segs.push(
          tray.badge(row.status.label, {
            intent: row.status.intent ?? "gray",
            size: "sm",
          }),
        );
      }
      if (row.chapter != null && row.chapter !== "") {
        segs.push(
          tray.span(`c.${row.chapter}`, {
            style: { opacity: "0.7", fontSize: "0.75rem" },
          }),
        );
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
        whiteSpace: "nowrap",
      };
      if (row.openExternal?.href) {
        const link = tray.a([tray.span("Open ↗")], {
          href: row.openExternal.href,
          target: "_blank",
          style: linkStyle,
        });
        segs.push(
          row.openExternal.tooltip
            ? tray.tooltip(link, { text: row.openExternal.tooltip })
            : link,
        );
      }
      if (row.openInPlace) {
        const button = tray.button("Open →", {
          onClick: row.openInPlace.onClick,
          size: "sm",
          intent: "gray-subtle",
          style: linkStyle,
        });
        segs.push(
          row.openInPlace.tooltip
            ? tray.tooltip(button, { text: row.openInPlace.tooltip })
            : button,
        );
      }
      return segs;
    };
    const entryRow = (row) => {
      const segs = subLineSegments(row);
      const subLineChildren = [];
      segs.forEach((seg, i) => {
        if (i > 0) subLineChildren.push(dotSep());
        subLineChildren.push(seg);
      });
      const middle = tray.stack(
        [
          tray.text(String(row.title || "Untitled"), {
            style: {
              fontWeight: "600",
              fontSize: "0.9rem",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            },
          }),
          tray.flex(subLineChildren, {
            gap: 0,
            style: { alignItems: "center" },
          }),
        ],
        { gap: 1, style: { flex: "1", minWidth: "0" } },
      );
      const rowChildren = [
        coverBox(row.cover, String(row.title || "Untitled")),
        middle,
      ];
      for (const a of row.actions ?? []) rowChildren.push(a);
      return tray.flex(rowChildren, {
        gap: 2,
        style: {
          alignItems: "center",
          padding: "8px",
          borderRadius: "4px",
          background: "rgba(255,255,255,0.02)",
          opacity: row.opacity != null ? String(row.opacity) : "1",
        },
      });
    };
    const headerCount = cfg.searchActive
      ? `${cfg.rows.length} / ${cfg.totalCount}`
      : `${cfg.totalCount}`;
    const headerText =
      cfg.showHeaderCount === false
        ? cfg.headerLabel
        : `${cfg.headerLabel} (${headerCount})`;
    const header = tray.flex(
      [
        tray.div(
          [
            tray.text(headerText, {
              style: LABEL_STYLE,
            }),
          ],
          { style: { flex: "1", alignSelf: "center" } },
        ),
        ...(cfg.inlineActions ?? []),
      ],
      {
        gap: 2,
        style: { alignItems: "center" },
      },
    );
    const out = [];
    out.push(header);
    if (cfg.showSearchRow !== false && cfg.totalCount > 0) {
      const searchRowChildren = [
        tray.div(
          [
            tray.input(cfg.searchPlaceholder, {
              fieldRef: cfg.searchFieldRef,
            }),
          ],
          { style: { flex: "1", minWidth: "0" } },
        ),
        tray.button(cfg.searchButtonLabel ?? "\uD83D\uDD0D Search", {
          onClick: cfg.onSearch,
          size: "sm",
        }),
      ];
      if (cfg.searchActive) {
        searchRowChildren.push(
          tray.tooltip(
            tray.button("✕", { onClick: cfg.onClearSearch, size: "sm" }),
            { text: "Clear search" },
          ),
        );
      }
      out.push(
        tray.flex(searchRowChildren, {
          gap: 2,
          style: { alignItems: "end" },
        }),
      );
    }
    if (cfg.totalCount === 0) {
      out.push(
        tray.text(cfg.emptyText, {
          style: {
            fontSize: "0.8rem",
            opacity: "0.5",
            textAlign: "center",
            padding: "8px 0",
          },
        }),
      );
    } else if (cfg.rows.length === 0 && cfg.searchActive) {
      out.push(
        tray.text(cfg.noMatchText, {
          style: {
            fontSize: "0.8rem",
            opacity: "0.5",
            textAlign: "center",
            padding: "8px 0",
          },
        }),
      );
    } else {
      for (const row of cfg.rows) out.push(entryRow(row));
    }
    return tray.stack(out, { gap: 2 });
  }
  var ICON_PX = 36;
  function trayHeader(tray, opts = {}) {
    const title = String(opts.title ?? "Local Catalog Manager");
    const iconUrl =
      opts.iconUrl == null
        ? "https://raw.githubusercontent.com/Carloss616/seanime-extensions/main/src/plugins/local-catalog-manager/assets/icon.png"
        : String(opts.iconUrl);
    const subtitle =
      opts.subtitle != null
        ? String(opts.subtitle)
        : opts.title != null
          ? String("Local Catalog Manager")
          : "";
    const wrapStyle = {
      overflowWrap: "break-word",
      wordBreak: "normal",
    };
    const textCol = [
      tray.text(title, {
        style: {
          fontWeight: "700",
          fontSize: "1.15rem",
          lineHeight: "1.2",
          letterSpacing: "0.01em",
          ...wrapStyle,
        },
      }),
    ];
    if (subtitle) {
      textCol.push(
        tray.text(subtitle, {
          style: {
            fontSize: "0.8rem",
            lineHeight: "1.3",
            opacity: "0.55",
            ...wrapStyle,
          },
        }),
      );
    }
    const row = [];
    if (iconUrl) {
      row.push(
        tray.img(iconUrl, {
          width: `${ICON_PX}px`,
          height: `${ICON_PX}px`,
          style: { borderRadius: "8px", objectFit: "contain", flexShrink: "0" },
        }),
      );
    }
    row.push(
      tray.stack(textCol, { gap: 1, style: { flex: "1", minWidth: "0" } }),
    );
    if (opts.right?.length) {
      row.push(
        tray.flex(opts.right, {
          gap: 2,
          style: { alignItems: "center", flexShrink: "0" },
        }),
      );
    }
    return tray.flex(row, { gap: 3, style: { alignItems: "center" } });
  }
  var STATUS_INTENT = {
    RELEASING: "success",
    FINISHED: "info",
    HIATUS: "warning",
    CANCELLED: "alert",
    NOT_YET_RELEASED: "gray",
  };
  function statusToPill(status) {
    if (!status) return;
    return {
      label: status.replace(/_/g, " ").toLowerCase(),
      intent: STATUS_INTENT[status] ?? "gray",
    };
  }
  var SHARED_LIB_NAME = "local-catalog-manager";
  var SOURCE_PREFIX = "ext_custom_source_local-catalog";
  var CATALOG_FILENAME = "seanime-local-catalog.json";
  var PROGRESS_FILENAME = "seanime-local-progress.json";
  var K_GIST = "lcm_gist_id";
  var K_OWNER = "lcm_owner";
  var K_RAW = "lcm_raw_url";
  var K_CATALOG = "lcm_catalog";
  var K_UPDATED = "lcm_updated_at";
  var K_NEXT_ID = "lcm_next_id";
  var K_PROGRESS = "lcm_progress";
  var K_PROGRESS_UPDATED = "lcm_progress_updated_at";
  var K_SYNC_PAUSED = "lcm_sync_paused";
  var K_DRIFT_REMOTE = "lcm_drift_remote";
  var K_DRIFT_FRESH_GIST = "lcm_drift_fresh_gist";
  var K_PROGRESS_DRIFT_REMOTE = "lcm_progress_drift_remote";
  var K_EXT_ID = "lcm_ext_id";
  var register2 = (ctx) => {
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
      progressMangaEquals,
    } = $shared.use(SHARED_LIB_NAME);
    const log = createLogger();
    const tray = ctx.newTray({
      iconUrl:
        "https://raw.githubusercontent.com/Carloss616/seanime-extensions/main/src/plugins/local-catalog-manager/assets/icon.png",
      withContent: true,
    });
    const view = ctx.state("list");
    const entries = ctx.state($storage.get(K_CATALOG) ?? []);
    if (!$storage.has(K_NEXT_ID)) {
      $storage.set(K_NEXT_ID, nextId(entries.get()) - 1);
    }
    const editingId = ctx.state(0);
    const rawUrl = ctx.state($storage.get(K_RAW) ?? "");
    const status = ctx.state("");
    const loadProgressDoc = () => parseProgress($storage.get(K_PROGRESS), log);
    const progress = ctx.state(loadProgressDoc());
    const progressUpdated = ctx.state($storage.get(K_PROGRESS_UPDATED) ?? 0);
    const progressStatus = ctx.state("");
    const localEntryCount = () => Object.keys(progress.get().manga).length;
    const orphanCount = () => {
      const catalogIds = new Set(entries.get().map((e) => e.id));
      return detectOrphans(progress.get(), catalogIds).length;
    };
    const formatTs = (ms) => {
      if (!ms) return "—";
      const d = new Date(ms);
      const pad = (n) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
          $storage.set(K_PROGRESS_UPDATED, now);
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
            { extId: $storage.get(K_EXT_ID) ?? undefined },
          );
          const res = applyRemote(merged, progress.get(), {
            updateEntry: applyEntryViaSeanime,
            mediaIdByLocalId: lookup,
          });
          progress.set(merged);
          progressUpdated.set(now);
          $storage.set(K_PROGRESS, merged);
          $storage.set(K_PROGRESS_UPDATED, now);
          progressStatus.set(
            `Pulled — applied ${res.applied}${res.skipped ? `, skipped ${res.skipped} orphan(s)` : ""}`,
          );
        } catch (e) {
          log.warn("pull progress failed:", e);
          progressStatus.set(`Pull failed: ${String(e)}`);
        }
      });
    }
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
          if (catalogsEqual(merged, remote)) {
            persistLocal(merged, $storage.get(K_UPDATED) ?? now);
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
          ctx.toast.error(`Reload failed: ${e.message}`);
        }
      });
    }
    const applyEntryViaSeanime = (mediaId, status2, scoreRaw, prog) => {
      $store.set(`progress:skip:${mediaId}`, true);
      try {
        $anilist.updateEntry(
          mediaId,
          status2,
          scoreRaw,
          prog,
          undefined,
          undefined,
        );
      } finally {
        $store.remove(`progress:skip:${mediaId}`);
      }
    };
    async function syncProgressInner() {
      const gistId = effectiveGistId();
      const now = Date.now();
      let remoteStr = "";
      try {
        remoteStr = await client().getGistFile(gistId, PROGRESS_FILENAME);
      } catch (_) {
        remoteStr = "";
      }
      const remote = parseProgress(remoteStr, log);
      const localDoc = progress.get();
      const merged = mergeProgress(localDoc, remote, now);
      const collection = await ctx.manga.getCollection();
      const lookup = buildMediaIdLookup(
        collection,
        SOURCE_PREFIX,
        decodeLocalId,
        { extId: $storage.get(K_EXT_ID) ?? undefined },
      );
      const res = applyRemote(merged, localDoc, {
        updateEntry: applyEntryViaSeanime,
        mediaIdByLocalId: lookup,
      });
      if (!progressMangaEquals(merged.manga, remote.manga)) {
        await client().updateGistFile(
          gistId,
          PROGRESS_FILENAME,
          serializeProgress(merged),
        );
      }
      progress.set(merged);
      progressUpdated.set(now);
      $storage.set(K_PROGRESS, merged);
      $storage.set(K_PROGRESS_UPDATED, now);
      if (res.applied > 0) {
        try {
          $anilist.refreshMangaCollection();
        } catch (e) {
          log.warn("refreshMangaCollection failed:", e);
        }
        invalidateClientCaches({ progress: true });
      }
      return res;
    }
    const SILENT_COOLDOWN_MS = 1e4;
    let lastSilentSyncAt = 0;
    async function pullProgressSilent(reason) {
      const gistId = effectiveGistId();
      if (!hasToken() || !gistId) return;
      if (pendingDrift.get()) return;
      if (busyAction.get()) return;
      const nowMs = Date.now();
      if (nowMs - lastSilentSyncAt < SILENT_COOLDOWN_MS) return;
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
    function invalidateClientCaches(opts) {
      const keys = [];
      if (opts.catalog) {
        keys.push("CUSTOM-SOURCE-custom-source-list-manga");
      }
      if (opts.progress) {
        keys.push(
          "MANGA-get-manga-collection",
          "MANGA-get-anilist-manga-collection",
          "MANGA-get-manga-entry",
        );
      }
      if (keys.length === 0) return;
      try {
        $app.invalidateClientQuery(keys);
      } catch (e) {
        log.warn("invalidateClientQuery failed:", e);
      }
    }
    function persistProgress(next, updatedAt) {
      progress.set(next);
      progressUpdated.set(updatedAt);
      $storage.set(K_PROGRESS, next);
      $storage.set(K_PROGRESS_UPDATED, updatedAt);
      const gistId = effectiveGistId();
      if (hasToken() && gistId && !hasDrift()) {
        pushProgress(
          client(),
          gistId,
          PROGRESS_FILENAME,
          next,
          updatedAt,
        ).catch((e) => {
          log.warn("progress push failed:", e);
        });
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
    function deleteOrphan(localId) {
      if (!progress.get().manga[String(localId)]) return;
      const now = Date.now();
      persistProgress(pruneOrphans(progress.get(), [localId], now), now);
      progressStatus.set(`Deleted orphan #${localId}`);
    }
    function mediaIdFor(localId) {
      const extId = $storage.get(K_EXT_ID);
      if (extId == null) return null;
      return encodeMediaId(extId, localId);
    }
    async function discoverExtId() {
      const cached = $storage.get(K_EXT_ID);
      if (cached != null) return cached;
      const lookup = mediaIdLookup.get();
      if (lookup && lookup.size > 0) {
        const [, anyMediaId] = lookup.entries().next().value;
        const extId = decodeExtId(anyMediaId);
        $storage.set(K_EXT_ID, extId);
        return extId;
      }
      const probeLocalId = entries.get()[0]?.id;
      if (probeLocalId == null) return null;
      for (let extId = 1; extId <= 1023; extId++) {
        if (extId % 64 === 0) {
          $sleep(0);
        }
        const candidate = encodeMediaId(extId, probeLocalId);
        try {
          const m = $anilist.getManga(candidate);
          if (m?.siteUrl && m.siteUrl.indexOf(SOURCE_PREFIX) === 0) {
            $storage.set(K_EXT_ID, extId);
            return extId;
          }
        } catch (_) {}
      }
      return null;
    }
    async function resolveMediaId(localId) {
      const cached = mediaIdFor(localId);
      if (cached != null) return cached;
      const extId = await discoverExtId();
      if (extId == null) return null;
      return encodeMediaId(extId, localId);
    }
    async function applyProgress(localId) {
      const entry = progress.get().manga[String(localId)];
      if (!entry) return;
      await runBusy(`apply-progress-${localId}`, async () => {
        try {
          const mediaId = await resolveMediaId(localId);
          if (mediaId == null) {
            ctx.toast.warning(
              `Couldn't resolve seanime mediaId for #${localId}. Make sure the local-catalog custom-source is installed and has this entry.`,
            );
            return;
          }
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
          try {
            const fresh = await ctx.manga.getCollection();
            refreshLookupsFromCollection(fresh);
          } catch (_) {}
        } catch (e) {
          ctx.toast.error(`Apply failed: ${e.message}`);
        }
      });
    }
    async function navigateToMangaEntry(localId) {
      await runBusy(`open-manga-${localId}`, async () => {
        try {
          const mediaId = await resolveMediaId(localId);
          if (mediaId == null) {
            ctx.toast.warning(
              `Couldn't resolve seanime mediaId for #${localId}. Make sure the local-catalog custom-source is installed and has this entry.`,
            );
            return;
          }
          ctx.screen.navigateTo("/manga/entry", { id: String(mediaId) });
          tray.close();
        } catch (e) {
          ctx.toast.error(`Navigation failed: ${e.message}`);
        }
      });
    }
    const fRomaji = ctx.fieldRef("");
    const fEnglish = ctx.fieldRef("");
    const fNative = ctx.fieldRef("");
    const fPreferred = ctx.fieldRef("english");
    const fSynonyms = ctx.fieldRef("");
    const fCover = ctx.fieldRef("");
    const fBanner = ctx.fieldRef("");
    const fDescription = ctx.fieldRef("");
    const fGenres = ctx.fieldRef("");
    const fStatus = ctx.fieldRef("");
    const fFormat = ctx.fieldRef("");
    const fChapters = ctx.fieldRef("");
    const fVolumes = ctx.fieldRef("");
    const fYear = ctx.fieldRef("");
    const fMonth = ctx.fieldRef("");
    const fDay = ctx.fieldRef("");
    const fIsAdult = ctx.fieldRef(false);
    const fCountry = ctx.fieldRef("");
    const fSiteUrl = ctx.fieldRef("");
    const fIdMal = ctx.fieldRef("");
    const fMeanScore = ctx.fieldRef("");
    const fEndYear = ctx.fieldRef("");
    const fEndMonth = ctx.fieldRef("");
    const fEndDay = ctx.fieldRef("");
    const fJsonIn = ctx.fieldRef("");
    const fGistLink = ctx.fieldRef("");
    const deleteGistArmed = ctx.state(false);
    const deleteArmedId = ctx.state(0);
    const bindingExpanded = ctx.state(false);
    const orphansExpanded = ctx.state(false);
    const catalogJsonExpanded = ctx.state(false);
    const progressJsonExpanded = ctx.state(false);
    const mediaIdLookup = ctx.state(null);
    const seanimeListDataLookup = ctx.state(null);
    function refreshLookupsFromCollection(collection) {
      const extId = $storage.get(K_EXT_ID) ?? undefined;
      mediaIdLookup.set(
        buildMediaIdLookup(collection, SOURCE_PREFIX, decodeLocalId, {
          extId,
        }),
      );
      const listData = new Map();
      for (const list2 of collection.lists ?? []) {
        for (const e of list2.entries ?? []) {
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
    const entrySearch = ctx.state("");
    const fEntrySearch = ctx.fieldRef("");
    const pendingDrift = ctx.state(null);
    const pendingProgressDrift = ctx.state(null);
    const hasDrift = () =>
      pendingDrift.get() !== null || pendingProgressDrift.get() !== null;
    const recomputeSyncPause = () => {
      const anyDrift =
        $storage.has(K_DRIFT_REMOTE) || $storage.has(K_PROGRESS_DRIFT_REMOTE);
      if (anyDrift) {
        $storage.set(K_SYNC_PAUSED, true);
      } else {
        $storage.remove(K_SYNC_PAUSED);
        $store.remove("lcm:drift-notified");
      }
    };
    const pauseSync = (remote, opts = {}) => {
      if (remote !== null) {
        $storage.set(K_DRIFT_REMOTE, remote);
        if (opts.freshGist) $storage.set(K_DRIFT_FRESH_GIST, true);
      } else {
        $storage.remove(K_DRIFT_REMOTE);
        $storage.remove(K_DRIFT_FRESH_GIST);
      }
      recomputeSyncPause();
    };
    const pauseProgressSync = (remote) => {
      if (remote !== null) {
        $storage.set(K_PROGRESS_DRIFT_REMOTE, remote);
      } else {
        $storage.remove(K_PROGRESS_DRIFT_REMOTE);
      }
      recomputeSyncPause();
    };
    if ($storage.has(K_DRIFT_REMOTE)) {
      const persistedDriftRemote = $storage.get(K_DRIFT_REMOTE) ?? [];
      if (catalogsEqual(entries.get(), persistedDriftRemote)) {
        pauseSync(null);
      } else {
        pendingDrift.set({
          local: entries.get(),
          remote: persistedDriftRemote,
        });
      }
    }
    if ($storage.has(K_PROGRESS_DRIFT_REMOTE)) {
      const persistedProgressRemote = $storage.get(K_PROGRESS_DRIFT_REMOTE);
      if (persistedProgressRemote) {
        pendingProgressDrift.set({
          local: progress.get(),
          remote: persistedProgressRemote,
        });
      }
    }
    const busyAction = ctx.state("");
    const runBusy = async (tag, fn) => {
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
    const token = () => ($getUserPreference("githubToken") ?? "").trim();
    const hasToken = () => token().length > 0;
    const client = () => new GistClient(token(), (u, i) => ctx.fetch(u, i));
    const parseGistId = (input) => {
      const trimmed = input.trim();
      if (!trimmed) return null;
      if (/^[a-f0-9]+$/i.test(trimmed)) return trimmed;
      const m = trimmed.match(
        /gist\.github(?:usercontent)?\.com\/[^/]+\/([a-f0-9]+)/i,
      );
      return m ? m[1] : null;
    };
    const legacyGistUrl = ($getUserPreference("gistUrl") ?? "").trim();
    if (legacyGistUrl && !$storage.get(K_GIST)) {
      const parsed = parseGistId(legacyGistUrl);
      if (parsed) {
        $storage.set(K_GIST, parsed);
        log.log("migrated legacy gistUrl config to $storage");
      }
    }
    const effectiveGistId = () => $storage.get(K_GIST) ?? "";
    const ent = (n) => `${n} ${n === 1 ? "entry" : "entries"}`;
    const disarmDelete = () => {
      if (deleteGistArmed.get()) deleteGistArmed.set(false);
      if (deleteArmedId.get() !== 0) deleteArmedId.set(0);
    };
    const clearGistLocalState = () => {
      $storage.remove(K_GIST);
      $storage.remove(K_OWNER);
      $storage.remove(K_RAW);
      rawUrl.set("");
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
          const initial = serializeCatalog([], Date.now());
          const info = await client().createGist(CATALOG_FILENAME, initial);
          $storage.set(K_GIST, info.id);
          $storage.set(K_OWNER, info.owner);
          $storage.set(K_RAW, info.rawUrl);
          rawUrl.set(info.rawUrl);
          if (localEntries.length > 0) {
            pendingDrift.set({ local: localEntries, remote: [] });
            pauseSync([], { freshGist: true });
            ctx.toast.warning(
              `Created gist ${info.id} — ${ent(localEntries.length)} local pending. Resolve in tray.`,
            );
          } else {
            ctx.toast.success(`Created gist ${info.id}`);
          }
        } catch (e) {
          ctx.toast.error(`Create failed: ${e.message}`);
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
        $storage.set(K_GIST, parsed);
        $storage.set(K_OWNER, "");
        $storage.set(K_RAW, "");
        rawUrl.set("");
        fGistLink.setValue("");
        let remote = [];
        try {
          const info = await client().getGistFileWithInfo(
            parsed,
            CATALOG_FILENAME,
          );
          $storage.set(K_OWNER, info.owner);
          $storage.set(K_RAW, info.rawUrl);
          rawUrl.set(info.rawUrl);
          remote = parseCatalog(info.content, log).manga;
        } catch (e) {
          ctx.toast.error(
            `Linked, but couldn't fetch remote catalog: ${e.message}. Use Pull to retry.`,
          );
          return;
        }
        const local = entries.get();
        if (remote.length === 0 && local.length === 0) {
          await syncProgressOnLink(parsed, "both empty");
          return;
        }
        if (local.length === 0) {
          persistLocal(remote, Date.now());
          await syncProgressOnLink(
            parsed,
            `pulled ${ent(remote.length)} from remote`,
          );
          return;
        }
        if (catalogsEqual(local, remote)) {
          await syncProgressOnLink(parsed, `in sync — ${ent(local.length)}`);
          return;
        }
        pendingDrift.set({ local, remote });
        pauseSync(remote);
        ctx.toast.warning(
          `Drift detected: local ${ent(local.length)} vs remote ${ent(remote.length)}. Resolve in tray.`,
        );
      });
    }
    async function syncProgressOnLink(gistId, catalogSummary) {
      try {
        const gistIdNow = effectiveGistId();
        if (!gistIdNow) {
          ctx.toast.success(`Linked to gist ${gistId} — ${catalogSummary}.`);
          return;
        }
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
        if (localCount > 0 && remoteCount > 0) {
          pendingProgressDrift.set({ local, remote });
          pauseProgressSync(remote);
          const d = diffProgress(local, remote);
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
          `Linked to gist ${gistId} — ${catalogSummary}. Progress sync failed: ${e.message}. Use Reload progress to retry.`,
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
    async function resolveDrift(mode) {
      const drift = pendingDrift.get();
      if (!drift) return;
      await runBusy("resolve-drift", async () => {
        const now = Date.now();
        let resolved;
        if (mode === "merge")
          resolved = mergeCatalog(drift.local, drift.remote);
        else if (mode === "local") resolved = drift.local;
        else resolved = drift.remote;
        persistLocal(resolved, now);
        pendingDrift.set(null);
        pauseSync(null);
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
            invalidateClientCaches({ catalog: true });
          } catch (e) {
            ctx.toast.error(
              `Resolved locally but push failed: ${e.message}. Use Pull to retry.`,
            );
          }
        } else {
          ctx.toast.success(`Drift resolved (${mode})`);
        }
      });
    }
    async function resolveProgressDrift(mode) {
      const drift = pendingProgressDrift.get();
      if (!drift) return;
      await runBusy("resolve-progress-drift", async () => {
        const now = Date.now();
        let resolved;
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
            { extId: $storage.get(K_EXT_ID) ?? undefined },
          );
          const res = applyRemote(resolved, drift.local, {
            updateEntry: applyEntryViaSeanime,
            mediaIdByLocalId: lookup,
          });
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
          ctx.toast.error(`Progress drift resolve failed: ${e.message}`);
        }
      });
    }
    function cancelProgressDrift() {
      if (!pendingProgressDrift.get()) return;
      pendingProgressDrift.set(null);
      pauseProgressSync(null);
      ctx.toast.info(
        "Progress drift dismissed. Local progress kept; remote untouched. Use Reload progress later to retry.",
      );
    }
    function cancelDriftLink() {
      const wasFresh = $storage.get(K_DRIFT_FRESH_GIST) === true;
      const gistId = effectiveGistId();
      pendingDrift.set(null);
      pauseSync(null);
      $storage.remove(K_GIST);
      $storage.remove(K_OWNER);
      $storage.remove(K_RAW);
      rawUrl.set("");
      if (wasFresh && gistId) {
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
        deleteGistArmed.set(false);
        return;
      }
      await runBusy("delete-gist", async () => {
        try {
          await client().deleteGist(gistId);
          clearGistLocalState();
          deleteGistArmed.set(false);
          ctx.toast.success(
            `Deleted gist ${gistId} from GitHub. Local catalog + progress kept.`,
          );
        } catch (e) {
          ctx.toast.error(`Delete failed: ${e.message}`);
        }
      });
    }
    const num = (s) => {
      const v = Number((s ?? "").trim());
      return (s ?? "").trim() !== "" && Number.isFinite(v) ? v : undefined;
    };
    const list = (s) => {
      const arr = (s ?? "")
        .split(",")
        .map((x) => x.trim())
        .filter((x) => x.length > 0);
      return arr.length > 0 ? arr : undefined;
    };
    function persistLocal(next, updatedAt) {
      entries.set(next);
      $storage.set(K_CATALOG, next);
      $storage.set(K_UPDATED, updatedAt);
      const hw = $storage.get(K_NEXT_ID) ?? 0;
      $storage.set(K_NEXT_ID, Math.max(hw, nextId(next) - 1));
      invalidateClientCaches({ catalog: true });
    }
    function allocId() {
      const hw = $storage.get(K_NEXT_ID) ?? 0;
      const id = Math.max(hw, nextId(entries.get()) - 1) + 1;
      $storage.set(K_NEXT_ID, id);
      return id;
    }
    async function push(next) {
      const updatedAt = Date.now();
      if (!hasToken()) {
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
            const info = await client().createGist(CATALOG_FILENAME, json);
            $storage.set(K_GIST, info.id);
            $storage.set(K_OWNER, info.owner);
            $storage.set(K_RAW, info.rawUrl);
            rawUrl.set(info.rawUrl);
            gistId = info.id;
            ctx.toast.success(
              "Created Gist. Copy the raw URL into the source.",
            );
          } else {
            await client().updateGistFile(gistId, CATALOG_FILENAME, json);
          }
          persistLocal(next, updatedAt);
          status.set(`Synced ${ent(next.length)}`);
          invalidateClientCaches({ catalog: true });
        } catch (e) {
          ctx.toast.error(`Sync failed: ${e.message}`);
        }
      });
    }
    async function pull() {
      const gistId = effectiveGistId();
      if (!token() || !gistId) {
        ctx.toast.info(
          "Nothing to pull yet — add an entry to create the Gist.",
        );
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
          ctx.toast.error(`Pull failed: ${e.message}`);
        }
      });
    }
    function deleteEntry(id) {
      if (progress.get().manga[String(id)]) {
        const now = Date.now();
        persistProgress(pruneOrphans(progress.get(), [id], now), now);
      }
      push(removeEntry(entries.get(), id));
    }
    function openForm(id) {
      editingId.set(id);
      const e = entries.get().find((x) => x.id === id);
      const t = e?.title;
      fRomaji.setValue(t?.romaji ?? "");
      fEnglish.setValue(t?.english ?? "");
      fNative.setValue(t?.native ?? "");
      const up = t?.userPreferred;
      fPreferred.setValue(
        up && up === t?.romaji
          ? "romaji"
          : up && up === t?.native
            ? "native"
            : "english",
      );
      fSynonyms.setValue((e?.synonyms ?? []).join(", "));
      fCover.setValue(e?.coverImage?.extraLarge ?? e?.coverImage?.large ?? "");
      fBanner.setValue(e?.bannerImage ?? "");
      fDescription.setValue(e?.description ?? "");
      fGenres.setValue((e?.genres ?? []).join(", "));
      fStatus.setValue(e?.status ?? "");
      fFormat.setValue(e?.format ?? "");
      fChapters.setValue(e?.chapters != null ? String(e.chapters) : "");
      fVolumes.setValue(e?.volumes != null ? String(e.volumes) : "");
      fYear.setValue(
        e?.startDate?.year != null ? String(e.startDate.year) : "",
      );
      fMonth.setValue(
        e?.startDate?.month != null ? String(e.startDate.month) : "",
      );
      fDay.setValue(e?.startDate?.day != null ? String(e.startDate.day) : "");
      fEndYear.setValue(e?.endDate?.year != null ? String(e.endDate.year) : "");
      fEndMonth.setValue(
        e?.endDate?.month != null ? String(e.endDate.month) : "",
      );
      fEndDay.setValue(e?.endDate?.day != null ? String(e.endDate.day) : "");
      fIsAdult.setValue(!!e?.isAdult);
      fCountry.setValue(e?.countryOfOrigin ?? "");
      fSiteUrl.setValue(e?.siteUrl ?? "");
      fIdMal.setValue(e?.idMal != null ? String(e.idMal) : "");
      fMeanScore.setValue(e?.meanScore != null ? String(e.meanScore) : "");
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
      pull();
    });
    ctx.registerEventHandler("lcm-push-progress", () => {
      disarmDelete();
      pushProgressNow();
    });
    ctx.registerEventHandler("lcm-pull-progress", () => {
      disarmDelete();
      pullProgressNow();
    });
    ctx.registerEventHandler("lcm-reload-catalog", () => {
      disarmDelete();
      reloadCatalog();
    });
    ctx.registerEventHandler("lcm-reload-progress", () => {
      disarmDelete();
      reloadProgress();
    });
    ctx.registerEventHandler("lcm-clean-orphans", () => {
      disarmDelete();
      cleanOrphans();
    });
    ctx.registerEventHandler("lcm-create-gist", () => {
      createGistNow();
    });
    ctx.registerEventHandler("lcm-link-gist", () => {
      linkExistingGist();
    });
    ctx.registerEventHandler("lcm-drift-merge", () => {
      resolveDrift("merge");
    });
    ctx.registerEventHandler("lcm-drift-local-wins", () => {
      resolveDrift("local");
    });
    ctx.registerEventHandler("lcm-drift-remote-wins", () => {
      resolveDrift("remote");
    });
    ctx.registerEventHandler("lcm-drift-cancel", () => {
      cancelDriftLink();
    });
    ctx.registerEventHandler("lcm-progress-drift-merge", () => {
      resolveProgressDrift("merge");
    });
    ctx.registerEventHandler("lcm-progress-drift-local-wins", () => {
      resolveProgressDrift("local");
    });
    ctx.registerEventHandler("lcm-progress-drift-remote-wins", () => {
      resolveProgressDrift("remote");
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
    ctx.registerEventHandler("lcm-delete-gist-arm", () => {
      deleteGistArmed.set(true);
    });
    ctx.registerEventHandler("lcm-delete-gist-confirm", () => {
      deleteGistRemotely();
    });
    ctx.registerEventHandler("lcm-toggle-binding", () => {
      disarmDelete();
      bindingExpanded.set(!bindingExpanded.get());
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
      const cover = (fCover.current ?? "").trim() || undefined;
      const sd = {
        year: num(fYear.current),
        month: num(fMonth.current),
        day: num(fDay.current),
      };
      const ed = {
        year: num(fEndYear.current),
        month: num(fEndMonth.current),
        day: num(fEndDay.current),
      };
      const hasSd = sd.year != null || sd.month != null || sd.day != null;
      const hasEd = ed.year != null || ed.month != null || ed.day != null;
      const entry = {
        ...existing,
        id,
        type: "MANGA",
        updatedAt: Date.now(),
        title: (() => {
          const romaji = (fRomaji.current ?? "").trim() || undefined;
          const english = (fEnglish.current ?? "").trim() || undefined;
          const native = (fNative.current ?? "").trim() || undefined;
          const pref = fPreferred.current ?? "english";
          const userPreferred =
            (pref === "romaji"
              ? romaji
              : pref === "native"
                ? native
                : english) ||
            english ||
            romaji ||
            native;
          return { romaji, english, native, userPreferred };
        })(),
        synonyms: list(fSynonyms.current),
        coverImage: cover
          ? {
              ...existing?.coverImage,
              extraLarge: cover,
              large: cover,
              medium: cover,
            }
          : undefined,
        bannerImage: (fBanner.current ?? "").trim() || undefined,
        description: (fDescription.current ?? "").trim() || undefined,
        genres: list(fGenres.current),
        status: (() => {
          const v = (fStatus.current ?? "").trim();
          return v && v !== NONE ? v : undefined;
        })(),
        format: (() => {
          const v = (fFormat.current ?? "").trim();
          return v && v !== NONE ? v : undefined;
        })(),
        chapters: num(fChapters.current),
        volumes: num(fVolumes.current),
        startDate: hasSd ? sd : undefined,
        endDate: hasEd ? ed : undefined,
        isAdult: fIsAdult.current ? true : undefined,
        countryOfOrigin: (fCountry.current ?? "").trim() || undefined,
        siteUrl: (fSiteUrl.current ?? "").trim() || undefined,
        idMal: num(fIdMal.current),
        meanScore: num(fMeanScore.current),
      };
      const err = validateEntry(entry);
      if (err) {
        ctx.toast.error(err);
        return;
      }
      const next = upsertEntry(current, entry);
      view.set("list");
      push(next);
    });
    const detectImportKind = (raw) => {
      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        return "invalid";
      }
      if (Array.isArray(data)) return "catalog";
      if (!data || typeof data !== "object") return "invalid";
      const obj = data;
      if (Array.isArray(obj.manga)) return "catalog";
      if (obj.manga && typeof obj.manga === "object") return "progress";
      if (obj.entries && typeof obj.entries === "object") return "progress";
      return "invalid";
    };
    const importFromField = (mode) => {
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
          push(next);
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
        ctx.toast.error(`Import failed: ${e.message}`);
      }
    };
    ctx.registerEventHandler("lcm-import-merge", () =>
      importFromField("merge"),
    );
    ctx.registerEventHandler("lcm-import-replace", () =>
      importFromField("replace"),
    );
    const NONE = "-";
    const STATUS_OPTS = [
      { label: "—", value: NONE },
      { label: "Releasing", value: "RELEASING" },
      { label: "Finished", value: "FINISHED" },
      { label: "Hiatus", value: "HIATUS" },
      { label: "Cancelled", value: "CANCELLED" },
      { label: "Not yet released", value: "NOT_YET_RELEASED" },
    ];
    const FORMAT_OPTS = [
      { label: "—", value: NONE },
      { label: "Manga", value: "MANGA" },
      { label: "Novel", value: "NOVEL" },
      { label: "One-shot", value: "ONE_SHOT" },
    ];
    const PREFERRED_OPTS = [
      { label: "English", value: "english" },
      { label: "Romaji", value: "romaji" },
      { label: "Native", value: "native" },
    ];
    const MONTH_OPTS = [
      { label: "—", value: NONE },
      ...[
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December",
      ].map((label, i) => ({ label, value: String(i + 1) })),
    ];
    const sectionHeader = (label) => tray.text(label, { style: LABEL_STYLE });
    const statCard = (value, label) =>
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
    const stringFieldDiff = (local, remote) => {
      if (local === undefined) return false;
      return String(local) !== String(remote ?? "");
    };
    const numericFieldDiff = (local, remote) => {
      if (local === undefined) return false;
      return Number(local) !== Number(remote ?? 0);
    };
    function hasEntryProgressDrift(localId) {
      const rowProgress = progress.get().manga[String(localId)];
      if (!rowProgress) return false;
      const seanimeData = seanimeListDataLookup.get()?.get(localId);
      const lookupReady = seanimeListDataLookup.get() != null;
      return (
        !lookupReady ||
        !seanimeData ||
        stringFieldDiff(rowProgress.status, seanimeData.status) ||
        numericFieldDiff(rowProgress.progress, seanimeData.progress) ||
        numericFieldDiff(rowProgress.score, seanimeData.score)
      );
    }
    const formatListStatus = (status2) => {
      if (!status2) return "—";
      return status2.replace(/_/g, " ").toLowerCase();
    };
    function renderProgressSection() {
      const linked = hasToken() && !!effectiveGistId();
      const oCount = orphanCount();
      const oExpanded = orphansExpanded.get();
      const headerActions = [];
      if (linked) {
        headerActions.push(
          tray.button(
            busyAction.get() === "reload-progress"
              ? "⏳ Reloading…"
              : "↻ Reload",
            { onClick: "lcm-reload-progress", size: "sm" },
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
      const sub = [
        tray.flex(
          [
            tray.div([sectionHeader("\uD83D\uDCD6 READING PROGRESS")], {
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
          const parts = [];
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
                tray.button(applyBusy ? "⏳" : "\uD83D\uDCE4", {
                  onClick: ctx.eventHandler(`lcm-apply-progress-${id}`, () => {
                    applyProgress(id);
                  }),
                  size: "sm",
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
    function renderSync() {
      if (hasToken()) {
        const gid = effectiveGistId();
        const owner = $storage.get(K_OWNER) ?? "";
        const expanded2 = bindingExpanded.get();
        const drifting = hasDrift();
        const items2 = [];
        const statusLine = status.get();
        if (statusLine) {
          items2.push(
            tray.text(statusLine, {
              style: {
                fontSize: "0.75rem",
                opacity: "0.6",
              },
            }),
          );
        }
        if (expanded2) {
          if (gid) {
            const deleteBusy = busyAction.get() === "delete-gist";
            const shortId = gid.length > 12 ? `${gid.slice(0, 12)}…` : gid;
            items2.push(
              tray.flex(
                [
                  tray.div(
                    [
                      tray.span(shortId, {
                        style: {
                          fontFamily: "monospace",
                          fontSize: "0.8rem",
                          opacity: "0.85",
                        },
                      }),
                      owner
                        ? tray.span(`  ${owner}`, {
                            style: { fontSize: "0.8rem", opacity: "0.55" },
                          })
                        : tray.span(""),
                    ],
                    {
                      style: { flex: "1", alignSelf: "center", minWidth: "0" },
                    },
                  ),
                  tray.tooltip(
                    tray.button("\uD83D\uDCCB", {
                      onClick: "lcm-show-raw-url",
                      size: "sm",
                      disabled: drifting,
                    }),
                    { text: "Copy raw catalog URL" },
                  ),
                  tray.tooltip(
                    tray.button("\uD83D\uDD13", {
                      onClick: "lcm-unlink-gist",
                      size: "sm",
                      disabled: drifting,
                    }),
                    { text: "Unlink gist (keep on GitHub)" },
                  ),
                  tray.tooltip(
                    tray.button(
                      deleteBusy
                        ? "⏳"
                        : deleteGistArmed.get()
                          ? "⚠️️ Confirm"
                          : "⛔",
                      {
                        onClick: deleteGistArmed.get()
                          ? "lcm-delete-gist-confirm"
                          : "lcm-delete-gist-arm",
                        size: "sm",
                        disabled: drifting,
                      },
                    ),
                    {
                      text: deleteGistArmed.get()
                        ? "Click to confirm — this is irreversible"
                        : "Delete gist remotely (irreversible)",
                    },
                  ),
                ],
                {
                  gap: 2,
                  style: {
                    alignItems: "center",
                    padding: "8px",
                    borderRadius: "4px",
                    background: "rgba(255,255,255,0.03)",
                  },
                },
              ),
            );
          } else {
            const createBusy = busyAction.get() === "create-gist";
            items2.push(
              tray.flex(
                [
                  tray.button(
                    createBusy ? "⏳ Creating…" : "+ Create new gist",
                    {
                      onClick: "lcm-create-gist",
                      intent: "primary",
                      size: "sm",
                    },
                  ),
                ],
                {},
              ),
              tray.flex(
                [
                  tray.div(
                    [
                      tray.input("Paste gist URL or ID", {
                        fieldRef: fGistLink,
                      }),
                    ],
                    { style: { flex: "1", minWidth: "0" } },
                  ),
                  tray.button(
                    busyAction.get() === "link-gist"
                      ? "⏳ Linking…"
                      : "\uD83D\uDD17 Link",
                    { onClick: "lcm-link-gist", size: "sm" },
                  ),
                ],
                { gap: 2, style: { alignItems: "end" } },
              ),
            );
          }
        }
        if (items2.length === 0) return null;
        return tray.stack(items2, { gap: 2 });
      }
      const localCount = entries.get().length;
      const jsonOut = serializeCatalog(
        entries.get(),
        $storage.get(K_UPDATED) ?? Date.now(),
      );
      const expanded = bindingExpanded.get();
      const items = [];
      if (expanded) {
        items.push(
          tray.alert({
            title: "Plugin and custom-source can't sync directly",
            description:
              "seanime sandboxes extensions. Copy the JSON below into the custom-source's Inline catalog JSON field after every edit. \uD83D\uDCA1 Tip: set a GitHub token in the plugin config to switch to Gist mode — automatic sync, no copy-paste.",
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
      const renderCodeBlockSection = (opts) => {
        const out = [
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
      const importButtons = hasLocalData
        ? [
            tray.tooltip(
              tray.button("\uD83D\uDD00 Merge", {
                onClick: "lcm-import-merge",
              }),
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
            tray.button("\uD83D\uDCE5 Import", {
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
      const list2 = q
        ? allEntries.filter((e) => {
            const title = (resolveUserPreferred(e.title) ?? "").toLowerCase();
            if (title.includes(q)) return true;
            const syns = e.synonyms ?? [];
            return syns.some((s) => s.toLowerCase().includes(q));
          })
        : allEntries;
      const rows = list2.map((e) => {
        const title = resolveUserPreferred(e.title) ?? "(untitled)";
        const rowProg = progress.get().manga[String(e.id)]?.progress;
        const row = {
          cover: e.coverImage?.extraLarge ?? e.coverImage?.large,
          title,
          year: e.startDate?.year,
          chapter: rowProg ?? undefined,
          opacity: drifting ? 0.5 : 1,
        };
        row.status = statusToPill(e.status);
        if (!drifting) {
          const inListMediaId = mediaIdLookup.get()?.get(e.id);
          const computedMediaId = mediaIdFor(e.id);
          const resolvedMediaId = inListMediaId ?? computedMediaId;
          const openBusy = busyAction.get() === `open-manga-${e.id}`;
          const tooltipText = openBusy
            ? "Opening …"
            : resolvedMediaId
              ? `Open in seanime · media #${resolvedMediaId}${inListMediaId == null ? " · not in your list" : ""}`
              : `Open in seanime · resolves on click`;
          row.openInPlace = {
            onClick: ctx.eventHandler(`lcm-open-manga-${e.id}`, () => {
              navigateToMangaEntry(e.id);
            }),
            tooltip: tooltipText,
          };
        }
        const actions = [];
        if (!drifting) {
          const rowProgress = progress.get().manga[String(e.id)];
          if (rowProgress) {
            const seanimeData = seanimeListDataLookup.get()?.get(e.id);
            const inListForApply = seanimeData != null;
            const applyRowBusy = busyAction.get() === `apply-progress-${e.id}`;
            const hasDriftRow = hasEntryProgressDrift(e.id);
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
                  tray.button(applyRowBusy ? "⏳" : "\uD83D\uDCE4", {
                    onClick: ctx.eventHandler(
                      `lcm-apply-progress-${e.id}`,
                      () => {
                        applyProgress(e.id);
                      },
                    ),
                    size: "sm",
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
      const inlineActions = drifting
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
            busyAction.get() === "reload-catalog"
              ? "⏳ Reloading…"
              : "↻ Reload",
            { onClick: "lcm-reload-catalog", size: "sm" },
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
        const layers = [];
        const actionBox = (buttonRows) =>
          tray.div(
            [
              tray.div([], {
                style: {
                  position: "absolute",
                  top: "-7px",
                  left: "50%",
                  transform: "translateX(-50%)",
                  width: "0",
                  height: "0",
                  borderLeft: "7px solid transparent",
                  borderRight: "7px solid transparent",
                  borderBottom: "7px solid rgba(255,255,255,0.18)",
                },
              }),
              tray.stack(buttonRows, {
                gap: 2,
                style: { alignItems: "center" },
              }),
            ],
            {
              style: {
                position: "relative",
                padding: "12px",
                borderRadius: "8px",
                border: "1px solid rgba(255,255,255,0.18)",
                background: "rgba(255,255,255,0.04)",
              },
            },
          );
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
                      tray.button(
                        resolveBusy ? "⏳ Working…" : "\uD83D\uDD00 Merge",
                        {
                          onClick: "lcm-drift-merge",
                          intent: "primary",
                        },
                      ),
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
                      tray.button(
                        resolveProgBusy ? "⏳ Working…" : "\uD83D\uDD00 Merge",
                        {
                          onClick: "lcm-progress-drift-merge",
                          intent: "primary",
                        },
                      ),
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
        const sync = renderSync();
        if (sync) layers.push(sync);
        if (!drift && !progressDrift) {
          layers.push(renderProgressSection());
        }
        layers.push(entriesSection);
        return tray.stack(joinDividers(tray, layers), { gap: 3 });
      }
      const localSync = renderSync();
      return tray.stack(
        joinDividers(tray, [
          localSync,
          renderProgressSection(),
          entriesSection,
        ]),
        { gap: 3 },
      );
    }
    function renderFormHeader() {
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
    function renderFormProgressSection() {
      const isNew = editingId.get() === 0;
      const id = editingId.get();
      const rowProgress = isNew ? undefined : progress.get().manga[String(id)];
      const applyBusy = busyAction.get() === `apply-progress-${id}`;
      const showApply =
        !isNew && !!rowProgress && (hasEntryProgressDrift(id) || applyBusy);
      const drifting = hasDrift();
      const headerActions = [];
      if (!isNew && !drifting) {
        const openBusy = busyAction.get() === `open-manga-${id}`;
        const inListMediaId = mediaIdLookup.get()?.get(id);
        const computedMediaId = mediaIdFor(id);
        const resolvedMediaId = inListMediaId ?? computedMediaId;
        const openTooltip = openBusy
          ? "Opening …"
          : resolvedMediaId
            ? `Open in seanime · media #${resolvedMediaId}${inListMediaId == null ? " · not in your list" : ""}`
            : "Open in seanime · resolves on click";
        headerActions.push(
          tray.tooltip(
            tray.button(openBusy ? "⏳" : "Open →", {
              onClick: ctx.eventHandler(`lcm-form-open-manga-${id}`, () => {
                navigateToMangaEntry(id);
              }),
              size: "sm",
              intent: "gray-subtle",
            }),
            { text: openTooltip },
          ),
        );
      }
      if (showApply) {
        headerActions.push(
          tray.tooltip(
            tray.button(applyBusy ? "⏳" : "\uD83D\uDCE4 Apply", {
              onClick: ctx.eventHandler(`lcm-form-apply-progress-${id}`, () => {
                applyProgress(id);
              }),
              size: "sm",
              intent: "primary-subtle",
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
      const sub = [
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
          ...(isNew && gistMode
            ? [
                tray.alert({
                  title: "New entries need the unversioned Catalog URL",
                  description:
                    "New entries only show if the source's Catalog URL is the unversioned gist raw URL (no /<sha>/). Copy it with the \uD83D\uDCCB button in Gist binding.",
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
                [
                  tray.input("Start day", {
                    placeholder: "DD",
                    fieldRef: fDay,
                  }),
                ],
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
                [
                  tray.input("End day", {
                    placeholder: "DD",
                    fieldRef: fEndDay,
                  }),
                ],
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
    const currentLocalId = ctx.state(0);
    const localIdFromMediaId = (mediaId) => {
      if (!isCustomSourceId(mediaId)) return 0;
      let m;
      try {
        m = $anilist.getManga(mediaId);
      } catch {
        m = undefined;
      }
      const siteUrl = m?.siteUrl ?? "";
      if (siteUrl.indexOf(SOURCE_PREFIX) !== 0) return 0;
      return decodeLocalId(mediaId);
    };
    const pageBtn = ctx.action.newMangaPageButton({
      label: "Catalog ⚙️",
      intent: "primary-subtle",
      tooltipText: "Edit catalog entry",
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
      if (local > 0) {
        pullProgressSilent("opened entry");
      }
    });
    ctx.screen.loadCurrent();
    ctx.effect(() => {
      if (currentLocalId.get() > 0) pageBtn.mount();
      else pageBtn.unmount();
    }, [currentLocalId]);
    const palette = ctx.newCommandPalette({
      placeholder: "Local catalog…",
      keyboardShortcut: "l",
    });
    const refreshPalette = () => {
      const base = [
        { label: "+ New entry", value: "new", onSelect: () => openForm(0) },
        {
          label: "↻ Reload catalog",
          value: "lcm-reload-catalog",
          onSelect: () => void reloadCatalog(),
        },
        {
          label: "↻ Reload progress",
          value: "lcm-reload-progress",
          onSelect: () => void reloadProgress(),
        },
      ];
      const items = entries.get().map((en) => ({
        label: `⚙️ #${en.id} ${resolveUserPreferred(en.title) ?? ""}`,
        value: `edit-${en.id}`,
        filterType: "includes",
        onSelect: () => openForm(en.id),
      }));
      palette.setItems([...base, ...items]);
    };
    ctx.effect(() => refreshPalette(), [entries]);
    palette.onOpen(() => refreshPalette());
    const autoSync = ($getUserPreference("autoSync") ?? "false") === "true";
    if (autoSync && hasToken()) {
      const mins = Math.max(
        5,
        Number($getUserPreference("syncIntervalMinutes") ?? "30") || 30,
      );
      const expr =
        mins < 60 ? `*/${mins} * * * *` : `0 */${Math.round(mins / 60)} * * *`;
      try {
        ctx.cron.add("lcm-auto-pull", expr, () => {
          if (effectiveGistId()) {
            reloadCatalog();
            reloadProgress();
          }
        });
        ctx.cron.start();
      } catch (e) {
        ctx.toast.error(`Auto-sync schedule failed: ${e.message}`);
      }
    }
    tray.onOpen(() => {
      progress.set(loadProgressDoc());
      progressUpdated.set($storage.get(K_PROGRESS_UPDATED) ?? 0);
      (async () => {
        try {
          const collection = await ctx.manga.getCollection();
          refreshLookupsFromCollection(collection);
        } catch (e) {
          log.warn("mediaIdLookup refresh failed:", e);
        }
        if ($storage.get(K_EXT_ID) == null) {
          try {
            const result = await discoverExtId();
            if (result != null) {
              try {
                const fresh = await ctx.manga.getCollection();
                refreshLookupsFromCollection(fresh);
              } catch (_) {}
            }
          } catch (e) {
            log.warn("extId discovery failed:", e);
          }
        }
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
    tray.onClose(() => {
      bindingExpanded.set(false);
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
      const expanded = bindingExpanded.get();
      const drifting = hasDrift();
      const right = hasToken()
        ? [
            gid
              ? tray.badge("\uD83D\uDD17 Linked", { intent: "success" })
              : tray.badge("\uD83D\uDD13 Not linked", { intent: "gray" }),
            tray.tooltip(
              tray.button(expanded ? "△" : "⚙️", {
                onClick: "lcm-toggle-binding",
                size: "sm",
                disabled: drifting,
              }),
              {
                text: expanded
                  ? "Collapse gist details"
                  : "Manage gist binding",
              },
            ),
          ]
        : [
            tray.badge("\uD83D\uDCBB this device only", { intent: "gray" }),
            tray.tooltip(
              tray.button(expanded ? "△" : "⚠️", {
                onClick: "lcm-toggle-binding",
                size: "sm",
              }),
              {
                text: expanded
                  ? "Collapse local limitation"
                  : "Show local limitation",
              },
            ),
          ];
      const header = trayHeader(tray, {
        subtitle: hasToken() ? "Gist mode" : "Local mode",
        right,
      });
      return tray.stack(joinDividers(tray, [header, renderList()]), { gap: 3 });
    });
  };
  return register2(...args);
};

// src/plugins/local-catalog-manager/modules/shared-lib.ts
var sharedLib = (...args) => {
  var EXT_ID_OFFSET = 2147483648;
  var LOCAL_ID_RANGE = 1099511627776;
  function isCustomSourceId(mediaId) {
    return mediaId >= EXT_ID_OFFSET;
  }
  function decodeLocalId(mediaId) {
    return (mediaId - EXT_ID_OFFSET) % LOCAL_ID_RANGE;
  }
  function decodeExtId(mediaId) {
    return Math.floor((mediaId - EXT_ID_OFFSET) / LOCAL_ID_RANGE);
  }
  function encodeMediaId(extId, localId) {
    return EXT_ID_OFFSET + extId * LOCAL_ID_RANGE + localId;
  }
  function resolveUserPreferred(title) {
    if (typeof title === "string") {
      return title.trim() || undefined;
    }
    if (title && typeof title === "object") {
      const t = title;
      const v = t.userPreferred || t.english || t.romaji || t.native;
      return v?.trim() || undefined;
    }
    return;
  }
  function coerceTitle(title) {
    if (typeof title === "string") {
      const t = title.trim();
      return { userPreferred: t, english: t };
    }
    if (title && typeof title === "object") {
      const t = title;
      const up = t.userPreferred || t.english || t.romaji || t.native;
      return { ...t, userPreferred: up };
    }
    return {};
  }
  function parseNamespace(list, log2) {
    const byId = new Map();
    for (const item of list) {
      const entry = item;
      if (!entry || typeof entry !== "object") continue;
      const id = Number(entry.id);
      if (!Number.isInteger(id) || id < 1) {
        log2.warn("skipping entry with invalid id");
        continue;
      }
      if (!resolveUserPreferred(entry.title)) {
        log2.warn(`skipping entry ${id} with no title`);
        continue;
      }
      if (byId.has(id)) {
        log2.warn(`duplicate id ${id}, last wins`);
      }
      const out = {
        ...entry,
        id,
        title: coerceTitle(entry.title),
      };
      byId.set(id, out);
    }
    return Array.from(byId.values());
  }
  function parseCatalog(raw, log2) {
    let data = raw;
    if (typeof raw === "string") {
      try {
        data = JSON.parse(raw);
      } catch {
        return { manga: [], anime: [] };
      }
    }
    if (Array.isArray(data)) {
      return { manga: parseNamespace(data, log2), anime: [] };
    }
    if (data && typeof data === "object") {
      const doc = data;
      return {
        manga: Array.isArray(doc.manga) ? parseNamespace(doc.manga, log2) : [],
        anime: Array.isArray(doc.anime) ? parseNamespace(doc.anime, log2) : [],
      };
    }
    return { manga: [], anime: [] };
  }
  function canonicalizeKeys(value) {
    if (Array.isArray(value)) return value.map(canonicalizeKeys);
    if (value && typeof value === "object") {
      const obj = value;
      const head = ["id", "title"].filter((k) => k in obj);
      const rest = Object.keys(obj)
        .filter((k) => !head.includes(k))
        .sort();
      const out = {};
      for (const k of [...head, ...rest]) {
        if (obj[k] === null || obj[k] === undefined) continue;
        out[k] = canonicalizeKeys(obj[k]);
      }
      return out;
    }
    return value;
  }
  function serializeCatalog(manga, updatedAt, anime = []) {
    const doc = {
      version: 2,
      updatedAt,
      manga: manga.map(canonicalizeKeys),
      anime: anime.map(canonicalizeKeys),
    };
    return JSON.stringify(doc, null, 2);
  }
  function mergeCatalog(local, remote) {
    const byId = new Map();
    for (const e of remote) byId.set(e.id, e);
    for (const e of local) {
      const r = byId.get(e.id);
      if (!r || (e.updatedAt ?? 0) >= (r.updatedAt ?? 0)) byId.set(e.id, e);
    }
    return Array.from(byId.values()).sort((a, b) => a.id - b.id);
  }
  function catalogsEqual(a, b) {
    if (a.length !== b.length) return false;
    const norm = (list) =>
      JSON.stringify(
        [...list].sort((x, y) => x.id - y.id).map(canonicalizeKeys),
      );
    return norm(a) === norm(b);
  }
  function diffCatalog(local, remote) {
    const localIds = new Set(local.map((e) => e.id));
    const remoteIds = new Set(remote.map((e) => e.id));
    let conflicts = 0;
    let localOnly = 0;
    for (const id of localIds) {
      if (remoteIds.has(id)) conflicts++;
      else localOnly++;
    }
    let remoteOnly = 0;
    for (const id of remoteIds) {
      if (!localIds.has(id)) remoteOnly++;
    }
    return { localOnly, remoteOnly, conflicts };
  }
  function emptyDoc() {
    return { version: 1, updatedAt: 0, manga: {}, anime: {} };
  }
  function parseEntries(src, log2, label) {
    const out = {};
    if (!src || typeof src !== "object") return out;
    for (const [k, v] of Object.entries(src)) {
      if (!v || typeof v !== "object") continue;
      const updatedAt = typeof v.updatedAt === "number" ? v.updatedAt : 0;
      if (typeof v.updatedAt !== "number") {
        log2.warn(`${label} entry ${k} missing updatedAt, treating as 0`);
      }
      const { scoreRaw, ...rest } = v;
      if (scoreRaw != null && Number(scoreRaw) > 0 && rest.score == null) {
        rest.score = scoreRaw;
      }
      out[k] = { ...rest, updatedAt };
    }
    return out;
  }
  function parseProgress(raw, log2) {
    if (raw == null || raw === "") return emptyDoc();
    let data = raw;
    if (typeof raw === "string") {
      try {
        data = JSON.parse(raw);
      } catch {
        return emptyDoc();
      }
    }
    if (!data || typeof data !== "object") {
      return emptyDoc();
    }
    if (typeof data.version === "number" && data.version !== 1) {
      log2.warn(
        `progress.json version ${data.version} unknown, keeping entries`,
      );
    }
    return {
      version: typeof data.version === "number" ? data.version : 1,
      updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : 0,
      manga: parseEntries(data.manga, log2, "progress"),
      anime: parseEntries(data.anime, log2, "anime"),
    };
  }
  function serializeEntries(map) {
    const out = {};
    const ids = Object.keys(map).sort((a, b) => Number(a) - Number(b));
    for (const id of ids) {
      const e = map[id];
      const sorted = {};
      for (const k of Object.keys(e).sort()) {
        const val = e[k];
        if (val === null || val === undefined) continue;
        if (k === "score" && Number(val) === 0) continue;
        sorted[k] = val;
      }
      out[id] = sorted;
    }
    return out;
  }
  function serializeProgress(doc) {
    const stable = {
      version: doc.version ?? 1,
      updatedAt: doc.updatedAt ?? 0,
      manga: serializeEntries(doc.manga),
      anime: serializeEntries(doc.anime ?? {}),
    };
    return JSON.stringify(stable, null, 2);
  }
  function mergeEntries(local, remote) {
    const out = {};
    const ids = new Set([...Object.keys(local), ...Object.keys(remote)]);
    for (const id of ids) {
      const l = local[id];
      const r = remote[id];
      if (!l) {
        out[id] = { ...r };
        continue;
      }
      if (!r) {
        out[id] = { ...l };
        continue;
      }
      const lu = l.updatedAt ?? 0;
      const ru = r.updatedAt ?? 0;
      if (lu !== ru) {
        out[id] = lu > ru ? { ...l } : { ...r };
        continue;
      }
      const lp = l.progress ?? 0;
      const rp = r.progress ?? 0;
      out[id] = lp >= rp ? { ...l } : { ...r };
    }
    return out;
  }
  function mergeProgress(local, remote, now = 0) {
    return {
      version: 1,
      updatedAt: now,
      manga: mergeEntries(local.manga, remote.manga),
      anime: mergeEntries(local.anime ?? {}, remote.anime ?? {}),
    };
  }
  function progressMangaEquals(a, b) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    for (const k of aKeys) {
      if (!(k in b)) return false;
      const ae = a[k];
      const be = b[k];
      if (Number(ae.updatedAt ?? 0) !== Number(be.updatedAt ?? 0)) return false;
      if (Number(ae.progress ?? 0) !== Number(be.progress ?? 0)) return false;
      if (Number(ae.score ?? 0) !== Number(be.score ?? 0)) return false;
      if (Number(ae.repeat ?? 0) !== Number(be.repeat ?? 0)) return false;
      if (String(ae.startedAt ?? "") !== String(be.startedAt ?? ""))
        return false;
      if (String(ae.completedAt ?? "") !== String(be.completedAt ?? "")) {
        return false;
      }
      if (String(ae.status ?? "") !== String(be.status ?? "")) return false;
    }
    return true;
  }
  function diffProgress(local, remote) {
    const localIds = new Set(Object.keys(local.manga));
    const remoteIds = new Set(Object.keys(remote.manga));
    let conflicts = 0;
    let localOnly = 0;
    for (const id of localIds) {
      if (!remoteIds.has(id)) {
        localOnly++;
        continue;
      }
      const l = local.manga[id];
      const r = remote.manga[id];
      if (
        l.status !== r.status ||
        l.progress !== r.progress ||
        l.score !== r.score
      ) {
        conflicts++;
      }
    }
    let remoteOnly = 0;
    for (const id of remoteIds) {
      if (!localIds.has(id)) remoteOnly++;
    }
    return { localOnly, remoteOnly, conflicts };
  }
  function createLogger() {
    const prefix = `[${"local-catalog-manager"}]`;
    return {
      log: (...args2) => console.log(prefix, ...args2),
      info: (...args2) => console.info(prefix, ...args2),
      warn: (...args2) => console.warn(prefix, ...args2),
      error: (...args2) => console.error(prefix, ...args2),
      debug: (...args2) => console.debug(prefix, ...args2),
    };
  }
  function nextId(entries) {
    let max = 0;
    for (const e of entries) {
      if (e.id > max) max = e.id;
    }
    return max + 1;
  }
  function upsertEntry(entries, entry) {
    const out = entries.filter((e) => e.id !== entry.id);
    out.push(entry);
    out.sort((a, b) => a.id - b.id);
    return out;
  }
  function removeEntry(entries, id) {
    return entries.filter((e) => e.id !== id);
  }
  function validateEntry(entry) {
    if (!Number.isInteger(entry.id) || entry.id < 1) {
      return "id must be a positive integer";
    }
    const t = entry.title;
    const titleStr =
      t?.userPreferred || t?.english || t?.romaji || t?.native || "";
    if (titleStr.trim().length === 0) {
      return "title is required";
    }
    return null;
  }

  class GistClient {
    constructor(token, fetchFn) {
      this.token = token;
      this.fetchFn = fetchFn;
    }
    headers() {
      return {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      };
    }
    rawUrl(owner, id, filename) {
      return `https://gist.githubusercontent.com/${owner}/${id}/raw/${filename}`;
    }
    async createGist(filename, content) {
      const res = await this.fetchFn("https://api.github.com/gists", {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          public: false,
          description: "Seanime local catalog and progress sync",
          files: { [filename]: { content } },
        }),
      });
      if (!res.ok) {
        throw new Error(`createGist failed: ${res.status} ${res.text()}`);
      }
      const data = res.json();
      const owner = data.owner?.login ?? "";
      return {
        id: data.id,
        owner,
        rawUrl: this.rawUrl(owner, data.id, filename),
      };
    }
    async getGistFile(id, filename) {
      const res = await this.fetchFn(`https://api.github.com/gists/${id}`, {
        method: "GET",
        headers: this.headers(),
      });
      if (!res.ok) {
        throw new Error(`getGist failed: ${res.status} ${res.text()}`);
      }
      const data = res.json();
      return data.files?.[filename]?.content ?? "";
    }
    async getGistFileWithInfo(id, filename) {
      const res = await this.fetchFn(`https://api.github.com/gists/${id}`, {
        method: "GET",
        headers: this.headers(),
      });
      if (!res.ok) {
        throw new Error(`getGist failed: ${res.status} ${res.text()}`);
      }
      const data = res.json();
      const owner = data.owner?.login ?? "";
      return {
        owner,
        rawUrl: this.rawUrl(owner, id, filename),
        content: data.files?.[filename]?.content ?? "",
      };
    }
    async updateGistFile(id, filename, content) {
      const res = await this.fetchFn(`https://api.github.com/gists/${id}`, {
        method: "PATCH",
        headers: this.headers(),
        body: JSON.stringify({ files: { [filename]: { content } } }),
      });
      if (!res.ok) {
        throw new Error(`updateGist failed: ${res.status} ${res.text()}`);
      }
    }
    async deleteGist(id) {
      const res = await this.fetchFn(`https://api.github.com/gists/${id}`, {
        method: "DELETE",
        headers: this.headers(),
      });
      if (!res.ok && res.status !== 404) {
        throw new Error(`deleteGist failed: ${res.status} ${res.text()}`);
      }
    }
  }
  var log = createLogger();
  function applyRemote(merged, local, deps) {
    let applied = 0;
    let skipped = 0;
    for (const [localIdStr, entry] of Object.entries(merged.manga)) {
      const before = local.manga[localIdStr];
      if (before && (before.updatedAt ?? 0) >= (entry.updatedAt ?? 0)) continue;
      const mediaId = deps.mediaIdByLocalId.get(Number(localIdStr));
      if (mediaId == null) {
        skipped++;
        log.warn(
          `orphan progress for localId ${localIdStr} (not in collection)`,
        );
        continue;
      }
      deps.updateEntry(
        mediaId,
        entry.status,
        entry.score,
        entry.progress,
        undefined,
        undefined,
      );
      applied++;
    }
    return { applied, skipped };
  }
  function buildMediaIdLookup(collection, prefix, decodeLocalId2, opts = {}) {
    const map = new Map();
    const lists = collection.lists ?? [];
    for (const l of lists) {
      const entries = l.entries ?? [];
      for (const e of entries) {
        const mediaId = e.media?.id;
        if (typeof mediaId !== "number") continue;
        if (opts.extId != null) {
          if (!isCustomSourceId(mediaId)) continue;
          if (decodeExtId(mediaId) !== opts.extId) continue;
        } else {
          const siteUrl = e.media?.siteUrl;
          if (!siteUrl || siteUrl.indexOf(prefix) !== 0) continue;
        }
        map.set(decodeLocalId2(mediaId), mediaId);
      }
    }
    return map;
  }
  function detectOrphans(local, catalogIds) {
    const out = [];
    for (const key of Object.keys(local.manga)) {
      const n = Number(key);
      if (!Number.isFinite(n)) continue;
      if (!catalogIds.has(n)) out.push(n);
    }
    return out;
  }
  function pruneOrphans(local, orphans, now) {
    const orphanSet = new Set(orphans.map(String));
    const cleaned = {
      version: 1,
      updatedAt: now,
      manga: {},
      anime: local.anime ?? {},
    };
    for (const [k, v] of Object.entries(local.manga)) {
      if (!orphanSet.has(k)) cleaned.manga[k] = { ...v };
    }
    return cleaned;
  }
  async function pushProgress(client, gistId, filename, local, now) {
    let remoteStr = "";
    try {
      remoteStr = await client.getGistFile(gistId, filename);
    } catch (_) {
      remoteStr = "";
    }
    const remote = parseProgress(remoteStr, log);
    const merged = mergeProgress(local, remote, now);
    await client.updateGistFile(gistId, filename, serializeProgress(merged));
    return merged;
  }
  async function pullProgress(client, gistId, filename, local, now) {
    let remoteStr = "";
    try {
      remoteStr = await client.getGistFile(gistId, filename);
    } catch (_) {
      remoteStr = "";
    }
    const remote = parseProgress(remoteStr, log);
    return mergeProgress(local, remote, now);
  }
  async function handlePostUpdate(ctx) {
    const {
      localId,
      payload,
      now,
      local,
      client,
      gistId,
      filename,
      applyToSeanime,
      persistLocal,
    } = ctx;
    const key = String(localId);
    const merge = (prev) => ({ ...prev, ...payload, updatedAt: now });
    if (!client) {
      local.manga[key] = merge(local.manga[key]);
      local.updatedAt = now;
      persistLocal(local, now);
      return "persist-local-only";
    }
    if (local.manga[key]) {
      local.manga[key] = merge(local.manga[key]);
      local.updatedAt = now;
      persistLocal(local, now);
      await pushProgress(client, gistId, filename, local, now);
      return "push";
    }
    let remoteStr = "";
    try {
      remoteStr = await client.getGistFile(gistId, filename);
    } catch (_) {
      remoteStr = "";
    }
    const remote = parseProgress(remoteStr, log);
    const remoteEntry = remote.manga[key];
    if (remoteEntry) {
      const restored = { ...remoteEntry };
      local.manga[key] = restored;
      local.updatedAt = now;
      persistLocal(local, now);
      applyToSeanime(restored);
      return "restore";
    }
    local.manga[key] = merge(undefined);
    local.updatedAt = now;
    persistLocal(local, now);
    await pushProgress(client, gistId, filename, local, now);
    return "push-new";
  }
  var sharedLib2 = () => ({
    createLogger,
    GistClient,
    coerceTitle,
    parseCatalog,
    resolveUserPreferred,
    serializeCatalog,
    mergeCatalog,
    diffCatalog,
    catalogsEqual,
    upsertEntry,
    removeEntry,
    nextId,
    validateEntry,
    decodeLocalId,
    decodeExtId,
    encodeMediaId,
    isCustomSourceId,
    parseProgress,
    serializeProgress,
    mergeProgress,
    diffProgress,
    progressMangaEquals,
    buildMediaIdLookup,
    applyRemote,
    detectOrphans,
    pruneOrphans,
    pullProgress,
    pushProgress,
    handlePostUpdate,
  });
  return sharedLib2(...args);
};

// src/plugins/local-catalog-manager/utils/constants.ts
var SHARED_LIB_NAME = "local-catalog-manager";

// src/plugins/local-catalog-manager/code.ts
function init() {
  $shared.define(SHARED_LIB_NAME, sharedLib);
  $app.onPreUpdateEntry(onPreUpdateEntry);
  $app.onPostUpdateEntry(onPostUpdateEntry);
  $app.onPreUpdateEntryProgress(onPreUpdateEntryProgress);
  $app.onPostUpdateEntryProgress(onPostUpdateEntryProgress);
  $app.onGetMangaCollection(onGetMangaCollection);
  $ui.register(register);
}
