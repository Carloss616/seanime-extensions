// $shared factory for "local-catalog" (see CLAUDE.md "$shared").

import {
  decodeExtId,
  decodeLocalId,
  encodeMediaId,
  isCustomSourceId,
} from "../../../_utils/custom-source-id";
import { GistClient } from "../../../_utils/gist/client";
import {
  catalogsEqual,
  coerceTitle,
  diffCatalog,
  mergeCatalog,
  parseCatalog,
  resolveUserPreferred,
  serializeCatalog,
} from "../../../_utils/local-catalog/catalog";
import {
  diffProgress,
  mergeProgress,
  parseProgress,
  progressMangaEquals,
  serializeProgress,
} from "../../../_utils/local-catalog/progress";
import { createLogger } from "../../../_utils/logger";
import {
  nextId,
  removeEntry,
  upsertEntry,
  validateEntry,
} from "../utils/catalog";
import {
  applyRemote,
  buildMediaIdLookup,
  detectOrphans,
  handlePostUpdate,
  pruneOrphans,
  pullProgress,
  pushProgress,
} from "../utils/progress-sync";

export const sharedLib = () => ({
  createLogger,
  GistClient,
  coerceTitle,
  parseCatalog,
  resolveUserPreferred,
  serializeCatalog,
  mergeCatalog,
  diffCatalog,
  catalogsEqual,
  upsertEntry,
  removeEntry,
  nextId,
  validateEntry,
  decodeLocalId,
  decodeExtId,
  encodeMediaId,
  isCustomSourceId,
  parseProgress,
  serializeProgress,
  mergeProgress,
  diffProgress,
  progressMangaEquals,
  buildMediaIdLookup,
  applyRemote,
  detectOrphans,
  pruneOrphans,
  pullProgress,
  pushProgress,
  handlePostUpdate,
});
