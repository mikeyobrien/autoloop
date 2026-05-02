import type { Task } from "../task_store.js";
import {
  escapeHtml,
  relTime,
  resolveColumn,
  STATE_GLYPH,
  STATE_LABEL,
} from "./_shared.js";

export interface PreviewEvent {
  kind: "user" | "assistant" | "tool_call" | "tool_result";
  icon: string;
  label: string;
  text: string;
}

// TODO(autoloop-journal): wire to autoloop run journal (.autoloop/runs/<runId>/…)
//   once a preview event schema is agreed. For now the card preview is the CSS
//   placeholder text ("no session yet / starting… / running…") — an empty
//   array from readPreview keeps card-head HTML stable.
export function readPreview(
  _sessionPath: string,
  _limit?: number,
): PreviewEvent[] {
  return [];
}

export function renderPreviewHtml(events: PreviewEvent[]): string {
  if (!events.length) return "";
  return events
    .map(
      (e) =>
        `<div class="ev ev-${e.kind}"><span class="evi">${escapeHtml(e.icon)}</span> <span class="evl">${escapeHtml(e.label)}</span> <span class="evt">${escapeHtml(e.text)}</span></div>`,
    )
    .join("");
}

export function agentState(task: Task): string {
  if (!task.autoloop) {
    return `<span class="state state-none" data-state="none" title="no run yet">·</span>`;
  }
  const { state, last_active } = task.autoloop;
  const glyph = STATE_GLYPH[state] ?? "○";
  const label = STATE_LABEL[state] ?? state;
  const rt = relTime(last_active);
  return `<span class="state state-${state}" data-state="${state}" data-since="${escapeHtml(last_active ?? "")}" title="${label}${rt ? ` · ${rt} ago` : ""}">${glyph}<span class="state-rt">${rt}</span></span>`;
}

export function renderCard(
  t: Task,
  scopeIsGit: (scope: string) => boolean,
): string {
  const preview = t.autoloop?.run_id ? renderPreviewHtml(readPreview("")) : "";
  const prio = Math.max(1, Math.min(5, t.priority || 3));
  const agentState_s = t.autoloop?.state ?? "none";
  const searchText = `${t.title} ${t.description ?? ""}`.toLowerCase();
  const commentHtml = t.comment?.text
    ? `<div class="comment" title="${escapeHtml(t.comment.text)}">${escapeHtml(t.comment.text)}</div>`
    : "";
  const col = resolveColumn(t);
  const canToggleWt =
    col === "backlog" &&
    !t.autoloop?.workspace &&
    Boolean(t.scope) &&
    scopeIsGit(t.scope);
  const wtOn = t.worktree_opt_in === true;
  const wtChip = canToggleWt
    ? `<span class="card-wt" data-on="${wtOn ? "true" : "false"}" title="Worktree opt-in — click to toggle">wt</span>`
    : "";
  return `<div class="card" data-id="${escapeHtml(t.id)}" data-prio="${prio}" data-state="${escapeHtml(agentState_s)}" data-search="${escapeHtml(searchText)}" draggable="true">
  <div class="card-head">
    <span class="prio prio-${prio}" title="P${prio}">P${prio}</span>
    <span class="title" title="Double-click to rename">${escapeHtml(t.title)}</span>
    ${agentState(t)}
    ${wtChip}
    <button class="card-play" type="button" draggable="false" title="Start agent (no pane)" aria-label="Start agent">▶</button>
    <button class="card-open" type="button" draggable="false" title="Open terminal" aria-label="Open terminal">&gt;_</button>
    <button class="card-archive" type="button" draggable="false" title="Archive (move to archive, remove from board)" aria-label="Archive">↓</button>
  </div>
  ${t.description ? `<div class="desc">${escapeHtml(t.description)}</div>` : ""}
  ${commentHtml}
  <div class="preview">${preview || '<div class="preview-empty"></div>'}</div>
</div>`;
}
