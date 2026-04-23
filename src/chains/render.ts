import * as config from "@mobrienv/autoloop-core/config";
import {
  extractField,
  extractTopic,
  readLines,
} from "@mobrienv/autoloop-core/journal";

export function renderChainState(projectDir: string): string {
  const journalFile = config.resolveJournalFile(projectDir);
  const lines = readLines(journalFile);
  return renderChainLines(lines);
}

export function renderChainLines(lines: string[]): string {
  const entries: Array<{ topic: string; line: string }> = [];
  for (const line of lines) {
    const topic = extractTopic(line);
    if (isChainTopic(topic)) {
      entries.push({ topic, line });
    }
  }
  if (entries.length === 0) return "(no chain runs found)";
  let result = "# Chain State\n\n";
  for (const entry of entries) {
    result += renderChainEntry(entry.topic, entry.line);
  }
  return result;
}

function isChainTopic(topic: string): boolean {
  return [
    "chain.start",
    "chain.step.start",
    "chain.step.finish",
    "chain.complete",
    "chain.spawn",
  ].includes(topic);
}

function renderChainEntry(topic: string, line: string): string {
  switch (topic) {
    case "chain.start":
      return (
        "## Chain: " +
        extractField(line, "name") +
        "\n" +
        "Steps: " +
        extractField(line, "steps") +
        "\n\n"
      );
    case "chain.step.start":
      return (
        "- Step " +
        extractField(line, "step") +
        " (" +
        extractField(line, "preset") +
        ") started\n"
      );
    case "chain.step.finish":
      return (
        "- Step " +
        extractField(line, "step") +
        " (" +
        extractField(line, "preset") +
        ") finished: " +
        extractField(line, "stop_reason") +
        "\n"
      );
    case "chain.complete":
      return (
        "\nOutcome: " +
        extractField(line, "outcome") +
        " (" +
        extractField(line, "steps_completed") +
        " steps completed)\n\n"
      );
    case "chain.spawn":
      return (
        "- Spawned: " +
        extractField(line, "chain_id") +
        " (parent: " +
        extractField(line, "parent_id") +
        ", steps: " +
        extractField(line, "steps") +
        ")\n"
      );
    default:
      return "";
  }
}
