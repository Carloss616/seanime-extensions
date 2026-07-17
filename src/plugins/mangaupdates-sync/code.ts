import { onPostUpdateEntry } from "./modules/on-post-update-entry";
import { onPreUpdateEntry } from "./modules/on-pre-update-entry";
import { register } from "./modules/register";
import { sharedLib } from "./modules/shared-lib";
import { SHARED_LIB_NAME } from "./utils/constants";

export function init() {
  $shared.define(SHARED_LIB_NAME, sharedLib);

  $app.onPreUpdateEntryProgress(onPreUpdateEntry);
  $app.onPreUpdateEntry(onPreUpdateEntry);
  $app.onPostUpdateEntryProgress(onPostUpdateEntry);
  $app.onPostUpdateEntry(onPostUpdateEntry);

  $ui.register(register);
}
