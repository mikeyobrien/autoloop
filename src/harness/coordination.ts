import { bulletList, decodeEvent, heading } from "@mobrienv/autoloop-core";

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
    const event = decodeEvent(line);
    if (!event || event.shape !== "payload") continue;
    collectCoordinationEvent(String(event.topic), event.payload, state);
  }

  return renderCoordinationState(state);
}

function collectCoordinationEvent(
  topic: string,
  payload: string,
  state: CoordinationState,
): void {
  switch (topic) {
    case "issue.discovered":
      state.issues.push({
        id: extractKvFromPayload(payload, "id"),
        summary: extractKvFromPayload(payload, "summary"),
        disposition: extractKvFromPayload(payload, "disposition"),
        owner: extractKvFromPayload(payload, "owner"),
      });
      break;
    case "issue.resolved": {
      const id = extractKvFromPayload(payload, "id");
      const resolution = extractKvFromPayload(payload, "resolution");
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
        id: extractKvFromPayload(payload, "id"),
        description: extractKvFromPayload(payload, "description"),
        status: "in-progress",
      });
      break;
    case "slice.verified": {
      const sid = extractKvFromPayload(payload, "id");
      for (const s of state.slices) {
        if (s.id === sid) s.status = "verified";
      }
      break;
    }
    case "slice.committed": {
      const cid = extractKvFromPayload(payload, "id");
      const hash = extractKvFromPayload(payload, "commit_hash");
      state.commits.push({ sliceId: cid, commitHash: hash });
      for (const s of state.slices) {
        if (s.id === cid) s.status = "committed";
      }
      break;
    }
    case "context.archived":
      state.archives.push({
        sourceFile: extractKvFromPayload(payload, "source_file"),
        destFile: extractKvFromPayload(payload, "dest_file"),
        reason: extractKvFromPayload(payload, "reason"),
      });
      break;
  }
}

function extractKvFromPayload(payload: string, key: string): string {
  const marker = `${key}=`;
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
    let text = `[${i.disposition}] ${i.id}: ${i.summary}`;
    if (i.resolution) text += ` — ${i.resolution}`;
    if (i.owner) text += ` (owner: ${i.owner})`;
    return text;
  });
  return `${heading(2, "Issues")}\n${bulletList(items)}\n\n`;
}

function renderSlices(slices: Slice[]): string {
  if (slices.length === 0) return "";
  const items = slices.map((s) => `[${s.status}] ${s.id}: ${s.description}`);
  return `${heading(2, "Slices")}\n${bulletList(items)}\n\n`;
}

function renderCommits(commits: Commit[]): string {
  if (commits.length === 0) return "";
  const items = commits.map((c) => `${c.sliceId} → ${c.commitHash}`);
  return `${heading(2, "Commits")}\n${bulletList(items)}\n\n`;
}

function renderArchives(archives: Archive[]): string {
  if (archives.length === 0) return "";
  const items = archives.map(
    (a) => `${a.sourceFile} → ${a.destFile} (${a.reason})`,
  );
  return `${heading(2, "Archives")}\n${bulletList(items)}\n\n`;
}
