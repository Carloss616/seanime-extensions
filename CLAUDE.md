# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A personal collection of [seanime](https://github.com/5rahim/seanime) extensions. Each extension is a TypeScript file (`code.ts`) plus a JSON manifest template; the build step transpiles the TS and inlines it into the manifest as a string payload. The output `<id>.json` files are what seanime actually loads.

## Build commands

```bash
python3 build.py                  # build every extension + regen marketplace.json
python3 build.py mangaupdates     # build one extension by id
python3 build.py id1 id2          # build several
python3 build.py --no-marketplace # skip marketplace.json regeneration
python3 build.py new <type> <id>  # scaffold a new extension under src/<type>/<id>/
```

`<type>` must be one of: `custom-source`, `manga-provider`, `anime-torrent-provider`, `onlinestream-provider`, `plugin` (enforced by `VALID_TYPES` in [build.py](build.py)).

Requirements: Python 3, `npx` on PATH (esbuild is fetched via `npx --yes esbuild` on demand — no `node_modules` checked in).

There is no test command and no lint command. Type-checking is IDE-only via [tsconfig.json](tsconfig.json) (`noEmit: true`).

## Build pipeline (what `build.py` actually does)

1. Discovers every `src/**/manifest.template.json` via `rglob`.
2. For each extension folder, reads `code.ts`, resolves `// @inject-lib <path>` markers by inlining the referenced files (see "Splitting an extension across multiple files" below), and pipes the result through `npx esbuild --loader=ts --target=es2018`.
3. Loads the manifest, asserts `"payload": "__PAYLOAD__"` and that `type` is in `VALID_TYPES`.
4. Replaces `payload` with the transpiled JS **as a string** (not a file reference — the JS is embedded in the JSON).
5. Writes `<id>.js` (the raw transpiled JS, for debugging) and `<id>.json` (the manifest with embedded payload) next to the source.
6. After building, regenerates [marketplace.json](marketplace.json) by reading every built `<id>.json` and projecting `MARKETPLACE_FIELDS` (id, name, description, author, manifestURI, icon, type, language, lang, website). **Never hand-edit `marketplace.json`** — it will be overwritten on the next build.

Both source and built artifacts are committed (the raw GitHub URLs in `manifestURI` are how seanime installs them).

## Splitting an extension across multiple files

Goja has no module loader (`import`/`export` is forbidden at runtime), AND the relevant top-level callbacks — `$app.on*` hooks, the `$ui.register` outer callback, and anything else seanime serializes via `.toString()` and re-execs in a fresh worker — do NOT see module scope at runtime. Each isolated-runtime callback only sees what's physically inside its own body.

To split an extension across files, drop helper TypeScript files into a `lib/` sibling of `code.ts` and reference them with `// @inline <path>` markers placed **inside** each isolated-runtime callback that needs them. `build.py` replaces each marker with the file's contents (minus triple-slash references) before transpiling. The path is relative to `code.ts` and must stay inside the extension folder. Multiple markers per callback are fine:

```ts
$ui.register((ctx) => {
    // @inline ./lib/mu-client.ts
    // @inline ./lib/anilist-helpers.ts
    const mu = new MUClient(...)
    // ...
})
```

The marker is intentionally a preprocessor directive (textual `#include`-style), NOT an ES `import` — bundlers always hoist imports to module scope, which seanime's `.toString() + eval` strips. The mechanic is documented in detail at the top of [src/plugins/mangaupdates-sync/code.ts](src/plugins/mangaupdates-sync/code.ts).

Lib files are **not** auto-concatenated at module scope — they appear in the built `.js` only where explicitly injected. TypeScript still sees them via the project-wide `include` glob (with `isolatedModules: false` and no `import`/`export`, they share global script scope at type-check time), so the IDE resolves `new MUClient(...)` against the canonical class declaration in `lib/mu-client.ts`. esbuild auto-renames each injected copy (`MUClient2`, etc.) to avoid name collisions at runtime.

### Lib-file scoping rule (avoid dead code in inlines)

