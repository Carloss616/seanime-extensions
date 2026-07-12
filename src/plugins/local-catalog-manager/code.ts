import { onGetMangaCollection } from "./modules/on-get-manga-collection";
import { onPostUpdateEntry } from "./modules/on-post-update-entry";
import { onPostUpdateEntryProgress } from "./modules/on-post-update-entry-progress";
import { onPreUpdateEntry } from "./modules/on-pre-update-entry";
import { onPreUpdateEntryProgress } from "./modules/on-pre-update-entry-progress";
import { register } from "./modules/register";
import { sharedLib } from "./modules/shared-lib";
import { SHARED_LIB_NAME } from "./utils/constants";

export function init() {
  // NOTE: the v2.2→v2.3 $storage key migration (migrateStorageKeys) can't run
  // here — init() is the loader VM and has no $storage. It runs instead at the
  // top of the register callback + each hook (the runtimes that DO have it).

  // $shared.define MUST come before any hook / UI registration (per the docs)
  // — every callback later does $shared.use(SHARED_LIB_NAME).
  $shared.define(SHARED_LIB_NAME, sharedLib);

  $app.onPreUpdateEntry(onPreUpdateEntry);
  $app.onPostUpdateEntry(onPostUpdateEntry);
  $app.onPreUpdateEntryProgress(onPreUpdateEntryProgress);
  $app.onPostUpdateEntryProgress(onPostUpdateEntryProgress);

  // Triggers a silent gist sync whenever seanime fetches the manga
  // collection (library page load, Refresh source, Reload sources). This
  // is what keeps cross-device progress converged without the user needing
  // to open the plugin tray. The hook callback applies $store-based
  // cooldown so multiple rapid fetches don't hammer GitHub.
  $app.onGetMangaCollection(onGetMangaCollection);

  $ui.register(register);
}
