# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A personal collection of [seanime](https://github.com/5rahim/seanime) extensions. Each extension is a TypeScript entry (`code.ts`) plus a `manifest.json`. The build transpiles `code.ts` to a sibling `code.js`; the manifest's `payloadURI` points at the raw GitHub URL of that `code.js`, which is what seanime fetches and runs. Both source and built `code.js` are committed.

## Build commands

```bash
bun run build        # build every extension + regen marketplace.json
bun run typecheck    # tsc --noEmit over src/+types/ and over scripts/ (two configs)
bun run check        # biome lint + format check (check:fix to autofix)
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

## Adding an extension

Create `src/<type>/<id>/` by hand:

- `code.ts` — the entry (triple-slash-reference the `types/*.d.ts` you need; register hooks/UI here).
- `manifest.json` — set `id`, `type`, `manifestURI` (ending in `manifest.json`), `payloadURI` (the sibling `code.js` URL), `icon` (point at `assets/icon.png`), and the standard metadata.
- `assets/icon.png`, `README.md`.
- `modules/` + `utils/` only if the extension has isolated callbacks needing shared helpers.

Then `bun run build` and commit the source + `code.js`. The build accepts any `src/*/*/code.ts` regardless of the `<type>` folder name.

## Runtime environment for extension code

Extensions run inside seanime under **goja** (Go's JS engine, no Node, no browser). The only globals available are the ones declared in [types/core.d.ts](types/core.d.ts) and the per-type `.d.ts` files. Notably:

- `fetch(url, options)` returns a `FetchResponse` whose `text()` / `json()` are **synchronous methods** (not Promises) — even though the outer `fetch` returns a Promise. See how [src/custom-source/mangaupdates/code.ts](src/custom-source/mangaupdates/code.ts) calls `res.json()` without `await`.
- `$sleep`, `$clone`, `$replace`, `$toString`, `$getUserPreference` are runtime helpers (not Node/browser builtins).
- Plugins additionally get `$app` (lifecycle hooks), `$anilist` (in-process AniList lookups), `$storage` (per-extension persistence) — declared in [types/plugin.d.ts](types/plugin.d.ts).
- `tsconfig.json` targets ES2018 for IDE/typecheck strictness, but `Bun.build` does not down-convert syntax — modern output (native class fields, optional chaining, etc.) passes through. Recent goja accepts it; if a feature ever trips goja, avoid it in source.

Each `code.ts` pulls types in via triple-slash references at the top, e.g.:

```ts
/// <reference path="../../../types/core.d.ts" />
/// <reference path="../../../types/custom-source.d.ts" />
```

There is no module system at runtime — the entire transpiled file is the payload, executed in the goja sandbox. Don't `import` anything.

## Type definitions are intentionally partial

[types/](types/) only contains the surface this repo actually touches. The full type surface lives in `internal/extension_repo/goja_plugin_types/` in the seanime source tree. **When adding a new extension type or hook**, copy the relevant `.d.ts` snippets from seanime into `types/` — they are type-only, the goja runtime already exposes the bindings.

- [types/core.d.ts](types/core.d.ts) — runtime globals (always referenced).
- [types/custom-source.d.ts](types/custom-source.d.ts) — `CustomSource` abstract class + AniList (`AL_*`) shapes.
- [types/plugin.d.ts](types/plugin.d.ts) — `$app` / `$anilist` / `$storage` namespaces. Subset of seanime's full plugin runtime.
- [types/mu-api.d.ts](types/mu-api.d.ts) — MangaUpdates v1 API response shapes shared by the custom-source and the tracker plugin.

## CustomSource implementations: stub the unused half

The `CustomSource` abstract class declares both anime and manga methods. Even when `getSettings()` returns `supportsAnime: false`, all anime methods must still be defined to satisfy the TypeScript shape — they just return `[]` / `null`. See the stub block in [src/custom-source/mangaupdates/code.ts](src/custom-source/mangaupdates/code.ts) for the pattern.

## Plugin lifecycle

Plugin extensions use a top-level `init()` function (declared in [types/plugin.d.ts](types/plugin.d.ts)) as the entry point. Inside `init()`, register hooks via `$app.onPreUpdateEntryProgress` / `$app.onPostUpdateEntryProgress` / etc. State that must outlive `init()` goes in closures or `$storage`.

Convention used by `mangaupdates-sync`: capture the payload in the **pre**-hook into `$store` (the cross-runtime in-memory channel — hook runtimes can't share closures), then consume it in the **post**-hook. The post-hook only fires when the underlying AniList update succeeds, so this keeps the external service (MU) and AniList in lock-step without a transaction. The hooks live in [modules/](src/plugins/mangaupdates-sync/modules/) and are wired up in [code.ts](src/plugins/mangaupdates-sync/code.ts) `init()`.

Every hook callback must call `event.next()` — even on error paths.

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
