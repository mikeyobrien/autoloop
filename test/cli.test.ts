import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { existsSync } from "node:fs";

const ROOT = resolve(import.meta.dirname, "..");
const ENTRY = resolve(ROOT, "dist/main.js");

/** Run the compiled CLI with the given args and return stdout. */
function cli(...args: string[]): string {
  return execFileSync("node", [ENTRY, ...args], {
    cwd: ROOT,
    encoding: "utf-8",
    timeout: 10_000,
    env: { ...process.env, AUTOLOOP_PROJECT_DIR: undefined },
  });
}

/** Regex that matches bare `autoloops` NOT followed by `-ts`, `.toml`, or `.conf`. */
const LEGACY_NAME_RE = /(?<![.\-/])autoloops(?!-ts|\.toml|\.conf)/;

const SURFACES = [
  { name: "--help", args: ["--help"] },
  { name: "run --help", args: ["run", "--help"] },
  { name: "emit --help", args: ["emit", "--help"] },
  { name: "inspect --help", args: ["inspect", "--help"] },
  { name: "memory", args: ["memory"] },
  { name: "memory add", args: ["memory", "add"] },
  { name: "chain", args: ["chain"] },
  { name: "list --help", args: ["list", "--help"] },
] as const;

const outputCache = new Map<string, string>();

function cliOutput(...args: string[]): string {
  const key = JSON.stringify(args);
  const cached = outputCache.get(key);
  if (cached !== undefined) return cached;
  const out = cli(...args);
  outputCache.set(key, out);
  return out;
}

function expectNoLegacyName(output: string, surface: string): void {
  for (const line of output.split("\n")) {
    expect(line, `legacy name in "${surface}": ${line.trim()}`).not.toMatch(
      LEGACY_NAME_RE,
    );
  }
}

beforeAll(() => {
  if (!existsSync(ENTRY)) {
    execFileSync("node", [resolve(ROOT, "node_modules/typescript/bin/tsc")], {
      cwd: ROOT,
      timeout: 30_000,
    });
  }
});

describe("top-level --help", () => {
  it("includes the canonical command name", () => {
    const out = cliOutput("--help");
    expect(out).toContain("autoloop");
  });

  it("lists all subcommands", () => {
    const out = cliOutput("--help");
    for (const cmd of ["run", "emit", "inspect", "memory", "list", "chain"]) {
      expect(out).toContain(`autoloop ${cmd}`);
    }
  });

  it("contains no legacy bare 'autoloops' references", () => {
    const out = cliOutput("--help");
    for (const line of out.split("\n")) {
      expect(line).not.toMatch(LEGACY_NAME_RE);
    }
  });
});

describe("run --help", () => {
  it("includes the canonical command name and flags", () => {
    const out = cliOutput("run", "--help");
    expect(out).toContain("autoloop run");
    for (const flag of ["-h", "-v", "-b", "-p", "--chain"]) {
      expect(out).toContain(flag);
    }
  });

  it("includes examples", () => {
    const out = cliOutput("run", "--help");
    expect(out).toContain("autoloop run autocode");
  });

  it("contains no legacy bare 'autoloops' references", () => {
    const out = cliOutput("run", "--help");
    for (const line of out.split("\n")) {
      expect(line).not.toMatch(LEGACY_NAME_RE);
    }
  });
});

describe("emit --help", () => {
  it("shows canonical usage", () => {
    const out = cliOutput("emit", "--help");
    expect(out).toContain("autoloop emit");
  });
});

describe("inspect --help", () => {
  it("includes artifact names", () => {
    const out = cliOutput("inspect", "--help");
    expect(out).toContain("autoloop inspect");
    for (const artifact of [
      "scratchpad",
      "prompt",
      "output",
      "journal",
      "memory",
      "coordination",
      "chain",
      "metrics",
    ]) {
      expect(out).toContain(artifact);
    }
  });
});

describe("memory (no args)", () => {
  it("shows usage with all subcommands", () => {
    const out = cliOutput("memory");
    expect(out).toContain("autoloop memory");
    for (const sub of ["list", "status", "find", "add", "remove"]) {
      expect(out).toContain(`autoloop memory ${sub}`);
    }
  });
});

describe("memory add (no args)", () => {
  it("shows usage with memory kinds", () => {
    const out = cliOutput("memory", "add");
    expect(out).toContain("autoloop memory add");
    for (const kind of ["learning", "preference", "meta"]) {
      expect(out).toContain(kind);
    }
  });
});

describe("chain (no args)", () => {
  it("shows usage with subcommands", () => {
    const out = cliOutput("chain");
    expect(out).toContain("autoloop chain");
    for (const sub of ["list", "run"]) {
      expect(out).toContain(sub);
    }
  });
});

describe("list --help", () => {
  it("shows canonical usage", () => {
    const out = cliOutput("list", "--help");
    expect(out).toContain("autoloop list");
  });
});

describe("top-level --help developer workflow section", () => {
  it("includes Developer Workflow heading", () => {
    const out = cliOutput("--help");
    expect(out).toContain("Developer Workflow:");
  });

  it("lists npm scripts and install-hooks", () => {
    const out = cliOutput("--help");
    expect(out).toContain("npm run build");
    expect(out).toContain("npm test");
    expect(out).toContain("npm run test:watch");
    expect(out).toContain("bin/install-hooks");
  });
});

describe("chain --help", () => {
  it("exits 0 and shows usage", () => {
    const out = cliOutput("chain", "--help");
    expect(out).toContain("autoloop chain");
    expect(out).toContain("list");
    expect(out).toContain("run");
  });

  it("-h also works", () => {
    const out = cliOutput("chain", "-h");
    expect(out).toContain("autoloop chain");
  });
});

describe("naming consistency across all help surfaces", () => {
  for (const { name, args } of SURFACES) {
    it(`${name}: no legacy 'autoloops' without '-ts' suffix`, () => {
      expectNoLegacyName(cliOutput(...args), name);
    });
  }
});
