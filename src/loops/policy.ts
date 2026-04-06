export interface SupervisionPolicy {
  label: string;
  warningAfterMs: number;
  stuckAfterMs: number;
}

const DEFAULT_POLICY: SupervisionPolicy = {
  label: "default",
  warningAfterMs: 5 * 60 * 1000,
  stuckAfterMs: 10 * 60 * 1000,
};

const POLICIES: Record<string, SupervisionPolicy> = {
  autospec: {
    label: "autospec",
    warningAfterMs: 10 * 60 * 1000,
    stuckAfterMs: 20 * 60 * 1000,
  },
  autocode: {
    label: "autocode",
    warningAfterMs: 5 * 60 * 1000,
    stuckAfterMs: 12 * 60 * 1000,
  },
  autosimplify: {
    label: "autosimplify",
    warningAfterMs: 2 * 60 * 1000,
    stuckAfterMs: 6 * 60 * 1000,
  },
  autoqa: {
    label: "autoqa",
    warningAfterMs: 6 * 60 * 1000,
    stuckAfterMs: 15 * 60 * 1000,
  },
  autofix: {
    label: "autofix",
    warningAfterMs: 4 * 60 * 1000,
    stuckAfterMs: 10 * 60 * 1000,
  },
  autopr: {
    label: "autopr",
    warningAfterMs: 3 * 60 * 1000,
    stuckAfterMs: 8 * 60 * 1000,
  },
};

export function policyForPreset(preset: string): SupervisionPolicy {
  return POLICIES[preset] ?? DEFAULT_POLICY;
}
