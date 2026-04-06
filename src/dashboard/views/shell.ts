export function htmlShell(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>autoloop dashboard</title>
<style>
:root {
  --bg: #fff; --fg: #1a1a1a; --muted: #666; --border: #e0e0e0;
  --card-bg: #fafafa; --badge-bg: #eee;
  --active: #2563eb; --watching: #d97706; --stuck: #dc2626;
  --failed: #dc2626; --completed: #16a34a;
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
.event-item.ev-error { border-left: 3px solid var(--failed); padding-left: 0.4rem; background: rgba(220,38,38,0.05); }
.event-item.ev-coordination { border-left: 3px solid var(--active); padding-left: 0.4rem; }
.event-item.ev-completion { border-left: 3px solid var(--completed); padding-left: 0.4rem; }
.event-item.ev-system summary { opacity: 0.6; }
.event-item.ev-system:hover summary { opacity: 1; }
.event-field { margin: 0.15rem 0; font-size: 0.7rem; }
.event-field strong { color: var(--muted); margin-right: 0.3rem; }
.event-field pre { display: inline; white-space: pre-wrap; }
.event-field details summary { cursor: pointer; color: var(--muted); font-style: italic; }

.empty { color: var(--muted); font-size: 0.8rem; padding: 0.5rem 0; }
</style>
</head>
<body x-data="dashboard()" x-init="startPolling()">

<header>
  <h1>autoloop dashboard</h1>
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
  <details class="section" :open="cat.items.length > 0 && (cat.key === 'active' || cat.key === 'watching' || cat.key === 'stuck')">
    <summary>
      <span x-text="cat.label"></span>
      <span class="badge" :data-status="cat.key" x-text="cat.items.length"></span>
    </summary>
    <ul class="run-list">
      <template x-for="run in cat.items" :key="run.run_id">
        <li class="run-item" @click="selectRun(run.run_id)">
          <span>
            <span x-text="run.run_id.slice(0, 16)"></span>
            <span style="color:var(--muted)"> &middot; </span>
            <span x-text="run.preset"></span>
            <span style="color:var(--muted)"> &middot; iter </span>
            <span x-text="run.iteration"></span>
          </span>
          <span class="meta">
            <span x-text="run.latest_event || '-'"></span>
            <span style="color:var(--muted)"> &middot; </span>
            <span x-text="timeAgo(run.created_at)"></span>
          </span>
        </li>
      </template>
      <li class="empty" x-show="cat.items.length === 0">None</li>
    </ul>
  </details>
</template>

<div class="detail-pane" x-show="selectedRun" x-cloak>
  <h3 x-text="'Run: ' + (selectedRun || '')"></h3>
  <template x-if="selectedRunDetail">
    <div>
      <div class="field"><label>Status: </label><span x-text="selectedRunDetail.status"></span></div>
      <div class="field"><label>Preset: </label><span x-text="selectedRunDetail.preset"></span></div>
      <div class="field"><label>Objective: </label><span x-text="selectedRunDetail.objective"></span></div>
      <div class="field"><label>Iteration: </label><span x-text="selectedRunDetail.iteration"></span></div>
      <div class="field"><label>Created: </label><span :title="selectedRunDetail.created_at" x-text="timeAgo(selectedRunDetail.created_at) + ' ago'"></span></div>
      <div class="field"><label>Updated: </label><span :title="selectedRunDetail.updated_at" x-text="timeAgo(selectedRunDetail.updated_at) + ' ago'"></span></div>
      <div class="field"><label>Duration: </label><span x-text="runDuration()"></span></div>
      <div class="field"><label>Latest event: </label><span x-text="'[iter ' + selectedRunDetail.iteration + '] ' + selectedRunDetail.latest_event"></span></div>
      <div class="field"><label>Events: </label><span x-text="selectedRunEvents.length"></span></div>
    </div>
  </template>
  <div class="events-list">
    <h3>Events</h3>
    <template x-for="(ev, idx) in selectedRunEvents" :key="idx">
      <details :class="'event-item ' + eventCategory(ev)">
        <summary x-text="eventSummary(ev)"></summary>
        <div style="padding:0.3rem">
          <template x-for="[k,v] in Object.entries(ev)" :key="k">
            <div class="event-field">
              <strong x-text="k + ':'"></strong>
              <template x-if="String(typeof v === 'object' ? JSON.stringify(v,null,2) : v).length <= 200">
                <pre x-text="typeof v === 'object' ? JSON.stringify(v,null,2) : String(v)"></pre>
              </template>
              <template x-if="String(typeof v === 'object' ? JSON.stringify(v,null,2) : v).length > 200">
                <details>
                  <summary x-text="k + ' (' + String(typeof v === 'object' ? JSON.stringify(v,null,2) : v).length + ' chars)'"></summary>
                  <pre style="white-space:pre-wrap;font-size:0.7rem;margin-top:0.2rem" x-text="typeof v === 'object' ? JSON.stringify(v,null,2) : String(v)"></pre>
                </details>
              </template>
            </div>
          </template>
        </div>
      </details>
    </template>
    <p class="empty" x-show="selectedRunEvents.length === 0">No events</p>
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

    get categories() {
      return [
        { key: "active", label: "Active", items: this.runs.active },
        { key: "watching", label: "Watching", items: this.runs.watching },
        { key: "stuck", label: "Stuck", items: this.runs.stuck },
        { key: "failed", label: "Failed", items: this.runs.recentFailed },
        { key: "completed", label: "Completed", items: this.runs.recentCompleted },
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
        this.runs = await res.json();
        this.lastUpdated = new Date().toLocaleTimeString();
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

    eventCategory(ev) {
      const t = ev.topic || '';
      if (['event.invalid','wave.timeout','wave.failed','loop.stop'].includes(t)) return 'ev-error';
      if (t === 'task.complete' || t === 'loop.complete') return 'ev-completion';
      if (t.startsWith('iteration.') || t.startsWith('backend.')) return 'ev-system';
      return 'ev-coordination';
    },

    eventSummary(ev) {
      const parts = [];
      if (ev.iteration) parts.push('[iter ' + ev.iteration + ']');
      if (ev.ts) parts.push(this.timeAgo(ev.ts));
      parts.push(ev.topic || JSON.stringify(ev).slice(0, 80));
      const f = ev.fields || {};
      const t = ev.topic || '';
      if (t === 'iteration.start' && f.suggested_roles) {
        parts.push('\\u2192 ' + f.suggested_roles);
      } else if (t === 'iteration.finish' || t === 'backend.finish') {
        const hint = [];
        if (f.exit_code !== undefined) hint.push('exit=' + f.exit_code);
        if (f.timed_out === 'true' || f.timed_out === true) hint.push('TIMEOUT');
        if (f.elapsed_s !== undefined) hint.push(f.elapsed_s + 's');
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
