// Single source of truth for constants shared across the plugin's modules
// (code.ts + hooks + register). Imported via `import { ... }`; Bun bundling
// inlines the literal value at each use site, so each isolated callback
// wrapper carries its own copy without referencing a runtime const.

// $shared.define key — must match the string passed to `$shared.use` in the
// register module and the post-update hook (see modules/shared-lib.ts).
export const SHARED_LIB_NAME = "mangaupdates-sync";
