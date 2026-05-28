// src/plugins/local-catalog-manager/modules/register.ts
var register = (...args) => {
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
  function parseCatalog(raw) {
    let data = raw;
    if (typeof raw === "string") {
      try {
        data = JSON.parse(raw);
      } catch {
        return [];
      }
    }
    let list = [];
    if (Array.isArray(data)) {
      list = data;
    } else if (data && typeof data === "object" && Array.isArray(data.manga)) {
      list = data.manga;
    }
    const byId = new Map();
    for (const item of list) {
      const entry = item;
      const id = Number(entry?.id);
      if (!Number.isInteger(id) || id < 1) {
        console.warn("local-catalog: skipping entry with invalid id");
        continue;
      }
      if (!resolveUserPreferred(entry?.title)) {
        console.warn(`local-catalog: skipping entry ${id} with no title`);
        continue;
      }
      if (byId.has(id)) {
        console.warn(`local-catalog: duplicate id ${id}, last wins`);
      }
      entry.id = id;
      byId.set(id, entry);
    }
    return Array.from(byId.values());
  }
  function serializeCatalog(entries, updatedAt) {
    return JSON.stringify({ version: 1, updatedAt, manga: entries });
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
      typeof t === "string"
        ? t
        : t?.userPreferred || t?.english || t?.romaji || t?.native || "";
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
          description: "local-catalog catalog",
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
  }
  var FILENAME = "catalog.json";
  var K_GIST = "lmm_gist_id";
  var K_OWNER = "lmm_owner";
  var K_RAW = "lmm_raw_url";
  var K_CATALOG = "lmm_catalog";
  var K_UPDATED = "lmm_updated_at";
  var register2 = (ctx) => {
    const tray = ctx.newTray({
      tooltipText: "Local Catalog Manager",
      iconUrl:
        "https://raw.githubusercontent.com/Carloss616/seanime-extensions/main/src/plugins/local-catalog-manager/assets/icon.png",
      withContent: true,
    });
    const view = ctx.state("list");
    const entries = ctx.state($storage.get(K_CATALOG) ?? []);
    const editingId = ctx.state(0);
    const rawUrl = ctx.state($storage.get(K_RAW) ?? "");
    const status = ctx.state("");
    const fTitle = ctx.fieldRef("");
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
    const fIsAdult = ctx.fieldRef(false);
    const fCountry = ctx.fieldRef("");
    const fSiteUrl = ctx.fieldRef("");
    const fJsonOut = ctx.fieldRef("");
    const fJsonIn = ctx.fieldRef("");
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
    const userGistUrl = () => ($getUserPreference("gistUrl") ?? "").trim();
    const effectiveGistId = () => {
      const u = userGistUrl();
      if (u) {
        const parsed = parseGistId(u);
        if (parsed) return parsed;
      }
      return $storage.get(K_GIST) ?? "";
    };
    const effectiveRawUrl = () => userGistUrl() || rawUrl.get();
    const ent = (n) => `${n} ${n === 1 ? "entry" : "entries"}`;
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
    }
    async function push(next) {
      const updatedAt = Date.now();
      if (!hasToken()) {
        persistLocal(next, updatedAt);
        status.set(next.length > 0 ? `Saved ${ent(next.length)} locally` : "");
        return;
      }
      const userUrl = userGistUrl();
      if (userUrl && !parseGistId(userUrl)) {
        ctx.toast.error(
          `Couldn't parse a Gist ID from "${userUrl}". Use a gist URL or bare ID, or clear the field.`,
        );
        return;
      }
      const json = serializeCatalog(next, updatedAt);
      try {
        let gistId = effectiveGistId();
        if (!gistId) {
          const info = await client().createGist(FILENAME, json);
          $storage.set(K_GIST, info.id);
          $storage.set(K_OWNER, info.owner);
          $storage.set(K_RAW, info.rawUrl);
          rawUrl.set(info.rawUrl);
          gistId = info.id;
          ctx.toast.success("Created Gist. Copy the raw URL into the source.");
        } else {
          await client().updateGistFile(gistId, FILENAME, json);
        }
        persistLocal(next, updatedAt);
        status.set(`Synced ${ent(next.length)}`);
      } catch (e) {
        ctx.toast.error(`Sync failed: ${e.message}`);
      }
    }
    async function pull() {
      const userUrl = userGistUrl();
      if (userUrl && !parseGistId(userUrl)) {
        ctx.toast.error(
          `Couldn't parse a Gist ID from "${userUrl}". Use a gist URL or bare ID, or clear the field.`,
        );
        return;
      }
      const gistId = effectiveGistId();
      if (!token() || !gistId) {
        ctx.toast.info(
          "Nothing to pull yet — add an entry to create the Gist.",
        );
        return;
      }
      try {
        const content = await client().getGistFile(gistId, FILENAME);
        const remote = parseCatalog(content);
        persistLocal(remote, Date.now());
        ctx.toast.success(`Pulled ${ent(remote.length)}`);
      } catch (e) {
        ctx.toast.error(`Pull failed: ${e.message}`);
      }
    }
    function openForm(id) {
      editingId.set(id);
      const e = entries.get().find((x) => x.id === id);
      fTitle.setValue(resolveUserPreferred(e?.title) ?? "");
      fSynonyms.setValue((e?.synonyms ?? []).join(", "));
      fCover.setValue(e?.cover ?? "");
      fBanner.setValue(e?.banner ?? "");
      fDescription.setValue(e?.description ?? "");
      fGenres.setValue((e?.genres ?? []).join(", "));
      fStatus.setValue(e?.status ?? "");
      fFormat.setValue(e?.format ?? "");
      fChapters.setValue(e?.chapters != null ? String(e.chapters) : "");
      fVolumes.setValue(e?.volumes != null ? String(e.volumes) : "");
      fYear.setValue(e?.year != null ? String(e.year) : "");
      fIsAdult.setValue(!!e?.isAdult);
      fCountry.setValue(e?.country ?? "");
      fSiteUrl.setValue(e?.siteUrl ?? "");
      view.set("form");
    }
    ctx.registerEventHandler("lmm-new", () => openForm(0));
    ctx.registerEventHandler("lmm-cancel", () => view.set("list"));
    ctx.registerEventHandler("lmm-pull", () => {
      pull();
    });
    ctx.registerEventHandler("lmm-save", () => {
      const current = entries.get();
      const id = editingId.get() > 0 ? editingId.get() : nextId(current);
      const entry = {
        id,
        title: (fTitle.current ?? "").trim(),
        synonyms: list(fSynonyms.current),
        cover: (fCover.current ?? "").trim() || undefined,
        banner: (fBanner.current ?? "").trim() || undefined,
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
        year: num(fYear.current),
        isAdult: fIsAdult.current ? true : undefined,
        country: (fCountry.current ?? "").trim() || undefined,
        siteUrl: (fSiteUrl.current ?? "").trim() || undefined,
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
    ctx.registerEventHandler("lmm-import", () => {
      const raw = (fJsonIn.current ?? "").trim();
      if (!raw) {
        ctx.toast.error("Paste a catalog JSON first.");
        return;
      }
      try {
        const imported = parseCatalog(raw);
        if (imported.length === 0) {
          ctx.toast.error("No valid entries in that JSON.");
          return;
        }
        push(imported);
        fJsonIn.setValue("");
        ctx.toast.success(`Imported ${ent(imported.length)}.`);
      } catch (e) {
        ctx.toast.error(`Import failed: ${e.message}`);
      }
    });
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
    function renderSync() {
      if (hasToken()) {
        const url = effectiveRawUrl();
        const count = entries.get().length;
        const fallbackStatus =
          effectiveGistId() && count > 0
            ? `${ent(count)} synced`
            : "not synced yet";
        const statusLine = status.get() || fallbackStatus;
        const items2 = [
          tray.div([
            tray.span("☁ "),
            tray.span("Gist mode", { style: { fontWeight: "600" } }),
            tray.span(` · ${statusLine}`, {
              style: { opacity: "0.65", fontSize: "0.85rem" },
            }),
          ]),
        ];
        if (url) {
          items2.push(
            tray.div(
              [
                tray.text("CATALOG URL", {
                  style: {
                    fontSize: "0.7rem",
                    fontWeight: "700",
                    opacity: "0.55",
                    letterSpacing: "0.08em",
                    marginBottom: "4px",
                  },
                }),
                tray.text(url, {
                  style: {
                    fontSize: "0.75rem",
                    fontFamily: "monospace",
                    wordBreak: "break-all",
                    opacity: "0.9",
                  },
                }),
                tray.text(
                  "Paste this into the Local Catalog source's 'Catalog URL' setting.",
                  {
                    style: {
                      fontSize: "0.7rem",
                      opacity: "0.6",
                      marginTop: "4px",
                    },
                  },
                ),
              ],
              {
                style: {
                  padding: "8px 10px",
                  borderRadius: "6px",
                  background: "rgba(255,255,255,0.04)",
                  borderLeft: "2px solid rgba(100,150,255,0.5)",
                },
              },
            ),
          );
        }
        items2.push(
          tray.flex([
            tray.button("New entry", { onClick: "lmm-new", intent: "primary" }),
            tray.button("\uD83D\uDD04 Pull now", { onClick: "lmm-pull" }),
          ]),
        );
        return tray.stack(items2);
      }
      const items = [
        tray.div([
          tray.span("\uD83D\uDD12 "),
          tray.span("Local mode", { style: { fontWeight: "600" } }),
          tray.span(" · edits saved on this device", {
            style: { opacity: "0.65", fontSize: "0.85rem" },
          }),
        ]),
        tray.div(
          [
            tray.text(
              "⚠ Plugin and source can't sync directly — seanime sandboxes extensions. Copy the JSON below into the source's Inline catalog JSON field after every edit.",
              { style: { fontSize: "0.8rem" } },
            ),
            tray.text(
              "\uD83D\uDCA1 Tip: set a GitHub token in the plugin config to switch to Gist mode — automatic sync, no copy-paste.",
              {
                style: {
                  fontSize: "0.8rem",
                  marginTop: "4px",
                  opacity: "0.85",
                },
              },
            ),
          ],
          {
            style: {
              padding: "8px 10px",
              borderRadius: "6px",
              background: "rgba(255,255,255,0.04)",
              borderLeft: "2px solid rgba(255,180,0,0.5)",
            },
          },
        ),
      ];
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
        marginTop: "-4px",
      };
      items.push(
        tray.flex(
          [
            tray.div(
              [
                tray.input("\uD83D\uDCE4 Generated Inline catalog JSON", {
                  fieldRef: fJsonOut,
                }),
              ],
              { style: { flex: "1", minWidth: "0" } },
            ),
            tray.button("New entry", { onClick: "lmm-new", intent: "primary" }),
          ],
          { gap: 2, style: { alignItems: "end" } },
        ),
        tray.text(
          "Copy the content to the Local Catalog source's 'Inline catalog JSON' setting.",
          { style: hintStyle },
        ),
        tray.flex(
          [
            tray.div(
              [
                tray.input("\uD83D\uDCE5 Paste a catalog JSON", {
                  fieldRef: fJsonIn,
                }),
              ],
              { style: { flex: "1", minWidth: "0" } },
            ),
            tray.button("Import", { onClick: "lmm-import" }),
          ],
          { gap: 2, style: { alignItems: "end" } },
        ),
        tray.text(
          "Click Import to replace the current catalog with this JSON.",
          {
            style: hintStyle,
          },
        ),
      );
      return tray.stack(items);
    }
    function renderList() {
      const list2 = entries.get();
      const rows = list2.map((e) =>
        tray.flex(
          [
            tray.div(
              [
                tray.span(`#${e.id} `, {
                  style: { opacity: "0.5", fontSize: "0.85rem" },
                }),
                tray.span(resolveUserPreferred(e.title) ?? "(untitled)", {
                  style: { fontWeight: "500" },
                }),
              ],
              { style: { flex: "1", minWidth: "0" } },
            ),
            tray.button("Edit", {
              onClick: ctx.eventHandler(`lmm-edit-${e.id}`, () =>
                openForm(e.id),
              ),
              size: "sm",
            }),
            tray.button("Delete", {
              onClick: ctx.eventHandler(`lmm-del-${e.id}`, () => {
                push(removeEntry(entries.get(), e.id));
              }),
              size: "sm",
              intent: "alert-subtle",
            }),
          ],
          {
            gap: 2,
            style: {
              alignItems: "center",
              padding: "6px 8px",
              borderRadius: "4px",
              background: "rgba(255,255,255,0.02)",
            },
          },
        ),
      );
      const listSection = [];
      if (list2.length > 0) {
        listSection.push(
          tray.div([], {
            style: {
              borderTop: "1px solid rgba(255,255,255,0.15)",
              marginTop: "12px",
              marginBottom: "4px",
            },
          }),
          tray.text(`ENTRIES (${list2.length})`, {
            style: {
              fontSize: "0.7rem",
              fontWeight: "700",
              opacity: "0.55",
              letterSpacing: "0.1em",
              marginBottom: "4px",
            },
          }),
          ...rows,
        );
      }
      return tray.stack([renderSync(), tray.stack(listSection)]);
    }
    function renderForm() {
      const isNew = editingId.get() === 0;
      return tray.stack([
        tray.text(isNew ? "New entry" : `Edit #${editingId.get()}`, {
          style: { fontWeight: "600", fontSize: "1rem", marginBottom: "4px" },
        }),
        tray.input("Title *", { fieldRef: fTitle }),
        tray.div([], {
          style: {
            borderTop: "1px solid rgba(255,255,255,0.15)",
            marginTop: "16px",
            marginBottom: "4px",
          },
        }),
        tray.text("OPTIONAL", {
          style: {
            fontSize: "0.7rem",
            fontWeight: "700",
            opacity: "0.55",
            letterSpacing: "0.1em",
            marginBottom: "4px",
          },
        }),
        tray.input("Synonyms (comma-separated)", { fieldRef: fSynonyms }),
        tray.input("Cover URL", { fieldRef: fCover }),
        tray.input("Banner URL", { fieldRef: fBanner }),
        tray.input("Description", { fieldRef: fDescription }),
        tray.input("Genres (comma-separated)", { fieldRef: fGenres }),
        tray.select("Status", { options: STATUS_OPTS, fieldRef: fStatus }),
        tray.select("Format", { options: FORMAT_OPTS, fieldRef: fFormat }),
        tray.input("Chapters", { fieldRef: fChapters }),
        tray.input("Volumes", { fieldRef: fVolumes }),
        tray.input("Year", { fieldRef: fYear }),
        tray.switch("Adult", { fieldRef: fIsAdult }),
        tray.input("Country (e.g. JP)", { fieldRef: fCountry }),
        tray.input("Site URL", { fieldRef: fSiteUrl }),
        tray.flex([
          tray.button("Save", { onClick: "lmm-save", intent: "primary" }),
          tray.button("Cancel", { onClick: "lmm-cancel" }),
        ]),
      ]);
    }
    const EXT_OFFSET = 2147483648;
    const LOCAL_RANGE = 1099511627776;
    const PREFIX = "ext_custom_source_local-catalog";
    const currentLocalId = ctx.state(0);
    const localIdFromMediaId = (mediaId) => {
      if (mediaId < EXT_OFFSET) return 0;
      let m;
      try {
        m = $anilist.getManga(mediaId);
      } catch {
        m = undefined;
      }
      const siteUrl = m?.siteUrl ?? "";
      if (siteUrl.indexOf(PREFIX) !== 0) return 0;
      return (mediaId - EXT_OFFSET) % LOCAL_RANGE;
    };
    const pageBtn = ctx.action.newMangaPageButton({
      label: "Edit local entry",
      intent: "primary-subtle",
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
        { label: "➕ New entry", value: "new", onSelect: () => openForm(0) },
        { label: "⟳ Pull now", value: "pull", onSelect: () => void pull() },
      ];
      const items = entries.get().map((en) => ({
        label: `✎ #${en.id} ${resolveUserPreferred(en.title) ?? ""}`,
        value: `edit-${en.id}`,
        filterType: "includes",
        onSelect: () => openForm(en.id),
      }));
      palette.setItems([...base, ...items]);
    };
    ctx.effect(() => refreshPalette(), [entries]);
    palette.onOpen(() => refreshPalette());
    ctx.effect(() => {
      if (!hasToken()) {
        const updatedAt = $storage.get(K_UPDATED) ?? Date.now();
        fJsonOut.setValue(serializeCatalog(entries.get(), updatedAt));
      }
    }, [entries]);
    const autoSync = ($getUserPreference("autoSync") ?? "false") === "true";
    if (autoSync && hasToken()) {
      const mins = Math.max(
        5,
        Number($getUserPreference("syncIntervalMinutes") ?? "30") || 30,
      );
      const expr =
        mins < 60 ? `*/${mins} * * * *` : `0 */${Math.round(mins / 60)} * * *`;
      try {
        ctx.cron.add("lmm-auto-pull", expr, () => {
          if (effectiveGistId()) pull();
        });
        ctx.cron.start();
      } catch (e) {
        ctx.toast.error(`Auto-sync schedule failed: ${e.message}`);
      }
    }
    tray.render(() => {
      if (view.get() === "form") return renderForm();
      return renderList();
    });
  };
  return register2(...args);
};

// src/plugins/local-catalog-manager/code.ts
function init() {
  console.log("[local-catalog-manager] initialized");
  $ui.register(register);
}
