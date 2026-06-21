export interface Issue {
  id: string;
  /** Human-facing identifier for display (e.g. "SAU-22" for Linear, "#42" for GitHub). */
  identifier?: string;
  title: string;
  status: string;
  branchName?: string;
  url?: string;
}

export interface CreateIssueInput {
  title: string;
  description?: string;
  labels?: string[];
}

export interface TrackerAdapter {
  listIssues(states: string[]): Promise<Issue[]>;
  createIssue(input: CreateIssueInput): Promise<Issue>;
  transitionIssue(id: string, targetState: string): Promise<void>;
  commentIssue(id: string, body: string): Promise<void>;
  /** Optional: archive a terminal (Done) issue. GitHub omits it (issues are closed). */
  archiveIssue?(id: string): Promise<void>;
}
