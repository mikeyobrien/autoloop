export function bold(text: string): string {
  return "**" + text + "**";
}

export function italic(text: string): string {
  return "_" + text + "_";
}

export function code(text: string): string {
  return "`" + text + "`";
}

export function heading(level: number, text: string): string {
  const prefix = "#".repeat(Math.min(Math.max(level, 1), 5));
  return prefix + " " + text;
}

export function codeBlock(text: string, lang = ""): string {
  return "```" + lang + "\n" + text + "\n```";
}

export function blockquote(text: string): string {
  return prefixLines(text, "> ");
}

export function section(title: string, body: string, level = 2): string {
  return heading(level, title) + "\n\n" + body;
}

export function bulletList(items: string[]): string {
  if (items.length === 0) return "";
  return items.map((item) => "- " + item).join("\n");
}

export function numberedList(items: string[]): string {
  if (items.length === 0) return "";
  return items.map((item, i) => (i + 1) + ". " + item).join("\n");
}

export function table(headers: string[], rows: string[][]): string {
  const widths = columnWidths(headers, rows);
  const headerRow = tableRow(headers, widths);
  const separator = separatorRow(widths);
  const body = rows.map((row) => tableRow(row, widths)).join("\n");
  return headerRow + "\n" + separator + (rows.length > 0 ? "\n" + body : "");
}

function tableRow(cells: string[], widths: number[]): string {
  const padded = cells.map((cell, i) =>
    padCell(cell, widths[i] ?? cell.length),
  );
  return "| " + padded.join(" | ") + " |";
}

function padCell(cell: string, width: number): string {
  return cell.padEnd(width);
}

function separatorRow(widths: number[]): string {
  const dashes = widths.map((w) => "-".repeat(w));
  return "| " + dashes.join(" | ") + " |";
}

function columnWidths(headers: string[], rows: string[][]): number[] {
  const widths = headers.map((h) => h.length);
  for (const row of rows) {
    for (let i = 0; i < row.length && i < widths.length; i++) {
      widths[i] = Math.max(widths[i], row[i].length);
    }
  }
  return widths;
}

function prefixLines(text: string, prefix: string): string {
  return text
    .split("\n")
    .map((line) => prefix + line)
    .join("\n");
}