**Keep each `lib/*.ts` file as narrow as possible** — only group helpers that are always used together. Every callback that injects a lib file pays the size cost of every declaration in it. If two callbacks need different subsets of helpers, split the lib file rather than inflating both.

`build.py` enforces this with a validator that runs before transpilation. Two errors fail the build:

1. **Missing inline** — a callback body references a name declared in `lib/*.ts` but has no `// @inline ./lib/<file>.ts` marker for that file. The error names the line of the usage and the lib file to add.
2. **Unused inline** — a marker is present but none of the lib file's top-level declarations (`class`, `function` at column 0) are referenced in the enclosing body. The error suggests either removing the marker or narrowing the lib file.

The validator parses comments/strings/templates with a small state machine to avoid false matches on identifier names that appear in docstrings or log messages.

### Class-field gotcha inside inlined classes

TypeScript class field declarations (`private x: T` even without an initializer) and parameter properties (`constructor(private x: T) {}`) cause esbuild to emit `__publicField(this, ...)` calls — and the `__publicField` helper lives at the module-scope top of the bundle, which inlined classes can't see at runtime. Inside any class that's injected via `// @inline`, declare fields with the `declare` modifier (TypeScript-only, no runtime emit) and assign them in the constructor:

```ts
class MyHelper {
    declare private foo: string                // ← `declare` is load-bearing
    constructor(foo: string) {
        this.foo = foo                         // assign in constructor body
    }
}
```

See [lib/mu-client.ts](src/plugins/mangaupdates-sync/lib/mu-client.ts) for the working pattern. Symptoms when this is missed: `ReferenceError: __publicField is not defined` at plugin load time.

### Reference plugin

The `mangaupdates-sync` plugin uses this pattern: [lib/mu-client.ts](src/plugins/mangaupdates-sync/lib/mu-client.ts) defines `MUClient` once. Both the post-hook IIFE and the `$ui.register` callback in [code.ts](src/plugins/mangaupdates-sync/code.ts) carry `// @inline ./lib/mu-client.ts`, dropping the class into each isolated runtime that needs it.

## Adding an extension

`python3 build.py new <type> <id>` creates `src/<type>/<id>/` with a stub `code.ts`, a `manifest.template.json` (with the `__PAYLOAD__` placeholder and a `manifestURI` already pointing at the eventual raw GitHub URL), and a `README.md`. After implementation, run `python3 build.py <id>` to produce the artifacts, then commit everything.

`<type>` directories under `src/` are pure folder convention. The build script doesn't care about path depth — it accepts any subfolder containing both `code.ts` and `manifest.template.json`.

## Runtime environment for extension code

Extensions run inside seanime under **goja** (Go's JS engine, no Node, no browser). The only globals available are the ones declared in [types/core.d.ts](types/core.d.ts) and the per-type `.d.ts` files. Notably:

- `fetch(url, options)` returns a `FetchResponse` whose `text()` / `json()` are **synchronous methods** (not Promises) — even though the outer `fetch` returns a Promise. See how [src/custom-source/mangaupdates/code.ts](src/custom-source/mangaupdates/code.ts) calls `res.json()` without `await`.
- `$sleep`, `$clone`, `$replace`, `$toString`, `$getUserPreference` are runtime helpers (not Node/browser builtins).
- Plugins additionally get `$app` (lifecycle hooks), `$anilist` (in-process AniList lookups), `$storage` (per-extension persistence) — declared in [types/plugin.d.ts](types/plugin.d.ts).
- ES2018 target. No `async/await` polyfill issues, but no newer syntax.

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

Convention used by `mangaupdates-sync`: capture payload in the **pre**-hook into an in-memory `Map`, then consume it in the **post**-hook. The post-hook only fires when the underlying AniList update succeeds, so this keeps the external service (MU) and AniList in lock-step without a transaction. See [src/plugins/mangaupdates-sync/code.ts](src/plugins/mangaupdates-sync/code.ts) `init()`.

Every hook callback must call `event.next()` — even on error paths.

## Plugin manifest extras

Plugin manifests have two blocks beyond the standard fields ([example](src/plugins/mangaupdates-sync/manifest.template.json)):

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
