import {
  parseCatalog,
  resolveUserPreferred,
  serializeCatalog,
} from "../../../_shared/local-catalog/parse";
import {
  nextId,
  removeEntry,
  upsertEntry,
  validateEntry,
} from "../utils/catalog";
import { GistClient } from "../utils/gist-client";

const FILENAME = "catalog.json";
const K_GIST = "lmm_gist_id";
const K_OWNER = "lmm_owner";
const K_RAW = "lmm_raw_url";
const K_CATALOG = "lmm_catalog";
const K_UPDATED = "lmm_updated_at";

export const register = (ctx: PluginContext) => {
  const tray = ctx.newTray({
    tooltipText: "Local Catalog Manager",
    iconUrl:
      "https://raw.githubusercontent.com/Carloss616/seanime-extensions/main/src/plugins/local-catalog-manager/assets/icon.png",
    withContent: true,
  });

  const view = ctx.state<"list" | "form" | "setup">("list");
  const entries = ctx.state<CatalogEntry[]>(
    $storage.get<CatalogEntry[]>(K_CATALOG) ?? [],
  );
  const editingId = ctx.state<number>(0);
  const rawUrl = ctx.state<string>($storage.get<string>(K_RAW) ?? "");
  const status = ctx.state<string>("");

  const fTitle = ctx.fieldRef<string>("");
  const fSynonyms = ctx.fieldRef<string>("");
  const fCover = ctx.fieldRef<string>("");
  const fBanner = ctx.fieldRef<string>("");
  const fDescription = ctx.fieldRef<string>("");
  const fGenres = ctx.fieldRef<string>("");
  const fStatus = ctx.fieldRef<string>("");
  const fFormat = ctx.fieldRef<string>("");
  const fChapters = ctx.fieldRef<string>("");
  const fVolumes = ctx.fieldRef<string>("");
  const fYear = ctx.fieldRef<string>("");
  const fIsAdult = ctx.fieldRef<boolean>(false);
  const fCountry = ctx.fieldRef<string>("");
  const fSiteUrl = ctx.fieldRef<string>("");
  const fJsonOut = ctx.fieldRef<string>("");
  const fJsonIn = ctx.fieldRef<string>("");

  const token = () => ($getUserPreference("githubToken") ?? "").trim();
  const hasToken = () => token().length > 0;
  const client = () => new GistClient(token(), (u, i) => ctx.fetch(u, i));

  // Accept a Gist raw URL, share URL, or a bare hex id; return the gist id
  // (or null if the input doesn't look like a gist).
  const parseGistId = (input: string): string | null => {
    const trimmed = input.trim();
    if (!trimmed) return null;
    if (/^[a-f0-9]+$/i.test(trimmed)) return trimmed;
    const m = trimmed.match(
      /gist\.github(?:usercontent)?\.com\/[^/]+\/([a-f0-9]+)/i,
    );
    return m ? m[1] : null;
  };
  // User-provided gist URL (raw or share) from config. Takes priority over
  // the auto-created gist stored in $storage (K_GIST).
  const userGistUrl = () => ($getUserPreference("gistUrl") ?? "").trim();
  const effectiveGistId = (): string => {
    const u = userGistUrl();
    if (u) {
      const parsed = parseGistId(u);
      if (parsed) return parsed;
    }
    return $storage.get<string>(K_GIST) ?? "";
  };
  // URL to display to the user (and to suggest pasting into the source's
  // Catalog URL field). Prefers what they pasted in config; falls back to
  // what we built when we created the gist ourselves.
  const effectiveRawUrl = () => userGistUrl() || rawUrl.get();
  // 1 entry vs 2 entries.
  const ent = (n: number) => `${n} ${n === 1 ? "entry" : "entries"}`;

  const num = (s: string | undefined): number | undefined => {
    const v = Number((s ?? "").trim());
    return (s ?? "").trim() !== "" && Number.isFinite(v) ? v : undefined;
  };
  const list = (s: string | undefined): string[] | undefined => {
    const arr = (s ?? "")
      .split(",")
      .map((x) => x.trim())
      .filter((x) => x.length > 0);
    return arr.length > 0 ? arr : undefined;
  };

  function persistLocal(next: CatalogEntry[], updatedAt: number) {
    entries.set(next);
    $storage.set(K_CATALOG, next);
    $storage.set(K_UPDATED, updatedAt);
  }

  async function push(next: CatalogEntry[]) {
    const updatedAt = Date.now();
    if (!hasToken()) {
      // Local-only mode: persist on this device. The user copies the
      // serialized JSON into the source's Inline catalog field by hand.
      persistLocal(next, updatedAt);
      status.set(next.length > 0 ? `Saved ${ent(next.length)} locally` : "");
      return;
    }
    // Reject an unparseable user-provided Gist URL early instead of silently
    // falling back to auto-create (which would surprise the user).
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
      ctx.toast.error(`Sync failed: ${(e as Error).message}`);
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
      ctx.toast.info("Nothing to pull yet — add an entry to create the Gist.");
      return;
    }
    try {
      const content = await client().getGistFile(gistId, FILENAME);
      const remote = parseCatalog(content);
      persistLocal(remote, Date.now());
      ctx.toast.success(`Pulled ${ent(remote.length)}`);
    } catch (e) {
      ctx.toast.error(`Pull failed: ${(e as Error).message}`);
    }
  }

  function openForm(id: number) {
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
    void pull();
  });

  ctx.registerEventHandler("lmm-save", () => {
    const current = entries.get();
    const id = editingId.get() > 0 ? editingId.get() : nextId(current);
    const entry: CatalogEntry = {
      id,
      title: (fTitle.current ?? "").trim(),
      synonyms: list(fSynonyms.current),
      cover: (fCover.current ?? "").trim() || undefined,
      banner: (fBanner.current ?? "").trim() || undefined,
      description: (fDescription.current ?? "").trim() || undefined,
      genres: list(fGenres.current),
      status: (() => {
        const v = (fStatus.current ?? "").trim();
        return v && v !== NONE ? (v as $app.AL_MediaStatus) : undefined;
      })(),
      format: (() => {
        const v = (fFormat.current ?? "").trim();
        return v && v !== NONE ? (v as $app.AL_MediaFormat) : undefined;
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
    void push(next);
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
      void push(imported);
      fJsonIn.setValue("");
      ctx.toast.success(`Imported ${ent(imported.length)}.`);
    } catch (e) {
      ctx.toast.error(`Import failed: ${(e as Error).message}`);
    }
  });

  // Radix-UI Select forbids Select.Item value="" (reserved for the
  // "cleared" state shown via placeholder). Use a non-empty sentinel
  // and treat it as undefined when serializing the entry.
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
      // status is runtime-only state — empty after a reload. Derive a
      // meaningful fallback from persisted state (entries + gist) so the
      // header doesn't lie with "not synced yet" when we are.
      const count = entries.get().length;
      const fallbackStatus =
        effectiveGistId() && count > 0
          ? `${ent(count)} synced`
          : "not synced yet";
      const statusLine = status.get() || fallbackStatus;
      const items: unknown[] = [
        // Header: icon + bold label + dim status line.
        tray.div([
          tray.span("☁ "),
          tray.span("Gist mode", { style: { fontWeight: "600" } }),
          tray.span(` · ${statusLine}`, {
            style: { opacity: "0.65", fontSize: "0.85rem" },
          }),
        ]),
      ];
      // Catalog URL callout (only when we know it).
      if (url) {
        items.push(
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
      items.push(
        tray.flex([
          tray.button("New entry", { onClick: "lmm-new", intent: "primary" }),
          tray.button("🔄 Pull now", { onClick: "lmm-pull" }),
        ]),
      );
      return tray.stack(items);
    }
    // Local-only mode (no GitHub token configured).
    const items: unknown[] = [
      // Headline: title + dim subtitle.
      tray.div([
        tray.span("🔒 "),
        tray.span("Local mode", { style: { fontWeight: "600" } }),
        tray.span(" · edits saved on this device", {
          style: { opacity: "0.65", fontSize: "0.85rem" },
        }),
      ]),
      // Callout: sandbox limitation + Gist recommendation.
      tray.div(
        [
          tray.text(
            "⚠ Plugin and source can't sync directly — seanime sandboxes extensions. Copy the JSON below into the source's Inline catalog JSON field after every edit.",
            { style: { fontSize: "0.8rem" } },
          ),
          tray.text(
            "💡 Tip: set a GitHub token in the plugin config to switch to Gist mode — automatic sync, no copy-paste.",
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
      // Output section: generated JSON + "New entry" + hint.
      tray.flex(
        [
          tray.div(
            [
              tray.input("📤 Generated Inline catalog JSON", {
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
      // Input section: paste JSON + "Import" + hint.
      tray.flex(
        [
          tray.div(
            [tray.input("📥 Paste a catalog JSON", { fieldRef: fJsonIn })],
            { style: { flex: "1", minWidth: "0" } },
          ),
          tray.button("Import", { onClick: "lmm-import" }),
        ],
        { gap: 2, style: { alignItems: "end" } },
      ),
      tray.text("Click Import to replace the current catalog with this JSON.", {
        style: hintStyle,
      }),
    );
    return tray.stack(items);
  }

  function renderList() {
    const list = entries.get();
    const rows = list.map((e) =>
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
            onClick: ctx.eventHandler(`lmm-edit-${e.id}`, () => openForm(e.id)),
            size: "sm",
          }),
          tray.button("Delete", {
            onClick: ctx.eventHandler(`lmm-del-${e.id}`, () => {
              void push(removeEntry(entries.get(), e.id));
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
    // Section header + rows — only when there are entries.
    const listSection: unknown[] = [];
    if (list.length > 0) {
      listSection.push(
        tray.div([], {
          style: {
            borderTop: "1px solid rgba(255,255,255,0.15)",
            marginTop: "12px",
            marginBottom: "4px",
          },
        }),
        tray.text(`ENTRIES (${list.length})`, {
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
      // Plain bold heading — the "*" on the Title label below is the
      // standard required marker, no pill needed.
      tray.text(isNew ? "New entry" : `Edit #${editingId.get()}`, {
        style: { fontWeight: "600", fontSize: "1rem", marginBottom: "4px" },
      }),
      // Required field.
      tray.input("Title *", { fieldRef: fTitle }),
      // Section separator: stronger divider + bolder uppercase caption so
      // the boundary between required and optional is easy to read.
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

  // ---- detect our open entry on the manga page ----
  const EXT_OFFSET = 0x80000000;
  const LOCAL_RANGE = 0x10000000000;
  const PREFIX = "ext_custom_source_local-catalog";
  const currentLocalId = ctx.state<number>(0);

  const localIdFromMediaId = (mediaId: number): number => {
    if (mediaId < EXT_OFFSET) return 0;
    let m: $app.AL_BaseManga | undefined;
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

  // ---- command palette ----
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
      filterType: "includes" as const,
      onSelect: () => openForm(en.id),
    }));
    palette.setItems([...base, ...items]);
  };
  ctx.effect(() => refreshPalette(), [entries]);
  palette.onOpen(() => refreshPalette());

  // Keep the read-only "copy" input in sync with the current catalog so the
  // user can copy the serialized JSON into the source's Inline field.
  ctx.effect(() => {
    if (!hasToken()) {
      const updatedAt = $storage.get<number>(K_UPDATED) ?? Date.now();
      fJsonOut.setValue(serializeCatalog(entries.get(), updatedAt));
    }
  }, [entries]);

  // ---- scheduled pull ----
  const autoSync = ($getUserPreference("autoSync") ?? "false") === "true";
  if (autoSync && hasToken()) {
    const mins = Math.max(
      5,
      Number($getUserPreference("syncIntervalMinutes") ?? "30") || 30,
    );
    // cron minute field is 0-59; for >= 60 min use an hour-step expression.
    const expr =
      mins < 60 ? `*/${mins} * * * *` : `0 */${Math.round(mins / 60)} * * *`;
    try {
      ctx.cron.add("lmm-auto-pull", expr, () => {
        if (effectiveGistId()) void pull();
      });
      ctx.cron.start();
    } catch (e) {
      ctx.toast.error(`Auto-sync schedule failed: ${(e as Error).message}`);
    }
  }

  tray.render(() => {
    if (view.get() === "form") return renderForm();
    return renderList();
  });
};
