<div align="center">

# 🧩 seanime-extensions

![License](https://img.shields.io/badge/license-MIT-green?style=for-the-badge)
![Built with Bun](https://img.shields.io/badge/built%20with-Bun-14151a?style=for-the-badge&logo=bun&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Extensions](https://img.shields.io/badge/extensions-5-blue?style=for-the-badge)

**A personal collection of [seanime](https://github.com/5rahim/seanime) custom-sources and plugins — track manga that isn't on AniList, mirror your reads to MangaUpdates, and tune the library grid.**

[Extensions](#-extensions) · [Quick Start](#-quick-start) · [Tech Stack](#-tech-stack) · [Development](#-development) · [Contributing](#-contributing)

<!-- TODO: marketplace screenshot / GIF -->

</div>

---

## 💡 Concept

> seanime supports third-party extensions — TypeScript bundles it fetches and runs in a sandboxed [goja](https://github.com/dop251/goja) runtime.

This repo is a small, manga-focused set of them. Each extension is a `code.ts` entry plus a `manifest.json`; the build transpiles it to a sibling `code.js` that seanime loads from a raw GitHub URL. Source and built payload are both committed, and a generated `marketplace.json` lets you install the whole set from the seanime UI.

---

## 🧩 Extensions

| Extension | Type | What it does |
| --------- | ---- | ------------ |
| [Local Catalog](src/custom-source/local-catalog/) | custom-source | Serve a self-curated manga catalog for titles not on AniList / MangaUpdates. |
| [Local Catalog Manager](src/plugins/local-catalog-manager/) | plugin | Add/edit/delete the local catalog from inside seanime and sync it (plus reading progress) to a GitHub Gist. |
| [MangaUpdates](src/custom-source/mangaupdates/) | custom-source | Add MangaUpdates as a search & details metadata source. |
| [MangaUpdates Sync](src/plugins/mangaupdates-sync/) | plugin | Push your reading progress, status and score to MangaUpdates. |
| [Library Grid Layout](src/plugins/library-grid-layout/) | plugin | Set cards-per-row of the library grids, per screen size. |

Two are pairs: **Local Catalog** + **Local Catalog Manager** (the plugin curates the catalog the source serves), and **MangaUpdates** + **MangaUpdates Sync** (the source finds titles, the plugin tracks them). **Library Grid Layout** is standalone.

---

## 🚀 Quick Start

Install everything from the marketplace — in seanime go to *Settings → Extensions* and set the marketplace URL to:

```
https://raw.githubusercontent.com/Carloss616/seanime-extensions/main/marketplace.json
```

<details>
<summary>Other install methods</summary>

- **Single extension** — *Add Extension*, then paste the raw URL of that extension's `manifest.json`.
- **Local (no hosting)** — copy the extension's `manifest.json` into `$SEANIME_DATA_DIR/extensions/` and reload extensions.

Each extension's own README covers its configuration.

</details>

---

## 🏗 Tech Stack

| Tool | Role |
| ---- | ---- |
| [Bun](https://bun.com/) | Bundler + test runner + task runner |
| [TypeScript](https://www.typescriptlang.org/) | Source language (typechecked against the goja `.d.ts` surface) |
| [Biome](https://biomejs.dev/) | Lint + format |
| [goja](https://github.com/dop251/goja) | The Go JS engine seanime runs the bundles in (no Node, no browser) |

<details>
<summary>Repository layout</summary>

```
src/
  <type>/<id>/
    code.ts        entry source — registers hooks / UI
    code.js        built payload, the payloadURI target (generated)
    manifest.json  source-of-truth manifest
    assets/icon.png
    modules/       one file per goja-isolated callback (optional)
    utils/         helpers imported by modules (optional)
    README.md
  _utils/  _components/   code shared across extensions
types/            .d.ts surface for the goja runtime
scripts/build.ts  build all + regen marketplace.json
marketplace.json  generated index — never edit by hand
```

`<type>` is one of `custom-source`, `manga-provider`, `anime-torrent-provider`, `onlinestream-provider`, `plugin`.

</details>

---

## 🛠 Development

Requires [Bun](https://bun.com/) on PATH. Run `bun install` once.

| Command | What it does |
| ------- | ------------ |
| `bun run build` | Build every extension (`code.ts` → `code.js`) and regenerate `marketplace.json`. |
| `bun run typecheck` | `tsc --noEmit` over `src/` + `types/`, and over `scripts/`. |
| `bun run check` | Biome lint + format check (`check:fix` to autofix). |
| `bun run test` | Unit tests, co-located as `src/**/*.test.ts`. |

> [!WARNING]
> `marketplace.json` is generated from each `manifest.json` — never edit it by hand; it's overwritten on the next build.

<details>
<summary>How extensions are bundled (the <code>modules/</code> convention)</summary>

seanime runs each hook (`$app.on*`) and the `$ui.register` callback in an **isolated goja runtime**: it serializes the callback with `.toString()` and re-evals it there. A callback therefore **cannot** read module-scope variables — any helper it needs must live physically inside its own body.

The convention that keeps that DRY: put each isolated callback in `modules/` (exporting one function), put shared helpers in `utils/`, and `import` them normally. The build bundles each `modules/*.ts` standalone and re-emits it as a self-contained function that carries its dependencies inline. See the wrapper comment in [scripts/build.ts](scripts/build.ts) for the exact mechanic.

A custom-source isn't serialized per-callback, so it can be a single `code.ts` — see [mangaupdates](src/custom-source/mangaupdates/).

</details>

---

## 🗺️ Roadmap

- [x] MangaUpdates custom-source + reading-state sync
- [x] Local Catalog custom-source + in-app manager
- [x] Cross-device catalog & reading-progress sync via GitHub Gist
- [x] Library grid column control
- [ ] Anime support in Local Catalog (`anime` namespace is reserved, not served yet)
- [ ] Pull-diff UI for MangaUpdates Sync (currently push-only)

---

## 🤝 Contributing

Fork → branch (`feature/your-change`) → `bun run build && bun run typecheck && bun run test` → open a PR. New extensions go under `src/<type>/<id>/`; see the [bundling notes](#️-development) above and [CLAUDE.md](CLAUDE.md) for the runtime constraints.

---

## 📄 License

[Carlos Espinoza](https://github.com/Carloss616). Licensed under [MIT](LICENSE).
