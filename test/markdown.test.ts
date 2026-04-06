import { describe, it, expect } from "vitest";
import {
  bold,
  italic,
  code,
  heading,
  codeBlock,
  blockquote,
  section,
  bulletList,
  numberedList,
  table,
} from "../src/markdown.js";

describe("bold", () => {
  it("wraps text in double asterisks", () => {
    expect(bold("hello")).toBe("**hello**");
  });
});

describe("italic", () => {
  it("wraps text in underscores", () => {
    expect(italic("hello")).toBe("_hello_");
  });
});

describe("code", () => {
  it("wraps text in backticks", () => {
    expect(code("hello")).toBe("`hello`");
  });
});

describe("heading", () => {
  it("creates h1 through h5", () => {
    expect(heading(1, "Title")).toBe("# Title");
    expect(heading(2, "Sub")).toBe("## Sub");
    expect(heading(5, "Deep")).toBe("##### Deep");
  });

  it("clamps level to 1-5 range", () => {
    expect(heading(0, "X")).toBe("# X");
    expect(heading(-1, "X")).toBe("# X");
    expect(heading(6, "X")).toBe("##### X");
    expect(heading(10, "X")).toBe("##### X");
  });
});

describe("codeBlock", () => {
  it("wraps text in triple backticks", () => {
    expect(codeBlock("const x = 1")).toBe("```\nconst x = 1\n```");
  });

  it("includes language when specified", () => {
    expect(codeBlock("const x = 1", "ts")).toBe("```ts\nconst x = 1\n```");
  });
});

describe("blockquote", () => {
  it("prefixes each line with >", () => {
    expect(blockquote("line1\nline2")).toBe("> line1\n> line2");
  });

  it("handles single line", () => {
    expect(blockquote("hello")).toBe("> hello");
  });
});

describe("section", () => {
  it("creates heading with body", () => {
    expect(section("Title", "Body text")).toBe("## Title\n\nBody text");
  });

  it("respects custom level", () => {
    expect(section("Title", "Body", 3)).toBe("### Title\n\nBody");
  });
});

describe("bulletList", () => {
  it("creates dash-prefixed items", () => {
    expect(bulletList(["a", "b", "c"])).toBe("- a\n- b\n- c");
  });

  it("returns empty string for empty array", () => {
    expect(bulletList([])).toBe("");
  });
});

describe("numberedList", () => {
  it("creates numbered items", () => {
    expect(numberedList(["a", "b"])).toBe("1. a\n2. b");
  });

  it("returns empty string for empty array", () => {
    expect(numberedList([])).toBe("");
  });
});

describe("table", () => {
  it("renders headers and rows with padding", () => {
    const result = table(["Name", "Age"], [["Alice", "30"], ["Bob", "25"]]);
    const lines = result.split("\n");
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain("Name");
    expect(lines[0]).toContain("Age");
    expect(lines[1]).toMatch(/^[\|\s\-]+$/);
    expect(lines[2]).toContain("Alice");
    expect(lines[3]).toContain("Bob");
  });

  it("handles empty rows", () => {
    const result = table(["H1", "H2"], []);
    const lines = result.split("\n");
    expect(lines).toHaveLength(2);
  });

  it("adjusts column widths to longest cell", () => {
    const result = table(["X"], [["LongerValue"]]);
    const lines = result.split("\n");
    // Header cell should be padded to match "LongerValue" length
    expect(lines[0]).toContain("X ");
    // Separator should have dashes matching LongerValue length
    expect(lines[1]).toContain("-".repeat("LongerValue".length));
  });
});
