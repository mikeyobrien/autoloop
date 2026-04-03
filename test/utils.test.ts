import { describe, it, expect } from "vitest";
import {
  listContains,
  listText,
  splitCsv,
  joinCsv,
  parseStringList,
  parseStringListLiteralOrScalar,
  lineSep,
  joinLines,
  nonemptyOr,
  shellQuote,
  replaceAll,
  shellWords,
  stripQuotes,
  isQuoted,
  sliceOuter,
  skipLine,
  generateCompactId,
} from "../src/utils.js";

describe("listContains", () => {
  it("returns true when item exists", () => {
    expect(listContains(["a", "b", "c"], "b")).toBe(true);
  });

  it("returns false when item missing", () => {
    expect(listContains(["a", "b"], "z")).toBe(false);
  });

  it("returns false for empty list", () => {
    expect(listContains([], "a")).toBe(false);
  });
});

describe("listText", () => {
  it("joins items with commas", () => {
    expect(listText(["a", "b", "c"])).toBe("a, b, c");
  });

  it("returns '(none)' for empty list", () => {
    expect(listText([])).toBe("(none)");
  });

  it("returns single item as-is", () => {
    expect(listText(["only"])).toBe("only");
  });
});

describe("splitCsv", () => {
  it("splits comma-separated values", () => {
    expect(splitCsv("a,b,c")).toEqual(["a", "b", "c"]);
  });

  it("trims whitespace", () => {
    expect(splitCsv(" a , b , c ")).toEqual(["a", "b", "c"]);
  });

  it("filters empty values", () => {
    expect(splitCsv("a,,b")).toEqual(["a", "b"]);
  });

  it("returns empty for empty string", () => {
    expect(splitCsv("")).toEqual([]);
  });
});

describe("joinCsv", () => {
  it("joins items with commas", () => {
    expect(joinCsv(["a", "b"])).toBe("a,b");
  });

  it("returns empty for empty array", () => {
    expect(joinCsv([])).toBe("");
  });
});

describe("parseStringList", () => {
  it("parses bracket list", () => {
    expect(parseStringList('["a", "b"]')).toEqual(["a", "b"]);
  });

  it("parses CSV without brackets", () => {
    expect(parseStringList("a, b, c")).toEqual(["a", "b", "c"]);
  });
});

describe("parseStringListLiteralOrScalar", () => {
  it("parses bracket list", () => {
    expect(parseStringListLiteralOrScalar('["x", "y"]')).toEqual(["x", "y"]);
  });

  it("returns scalar as single-item list", () => {
    expect(parseStringListLiteralOrScalar('"hello"')).toEqual(["hello"]);
  });

  it("handles unquoted scalar", () => {
    expect(parseStringListLiteralOrScalar("world")).toEqual(["world"]);
  });
});

describe("lineSep / joinLines", () => {
  it("lineSep is newline", () => {
    expect(lineSep()).toBe("\n");
  });

  it("joinLines joins with newline", () => {
    expect(joinLines(["a", "b", "c"])).toBe("a\nb\nc");
  });
});

describe("nonemptyOr", () => {
  it("returns value when nonempty", () => {
    expect(nonemptyOr("hello", "fallback")).toBe("hello");
  });

  it("returns fallback when empty", () => {
    expect(nonemptyOr("", "fallback")).toBe("fallback");
  });
});

describe("shellQuote", () => {
  it("quotes simple text", () => {
    expect(shellQuote("hello")).toBe("'hello'");
  });

  it("escapes single quotes", () => {
    expect(shellQuote("it's")).toBe("'it'\"'\"'s'");
  });
});

describe("replaceAll", () => {
  it("replaces all occurrences", () => {
    expect(replaceAll("aXbXc", "X", "Y")).toBe("aYbYc");
  });

  it("handles no occurrences", () => {
    expect(replaceAll("abc", "X", "Y")).toBe("abc");
  });
});

describe("shellWords", () => {
  it("quotes each word", () => {
    expect(shellWords(["echo", "hello world"])).toBe("'echo' 'hello world'");
  });
});

describe("stripQuotes / isQuoted", () => {
  it("strips surrounding double quotes", () => {
    expect(stripQuotes('"hello"')).toBe("hello");
  });

  it("does not strip unquoted", () => {
    expect(stripQuotes("hello")).toBe("hello");
  });

  it("isQuoted returns true for quoted", () => {
    expect(isQuoted('"x"')).toBe(true);
  });

  it("isQuoted returns false for unquoted", () => {
    expect(isQuoted("x")).toBe(false);
  });
});

describe("sliceOuter", () => {
  it("removes first and last character", () => {
    expect(sliceOuter("[abc]")).toBe("abc");
  });
});

describe("skipLine", () => {
  it("skips empty lines", () => {
    expect(skipLine("")).toBe(true);
  });

  it("skips comment lines", () => {
    expect(skipLine("# comment")).toBe(true);
  });

  it("does not skip content lines", () => {
    expect(skipLine("key = value")).toBe(false);
  });
});

describe("generateCompactId", () => {
  it("starts with prefix", () => {
    const id = generateCompactId("run");
    expect(id.startsWith("run-")).toBe(true);
  });

  it("contains hyphen-separated parts", () => {
    const id = generateCompactId("test");
    const parts = id.split("-");
    expect(parts.length).toBe(3);
  });

  it("generates unique ids", () => {
    const ids = new Set(Array.from({ length: 20 }, () => generateCompactId("x")));
    expect(ids.size).toBe(20);
  });
});
