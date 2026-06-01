// $shared factory — single export per file (build convention).
// init() registers this via $shared.define("mangaupdates-sync", sharedLib);
// the register module + the post-update hook call
// $shared.use<ReturnType<typeof sharedLib>>("mangaupdates-sync") to get MUClient.
//
// The build self-containerizes this file (just like every other modules/*.ts),
// inlining the MUClient import into the function body. seanime then re-evals
// `sharedLib.toString()` in each runtime that calls $shared.use, so MUClient
// travels along — and lives ONCE here instead of being inlined into BOTH the
// register and post-update wrappers (the bundle-size win $shared exists for).

import { createLogger } from "../../../_utils/logger";
import { MUClient } from "../utils/mu-client";

export const sharedLib = () => ({
  MUClient,
  createLogger,
});
