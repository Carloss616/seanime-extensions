# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A personal collection of [seanime](https://github.com/5rahim/seanime) extensions. Each extension is a TypeScript entry (`code.ts`) plus a `manifest.json`. The build transpiles `code.ts` to a sibling `code.js`; the manifest's `payloadURI` points at the raw GitHub URL of that `code.js`, which is what seanime fetches and runs. Both source and built `code.js` are committed.

Current extensions: two custom-sources (`mangaupdates`, `local-catalog`) and four plugins (`mangaupdates-sync`, `local-catalog-manager`, `library-grid-layout`, `manga-source-updates`). `local-catalog` + `local-catalog-manager` are a pair — the plugin manages a catalog the custom-source serves; `mangaupdates` + `mangaupdates-sync` likewise pair a source with its tracker plugin. `library-grid-layout` is standalone — a UI-only plugin that overrides the cards-per-row of the manga & anime library grids via `ctx.dom` inline styles (no hooks, no network). `manga-source-updates` scans the reading list across every installed manga provider (via `ctx.manga.getChapterContainer`) to surface new chapters per source, and injects UI onto seanime's own pages three ways: a native `ctx.action.newMangaPageButton` on the manga entry (no DOM), a "New on: {source} +N" bar in the chapter-list header, and a `+N · M` badge on library cards (both via `ctx.dom` injection — see "DOM injection onto seanime pages"). Code shared across these lives in the repo-root `src/_utils/` and `src/_components/` (see "Cross-extension shared code").

## Build commands

```bash
bun run build        # build every extension + regen marketplace.json (postbuild runs check:fix, so output is always formatted)
bun run typecheck    # tsc --noEmit over src/+types/ and over scripts/ (two configs)
bun run check        # biome lint + format check (check:fix to autofix)
bun run test         # bun test — unit tests in co-located src/**/*.test.ts
bun run icon         # scripts/svg2png.ts — render an SVG icon to assets/icon.png
bun run dp <id>      # scripts/discord-post.ts — print the Discord submission post for an extension, filled from its manifest.json
```

`<type>` folders are: `custom-source`, `manga-provider`, `anime-torrent-provider`, `onlinestream-provider`, `plugin` (the build's `VALID_TYPES` in [scripts/build.ts](scripts/build.ts) validates each manifest's `type`).

