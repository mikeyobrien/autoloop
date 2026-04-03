import { extractTopic, extractField } from "./journal.js";
import { heading, bulletList } from "../markdown.js";

interface Issue {
  id: string;
  summary: string;
  disposition: string;
  owner: string;
  resolution?: string;
}

interface Slice {
  id: string;
  description: string;
  status: string;
}

interface Commit {
  sliceId: string;
  commitHash: string;
}

interface Archive {
  sourceFile: string;
  destFile: string;
  reason: string;
}

interface CoordinationState {
  issues: Issue[];
  slices: Slice[];
  commits: Commit[];
  archives: Archive[];
}

export function coordinationFromLines(lines: string[]): string {
  const state: CoordinationState = {
    issues: [],
    slices: [],
    commits: [],
    archives: [],
  };

  for (const line of lines) {
    const topic = extractTopic(line);
    collectCoordinationEvent(topic, line, state);
  }

  return renderCoordinationState(state);
}

function collectCoordinationEvent(
  topic: string,
  line: string,
  state: CoordinationState,
): void {
  switch (topic) {
    case "issue.discovered":
      state.issues.push({
        id: extractPayloadField(line, "id"),
        summary: extractPayloadField(line, "summary"),
        disposition: extractPayloadField(line, "disposition"),
        owner: extractPayloadField(line, "owner"),
      });
      break;
    case "issue.resolved": {
      const id = extractPayloadField(line, "id");
      const resolution = extractPayloadField(line, "resolution");
      for (const issue of state.issues) {
        if (issue.id === id) {
          issue.disposition = "resolved";
          issue.resolution = resolution;
        }
      }
      break;
    }
    case "slice.started":
      state.slices.push({
        id: extractPayloadField(line, "id"),
        description: extractPayloadField(line, "description"),
        status: "in-progress",
      });
      break;
    case "slice.verified": {
      const sid = extractPayloadField(line, "id");
      for (const s of state.slices) {
        if (s.id === sid) s.status = "verified";
      }
      break;
    }
    case "slice.committed": {
      const cid = extractPayloadField(line, "id");
      const hash = extractPayloadField(line, "commit_hash");
      state.commits.push({ sliceId: cid, commitHash: hash });
      for (const s of state.slices) {
        if (s.id === cid) s.status = "committed";
      }
      break;
    }
    case "context.archived":
      state.archives.push({
        sourceFile: extractPayloadField(line, "source_file"),
        destFile: extractPayloadField(line, "dest_file"),
        reason: extractPayloadField(line, "reason"),
      });
      break;
  }
}

function extractPayloadField(line: string, key: string): string {
  const payload = extractField(line, "payload");
  return extractKvFromPayload(payload, key);
}

function extractKvFromPayload(payload: string, key: string): string {
  const marker = key + "=";
  const parts = payload.split(marker);
  if (parts.length <= 1) return "";
  const rest = parts[1];
  const delimited = rest.split(";");
  return (delimited[0] ?? "").trim();
}

function renderCoordinationState(state: CoordinationState): string {
  if (
    state.issues.length === 0 &&
    state.slices.length === 0 &&
    state.commits.length === 0 &&
    state.archives.length === 0
  ) {
    return "";
  }

  return (
    heading(1, "Coordination State (from journal)") +
    "\n\n" +
    renderIssues(state.issues) +
    renderSlices(state.slices) +
    renderCommits(state.commits) +
    renderArchives(state.archives)
  );
}

function renderIssues(issues: Issue[]): string {
  if (issues.length === 0) return "";
  const items = issues.map((i) => {
    let text =
      "[" + i.disposition + "] " + i.id + ": " + i.summary;
    if (i.resolution) text += " — " + i.resolution;
    if (i.owner) text += " (owner: " + i.owner + ")";
    return text;
  });
  return heading(2, "Issues") + "\n" + bulletList(items) + "\n\n";
}

function renderSlices(slices: Slice[]): string {
  if (slices.length === 0) return "";
  const items = slices.map(
    (s) => "[" + s.status + "] " + s.id + ": " + s.description,
  );
  return heading(2, "Slices") + "\n" + bulletList(items) + "\n\n";
}

function renderCommits(commits: Commit[]): string {
  if (commits.length === 0) return "";
  const items = commits.map(
    (c) => c.sliceId + " → " + c.commitHash,
  );
  return heading(2, "Commits") + "\n" + bulletList(items) + "\n\n";
}

function renderArchives(archives: Archive[]): string {
  if (archives.length === 0) return "";
  const items = archives.map(
    (a) =>
      a.sourceFile + " → " + a.destFile + " (" + a.reason + ")",
  );
  return heading(2, "Archives") + "\n" + bulletList(items) + "\n\n";
}
