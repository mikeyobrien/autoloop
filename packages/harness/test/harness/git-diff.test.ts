import { spawnSync } from "node:child_process";
import { mkdtempSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { collectAddedLines } from "../../src/git-diff.js";

function git(cwd: string, args: string[]): void {
  const res = spawnSync("git", args, { cwd, encoding: "utf-8" });
  if (res.status !== 0) throw new Error(`git ${args.join(" ")}: ${res.stderr}`);
}

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "autoloop-git-diff-"));
  git(workDir, ["init", "-q"]);
  git(workDir, ["config", "user.email", "t@t.t"]);
  git(workDir, ["config", "user.name", "t"]);
  // The "unreadable listed name" case needs quoted non-ASCII names; do not
  // depend on the developer's global core.quotePath.
  git(workDir, ["config", "core.quotePath", "true"]);
  writeFileSync(join(workDir, "app.ts"), "export const x = 1;\n");
  git(workDir, ["add", "."]);
  git(workDir, ["commit", "-qm", "baseline"]);
});

describe("collectAddedLines", () => {
  it("returns added tracked lines and every line of untracked files", () => {
    writeFileSync(
      join(workDir, "app.ts"),
      "export const x = 1;\nexport const y = 2;\n",
    );
    writeFileSync(join(workDir, "new.ts"), "line one\nline two\n");

    expect(collectAddedLines(workDir)).toEqual([
      { file: "app.ts", text: "export const y = 2;" },
      { file: "new.ts", text: "line one" },
      { file: "new.ts", text: "line two" },
      { file: "new.ts", text: "" },
    ]);
  });

  it("skips an untracked file it cannot read by its listed name", () => {
    // git quotes non-ASCII names (core.quotePath), so the listed name is not
    // a path on disk.
    writeFileSync(join(workDir, "\u00e9.ts"), "hidden\n");
    writeFileSync(join(workDir, "ok.ts"), "seen\n");

    expect(collectAddedLines(workDir)).toEqual([
      { file: "ok.ts", text: "seen" },
      { file: "ok.ts", text: "" },
    ]);
  });

  it("skips untracked files larger than 20 MiB", () => {
    const big = join(workDir, "big.bin");
    writeFileSync(big, "");
    truncateSync(big, 20 * 1024 * 1024 + 1);

    expect(collectAddedLines(workDir)).toEqual([]);
  });

  // win32: no /dev/zero, and file symlinks need admin or Developer Mode.
  it.skipIf(process.platform === "win32")(
    "skips an untracked symlink to a device that never reaches EOF",
    () => {
      symlinkSync("/dev/zero", join(workDir, "zero"));
      writeFileSync(join(workDir, "ok.ts"), "seen\n");

      expect(collectAddedLines(workDir)).toEqual([
        { file: "ok.ts", text: "seen" },
        { file: "ok.ts", text: "" },
      ]);
    },
  );
});
