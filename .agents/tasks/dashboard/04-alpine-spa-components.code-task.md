# Task 4: Alpine.js SPA Components & Interactivity

**RFC:** `docs/rfcs/dashboard.md`
**Files to modify:** `src/dashboard/views/shell.ts`
**Files to create:** `src/dashboard/views/components.ts` (optional — can inline in shell.ts)
**Estimated scope:** ~200 lines added/modified

## Objective

Replace the placeholder sections in the HTML shell with functional Alpine.js components: chat box, run list, and detail pane. Wire up polling, run selection, and loop-start form submission.

## Prerequisites

- Task 2 complete (API routes serving data).
- Task 3 complete (SPA shell rendering in browser).

## Steps

### 1. Implement `dashboard()` Alpine.js data function

Replace the stub in `shell.ts` `<script>` block with the full implementation from the RFC:

```javascript
function dashboard() {
  return {
    runs: { active: [], stuck: [], recent_failed: [], recent_completed: [] },
    presets: [],
    selectedRun: null,
    selectedRunEvents: [],
    newPrompt: "",
    selectedPreset: "",
    selectedBackend: "",
    pollInterval: null,
    lastUpdated: null,

    async startPolling() {
      await this.fetchPresets();
      await this.fetchRuns();
      this.pollInterval = setInterval(() => this.fetchRuns(), 3000);
    },

    async fetchRuns() {
      const res = await fetch("/api/runs");
      this.runs = await res.json();
      this.lastUpdated = new Date().toLocaleTimeString();
      // If selected run is still visible, refresh its events
      if (this.selectedRun) this.fetchEvents(this.selectedRun);
    },

    async fetchPresets() {
      const res = await fetch("/api/presets");
      const data = await res.json();
      this.presets = data.presets;
      if (this.presets.length && !this.selectedPreset) {
        this.selectedPreset = this.presets[0].name;
      }
    },

    async selectRun(runId) {
      this.selectedRun = runId;
      await this.fetchEvents(runId);
    },

    async fetchEvents(runId) {
      const res = await fetch(`/api/runs/${runId}/events`);
      const data = await res.json();
      this.selectedRunEvents = data.events;
    },

    async startLoop() {
      if (!this.newPrompt.trim()) return;
      await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: this.newPrompt,
          preset: this.selectedPreset,
          backend: this.selectedBackend || undefined,
        }),
      });
      this.newPrompt = "";
      // Immediate refresh to show the new run
      setTimeout(() => this.fetchRuns(), 1000);
    },

    allRuns() {
      return [
        ...this.runs.active,
        ...this.runs.stuck,
        ...this.runs.recent_failed,
        ...this.runs.recent_completed,
      ];
    },
  };
}
```

### 2. Chat box section

Replace the `#chatbox` placeholder:

```html
<section id="chatbox">
  <form @submit.prevent="startLoop()">
    <select x-model="selectedPreset">
      <template x-for="p in presets" :key="p.name">
        <option :value="p.name" x-text="p.name"></option>
      </template>
    </select>
    <input type="text" x-model="newPrompt"
           placeholder="Enter a prompt to start a loop..."
           autofocus>
    <button type="submit" :disabled="!newPrompt.trim()">Start</button>
  </form>
</section>
```

### 3. Run list section

Replace the `#runlist` placeholder:

```html
<section id="runlist">
  <div class="status-summary">
    <span data-status="active">Active: <span x-text="runs.active.length"></span></span>
    <span data-status="stuck">Stuck: <span x-text="runs.stuck.length"></span></span>
  </div>
  <table>
    <thead>
      <tr><th>ID</th><th>Preset</th><th>Iter</th><th>Last Event</th><th>Age</th></tr>
    </thead>
    <tbody>
      <template x-for="run in allRuns()" :key="run.run_id">
        <tr @click="selectRun(run.run_id)"
            :class="{ 'selected': selectedRun === run.run_id }"
            :data-status="run.status">
          <td x-text="run.run_id.slice(0, 8)" data-mono></td>
          <td x-text="run.preset"></td>
          <td x-text="run.iteration ?? '-'"></td>
          <td x-text="run.last_event ?? '-'"></td>
          <td x-text="run.age ?? '-'"></td>
        </tr>
      </template>
    </tbody>
  </table>
</section>
```

**Note:** The exact field names (`run.preset`, `run.iteration`, `run.last_event`, `run.age`) depend on what `categorizeRuns()` returns in `RunRecord`. Check the `RunRecord` type and adjust field names to match. Key fields from the existing schema: `run_id`, `preset`, `iteration`, `status`, `started_at`.

For "age", compute client-side from `started_at`:
```javascript
// Helper in the script block
function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (s < 60) return s + "s";
  if (s < 3600) return Math.floor(s / 60) + "m";
  return Math.floor(s / 3600) + "h";
}
```

### 4. Detail pane section

Replace the `#detail` placeholder:

```html
<section id="detail" x-show="selectedRun">
  <h2>Run: <span x-text="selectedRun" data-mono></span></h2>
  <template x-if="selectedRun">
    <div>
      <dl>
        <template x-for="run in allRuns().filter(r => r.run_id === selectedRun)">
          <div>
            <dt>Status</dt><dd x-text="run.status"></dd>
            <dt>Preset</dt><dd x-text="run.preset"></dd>
            <dt>Iteration</dt><dd x-text="run.iteration ?? '-'"></dd>
            <dt>Started</dt><dd x-text="run.started_at"></dd>
          </div>
        </template>
      </dl>
      <h3>Events</h3>
      <div class="events-list">
        <template x-for="(evt, i) in selectedRunEvents" :key="i">
          <div class="event-line" data-mono>
            <span x-text="evt.topic ?? evt.type ?? 'event'"></span>
            <span x-text="evt.iteration ? 'iter:' + evt.iteration : ''"></span>
            <span x-text="evt.summary ?? ''"></span>
          </div>
        </template>
      </div>
    </div>
  </template>
</section>
```

**Note:** Event field names (`evt.topic`, `evt.type`, `evt.iteration`, `evt.summary`) depend on the journal line format. Check `readRunLines()` output shape and adjust.

### 5. Last-updated indicator in header

```html
<header>
  <h1>autoloop dashboard</h1>
  <span x-show="lastUpdated" x-text="'Updated: ' + lastUpdated"></span>
</header>
```

## Testing

- Page loads and immediately shows the chat box with preset dropdown.
- After 3s, run list populates from the API.
- Clicking a run highlights it and shows detail pane with events.
- Typing a prompt and clicking Start sends POST and clears the input.
- New loop appears in the run list within ~4 seconds of starting.
- No `x-html` or `innerHTML` used anywhere (XSS safety).

## Acceptance Criteria

- All three interactive zones (chat, run list, detail) are functional.
- Polling refreshes the run list every 3 seconds.
- `x-text` used exclusively for dynamic content (no XSS vectors).
- Layout matches the RFC wireframe structure.
- No JavaScript build step — all code is inline in the HTML template.
