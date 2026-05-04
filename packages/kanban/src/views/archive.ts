import type { Task } from "../task_store.js";
import { escapeHtml } from "./_shared.js";

export function renderArchivePage(tasks: Task[], scope: string): string {
  const rows = tasks.length
    ? tasks
        .slice()
        .sort((a, b) =>
          (b.closed ?? b.created).localeCompare(a.closed ?? a.created),
        )
        .map((t) => {
          const closedStamp = t.closed
            ? new Date(t.closed).toLocaleString()
            : "—";
          const mark =
            t.status === "failed"
              ? '<span class="sfail">failed</span>'
              : '<span class="sok">closed</span>';
          const descCell = t.description
            ? `<div class="desc">${escapeHtml(t.description)}</div>`
            : "";
          return `<tr data-id="${t.id}">
  <td class="prio p${t.priority}">P${t.priority}</td>
  <td>${mark}</td>
  <td class="title">${escapeHtml(t.title)}${descCell}</td>
  <td class="scope" title="${escapeHtml(t.scope)}">${escapeHtml(t.scope.split("/").slice(-2).join("/"))}</td>
  <td class="stamp">${escapeHtml(closedStamp)}</td>
  <td><button class="un" onclick="unarchive('${t.id}', this)">↻ unarchive</button></td>
</tr>`;
        })
        .join("")
    : `<tr><td colspan="6" class="empty">Archive empty — press "↓ archive done" on the kanban board to move closed tasks here.</td></tr>`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Autoloop — Archive</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🐸</text></svg>">
<style>
  body{font:13px ui-monospace,Menlo,monospace;background:#1e1e1e;color:#eee;margin:0;padding:0}
  header{padding:10px 16px;border-bottom:1px solid #333;display:flex;gap:16px;align-items:center;flex-wrap:wrap}
  header h1{margin:0;font-size:14px}
  header .scope{color:#888;font-size:11px}
  header a{color:#d9a441;text-decoration:none;font-size:12px}
  header .toggle{color:#888}
  header .toggle.on{color:#d9a441}
  main{padding:12px 16px}
  table{width:100%;border-collapse:collapse}
  th,td{text-align:left;padding:6px 10px;border-bottom:1px solid #2a2a2a;vertical-align:top}
  th{color:#888;font-weight:normal;font-size:11px;border-bottom:1px solid #333}
  tr:hover td{background:#161616}
  td.prio{font-weight:600;color:#888;width:40px}
  td.prio.p1{color:#d55}td.prio.p2{color:#e87}td.prio.p3{color:#d9a441}td.prio.p4{color:#4a7}td.prio.p5{color:#666}
  td.title{max-width:640px}
  td.title .desc{color:#888;font-size:11px;margin-top:3px;white-space:pre-wrap}
  td.scope{color:#888;font-size:11px}
  td.stamp{color:#888;font-size:11px;white-space:nowrap}
  .sok{color:#2d7;font-size:10px}
  .sfail{color:#d55;font-size:10px}
  button.un{background:#1a1a1a;border:1px solid #333;color:#888;padding:3px 8px;border-radius:3px;cursor:pointer;font:inherit;font-size:11px}
  button.un:hover{color:#d9a441;border-color:#d9a441}
  button.un:disabled{opacity:.5;cursor:default}
  td.empty{color:#888;text-align:center;padding:40px}
  .count{background:#111;padding:1px 8px;border-radius:10px;color:#888;font-size:10px;margin-left:6px}
</style>
</head><body>
<header>
  <h1>Autoloop — Archive <span class="count">${tasks.length}</span></h1>
  <span class="scope">scope=${escapeHtml(scope)}</span>
  <a href="?scope=${scope === "all" ? "" : "all"}" class="toggle ${scope === "all" ? "on" : ""}">${scope === "all" ? "→ current scope only" : "→ all scopes"}</a>
  <span style="margin-left:auto"></span>
  <a href="/kanban">← back to kanban</a>
</header>
<main>
<table>
  <thead><tr><th>P</th><th>Status</th><th>Title</th><th>Scope</th><th>Closed</th><th></th></tr></thead>
  <tbody>${rows}</tbody>
</table>
</main>
<script>
async function unarchive(id, btn) {
  btn.disabled = true;
  try {
    const r = await fetch('/api/tasks/' + id + '/unarchive', { method: 'POST' });
    if (r.ok) {
      const row = btn.closest('tr');
      if (row) row.style.transition = 'opacity .2s', row.style.opacity = '0';
      setTimeout(() => row && row.remove(), 200);
    } else {
      btn.disabled = false;
      alert('Unarchive failed');
    }
  } catch (err) {
    btn.disabled = false;
    alert('Unarchive failed: ' + err);
  }
}
window.unarchive = unarchive;
</script>
</body></html>`;
}
