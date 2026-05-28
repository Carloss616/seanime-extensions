import { register } from "./modules/register";

export function init() {
  console.log("[local-catalog-manager] initialized");
  $ui.register(register);
}
