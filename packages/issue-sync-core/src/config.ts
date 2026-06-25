export interface IssueSyncConfig {
  tracker: "linear" | "github";
  linear?: {
    project?: string;
    team?: string;
    repoLabel?: string;
    pullStates?: string[];
    reviewState?: string;
    doneState?: string;
  };
  github?: {
    repo?: string;
    queuedLabel?: string;
  };
}

export function defaultConfig(tracker: "linear" | "github"): IssueSyncConfig {
  if (tracker === "linear") {
    return {
      tracker: "linear",
      linear: {
        pullStates: ["Todo"],
        reviewState: "In Review",
        doneState: "Done",
      },
    };
  }
  return {
    tracker: "github",
    github: {
      queuedLabel: "autoloop:queued",
    },
  };
}
