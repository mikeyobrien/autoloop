import { LinearClient } from "@linear/sdk";
import type {
  CreateIssueInput,
  Issue,
  TrackerAdapter,
} from "@mobrienv/autoloop-issue-sync-core";

export interface LinearSyncConfig {
  apiKey: string;
  teamKey?: string;
  projectName?: string;
  repoLabel?: string;
}

function resolveApiKey(config: LinearSyncConfig): string {
  return config.apiKey || process.env.LINEAR_API_KEY || "";
}

export class LinearAdapter implements TrackerAdapter {
  private client: LinearClient;

  constructor(private config: LinearSyncConfig) {
    const key = resolveApiKey(config);
    if (!key) {
      throw new Error(
        "LINEAR_API_KEY env var or apiKey config is required for autoloop-linear-sync",
      );
    }
    this.client = new LinearClient({ apiKey: key });
  }

  async listIssues(states: string[]): Promise<Issue[]> {
    const filter: Record<string, unknown> = {
      state: { name: { in: states } },
    };

    if (this.config.repoLabel) {
      filter.labels = { name: { eq: this.config.repoLabel } };
    }
    if (this.config.projectName) {
      filter.project = { name: { eq: this.config.projectName } };
    }

    const result = await this.client.issues({ filter });
    return Promise.all(
      (result.nodes ?? []).map(async (i) => ({
        id: i.id,
        identifier: i.identifier,
        title: i.title,
        // `state` is a lazy LinearFetch<WorkflowState> relation — await it.
        status: (await i.state)?.name ?? "Unknown",
        branchName: i.branchName ?? undefined,
        url: i.url ?? undefined,
      })),
    );
  }

  async createIssue(input: CreateIssueInput): Promise<Issue> {
    const teamIssues = await this.client.teams();
    const team = this.config.teamKey
      ? teamIssues.nodes.find((t) => t.key === this.config.teamKey)
      : teamIssues.nodes[0];

    if (!team) {
      throw new Error("No Linear team found — set teamKey in config");
    }

    const labelIds: string[] = [];
    if (input.labels && input.labels.length > 0) {
      const allLabels = await this.client.issueLabels({
        filter: { name: { in: input.labels } },
      });
      for (const l of allLabels.nodes) {
        labelIds.push(l.id);
      }
    }

    const payload = await this.client.createIssue({
      teamId: team.id,
      title: input.title,
      description: input.description,
      labelIds: labelIds.length > 0 ? labelIds : undefined,
    });

    const created = await payload.issue;
    if (!created) throw new Error("Linear createIssue returned no issue");
    return {
      id: created.id,
      identifier: created.identifier,
      title: created.title,
      status: (await created.state)?.name ?? "Todo",
      branchName: created.branchName ?? undefined,
      url: created.url ?? undefined,
    };
  }

  async transitionIssue(id: string, targetState: string): Promise<void> {
    const issue = await this.client.issue(id);
    const team = await issue.team;
    if (!team) throw new Error(`Issue ${id} has no team`);

    const states = await this.client.workflowStates({
      filter: {
        team: { id: { eq: team.id } },
        name: { eq: targetState },
      },
    });
    const state = states.nodes[0];
    if (!state) {
      throw new Error(`State "${targetState}" not found in team ${team.name}`);
    }

    await this.client.updateIssue(id, { stateId: state.id });
  }

  async commentIssue(id: string, body: string): Promise<void> {
    await this.client.createComment({ issueId: id, body });
  }

  async archiveIssue(id: string): Promise<void> {
    await this.client.archiveIssue(id);
  }
}
