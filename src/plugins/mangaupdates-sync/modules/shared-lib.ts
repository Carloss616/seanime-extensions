// $shared factory. seanime re-evals `sharedLib.toString()` in each runtime that
// calls $shared.use, so the factory must be self-contained — the build inlines
// the MUClient import into its body, letting MUClient live ONCE here instead of
// being duplicated into both the register and post-update wrappers.

import { createLogger } from "../../../_utils/logger";
import { MUClient } from "../utils/mu-client";

export const sharedLib = () => ({
  MUClient,
  createLogger,
});
