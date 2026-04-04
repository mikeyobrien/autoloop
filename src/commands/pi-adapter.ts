import * as piAdapter from "../pi-adapter.js";

export function dispatchPiAdapter(args: string[]): boolean {
  piAdapter.run(args);
  return true;
}
