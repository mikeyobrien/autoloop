import {
  bulletList,
  decodeEvent,
  heading,
  lineSep,
} from "@mobrienv/autoloop-core";

interface IterationEntry {
  kind: "iteration";
  iteration: string;
  exitCode: string;
  output: string;
}

interface ResumeMarker {
  kind: "resume";
  previousStopReason: string;
  addIterations: string;
}

type ScratchpadEntry = IterationEntry | ResumeMarker;

export function renderRunScratchpadFull(lines: string[]): string {
  const entries = collectScratchpadEntries(lines);
  return renderScratchpadEntries(entries);
}

export function renderRunScratchpadPrompt(lines: string[]): string {
  const entries = collectScratchpadEntries(lines);
  if (entries.length <= 4) return renderScratchpadEntries(entries);
  const compactCount = entries.length - 4;
  const compacted = entries.slice(0, compactCount);
  const recent = entries.slice(compactCount);

  return (
    heading(2, "Earlier iterations (compacted)") +
    "\n\n" +
    bulletList(compacted.map(compactScratchpadItem)) +
    "\n\n" +
    renderScratchpadEntries(recent)
  );
}

function collectScratchpadEntries(lines: string[]): ScratchpadEntry[] {
  const entries: ScratchpadEntry[] = [];
  for (const line of lines) {
    const event = decodeEvent(line);
    if (!event || event.shape !== "fields") continue;
    if (event.topic === "iteration.finish") {
      entries.push({
        kind: "iteration",
        iteration: event.iteration ?? "",
        exitCode: event.fields.exit_code ?? "",
        output: event.fields.output ?? "",
      });
    } else if (event.topic === "loop.resume") {
      entries.push({
        kind: "resume",
        previousStopReason: event.fields.previous_stop_reason ?? "",
        addIterations: event.fields.add_iterations ?? "",
      });
    }
  }
  return entries;
}

function renderScratchpadEntries(entries: ScratchpadEntry[]): string {
  return entries.map(scratchpadEntryText).join("");
}

function scratchpadEntryText(entry: ScratchpadEntry): string {
  if (entry.kind === "resume") {
    return `${resumeMarkerText(entry)}\n\n`;
  }
  return (
    heading(2, `Iteration ${entry.iteration}`) +
    "\n\n" +
    "exit_code=" +
    entry.exitCode +
    "\n\n" +
    entry.output +
    "\n"
  );
}

function resumeMarkerText(entry: ResumeMarker): string {
  const reason = entry.previousStopReason || "unknown";
  const adding = entry.addIterations || "0";
  return `--- resumed (was: ${reason}, adding ${adding} iterations) ---`;
}

function compactScratchpadItem(entry: ScratchpadEntry): string {
  if (entry.kind === "resume") {
    return resumeMarkerText(entry);
  }
  return (
    "Iteration " +
    entry.iteration +
    " exit_code=" +
    entry.exitCode +
    " — " +
    scratchpadEntrySummary(entry)
  );
}

function scratchpadEntrySummary(entry: IterationEntry): string {
  const lines = entry.output.split(lineSep());
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed !== "") {
      return trimmed.length <= 120 ? trimmed : `${trimmed.slice(0, 120)}...`;
    }
  }
  return "(no output)";
}