Requirements: [Bun](https://bun.com/) on PATH; `bun install` once (pulls `@types/bun` + biome). No scaffold command — create new extensions by hand (see "Adding an extension").

## Build pipeline (what `scripts/build.ts` actually does)

For each `src/*/*/code.ts`:

1. Loads + validates the sibling `manifest.json`: `type` must be in `VALID_TYPES`, `manifestURI` must end in `manifest.json`, and `payloadURI` must be the derived sibling `code.js` URL (so the two can't drift).
2. Bundles each `modules/*.ts` standalone with `Bun.build` (resolving its `utils/*` imports), then bundles the entry `code.ts` with a plugin that re-emits each imported module as a **self-contained function** (see "Splitting an extension across multiple files").
3. Writes the single-file `code.js` next to `code.ts`.

Then regenerates [marketplace.json](marketplace.json) by projecting `MARKETPLACE_FIELDS` (id, name, description, author, manifestURI, icon, type, language, lang, website) from every manifest, sorted by id. **Never hand-edit `marketplace.json`** — overwritten on the next build.

No bundling-to-string: goja has no module system, so `code.js` IS the payload (fetched lazily via `payloadURI`).

### Build constraint: avoid the `export` substring in source

The `isolate-modules` plugin in [scripts/build.ts](scripts/build.ts) splits each `modules/*.ts` output on the literal string `"export"` expecting exactly TWO parts (body + the single `export { name }`). Any extra occurrence of the substring `export` — inside a string literal, comment, identifier, or template tag — adds a third split and the build fails with `Unexpected number of exports for modules/<file>.ts` at line 0.

Affects only `modules/*.ts` (not the entry `code.ts`, `utils/*`, or non-module files). When writing strings or comments that need a synonym for "export", pick `dump`, `surface`, `save`, `output` — anything that doesn't contain the 6-char sequence `export`. The identifier `expected` is safe (different substring).

## Cross-extension shared code (`src/_utils`, `src/_components`)

Code reused by more than one extension lives at the repo root, outside any `<type>/<id>/` folder, and is imported with relative paths (`../../../_utils/logger`):

- `src/_utils/` — `logger`, `anilist-status`, `custom-source-id` (the mediaId encode/decode helpers, plus `parseCustomSourceManifestId` / `stableCustomSourceKey` — extract a custom-source's manifest id from its wrapped `siteUrl` and build the `manifestId:localId` cross-instance identity), `dom-read` (`domAttr` / `parseDomNumber` — denshi-safe attribute + text reads), `gist/` (`GistClient` — shared GitHub Gist HTTP wrapper, used by both `local-catalog-manager` and `manga-source-updates`; promoted out of `local-catalog-manager` in Phase 2 of `manga-source-updates`'s gist sync — plus `device-flow.ts`'s `DeviceFlowClient` (the GitHub OAuth Device Flow login half — `requestDeviceCode`/`pollAccessToken` + the pure response interpreters; the blocking `$sleep` poll loop stays in the caller) and `constants.ts` holding the shared public `GITHUB_CLIENT_ID` OAuth-App id), plus `mangaupdates/` and `local-catalog/` domain helpers. Each extension's per-extension `utils/*` wrapper (e.g. `mu-client.ts`) now extends a shared base (`_utils/mangaupdates/client.ts`) instead of reimplementing it.
- `src/_components/` — declarative `$ui` builders: `entry-list` (the generic searchable-section "chrome" — cover box, count header, search row, empty states, row container + trailing actions; each row is **opinionated**, declaring what it HAS (`year` / `status` pill / `warn` pill / `chapter` / `openExternal` / `openInPlace`) and the component renders the present pieces dot-separated in a fixed order `{year} · {status} · {warn} · c.{chapter} · Open ↗ · Open →`; used by `mangaupdates-sync` / `local-catalog-manager` / `manga-source-updates`), `divider` (plus `joinDividers`, which interleaves page-level rules between sibling blocks — see the spacing convention), `text` (shared `LABEL_STYLE` / `CAPTION_STYLE` typography tokens for the small uppercase section labels / dim captions), `github-connect` (`githubConnect(tray, opts)` — the whole shared GitHub device-flow connect flow rendered from caller state: `deviceStart` → code prompt, else a header row (`title` uppercase label at flex-1 · `status` · a `⋮` actions dropdown, all right-aligned) with, when disconnected, a Connect button below. When `connected`, Disconnect + any `connectedActions` (menu-item specs `{ label, onClick, disabled? }`, e.g. a "Sync now") collapse into the `⋮` `tray.dropdownMenu` to the right of the status; `disconnectable` gates the Disconnect item — a device-flow token is clearable from the tray, a PAT is managed in config, so PAT-only connections pass `false` and (with no other actions) show no menu at all; the `status` row is derived by the sibling pure helper `connectStatus({ connected, syncing?, lastSyncedAt?, via? })` into a **badge + "· via {via}" suffix** — `Not connected` (gray badge), `Syncing…` (plain text, no badge), `Connected` / `Synced` (success badge) — aligned with entry-list's `SEG_BOX` fixed-height-inline-flex trick so text centers on the badge. One place owns the styling so every plugin's "Connect GitHub" is identical; used by `manga-source-updates` / `local-catalog-manager`, pairs with `_utils/gist/device-flow`), `tray-header` (a list-item modal header — left icon, title, subtitle, right-aligned nodes; `title`/`iconUrl` default to the owning extension's manifest `name`/`icon` via the `__MANIFEST_NAME__` / `__MANIFEST_ICON__` bundle-time literals — siblings of `__MANIFEST_ID__`, all injected by `scripts/build.ts`'s `define` and declared in [types/augment.d.ts](types/augment.d.ts)). The header draws **no border of its own** — the caller emits a `divider(tray)` right after it (via `joinDividers`), so the page gap spaces the rule. (No `pill`/`alert-box` — use the native `tray.badge` / `tray.alert`. `tray.alert` only takes `title`/`description`/`intent` strings, so banners that need action buttons render the buttons as sibling rows below the alert, not inside it — via `alert-actions` (`alertActions(tray, rows)`), a bordered notch-box with an upward triangle pointing back at the alert above, so every "alert + actions" pair reads identically; used by `local-catalog-manager`'s drift banners + gist delete-confirm.) `dom-decorator` (`createDomDecorator(ctx)`) is a non-`$ui` helper — the reusable harness for injecting UI onto seanime's OWN pages via `ctx.dom` (used by `manga-source-updates`); see "DOM injection onto seanime pages".

**Tray spacing convention:** vertical rhythm comes from the container `tray.stack` / `tray.flex` **`gap`** on a 4px grid, three tiers — `gap: 1` (4px) micro-pairs (title↔subtitle, value↔label), `gap: 2` (8px) inside a section, `gap: 3` (12px) at the page level (between sections) and for the `tray-header`'s own icon↔text row. **12px is also seanime's own tray frame** — the modal content sits inside a `p-3` (12px) scroll wrapper we don't control, so a uniform 12px page rhythm makes the whole tray cohere with that inset. Do NOT add `marginTop`/`marginBottom` to create spacing between siblings (that produced inconsistent 6/10/14px totals); `padding` is for box insets only, also snapped to 4/8/12. Each **section is a self-contained stack** (its own `gap: 2`), so it can be composed at any page-level gap without the outer gap leaking into its rows — `entryList` / `renderProgressSection` each return ONE stack node (don't spread it). **Dividers are page-stack siblings, never baked into a section or the header**: a render lists its blocks (`[trayHeader(tray), ...sections]`) and wraps them in `joinDividers(tray, blocks)`, which drops a bare 1px `divider` between each present block (skipping `null`/`undefined`), so the page gap spaces every rule equally on both sides. Use the shared `LABEL_STYLE` / `CAPTION_STYLE` (`_components/text`) for small uppercase section labels / dim captions instead of ad-hoc font sizes. Tight pairs that must stay close inside the 12px page stack (an alert + its action box, a heading + its rows) get wrapped in their own `gap: 2` stack.

**Button loading state:** use the native `tray.button` **`loading: <busy>`** prop (it shows a spinner and disables the button — do NOT also set `disabled`, and never hand-roll a `⏳` emoji label). Set `loading` on EVERY button that kicks off async work, and swap the LABEL for its progress state by the button's shape:

- **Text (or icon+text) button** → swap to the progress verb **without the icon prefix**: `busy ? "Reloading…" : "↻ Reload"`, `o.connecting ? "Connecting…" : "Connect GitHub"`, `busy ? "Merging…" : "🔀 Merge"`, `busy ? "Applying…" : "📤 Apply"`, `busy ? "Opening…" : "Open →"`.
- **Icon-only button** (`📤`, `⛔`, …) → swap to just an ellipsis `"…"` (the verb would widen a compact icon button): `busy ? "…" : "📤"`.

The verb (`Reloading…` / `Applying…` / `Merging…` / `Creating…` / `Linking…` / `Deleting…` / `Opening…` / `Connecting…`) drops the icon so the loading label reads as pure status; the spinner comes from `loading`, not the text. Reference: `local-catalog-manager`'s `register.ts` buttons and `_components/github-connect.ts`'s Connect button.

**`tray.dropdownMenuItem` needs a NODE, not a string:** its `item` arg must be a tray component (`tray.dropdownMenuItem(tray.text("Disconnect"), { onClick })`), not a raw string (`tray.dropdownMenuItem("Disconnect", …)` renders blank/breaks). Same for `tray.dropdownMenu`'s `trigger` — pass a built node (e.g. `tray.button("⋮", …)`). See the `⋮` actions menu in `_components/github-connect.ts`.

No build changes were needed: `Bun.build` follows the import graph regardless of file location, so these inline into each `modules/*.ts` / `utils/*` exactly like a sibling `utils/` import (and thus survive the per-callback `.toString()` serialization). The `src/*/*/code.ts` build glob never matches them (wrong depth / filename), so they are not treated as extensions.

## Testing

Unit tests are `*.test.ts` co-located next to source (`bun test`, runner is `bun:test`). Tests cover the shared `_utils`/`_components` and per-extension `utils/`. They are excluded from the build glob (filename ≠ `code.ts`) but ARE type-checked (`tsconfig.json` includes `src/**/*.ts`). Run `bun run test` before committing logic changes to shared code, since one base is inlined into several extensions.

## Splitting an extension across multiple files

Goja has no module loader (`import`/`export` is forbidden at runtime), AND the relevant top-level callbacks — `$app.on*` hooks and the `$ui.register` callback — do NOT see module scope at runtime. seanime serializes each callback via `.toString()` and re-evals it in a **fresh isolated runtime**; the docs are explicit that a callback reading a module-scope or `init()`-scope variable gets `undefined`. So any helper a callback needs must end up *physically inside the serialized function's own body*.

The convention that keeps this DRY:

- Put each isolated callback in its own file under `modules/`, exporting exactly one function (`export const onPostUpdateEntry = (event) => { ... }`).
- Put shared helpers (classes/functions) under `utils/` and `import` them normally into the module files.
- `code.ts` imports each module and registers it: `$app.onPostUpdateEntryProgress(onPostUpdateEntry)`.

[scripts/build.ts](scripts/build.ts) bundles each `modules/*.ts` standalone (inlining its `utils/*` imports via `Bun.build`), then bundles `code.ts` with an `onLoad` plugin that re-emits each imported module as a **self-contained function**:

```js
// NOT an IIFE-closure — the helper would live in the closure, unreachable
// from inside the serialized callback (`fn.toString()` excludes it).
export const onPostUpdateEntry = (...args) => {
  class MUClient { /* ...inlined from utils/... */ }
  const onPostUpdateEntry = (event) => { /* ...uses MUClient... */ };
  return onPostUpdateEntry(...args);
};
```

Because the class is declared **inside** the registered function's body, `onPostUpdateEntry.toString()` carries it across the runtime boundary. An IIFE wrapper (`(() => { class MUClient{}; return fn })()`) would put the class in the closure and fail at runtime with `ReferenceError: MUClient is not defined` — the bug this wrapper exists to avoid. See the wrapper comment in [scripts/build.ts](scripts/build.ts).

A custom-source's methods are *not* serialized per-callback (the class instance lives in one runtime), so a custom-source can be a single `code.ts` with no `modules/` — see [src/custom-source/mangaupdates/code.ts](src/custom-source/mangaupdates/code.ts).

### Class-field gotcha inside helper classes

TypeScript class field declarations (`private x: T`) and parameter properties (`constructor(private x: T) {}`) can compile to `__publicField(this, ...)` calls under some transpiler targets — a helper that lives at bundle module scope, unreachable from inside an isolated callback body (`ReferenceError: __publicField is not defined`). `Bun.build`'s current target emits native class fields, so this is largely historical, but as a defensive measure declare fields with the `declare` modifier (TS-only, no runtime emit) and assign them in the constructor:

```ts
class MyHelper {
    private declare foo: string                // ← `declare` keeps emit clean
    constructor(foo: string) {
        this.foo = foo                         // assign in constructor body
    }
}
```

See [utils/mu-client.ts](src/plugins/mangaupdates-sync/utils/mu-client.ts) for the working pattern.

### Reference plugin

The `mangaupdates-sync` plugin uses this pattern: [utils/mu-client.ts](src/plugins/mangaupdates-sync/utils/mu-client.ts) defines `MUClient` once; the callback modules ([modules/on-post-update-entry.ts](src/plugins/mangaupdates-sync/modules/on-post-update-entry.ts), [modules/register.ts](src/plugins/mangaupdates-sync/modules/register.ts)) import it, and the build inlines it into each one.

## Per-extension `utils/` layout

Keep `modules/*.ts` focused on wiring (`ctx`, `ctx.state`, tray/DOM registration). Move **pure domain logic** into co-located `utils/` files, grouped by concern — one file per domain, not one mega `helpers.ts`.

**Extract to `utils/` when the function:**
- Has no `ctx`, no `tray`, no `.get()` on plugin state
- Is testable without mocking the UI runtime (add a co-located `*.test.ts`)
- Could be reused by another module in the same extension

**Keep in `modules/` when the function:**
- Reads/writes `ctx.state`, calls `ctx.manga.*`, renders tray nodes, or registers observers
- Needs a closure over live scan/UI state (`scanning`, `results`, `cancelRequested`, …)

**Suggested file names** (reference: [manga-source-updates/utils/](src/plugins/manga-source-updates/utils/)):

| File | Typical contents |
|------|------------------|
| `types.ts` | Interfaces / type aliases for the extension's domain |
| `constants.ts` | `$storage` keys, lookup tables, labels. **Convention:** the `K_*` identifiers keep the prefix, but the string VALUES are plain camelCase with NO plugin-id prefix (`"gistId"`, `"oauthToken"`) — `$storage` is per-extension namespaced so a prefix is redundant (see `manga-source-updates` / `local-catalog-manager`). |
| `migrate.ts` | One-shot `$storage` key migration (`migrateStorageKeys()`) — copy legacy key names forward to current ones and drop the old. Called at the top of the **register callback** (which has `$storage` and runs at plugin load) — NOT `init()`, whose loader VM has no `$storage`. `local-catalog-manager` uses this to carry its v2.2 `lcm_`-prefixed keys to the v2.3 camelCase convention. |
| `store.ts` | Typed `$storage` accessors over the extension's keys — raw read + tombstone-aware "live" views + timestamp-merge helpers (see `manga-source-updates` for per-record `updatedAt`/`deletedAt`) |
| `classify.ts`, `chapters.ts`, … | Pure transforms for one subdomain |
| `titles.ts`, `hydrate.ts`, … | Small focused helpers |
| `*-client.ts` | API / network wrapper class |

Cross-extension helpers belong in `src/_utils/` or `src/_components/`, not duplicated per plugin.

**Constant naming (follow this when adding any `$storage` / `$store` key or other constant):** the `K_*` / `STORE_*` **identifiers** keep their prefix, but the string **VALUES** are plain camelCase with **NO plugin-id prefix** — `export const K_GIST_ID = "gistId"`, not `"lcm_gist_id"`. Both `$storage` and `$store` are per-extension namespaced, so a prefix is redundant. Reference: `manga-source-updates` / `local-catalog-manager` `utils/constants.ts`. When you rename an existing **persisted** (`$storage`) key value, add a one-shot `utils/migrate.ts` so upgrades don't orphan data (`$store` is ephemeral — rename freely, no migration).

**Do NOT** split into extra `modules/*.ts` files just to shorten a register callback unless the callback must be an isolated serialized hook — file moves within the same `$ui.register` runtime are purely organizational; prefer `utils/` first.

**On every change to an extension, re-check this split before finishing.** A register module grows fast (`local-catalog-manager`'s [register.ts](src/plugins/local-catalog-manager/modules/register.ts) is the largest in the repo at ~2800 lines, `manga-source-updates`' [register.ts](src/plugins/manga-source-updates/modules/register.ts) next at ~1900 — both overdue for extraction), so whenever you add or edit logic, ask "is the pure part of what I just wrote extractable?" — if a new function has no `ctx`/`tray`/state, lift it to a co-located `utils/*.ts` with a `*.test.ts` rather than growing the module. The goal is a register that reads as **wiring** (state, tray render, event handlers, DOM/observer registration) delegating to named `utils/` for the actual transforms — not a 1000-line file where behavior is buried in inline closures. When a `utils/` file itself gets crowded, split it by concern (one domain per file), don't append. Keep it legible for the next session.

## Adding an extension

Create `src/<type>/<id>/` by hand:

- `code.ts` — the entry (triple-slash-reference the `types/*.d.ts` you need; register hooks/UI here).
- `manifest.json` — set `id`, `type`, `manifestURI` (ending in `manifest.json`), `payloadURI` (the sibling `code.js` URL), `icon` (point at `assets/icon.png`), and the standard metadata.
- `assets/icon.png`, `README.md`.
- `modules/` + `utils/` only if the extension has isolated callbacks needing shared helpers.

Then `bun run build` and commit the source + `code.js`. The build accepts any `src/*/*/code.ts` regardless of the `<type>` folder name.

### Docs to keep in sync (NOT generated)

Unlike `marketplace.json` (regenerated by the build), these are hand-maintained — update them whenever you add or change an extension, or they drift:

- **`README.md`** (root + per-extension) follow the [readme-guidelines](https://github.com/maximosovsky/readme-guidelines) template: centered header (the extension's `assets/icon.png` as logo) + shields.io `for-the-badge` badges (type · version · TypeScript) + bold tagline + inline nav, then `---`-separated sections (💡 Concept → ✨ Features → 🚀 Quick Start → … → 📄 License). No `©` symbol; per-extension License footer links back to the root. Keep the badge **version** in step with the manifest, and config tables in step with `userConfig.fields`.
- **`llms.txt`** (~15-line card) and **`llms-full.txt`** (full reference of every extension + architecture) at the repo root — add a new extension's entry to `llms-full.txt` and bump the count/summary in both.

## Runtime environment for extension code

Extensions run inside seanime under **goja** (Go's JS engine, no Node, no browser). The only globals available are the ones declared in [types/core.d.ts](types/core.d.ts) and the per-type `.d.ts` files. Notably:

- `fetch(url, options)` returns a `FetchResponse` whose `text()` / `json()` are **synchronous methods** (not Promises) — even though the outer `fetch` returns a Promise. See how [src/custom-source/mangaupdates/code.ts](src/custom-source/mangaupdates/code.ts) calls `res.json()` without `await`.
- `$sleep`, `$clone`, `$replace`, `$toString`, `$getUserPreference` are runtime helpers (not Node/browser builtins). **`$sleep(0)` is the only yield primitive** — there is no `setTimeout`, `setInterval`, or `requestAnimationFrame`. Use `$sleep(0)` mid-loop to keep the runtime responsive during long sync sequences (e.g., the 1023-call extId probe in [src/plugins/local-catalog-manager/modules/register.ts](src/plugins/local-catalog-manager/modules/register.ts)).
- Plugins additionally get `$app` (lifecycle hooks), `$anilist` (in-process AniList lookups), `$storage` (per-extension persistence) — declared in [types/plugin.d.ts](types/plugin.d.ts).
- `$scannerUtils` exposes seanime's own scanner title matcher — `compareTitles(a, b)` returns a 0–1 ratio, `normalizeTitle` / `findBestMatch` / `buildSmartSearchTitles` handle macrons, season/part extraction, etc. Prefer it over hand-rolled Levenshtein/Dice when verifying a fuzzy title match (see [src/plugins/mangaupdates-sync/utils/match.ts](src/plugins/mangaupdates-sync/utils/match.ts), which uses it to gate the auto-match fallback so a bad top-hit can't be cached as a link).
- `tsconfig.json` targets ES2018 for IDE/typecheck strictness, but `Bun.build` does not down-convert syntax — modern output (native class fields, optional chaining, etc.) passes through. Recent goja accepts it; if a feature ever trips goja, avoid it in source.

### Goja Promise interop: `await` only, no `.then()` on Go-bound APIs

Go-bound APIs (`ctx.manga.getCollection`, `ctx.fetch`, etc.) return values that work with `await` but do NOT expose `.then()` / `.catch()` chains. Calling `.then` throws `TypeError: Object has no member 'then'` at runtime — the value is awaitable but not a real JS Promise object.

```ts
// ✗ Crashes the plugin at runtime
ctx.manga.getCollection().then(c => ...).catch(e => ...)

// ✓ Wrap fire-and-forget work in an async IIFE
void (async () => {
  try {
    const collection = await ctx.manga.getCollection()
    // ...
  } catch (e) {
    console.warn("...", e)
  }
})()
```

`async function` results in your own code (e.g., helpers from `$shared.use`) **do** expose `.then` / `.catch` correctly — async functions always return real Promises regardless of body. The quirk only affects Go-bound returns. When in doubt, use `await`.

### Goja value comparison: coerce before `===` against Go-bound fields

Strings (and numbers) returned from Go-bound objects (`e.listData.status`, `e.media.id`, `m.siteUrl`, anything reached through a `ctx.manga.getCollection()` / `$anilist.getManga()` result) are NOT `===` to JS string/number primitives — even when both serialize to the same JSON value. Comparing a goja-wrapped Go string against a JS string with strict equality always returns `false`:

```ts
// e.listData.status = "CURRENT" (Go-wrapped), local.status = "CURRENT" (JS string)
local.status !== seanimeData.status   // → true (false-positive drift)
JSON.stringify(seanimeData.status)    // → '"CURRENT"' (looks identical)
String(seanimeData.status) === local.status  // → true
```

Caught in the wild in `local-catalog-manager`'s drift detector: status comparison reported drift on every row even when both sides held `"CURRENT"`, because the seanime side was a Go-wrapped string. Fix is explicit coercion when comparing across the boundary:

```ts
const stringDiff = (local: string | undefined, remote: string | undefined) => {
    if (local === undefined) return false
    return String(local) !== String(remote ?? "")
}
const numericDiff = (local: number | undefined, remote: number | undefined) => {
    if (local === undefined) return false
    return Number(local) !== Number(remote ?? 0)
}
```

Anywhere you compare a field that crosses the goja ↔ Go boundary (collection lookups, hook event payloads, AniList API responses), wrap each side in `String()` / `Number()` before `===`/`!==`. The serialization is a one-way trip — `JSON.stringify` unwraps the Go value transparently, but `===` does not.

TypeScript picks up `types/**/*.d.ts` via `tsconfig.json`'s `include`, so the goja globals (`$app`, `$anilist`, `$storage`, `CustomSource`, `CatalogEntry`, …) are in scope in every source file automatically — no triple-slash `/// <reference path="…" />` needed.

There is no module system at runtime — `code.js` is one bundled payload executed in the goja sandbox. Source-level `import`s ARE fine: the build inlines them at bundle time (per-module for isolated callbacks, see "Splitting an extension across multiple files"); the file goja runs has no imports left.

### `$storage` round-trips `undefined` to `null`

`$storage.set(key, value)` serializes `value` through the Go bridge, and JS `undefined` object fields come back as JSON `null` on the next `$storage.get`. So an object you store with optional fields left `undefined` rehydrates with those fields set to explicit `null`. This bites anything that later re-serializes the rehydrated value: `JSON.stringify` **omits `undefined` but keeps `null`**, so blank fields silently leak into the output the second time around (caught in `local-catalog-manager`: form-blank `AL_BaseManga` fields like `coverImage`/`bannerImage` reappeared as `null` in the pushed gist after a reload). Defend at the serialize boundary — drop nullish values when writing out (see `canonicalizeKeys` in [src/_utils/local-catalog/catalog.ts](src/_utils/local-catalog/catalog.ts)). AL fields are all optional and never legitimately `null`, so stripping is safe.

### `tray.render` only reacts to `ctx.state`, not `$storage`

A `tray.render` callback re-runs when a `ctx.state` it read changes — **reading `$storage` directly is NOT reactive**. So an event handler that mutates `$storage` and nothing else leaves the tray showing stale content until it's closed and reopened (caught in the wild: `local-catalog-manager`'s Disconnect only did `$storage.set(K_OAUTH_TOKEN, "")` → no re-render). Fix: keep a `ctx.state` mirror of any `$storage`-backed value the render depends on, seed it from `$storage` once, and write BOTH on mutation — `$storage` stays authoritative for the hooks (separate runtimes), the state drives the re-render (see the `oauthTok` mirror in `local-catalog-manager` / `manga-source-updates` `register.ts`). Same trap for connect flows that only appear to work: they re-render incidentally because a sibling state (`deviceStart`/`connecting`) also changed. A `state.set(sameValue)` may no-op, so don't rely on setting a value the state might already hold.

## DOM injection onto seanime pages

Plugins can add UI to seanime's own pages two ways. **Prefer the native action API** over DOM injection whenever one fits (ponytail rung 3): `ctx.action.newMangaPageButton` / `newAnimePageButton` / `newMediaCardContextMenuItem` etc. give a real button/menu slot with `mount`/`unmount`/`setLabel`/`setIntent`/`setTooltipText`/`onClick(e => e.media)` — no selectors, no idempotency dance, no version fragility. `manga-source-updates`'s entry-page button and `mangaupdates-sync`'s "MU 🔍" button both use this. (mangaupdates-sync ALSO DOM-injects, but only for the decorative external-link `<a>`, which has no native equivalent.)

When there's no native slot (a badge overlay on a card, a bar in the chapter-list header), inject via `ctx.dom`. **Do NOT hand-roll the mechanics — use `createDomDecorator(ctx)` from [src/_components/dom-decorator.ts](src/_components/dom-decorator.ts)**, which packages every trap below (signature loop/duplicate guard, per-target in-flight lock, `query()[0]`/`append` over the denshi-broken `queryOne`/`appendChild`, restartable observers + explicit passes + re-arm lifecycle). A decoration just declares `observe(selector, cb)` / `pass(fn)` and calls `decorate(el, { marker, lockKey, sig, render })`; call `arm()` from your own `ctx.screen.onNavigate` and `start()` once. `manga-source-updates/modules/register.ts` is the reference consumer. The bullets below are WHY it exists (and what to reproduce if you ever can't use it). Confirmed patterns cross-checked against seanime's vanilla source — the `.tmp/*.html` dumps some devs paste are from FORKS and can differ, e.g. `data-chapter-list-unread-by-source` is fork-only:

- **Observe with `{ withInnerHTML: true }`** so the callback can read `el.innerHTML` synchronously (`String(el.innerHTML ?? "")` — the goja empty-string trap applies). `observe` for a stable container. (`observeInView` exists for viewport-gated work, but for seanime's lazy grids plain `observe` is what works — the grid already culls off-screen cards from the DOM, and `observeInView` missed the initial above-the-fold cards.)
- **Count-based signature guard against the mutation loop** (the #1 footgun — injecting a child re-fires the observer): stamp each injected node with a `data-*-sig` attribute encoding its desired content; on each pass, the ONLY acceptable state is exactly one node whose sig matches — then no-op. Anything else (none, wrong sig, or **duplicates from a concurrent render race**) → remove them ALL and rebuild. Do NOT use an `innerHTML.includes(sig)` guard: a duplicate from a race keeps matching and sticks forever, which also blocks later updates (seen in the wild — the bar duplicated and stopped refreshing until the tray forced a pass). For "nothing to show", inject a `display:none` signed marker so unchanged elements aren't re-processed. (Pattern adapted from Bas1874's Marketplace-Plus.js `data-for` approach.)
- **Serialize concurrent decoration or you get duplicates.** Multiple triggers (the grid observer, the per-card observer, the `ctx.effect`, the explicit query pass) call the same decorate fn for the same node in one tick; each passes the "no node yet" check and injects → duplicate badges even WITH the sig guard (they only self-heal on a later single pass). Guard it: a re-entrancy flag + "dirty" re-run for a **singleton** node (the chapter-list bar), or a `Set<mediaId>` of in-flight ids for **many** nodes (the card badges) so only one decoration per id runs at a time.
- **`el.queryOne` / `el.appendChild` reject silently in denshi** (the desktop runtime) — the async call never resolves/rejects visibly, so the decorate fn dies right after with no error. Use `el.query(sel)` and take `[0]`, and `el.append(child)` (the pattern that works for the chapter-list bar), NOT `queryOne`/`appendChild`. Same rule for top-level `ctx.dom.query` passes — never `ctx.dom.queryOne`. Wrap the inject block in try/catch so a failure logs instead of vanishing.
- **Denshi DOM reads: sync snapshot first, async fallback — never only one.** On observe/query snapshots, `el.attributes?.[key]` is often populated (fast path) but sometimes empty even when the attribute exists on the live node; `await el.getAttribute(key)` can still return it. Use **both** via [`domAttr`](src/_utils/dom-read.ts) — sync first, async if sync misses. Likewise for text nodes: `el.textContent` is frequently empty on progress badges while `await el.getText()` returns the number — use [`parseDomNumber`](src/_utils/dom-read.ts) (`textContent` → `getText`). `dom-decorator` reads decoration signatures through `domAttr` for the same reason. Reliability is **per element**: e.g. `data-media` on `[data-manga-entry-page]` tends to populate all paths; `data-selected-provider` on the chapter-list container may be empty in `el.attributes` until `getAttribute` runs; `data-list-data` on virtualized library cards may be absent on the wrong node entirely. If **both** paths return empty, the attribute is genuinely absent on that element — not fixable by picking sync vs async alone. For **entry identity** (`mediaId`), prefer `ctx.screen.onNavigate` + `searchParams.id` over parsing DOM (`mangaupdates-sync` icon injection, `manga-source-updates` `currentMediaId`).
- **`data-selected-provider` may arrive JSON-quoted** (e.g. `"\"asurascans\""` in `el.attributes`). Compare with `selectedPid?.includes(pid)`, not `=== pid`.
- **In-place progress reactivity:** when a badge observer fires, `await applyProgressFromDom(badgeEl)` **before** `redecorateBar()` — otherwise the bar reads stale progress. A nav-scoped progress cache (`createHeaderProgressReader`) is fine for `decorateBar` passes with no badge node, but **do not** return cached progress when a specific `badgeEl` was provided and its parse failed (that would freeze the old number).
- **Yield on large explicit decorate passes:** `$sleep(0)` every N cards in library `redecorateCards` keeps the goja runtime responsive during bulk query→decorate.
- **`isolate` / own stacking context traps an injected overlay.** seanime's `data-media-entry-card-body` has `isolation: isolate`, so a badge appended INTO it is stuck below the card's hover-popup (`z-15`) no matter how high its own z-index. Inject into the card **container** (`data-media-entry-card-container`, `position: relative`) as a sibling of the popup with `z-16` instead; add `pointer-events: none` so it doesn't eat the card's hover/click.
- **No-gap reactivity + don't trust `observe` alone:** derive live values (read progress) from the DOM being observed (`data-list-data` on a card, `[data-media-page-header-progress-badge-progress]` text on the entry), NOT from `ctx.manga.getCollection()`. But `ctx.dom.observe` is unreliable on its own — it misses elements already mounted before it ran (library cards got no badge) and some in-place mutations. Belt-and-suspenders: observe the **stable grid container** (bulk add/remove) AND the **individual cards** (a virtualized grid reuses a card element for different media as you scroll, mutating it in place with no add/remove — only a per-card observer catches that), PLUS an explicit `ctx.dom.query` decorate pass. When a change is state-only (a read updates the entry's progress text but not the plugin's `ctx.state`), push the fresh DOM value INTO state (`syncRow(...)`) so native-action buttons and the tray detail — which render from state, not the DOM — react too; the `ctx.effect` then redecorates.
- **Re-arm observers on EVERY nav, not just reload.** A client reload resets the frontend element-id counter (invalidating held handles) and `ctx.dom.onMainTabReady` fires — but SPA navigation does NOT fire `onMainTabReady`, so also re-arm from `ctx.screen.onNavigate` (and `ctx.dom.onReady`). "Re-arm" = stop the old observers, re-`observe`, run the explicit query pass. seanime tears down the plugin's DOM context per navigation (`DOMManager Cleaning up / initialized` in the client console), so held observers/handles from a previous screen are dead. Note: the DOM context runs whether or not the tray is open — injection is NOT gated on the tray.
- DOM injection needs **no** extra permission (`dom-script-manipulation` is only for injecting `<script>`/JS); `createElement`/`setInnerHTML`/`after`/`append` work as-is.
- Injected click handlers run in the single `$ui.register` runtime (like `ctx.dom.observe` callbacks), so they close over register-scope state/helpers fine — but `await` Go-bound calls (`refreshChapters`), never `.then()`. To force a client refetch after a mutation, `$app.invalidateClientQuery([...])` with the real keys from seanime's `internal/events/endpoints.go` (e.g. `MANGA-get-manga-entry-chapters`). Note `ctx.manga.refreshChapters()` refetches a source's chapters into cache but does NOT change the reader's Source dropdown (that's frontend state a plugin can't set) — don't claim "switched source".
- **Hooking seanime's OWN buttons/modals/menus (not injecting new UI).** To make a native control also trigger plugin logic, attach a listener rather than decorate. seanime's confirm modals (`[role="dialog"]`) and dropdown menus (`[role="menu"]`) are **radix portals at the document root** — they don't live under any page container, so observe them with their OWN root-level `dm.observe("[role='dialog']" / "[role='menu']", …)` (not scoped to a page node), and they re-mount on every open. The controls carry no `data-*` of their own, so: **gate by visible text** — the modal's `.UI-Modal__title` (lowercased) or the menu's `[role='menuitem']` `getText()` — to pick the specific one and skip siblings/other dialogs; and guard against double-attach with an attribute stamp on the element (`data-msu-reload-hooked` etc.), NOT handle bookkeeping — a re-mounted element loses the attr and is re-hooked, a reused one keeps attr + listener. A button that opens seanime's own confirm modal (entry-page "Reload sources") should be hooked at the modal's confirm button (fires on confirmation); one that fires immediately (library "Refresh sources") should open the plugin's own confirm instead. `manga-source-updates`'s `hookReloadModal` / `hookRefreshMenu` are the reference. For a plugin's OWN confirm dialog, prefer a state-driven view-swap in `tray.render` over a controlled `tray.modal` (the native controlled-open modal didn't reliably close).

## Type definitions are intentionally partial

[types/](types/) only contains the surface this repo actually touches. The full type surface lives in `internal/extension_repo/goja_plugin_types/` in the seanime source tree. **When adding a new extension type or hook**, copy the relevant `.d.ts` snippets from seanime into `types/` — they are type-only, the goja runtime already exposes the bindings.

- [types/core.d.ts](types/core.d.ts) — runtime globals (always referenced).
- [types/custom-source.d.ts](types/custom-source.d.ts) — `CustomSource` abstract class + AniList (`AL_*`) shapes.
- [types/plugin.d.ts](types/plugin.d.ts) — `$app` / `$anilist` / `$storage` namespaces. Subset of seanime's full plugin runtime.
- [types/mu-api.d.ts](types/mu-api.d.ts) — MangaUpdates v1 API response shapes shared by the custom-source and the tracker plugin.
- [types/svg.d.ts](types/svg.d.ts) / [types/html.d.ts](types/html.d.ts) — declare `*.svg` / `*.html` imports as `string`. `scripts/build.ts` sets `loader: { ".svg": "text", ".html": "text" }` in both bundle passes, so the import inlines the raw file contents as a string literal (no asset emitted) — used to keep icon markup / webview HTML in a separate file that still survives goja's per-callback `.toString()`. The inlined text must obey the `modules/*.ts` no-`export`-substring rule.

## CustomSource implementations: stub the unused half

The `CustomSource` abstract class declares both anime and manga methods. Even when `getSettings()` returns `supportsAnime: false`, all anime methods must still be defined to satisfy the TypeScript shape — they just return `[]` / `null`. See the stub block in [src/custom-source/mangaupdates/code.ts](src/custom-source/mangaupdates/code.ts) for the pattern.

## Plugin lifecycle

Plugin extensions use a top-level `init()` function (declared in [types/plugin.d.ts](types/plugin.d.ts)) as the entry point. Inside `init()`, register hooks via `$app.onPreUpdateEntryProgress` / `$app.onPostUpdateEntryProgress` / etc. State that must outlive `init()` goes in closures or `$storage`.

Convention used by `mangaupdates-sync`: capture the payload in the **pre**-hook into `$store` (the cross-runtime in-memory channel — hook runtimes can't share closures), then consume it in the **post**-hook. The post-hook only fires when the underlying AniList update succeeds, so this keeps the external service (MU) and AniList in lock-step without a transaction. The hooks live in [modules/](src/plugins/mangaupdates-sync/modules/) and are wired up in [code.ts](src/plugins/mangaupdates-sync/code.ts) `init()`.

Every hook callback must call `event.next()` — even on error paths.

### Sharing helpers across hook runtimes — `$shared`

When multiple hook callbacks need the same helper (class, function), use `$shared.define(name, factory)` in `init()` and `$shared.use<T>(name)` in each callback. The factory must be SELF-CONTAINED (helpers declared inside its body), exactly like an isolated callback module — seanime serializes `factory.toString()` and re-evals it in each runtime that calls `use()`. A factory that closes over module-scope identifiers will fail with `ReferenceError` at runtime in the consumer.

Convention in this repo: put the factory under [modules/shared-lib.ts](src/plugins/local-catalog-manager/modules/shared-lib.ts). The existing build self-containerization (which already inlines imports into the body of every `modules/*.ts` export) handles inlining the factory's imports automatically — no build changes needed.

**Reference plugin:** see [src/plugins/local-catalog-manager/](src/plugins/local-catalog-manager/) — `code.ts:init()` calls `$shared.define("local-catalog", sharedLib)` BEFORE registering any hooks / UI; every hook + the UI register module destructures its helpers via `$shared.use<ReturnType<typeof sharedLib>>("local-catalog")`.

**Bundle-size win:** without `$shared`, each callback module that uses `GistClient` would inline the class (~80 lines) into its own wrapper — 5 callbacks × 80 lines = 400 duplicated lines. With `$shared`, the class lives ONCE in the shared-lib wrapper.

**Runtime caveat:** `$shared.use()` re-evaluates the factory in each runtime, so the result is RUNTIME-LOCAL. The factory must be pure code (classes + functions). Live state belongs in `$store` or `$storage`.

## Plugin manifest extras

Plugin manifests have two blocks beyond the standard fields ([example](src/plugins/mangaupdates-sync/manifest.json)):

- `plugin.permissions.scopes` — needed capabilities (`storage`, `anilist`, …).
- `plugin.permissions.allow.networkAccess.allowedDomains` — host allow-list; `fetch` to anything not listed is blocked.
- `userConfig.fields` — declarative form schema; values are read at runtime via `$getUserPreference(name)`.

## SPIKE markers

Code and READMEs use `SPIKE:` comments to flag values inferred from community wrappers / reverse-engineering that need confirmation against real APIs (most relevant for `mangaupdates-sync` — MangaUpdates v1 has no public OpenAPI spec). When verifying these, update the comment **and** the corresponding entry in the extension's README "SPIKE" section.

## Custom-source mediaId encoding

When a plugin or other extension receives a `mediaId` from a hook event, it might be an AniList id **or** a synthetic id seanime assigned to a custom-source entry. They are easy to distinguish and, for custom-source entries, the underlying provider-local id can be recovered without any network calls.

### Encoding (from seanime's `internal/customsource/customsource.go`)

```
mediaId = ExtensionIdOffset + (extensionIdentifier << LocalIdBitShift) + localId

ExtensionIdOffset      = 1 << 31      // 2,147,483,648
LocalIdBitShift        = 40
MaxLocalId             = (1 << 40) - 1
MaxExtensionIdentifier = 0x3FF        // 1023
```

`localId` is whatever the custom-source put in `id` for that entry. The `mangaupdates` custom-source in this repo sets `id: record.series_id`, so its `localId === MU series_id` (numeric).

`extensionIdentifier` is assigned to each loaded custom-source at runtime by seanime — it is **not stable across installations** and not exposed to extensions. Treat it as opaque.

### Detecting a custom-source id

```ts
const EXT_ID_OFFSET = 0x80000000   // 1 << 31
mediaId >= EXT_ID_OFFSET           // true → custom-source, false → AniList
```

### Decoding (JS-safe)

JS bitwise operators are int32, so use arithmetic:

```ts
const EXT_ID_OFFSET   = 0x80000000      // 2^31
const LOCAL_ID_RANGE  = 0x10000000000   // 2^40

function decodeLocalId(mediaId: number): number {
    const offset = mediaId - EXT_ID_OFFSET
    return offset % LOCAL_ID_RANGE
}
```

Max representable `mediaId` is ≈1.12 × 10^15, safely under `Number.MAX_SAFE_INTEGER` (≈9 × 10^15) — no `BigInt` needed.

### Confirming the entry belongs to a known extension

Decoding gives you `localId` but doesn't tell you **which** custom-source produced it. The plugin runtime exposes `$anilist.getManga(mediaId)`, which returns the manga (works for custom-source ids too) with a `siteUrl` field. For custom-source entries seanime wraps the URL as:

```
ext_custom_source_<extId>|END|<original-url>
```

Match the prefix to identify the source. Example for the `mangaupdates` custom-source: `ext_custom_source_mangaupdates|END|https://www.mangaupdates.com/series/<base36-slug>/<title-slug>`.

### Worked example

`The Beginning After the End` showed up in seanime as `mediaId = 609192324283839`:

```
offset       = 609192324283839 - 2,147,483,648 = 609,190,176,800,191
extensionId  = 609,190,176,800,191 // 2^40    = 554
localId      = 609,190,176,800,191  % 2^40    = 60,735,012,287
```

`60735012287` is the MU `series_id`. Verified via `GET https://api.mangaupdates.com/v1/series/60735012287` returning the same title and a `url` of `.../series/rwg23en/the-beginning-after-the-end` — and `rwg23en` happens to be `60735012287` in base36 (MU's URL slug convention; the numeric id is the API contract).

See [src/plugins/mangaupdates-sync/code.ts](src/plugins/mangaupdates-sync/code.ts) `decodeCustomSourceLocalId` for the implementation used in production.

### Encoding a mediaId (the reverse direction)

Going the other way — `localId → mediaId` — requires the `extensionIdentifier`, which seanime assigns randomly (1-1023) the first time a custom-source loads and persists in its own filecache (see seanime's `internal/extension_repo/external_custom_source.go:generateExtensionIdentifier`). It is **stable across plugin reloads but NOT across reinstalls** and **not exposed to extensions** — there is no `$extension.id` API.

When you need to compute `mediaId` for entries not yet in the user's list (e.g., an "Open in seanime" link or an auto-add flow via `$anilist.addMediaToCollection`), discover and cache the `extId` once. Three-strategy pattern from [src/plugins/local-catalog-manager/modules/register.ts](src/plugins/local-catalog-manager/modules/register.ts) (`discoverExtId`):

1. **`$storage` cache** — fast path. Once discovered, `mediaId = EXT_OFFSET + extId * 2^40 + localId` is pure arithmetic.
2. **Derive from collection** — call `await ctx.manga.getCollection()` and check `buildMediaIdLookup` (any single entry from your custom-source reveals the extId via `Math.floor((mediaId - EXT_OFFSET) / 2^40)`). Free when the user has at least one entry added.
3. **Probe via `$anilist.getManga`** — last resort for cold start (user has zero entries in their list). Iterate `extId` from 1 to 1023, call `$anilist.getManga(EXT_OFFSET + extId * 2^40 + firstLocalId)`, accept the one whose `siteUrl` starts with `ext_custom_source_<your-manifest-id>`. Yield with `$sleep(0)` every ~64 iterations to avoid blocking the runtime. ~1-3s on first run, cached forever after.

Auto-add then apply: `$anilist.addMediaToCollection([mediaId])` adds the entry as `PLANNING`; immediately follow with `$anilist.updateEntry(mediaId, status, scoreRaw, progress, ...)` to overwrite with the real values. Without `addMediaToCollection`, `updateEntry` against a mediaId not in the user's list is a silent no-op.

### Never reuse a localId — `mediaId` is a permanent identity

Because `localId` maps 1:1 into `mediaId`, and seanime treats a `mediaId` like an AniList id (a permanent identity for one specific media), **a localId must never be reissued to a different entry**. seanime persists its own snapshot of an entry's metadata keyed by `mediaId` and renders the media-entry page from that snapshot — it does NOT re-query the custom-source per view. So if you delete an entry and a new one reclaims its localId, the new entry collides with seanime's lingering snapshot and shows the *deleted* entry's details (deleting from your catalog removes it from your data, not from seanime's collection store; `$app.invalidateClientQuery` only clears the frontend query cache, not the server-side snapshot). `local-catalog-manager` allocates ids monotonically via a persisted high-water mark (`K_NEXT_ID`) — `nextId = max(ids)+1` is NOT enough, since deleting the highest id lets the next add reclaim it. Recovering a reused id requires removing the stale entry from the seanime library so seanime drops its snapshot.
