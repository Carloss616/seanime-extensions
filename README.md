# seanime-extensions

Personal collection of [seanime](https://github.com/5rahim/seanime) extensions.

Official docs: <https://seanime.gitbook.io/seanime-extensions>

## Extensions

| ID                     | Type          | Status                                            |
| ---------------------- | ------------- | ------------------------------------------------- |
| `mangaupdates`         | custom-source | ready                                             |
| `mangaupdates-sync`    | plugin        | ready                                             |

## Install in seanime

**Local** (no hosting): copy the extension's `manifest.json` into `$SEANIME_DATA_DIR/extensions/` and reload extensions.

**Self-hosted marketplace** (lets you install all your extensions from the UI): in seanime → Settings → Extensions, set the marketplace URL to:
```
https://raw.githubusercontent.com/Carloss616/seanime-extensions/main/marketplace.json
```

**Single extension install**: in seanime → Add Extension → paste the raw URL of a specific `manifest.json`.

## Layout

```
.
├─ src/
│  └─ <type>/
│     └─ <id>/
│        ├─ code.ts                  entry TS source (registers hooks / UI)
│        ├─ code.js                  built JS — the payloadURI target (generated)
│        ├─ manifest.json            source-of-truth manifest (you edit this)
│        ├─ assets/icon.png          icon (referenced by manifest `icon` URL)
│        ├─ modules/                 one file per goja-isolated callback (optional)
│        ├─ utils/                   shared helpers imported by modules (optional)
│        └─ README.md
├─ types/                            .d.ts surface for the goja runtime
├─ scripts/build.ts                  build all + regen marketplace.json
├─ marketplace.json                  auto-generated index — never edit by hand
├─ tsconfig.json                     TS config for src/ + types/ (seanime globals)
└─ scripts/tsconfig.json             TS config for the build script (Bun globals)
```

`<type>` is one of: `custom-source`, `manga-provider`, `anime-torrent-provider`, `onlinestream-provider`, `plugin`.

## Build

Requires [Bun](https://bun.com/) on PATH. Run `bun install` once.

```bash
bun run build        # build every extension + regen marketplace.json
bun run typecheck    # type-check src/+types/ and the build script
bun run check        # biome lint + format check (check:fix to autofix)
```

For each `src/*/*/code.ts`, the build validates the sibling `manifest.json`
(type whitelist, and `payloadURI` must be the sibling `code.js`), transpiles
`code.ts` → `code.js` with `Bun.build`, and rewrites `marketplace.json` with one
entry per extension — **don't edit `marketplace.json` by hand, it's overwritten.**

## Splitting an extension across files (the `modules/` convention)

seanime runs each hook (`$app.on*`) and the `$ui.register` callback in an
**isolated goja runtime**: it serializes the callback via `.toString()` and
re-evals it there. A callback **cannot read module-scope or `init()`-scope
variables** — they read as `undefined` in the isolated runtime.

So any helper a callback needs must end up *physically inside the callback's own
body*. To keep that DRY:

1. Put each isolated callback in its own file under `modules/`, exporting exactly
   one function (e.g. `export const onPostUpdateEntry = (event) => { ... }`).
2. Put shared helpers (classes/functions) under `utils/` and `import` them
   normally into the module files.
3. `code.ts` imports each module and registers it (`$app.onX(onPostUpdateEntry)`).

The build bundles each `modules/*.ts` standalone (inlining its `utils/` imports),
then re-emits it as a self-contained function whose body carries all its deps —
so the serialized callback is complete. See the wrapper comment in
[scripts/build.ts](scripts/build.ts) for the exact mechanic and why an IIFE
wrapper would `ReferenceError` at runtime.

A custom-source (whose methods are *not* serialized per-callback) doesn't need
`modules/` — it can be a single `code.ts`. See `src/custom-source/mangaupdates/`.

## Adding a new extension

Create `src/<type>/<id>/` with:

- `code.ts` — the entry (triple-slash-reference the `types/*.d.ts` you need).
- `manifest.json` — set `id`, `type`, `manifestURI` (ending in `manifest.json`),
  and `payloadURI` (the sibling `code.js` URL). Fill in `description`, `author`,
  `icon` (point at `assets/icon.png`), etc.
- `assets/icon.png`, `README.md`.
- `modules/` + `utils/` if the extension has isolated callbacks needing helpers.

Then `bun run build`, and commit the source + `code.js`. The build accepts any
`src/*/*/code.ts` regardless of the `<type>` folder name.
