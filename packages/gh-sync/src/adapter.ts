import { spawnSync } from "node:child_process";
import type {
  CreateIssueInput,
  Issue,
  TrackerAdapter,
} from "@mobrienv/autoloop-issue-sync-core";

export interface GhSyncConfig {
  repo: string;
  queuedLabel?: string;
}

interface GhIssue {
  number: number;
  title: string;
  state: string;
  labels: Array<{ name: string }>;
  headRefName?: string;
}

function gh(args: string[], cwd?: string): { stdout: string; ok: boolean } {
  const result = spawnSync("gh", args, {
    encoding: "utf-8",
    cwd: cwd ?? process.cwd(),
    shell: false,
  });
  return {
    stdout: result.stdout?.trim() ?? "",
    ok: result.status === 0 && !result.error,
  };
}

function issueState(labels: string[]): string {
  if (labels.includes("status:released")) return "Done";
  if (labels.includes("status:merged")) return "In Review";
  if (labels.includes("status:in-progress")) return "In Progress";
  if (labels.includes("autoloop:queued")) return "Todo";
  return "open";
}

export class GhAdapter implements TrackerAdapter {
  constructor(private config: GhSyncConfig) {}

  async listIssues(states: string[]): Promise<Issue[]> {
    const labelFilters: string[] = [];
    for (const state of states) {
      if (state === "open" || state === "Todo") {
        labelFilters.push(this.config.queuedLabel ?? "autoloop:queued");
        break;
      }
    }

    const args = [
      "issue",
      "list",
      "--repo",
      this.config.repo,
      "--state",
      "open",
      "--json",
      "number,title,state,labels",
    ];
    if (labelFilters.length > 0) {
      args.push("--label", labelFilters[0]);
    }

    const { stdout, ok } = gh(args);
    if (!ok || !stdout) return [];

    let parsed: GhIssue[];
    try {
      parsed = JSON.parse(stdout) as GhIssue[];
    } catch {
      return [];
    }

    return parsed.map((i) => ({
      id: String(i.number),
      identifier: `#${i.number}`,
      title: i.title,
      status: issueState(i.labels.map((l) => l.name)),
    }));
  }

  async createIssue(input: CreateIssueInput): Promise<Issue> {
    const args = [
      "issue",
      "create",
      "--repo",
      this.config.repo,
      "--title",
      input.title,
      "--body",
      input.description ?? "",
    ];
    if (input.labels && input.labels.length > 0) {
      args.push("--label", input.labels.join(","));
    }

    const { stdout, ok } = gh(args);
    if (!ok) throw new Error(`gh issue create failed: ${stdout}`);

    const match = stdout.match(/\/issues\/(\d+)/);
    const id = match ? match[1] : "0";
    return {
      id,
      identifier: `#${id}`,
      title: input.title,
      status: "Todo",
      url: stdout.trim(),
    };
  }

  async transitionIssue(id: string, targetState: string): Promise<void> {
    const labelMap: Record<string, string[]> = {
      "In Progress": ["status:in-progress"],
      "In Review": ["status:merged"],
      Done: ["status:released"],
    };

    const labelsToAdd = labelMap[targetState] ?? [];

    if (targetState === "Done") {
      gh(["issue", "close", "--repo", this.config.repo, id]);
    }

    for (const label of labelsToAdd) {
      gh([
        "issue",
        "edit",
        "--repo",
        this.config.repo,
        id,
        "--add-label",
        label,
      ]);
    }
  }

  async commentIssue(id: string, body: string): Promise<void> {
    gh(["issue", "comment", "--repo", this.config.repo, id, "--body", body]);
  }
}
