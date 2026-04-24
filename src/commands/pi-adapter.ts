import * as piAdapter from "@mobrienv/autoloop-harness/pi-adapter";

export function dispatchPiAdapter(args: string[]): boolean {
  piAdapter.run(args);
  return true;
}
