import { describe, expect, it } from "vitest";
import {
  binaryNamed,
  claudeBackend,
  resolveProcessKind,
} from "../../src/config-helpers.js";

describe("binaryNamed", () => {
  it("keeps the POSIX rule: bare name or a path ending in /name", () => {
    expect(binaryNamed("claude", "claude", "linux")).toBe(true);
    expect(binaryNamed("/usr/local/bin/claude", "claude", "linux")).toBe(true);
    expect(binaryNamed("my-claude", "claude", "linux")).toBe(false);
    expect(binaryNamed("C:\\npm\\claude.cmd", "claude", "linux")).toBe(false);
    expect(binaryNamed("/opt/Claude", "claude", "darwin")).toBe(false);
  });

  it("accepts backslash paths, letter case, and .exe/.cmd/.bat on win32", () => {
    expect(binaryNamed("claude", "claude", "win32")).toBe(true);
    expect(binaryNamed("C:\\npm\\claude.cmd", "claude", "win32")).toBe(true);
    expect(binaryNamed("C:/tools/Hermes.EXE", "hermes", "win32")).toBe(true);
    expect(binaryNamed("D:\\bin\\pi.bat", "pi", "win32")).toBe(true);
    expect(binaryNamed("C:\\npm\\claude-code.cmd", "claude", "win32")).toBe(
      false,
    );
    expect(binaryNamed("C:\\npm\\claude.ps1", "claude", "win32")).toBe(false);
    expect(binaryNamed("", "claude", "win32")).toBe(false);
  });

  it("drives claudeBackend and resolveProcessKind on the current platform", () => {
    expect(claudeBackend("/usr/bin/claude")).toBe(true);
    expect(resolveProcessKind("", "/usr/bin/pi")).toBe("pi");
    expect(resolveProcessKind("", "/usr/bin/hermes")).toBe("acp");
    if (process.platform === "win32") {
      expect(claudeBackend("C:\\npm\\claude.cmd")).toBe(true);
      expect(resolveProcessKind("", "C:\\npm\\claude.cmd")).toBe("claude-sdk");
    }
  });
});
