import { describe, expect, it } from "vitest";
import {
  COMMANDS,
  findCommand,
  parseCommandLine,
  tokenize,
} from "../../src/acp/registry.js";

describe("acp registry", () => {
  it("lists run as the first command", () => {
    expect(COMMANDS[0].name).toBe("run");
  });

  it("each command has description, hint, and mode", () => {
    for (const c of COMMANDS) {
      expect(c.name).toBeTruthy();
      expect(typeof c.description).toBe("string");
      expect(typeof c.hint).toBe("string");
      expect(["stream", "capture", "control"]).toContain(c.mode);
    }
  });

  it("findCommand resolves known and rejects unknown", () => {
    expect(findCommand("run")?.mode).toBe("stream");
    expect(findCommand("dashboard")?.mode).toBe("control");
    expect(findCommand("loops")?.mode).toBe("capture");
    expect(findCommand("nope")).toBeUndefined();
  });

  describe("tokenize", () => {
    it("splits on whitespace", () => {
      expect(tokenize("run autocode foo")).toEqual(["run", "autocode", "foo"]);
    });
    it("honors double quotes", () => {
      expect(tokenize('run autocode "Fix the bug"')).toEqual([
        "run",
        "autocode",
        "Fix the bug",
      ]);
    });
    it("honors single quotes", () => {
      expect(tokenize("guide 'be careful now'")).toEqual([
        "guide",
        "be careful now",
      ]);
    });
    it("returns empty for blank input", () => {
      expect(tokenize("   ")).toEqual([]);
      expect(tokenize("")).toEqual([]);
    });
    it("preserves empty quoted token", () => {
      expect(tokenize('run ""')).toEqual(["run", ""]);
    });
    it("handles tabs and newlines as separators", () => {
      expect(tokenize("run\tautocode\nfoo")).toEqual([
        "run",
        "autocode",
        "foo",
      ]);
    });
  });

  describe("parseCommandLine", () => {
    it("parses a bare verb with args", () => {
      const parsed = parseCommandLine('run autocode "Fix bug"');
      expect(parsed?.spec.name).toBe("run");
      expect(parsed?.args).toEqual(["autocode", "Fix bug"]);
    });
    it("parses a slash command", () => {
      const parsed = parseCommandLine("/loops --all");
      expect(parsed?.spec.name).toBe("loops");
      expect(parsed?.args).toEqual(["--all"]);
    });
    it("returns null for unknown verb", () => {
      expect(parseCommandLine("bogus arg")).toBeNull();
    });
    it("returns null for empty line", () => {
      expect(parseCommandLine("   ")).toBeNull();
    });
  });
});
