import { onPostUpdateEntry } from "./modules/on-post-update-entry";
import { onPreUpdateEntry } from "./modules/on-pre-update-entry";
import { register } from "./modules/register";

// MangaUpdates sync plugin.
//
// init() runs in the plugin's loader VM, but hook AND $ui.register callbacks
// fire in SEPARATE goja runtimes — they cannot read anything declared at
// module scope or in init() (the docs are explicit: a callback reading a
// module/init variable gets `undefined`). seanime serializes each callback
// via `.toString()` and re-evals it in a fresh runtime, so every callback
// must be fully self-contained.
//
// Each isolated callback lives in its own file under `modules/`. The build
// (scripts/build.ts) bundles each `modules/*.ts` standalone — resolving its
// `../utils/*` imports and inlining those decls — then wraps the bundle as a
// self-contained function whose body carries all its deps. So when seanime
// serializes the callback, `MUClient` (etc.) travels inside the function text.
//
// `MUClient` lives once in `utils/mu-client.ts` and is imported by the modules
// that need it. Pre→Post payloads cross runtimes via `$store`.

export function init() {
  $app.onPreUpdateEntryProgress(onPreUpdateEntry);
  $app.onPreUpdateEntry(onPreUpdateEntry);
  $app.onPostUpdateEntryProgress(onPostUpdateEntry);
  $app.onPostUpdateEntry(onPostUpdateEntry);

  console.log("[mangaupdates-sync] initialized");

  $ui.register(register);
}
