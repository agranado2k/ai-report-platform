import { l1Plugins } from "./l1";
import { ChipPlugin } from "./chip-plugin";

/** L2 = L1 + the one real custom `chip` element. */
export function l2Plugins() {
  return [...l1Plugins(), ChipPlugin];
}
