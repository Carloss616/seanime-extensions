// $shared factory — one public binding per file (build convention).
// init() registers this via $shared.define("local-catalog", sharedLib);
// every hook / register module calls $shared.use<ReturnType<typeof sharedLib>>("local-catalog").
//
// The build self-containerizes this file (just like every other modules/*.ts),
// inlining all helper imports into the function body. seanime then re-evals
// `sharedLib.toString()` in each runtime that calls $shared.use, so the
// helpers travel along.

import {
  decodeExtId,
  decodeLocalId,
  encodeMediaId,
  isCustomSourceId,
} from "../../../_utils/custom-source-id";
import {
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
import { GistClient } from "../utils/gist-client";
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
  // catalog read/write
  coerceTitle,
  parseCatalog,
  resolveUserPreferred,
  serializeCatalog,
  mergeCatalog,
  diffCatalog,
  upsertEntry,
  removeEntry,
  nextId,
  validateEntry,
  // mediaId codec
  decodeLocalId,
  decodeExtId,
  encodeMediaId,
  isCustomSourceId,
  // progress
  parseProgress,
  serializeProgress,
  mergeProgress,
  diffProgress,
  progressMangaEquals,
  // sync ops
  buildMediaIdLookup,
  applyRemote,
  detectOrphans,
  pruneOrphans,
  pullProgress,
  pushProgress,
  handlePostUpdate,
});
