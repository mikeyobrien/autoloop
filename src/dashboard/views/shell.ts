export function htmlShell(projectName?: string): string {
  const displayName = projectName || "autoloop";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>autoloop / ${displayName}</title>
<style>
:root {
  --bg: #fff; --fg: #1a1a1a; --muted: #666; --border: #e0e0e0;
  --card-bg: #fafafa; --badge-bg: #eee;
  --active: #2563eb; --watching: #d97706; --stuck: #dc2626;
  --failed: #dc2626; --completed: #16a34a;
  --cat-loop: #06b6d4; --cat-iteration: #d97706; --cat-backend: #666;
  --cat-review: #c026d3; --cat-coordination: #2563eb; --cat-error: #dc2626;
  --cat-operator: #ef4444; --cat-completion: #16a34a;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #111; --fg: #e0e0e0; --muted: #999; --border: #333;
    --card-bg: #1a1a1a; --badge-bg: #2a2a2a;
  }
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: system-ui, -apple-system, sans-serif; background: var(--bg); color: var(--fg); max-width: 900px; margin: 0 auto; padding: 1rem; }
h1 { font-size: 1.25rem; font-weight: 600; }
header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 1rem; border-bottom: 1px solid var(--border); padding-bottom: 0.5rem; }
header .updated { font-size: 0.75rem; color: var(--muted); font-family: monospace; }

