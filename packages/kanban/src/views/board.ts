import {
  HIDDEN_COLUMNS,
  type KanbanColumn,
  type Task,
  VISIBLE_COLUMNS,
} from "../task_store.js";
import { resolveRepoRoot } from "../worktree.js";
import { COLUMN_LABEL, escapeHtml, resolveColumn } from "./_shared.js";
import { renderCard } from "./card.js";
import { CLIENT_JS } from "./client.js";

function lastActivityMs(t: Task): number {
  const candidates = [
    t.closed,
    t.autoloop?.last_active,
    t.comment?.at,
    (t as { error?: { at?: string } }).error?.at,
    t.started,
    t.created,
  ];
  let max = 0;
  for (const c of candidates) {
    if (!c) continue;
    const n = Date.parse(c);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max;
}

const DONE_LIKE_COLUMNS = new Set<KanbanColumn>(["done", "cancelled"]);

export function renderPage(
  tasks: Task[],
  scope: string,
  showHidden: boolean,
): string {
  const columns = showHidden
    ? [...VISIBLE_COLUMNS, ...HIDDEN_COLUMNS]
    : VISIBLE_COLUMNS;
  const byCol = new Map<KanbanColumn, Task[]>();
  for (const c of columns) byCol.set(c, []);
  for (const t of tasks) {
    const col = resolveColumn(t);
    const bucket = byCol.get(col);
    if (bucket) bucket.push(t);
  }
  for (const col of DONE_LIKE_COLUMNS) {
    const arr = byCol.get(col);
    if (arr) arr.sort((a, b) => lastActivityMs(b) - lastActivityMs(a));
  }
  const gitCache = new Map<string, boolean>();
  const scopeIsGit = (s: string): boolean => {
    if (!s) return false;
    const cached = gitCache.get(s);
    if (cached !== undefined) return cached;
    let ok = false;
    try {
      ok = Boolean(resolveRepoRoot(s));
    } catch {
      ok = false;
    }
    gitCache.set(s, ok);
    return ok;
  };
  const currentScopeIsGit = scopeIsGit(scope);
  const totalCards = tasks.length;
  const emptyBanner =
    totalCards === 0
      ? `<div style="grid-column:1/-1;padding:40px;text-align:center;color:#888">
  <div style="font-size:22px;margin-bottom:8px;color:#d9a441">No tasks yet</div>
  <div style="font-size:13px;margin-bottom:16px">Type a title above and click Add to create your first task.</div>
  <div style="font-size:11px;color:#666">Kanban columns are dispatch lanes — Backlog → Todo → In progress → Human review → Done.</div>
</div>`
      : "";
  const cols = columns
    .map((col) => {
      const bucket = byCol.get(col) ?? [];
      const cards =
        bucket.map((t) => renderCard(t, scopeIsGit)).join("") ||
        '<div class="empty">—</div>';
      return `
<div class="col" data-col="${col}">
  <h3>${COLUMN_LABEL[col]} <span class="count">${bucket.length}</span></h3>
  <div class="col-body">${cards}</div>
</div>`;
    })
    .join("");

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Autoloop Kanban</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🐸</text></svg>">
<style>
  body{font:13px ui-monospace,Menlo,monospace;background:#1e1e1e;color:#eee;margin:0;padding:0;height:100vh;display:flex;flex-direction:column}
  *{scrollbar-width:thin;scrollbar-color:#3a3a3a transparent}
  *:hover{scrollbar-color:#d9a441 transparent}
  ::-webkit-scrollbar{width:10px;height:10px}
  ::-webkit-scrollbar-track{background:transparent}
  ::-webkit-scrollbar-thumb{background:#2a2a2a;border:2px solid transparent;background-clip:content-box;border-radius:6px;transition:background .15s}
  ::-webkit-scrollbar-thumb:hover{background:#d9a441;background-clip:content-box}
  ::-webkit-scrollbar-thumb:active{background:#e8b452;background-clip:content-box}
  ::-webkit-scrollbar-corner{background:transparent}
  button{font:inherit}
  header{padding:10px 16px;border-bottom:1px solid #333;display:flex;gap:16px;align-items:center;flex-shrink:0;flex-wrap:wrap}
  header h1{margin:0;font-size:14px}
  header .scope{color:#888;font-size:11px}
  header a{color:#d9a441;text-decoration:none;font-size:12px}
  header a.toggle{color:#888}
  header a.toggle.on{color:#d9a441}
  header button#archive-done-btn{background:#1a1a1a;border:1px solid #333;color:#888;padding:3px 10px;border-radius:4px;cursor:pointer;font-size:11px}
  header button#archive-done-btn:hover{color:#d9a441;border-color:#d9a441}
  header button#archive-done-btn:disabled{cursor:default;opacity:.7}
  #new-task{display:flex;gap:6px;flex-wrap:wrap}
  #new-task input,#new-task select{background:#111;border:1px solid #333;color:#eee;padding:4px 8px;font:inherit;border-radius:4px}
  #new-task input[name=title]{width:240px}
  #new-task input[name=description]{width:160px}
  #new-task select{width:70px}
  #new-task button{background:#d9a441;border:0;color:#111;padding:4px 10px;border-radius:4px;cursor:pointer;font:inherit;font-weight:600}
  #new-task .wt-toggle{background:#1a1a1a;border:1px solid #333;color:#888;padding:3px 10px;border-radius:4px;cursor:pointer;font:inherit;font-size:11px;user-select:none;display:inline-flex;align-items:center;gap:4px}
  #new-task .wt-toggle:hover{border-color:#d9a441;color:#d9a441}
  #new-task .wt-toggle[aria-pressed="true"]{background:#2a1e0e;border-color:#d9a441;color:#d9a441}
  #new-task .wt-toggle[disabled]{opacity:.4;cursor:not-allowed;color:#555;border-color:#2a2a2a}
  #new-task .wt-toggle[disabled]:hover{border-color:#2a2a2a;color:#555}
  .card-wt{background:transparent;border:1px solid #333;color:#666;padding:0 5px;border-radius:3px;font-size:9px;cursor:pointer;line-height:14px;user-select:none;letter-spacing:.5px}
  .card-wt:hover{border-color:#d9a441;color:#d9a441}
  .card-wt[data-on="true"]{background:#2a1e0e;border-color:#d9a441;color:#d9a441}
  .card-wt[data-on="true"]::before{content:"◉ "}
  .card-wt[data-on="false"]::before{content:"○ "}
  #filter-bar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-left:auto;margin-right:0}
  #search{background:#111;border:1px solid #333;color:#eee;padding:4px 8px 4px 24px;font:inherit;border-radius:4px;width:180px;background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='%23888'><path d='M9 3a6 6 0 104.47 10.03l3.25 3.25 1.06-1.06-3.25-3.25A6 6 0 009 3zm0 2a4 4 0 110 8 4 4 0 010-8z'/></svg>");background-repeat:no-repeat;background-position:6px center;background-size:14px}
  .chips{display:flex;gap:2px}
  .chip{background:#111;border:1px solid #333;color:#888;padding:2px 7px;border-radius:3px;font-size:10px;cursor:pointer;user-select:none}
  .chip:hover{color:#ddd}
  .chip.on{background:#d9a441;border-color:#d9a441;color:#111;font-weight:600}
  .chip-state.on{background:#2d7;border-color:#2d7;color:#111}
  .chip-state[data-state=crashed].on{background:#d55;border-color:#d55}
  .chip-state[data-state=idle].on{background:#d9a441;border-color:#d9a441}
  .chip-state[data-state=detached].on{background:#666;border-color:#666;color:#eee}
  #help-btn{background:transparent;border:1px solid #333;color:#888;width:22px;height:22px;border-radius:11px;cursor:pointer;font-size:10px}
  #help-btn:hover{color:#eee;border-color:#555}
  main{flex:1;display:flex;overflow:hidden}
  #board{flex:1;min-width:0;display:grid;grid-template-columns:repeat(${columns.length},minmax(140px,1fr));grid-auto-rows:1fr;gap:10px;padding:12px;overflow:auto;align-content:stretch}
  .col{background:#161616;border:1px solid #2a2a2a;border-radius:6px;display:flex;flex-direction:column;min-height:0;transition:all .15s ease}
  .col h3{margin:0;padding:8px 10px;font-size:12px;color:#d9a441;border-bottom:1px solid #2a2a2a;display:flex;gap:8px;align-items:center}
  .col h3 .count{background:#111;padding:1px 8px;border-radius:10px;color:#888;font-size:10px;margin-left:auto}
  .col-body{flex:1;padding:8px;overflow:auto;min-height:100px}
  .col.collapsed{overflow:hidden}
  .col.collapsed h3{writing-mode:vertical-rl;transform:rotate(180deg);padding:10px 6px;border-bottom:0;white-space:nowrap;gap:6px}
  .col.collapsed h3 .count{margin-left:0}
  .col.collapsed .col-body{display:none}
  .card{background:#111;border:1px solid #333;border-left:3px solid #444;border-radius:4px;padding:8px;margin-bottom:6px;cursor:grab;transition:border-color .1s, box-shadow .1s}
  .card:active{cursor:grabbing}
  .card:hover{border-color:#555}
  .card.active{border-color:#d9a441;box-shadow:0 0 0 1px #d9a441 inset;cursor:pointer}
  .card.kbd-focus{outline:2px solid #539fe5;outline-offset:-2px}
  .card.dragging{opacity:.5;cursor:grabbing}
  .card.filtered-out{display:none}
  .card[data-prio="1"]{border-left-color:#d55}
  .card[data-prio="2"]{border-left-color:#e87}
  .card[data-prio="3"]{border-left-color:#d9a441}
  .card[data-prio="4"]{border-left-color:#4a7}
  .card[data-prio="5"]{border-left-color:#555}
  .card-head{display:flex;gap:8px;align-items:flex-start}
  .card-play{margin-left:auto;background:#1a1a1a;border:1px solid #444;color:#2d7;width:22px;height:22px;border-radius:4px;font-size:9px;line-height:1;cursor:pointer;padding:0;flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center}
  .card-play:hover{background:#133;border-color:#2d7;color:#6fc}
  .card-play:active{transform:scale(.95)}
  .card-play.busy{color:#666;border-color:#333;cursor:progress}
  .card-play.ok{color:#6fc;border-color:#2d7}
  .card[data-state="running"] .card-play,.card[data-state="idle"] .card-play,.card[data-state="starting"] .card-play{display:none}
  .card[data-state="running"] .card-open,.card[data-state="idle"] .card-open,.card[data-state="starting"] .card-open{margin-left:auto}
  .state-starting{color:#2d7}
  .state-starting .state-rt::before{content:'starting… '}
  .card-open{background:#1a1a1a;border:1px solid #444;color:#d9a441;width:28px;height:22px;border-radius:4px;font-size:10px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-weight:700;letter-spacing:-1px;line-height:1;cursor:pointer;padding:0;flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center}
  .card-open:hover{background:#222;border-color:#d9a441;color:#ffce63}
  .card-open:active{transform:scale(.95)}
  .card-archive{display:none;background:#1a1a1a;border:1px solid #444;color:#888;width:22px;height:22px;border-radius:4px;font-size:11px;line-height:1;cursor:pointer;padding:0;flex:0 0 auto;align-items:center;justify-content:center}
  .col[data-col="done"] .card-archive,
  .col[data-col="cancelled"] .card-archive{display:inline-flex}
  .card-archive:hover{background:#222;border-color:#d9a441;color:#d9a441}
  .card-archive:active{transform:scale(.95)}
  .card-archive.busy{color:#666;border-color:#333;cursor:progress}
  .prio{background:#222;padding:0 5px;border-radius:3px;font-size:10px;color:#d9a441}
  .prio-1{background:#4a1a1a;color:#f77}
  .prio-2{background:#3a2516;color:#fa9}
  .prio-3{background:#3a2d0e;color:#ec6}
  .prio-4{background:#1a3a2a;color:#7c9}
  .prio-5{background:#222;color:#888}
  .title{flex:1;min-width:0;font-weight:600;color:#eee;white-space:normal;overflow-wrap:anywhere;word-break:break-word;line-height:1.25}
  .state{margin-left:auto;font-size:9px;display:inline-flex;align-items:center;gap:3px;color:#888}
  .state-rt{font-size:9px;color:#666;font-weight:normal}
  .state-running{color:#2d7}
  .state-idle{color:#d9a441}
  .state-paused{color:#888}
  .state-crashed{color:#d55}
  .state-detached{color:#666}
  .state-none{color:#333}
  .desc{color:#888;font-size:11px;margin-top:4px;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word}
  body.compact .desc{display:none}
  body.compact .card{padding:6px 8px}
  body.compact .comment{max-width:14px;overflow:hidden;white-space:nowrap;color:transparent}
  body.compact .comment::before{content:'💬';color:#8ab}
  #btn-compact{background:transparent;border:1px solid #333;color:#888;padding:0 8px;height:22px;border-radius:4px;cursor:pointer;font-size:11px;line-height:1}
  #btn-compact:hover{color:#eee;border-color:#555}
  #btn-compact.on{color:#d9a441;border-color:#d9a441}
  .comment{color:#8ab;font-size:11px;font-style:italic;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .preview{margin-top:6px;padding-top:6px;border-top:1px dashed #2a2a2a;font-size:10px;min-height:14px}
  .preview-empty{color:#444;font-style:italic;font-size:10px}
  .preview-empty::before{content:'no session yet — click to start'}
  .card[data-state="starting"] .preview-empty{color:#2d7}
  .card[data-state="starting"] .preview-empty::before{content:'starting… waiting for first output'}
  .card[data-state="running"] .preview-empty{color:#2d7}
  .card[data-state="running"] .preview-empty::before{content:'running… waiting for first output'}
  .card[data-state="idle"] .preview-empty{color:#d9a441}
  .card[data-state="idle"] .preview-empty::before{content:'idle — no output yet'}
  .card[data-state="detached"] .preview-empty::before{content:'detached — click play to resume'}
  .card[data-state="crashed"] .preview-empty{color:#d55}
  .card[data-state="crashed"] .preview-empty::before{content:'crashed — click play to retry'}
  .ev{display:flex;gap:6px;color:#bbb;margin:1px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .evi{flex-shrink:0;width:14px;text-align:center}
  .evl{color:#888;min-width:48px;max-width:96px;overflow:hidden;text-overflow:ellipsis;flex-shrink:0}
  .evt{color:#ccc;overflow:hidden;text-overflow:ellipsis}
  .ev-user .evl{color:#d9a441}
  .ev-assistant .evl{color:#7aa}
  .ev-tool_call .evl{color:#da7}
  .ev-tool_result .evl{color:#2d7}
  .empty{color:#555;text-align:center;padding:20px;font-size:11px}
  #side{position:fixed;left:0;right:0;bottom:0;height:0;max-height:0;overflow:hidden;transition:max-height .18s,height .18s;border-top:2px solid #333;background:#0a0a0a;display:flex;flex-direction:column;box-shadow:0 -8px 24px rgba(0,0,0,.4);z-index:50}
  #side.open{height:auto;max-height:45vh}
  #side.resizing{transition:none}
  body.ov-open main{padding-bottom:calc(var(--ov-h,45vh) + 2px)}
  #ov-handle{position:absolute;top:-3px;left:0;right:0;height:6px;cursor:ns-resize;z-index:51}
  #ov-handle:hover,#ov-handle.dragging{background:#d9a44144}
  #ov-handle::after{content:"";position:absolute;top:2px;left:50%;transform:translateX(-50%);width:40px;height:2px;background:#444;border-radius:1px}
  #ov-handle:hover::after,#ov-handle.dragging::after{background:#d9a441}
  #side-head{padding:8px 10px;border-bottom:1px solid #2a2a2a;display:flex;flex-direction:column;gap:6px;flex-shrink:0}
  #side-title-row{display:flex;gap:8px;align-items:center;min-height:24px}
  #stitle{flex:1;min-width:0;font-weight:600;white-space:normal;overflow-wrap:anywhere;word-break:break-word;line-height:1.25}
  #side-state{font-size:10px;color:#888;display:inline-flex;align-items:center;gap:4px;padding:2px 6px;border-radius:3px;background:#111}
  #side-state.state-running{color:#2d7}
  #side-state.state-idle{color:#d9a441}
  #side-state.state-crashed{color:#d55}
  #side-state.state-detached{color:#666}
  #side-toolbar{display:flex;gap:4px;align-items:center;flex-wrap:wrap}
  #side-toolbar select{background:#111;border:1px solid #2a2a2a;color:#ddd;padding:2px 4px;border-radius:3px;font:10px ui-monospace,Menlo,monospace}
  #side-toolbar .tb-btn{background:transparent;border:1px solid #2a2a2a;color:#888;cursor:pointer;font-size:11px;padding:3px 8px;border-radius:3px;line-height:1}
  #side-toolbar .tb-btn:hover{color:#eee;border-color:#555}
  #side-toolbar .tb-btn.warn:hover{color:#d55;border-color:#d55}
  #side-toolbar .tb-sep{width:1px;height:16px;background:#2a2a2a;margin:0 3px}
  #side-toolbar .tb-spacer{flex:1}
  #side-status{font-size:9px;color:#666;display:flex;gap:10px;flex-wrap:wrap}
  #side-status .muted{color:#555}
  #side-term{flex:1;min-height:0;background:#000;position:relative}
  #side-term.hidden{display:none}
  #pane-row{flex:1;min-height:0;display:flex;flex-direction:row;overflow:hidden}
  .pane{flex:1 1 0;min-width:200px;display:flex;flex-direction:column;background:#0a0a0a;overflow:hidden;position:relative}
  .pane-head{padding:4px 8px;font-size:10px;display:flex;gap:6px;align-items:center;background:#111;border-bottom:1px solid #222;flex-shrink:0}
  .pane-head .pt{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#aaa}
  .pane-head .ps{font-size:9px;color:#666}
  .pane-head .pc{background:transparent;border:0;color:#666;cursor:pointer;padding:0 4px;font-size:12px;line-height:1}
  .pane-head .pc:hover{color:#d55}
  .pane.active .pane-head{background:#1a1a1a;border-bottom-color:#d9a441;color:#eee}
  .pane.active .pane-head .pt{color:#eee}
  .pane-body{flex:1;min-height:0;background:#000;position:relative}
  .pane-sep{flex:0 0 4px;background:#222;cursor:ew-resize;position:relative;z-index:2}
  .pane-sep:hover,.pane-sep.dragging{background:#d9a441}
  #side-empty{flex:1;color:#555;display:flex;align-items:center;justify-content:center;font-size:11px;padding:20px;text-align:center}
  #live{color:#888;font-size:10px}
  #live.pulse::before{content:"●";display:inline-block;color:#2d7;margin-right:3px;animation:pulse 1.8s ease-in-out infinite}
  @keyframes pulse{0%,100%{opacity:.3}50%{opacity:1}}
  .drop-target{background:#1a2a1a}
  #kb-help{position:fixed;inset:0;background:rgba(0,0,0,.75);display:none;align-items:center;justify-content:center;z-index:100}
  #kb-help.open{display:flex}
  #kb-help-box{background:#161616;border:1px solid #d9a441;border-radius:8px;padding:20px 28px;max-width:520px;color:#eee;font-size:11px;line-height:1.7}
  #kb-help-box h2{margin:0 0 10px;color:#d9a441;font-size:13px}
  #kb-help-box kbd{background:#222;border:1px solid #444;padding:1px 6px;border-radius:3px;font:10px ui-monospace,Menlo,monospace;color:#ddd;margin:0 2px}
  #kb-help-box table{border-collapse:collapse;width:100%}
  #kb-help-box td{padding:3px 8px;vertical-align:top}
  #kb-help-box td:first-child{text-align:right;white-space:nowrap;width:35%}
  #kb-help-close{color:#888;font-size:10px;margin-top:10px;text-align:center}
  .ktoast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%) translateY(20px);background:#d9a441;color:#000;padding:6px 14px;border-radius:6px;font:11px ui-monospace,Menlo,monospace;pointer-events:none;opacity:0;transition:opacity .15s,transform .15s;z-index:200;box-shadow:0 2px 10px rgba(0,0,0,.5)}
  .ktoast.show{opacity:1;transform:translateX(-50%) translateY(0)}
</style>
</head><body>
<header>
  <h1>Autoloop Kanban</h1>
  <span class="scope">scope=${escapeHtml(scope)}</span>
  <form id="new-task" onsubmit="return addTask(event)">
    <input name="title" placeholder="New task title…" required>
    <input name="description" placeholder="Description (optional)">
    <select name="priority" title="Priority (1=highest)">
      <option value="1">P1</option>
      <option value="2">P2</option>
      <option value="3" selected>P3</option>
      <option value="4">P4</option>
      <option value="5">P5</option>
    </select>
    <button type="submit">Add</button>
    <button type="button" class="wt-toggle" id="wt-toggle" aria-pressed="false"${currentScopeIsGit ? "" : " disabled"} title="${currentScopeIsGit ? "Opt this task in to a git worktree — default off" : "Worktree requires a git repository; current scope is not a git repo"}" onclick="toggleWorktree(event)">○ wt</button>
  </form>
  <div id="filter-bar">
    <input id="search" type="search" placeholder="search… (/)" aria-label="Filter tasks by text">
    <div class="chips" id="prio-chips" title="Filter by priority">
      <span class="chip" data-prio="1">P1</span><span class="chip" data-prio="2">P2</span><span class="chip" data-prio="3">P3</span><span class="chip" data-prio="4">P4</span><span class="chip" data-prio="5">P5</span>
    </div>
    <div class="chips" id="state-chips" title="Filter by agent state">
      <span class="chip chip-state" data-state="running">run</span><span class="chip chip-state" data-state="idle">idle</span><span class="chip chip-state" data-state="crashed">crashed</span><span class="chip chip-state" data-state="detached">det</span>
    </div>
    <a href="/kanban?hidden=${showHidden ? "0" : "1"}" class="toggle ${showHidden ? "on" : ""}">${showHidden ? "hide closed" : "show closed"}</a>
    <button id="archive-done-btn" type="button" title="Move all closed/failed tasks in this scope to the archive" onclick="archiveDone()">↓ archive done</button>
    <a href="/archive" title="Browse archived tasks">→ archive</a>
    <span id="live" class="pulse">live</span>
    <button id="btn-compact" type="button" title="Compact mode — hide descriptions (Shift+D)" aria-pressed="false" onclick="toggleCompact()">≡ compact</button>
    <button id="help-btn" type="button" title="Keyboard shortcuts (?)" onclick="toggleHelp()">?</button>
  </div>
</header>
<main>
  <div id="board">${totalCards === 0 ? emptyBanner : cols}</div>
</main>
<aside id="side">
  <div id="ov-handle" title="Drag to resize · or +/− keys"></div>
  <div id="side-head">
    <div id="side-title-row">
      <span id="stitle"></span>
      <span id="side-state" class="state-detached" title="agent state">○ detached</span>
    </div>
    <div id="side-toolbar">
      <select id="sb-prio" title="Priority" aria-label="Priority">
        <option value="1">P1</option><option value="2">P2</option><option value="3">P3</option><option value="4">P4</option><option value="5">P5</option>
      </select>
      <select id="sb-col" title="Move to column" aria-label="Column">
        <option value="backlog">Backlog</option><option value="in_progress">In progress</option><option value="human_review">Human review</option><option value="rework">Rework</option><option value="merging">Merging</option><option value="done">Done</option><option value="cancelled">Cancelled</option>
      </select>
      <span class="tb-sep"></span>
      <button class="tb-btn" id="sb-restart" title="Restart run (R) — kills tmux session and respawns autoloop">⟳ restart</button>
      <button class="tb-btn warn" id="sb-kill" title="End run (K) — kills autoloop and the tmux session. Transcript preserved.">✕ end</button>
      <span class="tb-sep"></span>
      <button class="tb-btn" id="sb-bottom" title="Scroll terminal to bottom (End)">⇊ bottom</button>
      <button class="tb-btn" id="sb-copy" title="Copy last 200 lines to clipboard">⧉ copy</button>
      <button class="tb-btn" id="sb-fullscreen" title="Open terminal in a new tab at full-window size">⤢ new tab</button>
      <span class="tb-spacer"></span>
      <button class="tb-btn" id="sb-detach" title="Detach (Esc) — closes panel, tmux session keeps running">↓ detach</button>
    </div>
    <div id="side-status">
      <span id="ss-tmux" class="muted">tmux: —</span>
      <span id="ss-activity" class="muted">—</span>
      <span id="ss-persist" class="muted" title="tmux persists across panel close and dashboard restart">◉ persisted</span>
    </div>
  </div>
  <div id="pane-row"></div>
  <div id="side-empty">Click a card to open its terminal. Click multiple to open them side-by-side (up to 6).<br><span style="color:#444;font-size:10px">Press <kbd style="background:#222;border:1px solid #444;padding:1px 5px;border-radius:3px">?</kbd> for shortcuts.</span></div>
</aside>
<div id="kb-help" onclick="if(event.target.id==='kb-help')toggleHelp()">
  <div id="kb-help-box">
    <h2>Keyboard shortcuts</h2>
    <table>
      <tr><td><kbd>j</kbd> <kbd>k</kbd> / <kbd>↑</kbd> <kbd>↓</kbd></td><td>focus prev / next card</td></tr>
      <tr><td><kbd>h</kbd> <kbd>l</kbd> / <kbd>←</kbd> <kbd>→</kbd></td><td>move focused card across columns</td></tr>
      <tr><td><kbd>Enter</kbd></td><td>open attached terminal</td></tr>
      <tr><td><kbd>Esc</kbd></td><td>detach panel (tmux stays alive)</td></tr>
      <tr><td><kbd>1</kbd>…<kbd>5</kbd></td><td>set priority on focused card</td></tr>
      <tr><td><kbd>d</kbd></td><td>drop card to Done</td></tr>
      <tr><td><kbd>x</kbd></td><td>drop card to Cancelled</td></tr>
      <tr><td><kbd>r</kbd></td><td>move card to Rework</td></tr>
      <tr><td><kbd>n</kbd></td><td>focus "new task" input</td></tr>
      <tr><td><kbd>/</kbd></td><td>focus search</td></tr>
      <tr><td><kbd>+</kbd> <kbd>-</kbd></td><td>grow / shrink terminal overlay</td></tr>
      <tr><td><kbd>Shift</kbd>+<kbd>D</kbd></td><td>toggle compact mode (hide descriptions)</td></tr>
      <tr><td><kbd>?</kbd></td><td>toggle this overlay</td></tr>
    </table>
    <div id="kb-help-close">click anywhere or press <kbd>?</kbd>/<kbd>Esc</kbd> to close</div>
  </div>
</div>
<script type="module">${CLIENT_JS}</script>
</body></html>`;
}
