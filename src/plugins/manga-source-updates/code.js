// src/plugins/manga-source-updates/modules/register.ts
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
  async function domAttr(el, key) {
    const sync = el.attributes?.[key];
    if (sync != null && sync !== "") return String(sync);
    try {
      const async = await el.getAttribute(key);
      if (async != null && async !== "") return String(async);
    } catch {}
    return;
  }
  async function parseDomNumber(el) {
    if (!el) return null;
    const sync = String(el.textContent ?? "").trim();
    if (sync && !Number.isNaN(Number(sync))) return Number(sync);
    try {
      const async = String((await el.getText()) ?? "").trim();
      if (async && !Number.isNaN(Number(async))) return Number(async);
    } catch {}
    return null;
  }
  function decideDecoration(existingSigs, desiredSig) {
    return existingSigs.length === 1 && existingSigs[0] === desiredSig
      ? "skip"
      : "rebuild";
  }
  function createDomDecorator(ctx) {
    const locks = new Set();
    const dirty = new Set();
    const observers = [];
    const passes = [];
    let stops = [];
    function observe(selector, cb, opts) {
      observers.push({ selector, cb, opts });
    }
    function pass(fn) {
      passes.push(fn);
    }
    function refresh() {
      for (const p of passes) p();
    }
    function arm() {
      for (const s of stops) {
        try {
          s();
        } catch {}
      }
      stops = [];
      for (const { selector, cb, opts } of observers) {
        const [stop] = ctx.dom.observe(selector, cb, opts);
        stops.push(stop);
      }
      refresh();
    }
    async function decorate(el, o) {
      const lk = `${o.marker}:${o.lockKey}`;
      if (locks.has(lk)) {
        dirty.add(lk);
        return;
      }
      locks.add(lk);
      try {
        const desiredSig = typeof o.sig === "function" ? await o.sig() : o.sig;
        const scope = o.scope ?? el;
        const sigAttr = `data-${o.marker}-sig`;
        let existing = [];
        try {
          existing = (await scope.query(`[data-${o.marker}]`)) ?? [];
        } catch {
          existing = [];
        }
        const sigs = [];
        for (const x of existing) {
          const sig = (await domAttr(x, sigAttr)) ?? "";
          sigs.push(sig);
        }
        if (decideDecoration(sigs, desiredSig) === "skip") return;
        for (const x of existing) {
          try {
            x.remove();
          } catch {}
        }
        const node = await ctx.dom.createElement("div");
        node.setAttribute(`data-${o.marker}`, "1");
        node.setAttribute(sigAttr, desiredSig);
        await o.render(node);
      } catch {
      } finally {
        locks.delete(lk);
        if (dirty.delete(lk)) decorate(el, o);
      }
    }
    function start() {
      arm();
      ctx.dom.onMainTabReady(arm);
      ctx.dom.onReady(arm);
    }
    return { observe, pass, refresh, arm, decorate, start };
  }
  var LABEL_STYLE = {
    fontSize: "0.7rem",
    fontWeight: "700",
    opacity: "0.55",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
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
    const title = String(opts.title ?? "Manga Source Updates");
    const iconUrl =
      opts.iconUrl == null
        ? "https://raw.githubusercontent.com/Carloss616/seanime-extensions/main/src/plugins/manga-source-updates/assets/icon.png"
        : String(opts.iconUrl);
    const subtitle =
      opts.subtitle != null
        ? String(opts.subtitle)
        : opts.title != null
          ? String("Manga Source Updates")
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
  function createLogger() {
    const prefix = `[${"manga-source-updates"}]`;
    return {
      log: (...args2) => console.log(prefix, ...args2),
      info: (...args2) => console.info(prefix, ...args2),
      warn: (...args2) => console.warn(prefix, ...args2),
      error: (...args2) => console.error(prefix, ...args2),
      debug: (...args2) => console.debug(prefix, ...args2),
    };
  }
  var scan_panel_default = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>MSU scan</title><style>
/* seanime's Tailwind + theme tokens are NOT loaded inside a webview iframe
   (it's a blank, transparent sandbox — see the webview docs). So mirror the
   native look here: reuse seanime's class-name vocabulary (UI-Modal card,
   UI-Badge__root, UI-Button_root) but define the tokens + component styles
   locally. Dark is the default; prefers-color-scheme swaps to light. */
:root{
  color-scheme:dark light;
  --paper:#0d0d0f;
  --foreground:#e4e4e7;
  --muted:#8b8b93;
  --border:rgb(255 255 255 / 6%);
  --subtle:rgb(255 255 255 / 6%);
  --track:rgb(255 255 255 / 10%);
  --red:#ef4444;
  --red-subtle:rgb(239 68 68 / 12%);
  --red-subtle-hover:rgb(239 68 68 / 20%);
  --brand:#3b82f6;
  --radius-md:.5rem;
  --radius-2xl:1rem;
}
@media (prefers-color-scheme:light){
  :root{
    --paper:#ffffff;
    --foreground:#18181b;
    --muted:#71717a;
    --border:rgb(0 0 0 / 8%);
    --subtle:rgb(0 0 0 / 5%);
    --track:rgb(0 0 0 / 8%);
    --red-subtle:rgb(239 68 68 / 10%);
    --red-subtle-hover:rgb(239 68 68 / 18%);
  }
}
*{box-sizing:border-box}
html,body{margin:0;width:100%;height:100%;overflow:hidden}
body{background:transparent;font-family:-apple-system,system-ui,sans-serif}

/* UI-Modal-like floating card (bg-[--paper] + subtle border + rounded-2xl + shadow-xl).
   Row layout: full-height cover on the left, a content column on the right whose
   body sits on top and an action footer at the bottom — the footer keeps the
   Cancel button clear of the top drag zone. */
.UI-Modal__content{
  width:100%;height:100%;display:flex;align-items:stretch;gap:10px;
  padding:10px 12px;color:var(--foreground);
  background:var(--paper);border:1px solid var(--border);
  border-radius:var(--radius-2xl);box-shadow:0 10px 30px rgb(0 0 0 / 35%);
}
/* cover box: spans the full card height, rounded-[--radius-md], object-cover —
   clickable (opens the entry). */
.cover{
  flex:0 0 auto;width:40px;height:100%;border-radius:var(--radius-md);
  object-fit:cover;background:var(--subtle);display:none;cursor:pointer;
  transition:opacity .15s ease;
}
.cover:hover{opacity:.82}
/* right column: body (grows) + footer */
.content{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:8px}
/* body: count/title/progress. This is the top → drag zone. */
.body{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;justify-content:center;gap:5px}
.top{display:flex;flex-direction:column;gap:1px;min-width:0}

/* UI-Badge__root (neutral / gray variant from seanime) */
.UI-Badge__root{
  display:inline-flex;align-items:center;align-self:flex-start;height:1.5rem;padding:0 .5rem;
  font-size:.72rem;font-weight:600;letter-spacing:.02em;line-height:1;
  border-radius:9999px;background:var(--subtle);color:var(--foreground);
  border:1px solid var(--border);font-variant-numeric:tabular-nums;white-space:nowrap;
}
.title{font-size:.72rem;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

.bar{width:100%;height:6px;border-radius:3px;background:var(--track);overflow:hidden}
.fill{height:100%;background:var(--brand);width:0%;transition:width .25s ease}

/* footer: right-aligned action row, like the dialog's \`flex gap-2\` button bar */
.footer{display:flex;align-items:center;justify-content:flex-end;gap:8px}

/* UI-Button_root — alert/red subtle variant (text-[--red] bg-red-50 dark:bg-opacity-10) */
.UI-Button_root{
  cursor:pointer;display:inline-flex;align-items:center;gap:.25rem;flex:0 0 auto;
  font-size:.75rem;font-weight:500;line-height:1;height:2rem;padding:0 .75rem;
  border-radius:var(--radius-md);border:1px solid transparent;
  transition:all .15s cubic-bezier(.25,1,.5,1);
}
.UI-Button_root--alert{color:var(--red);background:var(--red-subtle)}
.UI-Button_root--alert:hover{background:var(--red-subtle-hover)}
.UI-Button_root--alert:active{transform:scale(.98)}
</style></head><body>
<div class="UI-Modal__content">
  <img class="cover" id="cover" alt="cover">
  <div class="content">
    <div class="body">
      <div class="top">
        <span class="UI-Badge__root" id="count">Scanning…</span>
        <div class="title" id="title"></div>
      </div>
      <div class="bar"><div class="fill" id="fill"></div></div>
    </div>
    <div class="footer">
      <button class="UI-Button_root UI-Button_root--alert" id="cancel" type="button">⌫ Cancel</button>
    </div>
  </div>
</div>
<script>
  var cancelBtn = document.getElementById("cancel");
  var cover = document.getElementById("cover");
  var lastMediaId = 0;
  // Stop the drag from starting on an interactive element (seanime's drag handler
  // listens inside the iframe), otherwise a mousedown begins a window drag and the
  // click never fires.
  ["mousedown","pointerdown","touchstart"].forEach((evt) => {
    cancelBtn.addEventListener(evt, (e) => e.stopPropagation());
    cover.addEventListener(evt, (e) => e.stopPropagation());
  });
  cancelBtn.addEventListener("click", () => {
    window.webview.send("panel-cancel", {});
  });
  cover.addEventListener("click", () => {
    if (lastMediaId) window.webview.send("panel-open", lastMediaId);
  });
  window.webview.on("scan", (s)=> {
    if(!s) return;
    lastMediaId = s.mediaId || 0;
    var word = s.kind === "sources" ? "Checking sources" : "Scanning manga";
    document.getElementById("count").textContent =
      s.cancelling ? "Cancelling…" : \`\${word} \${s.done}/\${s.total}\`;
    document.getElementById("title").textContent = s.title || "";
    // Once cancelling, the request is in — freeze the button so it can't re-fire
    // (disabled already blocks the click; opacity just dims it).
    cancelBtn.disabled = !!s.cancelling;
    cancelBtn.style.opacity = s.cancelling ? "0.5" : "1";
    if (s.cover) { cover.src = s.cover; cover.style.display = "block"; }
    else { cover.removeAttribute("src"); cover.style.display = "none"; }
    var pct = s.total ? Math.round(s.done / s.total * 100) : 0;
    document.getElementById("fill").style.width = \`\${pct}%\`;
  });
</script>
</body></html>
`;
  async function readCardAttrs(el) {
    const fromAttr = Number((await domAttr(el, "data-media-id")) ?? 0);
    let progress = 0;
    let mediaId = fromAttr;
    try {
      const ld = (await domAttr(el, "data-list-data")) ?? "";
      if (ld) {
        const parsed = JSON.parse(ld);
        progress = Number(parsed.progress ?? 0);
        if (!mediaId) {
          mediaId = Number(parsed.mediaId ?? parsed.media?.id ?? 0);
        }
      }
    } catch {}
    return { mediaId, progress };
  }
  function latestChapter(chapters) {
    let max = 0;
    for (const ch of chapters) {
      const n = Number.parseFloat(String(ch.chapter));
      if (!Number.isNaN(n) && n > max) max = n;
    }
    return max;
  }
  function unreadChapters(read, latest) {
    return Math.max(0, Math.floor(latest - read));
  }
  function makeProbe(provider, providerName, chapters) {
    return {
      provider,
      providerName: String(providerName),
      latest: chapters ? latestChapter(chapters) : 0,
      count: chapters?.length ?? 0,
      matched: !!chapters && chapters.length > 0,
      errored: chapters == null,
      updatedAt: 0,
    };
  }
  function classify(read, latest, count, errored, gap) {
    if (errored) return "error-found";
    if (count === 0) return "not-matched";
    if (read > 0 && read - latest >= gap) return "outdated";
    return unreadChapters(read, latest) > 0 ? "new" : "up-to-date";
  }
  function isBadKind(kind) {
    return (
      kind === "not-matched" || kind === "error-found" || kind === "outdated"
    );
  }
  var NO_MATCH_RX =
    /no results|not found|no chapters|no manga|could ?n'?o?t find|not matched|no search result|0 result/i;
  function isNoMatchError(message) {
    return NO_MATCH_RX.test(String(message));
  }
  function readingEntries(col) {
    const out = [];
    for (const list of col.lists ?? []) {
      if (String(list.status) !== "CURRENT") continue;
      for (const e of list.entries ?? []) {
        if (e?.media) out.push(e);
      }
    }
    return out;
  }
  var K_EXCLUSIONS = "exclusions";
  var K_SUMMARIES = "summaries";
  var K_PINS = "pins";
  var K_PROBES = "probes";
  var K_MATCHES = "matches";
  var K_INSTANCE_ID = "instanceId";
  var K_SOURCES = "sources";
  var REASONS = {
    outdated: { menu: "Behind / outdated", badge: "behind", intent: "warning" },
    "bad-numbering": {
      menu: "Wrong chapter numbers",
      badge: "bad numbers",
      intent: "warning",
    },
    "not-matched": { menu: "No match", badge: "no match", intent: "warning" },
    "error-found": { menu: "Fetch error", badge: "error", intent: "alert" },
    other: { menu: "Other", badge: "manual", intent: "gray" },
  };
  var reasonLabel = (key) => REASONS[key].badge;
  var reasonIntent = (key) => REASONS[key].intent;
  function clearedExclusions(excluded, pinned, mediaId, now) {
    const scopeKeys =
      mediaId == null ? Object.keys(excluded) : [String(mediaId)];
    const pinScopeKeys =
      mediaId == null ? Object.keys(pinned) : [String(mediaId)];
    const nextExcluded = { ...excluded };
    for (const key of scopeKeys) {
      const providers = nextExcluded[key];
      if (!providers) continue;
      const nextProviders = { ...providers };
      for (const [pid, rec] of Object.entries(providers)) {
        if (rec.deletedAt == null) {
          nextProviders[pid] = { ...rec, updatedAt: now, deletedAt: now };
        }
      }
      nextExcluded[key] = nextProviders;
    }
    const nextPinned = { ...pinned };
    for (const key of pinScopeKeys) {
      const providers = nextPinned[key];
      if (!providers) continue;
      const nextProviders = { ...providers };
      for (const [pid, rec] of Object.entries(providers)) {
        if (rec.deletedAt == null) {
          nextProviders[pid] = { ...rec, updatedAt: now, deletedAt: now };
        }
      }
      nextPinned[key] = nextProviders;
    }
    return { excluded: nextExcluded, pinned: nextPinned };
  }
  function createHeaderProgressReader(ctx) {
    let cache = null;
    const read = async (badgeEl) => {
      const fromBadge = await parseDomNumber(badgeEl);
      if (fromBadge != null) return fromBadge;
      if (badgeEl == null && cache != null) return cache;
      try {
        const els = await ctx.dom.query(
          "[data-media-page-header-progress-badge-progress]",
        );
        return await parseDomNumber(els?.[0]);
      } catch {
        return null;
      }
    };
    return {
      read,
      setCache: (v) => {
        cache = v;
      },
      clearCache: () => {
        cache = null;
      },
    };
  }
  function upsertMatch(map, mediaId, provider, mappedId, by, now) {
    const key = String(mediaId);
    const rec = { mappedId, by, updatedAt: now };
    return { ...map, [key]: { ...(map[key] ?? {}), [provider]: rec } };
  }
  function tombstoneMatch(map, mediaId, provider, now) {
    const key = String(mediaId);
    const inner = { ...(map[key] ?? {}) };
    const prev = inner[provider];
    if (prev) inner[provider] = { ...prev, updatedAt: now, deletedAt: now };
    return { ...map, [key]: inner };
  }
  function resolveMatchAction(sig, existing) {
    const live = isLive(existing) ? existing : undefined;
    if (sig === "none" || sig === "empty") {
      return live ? { type: "tombstone" } : { type: "none" };
    }
    const mappedId = sig === "present" ? "" : sig;
    if (live && live.mappedId === mappedId) return { type: "none" };
    return { type: "upsert", mappedId };
  }
  function getMatches() {
    const raw = $storage.get(K_MATCHES);
    return raw && typeof raw === "object" ? raw : {};
  }
  function setMatches(map) {
    $storage.set(K_MATCHES, map);
  }
  function readObj(key) {
    const raw = $storage.get(key);
    return raw != null && typeof raw === "object" ? raw : {};
  }
  function isLive(rec) {
    return rec != null && rec.deletedAt == null;
  }
  function liveExcludedView(map) {
    const out = {};
    for (const [media, providers] of Object.entries(map)) {
      const inner = {};
      for (const [pid, rec] of Object.entries(providers)) {
        if (isLive(rec)) inner[pid] = rec.reason;
      }
      out[media] = inner;
    }
    return out;
  }
  function livePinnedView(map) {
    const out = {};
    for (const [media, providers] of Object.entries(map)) {
      out[media] = Object.entries(providers)
        .filter(([, rec]) => isLive(rec))
        .map(([pid]) => pid);
    }
    return out;
  }
  function mergeProbeTimestamps(prev, next, now) {
    const out = {};
    for (const [pid, probe] of Object.entries(next)) {
      const before = prev[pid];
      const same =
        before != null &&
        before.latest === probe.latest &&
        before.count === probe.count &&
        before.matched === probe.matched &&
        before.errored === probe.errored;
      out[pid] = { ...probe, updatedAt: same ? before.updatedAt : now };
    }
    return out;
  }
  function getExcluded() {
    return readObj(K_EXCLUSIONS);
  }
  function setExcluded(map) {
    $storage.set(K_EXCLUSIONS, map);
  }
  function getExcludedView() {
    return liveExcludedView(getExcluded());
  }
  function getPinned() {
    return readObj(K_PINS);
  }
  function setPinned(map) {
    $storage.set(K_PINS, map);
  }
  function getPinnedView() {
    return livePinnedView(getPinned());
  }
  function getResults() {
    return readObj(K_SUMMARIES);
  }
  function setResults(map) {
    $storage.set(K_SUMMARIES, map);
  }
  function getProbes() {
    return readObj(K_PROBES);
  }
  function setProbes(map) {
    $storage.set(K_PROBES, map);
  }
  function hydrateResults() {
    const stored = getResults();
    const out = [];
    for (const key of Object.keys(stored)) {
      const r = stored[key];
      if (!isLive(r)) continue;
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
  function hydrateProbes() {
    return getProbes();
  }
  function deriveInstanceId(existing, now, rand) {
    if (typeof existing === "string" && existing.length > 0) return existing;
    const suffix = rand.toString(36).slice(2) || "0";
    return `${now}-${suffix}`;
  }
  function getInstanceId() {
    const id = deriveInstanceId(
      $storage.get(K_INSTANCE_ID),
      Date.now(),
      Math.random(),
    );
    $storage.set(K_INSTANCE_ID, id);
    return id;
  }
  function mappingSigFromHtml(html) {
    const h = html.toLowerCase();
    if (h.includes("no manual match")) return "none";
    const m = /current mapping:\s*<span[^>]*>([^<]*)<\/span>/i.exec(html);
    if (m) {
      const id = m[1].trim();
      return id || "empty";
    }
    if (h.includes("current mapping:")) return "present";
    return null;
  }
  function isManualMatchConfirmDialog(html) {
    const h = html.toLowerCase();
    return h.includes("are you sure") && !h.includes("current mapping:");
  }
  function isActiveProvider(pid, installed) {
    return pid !== "local-manga" && pid in installed;
  }
  function pruneInactiveProbes(probes, installed) {
    const out = {};
    for (const [pid, p] of Object.entries(probes)) {
      if (isActiveProvider(pid, installed)) out[pid] = p;
    }
    return out;
  }
  function normalizeProviderId(raw) {
    return String(raw ?? "")
      .trim()
      .replace(/^["']|["']$/g, "");
  }
  async function readSelectedProvider(ctx, container) {
    try {
      const cont =
        container ??
        (await ctx.dom.query("[data-chapter-list-container]"))?.[0];
      if (!cont) return "";
      return normalizeProviderId(
        String((await domAttr(cont, "data-selected-provider")) ?? ""),
      );
    } catch {
      return "";
    }
  }
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
  function parseCustomSourceManifestId(siteUrl) {
    const PREFIX = "ext_custom_source_";
    if (!siteUrl || siteUrl.indexOf(PREFIX) !== 0) return;
    const end = siteUrl.indexOf("|END|");
    if (end < 0) return;
    const id = siteUrl.slice(PREFIX.length, end);
    return id || undefined;
  }
  function buildSourceRef(mediaId, siteUrl, now) {
    if (!isCustomSourceId(mediaId)) return;
    const manifestId = parseCustomSourceManifestId(siteUrl);
    if (!manifestId) return;
    return {
      manifestId,
      localId: decodeLocalId(mediaId),
      extId: decodeExtId(mediaId),
      updatedAt: now,
    };
  }
  function upsertSourceRef(map, mediaId, ref) {
    const key = String(mediaId);
    const prev = map[key];
    if (prev && prev.deletedAt == null && prev.manifestId === ref.manifestId) {
      return { map, changed: false };
    }
    return { map: { ...map, [key]: ref }, changed: true };
  }
  function getSources() {
    const raw = $storage.get(K_SOURCES);
    return raw && typeof raw === "object" ? raw : {};
  }
  function setSources(map) {
    $storage.set(K_SOURCES, map);
  }
  function statusFor(r, thinLabel = false) {
    const n = unreadChapters(r.read, r.latest);
    const m = n > 0 ? (r.newSources ?? 0) : 0;
    const label = thinLabel
      ? n > 0
        ? `+${n}`
        : "0"
      : n > 0
        ? `+${n} · ${m}`
        : "0 · 0";
    const nmTip = `${n} unread by ${m} source${m === 1 ? "" : "s"}`;
    const MAP = {
      new: { label, intent: "success", tip: nmTip },
      "up-to-date": { label, intent: "gray", tip: nmTip },
      outdated: { label, intent: "warning", tip: nmTip },
      "not-matched": {
        label: thinLabel ? "−" : "no match",
        intent: "warning",
        tip: "No source matched",
      },
      "all-excluded": {
        label: thinLabel ? "−" : "all excluded",
        intent: "warning",
        tip: "All sources excluded",
      },
      "error-found": {
        label: thinLabel ? "X" : "error",
        intent: "alert",
        tip: "Source errored",
      },
    };
    return MAP[r.kind] ?? MAP["error-found"];
  }
  function cardBadgeKind(row, progress, gap) {
    let kind = row.kind;
    if (kind === "new" || kind === "up-to-date" || kind === "outdated") {
      kind = classify(progress, row.latest, row.sources, false, gap);
    }
    return kind;
  }
  function collectTitles(media) {
    const t = media.title ?? {};
    const raw = [
      t.userPreferred,
      t.english,
      t.romaji,
      ...(media.synonyms ?? []),
    ];
    const seen = {};
    const out = [];
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
  function resolveTitle(media) {
    const t = media.title ?? {};
    return String(t.userPreferred ?? t.english ?? t.romaji ?? "Unknown");
  }
  var register2 = (ctx) => {
    const log = createLogger();
    const tray = ctx.newTray({
      iconUrl:
        "https://raw.githubusercontent.com/Carloss616/seanime-extensions/main/src/plugins/manga-source-updates/assets/icon.png",
      withContent: true,
    });
    let trayIsOpen = false;
    const noSearchRef = ctx.fieldRef("");
    const scanning = ctx.state(false);
    const cancelRequested = ctx.state(false);
    const hydrated = hydrateResults();
    const status = ctx.state(
      hydrated.length ? "Showing last scan — Scan to refresh" : "",
    );
    const results = ctx.state(hydrated);
    const detailId = ctx.state(null);
    const detailTitle = ctx.state("");
    const detailCover = ctx.state("");
    const detailRead = ctx.state(0);
    const probingId = ctx.state(null);
    const scanningProvider = ctx.state("");
    const scanProgress = ctx.state(null);
    const scanningProviders = ctx.state(null);
    const scanStatus = ctx.state(null);
    const probeCache = ctx.state(hydrateProbes());
    function setProbes2(mediaId, probes) {
      const prev = probeCache.get()[mediaId] ?? {};
      const stamped = mergeProbeTimestamps(prev, probes, Date.now());
      const next = { ...probeCache.get(), [mediaId]: stamped };
      probeCache.set(next);
      setProbes(next);
    }
    const currentMediaId = ctx.state(0);
    const confirmGlobalOpen = ctx.state(false);
    const lastMappingSigByMedia = {};
    const myInstanceId = getInstanceId();
    function reconcileInactiveProviders() {
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
        const row = {
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
        };
        return row;
      });
      if (rowsChanged) {
        results.set(nextResults);
        setResults(stored);
      }
    }
    async function readCachedContainer(mediaId, provider) {
      try {
        const c = await ctx.manga.getChapterContainer({ mediaId, provider });
        return c?.chapters ?? [];
      } catch {
        return null;
      }
    }
    async function readContainer(
      mediaId,
      provider,
      titles,
      year,
      skipCache = false,
    ) {
      if (!skipCache) {
        try {
          const cached = await ctx.manga.getChapterContainer({
            mediaId,
            provider,
          });
          if (cached?.chapters?.length) return cached.chapters;
        } catch {}
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
        const msg = String(e?.message ?? e);
        if (isNoMatchError(msg)) return [];
        log.warn(`fetch error (${provider}): ${msg}`);
        return null;
      }
    }
    function buildResult(mediaId, media, read, gap, probes) {
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
      const newSources = matched.filter(
        (p) => unreadChapters(read, p.latest) > 0,
      ).length;
      let kind;
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
        updatedAt: Date.now(),
      };
    }
    function captureSourceRef(mediaId, media) {
      const sref = buildSourceRef(mediaId, media.siteUrl, Date.now());
      if (!sref) return;
      const up = upsertSourceRef(getSources(), mediaId, sref);
      if (up.changed) setSources(up.map);
    }
    async function scanOneManga(mediaId, media, read, gap, onProgress) {
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
      const probes = {};
      const toScan = providerIds.filter((pid) => !isLive(excluded[key]?.[pid]));
      const BATCH = Math.max(
        1,
        Math.floor(Number($getUserPreference("parallelBatch") ?? "10")) || 10,
      );
      scanProgress.set({ mediaId, done: 0, total: toScan.length });
      const inflight = new Set();
      const publishInflight = () =>
        scanningProviders.set({ mediaId, pids: [...inflight] });
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
              setExcluded(excluded);
            }
          }
        }
        onProgress?.(probes);
      }
      scanningProviders.set(null);
      setExcluded(excluded);
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
    async function runScan(force) {
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
        ctx.toast.info(`Scanning ${entries.length} manga…`);
        const ttlMs =
          (Number($getUserPreference("ttlMinutes") ?? "60") || 60) * 60000;
        const gap = Number($getUserPreference("farBehindGap") ?? "10") || 10;
        const now = Date.now();
        const stored = getResults();
        const out = [...results.get()];
        const upsert = (row) => {
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
          const media = entry.media;
          const mediaId = Number(entry.mediaId ?? media.id);
          const key = String(mediaId);
          const read = Number(entry.listData?.progress ?? 0);
          captureSourceRef(mediaId, media);
          const title = resolveTitle(media);
          const cover = media.coverImage?.large ?? media.coverImage?.extraLarge;
          scanStatus.set({
            done: i + 1,
            total: entries.length,
            title,
            cover,
            mediaId,
          });
          const prior = stored[key];
          if (
            !force &&
            prior &&
            !isBadKind(prior.kind) &&
            now - Number(prior.updatedAt) < ttlMs
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
              setProbes2(mediaId, partialProbes);
              const partial = buildResult(
                mediaId,
                {
                  title,
                  cover:
                    media.coverImage?.large ?? media.coverImage?.extraLarge,
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
          setProbes2(mediaId, probes);
          stored[key] = result;
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
      }
    }
    const individualScanRunning = () =>
      probingId.get() != null || scanningProvider.get() !== "";
    const syncNativeButtons = () =>
      ($getUserPreference("syncNativeButtons") ?? "true") !== "false";
    const rejectIfBusy = () => {
      if (scanning.get() || individualScanRunning()) {
        ctx.toast.info(
          "A scan is already running — wait for it to finish before starting another",
        );
        return true;
      }
      return false;
    };
    const requestGlobalScan = () => {
      if (rejectIfBusy()) return;
      confirmGlobalOpen.set(true);
      try {
        tray.open();
      } catch {
        runScan(false);
      }
    };
    ctx.registerEventHandler("msu-gconfirm-close", () =>
      confirmGlobalOpen.set(false),
    );
    ctx.registerEventHandler("msu-gconfirm-run", () => {
      confirmGlobalOpen.set(false);
      if (rejectIfBusy()) return;
      runScan(false);
    });
    ctx.registerEventHandler("msu-scan", () => {
      requestGlobalScan();
    });
    ctx.registerEventHandler("msu-force", () => {
      if (rejectIfBusy()) return;
      runScan(true);
    });
    ctx.registerEventHandler("msu-cancel", () => {
      if (!scanning.get()) return;
      cancelRequested.set(true);
      status.set("Cancelling…");
    });
    function clearExclusions(mediaId) {
      const next = clearedExclusions(
        getExcluded(),
        getPinned(),
        mediaId,
        Date.now(),
      );
      setExcluded(next.excluded);
      setPinned(next.pinned);
    }
    ctx.registerEventHandler("msu-clear-excl", () => {
      if (rejectIfBusy()) return;
      clearExclusions();
      ctx.toast.success("Exclusions cleared — rediscovering from scratch");
      runScan(true);
    });
    ctx.registerEventHandler("msu-back", () => {
      const id = detailId.get();
      detailId.set(null);
      (async () => {
        if (id != null) await syncProbesFromCache(id);
        await refreshProgress();
      })();
    });
    async function findEntry(mediaId) {
      const col = await ctx.manga.getCollection();
      for (const list of col.lists ?? []) {
        for (const e of list.entries ?? []) {
          const m = e?.media;
          if (m && Number(e.mediaId ?? m.id) === mediaId) {
            return { media: m, read: Number(e.listData?.progress ?? 0) };
          }
        }
      }
      try {
        const m = $anilist.getManga(mediaId);
        if (m) return { media: m, read: 0 };
      } catch {}
      return null;
    }
    function syncRow(mediaId, result) {
      const stored = getResults();
      stored[String(mediaId)] = result;
      setResults(stored);
      const row = {
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
    function rebuildStoredRow(mediaId, readOverride) {
      const cur = results.get().find((r) => r.mediaId === mediaId);
      const probes = probeCache.get()[mediaId];
      if (!cur || !probes || !Object.keys(probes).length) return;
      const gap = Number($getUserPreference("farBehindGap") ?? "10") || 10;
      const read = readOverride ?? cur.read;
      syncRow(mediaId, buildResult(mediaId, cur, read, gap, probes));
    }
    async function syncProbesFromCache(mediaId) {
      if (scanning.get() || individualScanRunning()) return;
      const existing = probeCache.get()[mediaId] ?? {};
      const key = String(mediaId);
      const excluded = getExcludedView();
      const providers = ctx.manga.getProviders();
      const providerIds = Object.keys(existing).length
        ? Object.keys(existing)
        : Object.keys(providers).filter((p) => isActiveProvider(p, providers));
      if (!providerIds.length) return;
      const next = { ...existing };
      let changed = false;
      for (const pid of providerIds) {
        if (excluded[key]?.[pid] != null) continue;
        const chs = await readCachedContainer(mediaId, pid);
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
      setProbes2(mediaId, next);
      const cur = results.get().find((r) => r.mediaId === mediaId);
      if (cur) {
        rebuildStoredRow(mediaId, cur.read);
        return;
      }
      const found = await findEntry(mediaId);
      if (found) rebuildStoredRow(mediaId, found.read);
    }
    async function probeMangaDetail(mediaId) {
      if (scanning.get() || individualScanRunning()) return;
      probingId.set(mediaId);
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
          (probes) =>
            setProbes2(mediaId, { ...probeCache.get()[mediaId], ...probes }),
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
    async function scanOneProvider(mediaId, provider) {
      if (scanning.get() || individualScanRunning()) return;
      scanningProvider.set(provider);
      cancelRequested.set(false);
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
        if (cancelRequested.get()) return;
        const probe = makeProbe(provider, providers[provider] ?? provider, chs);
        const gap = Number($getUserPreference("farBehindGap") ?? "10") || 10;
        const merged = {
          ...(probeCache.get()[mediaId] ?? {}),
          [provider]: probe,
        };
        setProbes2(mediaId, merged);
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
    async function loadDetailMeta(mediaId) {
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
    function openDetail(mediaId) {
      detailId.set(mediaId);
      syncProbesFromCache(mediaId);
      if (!results.get().some((r) => r.mediaId === mediaId)) {
        loadDetailMeta(mediaId);
      }
    }
    function rescanCurrent() {
      const id = detailId.get();
      if (id == null || probingId.get() === id) return;
      probeMangaDetail(id);
    }
    function setExcluded2(mediaId, provider, exclude, reason = "other") {
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
      setExcluded(excluded);
      setPinned(pinned);
      ctx.toast.info(exclude ? "Excluded source" : "Included source");
      if (!exclude && detailId.get() === mediaId) {
        scanOneProvider(mediaId, provider);
      } else {
        rebuildStoredRow(mediaId);
      }
    }
    function toRow(r) {
      const prog = scanProgress.get();
      const scanning2 =
        prog != null && prog.mediaId === r.mediaId
          ? tray.badge(prog.total ? `⏳ ${prog.done}/${prog.total}` : "⏳", {
              intent: "gray",
            })
          : null;
      const actions = [];
      if (scanning2) actions.push(scanning2);
      const s = statusFor(r);
      actions.push(
        tray.tooltip(tray.badge(s.label, { intent: s.intent }), {
          text: s.tip,
        }),
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
    function listSection(headerLabel, rows) {
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
    function renderNewOn() {
      return listSection(
        "New chapters",
        results.get().filter((r) => r.isNew),
      );
    }
    function renderResults() {
      return listSection(
        "Reading list",
        results.get().filter((r) => !r.isNew),
      );
    }
    function renderDetail() {
      const id = detailId.get();
      if (id == null) return null;
      const key = String(id);
      const cur = results.get().find((r) => r.mediaId === id);
      const excluded = getExcludedView();
      const excludedForManga = excluded[key] ?? {};
      const probeByProvider = probeCache.get()[id] ?? {};
      const prog = scanProgress.get();
      const hasProg = prog != null && prog.mediaId === id;
      const scanningThis = probingId.get() === id || hasProg;
      const busy =
        scanningThis || scanningProvider.get() !== "" || scanning.get();
      const inflight = scanningProviders.get();
      const isPidScanning = (pid) =>
        scanningProvider.get() === pid ||
        (inflight?.mediaId === id && inflight.pids.includes(pid));
      const title = cur?.title || detailTitle.get() || "Manga";
      const read = cur?.read ?? detailRead.get();
      const gap = Number($getUserPreference("farBehindGap") ?? "10") || 10;
      const head = trayHeader(tray, {
        title,
        subtitle: read > 0 ? `Read c.${read}` : "Not started",
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
          ...(Object.keys(excludedForManga).length > 0
            ? [
                tray.button("Clear exclusions", {
                  onClick: ctx.eventHandler(`msu-clr-${id}`, () => {
                    if (scanning.get() || individualScanRunning()) {
                      ctx.toast.info("A scan is already running");
                      return;
                    }
                    clearExclusions(id);
                    ctx.toast.success(
                      "Exclusions cleared — rescanning sources",
                    );
                    probeMangaDetail(id);
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
      const sourceStatus = (p) => {
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
      const availableRow = (pid) => {
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
                disabled: busy,
              }),
              { text: "Rescan this source" },
            ),
            tray.dropdownMenu({
              trigger: tray.button("Exclude ▾", {
                size: "sm",
                intent: "alert-subtle",
              }),
              items: Object.keys(REASONS).map((rk) =>
                tray.dropdownMenuItem(
                  tray.badge(REASONS[rk].menu, { intent: reasonIntent(rk) }),
                  {
                    onClick: ctx.eventHandler(
                      `msu-exc-${id}-${pid}-${rk}`,
                      () => setExcluded2(id, pid, true, rk),
                    ),
                  },
                ),
              ),
            }),
          ],
        };
      };
      const excludedRow = (pid) => {
        const p = probeByProvider[pid];
        const name = p ? p.providerName : String(providers[pid] ?? pid);
        const reason = excludedForManga[pid];
        return {
          title: name,
          status: { label: reasonLabel(reason), intent: reasonIntent(reason) },
          actions: [
            tray.button("Include", {
              onClick: ctx.eventHandler(`msu-inc-${id}-${pid}`, () =>
                setExcluded2(id, pid, false),
              ),
              size: "sm",
              intent: "primary-subtle",
            }),
          ],
        };
      };
      const latestOf = (pid) => probeByProvider[pid]?.latest ?? -1;
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
    const panelStatus = ctx.state(null);
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
    const scanPanel = ctx.newWebview({
      slot: "fixed",
      width: "320px",
      height: "108px",
      hidden: true,
      window: { draggable: true, defaultPosition: "bottom-right" },
    });
    scanPanel.channel.sync("scan", panelStatus);
    scanPanel.channel.on("panel-cancel", () => {
      if (!scanning.get() && !individualScanRunning()) return;
      cancelRequested.set(true);
      status.set("Cancelling…");
    });
    scanPanel.channel.on("panel-open", (mediaId) => {
      const id = Number(mediaId ?? 0);
      if (!Number.isFinite(id) || id <= 0) return;
      if (currentMediaId.get() === id) {
        openDetail(id);
        try {
          tray.open();
        } catch {}
        return;
      }
      ctx.screen.navigateTo("/manga/entry", { id: String(id) });
      if (trayIsOpen) openDetail(id);
    });
    scanPanel.setContent(() => scan_panel_default);
    let panelVisible = false;
    ctx.effect(() => {
      const visible = panelStatus.get() != null;
      if (visible === panelVisible) return;
      panelVisible = visible;
      if (visible) scanPanel.show();
      else scanPanel.hide();
    }, [panelStatus]);
    async function refreshProgress() {
      let col;
      try {
        col = await ctx.manga.getCollection();
      } catch {
        return;
      }
      const readById = {};
      for (const list of col.lists ?? []) {
        for (const e of list.entries ?? []) {
          const m = e?.media;
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
        };
        return row;
      });
      if (changed) {
        setResults(stored);
        results.set(next);
      }
    }
    const dm = createDomDecorator(ctx);
    const headerProgress = createHeaderProgressReader(ctx);
    const CARD_REDECORATE_YIELD_EVERY = 24;
    ctx.screen.onNavigate((e) => {
      const isManga = String(e.pathname ?? "").includes("/manga/");
      const raw = isManga ? e.searchParams?.id : "";
      const id = raw ? parseInt(String(raw), 10) : 0;
      const mediaId = Number.isFinite(id) ? id : 0;
      headerProgress.clearCache();
      currentMediaId.set(mediaId);
      delete lastMappingSigByMedia[mediaId];
      reconcileInactiveProviders();
      if (mediaId > 0) syncProbesFromCache(mediaId);
      dm.arm();
    });
    ctx.screen.loadCurrent();
    tray.onClose(() => {
      trayIsOpen = false;
    });
    tray.onOpen(() => {
      trayIsOpen = true;
      (async () => {
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
    const entryButton = ctx.action.newMangaPageButton({
      label: "\uD83D\uDCDA",
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
      try {
        tray.open();
      } catch {}
    });
    const cardBadgeBgClass = (intent) => {
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
    const cardBadgeContent = (mediaId, progress) => {
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
    const decorateCard = async (el) => {
      let attrsCache = null;
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
          const { row, label, intent, tip } = cardBadgeContent(
            mediaId,
            progress,
          );
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
    const escHtml = (s) =>
      String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/"/g, "&quot;");
    const buildBarItems = async (container, mediaId) => {
      const selectedPid = await readSelectedProvider(ctx, container);
      let read = results.get().find((r) => r.mediaId === mediaId)?.read ?? 0;
      const fromHeader = await headerProgress.read();
      if (fromHeader != null) read = fromHeader;
      const key = String(mediaId);
      const probes = probeCache.get()[mediaId] ?? {};
      const excluded = getExcludedView()[key] ?? {};
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
    const decorateBar = async (container) => {
      const mediaId = currentMediaId.get();
      if (!mediaId) return;
      await dm.decorate(container, {
        marker: "msu-bar",
        lockKey: "bar",
        sig: async () => (await buildBarItems(container, mediaId)).sig,
        scope: container,
        render: async (node) => {
          const { items, selectedPid } = await buildBarItems(
            container,
            mediaId,
          );
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
            `<span class="text-sm text-[--muted]">New on:</span>${items
              .map((i) => {
                const title = `${escHtml(i.name)}: ${i.unread} unread chapter${i.unread === 1 ? "" : "s"}`;
                const label = `${escHtml(i.name)} +${i.unread}`;
                const intentClass = selectedPid?.includes(i.pid)
                  ? "text-green bg-green-50 border-green-500 dark:text-green-300"
                  : "text-blue bg-blue-50 border-blue-500 dark:text-blue-300";
                return `<span title="${title}" class="UI-Badge__root inline-flex flex-none w-fit overflow-hidden justify-center items-center gap-2 group/badge ${intentClass} border border-opacity-40 dark:bg-opacity-10 h-6 px-2 text-xs font-semibold tracking-wide rounded-full">${label}</span>`;
              })
              .join("")}`,
          );
          anchor.after(node);
        },
      });
    };
    const redecorateCards = async () => {
      reconcileInactiveProviders();
      try {
        const cards = await ctx.dom.query(
          '[data-media-entry-card-container][data-media-type="manga"]',
        );
        const list = cards ?? [];
        for (let i = 0; i < list.length; i++) {
          decorateCard(list[i]);
          if (i % CARD_REDECORATE_YIELD_EVERY === 0) $sleep(0);
        }
      } catch {}
    };
    const redecorateBar = async () => {
      try {
        const cont = (
          await ctx.dom.query("[data-chapter-list-container]")
        )?.[0];
        if (cont) decorateBar(cont);
      } catch {}
    };
    const dialogTitle = async (dialog) => {
      const titleEl = (await dialog.query(".UI-Modal__title"))[0];
      return titleEl
        ? String((await titleEl.getText()) ?? "")
            .trim()
            .toLowerCase()
        : "";
    };
    const hookReloadModal = async (dialog) => {
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
          probeMangaDetail(id);
        });
      } catch {}
    };
    const watchManualMatchDialog = async (dialog) => {
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
        const now = Date.now();
        const matches = getMatches();
        const action = resolveMatchAction(
          sig,
          matches[String(mediaId)]?.[provider],
        );
        if (action.type === "tombstone") {
          setMatches(tombstoneMatch(matches, mediaId, provider, now));
        } else if (action.type === "upsert") {
          setMatches(
            upsertMatch(
              matches,
              mediaId,
              provider,
              action.mappedId,
              myInstanceId,
              now,
            ),
          );
        }
        const prev = lastMappingSigByMedia[mediaId];
        lastMappingSigByMedia[mediaId] = sig;
        if (prev === undefined || prev === sig) return;
        scanOneProvider(mediaId, provider).then(() => {
          dm.refresh();
          redecorateBar();
        });
      } catch {}
    };
    const hookRefreshMenu = async (menu) => {
      let items = [];
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
            if (!syncNativeButtons()) return;
            requestGlobalScan();
          });
        } catch {}
        return;
      }
    };
    const applyProgressFromDom = async (badgeEl) => {
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
        const kind = classify(read, cur.latest, cur.sources, false, gap);
        syncRow(id, { ...cur, read, kind });
      }
    };
    dm.observe(
      "[data-media-card-grid], [data-media-card-lazy-grid]",
      () => void redecorateCards(),
    );
    dm.observe(
      '[data-media-entry-card-container][data-media-type="manga"]',
      (els) => {
        for (const el of els ?? []) decorateCard(el);
      },
      { withInnerHTML: true },
    );
    dm.observe(
      "[data-chapter-list-container]",
      (els) => {
        const c = els[0];
        if (c) decorateBar(c);
      },
      { withInnerHTML: true },
    );
    dm.observe(
      "[role='dialog']",
      (els) => {
        for (const el of els ?? []) {
          hookReloadModal(el);
          watchManualMatchDialog(el);
        }
      },
      { withInnerHTML: true },
    );
    dm.observe("[role='menu']", (els) => {
      for (const el of els ?? []) hookRefreshMenu(el);
    });
    dm.observe("[data-media-page-header-progress-badge-progress]", (els) => {
      (async () => {
        await applyProgressFromDom(els?.[0]);
        await redecorateBar();
      })();
    });
    dm.pass(redecorateCards);
    dm.pass(redecorateBar);
    dm.start();
    ctx.effect(() => {
      results.get();
      probeCache.get();
      scanProgress.get();
      currentMediaId.get();
      dm.refresh();
    }, [results, probeCache, scanProgress, currentMediaId]);
    function renderGlobalConfirm() {
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
        subtitle:
          status.get() || "Detect new chapters across your reading list",
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
  return register2(...args);
};

// src/plugins/manga-source-updates/code.ts
function init() {
  $ui.register(register);
}
