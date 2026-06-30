<div align="center">

<img src="https://raw.githubusercontent.com/Carloss616/seanime-extensions/main/src/plugins/library-grid-layout/assets/icon.png" width="96" alt="Library Grid Layout icon" />

# 🖼️ Library Grid Layout

![Type](https://img.shields.io/badge/type-plugin-3b82f6?style=for-the-badge)
![Version](https://img.shields.io/badge/version-1.1.1-22c55e?style=for-the-badge)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)

**Set how many cards per row the manga & anime library grids show — a separate column count per screen size, edited live from a tray panel.**

[Features](#-features) · [Quick Start](#-quick-start) · [Scopes](#-scopes) · [How it works](#-how-it-works)

</div>

---

## 💡 Concept

> A UI-only plugin: no hooks, no network, no seanime core changes.

It overrides the cards-per-row of the library grids with an inline style, scoped to your current screen size, and hands control back to the native grid whenever you want.

---

## ✨ Features

| Feature | Description |
| ------- | ----------- |
| 🖥️ Per-screen-size columns | Independent values for Mobile / Tablet / Laptop / Desktop, applied as you resize. |
| 🎚️ Monotonic by design | A smaller screen can never show more columns than a bigger one; each stepper's limits derive from its neighbors. |
| 👁️ Live preview | The tray highlights the scope matching your current window and previews the grid as you tune it. |
| 🔄 One-tap reset | Restore the built-in defaults at any time. |
| 🟣 seanime-default toggle | Hand control back to the native responsive grid without uninstalling. |

---

## 🚀 Quick Start

1. Install from the [marketplace](../../../README.md#-quick-start), or paste this extension's `manifest.json` raw URL into seanime → *Add Extension*.
2. Pin the plugin's tray icon and open it.
3. Use each scope's `−` / `+` stepper to set its columns — changes apply instantly and persist across reloads.

<details>
<summary>More tray actions</summary>

- **Reset to defaults** restores the table below.
- Flip **Use seanime's default layout** to return to the native grid; flip it off to re-apply your columns.

</details>

> [!NOTE]
> Requires any seanime version with the [official plugin runtime](https://seanime.gitbook.io/seanime-extensions/plugins/introduction). Uses only documented APIs (`$ui.register`, `ctx.newTray`, `ctx.dom`, `ctx.state`, `$storage`) and requests only the `storage` permission scope — no network, no DOM script-injection.

---

## 📐 Scopes

| Scope | Applies when | Default |
| ----- | ------------ | :-----: |
| Mobile | any width | 4 |
| Tablet | width ≥ 768px | 6 |
| Laptop | width ≥ 1280px | 8 |
| Desktop | width ≥ 1920px | 12 |

Each value is clamped to **1–12**. The scope in effect is whichever has the largest min width ≤ your current viewport.

---

## 🔧 How it works

seanime renders both libraries inside a grid container — `[data-media-card-grid]` for small libraries (≤ 48 items) and the virtualized `[data-media-card-lazy-grid]` for larger ones — whose columns come from Tailwind `grid-cols-*` classes. The plugin reads the live viewport width (`ctx.dom.viewport.getSize()`, synchronous), picks the matching scope, and sets an inline `grid-template-columns: repeat(N, minmax(0, 1fr))` on each grid.

> [!NOTE]
> Inline styles outrank class rules on specificity, so the override needs no `!important` and no injected `<style>` / `@media`. The seanime-default toggle simply `removeStyle()`s that property, letting the original classes resume.

It re-applies on three triggers:

| Trigger | Hook |
| ------- | ---- |
| Grids mount (navigation) | `ctx.dom.observe` |
| Page reload / new main tab | `ctx.dom.onMainTabReady` |
| Window resize across a tier | `ctx.dom.viewport.onResize` |

The per-scope config and the toggle state are persisted in `$storage`.

---

## 📄 License

[Carlos Espinoza](https://github.com/Carloss616). Licensed under [MIT](../../../LICENSE). Part of [seanime-extensions](../../../).
