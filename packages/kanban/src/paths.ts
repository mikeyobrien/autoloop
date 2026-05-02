import { homedir } from "node:os";
import { join } from "node:path";

export function autoloopHome(): string {
  return process.env.AUTOLOOP_HOME || join(homedir(), ".autoloop");
}
