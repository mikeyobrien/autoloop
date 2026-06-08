import { describe, expect, it } from "vitest";
import {
  COMMANDS,
  DEFAULT_PRESET,
  normalizePromptText,
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

  describe("normalizePromptText", () => {
    it("strips a <user_message> wrapper", () => {
      expect(
        normalizePromptText("<user_message>run autocode</user_message>"),
      ).toBe("run autocode");
    });
    it("strips wrappers case-insensitively and with attributes", () => {
      expect(
        normalizePromptText('<User_Message id="1">hello</User_Message>'),
      ).toBe("hello");
    });
    it("supports common wrapper tag names", () => {
      expect(normalizePromptText("<query>do it</query>")).toBe("do it");
      expect(normalizePromptText("<prompt>do it</prompt>")).toBe("do it");
    });
    it("leaves unwrapped text untouched", () => {
      expect(normalizePromptText("run autocode")).toBe("run autocode");
    });
    it("leaves unmatched/partial tags untouched", () => {
      expect(normalizePromptText("<user_message>oops")).toBe(
        "<user_message>oops",
      );
      expect(normalizePromptText("a <user_message>b</user_message>")).toBe(
        "a <user_message>b</user_message>",
      );
    });
    it("only strips a single outer wrapper", () => {
      expect(normalizePromptText("<user><message>x</message></user>")).toBe(
        "<message>x</message>",
      );
    });
  });

  it("DEFAULT_PRESET is a known preset name", () => {
    expect(typeof DEFAULT_PRESET).toBe("string");
    expect(DEFAULT_PRESET.length).toBeGreaterThan(0);
  });
});