.chatbox { background: var(--card-bg); border: 1px solid var(--border); border-radius: 6px; padding: 0.75rem; margin-bottom: 1rem; display: flex; gap: 0.5rem; align-items: flex-end; }
.chatbox select { padding: 0.4rem; border: 1px solid var(--border); border-radius: 4px; background: var(--bg); color: var(--fg); font-size: 0.8rem; }
.chatbox textarea { flex: 1; resize: vertical; min-height: 2.5rem; max-height: 8rem; padding: 0.4rem; border: 1px solid var(--border); border-radius: 4px; font-family: inherit; font-size: 0.85rem; background: var(--bg); color: var(--fg); }
.chatbox button { padding: 0.4rem 1rem; border: none; border-radius: 4px; background: var(--active); color: #fff; cursor: pointer; font-size: 0.85rem; white-space: nowrap; }
.chatbox button:hover { opacity: 0.9; }

.section summary { cursor: pointer; font-weight: 600; font-size: 0.9rem; padding: 0.4rem 0; list-style: none; }
.section summary::-webkit-details-marker { display: none; }
.section summary::before { content: "\\25b6 "; font-size: 0.7rem; }
.section[open] summary::before { content: "\\25bc "; }
.badge { display: inline-block; font-size: 0.7rem; padding: 0.1rem 0.4rem; border-radius: 8px; background: var(--badge-bg); margin-left: 0.3rem; font-weight: normal; }
.badge[data-status="active"] { background: var(--active); color: #fff; }
.badge[data-status="watching"] { background: var(--watching); color: #fff; }
.badge[data-status="stuck"] { background: var(--stuck); color: #fff; }
.badge[data-status="failed"] { background: var(--failed); color: #fff; }
.badge[data-status="completed"] { background: var(--completed); color: #fff; }
.wt-badge { background: var(--badge-bg); color: var(--muted); font-weight: 600; letter-spacing: 0.03em; }

.run-list { list-style: none; padding: 0; }
.run-item { display: grid; grid-template-columns: 1fr auto; gap: 0.5rem; padding: 0.4rem 0.5rem; border-bottom: 1px solid var(--border); cursor: pointer; font-size: 0.8rem; font-family: monospace; }
.run-item:hover { background: var(--card-bg); }
.run-item .meta { color: var(--muted); text-align: right; white-space: nowrap; }

.detail-pane { background: var(--card-bg); border: 1px solid var(--border); border-radius: 6px; padding: 1rem; margin-top: 1rem; }
.detail-pane h3 { font-size: 0.95rem; margin-bottom: 0.5rem; }
.detail-pane .field { font-size: 0.8rem; font-family: monospace; margin-bottom: 0.25rem; }
.detail-pane .field label { color: var(--muted); }
.events-list { margin-top: 0.75rem; max-height: 400px; overflow-y: auto; }
.event-item { font-size: 0.75rem; font-family: monospace; padding: 0.2rem 0; border-bottom: 1px solid var(--border); word-break: break-all; }
.event-item summary { cursor: pointer; }
.event-item.ev-system { border-left: 3px solid var(--muted); padding-left: 0.4rem; }
.event-item.ev-backend { border-left: 3px solid var(--muted); padding-left: 0.4rem; }
.event-item.ev-review { border-left: 3px solid var(--watching); padding-left: 0.4rem; background: rgba(217,119,6,0.03); }
.event-item.ev-error { border-left: 3px solid var(--failed); padding-left: 0.4rem; background: rgba(220,38,38,0.05); }
.event-item.ev-coordination { border-left: 3px solid var(--active); padding-left: 0.4rem; }
.event-item.ev-completion { border-left: 3px solid var(--completed); padding-left: 0.4rem; }
.event-item.ev-highlight { border-left-color: var(--active); }
.event-item.ev-backend summary { opacity: 0.6; }
.event-item.ev-highlight summary { opacity: 1; }
.event-item.ev-backend:hover summary { opacity: 1; }
.event-field { margin: 0.15rem 0; font-size: 0.7rem; }
.event-field strong { color: var(--muted); margin-right: 0.3rem; }
.event-field pre { display: inline; white-space: pre-wrap; }
.event-field details summary { cursor: pointer; color: var(--muted); font-style: italic; }

.md-content { font-family: system-ui, -apple-system, sans-serif; font-size: 0.75rem; line-height: 1.5; white-space: normal; }
.md-content h1, .md-content h2, .md-content h3, .md-content h4, .md-content h5, .md-content h6 { margin: 0.5em 0 0.25em; font-weight: 600; }
.md-content h1 { font-size: 1.1em; } .md-content h2 { font-size: 1em; } .md-content h3 { font-size: 0.95em; }
.md-content p { margin: 0.3em 0; }
.md-content code { background: var(--badge-bg); padding: 0.1em 0.3em; border-radius: 3px; font-size: 0.9em; }
.md-content pre { background: var(--badge-bg); padding: 0.5em; border-radius: 4px; overflow-x: auto; margin: 0.4em 0; }
.md-content pre code { background: none; padding: 0; }
.md-content ul, .md-content ol { margin: 0.3em 0; padding-left: 1.5em; }
.md-content li { margin: 0.15em 0; }
.md-content strong { font-weight: 600; }
.md-content em { font-style: italic; }

.empty { color: var(--muted); font-size: 0.8rem; padding: 0.5rem 0; }

/* Structured prompt styles */
.prompt-structured { font-size: 0.75rem; line-height: 1.5; }
.prompt-section { border-bottom: 1px solid var(--border); padding: 0.5rem 0; }
.prompt-section:last-child { border-bottom: none; }
.prompt-objective { background: color-mix(in srgb, var(--active) 10%, transparent); border: 1px solid color-mix(in srgb, var(--active) 30%, transparent); border-radius: 6px; padding: 0.6rem 0.8rem; margin-bottom: 0.5rem; }
.prompt-objective h4 { font-size: 0.8rem; color: var(--active); margin-bottom: 0.25rem; }
.prompt-topology { display: flex; flex-wrap: wrap; gap: 0.4rem; align-items: center; padding: 0.4rem 0; font-size: 0.7rem; font-family: monospace; }
.prompt-topology .topo-label { color: var(--muted); margin-right: 0.15rem; }
.prompt-topology .topo-badge { display: inline-block; padding: 0.1rem 0.4rem; border-radius: 8px; background: var(--badge-bg); font-size: 0.7rem; }
.prompt-scratchpad-entries { margin-top: 0.3rem; }
.prompt-show-more { background: none; border: 1px solid var(--border); border-radius: 4px; padding: 0.2rem 0.5rem; font-size: 0.7rem; color: var(--muted); cursor: pointer; margin-bottom: 0.3rem; }
.prompt-show-more:hover { background: var(--card-bg); color: var(--fg); }
.prompt-raw-toggle { margin-top: 0.5rem; }
.prompt-raw-toggle button { background: none; border: 1px solid var(--border); border-radius: 4px; padding: 0.2rem 0.6rem; font-size: 0.7rem; color: var(--muted); cursor: pointer; }
.prompt-raw-toggle button:hover { background: var(--card-bg); color: var(--fg); }
.prompt-raw-toggle pre { white-space: pre-wrap; font-size: 0.65rem; margin-top: 0.3rem; max-height: 400px; overflow-y: auto; background: var(--badge-bg); padding: 0.5rem; border-radius: 4px; }

/* Routing badges and backpressure */
.routing-badge { display: inline-block; font-size: 0.65rem; padding: 0.1rem 0.35rem; border-radius: 6px; background: var(--badge-bg); margin: 0.1rem 0.15rem; font-family: monospace; }
.bp-none { color: var(--muted); font-style: italic; font-size: 0.7rem; }
.bp-warning { display: inline-block; font-size: 0.7rem; padding: 0.15rem 0.4rem; border-radius: 6px; background: color-mix(in srgb, var(--watching) 15%, transparent); border: 1px solid color-mix(in srgb, var(--watching) 40%, transparent); color: var(--watching); font-family: monospace; }

/* Merged indicator */
.merged-badge { color: var(--completed); font-weight: 600; }
.merge-detail { margin-top: 0.5rem; padding: 0.5rem; background: color-mix(in srgb, var(--completed) 8%, transparent); border: 1px solid color-mix(in srgb, var(--completed) 25%, transparent); border-radius: 4px; }
.merge-detail .field label { color: var(--completed); }

.detail-tabs { display: flex; gap: 0; border-bottom: 2px solid var(--border); margin-top: 0.75rem; margin-bottom: 0; }
.detail-tab { background: none; border: none; padding: 0.4rem 0.8rem; font-size: 0.8rem; font-family: monospace; cursor: pointer; color: var(--muted); border-bottom: 2px solid transparent; margin-bottom: -2px; }
.detail-tab:hover { color: var(--fg); }
.detail-tab.active { color: var(--active); border-bottom-color: var(--active); font-weight: 600; }

.topic-chip { display: inline-flex; align-items: center; gap: 0.2rem; padding: 0.15rem 0.4rem; border: 1px solid var(--border); border-left-width: 3px; border-radius: 4px; background: none; font-size: 0.7rem; font-family: monospace; cursor: pointer; color: var(--muted); }
.topic-chip.active { color: var(--fg); background: var(--card-bg); }
.topic-chip .badge { font-size: 0.6rem; padding: 0 0.25rem; }

.journal-search { width: 100%; padding: 0.35rem 0.5rem; border: 1px solid var(--border); border-radius: 4px; font-size: 0.8rem; font-family: inherit; background: var(--bg); color: var(--fg); }

.iter-group { border: 1px solid var(--border); border-radius: 4px; margin-bottom: 0.4rem; }
.iter-group > summary { cursor: pointer; padding: 0.3rem 0.5rem; font-size: 0.75rem; font-family: monospace; color: var(--muted); background: var(--card-bg); list-style: none; }
.iter-group > summary::-webkit-details-marker { display: none; }
.iter-group > summary::before { content: "\\25b6 "; font-size: 0.6rem; }
.iter-group[open] > summary::before { content: "\\25bc "; }

.artifacts-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.5rem; margin-bottom: 0.75rem; }
.artifact-stat-card { background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 0.5rem; text-align: center; }
.artifact-stat-value { font-size: 1.2rem; font-weight: 700; font-family: monospace; }
.artifact-stat-label { font-size: 0.7rem; color: var(--muted); }
.artifacts-bar-chart { margin: 0.5rem 0; }
.bar-row { display: grid; grid-template-columns: 80px 1fr 40px; gap: 0.4rem; align-items: center; font-size: 0.75rem; margin-bottom: 0.2rem; }
.bar-label { text-align: right; color: var(--muted); font-family: monospace; }
.bar-track { height: 14px; background: var(--badge-bg); border-radius: 3px; overflow: hidden; }
.bar-fill { height: 100%; border-radius: 3px; min-width: 2px; }
.bar-count { font-family: monospace; text-align: right; }
.artifact-doc-row { display: flex; align-items: center; gap: 0.5rem; padding: 0.3rem 0; border-bottom: 1px solid var(--border); font-size: 0.8rem; }
.artifact-view-btn { padding: 0.15rem 0.5rem; border: 1px solid var(--border); border-radius: 3px; background: var(--bg); color: var(--fg); cursor: pointer; font-size: 0.7rem; }
.artifact-view-btn:hover { background: var(--badge-bg); }
</style>
</head>
<body x-data="dashboard()" x-init="startPolling()">

<header>
  <h1>autoloop <span style="color:var(--muted);font-weight:400">/ ${displayName}</span></h1>
  <span class="updated" x-text="lastUpdated ? 'updated ' + lastUpdated : 'loading...'"></span>
</header>

<div class="chatbox">
  <select x-model="selectedPreset">
    <template x-for="p in presets" :key="p.name">
      <option :value="p.name" x-text="p.name"></option>
    </template>
  </select>
  <textarea x-model="newPrompt" placeholder="Describe what you want to do..." @keydown.meta.enter="startLoop()" @keydown.ctrl.enter="startLoop()"></textarea>
  <button @click="startLoop()">Start</button>
</div>

<template x-for="cat in categories" :key="cat.key">
  <details class="section" :open="sectionOpen[cat.key]" @toggle="sectionUserToggled[cat.key] = true; sectionOpen[cat.key] = $el.open">
    <summary>
      <span x-text="cat.label"></span>
      <span class="badge" :data-status="cat.key" x-text="cat.total"></span>
    </summary>
    <ul class="run-list">
      <template x-for="run in cat.items" :key="run.run_id">
        <li class="run-item" @click="selectRun(run.run_id)">
          <span>
            <span x-text="run.run_id.slice(0, 16)"></span>
            <span style="color:var(--muted)"> &middot; </span>
            <span x-text="run.preset"></span>
            <span style="color:var(--muted)"> &middot; iter </span>
            <span x-text="run.iteration + '/' + (run.max_iterations || '?')"></span>
            <template x-if="run.isolation_mode === 'worktree'">
              <span>
                <span class="badge wt-badge" :title="run.worktree_name || ''">WT</span>
                <template x-if="run.worktree_merged">
                  <span class="merged-badge" title="merged"> &#x2713;</span>
                </template>
              </span>
            </template>
          </span>
          <span class="meta">
            <span x-text="run.latest_event || '-'"></span>
            <span style="color:var(--muted)"> &middot; </span>
            <span x-text="timeAgo(run.created_at)"></span>
          </span>
        </li>
      </template>
      <li class="empty" x-show="cat.items.length === 0">None</li>
      <li x-show="cat.capped" style="text-align:center;padding:0.3rem;list-style:none">
        <button @click="sectionShowAll[cat.key] = true" style="background:none;border:1px solid var(--border);border-radius:4px;padding:0.25rem 0.6rem;color:var(--muted);cursor:pointer;font-size:0.75rem" x-text="'Show all ' + cat.total + ' runs'"></button>
      </li>
      <li x-show="sectionShowAll[cat.key] && cat.total > 10" style="text-align:center;padding:0.3rem;list-style:none">
        <button @click="sectionShowAll[cat.key] = false" style="background:none;border:1px solid var(--border);border-radius:4px;padding:0.25rem 0.6rem;color:var(--muted);cursor:pointer;font-size:0.75rem">Show fewer</button>
      </li>
    </ul>
  </details>
</template>

<div class="detail-pane" x-show="selectedRun" x-cloak>
  <h3 x-text="'Run: ' + (selectedRun || '')"></h3>
  <template x-if="selectedRunDetail">
    <div>
      <div class="field"><label>Status: </label><span x-text="selectedRunDetail.status"></span></div>
      <div class="field"><label>Preset: </label><span x-text="selectedRunDetail.preset"></span></div>
      <div class="field"><label>Objective: </label><div class="md-content" style="display:inline" x-html="renderMarkdown(selectedRunDetail.objective)"></div></div>
      <div class="field"><label>Iteration: </label><span x-text="selectedRunDetail.iteration + '/' + (selectedRunDetail.max_iterations || '?')"></span></div>
      <div class="field"><label>Workspace: </label><span :title="workspacePath(selectedRunDetail)" x-text="workspaceLabel(selectedRunDetail)"></span></div>
      <div class="field"><label>Created: </label><span :title="selectedRunDetail.created_at" x-text="timeAgo(selectedRunDetail.created_at) + ' ago'"></span></div>
      <div class="field"><label>Updated: </label><span :title="selectedRunDetail.updated_at" x-text="timeAgo(selectedRunDetail.updated_at) + ' ago'"></span></div>
      <div class="field"><label>Duration: </label><span x-text="runDuration()"></span></div>
      <div class="field"><label>Latest event: </label><span x-text="'[iter ' + selectedRunDetail.iteration + '] ' + selectedRunDetail.latest_event"></span></div>
      <div class="field"><label>Events: </label><span x-text="selectedRunEvents.length"></span></div>
      <template x-if="selectedRunDetail.worktree_merged">
        <div class="merge-detail">
          <div class="field"><label>Merge status: </label><span>merged</span></div>
          <div class="field" x-show="selectedRunDetail.worktree_merged_at"><label>Merged at: </label><span x-text="selectedRunDetail.worktree_merged_at"></span></div>
          <div class="field" x-show="selectedRunDetail.worktree_merge_strategy"><label>Merge strategy: </label><span x-text="selectedRunDetail.worktree_merge_strategy"></span></div>
        </div>
      </template>
    </div>
  </template>
  <div x-show="selectedRunDetail && selectedRunDetail.status === 'running'" style="display:grid;grid-template-columns:1fr auto;gap:0.4rem;align-items:center;margin:0.75rem 0;padding:0.6rem;border:1px solid var(--border);border-radius:6px;background:var(--bg)">
    <input type="text" x-model="guideMessage" placeholder="Send guidance to this run..." @keydown.enter="sendGuide()"
      style="width:100%;box-sizing:border-box;padding:0.4rem 0.6rem;border:1px solid var(--border);border-radius:4px;font-size:0.8rem;font-family:inherit;background:var(--bg);color:var(--fg)">
    <div style="display:flex;gap:0.4rem;align-items:center">
      <button @click="sendGuide()" style="padding:0.4rem 0.8rem;border:none;border-radius:4px;background:var(--active);color:#fff;cursor:pointer;font-size:0.8rem;white-space:nowrap">Send</button>
      <span x-show="guideFlash" x-text="guideFlash" x-transition.opacity style="font-size:0.75rem;color:var(--completed)"></span>
    </div>
  </div>
  <div class="detail-tabs" x-show="selectedRunDetail">
    <button class="detail-tab" :class="{ active: detailTab === 'events' }" @click="detailTab = 'events'">Events</button>
    <button class="detail-tab" :class="{ active: detailTab === 'journal' }" @click="detailTab = 'journal'">Journal</button>
    <button class="detail-tab" :class="{ active: detailTab === 'artifacts' }" @click="detailTab = 'artifacts'">Artifacts</button>
  </div>
  <div x-show="detailTab === 'events'" class="events-list">
    <div style="display:flex;justify-content:space-between;align-items:center">
      <h3>Events</h3>
      <label style="font-size:0.75rem;cursor:pointer"><input type="checkbox" x-model="showVerbose" style="margin-right:0.3rem">Show backend events</label>
    </div>
    <template x-for="(ev, idx) in visibleRunEvents()" :key="idx">
      <details :class="eventClasses(ev)">
        <summary x-text="eventSummary(ev)"></summary>
        <div style="padding:0.3rem">
          <template x-for="[k,v] in eventDisplayEntries(ev)" :key="k">
            <div class="event-field">
              <strong x-text="k + ':'"></strong>
              <template x-if="isPromptField(ev.topic, k)">
                <div x-data="{ showRaw: false, showAllScratchpad: false }" class="prompt-structured">
                  <template x-if="parsePromptSections(String(v))">
                    <div>
                      <template x-if="parsePromptSections(String(v)).objective">
                        <div class="prompt-section prompt-objective">
                          <h4>Objective</h4>
                          <div class="md-content" x-html="renderMarkdown(parsePromptSections(String(v)).objective)"></div>
                        </div>
                      </template>
                      <template x-if="parsePromptSections(String(v)).topology">
                        <div class="prompt-section">
                          <strong style="font-size:0.75rem">Topology</strong>
                          <div class="prompt-topology" x-html="renderTopologyBlock(parsePromptSections(String(v)).topology)"></div>
                        </div>
                      </template>
                      <template x-if="parsePromptSections(String(v)).scratchpad">
                        <div class="prompt-section">
                          <strong style="font-size:0.75rem">Scratchpad</strong>
                          <div class="prompt-scratchpad-entries">
                            <template x-if="getScratchpadEntries(parsePromptSections(String(v)).scratchpad).length > 3">
                              <div>
                                <button class="prompt-show-more" x-show="!showAllScratchpad" @click="showAllScratchpad = true"
                                  x-text="'Show ' + (getScratchpadEntries(parsePromptSections(String(v)).scratchpad).length - 3) + ' older entries'"></button>
                                <template x-if="showAllScratchpad">
                                  <div class="md-content" x-html="renderMarkdown(getScratchpadEntries(parsePromptSections(String(v)).scratchpad).slice(0, -3).join('\\n\\n'))"></div>
                                </template>
                              </div>
                            </template>
                            <div class="md-content" x-html="renderMarkdown(getScratchpadEntries(parsePromptSections(String(v)).scratchpad).slice(-3).join('\\n\\n'))"></div>
                          </div>
                        </div>
                      </template>
                      <template x-if="parsePromptSections(String(v)).memory">
                        <details class="prompt-section">
                          <summary style="cursor:pointer;font-size:0.75rem;font-weight:600">Loop Memory</summary>
                          <div class="md-content" style="margin-top:0.3rem" x-html="renderMarkdown(parsePromptSections(String(v)).memory)"></div>
                        </details>
                      </template>
                      <template x-if="parsePromptSections(String(v)).rules">
                        <details class="prompt-section">
                          <summary style="cursor:pointer;font-size:0.75rem;font-weight:600">Rules &amp; Event Tool</summary>
                          <div class="md-content" style="margin-top:0.3rem" x-html="renderMarkdown(parsePromptSections(String(v)).rules)"></div>
                        </details>
                      </template>
                      <template x-if="parsePromptSections(String(v)).config">
                        <details class="prompt-section">
                          <summary style="cursor:pointer;font-size:0.75rem;font-weight:600">Config</summary>
                          <div class="md-content" style="margin-top:0.3rem" x-html="renderMarkdown(parsePromptSections(String(v)).config)"></div>
                        </details>
                      </template>
                      <template x-if="parsePromptSections(String(v)).harness">
                        <details class="prompt-section">
                          <summary style="cursor:pointer;font-size:0.75rem;font-weight:600">Harness Instructions</summary>
                          <div class="md-content" style="margin-top:0.3rem" x-html="renderMarkdown(parsePromptSections(String(v)).harness)"></div>
                        </details>
                      </template>
                      <div class="prompt-raw-toggle">
                        <button @click="showRaw = !showRaw" x-text="showRaw ? 'Hide raw prompt' : 'Show raw prompt'"></button>
                        <template x-if="showRaw">
                          <pre x-text="String(v)"></pre>
                        </template>
                      </div>
                    </div>
                  </template>
                </div>
              </template>
              <template x-if="!isPromptField(ev.topic, k) && isRoutingBadgeField(k)">
                <span x-html="renderRoutingValue(k, v)"></span>
              </template>
              <template x-if="!isPromptField(ev.topic, k) && !isRoutingBadgeField(k) && isMarkdownField(ev.topic, k)">
                <template x-if="String(typeof v === 'object' ? JSON.stringify(v,null,2) : v).length <= 200">
                  <div class="md-content" x-html="renderMarkdown(typeof v === 'object' ? JSON.stringify(v,null,2) : String(v))"></div>
                </template>
              </template>
              <template x-if="!isPromptField(ev.topic, k) && !isRoutingBadgeField(k) && isMarkdownField(ev.topic, k)">
                <template x-if="String(typeof v === 'object' ? JSON.stringify(v,null,2) : v).length > 200">
                  <details>
                    <summary x-text="k + ' (' + String(typeof v === 'object' ? JSON.stringify(v,null,2) : v).length + ' chars)'"></summary>
                    <div class="md-content" style="font-size:0.7rem;margin-top:0.2rem" x-html="renderMarkdown(typeof v === 'object' ? JSON.stringify(v,null,2) : String(v))"></div>
                  </details>
                </template>
              </template>
              <template x-if="!isPromptField(ev.topic, k) && !isRoutingBadgeField(k) && !isMarkdownField(ev.topic, k)">
                <template x-if="String(typeof v === 'object' ? JSON.stringify(v,null,2) : v).length <= 200">
                  <pre x-text="typeof v === 'object' ? JSON.stringify(v,null,2) : String(v)"></pre>
                </template>
              </template>
              <template x-if="!isPromptField(ev.topic, k) && !isRoutingBadgeField(k) && !isMarkdownField(ev.topic, k)">
                <template x-if="String(typeof v === 'object' ? JSON.stringify(v,null,2) : v).length > 200">
                  <details>
                    <summary x-text="k + ' (' + String(typeof v === 'object' ? JSON.stringify(v,null,2) : v).length + ' chars)'"></summary>
                    <pre style="white-space:pre-wrap;font-size:0.7rem;margin-top:0.2rem" x-text="typeof v === 'object' ? JSON.stringify(v,null,2) : String(v)"></pre>
                  </details>
                </template>
              </template>
            </div>
          </template>
        </div>
      </details>
    </template>
    <p class="empty" x-show="visibleRunEvents().length === 0">No events</p>
  </div>
  <div x-show="detailTab === 'journal'" class="events-list">
    <div style="margin-bottom:0.5rem">
      <input type="text" class="journal-search" x-model="journalSearch" placeholder="Search events...">
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:0.3rem;margin-bottom:0.5rem">
      <template x-for="cat in journalCategoryChips()" :key="cat.key">
        <button class="topic-chip" :class="{ active: journalCategoryFilter[cat.key] }" :style="'border-color:' + cat.color" @click="journalCategoryFilter[cat.key] = !journalCategoryFilter[cat.key]">
          <span x-text="cat.label"></span>
          <span class="badge" x-text="cat.count"></span>
        </button>
      </template>
    </div>
    <template x-for="group in journalGroups()" :key="group.key">
      <details class="iter-group" open>
        <summary x-text="group.label + ' (' + group.events.length + ' events)'"></summary>
        <template x-for="(ev, idx) in group.events" :key="idx">
          <details :class="eventClasses(ev)">
            <summary x-text="eventSummary(ev)"></summary>
            <div style="padding:0.3rem">
              <template x-for="[k,v] in eventDisplayEntries(ev)" :key="k">
                <div class="event-field">
                  <strong x-text="k + ':'"></strong>
                  <template x-if="isRoutingBadgeField(k)">
                    <span x-html="renderRoutingValue(k, v)"></span>
                  </template>
                  <template x-if="!isRoutingBadgeField(k) && isMarkdownField(ev.topic, k)">
                    <template x-if="String(typeof v === 'object' ? JSON.stringify(v,null,2) : v).length <= 200">
                      <div class="md-content" x-html="renderMarkdown(typeof v === 'object' ? JSON.stringify(v,null,2) : String(v))"></div>
                    </template>
                  </template>
                  <template x-if="!isRoutingBadgeField(k) && isMarkdownField(ev.topic, k)">
                    <template x-if="String(typeof v === 'object' ? JSON.stringify(v,null,2) : v).length > 200">
                      <details>
                        <summary x-text="k + ' (' + String(typeof v === 'object' ? JSON.stringify(v,null,2) : v).length + ' chars)'"></summary>
                        <div class="md-content" style="font-size:0.7rem;margin-top:0.2rem" x-html="renderMarkdown(typeof v === 'object' ? JSON.stringify(v,null,2) : String(v))"></div>
                      </details>
                    </template>
                  </template>
                  <template x-if="!isRoutingBadgeField(k) && !isMarkdownField(ev.topic, k)">
                    <template x-if="String(typeof v === 'object' ? JSON.stringify(v,null,2) : v).length <= 200">
                      <pre x-text="typeof v === 'object' ? JSON.stringify(v,null,2) : String(v)"></pre>
                    </template>
                  </template>
                  <template x-if="!isRoutingBadgeField(k) && !isMarkdownField(ev.topic, k)">
                    <template x-if="String(typeof v === 'object' ? JSON.stringify(v,null,2) : v).length > 200">
                      <details>
                        <summary x-text="k + ' (' + String(typeof v === 'object' ? JSON.stringify(v,null,2) : v).length + ' chars)'"></summary>
                        <pre style="white-space:pre-wrap;font-size:0.7rem;margin-top:0.2rem" x-text="typeof v === 'object' ? JSON.stringify(v,null,2) : String(v)"></pre>
                      </details>
                    </template>
                  </template>
                </div>
              </template>
            </div>
          </details>
        </template>
      </details>
    </template>
    <p class="empty" x-show="journalGroups().length === 0">No matching events</p>
  </div>
  <div x-show="detailTab === 'artifacts'" class="events-list">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem">
      <h3 style="font-size:0.95rem">Artifacts</h3>
      <button @click="fetchArtifacts()" style="padding:0.2rem 0.6rem;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--fg);cursor:pointer;font-size:0.75rem">Refresh</button>
    </div>

    <div x-show="artifactsData" class="artifacts-grid">
      <div class="artifact-stat-card">
        <div class="artifact-stat-value" x-text="artifactsData?.events?.total || 0"></div>
        <div class="artifact-stat-label">Events</div>
      </div>
      <div class="artifact-stat-card">
        <div class="artifact-stat-value" x-text="artifactsData?.iterations || 0"></div>
        <div class="artifact-stat-label">Iterations</div>
      </div>
      <div class="artifact-stat-card">
        <div class="artifact-stat-value" x-text="(artifactsData?.artifacts?.memoryLearnings || 0) + (artifactsData?.artifacts?.memoryMeta || 0)"></div>
        <div class="artifact-stat-label">Memory</div>
      </div>
      <div class="artifact-stat-card">
        <div class="artifact-stat-value" x-text="artifactsData?.artifacts?.guidanceSent || 0"></div>
        <div class="artifact-stat-label">Guidance</div>
      </div>
    </div>

    <div x-show="artifactsData" class="artifacts-bar-chart">
      <template x-for="cat in artifactsCategoryBars()" :key="cat.key">
        <div class="bar-row">
          <span class="bar-label" x-text="cat.label"></span>
          <div class="bar-track">
            <div class="bar-fill" :style="'width:' + cat.pct + '%;background:' + cat.color"></div>
          </div>
          <span class="bar-count" x-text="cat.count"></span>
        </div>
      </template>
    </div>

    <div x-show="artifactsData" style="font-size:0.8rem;font-family:monospace;margin:0.75rem 0">
      <div>commits: <span x-text="artifactsData?.output?.commits || 0"></span></div>
      <div>files changed: <span x-text="artifactsData?.output?.filesChanged < 0 ? '-' : artifactsData?.output?.filesChanged"></span></div>
      <div>journal size: <span x-text="formatBytes(artifactsData?.output?.journalSizeBytes || 0)"></span></div>
      <div>backpressure: <span x-text="artifactsData?.artifacts?.backpressure || 0"></span> rejected</div>
    </div>

    <div x-show="artifactsData && artifactsData.documents && artifactsData.documents.length > 0">
      <h4 style="font-size:0.85rem;margin:0.75rem 0 0.5rem">Documents</h4>
      <template x-for="doc in artifactsData?.documents || []" :key="doc.path">
        <div class="artifact-doc-row">
          <span x-text="doc.title || doc.path"></span>
          <span class="badge" x-text="doc.kind"></span>
          <template x-if="doc.missing">
            <span style="color:var(--failed);font-size:0.7rem">(missing)</span>
          </template>
          <template x-if="!doc.missing">
            <button class="artifact-view-btn" @click="viewArtifactDoc(doc.path)">View</button>
          </template>
        </div>
      </template>
    </div>

    <div x-show="artifactDocContent !== null" style="margin-top:0.75rem">
      <button @click="artifactDocContent = null; artifactDocPath = ''" style="padding:0.2rem 0.6rem;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--fg);cursor:pointer;font-size:0.75rem;margin-bottom:0.5rem">\u2190 Back</button>
      <div class="md-content" x-html="renderMarkdown(artifactDocContent || '')"></div>
    </div>

    <p class="empty" x-show="!artifactsData">Click Refresh to load artifacts</p>
  </div>
</div>

<script defer src="/static/alpine.min.js"></script>
<script>
function dashboard() {
  return {
    runs: { active: [], watching: [], stuck: [], recentFailed: [], recentCompleted: [] },
    presets: [],
    selectedRun: null,
    selectedRunDetail: null,
    selectedRunEvents: [],
    newPrompt: "",
    selectedPreset: "",
    pollInterval: null,
    lastUpdated: null,
    sectionOpen: { active: false, watching: false, stuck: false, failed: false, completed: false },
    sectionUserToggled: {},
    sectionShowAll: {},
    showVerbose: false,
    guideMessage: "",
    guideFlash: "",
    artifactsData: null,
    artifactDocContent: null,
    artifactDocPath: '',
    detailTab: 'events',
    journalSearch: '',
    journalCategoryFilter: {
      loop: true,
      iteration: true,
      backend: false,
      review: true,
      coordination: true,
      error: true,
      operator: true,
      completion: true,
    },
    categoryColors: {
      loop: '#06b6d4',
      iteration: '#d97706',
      backend: '#666',
      review: '#c026d3',
      coordination: '#2563eb',
      error: '#dc2626',
      operator: '#ef4444',
      completion: '#16a34a',
    },

    get categories() {
      const CAP = 10;
      const cap = (key, items) => {
        const total = items.length;
        const show = this.sectionShowAll[key] ? items : items.slice(0, CAP);
        return { items: show, total, capped: total > CAP && !this.sectionShowAll[key] };
      };
      const fc = cap("failed", this.runs.recentFailed);
      const cc = cap("completed", this.runs.recentCompleted);
      return [
        { key: "active", label: "Active", items: this.runs.active, total: this.runs.active.length, capped: false },
        { key: "watching", label: "Watching", items: this.runs.watching, total: this.runs.watching.length, capped: false },
        { key: "stuck", label: "Stuck", items: this.runs.stuck, total: this.runs.stuck.length, capped: false },
        { key: "failed", label: "Failed", items: fc.items, total: fc.total, capped: fc.capped },
        { key: "completed", label: "Completed", items: cc.items, total: cc.total, capped: cc.capped },
      ];
    },

    async startPolling() {
      await this.fetchPresets();
      await this.fetchRuns();
      this.pollInterval = setInterval(() => this.fetchRuns(), 3000);
    },

    async fetchRuns() {
      try {
        const res = await fetch("/api/runs");
        const data = await res.json();
        const byRecent = (a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0);
        for (const key of ['active', 'watching', 'stuck', 'recentFailed', 'recentCompleted']) {
          if (data[key]) data[key].sort(byRecent);
        }
        this.runs = data;
        this.lastUpdated = new Date().toLocaleTimeString();
        const defaultOpen = ['active', 'watching', 'stuck'];
        for (const cat of this.categories) {
          if (!this.sectionUserToggled[cat.key]) {
            this.sectionOpen[cat.key] = cat.items.length > 0 && defaultOpen.includes(cat.key);
          }
        }
        if (this.selectedRun) this.fetchEvents(this.selectedRun);
      } catch (e) { /* retry on next poll */ }
    },

    async fetchPresets() {
      try {
        const res = await fetch("/api/presets");
        const data = await res.json();
        this.presets = data.presets;
        if (this.presets.length && !this.selectedPreset) {
          this.selectedPreset = this.presets[0].name;
        }
      } catch (e) { /* ignore */ }
    },

    async selectRun(runId) {
      this.selectedRun = runId;
      this.artifactsData = null;
      this.artifactDocContent = null;
      this.artifactDocPath = '';
      try {
        const detailRes = await fetch("/api/runs/" + runId);
        if (detailRes.ok) this.selectedRunDetail = await detailRes.json();
      } catch (e) { /* ignore */ }
      await this.fetchEvents(runId);
    },

    async fetchEvents(runId) {
      try {
        const res = await fetch("/api/runs/" + runId + "/events");
        const data = await res.json();
        this.selectedRunEvents = data.events;
      } catch (e) { /* ignore */ }
    },

    async sendGuide() {
      if (!this.guideMessage.trim() || !this.selectedRun) return;
      try {
        const res = await fetch("/api/runs/" + this.selectedRun + "/guide", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: this.guideMessage }),
        });
        if (res.ok) {
          this.guideMessage = "";
          this.guideFlash = "Sent";
          setTimeout(() => { this.guideFlash = ""; }, 2000);
          await this.fetchEvents(this.selectedRun);
        } else {
          const data = await res.json().catch(() => ({}));
          this.guideFlash = data.error || "Failed";
          setTimeout(() => { this.guideFlash = ""; }, 3000);
        }
      } catch (e) {
        this.guideFlash = "Error";
        setTimeout(() => { this.guideFlash = ""; }, 3000);
      }
    },

    async startLoop() {
      if (!this.newPrompt.trim()) return;
      await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: this.newPrompt, preset: this.selectedPreset }),
      });
      this.newPrompt = "";
      setTimeout(() => this.fetchRuns(), 1000);
    },

    timeAgo(iso) {
      if (!iso) return "-";
      const s = Math.floor((Date.now() - new Date(iso)) / 1000);
      if (s < 0) return "0s";
      if (s < 60) return s + "s";
      if (s < 3600) return Math.floor(s / 60) + "m";
      return Math.floor(s / 3600) + "h";
    },

    runDuration() {
      const d = this.selectedRunDetail;
      if (!d || !d.created_at || !d.updated_at) return "-";
      const ms = new Date(d.updated_at) - new Date(d.created_at);
      if (ms < 0) return "-";
      const s = Math.floor(ms / 1000);
      if (s < 60) return s + "s";
      if (s < 3600) return Math.floor(s / 60) + "m " + (s % 60) + "s";
      return Math.floor(s / 3600) + "h " + Math.floor((s % 3600) / 60) + "m";
    },

    workspaceLabel(run) {
      if (!run) return "-";
      if (run.isolation_mode === "worktree") {
        return run.worktree_name || "worktree";
      }
      return "shared checkout";
    },

    workspacePath(run) {
      if (!run) return "";
      if (run.isolation_mode === "worktree") {
        return run.worktree_path || run.work_dir || "";
      }
      return run.work_dir || run.project_dir || "";
    },

    isMarkdownField(topic, key) {
      if (!topic || !key) return false;
      const t = String(topic);
      const k = String(key);
      if ((t === 'backend.finish' || t === 'iteration.finish') && k === 'output') return true;
      if (t === 'iteration.start' && k === 'prompt') return true;
      return false;
    },

    renderMarkdown(text) {
      if (!text) return '';
      let html = String(text);
      // Escape HTML
      html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      // Fenced code blocks
      html = html.replace(/^\\\`\\\`\\\`(\\w*)\\n([\\s\\S]*?)^\\\`\\\`\\\`/gm, function(_, lang, code) {
        return '<pre><code>' + code.trim() + '</code></pre>';
      });
      // Split into lines for block-level processing
      const lines = html.split('\\n');
      const out = [];
      let inList = false;
      let listType = '';
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Headings
        const hMatch = line.match(/^(#{1,6})\\s+(.+)$/);
        if (hMatch) {
          if (inList) { out.push('</' + listType + '>'); inList = false; }
          const lvl = hMatch[1].length;
          out.push('<h' + lvl + '>' + this._inlineMd(hMatch[2]) + '</h' + lvl + '>');
          continue;
        }
        // Unordered list
        const ulMatch = line.match(/^[\\-\\*]\\s+(.+)$/);
        if (ulMatch) {
          if (!inList || listType !== 'ul') {
            if (inList) out.push('</' + listType + '>');
            out.push('<ul>'); inList = true; listType = 'ul';
          }
          out.push('<li>' + this._inlineMd(ulMatch[1]) + '</li>');
          continue;
        }
        // Ordered list
        const olMatch = line.match(/^\\d+\\.\\s+(.+)$/);
        if (olMatch) {
          if (!inList || listType !== 'ol') {
            if (inList) out.push('</' + listType + '>');
            out.push('<ol>'); inList = true; listType = 'ol';
          }
          out.push('<li>' + this._inlineMd(olMatch[1]) + '</li>');
          continue;
        }
        // Close list if we hit non-list line
        if (inList) { out.push('</' + listType + '>'); inList = false; }
        // Empty line = paragraph break
        if (line.trim() === '') {
          out.push('');
          continue;
        }
        // Normal paragraph line
        out.push('<p>' + this._inlineMd(line) + '</p>');
      }
      if (inList) out.push('</' + listType + '>');
      return out.join('\\n');
    },

    _inlineMd(text) {
      // Inline code
      text = text.replace(/\\\`([^\\\`]+)\\\`/g, '<code>$1</code>');
      // Bold
      text = text.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
      text = text.replace(/__(.+?)__/g, '<strong>$1</strong>');
      // Italic
      text = text.replace(/\\*(.+?)\\*/g, '<em>$1</em>');
      text = text.replace(/_(.+?)_/g, '<em>$1</em>');
      return text;
    },

    eventDisplayEntries(ev) {
      if (ev.fields && typeof ev.fields === 'object') {
        const entries = [];
        for (const [k, v] of Object.entries(ev)) {
          if (k === 'fields') continue;
          entries.push([k, v]);
        }
        for (const [fk, fv] of Object.entries(ev.fields)) {
          entries.push([fk, fv]);
        }
        return entries;
      }
      return Object.entries(ev);
    },

    isRoutingBadgeField(key) {
      return ['suggested_roles', 'allowed_events', 'backpressure', 'recent_event'].includes(String(key));
    },

    renderRoutingValue(key, value) {
      const k = String(key);
      const v = String(value || '');
      if (k === 'backpressure') {
        if (!v || v === 'none' || v === '') {
          return '<span class="bp-none">none</span>';
        }
        return '<span class="bp-warning">' + this._escHtml(v) + '</span>';
      }
      if (k === 'suggested_roles' || k === 'allowed_events') {
        const items = v.split(',').map(s => s.trim()).filter(Boolean);
        if (items.length === 0) return '<span class="bp-none">-</span>';
        return items.map(i => '<span class="routing-badge">' + this._escHtml(i) + '</span>').join(' ');
      }
      return '<span class="routing-badge">' + this._escHtml(v) + '</span>';
    },

    isPromptField(topic, key) {
      return String(topic) === 'iteration.start' && String(key) === 'prompt';
    },

    parsePromptSections(text) {
      if (!text) return null;
      const s = String(text);
      const sections = {};

      // Objective
      const objMatch = s.match(/Objective:\\n([\\s\\S]*?)(?=\\n(?:Loop memory:|Topology \\(advisory\\):|Current scratchpad:|Use the event tool|Iteration:|$))/);
      if (objMatch) sections.objective = objMatch[1].trim();

      // Topology
      const topoMatch = s.match(/Topology \\(advisory\\):\\n([\\s\\S]*?)(?=\\n(?:Iteration:|Current scratchpad:|Use the event tool|Loop memory:|Objective:|$))/);
      if (topoMatch) sections.topology = topoMatch[1].trim();

      // Scratchpad
      const scratchMatch = s.match(/Current scratchpad:\\n([\\s\\S]*?)(?=\\n(?:Use the event tool|Backpressure rule:|Plain text alone|$))/);
      if (scratchMatch) sections.scratchpad = scratchMatch[1].trim();

      // Rules (event tool usage + examples + backpressure)
      const rulesMatch = s.match(/(Use the event tool[\\s\\S]*?)$/);
      if (rulesMatch) sections.rules = rulesMatch[1].trim();

      // Loop memory
      const memMatch = s.match(/Loop memory:\\n([\\s\\S]*?)(?=\\n(?:Topology \\(advisory\\):|Current scratchpad:|Objective:|Iteration:|$))/);
      if (memMatch) sections.memory = memMatch[1].trim();

      // Config (Iteration, Log level, Completion event, etc.)
      const cfgMatch = s.match(/(Iteration:[\\s\\S]*?)(?=\\n(?:Current scratchpad:|Use the event tool|$))/);
      if (cfgMatch) sections.config = cfgMatch[1].trim();

      // Harness instructions
      const harnessMatch = s.match(/Live harness instructions:\\n([\\s\\S]*?)(?=\\n(?:Context pressure:|Objective:|Loop memory:|Topology|$))/);
      if (harnessMatch) sections.harness = harnessMatch[1].trim();

      return Object.keys(sections).length > 0 ? sections : null;
    },

    renderTopologyBlock(text) {
      if (!text) return '';
      let html = '';
      const lines = String(text).split('\\n');
      for (const line of lines) {
        const kv = line.match(/^([^:]+):\\s*(.+)$/);
        if (kv) {
          const label = kv[1].trim();
          const val = kv[2].trim();
          if (label === 'Suggested next roles' || label === 'Allowed next events' || label === 'Recent routing event') {
            html += '<span class="topo-label">' + this._escHtml(label) + ':</span> ';
            const items = val.split(',').map(s => s.trim()).filter(Boolean);
            for (const item of items) {
              html += '<span class="topo-badge">' + this._escHtml(item) + '</span> ';
            }
          } else {
            html += '<span class="topo-label">' + this._escHtml(label) + ':</span> <span>' + this._escHtml(val) + '</span> ';
          }
        }
      }
      // Role deck
      const deckMatch = text.match(/Role deck:\\n([\\s\\S]*?)$/);
      if (deckMatch) {
        const roles = deckMatch[1].match(/- role \`([^\`]+)\`/g);
        if (roles) {
          html += '<span class="topo-label">Roles:</span> ';
          for (const r of roles) {
            const name = r.match(/\`([^\`]+)\`/);
            if (name) html += '<span class="topo-badge">' + this._escHtml(name[1]) + '</span> ';
          }
        }
      }
      return html;
    },

    getScratchpadEntries(text) {
      if (!text) return [];
      // Split by "## Iteration N" headers
      const parts = String(text).split(/(?=## Iteration \\d+)/);
      return parts.filter(p => p.trim().length > 0);
    },

    _escHtml(s) {
      return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    },

    async fetchArtifacts() {
      if (!this.selectedRun) return;
      try {
        const res = await fetch('/api/runs/' + this.selectedRun + '/artifacts');
        if (res.ok) this.artifactsData = await res.json();
      } catch (e) { /* ignore */ }
    },

    async viewArtifactDoc(path) {
      if (!this.selectedRun) return;
      try {
        const res = await fetch('/api/runs/' + this.selectedRun + '/artifact?path=' + encodeURIComponent(path));
        if (res.ok) {
          this.artifactDocContent = await res.text();
          this.artifactDocPath = path;
        }
      } catch (e) { /* ignore */ }
    },

    artifactsCategoryBars() {
      if (!this.artifactsData) return [];
      const ev = this.artifactsData.events;
      const max = Math.max(ev.loop, ev.iteration, ev.backend, ev.review, ev.coordination, ev.operator, ev.routing, ev.errors, 1);
      return [
        { key: 'loop', label: 'loop', count: ev.loop, pct: (ev.loop / max) * 100, color: 'var(--cat-loop)' },
        { key: 'iteration', label: 'iteration', count: ev.iteration, pct: (ev.iteration / max) * 100, color: 'var(--cat-iteration)' },
        { key: 'backend', label: 'backend', count: ev.backend, pct: (ev.backend / max) * 100, color: 'var(--cat-backend)' },
        { key: 'review', label: 'review', count: ev.review, pct: (ev.review / max) * 100, color: 'var(--cat-review)' },
        { key: 'coordination', label: 'coord', count: ev.coordination, pct: (ev.coordination / max) * 100, color: 'var(--cat-coordination)' },
        { key: 'operator', label: 'operator', count: ev.operator, pct: (ev.operator / max) * 100, color: 'var(--cat-operator)' },
        { key: 'routing', label: 'routing', count: ev.routing, pct: (ev.routing / max) * 100, color: 'var(--cat-routing, #6366f1)' },
        { key: 'errors', label: 'errors', count: ev.errors, pct: (ev.errors / max) * 100, color: 'var(--cat-error)' },
      ];
    },

    formatBytes(bytes) {
      if (!bytes || bytes === 0) return '0 B';
      if (bytes < 1024) return bytes + ' B';
      const kb = bytes / 1024;
      if (kb < 1024) return kb.toFixed(1) + ' KB';
      return (kb / 1024).toFixed(1) + ' MB';
    },

    visibleRunEvents() {
      return this.selectedRunEvents.filter(ev => this.showVerbose || !this.isBackendEvent(ev));
    },

    isBackendEvent(ev) {
      const t = String(ev?.topic || '');
      return t.startsWith('backend.');
    },

    eventCategory(ev) {
      const t = ev.topic || '';
      if (['event.invalid','wave.timeout','wave.failed','loop.stop'].includes(t)) return 'ev-error';
      if (t === 'task.complete' || t === 'loop.complete') return 'ev-completion';
      if (t.startsWith('review.')) return 'ev-review';
      if (t.startsWith('backend.')) return 'ev-backend';
      if (t.startsWith('iteration.')) return 'ev-system';
      return 'ev-coordination';
    },

    eventClasses(ev) {
      const classes = ['event-item', this.eventCategory(ev)];
      if ((ev.topic || '') === 'iteration.start') classes.push('ev-highlight');
      return classes.join(' ');
    },

    topicCategoryKey(ev) {
      const t = String(ev?.topic || '');
      if (['event.invalid','wave.timeout','wave.failed','loop.stop'].includes(t)) return 'error';
      if (t === 'task.complete' || t === 'loop.complete') return 'completion';
      if (t.startsWith('loop.')) return 'loop';
      if (t.startsWith('iteration.')) return 'iteration';
      if (t.startsWith('backend.')) return 'backend';
      if (t.startsWith('review.')) return 'review';
      if (t.startsWith('operator.')) return 'operator';
      return 'coordination';
    },

    journalCategoryChips() {
      const counts = {};
      for (const k of Object.keys(this.journalCategoryFilter)) counts[k] = 0;
      for (const ev of this.selectedRunEvents) {
        const cat = this.topicCategoryKey(ev);
        if (cat in counts) counts[cat]++;
      }
      const labels = { loop: 'Loop', iteration: 'Iteration', backend: 'Backend', review: 'Review', coordination: 'Coordination', error: 'Error', operator: 'Operator', completion: 'Completion' };
      return Object.keys(this.journalCategoryFilter).map(key => ({
        key,
        label: labels[key] || key,
        color: this.categoryColors[key] || '#666',
        count: counts[key] || 0,
        enabled: this.journalCategoryFilter[key],
      }));
    },

    filteredJournalEvents() {
      const search = (this.journalSearch || '').toLowerCase();
      return this.selectedRunEvents.filter(ev => {
        const cat = this.topicCategoryKey(ev);
        if (!this.journalCategoryFilter[cat]) return false;
        if (search) {
          const text = JSON.stringify(ev).toLowerCase();
          if (!text.includes(search)) return false;
        }
        return true;
      });
    },

    journalGroups() {
      const events = this.filteredJournalEvents();
      const groups = {};
      const order = [];
      for (const ev of events) {
        const iter = ev.iteration;
        const key = iter ? 'iter-' + iter : 'system';
        if (!groups[key]) {
          const label = iter ? '\\u2500\\u2500 iter ' + iter + ' \\u2500\\u2500' : '\\u2500\\u2500 system \\u2500\\u2500';
          groups[key] = { key, label, events: [] };
          order.push(key);
        }
        groups[key].events.push(ev);
      }
      return order.map(k => groups[k]);
    },

    eventSummary(ev) {
      const parts = [];
      if (ev.iteration) parts.push('[iter ' + ev.iteration + ']');
      if (ev.ts) parts.push(this.timeAgo(ev.ts));
      parts.push(ev.topic || JSON.stringify(ev).slice(0, 80));
      const f = ev.fields || {};
      const t = ev.topic || '';
      if (t === 'iteration.start') {
        const hints = [];
        if (f.recent_event) hints.push(f.recent_event);
        if (f.suggested_roles) hints.push('\\u2192 ' + f.suggested_roles);
        if (f.allowed_events) hints.push('\\u00b7 emits ' + f.allowed_events);
        if (f.backpressure && String(f.backpressure) !== 'none' && String(f.backpressure).trim() !== '') {
          hints.push('[BP: ' + f.backpressure + ']');
        }
        if (hints.length) {
          parts.push('\\u2014 ' + hints.join(' '));
        } else if (f.prompt) {
          const objMatch = String(f.prompt).match(/Objective:\\s*\\n?([^\\n]+)/);
          if (objMatch) {
            const preview = objMatch[1].trim().slice(0, 100);
            parts.push('\\u2014 ' + preview + (objMatch[1].trim().length > 100 ? '...' : ''));
          }
        }
      } else if (t === 'review.start') {
        const f = ev.fields || {};
        parts.push('Review Started');
        const hint = [];
        if (f.reason) hint.push(String(f.reason).slice(0, 60));
        if (hint.length) parts.push('\\u2014 ' + hint.join(' '));
      } else if (t === 'review.finish') {
        const f = ev.fields || {};
        parts.push('Review Finished');
        const hint = [];
        if (f.decision) hint.push('decision=' + f.decision);
        if (f.output) hint.push(String(f.output).replace(/\\s+/g, ' ').trim().slice(0, 80));
        if (hint.length) parts.push('\\u2014 ' + hint.join(' '));
      } else if (t === 'iteration.finish' || t === 'backend.finish') {
        const hint = [];
        if (f.exit_code !== undefined) hint.push('exit=' + f.exit_code);
        if (f.timed_out === 'true' || f.timed_out === true) hint.push('TIMEOUT');
        if (f.elapsed_s !== undefined) hint.push(f.elapsed_s + 's');
        if (f.output) hint.push(String(f.output).replace(/\\s+/g, ' ').trim().slice(0, 80));
        if (hint.length) parts.push('\\u2014 ' + hint.join(' '));
      } else if (ev.payload) {
        parts.push('\\u2014 ' + String(ev.payload).slice(0, 60));
      }
      return parts.join(' ');
    },
  };
}
</script>
</body>
</html>`;
}
