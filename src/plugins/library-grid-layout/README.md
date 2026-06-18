# Library Grid Layout

Set **how many cards per row** the manga & anime library grids show — with a
**separate column count per screen size**, edited live from a tray panel. Plugin
extension; no seanime core changes required.

## Highlights

- 🖥️ **Per-screen-size columns** — independent values for Mobile / Tablet / Laptop / Desktop, applied automatically as you resize the window.
- 🎚️ **Monotonic by design** — a smaller screen can never show more columns than a bigger one; each stepper's limits derive from its neighbors.
- 👁️ **Live preview** — the tray highlights the scope matching your current window and previews the grid as you tune it.
- 🔄 **One-tap reset** — restore the built-in defaults at any time.
- 🟣 **seanime-default toggle** — hand control back to the native responsive grid without uninstalling.

## Requires

Any seanime version with the
[official plugin runtime](https://seanime.gitbook.io/seanime-extensions/plugins/introduction).
Uses only documented APIs — `$ui.register`, `ctx.newTray`, `ctx.dom` (`observe`,
`query`, `viewport`, `onMainTabReady`), `ctx.state`, `ctx.registerEventHandler`,
`ctx.eventHandler`, `$storage` — and requests only the `storage` permission
scope (no network, no DOM script-injection flag).

## Scopes

| Scope   | Applies when     | Default |
| ------- | ---------------- | :-----: |
| Mobile  | any width        |    4    |
| Tablet  | width ≥ 768px    |    6    |
| Laptop  | width ≥ 1280px   |    8    |
| Desktop | width ≥ 1920px   |   12    |

Each value is clamped to **1–12**. The scope in effect is whichever has the
largest min width ≤ your current viewport.

## Usage

1. Pin the plugin's tray icon and open it.
2. Use each scope's `−` / `+` stepper to set its columns. Changes apply instantly and persist across reloads.
3. **Reset to defaults** restores the table above.
4. Flip **Use seanime's default layout** to return to the native grid; flip it off to re-apply your columns.

## How it works

seanime renders both libraries inside a grid container — `[data-media-card-grid]`
for small libraries (≤ 48 items) and the virtualized `[data-media-card-lazy-grid]`
for larger ones — whose columns come from Tailwind `grid-cols-*` classes. The
plugin reads the live viewport width (`ctx.dom.viewport.getSize()`, synchronous),
picks the matching scope, and sets an inline
`grid-template-columns: repeat(N, minmax(0, 1fr))` on each grid.

> Inline styles outrank class rules on specificity, so the override needs no
> `!important` and no injected `<style>` / `@media`. The seanime-default toggle
> simply `removeStyle()`s that property, letting the original classes resume.

It re-applies on three triggers:

| Trigger                    | Hook                       |
| -------------------------- | -------------------------- |
| Grids mount (navigation)   | `ctx.dom.observe`          |
| Page reload / new main tab | `ctx.dom.onMainTabReady`   |
| Window resize across a tier| `ctx.dom.viewport.onResize`|

The per-scope config and the toggle state are persisted in `$storage`.
