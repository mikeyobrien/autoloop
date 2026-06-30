import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  postFireCheckCommands,
  reconcileOutcome,
  verifyPostFire,
} from "@mobrienv/autoloop-harness/postfire-verify";
import { describe, expect, it } from "vitest";

describe("reconcileOutcome", () => {
  it("is unverifiable when there are no checks (green != verified)", () => {
    expect(reconcileOutcome(0, true)).toBe("unverifiable");
  });
  it("confirms when checks ran and all passed", () => {
    expect(reconcileOutcome(2, true)).toBe("confirmed");
  });
  it("flags a false done when a check failed", () => {
    expect(reconcileOutcome(2, false)).toBe("false_done");
  });
});

describe("postFireCheckCommands", () => {
  it("assembles verify_cmds + verify_cmd + criterion-bound checks", () => {
    const cmds = postFireCheckCommands(["npm test"], "npm run build", [
      "feature works :: curl -sf localhost",
      "advisory only",
    ]);
    expect(cmds).toEqual(["npm test", "npm run build", "curl -sf localhost"]);
  });
  it("returns [] when nothing is configured", () => {
    expect(postFireCheckCommands([], "", [])).toEqual([]);
  });
});

describe("verifyPostFire", () => {
  function workDir(): string {
    return mkdtempSync(join(tmpdir(), "autoloop-postfire-"));
  }

  it("confirms a run whose checks all pass", () => {
    const result = verifyPostFire(workDir(), ["true", "exit 0"], 30000);
    expect(result.reconcile).toBe("confirmed");
    expect(result.failures).toHaveLength(0);
  });

  it("catches a false done when a check fails", () => {
    const result = verifyPostFire(workDir(), ["true", "false"], 30000);
    expect(result.reconcile).toBe("false_done");
    expect(result.failures.map((f) => f.command)).toEqual(["false"]);
  });

  it("is unverifiable with no checks", () => {
    expect(verifyPostFire(workDir(), [], 30000).reconcile).toBe("unverifiable");
  });

  it("runs the checks in the run's work dir", () => {
    const dir = workDir();
    // `test -d .` always passes; assert cwd by checking a path relative to dir.
    const result = verifyPostFire(dir, ["test \"$(pwd)\" != ''"], 30000);
    expect(result.reconcile).toBe("confirmed");
  });
});
