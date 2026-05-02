import type { Task } from "../task_store.js";
import { escapeHtml } from "./_shared.js";

export function renderFullscreenTerm(task: Task): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(task.title)} — autoloop</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🐸</text></svg>">
<style>
  html,body{margin:0;padding:0;height:100vh;background:#000;color:#eee;font:12px ui-monospace,Menlo,monospace;overflow:hidden}
  #hdr{padding:6px 12px;background:#111;border-bottom:1px solid #333;display:flex;gap:12px;align-items:center;font-size:11px}
  #hdr .title{flex:1;color:#eee;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  #hdr .sub{color:#888}
  #term{position:absolute;top:30px;left:0;right:0;bottom:0;background:#000}
</style></head><body>
<div id="hdr"><span class="title">${escapeHtml(task.title)}</span><span class="sub">tmux: kanban-${escapeHtml(task.id)}</span><a href="/kanban" style="color:#d9a441;text-decoration:none">← board</a></div>
<div id="term"></div>
<script type="module">
// TODO(slice-9): ghostty-web asset is not yet bundled; WS upgrade handler lands in slice 9.
const term = document.getElementById('term');
const mod = await import('/ghostty/ghostty-web.js?v=fullscreen');
await mod.init();
const t = new mod.Terminal({ fontSize: 12, scrollback: 10000 });
const fit = new mod.FitAddon();
t.loadAddon(fit);
// Same alt-screen wheel→SGR-mouse bridge as the panel terminals. See the
// pane-mount for rationale; ws is defined a few lines below.
let __ws;
t.attachCustomWheelEventHandler((e) => {
  const alt = t.wasmTerm?.isAlternateScreen?.();
  if (!alt) return false;
  const rect = term.getBoundingClientRect();
  const cw = t.renderer?.charWidth || 8;
  const ch = t.renderer?.charHeight || 15;
  const col = Math.max(1, Math.floor((e.clientX - rect.left) / cw) + 1);
  const row = Math.max(1, Math.floor((e.clientY - rect.top) / ch) + 1);
  const btn = e.deltaY < 0 ? 64 : 65;
  const seq = '\\x1b[<' + btn + ';' + col + ';' + row + 'M';
  if (__ws && __ws.readyState === 1) { e.preventDefault(); __ws.send(seq); return true; }
  return false;
});
t.open(term);
for (let i = 0; i < 40; i++) { if (term.clientWidth > 0) break; await new Promise(r => setTimeout(r, 10)); }
await new Promise(r => requestAnimationFrame(r));
try { fit.fit(); } catch(_){}
new ResizeObserver(() => { try { fit.fit(); ws.send(JSON.stringify({type:'resize',cols:t.cols,rows:t.rows})); } catch(_){} }).observe(term);
t.focus?.();
term.addEventListener('mousedown', () => t.focus?.());
const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
const ws = new WebSocket(proto + '//' + location.host + '/ws/kanban-pty?taskId=${encodeURIComponent(task.id)}&cols=' + t.cols + '&rows=' + t.rows);
__ws = ws;
ws.binaryType = 'arraybuffer';
ws.onmessage = (e) => t.write(typeof e.data === 'string' ? e.data : new Uint8Array(e.data));
t.onData((d) => ws.send(d));
window.addEventListener('resize', () => { try { fit.fit(); ws.send(JSON.stringify({type:'resize',cols:t.cols,rows:t.rows})); } catch(_){} });
</script>
</body></html>`;
}
