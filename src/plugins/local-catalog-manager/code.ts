import { onGetMangaCollection } from "./modules/on-get-manga-collection";
import { onPostUpdateEntry } from "./modules/on-post-update-entry";
import { onPostUpdateEntryProgress } from "./modules/on-post-update-entry-progress";
import { onPreUpdateEntry } from "./modules/on-pre-update-entry";
import { onPreUpdateEntryProgress } from "./modules/on-pre-update-entry-progress";
import { register } from "./modules/register";
import { sharedLib } from "./modules/shared-lib";
import { SHARED_LIB_NAME } from "./utils/constants";

export function init() {
  $shared.define(SHARED_LIB_NAME, sharedLib);

  $app.onPreUpdateEntry(onPreUpdateEntry);
  $app.onPostUpdateEntry(onPostUpdateEntry);
  $app.onPreUpdateEntryProgress(onPreUpdateEntryProgress);
  $app.onPostUpdateEntryProgress(onPostUpdateEntryProgress);

  // Silent cross-device gist sync piggybacked on every manga-collection
  // fetch — converges progress without the user opening the tray.
  $app.onGetMangaCollection(onGetMangaCollection);

  $ui.register(register);
}
