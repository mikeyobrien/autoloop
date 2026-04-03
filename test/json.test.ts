import { describe, it, expect } from "vitest";
import {
  jsonString,
  jsonBool,
  jsonField,
  jsonFieldRaw,
  encodeJsonValue,
  decodeJsonValue,
  extractField,
  extractTopic,
} from "../src/json.js";

describe("jsonString", () => {
  it("wraps simple text in quotes", () => {
    expect(jsonString("hello")).toBe('"hello"');
  });

  it("escapes double quotes", () => {
    expect(jsonString('say "hi"')).toBe('"say \\u0022hi\\u0022"');
  });

  it("escapes backslashes", () => {
    expect(jsonString("a\\b")).toBe('"a\\u005cb"');
  });

  it("escapes newlines", () => {
    expect(jsonString("line1\nline2")).toBe('"line1\\u000aline2"');
  });

  it("escapes tabs", () => {
    expect(jsonString("a\tb")).toBe('"a\\u0009b"');
  });

  it("escapes carriage returns", () => {
    expect(jsonString("a\rb")).toBe('"a\\u000db"');
  });
});

describe("jsonBool", () => {
  it("returns 'true' for true", () => {
    expect(jsonBool(true)).toBe("true");
  });

  it("returns 'false' for false", () => {
    expect(jsonBool(false)).toBe("false");
  });
});

describe("jsonField", () => {
  it("produces a JSON key-value pair", () => {
    expect(jsonField("name", "alice")).toBe('"name": "alice"');
  });

  it("escapes values", () => {
    expect(jsonField("msg", 'a "b"')).toBe('"msg": "a \\u0022b\\u0022"');
  });
});

describe("jsonFieldRaw", () => {
  it("produces a raw value field", () => {
    expect(jsonFieldRaw("active", "true")).toBe('"active": true');
  });
});

describe("encodeJsonValue / decodeJsonValue roundtrip", () => {
  const cases = [
    "simple text",
    'text with "quotes"',
    "text with \\backslash",
    "line1\nline2\nline3",
    "tab\there",
    "cr\rhere",
    'all: "quotes" and \\back and \nnewline',
  ];

  for (const input of cases) {
    it(`roundtrips: ${JSON.stringify(input)}`, () => {
      expect(decodeJsonValue(encodeJsonValue(input))).toBe(input);
    });
  }
});

describe("extractField", () => {
  const line = '{"run": "run-1", "iteration": "3", "topic": "review.ready", "fields": {"reason": "done"}}';

  it("extracts run", () => {
    expect(extractField(line, "run")).toBe("run-1");
  });

  it("extracts iteration", () => {
    expect(extractField(line, "iteration")).toBe("3");
  });

  it("extracts topic", () => {
    expect(extractField(line, "topic")).toBe("review.ready");
  });

  it("extracts nested field", () => {
    expect(extractField(line, "reason")).toBe("done");
  });

  it("returns empty for missing field", () => {
    expect(extractField(line, "nonexistent")).toBe("");
  });

  it("returns empty for empty line", () => {
    expect(extractField("", "topic")).toBe("");
  });
});

describe("extractTopic", () => {
  it("extracts topic from event line", () => {
    const line = '{"run": "run-1", "topic": "task.complete"}';
    expect(extractTopic(line)).toBe("task.complete");
  });
});
