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
.event-item.ev-highlight { border-left-color: var(--active); }
.event-item.ev-system summary { opacity: 0.6; }
.event-item.ev-highlight summary { opacity: 1; }
.event-item.ev-system:hover summary { opacity: 1; }
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
            <span x-text="run.iteration + '/' + (run.max_iterations || '?')"></span>
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
      <div class="field"><label>Iteration: </label><span x-text="selectedRunDetail.iteration + '/' + (selectedRunDetail.max_iterations || '?')"></span></div>
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
      if (ev.topic === 'iteration.start' && ev.fields && typeof ev.fields === 'object') {
        const entries = [];
        for (const [k, v] of Object.entries(ev)) {
          if (k === 'fields') continue;
          entries.push([k, v]);
        }
        const fieldKeys = ['recent_event', 'suggested_roles', 'allowed_events', 'backpressure', 'prompt'];
        for (const fk of fieldKeys) {
          if (ev.fields[fk] !== undefined) {
            entries.push([fk, ev.fields[fk]]);
          }
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

    eventCategory(ev) {
      const t = ev.topic || '';
      if (['event.invalid','wave.timeout','wave.failed','loop.stop'].includes(t)) return 'ev-error';
      if (t === 'task.complete' || t === 'loop.complete') return 'ev-completion';
      if (t.startsWith('iteration.') || t.startsWith('backend.')) return 'ev-system';
      return 'ev-coordination';
    },

    eventClasses(ev) {
      const classes = ['event-item', this.eventCategory(ev)];
      if ((ev.topic || '') === 'iteration.start') classes.push('ev-highlight');
      return classes.join(' ');
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
