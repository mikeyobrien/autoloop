import { replaceAll, shellQuote, lineSep } from "./utils.js";
import { decodeEvent } from "./events/decode.js";

export function jsonString(text: string): string {
  return '"' + encodeJsonValue(text) + '"';
}

export function jsonBool(value: boolean): string {
  return value ? "true" : "false";
}

export function jsonField(key: string, value: string): string {
  return '"' + key + '": ' + jsonString(value);
}

export function jsonFieldRaw(key: string, rawValue: string): string {
  return '"' + key + '": ' + rawValue;
}

export function extractTopic(line: string): string {
  const decoded = decodeEvent(line);
  if (decoded) return String(decoded.topic);
  return extractField(line, "topic");
}

export function extractField(line: string, key: string): string {
  const decoded = decodeEvent(line);
  if (decoded) {
    if (key === "run") return decoded.run;
    if (key === "iteration") return decoded.iteration ?? "";
    if (key === "topic") return String(decoded.topic);
    if (decoded.shape === "payload") {
      if (key === "payload") return decoded.payload;
      if (key === "source") return decoded.source ?? "";
      return "";
    }
    return decoded.fields[key] ?? "";
  }
  const marker = '"' + key + '": ';
  return decodeJsonValue(firstQuotedValue(firstAfterMarker(line.split(marker))));
}

export function encodeJsonValue(text: string): string {
  let escaped = replaceAll(text, "\\", "\\u005c");
  escaped = replaceAll(escaped, '"', "\\u0022");
  escaped = replaceAll(escaped, lineSep(), "\\u000a");
  escaped = replaceAll(escaped, "\r", "\\u000d");
  escaped = replaceAll(escaped, "\t", "\\u0009");
  return escapeRemainingControlChars(escaped);
}

function escapeRemainingControlChars(text: string): string {
  // Replace control chars \x00-\x08, \x0b, \x0c, \x0e-\x1f
  return text.replace(
    // eslint-disable-next-line no-control-regex
    /[\x00-\x08\x0b\x0c\x0e-\x1f]/g,
    (ch) => "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0"),
  );
}

export function decodeJsonValue(text: string): string {
  let restored = replaceAll(text, "\\u000a", lineSep());
  restored = replaceAll(restored, "\\u000d", "\r");
  restored = replaceAll(restored, "\\u0009", "\t");
  restored = replaceAll(restored, "\\u0022", '"');
  restored = replaceAll(restored, "\\u005c", "\\");
  return restored;
}

function firstAfterMarker(parts: string[]): string {
  if (parts.length <= 1) return "";
  return parts[1];
}

function firstQuotedValue(text: string): string {
  return firstQuotedValueParts(text.split('"'));
}

function firstQuotedValueParts(parts: string[]): string {
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] === "") {
      return i + 1 < parts.length ? parts[i + 1] : "";
    }
  }
  return "";
}
