import { joinCsv, lineSep } from "./utils.js";

export interface MaterializedMemory {
  preferences: string[];
  learnings: string[];
  meta: string[];
}

export interface TwoTierMemoryStats {
  project: MaterializedMemory;
  run: MaterializedMemory;
  combinedRenderedChars: number;
  budgetChars: number;
  truncated: boolean;
}

export function truncateText(
  text: string,
  budgetChars: number,
  memory: MaterializedMemory,
): string {
  if (budgetChars <= 0) return text;
  if (text.length <= budgetChars) return text;
  return truncateOnLineBoundary(text, budgetChars, memory);
}

function truncateOnLineBoundary(
  text: string,
  budgetChars: number,
  memory: MaterializedMemory,
): string {
  const lines = text.split(lineSep());
  const kept: string[] = [];
  let used = 0;
  for (const line of lines) {
    const lineLen = line.length + 1;
    if (used + lineLen > budgetChars) break;
    kept.push(line);
    used += lineLen;
  }
  const keptText = kept.join(lineSep());
  const keptCount = countBulletEntries(kept);
  const totalCount = countBulletEntries(lines);
  const dropped = totalCount - keptCount;
  const droppedDetail = truncationDroppedDetail(keptText, memory);
  return (
    keptText +
    "\n...\n" +
    truncationFooter(dropped, droppedDetail, text.length, budgetChars)
  );
}

function countBulletEntries(lines: string[]): number {
  return lines.filter((l) => l.startsWith("- ")).length;
}

function truncationDroppedDetail(
  keptText: string,
  memory: MaterializedMemory,
): string {
  const totalPrefs = memory.preferences.length;
  const totalLearnings = memory.learnings.length;
  const totalMeta = memory.meta.length;
  const keptPrefs = countCategoryInText(keptText, "Preferences:");
  const keptLearnings = countCategoryInText(keptText, "Learnings:");
  const keptMeta = countCategoryInText(keptText, "Meta:");
  return formatDroppedCounts(
    totalPrefs - keptPrefs,
    totalLearnings - keptLearnings,
    totalMeta - keptMeta,
  );
}

function countCategoryInText(text: string, header: string): number {
  if (!text.includes(header)) return 0;
  const parts = text.split(header);
  if (parts.length < 2) return 0;
  const afterHeader = parts[1];
  const sectionLines = afterHeader.split(lineSep());
  let count = 0;
  for (const line of sectionLines) {
    if (line.startsWith("- ")) count++;
    else if (line.trim() !== "") break;
  }
  return count;
}

function formatDroppedCounts(
  prefs: number,
  learnings: number,
  meta: number,
): string {
  if (prefs === 0 && learnings === 0 && meta === 0) return "";
  const parts: string[] = [];
  if (prefs > 0) parts.push(`${prefs} preferences`);
  if (learnings > 0) parts.push(`${learnings} learnings`);
  if (meta > 0) parts.push(`${meta} meta`);
  return ` (${joinCsv(parts)} truncated)`;
}

function truncationFooter(
  droppedEntries: number,
  droppedDetail: string,
  renderedChars: number,
  budgetChars: number,
): string {
  return (
    "(memory truncated: " +
    droppedEntries +
    " entries dropped" +
    droppedDetail +
    " — " +
    renderedChars +
    "/" +
    budgetChars +
    " chars)"
  );
}
