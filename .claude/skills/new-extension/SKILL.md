---
name: new-extension
description: Scaffold a new seanime extension by hand (code.ts, manifest.json, README, assets/icon.png) under src/<type>/<id>/, wired with the correct manifestURI / payloadURI / icon URLs, then build. Use when the user asks to create / add / scaffold a new seanime extension, custom-source, provider, or plugin.
disable-model-invocation: true
---

# Scaffold a new seanime extension

There is no scaffold command in this repo — extensions are created by hand. This
skill is that procedure. Follow it exactly; the build ([scripts/build.ts]) validates
the manifest and will reject drift between `manifestURI`, `payloadURI`, and the file
layout.

## Inputs to collect

Ask the user for any not already given:

- **type** — one of `custom-source`, `manga-provider`, `anime-torrent-provider`,
  `onlinestream-provider`, `plugin` (the build's `VALID_TYPES`).
- **id** — kebab-case folder name, also the manifest `id` (e.g. `mangaupdates-sync`).
- **name**, **description**, **website**, and whether it's a **plugin** (needs the
  extra permission + userConfig blocks).

Derive the GitHub raw base from the `origin` remote and current default branch:
`https://raw.githubusercontent.com/<owner>/<repo>/<branch>/src/<type>/<id>`.

## Steps

1. **Create the folder** `src/<type>/<id>/` with `assets/`.

2. **Write `manifest.json`.** Required fields (copy the exact URL shape from the
   reference manifests — see [src/custom-source/mangaupdates/manifest.json] and
   [src/plugins/mangaupdates-sync/manifest.json]):
   - `manifestURI` MUST end in `manifest.json` and point at this file's raw URL.
   - `payloadURI` MUST be the sibling `code.js` raw URL (same dir). The build
     derives this and fails if it doesn't match.
   - `icon` → the `assets/icon.png` raw URL. **Must be a raster image (PNG).** The
     seanime frontend silently blocks `.svg` / non-raster icon URLs.
   - `language: "typescript"`, `lang: "en"`, plus `name`, `description`, `author`,
     `website`, `readme`, `version`.
   - **Plugins only**: add the `plugin` block (`permissions.scopes`,
     `permissions.allow.networkAccess.allowedDomains` + `reasoning`) and, if it
     needs settings, a `userConfig` block (`fields` read at runtime via
     `$getUserPreference(name)`).

3. **Write `code.ts`.** No triple-slash references needed (types are globally in
   scope via tsconfig include). Pick the shape by type:
   - **custom-source** — a single `code.ts` exporting the `CustomSource` class.
     Stub the unused half: even with `supportsAnime: false`, all anime methods
     must be defined (return `[]` / `null`). See the stub block in
     [src/custom-source/mangaupdates/code.ts].
   - **plugin** — top-level `init()` that registers hooks / UI. If multiple hook
     callbacks share helpers, create `modules/` (one exported callback per file)
     + `utils/` (shared classes), and use `$shared.define` / `$shared.use`. See
     [src/plugins/local-catalog-manager/] as the reference for the `$shared`
     pattern. **Each `modules/*.ts` may contain the substring `export` only
     once** (the build splits on it).

4. **Write `README.md`** and add a placeholder `assets/icon.png` (a raster PNG;
   if you only have an SVG, convert with Chrome headless
   `--default-background-color=00000000` — qlmanage/cairo produce a white fill on
   this machine).

5. **Build & verify:**
   ```bash
   bun run build       # validates the manifest, emits code.js, regenerates marketplace.json
   bun run typecheck
   bun run check
   ```
   Never hand-edit `marketplace.json` — the build regenerates it.

6. Commit the source **and** the built `code.js`.

## Pitfalls to honor while writing `code.ts`

These are runtime traps the compiler won't catch — the `goja-compat-reviewer`
subagent checks them, but write them right the first time:

- `await` Go-bound calls; never `.then()`/`.catch()` on `ctx.fetch` / `$anilist.*`.
- Coerce with `String()` / `Number()` before `===` against Go-bound fields.
- Helpers used inside a serialized callback must live **inside** that callback's body.
- `res.json()` / `res.text()` are synchronous in goja (the codebase keeps `await`
  on them defensively anyway).
- Every hook callback calls `event.next()` on all paths.
