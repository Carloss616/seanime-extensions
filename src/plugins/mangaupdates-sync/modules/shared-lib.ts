// $shared factory exposing MUClient (see CLAUDE.md "$shared").

import { createLogger } from "../../../_utils/logger";
import { MUClient } from "../utils/mu-client";

export const sharedLib = () => ({
  MUClient,
  createLogger,
});
