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
    const dirty = new Map();
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
        dirty.set(lk, { el, o });
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
        const pending = dirty.get(lk);
        if (pending) {
          dirty.delete(lk);
          decorate(pending.el, pending.o);
        }
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
  var CAPTION_STYLE = {
    fontSize: "0.7rem",
    opacity: "0.55",
  };
  var ALERT_MENU_ITEM_STYLE =
    "hover:bg-red-100 active:bg-red-200 dark:hover:bg-opacity-20 text-[--red]";
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
    const SEG_BOX2 = {
      display: "inline-flex",
      alignItems: "center",
      height: "1.2rem",
      lineHeight: "1",
    };
    const dotSep = () =>
      tray.span("·", {
        style: {
          ...SEG_BOX2,
          opacity: "0.35",
          fontSize: "0.75rem",
          margin: "0 2px",
        },
      });
    const subLineSegments = (row) => {
      const segs = [];
      if (row.year != null) {
        segs.push(
          tray.span(String(row.year), {
            style: { ...SEG_BOX2, opacity: "0.55", fontSize: "0.75rem" },
          }),
        );
      }
      if (row.status) {
        segs.push(
          tray.badge(row.status.label, {
            intent: row.status.intent ?? "gray",
            size: "sm",
            ...(row.status.style ? { style: row.status.style } : {}),
            ...(row.status.className
              ? { className: row.status.className }
              : {}),
          }),
        );
      }
      if (row.warn) {
        const badge = tray.badge(row.warn.label, {
          intent: row.warn.intent ?? "warning",
          size: "sm",
          ...(row.warn.style ? { style: row.warn.style } : {}),
          ...(row.warn.className ? { className: row.warn.className } : {}),
        });
        segs.push(
          row.warn.tooltip
            ? tray.tooltip(badge, { text: row.warn.tooltip })
            : badge,
        );
      }
      if (row.chapter != null && row.chapter !== "") {
        segs.push(
          tray.span(`c.${row.chapter}`, {
            style: { ...SEG_BOX2, opacity: "0.7", fontSize: "0.75rem" },
          }),
        );
      }
      const linkStyle = {
        ...SEG_BOX2,
        background: "transparent",
        border: "none",
        padding: "0",
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
            style: { alignItems: "center", lineHeight: "1" },
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
  function connectStatus(o) {
    if (!o.connected)
      return {
        badge: { label: "Not connected", intent: "gray" },
        text: null,
        via: "",
      };
    if (o.syncing) return { badge: null, text: "Syncing…", via: "" };
    const label = o.lastSyncedAt && o.lastSyncedAt > 0 ? "Synced" : "Connected";
    return {
      badge: { label, intent: "success" },
      text: null,
      via: o.via ?? "",
    };
  }
  var SEG_BOX = {
    display: "inline-flex",
    alignItems: "center",
    height: "1.2rem",
    lineHeight: "1",
  };
  function statusRow(tray, s) {
    const segs = [];
    if (s.badge) {
      segs.push(tray.badge(s.badge.label, { intent: s.badge.intent }));
    }
    if (s.text) {
      segs.push(
        tray.span(s.text, {
          style: { ...SEG_BOX, fontSize: "0.7rem", opacity: "0.7" },
        }),
      );
    }
    if (s.via) {
      segs.push(
        tray.span(`· via ${s.via}`, {
          style: {
            ...SEG_BOX,
            fontSize: "0.7rem",
            opacity: "0.55",
            marginLeft: "6px",
          },
        }),
      );
    }
    return tray.flex(segs, {
      gap: 0,
      style: { alignItems: "center", lineHeight: "1" },
    });
  }
  function deviceCodePrompt(tray, start) {
    return tray.stack(
      [
        tray.flex(
          [
            tray.text("Enter this code at GitHub", { style: CAPTION_STYLE }),
            tray.text(start.user_code, {
              style: {
                fontSize: "1.25rem",
                fontWeight: "700",
                letterSpacing: "0.15em",
              },
            }),
          ],
          { direction: "column", gap: 1 },
        ),
        tray.anchor({
          text: "Open GitHub ↗",
          href: start.verification_uri,
          target: "_blank",
        }),
        tray.text("Waiting for authorization…", { style: CAPTION_STYLE }),
      ],
      { gap: 2 },
    );
  }
  function actionsMenu(tray, o) {
    const items = (o.connectedActions ?? []).map((a) =>
      tray.dropdownMenuItem(tray.text(a.label), {
        onClick: a.onClick,
        disabled: a.disabled,
      }),
    );
    if (o.disconnectable ?? o.connected) {
      items.push(
        tray.dropdownMenuItem(tray.text("Disconnect"), {
          className: ALERT_MENU_ITEM_STYLE,
          onClick: o.disconnectEvent,
        }),
      );
    }
    if (!items.length) return null;
    return tray.dropdownMenu({
      trigger: tray.button("⋮", { size: "sm", intent: "gray-subtle" }),
      items,
    });
  }
  function githubConnect(tray, o) {
    if (o.deviceStart) return deviceCodePrompt(tray, o.deviceStart);
    const rows = [];
    const status = o.status ? statusRow(tray, connectStatus(o.status)) : null;
    const menu = o.connected ? actionsMenu(tray, o) : null;
    if (o.title || status || menu) {
      const header = [
        tray.div(o.title ? [tray.text(o.title, { style: LABEL_STYLE })] : [], {
          style: { flex: "1", alignSelf: "center" },
        }),
      ];
      if (status) header.push(status);
      if (menu) header.push(menu);
      rows.push(tray.flex(header, { gap: 2, style: { alignItems: "center" } }));
    }
    if (!o.connected) {
      rows.push(
        tray.flex(
          [
            tray.button(o.connecting ? "Connecting…" : "Connect GitHub", {
              onClick: o.connectEvent,
              size: "sm",
              intent: "primary",
              loading: o.connecting,
            }),
          ],
          { gap: 2 },
        ),
      );
      if (o.connectHint) {
        rows.push(tray.text(o.connectHint, { style: CAPTION_STYLE }));
      }
    }
    return tray.stack(rows, { gap: 2 });
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

  class GistClient {
    constructor(token, fetchFn) {
      this.baseUrl = "https://api.github.com";
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
    async createGist(filename, content, description) {
      const res = await this.fetchFn(`${this.baseUrl}/gists`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          public: false,
          description,
          files: { [filename]: { content } },
        }),
      });
      if (!res.ok) {
        throw new Error(`createGist failed: ${res.status} ${res.text()}`);
      }
      const data = res.json();
      const id = data.id ?? "";
      const owner = data.owner?.login ?? "";
      return {
        id,
        owner,
        rawUrl: this.rawUrl(owner, id, filename),
      };
    }
    async getGistFile(id, filename) {
      const res = await this.fetchFn(`${this.baseUrl}/gists/${id}`, {
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
      const res = await this.fetchFn(`${this.baseUrl}/gists/${id}`, {
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
      const res = await this.fetchFn(`${this.baseUrl}/gists/${id}`, {
        method: "PATCH",
        headers: this.headers(),
        body: JSON.stringify({ files: { [filename]: { content } } }),
      });
      if (!res.ok) {
        throw new Error(`updateGist failed: ${res.status} ${res.text()}`);
      }
    }
    async getGistFiles(id, filenames) {
      const res = await this.fetchFn(`${this.baseUrl}/gists/${id}`, {
        method: "GET",
        headers: this.headers(),
      });
      if (!res.ok) {
        throw new Error(`getGist failed: ${res.status} ${res.text()}`);
      }
      const data = res.json();
      const out = {};
      for (const name of filenames) {
        out[name] = data.files?.[name]?.content ?? "";
      }
      return out;
    }
    async updateGistFiles(id, files) {
      const body = { files: {} };
      for (const [name, content] of Object.entries(files)) {
        body.files[name] = { content };
      }
      const res = await this.fetchFn(`${this.baseUrl}/gists/${id}`, {
        method: "PATCH",
        headers: this.headers(),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        throw new Error(`updateGist failed: ${res.status} ${res.text()}`);
      }
    }
    async deleteGist(id) {
      const res = await this.fetchFn(`${this.baseUrl}/gists/${id}`, {
        method: "DELETE",
        headers: this.headers(),
      });
      if (!res.ok && res.status !== 404) {
        throw new Error(`deleteGist failed: ${res.status} ${res.text()}`);
      }
    }
    async findGistByFilename(filename) {
      const res = await this.fetchFn(`${this.baseUrl}/gists?per_page=100`, {
        method: "GET",
        headers: this.headers(),
      });
      if (!res.ok) {
        throw new Error(`listGists failed: ${res.status} ${res.text()}`);
      }
      const data = res.json();
      for (const g of data) {
        if (g.files && filename in g.files) return g.id;
      }
      return null;
    }
  }
  var GITHUB_CLIENT_ID = "Ov23li6KslJmP3EaLxXj";
  function formatDeviceCode(json) {
    if ("device_code" in json) return { ok: true, start: json };
    return {
      ok: false,
      message: json.error ?? "malformed device-code response",
    };
  }
  function formatTokenResponse(json) {
    if ("access_token" in json) {
      return { type: "token", token: json.access_token };
    }
    if (json.error === "authorization_pending") return { type: "pending" };
    if (json.error === "slow_down") {
      return { type: "slow_down", interval: json.interval ?? 5 };
    }
    return {
      type: "error",
      message: json.error ?? "unexpected token response",
    };
  }

  class DeviceFlowClient {
    constructor(clientId, fetchFn) {
      this.baseUrl = "https://github.com/login";
      this.clientId = clientId;
      this.fetchFn = fetchFn;
    }
    headers() {
      return { Accept: "application/json", "Content-Type": "application/json" };
    }
    async requestDeviceCode(scope) {
      const res = await this.fetchFn(`${this.baseUrl}/device/code`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ client_id: this.clientId, scope }),
      });
      return formatDeviceCode(res.json());
    }
    async pollAccessToken(deviceCode) {
      const res = await this.fetchFn(`${this.baseUrl}/oauth/access_token`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          client_id: this.clientId,
          device_code: deviceCode,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        }),
      });
      return formatTokenResponse(res.json());
    }
    async pollUntilToken(start, deps) {
      let interval = Math.max(1, start.interval);
      const deadline = Date.now() + start.expires_in * 1000;
      while (Date.now() < deadline) {
        deps.sleep(interval * 1000);
        const result = await this.pollAccessToken(start.device_code);
        if (result.type === "token")
          return { type: "token", token: result.token };
        if (result.type === "error") {
          return { type: "error", message: result.message };
        }
        if (result.type === "slow_down") {
          interval = Math.max(interval + 5, result.interval);
        }
      }
      return { type: "timeout" };
    }
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
/* Indeterminate: a single provider has no meaningful fraction (0/1 → 1/1), so
   a determinate bar just sits at 0% and reads as "never loads". Slide a chunk
   across instead. */
.bar.indeterminate .fill{width:40%;transition:none;animation:slide 1.1s ease-in-out infinite}
@keyframes slide{0%{transform:translateX(-110%)}100%{transform:translateX(275%)}}

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
    // total <= 1 (single provider) gives no useful fraction → animate instead.
    var indeterminate = !s.cancelling && s.total <= 1 && s.done < s.total;
    var bar = document.querySelector(".bar");
    bar.classList.toggle("indeterminate", indeterminate);
    var pct = s.total ? Math.round(s.done / s.total * 100) : 0;
    document.getElementById("fill").style.width = indeterminate ? "40%" : \`\${pct}%\`;
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
  var K_DIGEST = "digest";
  var K_EXCLUSIONS = "exclusions";
  var K_MATCHES = "matches";
  var K_PINS = "pins";
  var K_PROBES = "probes";
  var K_SOURCES = "sources";
  var K_INSTANCE_ID = "instanceId";
  var K_OAUTH_TOKEN = "oauthToken";
  var K_GIST_ID = "gistId";
  var K_SYNCED_AT = "syncedAt";
  var SYNC_FILE_DIGEST = "seanime-msu-digest.json";
  var SYNC_FILE_EXCLUSIONS = "seanime-msu-exclusions.json";
  var SYNC_FILE_MATCHES = "seanime-msu-matches.json";
  var SYNC_FILE_PINS = "seanime-msu-pins.json";
  var SYNC_FILE_PROBES = "seanime-msu-probes.json";
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
  var EXT_ID_OFFSET = 2147483648;
  var LOCAL_ID_RANGE = 1099511627776;
  var MAX_EXT_ID = 1023;
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
  function parseCustomSourceManifestId(siteUrl) {
    const PREFIX = "ext_custom_source_";
    if (!siteUrl || siteUrl.indexOf(PREFIX) !== 0) return;
    const end = siteUrl.indexOf("|END|");
    if (end < 0) return;
    const id = siteUrl.slice(PREFIX.length, end);
    return id || undefined;
  }
  function stableCustomSourceKey(manifestId, localId) {
    return `${manifestId}:${localId}`;
  }
  function buildManifestExtIdIndex(sources) {
    const out = {};
    for (const ref of Object.values(sources)) {
      if (ref.deletedAt != null) continue;
      if (out[ref.manifestId] == null) out[ref.manifestId] = ref.extId;
    }
    return out;
  }
  function probeExtId(manifestId, localId, deps) {
    for (let extId = 1; extId <= MAX_EXT_ID; extId++) {
      if (extId % 64 === 0) deps.sleep(0);
      try {
        const m = deps.getManga(encodeMediaId(extId, localId));
        if (
          m?.siteUrl &&
          parseCustomSourceManifestId(m.siteUrl) === manifestId
        ) {
          return extId;
        }
      } catch (_) {}
    }
    return null;
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
  function upsertMatch(map, mediaId, provider, instanceId, mappedId, now) {
    const key = String(mediaId);
    const byInstance = {
      ...(map[key]?.[provider] ?? {}),
      [instanceId]: { mappedId, updatedAt: now },
    };
    return {
      ...map,
      [key]: { ...(map[key] ?? {}), [provider]: byInstance },
    };
  }
  function tombstoneMatch(map, mediaId, provider, instanceId, now) {
    const key = String(mediaId);
    const byInstance = { ...(map[key]?.[provider] ?? {}) };
    const prev = byInstance[instanceId];
    if (prev)
      byInstance[instanceId] = { ...prev, updatedAt: now, deletedAt: now };
    return {
      ...map,
      [key]: { ...(map[key] ?? {}), [provider]: byInstance },
    };
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
  var PRESENT_SENTINEL = "\x00present";
  function matchDivergence(byInstance) {
    if (!byInstance) return { diverges: false, reason: "" };
    const liveIds = new Set();
    let hasRemoved = false;
    for (const rec of Object.values(byInstance)) {
      if (isLive(rec))
        liveIds.add(rec.mappedId === "" ? PRESENT_SENTINEL : rec.mappedId);
      else hasRemoved = true;
    }
    if (liveIds.size >= 2) return { diverges: true, reason: "different" };
    if (liveIds.size === 1 && hasRemoved)
      return { diverges: true, reason: "missing" };
    return { diverges: false, reason: "" };
  }
  function liveLocalMatchPairs(matches, instanceId) {
    const out = new Set();
    for (const [mid, providers] of Object.entries(matches)) {
      for (const [pid, byInstance] of Object.entries(providers)) {
        if (isLive(byInstance[instanceId])) out.add(`${mid}\x00${pid}`);
      }
    }
    return out;
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
    return readObj(K_DIGEST);
  }
  function setResults(map) {
    $storage.set(K_DIGEST, map);
  }
  function getProbes() {
    return readObj(K_PROBES);
  }
  function setProbes(map) {
    $storage.set(K_PROBES, map);
  }
  function snapshotLocalMaps() {
    return {
      digest: getResults(),
      exclusions: getExcluded(),
      pins: getPinned(),
      probes: getProbes(),
      matches: getMatches(),
    };
  }
  function writeLocalMaps(maps) {
    setResults(maps.digest);
    setExcluded(maps.exclusions);
    setPinned(maps.pins);
    setProbes(maps.probes);
    setMatches(maps.matches);
  }
  function hydrateResults() {
    const stored = getResults();
    const out = [];
    for (const key of Object.keys(stored)) {
      const r = stored[key];
      if (!isLive(r)) continue;
      out.push({
        ...r,
        read: Number(r.read ?? 0),
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
  var WIRE_CS_PREFIX = "cs:";
  function toWireKey(mediaId, sources) {
    if (!isCustomSourceId(mediaId)) return String(mediaId);
    const ref = sources[String(mediaId)];
    if (!ref || ref.deletedAt != null) return null;
    return `${WIRE_CS_PREFIX}${stableCustomSourceKey(ref.manifestId, decodeLocalId(mediaId))}`;
  }
  function fromWireKey(key, extIdForManifest) {
    if (key.indexOf(WIRE_CS_PREFIX) !== 0) {
      const n = Number(key);
      return Number.isFinite(n) ? n : null;
    }
    const rest = key.slice(WIRE_CS_PREFIX.length);
    const sep = rest.indexOf(":");
    if (sep <= 0) return null;
    const manifestId = rest.slice(0, sep);
    const localId = Number(rest.slice(sep + 1));
    if (!Number.isFinite(localId)) return null;
    const extId = extIdForManifest(manifestId, localId);
    if (extId == null) return null;
    return encodeMediaId(extId, localId);
  }
  var SYNC_FILES = [
    { section: "digest", file: SYNC_FILE_DIGEST, level: 1 },
    { section: "exclusions", file: SYNC_FILE_EXCLUSIONS, level: 2 },
    { section: "pins", file: SYNC_FILE_PINS, level: 2 },
    { section: "probes", file: SYNC_FILE_PROBES, level: 2 },
    { section: "matches", file: SYNC_FILE_MATCHES, level: 3 },
  ];
  var ALL_SYNC_FILES = SYNC_FILES.map((s) => s.file);
  function omitCells(map, pairs) {
    if (pairs.size === 0) return map;
    const out = {};
    for (const [mid, inner] of Object.entries(map)) {
      const keep = {};
      for (const [pid, v] of Object.entries(inner)) {
        if (!pairs.has(`${mid}\x00${pid}`)) keep[pid] = v;
      }
      out[mid] = keep;
    }
    return out;
  }
  function reinjectCells(target, source, pairs) {
    if (pairs.size === 0) return target;
    const out = { ...target };
    for (const pair of pairs) {
      const sep = pair.indexOf("\x00");
      const mid = pair.slice(0, sep);
      const pid = pair.slice(sep + 1);
      const val = source[mid]?.[pid];
      if (val === undefined) continue;
      out[mid] = { ...(out[mid] ?? {}), [pid]: val };
    }
    return out;
  }
  function effTs(rec) {
    return Math.max(rec.updatedAt ?? 0, rec.deletedAt ?? 0);
  }
  function pick(l, r) {
    if (!l) return { ...r };
    if (!r) return { ...l };
    return effTs(l) > effTs(r) ? { ...l } : { ...r };
  }
  function mergeOneLevel(local, remote) {
    const out = {};
    for (const k of new Set([...Object.keys(local), ...Object.keys(remote)])) {
      out[k] = pick(local[k], remote[k]);
    }
    return out;
  }
  function mergeTwoLevel(local, remote) {
    const out = {};
    for (const k of new Set([...Object.keys(local), ...Object.keys(remote)])) {
      out[k] = mergeOneLevel(local[k] ?? {}, remote[k] ?? {});
    }
    return out;
  }
  function mergeThreeLevel(local, remote) {
    const out = {};
    for (const k of new Set([...Object.keys(local), ...Object.keys(remote)])) {
      out[k] = mergeTwoLevel(local[k] ?? {}, remote[k] ?? {});
    }
    return out;
  }
  function mergeMaps(local, remote) {
    return {
      digest: mergeOneLevel(local.digest, remote.digest),
      exclusions: mergeTwoLevel(local.exclusions, remote.exclusions),
      pins: mergeTwoLevel(local.pins, remote.pins),
      probes: mergeTwoLevel(local.probes, remote.probes),
      matches: mergeThreeLevel(local.matches, remote.matches),
    };
  }
  function sortObj(o) {
    const out = {};
    for (const k of Object.keys(o).sort()) {
      const v = o[k];
      if (v === null || v === undefined) continue;
      out[k] = v && typeof v === "object" && !Array.isArray(v) ? sortObj(v) : v;
    }
    return out;
  }
  function sortMap(m) {
    const out = {};
    for (const k of Object.keys(m).sort()) {
      const sorted = sortObj(m[k]);
      if (Object.keys(sorted).length === 0) continue;
      out[k] = sorted;
    }
    return out;
  }
  function sortMap3(m) {
    const out = {};
    for (const k of Object.keys(m).sort()) {
      const inner = sortMap(m[k]);
      if (Object.keys(inner).length === 0) continue;
      out[k] = inner;
    }
    return out;
  }
  function serializeSection(map, level) {
    const canon =
      level === 3 ? sortMap3(map) : level === 2 ? sortMap(map) : sortObj(map);
    return JSON.stringify(canon, null, 2);
  }
  var DIGEST_WIRE_FIELDS = ["title", "cover", "updatedAt", "deletedAt"];
  function projectDigestRecord(r) {
    const out = {};
    for (const f of DIGEST_WIRE_FIELDS) {
      if (r[f] != null) out[f] = r[f];
    }
    return out;
  }
  function projectDigest(map) {
    const out = {};
    for (const [k, r] of Object.entries(map)) out[k] = projectDigestRecord(r);
    return out;
  }
  function wireMapsToFiles(maps) {
    const out = {};
    for (const { section, file, level } of SYNC_FILES) {
      const map =
        section === "digest" ? projectDigest(maps.digest) : maps[section];
      out[file] = serializeSection(map, level);
    }
    return out;
  }
  function normalizeRecord(rec) {
    const r = rec;
    const parsed = {
      ...rec,
      updatedAt: typeof r.updatedAt === "number" ? r.updatedAt : 0,
    };
    if (r.deletedAt !== undefined && typeof r.deletedAt !== "number") {
      delete parsed.deletedAt;
    }
    return parsed;
  }
  function parseMap(src) {
    const out = {};
    if (!src || typeof src !== "object") return out;
    for (const [k, inner] of Object.entries(src)) {
      if (!inner || typeof inner !== "object") continue;
      const innerOut = {};
      for (const [pid, rec] of Object.entries(inner)) {
        if (rec && typeof rec === "object")
          innerOut[pid] = normalizeRecord(rec);
      }
      out[k] = innerOut;
    }
    return out;
  }
  function parseMatches(src) {
    const out = {};
    if (!src || typeof src !== "object") return out;
    for (const [mid, providers] of Object.entries(src)) {
      if (!providers || typeof providers !== "object") continue;
      const provOut = {};
      for (const [pid, byInst] of Object.entries(providers)) {
        if (!byInst || typeof byInst !== "object") continue;
        const instOut = {};
        for (const [iid, rec] of Object.entries(byInst)) {
          if (
            rec &&
            typeof rec === "object" &&
            typeof rec.mappedId === "string"
          ) {
            instOut[iid] = normalizeRecord(rec);
          }
        }
        if (Object.keys(instOut).length > 0) provOut[pid] = instOut;
      }
      if (Object.keys(provOut).length > 0) out[mid] = provOut;
    }
    return out;
  }
  function parseResults(src) {
    const out = {};
    if (!src || typeof src !== "object") return out;
    for (const [k, rec] of Object.entries(src)) {
      if (rec && typeof rec === "object") out[k] = normalizeRecord(rec);
    }
    return out;
  }
  function parseJsonObj(raw) {
    if (!raw) return {};
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  function filesToWireMaps(files) {
    return {
      digest: parseResults(parseJsonObj(files[SYNC_FILE_DIGEST] ?? "")),
      exclusions: parseMap(parseJsonObj(files[SYNC_FILE_EXCLUSIONS] ?? "")),
      pins: parseMap(parseJsonObj(files[SYNC_FILE_PINS] ?? "")),
      probes: parseMap(parseJsonObj(files[SYNC_FILE_PROBES] ?? "")),
      matches: parseMatches(parseJsonObj(files[SYNC_FILE_MATCHES] ?? "")),
    };
  }
  function translateTwoLevel(m, key, dropped) {
    const out = {};
    for (const [mediaIdStr, inner] of Object.entries(m)) {
      const wk = key(Number(mediaIdStr));
      if (wk == null) {
        dropped.add(Number(mediaIdStr));
        continue;
      }
      out[wk] = inner;
    }
    return out;
  }
  function translateOneLevel(m, key, dropped) {
    const out = {};
    for (const [mediaIdStr, rec] of Object.entries(m)) {
      const wk = key(Number(mediaIdStr));
      if (wk == null) {
        dropped.add(Number(mediaIdStr));
        continue;
      }
      out[wk] = rec;
    }
    return out;
  }
  function toWireMaps(local, sources) {
    const dropped = new Set();
    const key = (mediaId) => toWireKey(mediaId, sources);
    const maps = {
      digest: translateOneLevel(local.digest, key, dropped),
      exclusions: translateTwoLevel(local.exclusions, key, dropped),
      pins: translateTwoLevel(local.pins, key, dropped),
      probes: translateTwoLevel(local.probes, key, dropped),
      matches: translateTwoLevel(local.matches, key, dropped),
    };
    return { maps, dropped: [...dropped] };
  }
  function localizeWireMaps(maps, extIdForManifest) {
    const unresolved = new Set();
    const key = (wireKey) => {
      const mediaId = fromWireKey(wireKey, extIdForManifest);
      if (mediaId == null) {
        unresolved.add(wireKey);
        return null;
      }
      return String(mediaId);
    };
    const relTwo = (m) => {
      const out2 = {};
      for (const [wk, inner] of Object.entries(m)) {
        const lk = key(wk);
        if (lk != null) out2[lk] = inner;
      }
      return out2;
    };
    const relOne = (m) => {
      const out2 = {};
      for (const [wk, rec] of Object.entries(m)) {
        const lk = key(wk);
        if (lk != null) out2[lk] = rec;
      }
      return out2;
    };
    const out = {
      digest: relOne(maps.digest),
      exclusions: relTwo(maps.exclusions),
      pins: relTwo(maps.pins),
      probes: relTwo(maps.probes),
      matches: relTwo(maps.matches),
    };
    return { maps: out, unresolved: [...unresolved] };
  }
  function applyDigestWire(prev, wire) {
    const out = { ...prev, ...projectDigestRecord(wire) };
    if (wire.deletedAt == null) delete out.deletedAt;
    return out;
  }
  function mergeLocalBack(existing, localized) {
    const mergeMap = (e, l) => {
      const out = { ...e };
      for (const [k, v] of Object.entries(l)) out[k] = v;
      return out;
    };
    const digest = { ...existing.digest };
    for (const [k, wire] of Object.entries(localized.digest)) {
      const prev = existing.digest[k];
      digest[k] = prev ? applyDigestWire(prev, wire) : wire;
    }
    return {
      digest,
      exclusions: mergeMap(existing.exclusions, localized.exclusions),
      pins: mergeMap(existing.pins, localized.pins),
      probes: mergeMap(existing.probes, localized.probes),
      matches: mergeMap(existing.matches, localized.matches),
    };
  }
  async function ensureGist(deps) {
    const existing = deps.getGistId();
    if (existing) return existing;
    const found = await deps.client.findGistByFilename(SYNC_FILE_DIGEST);
    if (found) {
      deps.setGistId(found);
      return found;
    }
    const info = await deps.client.createGist(
      SYNC_FILE_DIGEST,
      "{}",
      "Seanime manga source updates sync",
    );
    deps.setGistId(info.id);
    return info.id;
  }
  async function syncMsu(deps) {
    const { maps: wireLocal, dropped } = toWireMaps(deps.local, deps.sources);
    if (dropped.length > 0) {
      deps.log.warn(
        `msu-sync: skipped ${dropped.length} custom-source id(s) with no source ref from push`,
      );
    }
    let remoteFiles = {};
    try {
      remoteFiles = await deps.client.getGistFiles(deps.gistId, ALL_SYNC_FILES);
    } catch (_) {
      remoteFiles = {};
    }
    const remote = filesToWireMaps(remoteFiles);
    const merged = mergeMaps(wireLocal, remote);
    const mergedFiles = wireMapsToFiles(merged);
    const remoteCanon = wireMapsToFiles(remote);
    const changed = {};
    for (const { section, file } of SYNC_FILES) {
      if (deps.pushSections && !deps.pushSections.has(section)) continue;
      if (mergedFiles[file] !== remoteCanon[file])
        changed[file] = mergedFiles[file];
    }
    const changedFiles = Object.keys(changed);
    const pushed = changedFiles.length > 0;
    if (pushed) {
      await deps.client.updateGistFiles(deps.gistId, changed);
    }
    const { maps: localized, unresolved } = localizeWireMaps(
      merged,
      deps.extIdForManifest,
    );
    if (unresolved.length > 0) {
      deps.log.warn(
        `msu-sync: ${unresolved.length} remote key(s) not localizable on this instance`,
      );
    }
    const writeBack = mergeLocalBack(deps.local, localized);
    return { pushed, changedFiles, writeBack, dropped, unresolved };
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
    const pendingConfirm = ctx.state(null);
    const lastMappingSigByMedia = {};
    const myInstanceId = getInstanceId();
    const oauthTok = ctx.state(($storage.get(K_OAUTH_TOKEN) ?? "").trim());
    const oauthToken = () => oauthTok.get();
    const patToken = () => ($getUserPreference("githubPat") ?? "").trim();
    const syncToken = () => oauthToken() || patToken();
    const hasSync = () => syncToken().length > 0;
    const syncClient = () =>
      new GistClient(syncToken(), (u, i) => ctx.fetch(u, i));
    const syncing = ctx.state(false);
    const syncedAt = ctx.state($storage.get(K_SYNCED_AT) ?? 0);
    const connecting = ctx.state(false);
    const deviceStart = ctx.state(null);
    function makeExtIdResolver() {
      const index = buildManifestExtIdIndex(getSources());
      const cache = { ...index };
      return (manifestId, seedLocalId) => {
        if (manifestId in cache) return cache[manifestId];
        const extId = probeExtId(manifestId, seedLocalId, {
          getManga: (mediaId) => $anilist.getManga(mediaId),
          sleep: (ms) => $sleep(ms),
        });
        cache[manifestId] = extId;
        return extId;
      };
    }
    let lastSilentFullAt = 0;
    const SILENT_SYNC_COOLDOWN_MS = 1e4;
    async function performSync(pushSections, reason, silent) {
      const client = syncClient();
      const matchedPairs = liveLocalMatchPairs(getMatches(), myInstanceId);
      const roundTrip = async () => {
        const gistId = await ensureGist({
          client,
          getGistId: () => $storage.get(K_GIST_ID) ?? undefined,
          setGistId: (id) => $storage.set(K_GIST_ID, id),
        });
        const fullLocal = snapshotLocalMaps();
        const res = await syncMsu({
          client,
          gistId,
          local: {
            ...fullLocal,
            probes: omitCells(fullLocal.probes, matchedPairs),
          },
          sources: getSources(),
          extIdForManifest: makeExtIdResolver(),
          log,
          pushSections: pushSections ? new Set(pushSections) : undefined,
        });
        return {
          ...res,
          writeBack: {
            ...res.writeBack,
            probes: reinjectCells(
              res.writeBack.probes,
              fullLocal.probes,
              matchedPairs,
            ),
          },
        };
      };
      try {
        let res;
        try {
          res = await roundTrip();
        } catch (e) {
          if (!String(e.message).includes("404")) throw e;
          $storage.remove(K_GIST_ID);
          res = await roundTrip();
        }
        writeLocalMaps(res.writeBack);
        const now = Date.now();
        $storage.set(K_SYNCED_AT, now);
        syncedAt.set(now);
        results.set(hydrateResults());
        probeCache.set(hydrateProbes());
        reconcileInactiveProviders();
        if (res.pushed) {
          const maps = res.changedFiles
            .map((f) => f.replace("seanime-msu-", "").replace(".json", ""))
            .join(", ");
          ctx.toast.info(`☁️ Synced: ${maps}`);
        } else if (!silent) {
          ctx.toast.success("Up to date");
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
      } catch (e) {
        log.warn(`sync failed (${reason}):`, e);
        if (!silent) ctx.toast.error(`Sync failed: ${e.message}`);
      }
    }
    let syncBusy = false;
    let queuedAll = false;
    const queuedSections = new Set();
    let queuedLoud = false;
    async function requestSync(push, reason, silent) {
      if (!hasSync()) {
        if (!silent) ctx.toast.error("Connect GitHub (or add a PAT) first");
        return;
      }
      if (push === "all" && silent) {
        const nowMs = Date.now();
        if (nowMs - lastSilentFullAt < SILENT_SYNC_COOLDOWN_MS) return;
        lastSilentFullAt = nowMs;
      }
      if (push === "all") queuedAll = true;
      else for (const s of push) queuedSections.add(s);
      if (!silent) queuedLoud = true;
      if (syncBusy) return;
      syncBusy = true;
      syncing.set(true);
      try {
        while (queuedAll || queuedSections.size > 0) {
          const loud = queuedLoud;
          const sections = queuedAll ? null : [...queuedSections];
          queuedAll = false;
          queuedSections.clear();
          queuedLoud = false;
          await performSync(sections, reason, !loud);
        }
      } finally {
        syncBusy = false;
        syncing.set(false);
      }
    }
    const livePush = (sections) => {
      requestSync(sections, "live", true);
    };
    async function connectGitHub() {
      if (connecting.get()) return;
      connecting.set(true);
      try {
        const auth = new DeviceFlowClient(GITHUB_CLIENT_ID, (u, i) =>
          ctx.fetch(u, i),
        );
        const parsed = await auth.requestDeviceCode("gist");
        if (!parsed.ok) {
          ctx.toast.error(`GitHub login failed: ${parsed.message}`);
          return;
        }
        deviceStart.set(parsed.start);
        const result = await auth.pollUntilToken(parsed.start, {
          sleep: (ms) => $sleep(ms),
        });
        if (result.type === "token") {
          $storage.set(K_OAUTH_TOKEN, result.token);
          oauthTok.set(result.token);
          ctx.toast.success("Connected to GitHub");
          requestSync("all", "connected", true);
        } else if (result.type === "error") {
          ctx.toast.error(`GitHub login failed: ${result.message}`);
        } else {
          ctx.toast.error("GitHub login timed out — try again");
        }
        deviceStart.set(null);
      } catch (e) {
        log.warn("connectGitHub failed:", e);
        ctx.toast.error(`GitHub login failed: ${e.message}`);
        deviceStart.set(null);
      } finally {
        connecting.set(false);
      }
    }
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
          lastScannedAt: r.lastScannedAt,
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
      const prev = getResults()[key];
      const now = Date.now();
      const syncedSame =
        prev != null &&
        prev.title === media.title &&
        String(prev.cover ?? "") === String(media.cover ?? "");
      return {
        title: media.title,
        cover: media.cover,
        latest: maxLatest,
        read,
        sources: matched.length,
        newSources,
        kind,
        updatedAt: syncedSame ? prev.updatedAt : now,
        lastScannedAt: now,
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
            now - Number(prior.lastScannedAt ?? prior.updatedAt) < ttlMs
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
        livePush(["digest", "probes", "exclusions"]);
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
    const CONFIRM = {
      scan: {
        title: "Refresh all sources?",
        subtitle:
          "Scans every manga in your reading list across all installed sources — this can take a while.",
        button: "↻ Scan all",
        run: () => void runScan(false),
      },
      force: {
        title: "Force rescan all sources?",
        subtitle:
          "Re-probes every manga from scratch, ignoring cached results — this can take a while.",
        button: "↻ Force rescan",
        run: () => void runScan(true),
      },
      clear: {
        title: "Clear all exclusions?",
        subtitle:
          "Wipes every excluded/pinned source, then rediscovers all sources from scratch — this can take a while.",
        button: "Clear & rescan",
        run: () => {
          clearExclusions();
          ctx.toast.success("Exclusions cleared — rediscovering from scratch");
          runScan(true);
        },
      },
    };
    const requestConfirm = (kind) => {
      if (rejectIfBusy()) return;
      pendingConfirm.set(kind);
      try {
        tray.open();
      } catch {
        CONFIRM[kind].run();
      }
    };
    ctx.registerEventHandler("msu-gconfirm-close", () =>
      pendingConfirm.set(null),
    );
    ctx.registerEventHandler("msu-gconfirm-run", () => {
      const kind = pendingConfirm.get();
      pendingConfirm.set(null);
      if (!kind) return;
      if (rejectIfBusy()) return;
      CONFIRM[kind].run();
    });
    ctx.registerEventHandler("msu-scan", () => {
      requestConfirm("scan");
    });
    ctx.registerEventHandler("msu-force", () => {
      requestConfirm("force");
    });
    ctx.registerEventHandler("msu-cancel", () => {
      if (!scanning.get()) return;
      cancelRequested.set(true);
      status.set("Cancelling…");
    });
    ctx.registerEventHandler("msu-sync-now", () => {
      requestSync("all", "manual", false);
    });
    ctx.registerEventHandler("msu-connect", () => {
      connectGitHub();
    });
    ctx.registerEventHandler("msu-sync-disconnect", () => {
      $storage.set(K_OAUTH_TOKEN, "");
      oauthTok.set("");
      syncedAt.set(0);
      ctx.toast.info(
        "Disconnected. (Clear the PAT config field to fully stop.)",
      );
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
      livePush(["exclusions", "pins"]);
    }
    ctx.registerEventHandler("msu-clear-excl", () => {
      requestConfirm("clear");
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
            return {
              media: m,
              read: Number(e.listData?.progress ?? 0),
              status: e.listData?.status ?? "",
            };
          }
        }
      }
      try {
        const m = $anilist.getManga(mediaId);
        if (m) return { media: m, read: 0, status: "" };
      } catch {}
      return null;
    }
    function syncRow(mediaId, result, reading = true) {
      const cur = results.get();
      const exists = cur.some((r) => r.mediaId === mediaId);
      if (!reading && !exists) return;
      const stored = getResults();
      stored[String(mediaId)] = result;
      setResults(stored);
      const row = {
        ...result,
        mediaId,
        isNew: result.kind === "new",
        fromCache: false,
      };
      results.set(
        exists
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
        syncRow(mediaId, result, String(found.status) === "CURRENT");
        ctx.toast.success(`${result.sources} sources have ${title}`);
      } catch {
        ctx.toast.error("Failed to probe sources");
      } finally {
        if (probingId.get() === mediaId) probingId.set(null);
        scanProgress.set(null);
        scanningProviders.set(null);
        livePush(["digest", "probes", "exclusions"]);
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
          String(found.status) === "CURRENT",
        );
      } catch {
        ctx.toast.error("Failed to scan source");
      } finally {
        scanningProvider.set("");
        scanProgress.set(null);
        livePush(["digest", "probes"]);
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
      livePush(["exclusions", "pins"]);
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
    function renderSyncSection() {
      const start = deviceStart.get();
      const connected = hasSync();
      const via = oauthToken() ? "GitHub login" : patToken() ? "PAT" : "";
      return githubConnect(tray, {
        deviceStart: start,
        title: "\uD83C\uDF10 Sync",
        connecting: connecting.get(),
        connected,
        disconnectable: !!oauthToken(),
        connectEvent: "msu-connect",
        disconnectEvent: "msu-sync-disconnect",
        status: {
          connected,
          syncing: syncing.get(),
          lastSyncedAt: syncedAt.get(),
          via,
        },
        connectedActions: [
          {
            label: syncing.get() ? "Syncing…" : "Sync now",
            onClick: "msu-sync-now",
            disabled: syncing.get(),
          },
        ],
      });
    }
    function renderDetail() {
      const id = detailId.get();
      if (id == null) return null;
      const key = String(id);
      const cur = results.get().find((r) => r.mediaId === id);
      const excluded = getExcludedView();
      const excludedForManga = excluded[key] ?? {};
      const probeByProvider = probeCache.get()[id] ?? {};
      const matchesForManga = getMatches()[key] ?? {};
      const matchWarn = (pid) => {
        const div = matchDivergence(matchesForManga[pid]);
        if (!div.diverges) return;
        return div.reason === "different"
          ? {
              label: "⚠ ≠",
              tooltip:
                "Matched to a different series on another device — count may be off.",
            }
          : {
              label: "⚠ ?",
              tooltip:
                "Manually matched on another device, not here — count may be off.",
            };
      };
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
                ? `Scanning ${prog.done}/${prog.total}`
                : "Scanning…"
              : "↻ Scan this manga",
            {
              onClick: ctx.eventHandler(`msu-rescan-${id}`, () =>
                rescanCurrent(),
              ),
              size: "sm",
              intent: "gray-subtle",
              loading: scanningThis,
              disabled: busy && !scanningThis,
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
        return { label: `+${newCount}`, intent };
      };
      const availableRow = (pid) => {
        const p = probeByProvider[pid];
        const name = p ? p.providerName : String(providers[pid] ?? pid);
        return {
          title: name,
          status: sourceStatus(p),
          warn: matchWarn(pid),
          chapter: p?.matched ? p.latest : undefined,
          actions: [
            tray.tooltip(
              tray.button(isPidScanning(pid) ? "…" : "↻", {
                onClick: ctx.eventHandler(`msu-rescan1-${id}-${pid}`, () =>
                  scanOneProvider(id, pid),
                ),
                size: "sm",
                intent: "gray-subtle",
                loading: isPidScanning(pid),
                disabled: busy && !isPidScanning(pid),
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
          warn: matchWarn(pid),
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
          lastScannedAt: r.lastScannedAt,
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
    const CARD_DECORATE_BATCH = 8;
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
        requestSync("all", "tray opened", true);
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
      const { mediaId } = await cardAttrs();
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
    const decorateCards = async (els) => {
      for (let i = 0; i < els.length; i += CARD_DECORATE_BATCH) {
        await Promise.all(
          els.slice(i, i + CARD_DECORATE_BATCH).map((el) => decorateCard(el)),
        );
        $sleep(0);
      }
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
      const matchesForManga = getMatches()[key] ?? {};
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
          warn: matchDivergence(matchesForManga[x.pid]).reason,
        }))
        .sort((a, b) => b.latest - a.latest || a.name.localeCompare(b.name));
      const sig = items.length
        ? `${selectedPid ?? ""}|${items.map((i) => `${i.pid}+${i.unread}${i.warn ? `!${i.warn}` : ""}`).join(",")}`
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
                const warnNote = i.warn
                  ? ` · manual match ${i.warn === "different" ? "differs" : "missing"} across your devices`
                  : "";
                const title = `${escHtml(i.name)}: ${i.unread} unread chapter${i.unread === 1 ? "" : "s"}${warnNote}`;
                const label = `${escHtml(i.name)} +${i.unread}${i.warn ? " ⚠" : ""}`;
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
    let cardsSweeping = false;
    let cardsDirty = false;
    const redecorateCards = async () => {
      if (cardsSweeping) {
        cardsDirty = true;
        return;
      }
      cardsSweeping = true;
      try {
        do {
          cardsDirty = false;
          reconcileInactiveProviders();
          const cards = await ctx.dom.query(
            '[data-media-entry-card-container][data-media-type="manga"]',
          );
          await decorateCards(cards ?? []);
        } while (cardsDirty);
      } catch (e) {
        log.warn("redecorateCards failed:", e);
      } finally {
        cardsSweeping = false;
      }
    };
    const redecorateBar = async () => {
      try {
        const cont = (
          await ctx.dom.query("[data-chapter-list-container]")
        )?.[0];
        if (cont) {
          decorateBar(cont);
          hookRefreshSourceButton(cont);
        }
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
    const hookRefreshSourceButton = async (container) => {
      if (!currentMediaId.get()) return;
      let buttons = [];
      try {
        buttons =
          (await container.query(
            "[data-chapter-list-header-container] button",
          )) ?? [];
      } catch {
        return;
      }
      for (const btn of buttons) {
        try {
          const text = String((await btn.getText()) ?? "")
            .trim()
            .toLowerCase();
          if (text !== "refresh source") continue;
          if (await btn.hasAttribute("data-msu-refresh-source-hooked")) return;
          btn.setAttribute("data-msu-refresh-source-hooked", "1");
          btn.addEventListener("click", () => {
            if (!syncNativeButtons()) return;
            const id = currentMediaId.get();
            if (id <= 0) return;
            if (rejectIfBusy()) return;
            probeMangaDetail(id);
          });
        } catch {}
        return;
      }
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
          matches[String(mediaId)]?.[provider]?.[myInstanceId],
        );
        if (action.type === "tombstone") {
          setMatches(
            tombstoneMatch(matches, mediaId, provider, myInstanceId, now),
          );
          livePush(["matches"]);
        } else if (action.type === "upsert") {
          setMatches(
            upsertMatch(
              matches,
              mediaId,
              provider,
              myInstanceId,
              action.mappedId,
              now,
            ),
          );
          livePush(["matches"]);
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
            requestConfirm("scan");
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
        decorateCards(els ?? []);
      },
      { withInnerHTML: true },
    );
    dm.observe(
      "[data-chapter-list-container]",
      (els) => {
        const c = els[0];
        if (c) {
          decorateBar(c);
          hookRefreshSourceButton(c);
        }
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
    function renderGlobalConfirm(kind) {
      const cfg = CONFIRM[kind];
      const head = trayHeader(tray, {
        title: cfg.title,
        subtitle: cfg.subtitle,
      });
      const actionRow = tray.flex(
        [
          tray.button("Cancel", {
            onClick: "msu-gconfirm-close",
            size: "sm",
            intent: "gray-subtle",
          }),
          tray.button(cfg.button, {
            onClick: "msu-gconfirm-run",
            size: "sm",
            intent: "primary",
          }),
        ],
        { gap: 2, style: { alignItems: "center", justifyContent: "flex-end" } },
      );
      return tray.stack(joinDividers(tray, [head, actionRow]), { gap: 3 });
    }
    const autoSync = ($getUserPreference("autoSync") ?? "false") === "true";
    if (autoSync && hasSync()) {
      const mins = Math.max(
        5,
        Number($getUserPreference("syncIntervalMinutes") ?? "30") || 30,
      );
      const expr =
        mins < 60 ? `*/${mins} * * * *` : `0 */${Math.round(mins / 60)} * * *`;
      try {
        ctx.cron.add("msu-auto-sync", expr, () => {
          requestSync("all", "auto", true);
        });
        ctx.cron.start();
      } catch (e) {
        ctx.toast.error(`Auto-sync schedule failed: ${e.message}`);
      }
    }
    tray.render(() => {
      const pc = pendingConfirm.get();
      if (pc) return renderGlobalConfirm(pc);
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
                trigger: tray.button("⋮", {
                  size: "sm",
                  intent: "gray-subtle",
                }),
                items: [
                  tray.dropdownMenuItem(tray.span("↻ Force rescan"), {
                    onClick: "msu-force",
                  }),
                  tray.dropdownMenuItem(tray.span("Clear exclusions"), {
                    onClick: "msu-clear-excl",
                    className: ALERT_MENU_ITEM_STYLE,
                  }),
                ],
              }),
            ],
      });
      const blocks = [
        header,
        renderSyncSection(),
        renderNewOn(),
        renderResults(),
      ];
      return tray.stack(joinDividers(tray, blocks), { gap: 3 });
    });
  };
  return register2(...args);
};

// src/plugins/manga-source-updates/code.ts
function init() {
  $ui.register(register);
}
