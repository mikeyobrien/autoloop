import { afterEach, describe, expect, it } from "vitest";
import {
  formatToolFailure,
  formatToolStart,
  summarizeToolArgs,
  toolLineWidth,
  toolResultText,
} from "../src/tool-line.js";

describe("summarizeToolArgs", () => {
  it("returns empty for absent args and stringifies primitives", () => {
    expect(summarizeToolArgs("bash", undefined)).toBe("");
    expect(summarizeToolArgs("bash", null)).toBe("");
    expect(summarizeToolArgs("bash", "ls")).toBe("ls");
    expect(summarizeToolArgs("x", 3)).toBe("3");
  });

  it("uses command for shell tools, case-insensitively", () => {
    expect(summarizeToolArgs("Bash", { timeout: 5, command: "rg foo" })).toBe(
      "rg foo",
    );
    expect(summarizeToolArgs("shell", { command: "ls" })).toBe("ls");
    expect(summarizeToolArgs("EXEC", { command: "pwd" })).toBe("pwd");
  });

  it("uses path or file_path for file tools", () => {
    expect(summarizeToolArgs("read", { offset: 1, path: "a.ts" })).toBe("a.ts");
    expect(
      summarizeToolArgs("Write", { content: "body", file_path: "b.md" }),
    ).toBe("b.md");
    expect(summarizeToolArgs("edit", { edits: [], path: "c.ts" })).toBe("c.ts");
  });

  it("uses pattern plus path for search tools", () => {
    expect(summarizeToolArgs("grep", { pattern: "TODO", path: "src" })).toBe(
      "TODO in src",
    );
    expect(summarizeToolArgs("Glob", { pattern: "**/*.ts" })).toBe("**/*.ts");
    expect(summarizeToolArgs("ls", { path: "packages" })).toBe("packages");
    expect(summarizeToolArgs("find", { limit: 5 })).toBe('{"limit":5}');
  });

  it("falls back to the first string arg, then compact JSON", () => {
    expect(summarizeToolArgs("web", { n: 2, query: "vitest" })).toBe("vitest");
    expect(summarizeToolArgs("bash", { cmd: ["ls"] })).toBe('{"cmd":["ls"]}');
    expect(summarizeToolArgs("read", {})).toBe("");
  });
});

describe("formatToolStart", () => {
  it("prints an arrow line with args collapsed to one line", () => {
    expect(
      formatToolStart("bash", { command: "cd x &&\n  npm   test" }, 120),
    ).toBe("→ bash  cd x && npm test\n");
    expect(formatToolStart("todo", undefined, 120)).toBe("→ todo\n");
  });

  it("truncates to the width with an ellipsis", () => {
    const line = formatToolStart("bash", { command: "x".repeat(50) }, 20);
    expect(line).toBe(`→ bash  ${"x".repeat(11)}…\n`);
    expect(Array.from(line.trimEnd())).toHaveLength(20);
    expect(formatToolStart("bash", { command: "ls" }, 0)).toBe("…\n");
  });
});

describe("formatToolFailure", () => {
  it("shows args and the first non-empty line of the reason", () => {
    expect(
      formatToolFailure(
        "write",
        { path: ".autoloop/how.md" },
        "\n\n  EISDIR: illegal operation\n  at foo",
        120,
      ),
    ).toBe("✗ write  .autoloop/how.md — EISDIR: illegal operation\n");
  });

  it("appends the next line when the first is only a heading", () => {
    expect(
      formatToolFailure(
        "write",
        { path: "context.md" },
        'Validation failed for tool "write":\n  - reasoning: must have required properties reasoning\n\nReceived arguments:\n{',
        120,
      ),
    ).toBe(
      '✗ write  context.md — Validation failed for tool "write": - reasoning: must have required properties reasoning\n',
    );
    expect(formatToolFailure("write", undefined, "Error:", 120)).toBe(
      "✗ write  Error:\n",
    );
  });

  it("omits missing parts", () => {
    expect(formatToolFailure("write", undefined, "nope", 120)).toBe(
      "✗ write  nope\n",
    );
    expect(formatToolFailure("write", { path: "a" }, "  \n", 120)).toBe(
      "✗ write  a\n",
    );
    expect(formatToolFailure("write", undefined, "", 120)).toBe("✗ write\n");
  });
});

describe("toolResultText", () => {
  it("reads strings, content strings, and text parts", () => {
    expect(toolResultText("\nfirst\nsecond")).toBe("first");
    expect(toolResultText({ content: "inner\nmore" })).toBe("inner");
    expect(
      toolResultText({
        content: [
          { type: "image" },
          null,
          { type: "text", text: "  \n" },
          { type: "text", text: "real reason" },
        ],
      }),
    ).toBe("real reason");
    expect(toolResultText([{ type: "text", text: "array form" }])).toBe(
      "array form",
    );
  });

  it("returns empty when there is no text", () => {
    expect(toolResultText(undefined)).toBe("");
    expect(toolResultText(null)).toBe("");
    expect(toolResultText({ details: 1 })).toBe("");
    expect(toolResultText({ content: [{ type: "text", text: "" }] })).toBe("");
  });
});

describe("toolLineWidth", () => {
  const original = Object.getOwnPropertyDescriptor(process.stderr, "columns");
  afterEach(() => {
    if (original) Object.defineProperty(process.stderr, "columns", original);
    else delete (process.stderr as { columns?: number }).columns;
  });

  it("uses stderr columns when available, else 120", () => {
    Object.defineProperty(process.stderr, "columns", {
      value: 80,
      configurable: true,
    });
    expect(toolLineWidth()).toBe(80);
    Object.defineProperty(process.stderr, "columns", {
      value: undefined,
      configurable: true,
    });
    expect(toolLineWidth()).toBe(120);
    Object.defineProperty(process.stderr, "columns", {
      value: 0,
      configurable: true,
    });
    expect(toolLineWidth()).toBe(120);
  });
});

describe("wide characters", () => {
  it("keeps lines within the terminal width in cells", async () => {
    const { displayWidth } = await import(
      "@mobrienv/autoloop-core/terminal-width"
    );
    const line = formatToolStart("bash", { command: "界".repeat(30) }, 40);
    expect(line.endsWith("…\n")).toBe(true);
    expect(displayWidth(line.trimEnd())).toBeLessThanOrEqual(40);
  });
});
