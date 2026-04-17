import type { RunRecord } from "../registry/types.js";
import { CAPABILITY_VERBS } from "./capabilities.js";
import type {
  ControlCapabilities,
  ControlRequest,
  ControlStatus,
} from "./types.js";

export interface ControlSnapshot {
  run: RunRecord;
  capabilities: ControlCapabilities | null;
  pendingRequests: ControlRequest[];
  recentStatuses: ControlStatus[];
}

export function renderShow(snap: ControlSnapshot): string {
  const lines: string[] = [];
  lines.push(`Run:         ${snap.run.run_id}`);
  lines.push(`Status:      ${snap.run.status}`);
  lines.push(`Preset:      ${snap.run.preset}`);
  lines.push(`Backend:     ${snap.run.backend || "(unknown)"}`);
  lines.push(`Iteration:   ${snap.run.iteration}`);
  if (snap.run.stop_reason) lines.push(`Stop:        ${snap.run.stop_reason}`);
  if (snap.run.pid) lines.push(`PID:         ${snap.run.pid}`);
  lines.push("");
  lines.push(renderCapabilities(snap.capabilities));
  lines.push("");
  lines.push("Recent control activity:");
  if (snap.recentStatuses.length === 0 && snap.pendingRequests.length === 0) {
    lines.push("  (none)");
  } else {
    for (const r of snap.pendingRequests) {
      lines.push(`  pending  ${r.verb.padEnd(10)} ${r.id}  ${r.reason || ""}`);
    }
    for (const s of snap.recentStatuses.slice(-5)) {
      const detail = s.detail ? ` — ${s.detail}` : "";
      lines.push(
        `  ${s.state.padEnd(8)} ${s.verb.padEnd(10)} ${s.id}${detail}`,
      );
    }
  }
  return lines.join("\n");
}

export function renderCapabilities(caps: ControlCapabilities | null): string {
  if (!caps) {
    return "Capabilities: (none published yet — run may not be live)";
  }
  const lines: string[] = [];
  lines.push(`Capabilities (backend: ${caps.backend}):`);
  for (const verb of CAPABILITY_VERBS) {
    const cap = caps[verb];
    const mark = cap.supported ? "yes" : "no ";
    const detail = cap.detail ? ` — ${cap.detail}` : "";
    lines.push(`  ${verb.padEnd(10)} ${mark}${detail}`);
  }
  if (caps.extras) {
    for (const [name, cap] of Object.entries(caps.extras)) {
      const mark = cap.supported ? "yes" : "no ";
      const detail = cap.detail ? ` — ${cap.detail}` : "";
      lines.push(`  ${name.padEnd(10)} ${mark}${detail}`);
    }
  }
  lines.push(`  published  ${caps.publishedAt}`);
  return lines.join("\n");
}
