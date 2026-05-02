export const CLIENT_JS: string = `
// Keyboard nav: j/k/arrows to cycle active card, Enter to open, Esc to close.
document.addEventListener('keydown', (e) => {
  const ae = document.activeElement;
  const tag = ae?.tagName;
  // Skip when user is typing in an input or focus is anywhere inside the terminal
  // overlay. Panes mount ghostty canvases under #pane-row — check that, plus
  // the legacy #side-term for back-compat (ghostty canvas / textarea get focus,
  // not the container div, so plain id equality misses descendants).
  if (tag === 'INPUT' || tag === 'TEXTAREA' || ae?.closest?.('#pane-row') || ae?.closest?.('#side-term')) return;
  // Stronger guard: when the side panel is open and focus isn't on a card
  // or in the header controls, assume terminal owns the keys (focus may be
  // on document.body because ghostty's container DIV doesn't always claim
  // activeElement reliably). Without this, typing into a ghostty canvas
  // fires kanban shortcuts like 'n' / 'd' / '1-5'.
  if (document.getElementById('side')?.classList.contains('open') && !ae?.closest?.('header') && !ae?.closest?.('.card')) return;
  if (e.key === 'Escape') return; // handled by close-panel listener
  const cards = [...document.querySelectorAll('.card')];
  if (!cards.length) return;
  const cur = document.querySelector('.card.kbd-focus') || document.querySelector('.card.active') || cards[0];
  let idx = cards.indexOf(cur);
  if (idx < 0) idx = 0;
  let next = null;
  if (e.key === 'j' || e.key === 'ArrowDown') next = cards[Math.min(cards.length - 1, idx + 1)];
  else if (e.key === 'k' || e.key === 'ArrowUp') next = cards[Math.max(0, idx - 1)];
  else if (e.key === 'Enter') { e.preventDefault(); openSide(cur.dataset.id, cur.querySelector('.title').textContent); return; }
  else return;
  e.preventDefault();
  cards.forEach((c) => c.classList.remove('kbd-focus'));
  next.classList.add('kbd-focus');
  next.scrollIntoView({ block: 'nearest' });
}, true);
let dragId = null;
document.addEventListener('dragstart', (e) => {
  const c = e.target && e.target.closest && e.target.closest('.card');
  if (!c) return;
  if (e.target.classList && (e.target.classList.contains('card-open') || e.target.classList.contains('card-play') || e.target.classList.contains('card-archive') || e.target.classList.contains('card-wt'))) { e.preventDefault(); return; }
  dragId = c.dataset.id;
  c.classList.add('dragging');
});
document.addEventListener('dragend', (e) => {
  const c = e.target && e.target.closest && e.target.closest('.card');
  if (c) c.classList.remove('dragging');
  dragId = null;
});
document.addEventListener('mousedown', (e) => {
  const btn = e.target && e.target.closest && (e.target.closest('.card-open') || e.target.closest('.card-play') || e.target.closest('.card-archive') || e.target.closest('.card-wt'));
  if (btn) e.stopPropagation();
});
document.addEventListener('click', (e) => {
  const btn = e.target && e.target.closest && e.target.closest('.card-open');
  if (!btn) return;
  const card = btn.closest('.card');
  if (!card) return;
  e.stopPropagation();
  const titleNode = card.querySelector('.title');
  openSide(card.dataset.id, titleNode ? titleNode.textContent : '');
});
document.addEventListener('click', (e) => {
  const btn = e.target && e.target.closest && e.target.closest('.card-archive');
  if (!btn) return;
  const card = btn.closest('.card');
  if (!card) return;
  e.stopPropagation();
  e.preventDefault();
  if (btn.classList.contains('busy')) return;
  const id = card.dataset.id;
  btn.classList.add('busy');
  btn.textContent = '\\u22ef';
  fetch('/api/tasks/' + id + '/archive', { method: 'POST' })
    .then((r) => {
      if (!r.ok) throw new Error('archive failed: ' + r.status);
      card.style.transition = 'opacity .2s, transform .2s';
      card.style.opacity = '0';
      card.style.transform = 'translateX(12px)';
      setTimeout(() => { try { card.remove(); updateColCounts(); collapseEmptyCols(); } catch(_){} }, 200);
    })
    .catch((err) => {
      btn.classList.remove('busy');
      btn.textContent = '\\u2193';
      alert('Archive failed: ' + err);
    });
});
document.addEventListener('click', (e) => {
  const chip = e.target && e.target.closest && e.target.closest('.card-wt');
  if (!chip) return;
  const card = chip.closest('.card');
  if (!card) return;
  e.stopPropagation();
  e.preventDefault();
  const prevOn = chip.getAttribute('data-on') === 'true';
  const nextOn = !prevOn;
  chip.setAttribute('data-on', nextOn ? 'true' : 'false');
  fetch('/api/tasks/' + card.dataset.id, {
    method: 'PATCH',
    headers: {'content-type':'application/json'},
    body: JSON.stringify({ worktree_opt_in: nextOn }),
  }).then((r) => {
    if (!r.ok) {
      chip.setAttribute('data-on', prevOn ? 'true' : 'false');
      if (r.status === 409) {
        reconcileBoard();
      }
    }
  }).catch(() => {
    chip.setAttribute('data-on', prevOn ? 'true' : 'false');
  });
});
document.addEventListener('click', (e) => {
  const btn = e.target && e.target.closest && e.target.closest('.card-play');
  if (!btn) return;
  const card = btn.closest('.card');
  if (!card) return;
  e.stopPropagation();
  e.preventDefault();
  if (btn.classList.contains('busy')) return;
  btn.classList.add('busy');
  btn.textContent = '\\u22ef';
  const prevState = card.dataset.state || 'none';
  card.dataset.state = 'starting';
  const stateEl = card.querySelector('.state');
  let prevStateHtml = '';
  if (stateEl) {
    prevStateHtml = stateEl.outerHTML;
    stateEl.className = 'state state-starting';
    stateEl.setAttribute('data-state', 'starting');
    stateEl.title = 'starting\\u2026';
    stateEl.innerHTML = '\\u27f3<span class="state-rt"></span>';
  }
  fetch('/api/tasks/' + card.dataset.id + '/start', {method:'POST'})
    .then((r) => r.json().catch(() => ({})))
    .then((_j) => {
      btn.classList.remove('busy');
      btn.classList.add('ok');
      btn.textContent = '\\u25b6';
      setTimeout(() => { btn.classList.remove('ok'); }, 1200);
    })
    .catch((err) => {
      card.dataset.state = prevState;
      if (stateEl && prevStateHtml) {
        stateEl.outerHTML = prevStateHtml;
      }
      btn.classList.remove('busy');
      btn.textContent = '\\u25b6';
      alert('Start failed: ' + (err && err.message ? err.message : err));
    });
});
document.addEventListener('dblclick', (e) => {
  const titleEl = e.target && e.target.closest && e.target.closest('.card .title');
  if (!titleEl || titleEl.tagName === 'INPUT') return;
  const card = titleEl.closest('.card');
  if (!card) return;
  e.stopPropagation();
  const current = titleEl.textContent || '';
  const input = document.createElement('input');
  input.value = current;
  input.style.cssText = 'background:#0a0a0a;border:1px solid #d9a441;color:#eee;padding:2px 4px;font:inherit;width:100%;box-sizing:border-box';
  titleEl.replaceWith(input);
  input.focus();
  input.select();
  const finish = async (save) => {
    const value = input.value.trim();
    const newTitle = save && value ? value : current;
    const span = document.createElement('span');
    span.className = 'title';
    span.title = 'Double-click to rename';
    span.textContent = newTitle;
    input.replaceWith(span);
    if (save && value && value !== current) {
      try { await fetch('/api/tasks/' + card.dataset.id, { method: 'PATCH', headers: {'content-type':'application/json'}, body: JSON.stringify({ title: value }) }); } catch(_){}
    }
  };
  input.addEventListener('keydown', (ke) => { if (ke.key === 'Enter') { ke.preventDefault(); finish(true); } if (ke.key === 'Escape') { ke.preventDefault(); finish(false); } });
  input.addEventListener('blur', () => finish(true));
});
const boardEl = document.getElementById('board');
if (boardEl) {
  boardEl.addEventListener('dragover', (e) => {
    const col = e.target && e.target.closest && e.target.closest('.col');
    if (!col) return;
    e.preventDefault();
    col.classList.add('drop-target');
  });
  boardEl.addEventListener('dragleave', (e) => {
    const col = e.target && e.target.closest && e.target.closest('.col');
    if (!col) return;
    if (e.relatedTarget && col.contains(e.relatedTarget)) return;
    col.classList.remove('drop-target');
  });
  boardEl.addEventListener('drop', async (e) => {
    const col = e.target && e.target.closest && e.target.closest('.col');
    if (!col) return;
    e.preventDefault();
    col.classList.remove('drop-target');
    if (!dragId) return;
    const id = dragId;
    const targetCol = col.dataset.col;
    const selId = window.CSS && CSS.escape ? CSS.escape(id) : id;
    const card = document.querySelector('.card[data-id="' + selId + '"]');
    const body = col.querySelector('.col-body');
    if (card && body && card.parentElement !== body) {
      const ph = body.querySelector('.empty'); if (ph) ph.remove();
      body.appendChild(card);
      updateColCounts();
      applyFilters();
    }
    try {
      const r = await fetch('/api/tasks/' + id, {
        method: 'PATCH',
        headers: {'content-type':'application/json'},
        body: JSON.stringify({column: targetCol}),
      });
      if (!r.ok) reconcileBoard();
    } catch { reconcileBoard(); }
  });
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
}
function relTimeStr(iso) {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 10) return 'now';
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60); if (m < 60) return m + 'm';
  const h = Math.floor(m / 60); if (h < 24) return h + 'h';
  return Math.floor(h / 24) + 'd';
}
const STATE_GLYPHS = {running:'\\u25b6',idle:'\\u23f8',paused:'\\u23f8',crashed:'\\u26a0',detached:'\\u25cb'};
function deriveColumn(t) {
  if (t.column) return t.column;
  if (t.status === 'in_progress') return 'in_progress';
  if (t.status === 'closed') return 'done';
  if (t.status === 'failed') return 'cancelled';
  return 'backlog';
}
function renderCardHtml(t) {
  const prio = Math.max(1, Math.min(5, t.priority || 3));
  const state = (t.autoloop && t.autoloop.state) || 'none';
  const searchText = ((t.title || '') + ' ' + (t.description || '')).toLowerCase();
  const glyph = STATE_GLYPHS[state] || (state === 'none' ? '\\u00b7' : '\\u25cb');
  const lastAct = (t.autoloop && t.autoloop.last_active) || '';
  const rt = state === 'none' ? '' : relTimeStr(lastAct);
  const desc = t.description ? ('<div class="desc">' + esc(String(t.description)) + '</div>') : '';
  const commentText = t.comment && t.comment.text ? String(t.comment.text) : '';
  const comment = commentText ? ('<div class="comment" title="' + esc(commentText) + '">' + esc(commentText) + '</div>') : '';
  const canToggleWt = deriveColumn(t) === 'backlog' && !(t.autoloop && t.autoloop.workspace);
  const wtOn = t.worktree_opt_in === true;
  const wtChip = canToggleWt ? ('<span class="card-wt" data-on="' + (wtOn ? 'true' : 'false') + '" title="Worktree opt-in \\u2014 click to toggle">wt</span>') : '';
  return '<div class="card" data-id="' + esc(t.id) + '" data-prio="' + prio + '" data-state="' + esc(state) + '" data-search="' + esc(searchText) + '" draggable="true">' +
    '<div class="card-head">' +
      '<span class="prio prio-' + prio + '" title="P' + prio + '">P' + prio + '</span>' +
      '<span class="title" title="Double-click to rename">' + esc(t.title || '') + '</span>' +
      '<span class="state state-' + state + '" data-state="' + esc(state) + '" data-since="' + esc(lastAct) + '" title="' + esc(state + (rt ? ' \\u00b7 ' + rt + ' ago' : '')) + '">' + esc(glyph) + '<span class="state-rt">' + esc(rt) + '</span></span>' +
      wtChip +
      '<button class="card-play" type="button" draggable="false" title="Start agent (no pane)" aria-label="Start agent">\\u25b6</button>' +
      '<button class="card-open" type="button" draggable="false" title="Open terminal" aria-label="Open terminal">&gt;_</button>' +
      '<button class="card-archive" type="button" draggable="false" title="Archive (move to archive, remove from board)" aria-label="Archive">\\u2193</button>' +
    '</div>' + desc + comment +
    '<div class="preview"><div class="preview-empty"></div></div>' +
  '</div>';
}
function updateCardInPlace(card, t) {
  const prio = Math.max(1, Math.min(5, t.priority || 3));
  const state = (t.autoloop && t.autoloop.state) || 'none';
  const lastAct = (t.autoloop && t.autoloop.last_active) || '';
  card.dataset.prio = String(prio);
  card.dataset.state = state;
  card.dataset.search = ((t.title || '') + ' ' + (t.description || '')).toLowerCase();
  const titleEl = card.querySelector('.title');
  if (titleEl && titleEl.tagName !== 'INPUT' && titleEl.textContent !== t.title) titleEl.textContent = t.title || '';
  const prioEl = card.querySelector('.prio');
  if (prioEl) {
    prioEl.className = 'prio prio-' + prio;
    prioEl.title = 'P' + prio;
    prioEl.textContent = 'P' + prio;
  }
  const headEl = card.querySelector('.card-head');
  let descEl = card.querySelector(':scope > .desc');
  if (t.description) {
    if (!descEl) {
      descEl = document.createElement('div');
      descEl.className = 'desc';
      if (headEl && headEl.parentNode === card) card.insertBefore(descEl, headEl.nextSibling);
    }
    descEl.textContent = String(t.description);
  } else if (descEl) {
    descEl.remove();
  }
  let commentEl = card.querySelector(':scope > .comment');
  const commentText = t.comment && t.comment.text ? String(t.comment.text) : '';
  if (commentText) {
    if (!commentEl) {
      commentEl = document.createElement('div');
      commentEl.className = 'comment';
      const anchor = card.querySelector(':scope > .desc') || headEl;
      if (anchor && anchor.parentNode === card) card.insertBefore(commentEl, anchor.nextSibling);
    }
    if (commentEl.textContent !== commentText) commentEl.textContent = commentText;
    commentEl.title = commentText;
  } else if (commentEl) {
    commentEl.remove();
  }
  const stateEl = card.querySelector('.state');
  if (stateEl) {
    const glyph = STATE_GLYPHS[state] || (state === 'none' ? '\\u00b7' : '\\u25cb');
    const rt = state === 'none' ? '' : relTimeStr(lastAct);
    stateEl.className = 'state state-' + state;
    stateEl.setAttribute('data-state', state);
    stateEl.setAttribute('data-since', lastAct);
    stateEl.title = state + (rt ? ' \\u00b7 ' + rt + ' ago' : '');
    stateEl.innerHTML = esc(glyph) + '<span class="state-rt">' + esc(rt) + '</span>';
  }
  const canToggleWt = deriveColumn(t) === 'backlog' && !(t.autoloop && t.autoloop.workspace);
  const wtOn = t.worktree_opt_in === true;
  let wtEl = card.querySelector(':scope > .card-head > .card-wt');
  if (canToggleWt) {
    if (!wtEl) {
      wtEl = document.createElement('span');
      wtEl.className = 'card-wt';
      wtEl.textContent = 'wt';
      wtEl.title = 'Worktree opt-in \\u2014 click to toggle';
      const anchor = card.querySelector(':scope > .card-head > .card-play');
      if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(wtEl, anchor);
    }
    wtEl.setAttribute('data-on', wtOn ? 'true' : 'false');
  } else if (wtEl) {
    wtEl.remove();
  }
}
function updateColCounts() {
  document.querySelectorAll('.col').forEach((col) => {
    const badge = col.querySelector('h3 .count');
    if (badge) badge.textContent = col.querySelectorAll('.card').length;
  });
}
let reconcileInFlight = false;
let reconcilePending = false;
async function reconcileBoard() {
  if (reconcileInFlight) { reconcilePending = true; return; }
  reconcileInFlight = true;
  try {
    let list;
    try {
      const r = await fetch('/api/tasks');
      if (!r.ok) return;
      list = await r.json();
    } catch { return; }
    const cols = document.querySelectorAll('.col');
    if (!cols.length) {
      location.reload();
      return;
    }
    const bodyByCol = new Map();
    cols.forEach((col) => bodyByCol.set(col.dataset.col, col.querySelector('.col-body')));
    const seen = new Set();
    for (const t of list) {
      const target = deriveColumn(t);
      if ((target === 'done' || target === 'cancelled') && panes.has(t.id)) {
        closePane(t.id);
      }
      const body = bodyByCol.get(target);
      if (!body) continue;
      seen.add(t.id);
      const selId = window.CSS && CSS.escape ? CSS.escape(t.id) : t.id;
      let card = document.querySelector('.card[data-id="' + selId + '"]');
      if (!card) {
        const wrap = document.createElement('div');
        wrap.innerHTML = renderCardHtml(t).trim();
        card = wrap.firstElementChild;
        const ph = body.querySelector('.empty'); if (ph) ph.remove();
        body.appendChild(card);
      } else {
        if (card.parentElement !== body) {
          const ph = body.querySelector('.empty'); if (ph) ph.remove();
          body.appendChild(card);
        }
        updateCardInPlace(card, t);
      }
    }
    document.querySelectorAll('.card').forEach((c) => {
      if (!seen.has(c.dataset.id)) c.remove();
    });
    const DONE_COLS = ['done', 'cancelled'];
    const lastAct = (t) => {
      const cands = [t.closed, t.autoloop && t.autoloop.last_active, t.comment && t.comment.at, t.error && t.error.at, t.started, t.created];
      let max = 0;
      for (const c of cands) { if (!c) continue; const n = Date.parse(c); if (Number.isFinite(n) && n > max) max = n; }
      return max;
    };
    const tsById = new Map(list.map((t) => [t.id, lastAct(t)]));
    for (const colName of DONE_COLS) {
      const body = bodyByCol.get(colName);
      if (!body) continue;
      const cards = Array.from(body.querySelectorAll('.card'));
      if (cards.length <= 1) continue;
      cards.sort((a, b) => (tsById.get(b.dataset.id) || 0) - (tsById.get(a.dataset.id) || 0));
      for (const c of cards) body.appendChild(c);
    }
    bodyByCol.forEach((body) => {
      if (!body) return;
      if (!body.querySelector('.card') && !body.querySelector('.empty')) {
        const e2 = document.createElement('div');
        e2.className = 'empty';
        e2.textContent = '\\u2014';
        body.appendChild(e2);
      } else if (body.querySelector('.card')) {
        const ph = body.querySelector('.empty'); if (ph) ph.remove();
      }
    });
    updateColCounts();
    applyFilters();
  } finally {
    reconcileInFlight = false;
    if (reconcilePending) { reconcilePending = false; reconcileBoard(); }
  }
}
window.reconcileBoard = reconcileBoard;
async function addTask(e) {
  e.preventDefault();
  const f = e.target;
  const title = f.title.value.trim();
  if (!title) return false;
  const description = f.description?.value?.trim() || undefined;
  const priority = Number.parseInt(f.priority?.value ?? '3', 10);
  const wtBtn = document.getElementById('wt-toggle');
  const worktree_opt_in = wtBtn?.getAttribute('aria-pressed') === 'true';
  await fetch("/api/tasks", { method: "POST", headers: {"content-type":"application/json"}, body: JSON.stringify({ title, description, priority, worktree_opt_in }) });
  f.title.value = "";
  if (f.description) f.description.value = "";
  if (wtBtn) { wtBtn.setAttribute('aria-pressed', 'false'); wtBtn.textContent = '\\u25cb wt'; }
  f.title.focus();
  return false;
}
window.addTask = addTask;

function toggleWorktree(e) {
  e?.preventDefault?.();
  const btn = document.getElementById('wt-toggle');
  if (!btn) return;
  const on = btn.getAttribute('aria-pressed') !== 'true';
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  btn.textContent = (on ? '\\u25c9' : '\\u25cb') + ' wt';
}
window.toggleWorktree = toggleWorktree;

async function archiveDone() {
  try {
    const r = await fetch('/api/tasks/archive', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({}) });
    const body = await r.json().catch(() => ({}));
    const n = body?.count || 0;
    const btn = document.getElementById('archive-done-btn');
    if (btn) {
      const prev = btn.textContent;
      btn.textContent = n ? ('\\u2713 archived ' + n) : 'nothing to archive';
      btn.disabled = true;
      setTimeout(() => { btn.textContent = prev || '\\u2193 archive done'; btn.disabled = false; }, 1500);
    }
  } catch(err) {
    alert('Archive failed: ' + err);
  }
}
window.archiveDone = archiveDone;

// -----------------------------------------------------------------
// Multipane terminal. Each card opens as a vertical split in #pane-row.
// Up to MAX_PANES at once; extra clicks focus the existing pane. Backend
// is unchanged — each pane opens its own /ws/kanban-pty to the same
// PtySession infra the single-pane version used.
// -----------------------------------------------------------------
const MAX_PANES = 6;
const panes = new Map();
let activePaneId = null;
function activePane() { return panes.get(activePaneId); }
let pane = null;
let currentTaskId = null;

function renderPaneHead(taskId, title, stateGlyph, stateClass) {
  return '<div class="pane-head">' +
    '<span class="pt">' + title.replace(/</g,'&lt;') + '</span>' +
    '<span class="ps ' + (stateClass||'') + '">' + (stateGlyph||'\\u00b7') + '</span>' +
    '<button class="pc" title="Close this pane">\\u00d7</button>' +
  '</div>';
}

function setActivePane(taskId) {
  activePaneId = taskId;
  currentTaskId = taskId;
  pane = panes.get(taskId) || null;
  document.querySelectorAll('.pane').forEach((p) => p.classList.toggle('active', p.dataset.task === taskId));
  document.querySelectorAll('.card.active').forEach((c) => c.classList.remove('active'));
  document.querySelector('.card[data-id="' + taskId + '"]')?.classList.add('active');
  const rec = panes.get(taskId);
  document.getElementById('stitle').textContent = rec?.title || '';
  try { localStorage.setItem('autoloop.kanban.openTask', taskId); } catch(_){}
  refreshSideToolbar();
  try { pane?.t?.focus?.(); } catch(_){}
}

async function openPane(taskId, title) {
  if (panes.has(taskId)) { setActivePane(taskId); return; }
  if (panes.size >= MAX_PANES) {
    alert('Maximum ' + MAX_PANES + ' panes. Close one first.');
    return;
  }
  const side = document.getElementById('side');
  side.classList.add('open');
  applyOverlayHeight(loadedOverlayHeight());
  document.getElementById('side-empty').style.display = 'none';

  const row = document.getElementById('pane-row');
  if (panes.size > 0) {
    const sep = document.createElement('div');
    sep.className = 'pane-sep';
    attachPaneSep(sep);
    row.appendChild(sep);
  }
  const paneDiv = document.createElement('div');
  paneDiv.className = 'pane';
  paneDiv.dataset.task = taskId;
  paneDiv.innerHTML = renderPaneHead(taskId, title, '\\u00b7', '');
  const body = document.createElement('div');
  body.className = 'pane-body';
  paneDiv.appendChild(body);
  row.appendChild(paneDiv);

  paneDiv.querySelector('.pc').addEventListener('click', (e) => { e.stopPropagation(); closePane(taskId); });
  paneDiv.addEventListener('mousedown', () => setActivePane(taskId));

  const record = { taskId, title, paneDiv, termEl: body, t: null, fit: null, ws: null, ringBuffer: [] };
  panes.set(taskId, record);
  setActivePane(taskId);

  body.innerHTML = '<div style="color:#888;padding:12px;font:10px ui-monospace,Menlo,monospace">\\u25cb attaching to kanban-' + taskId + '\\u2026</div>';
  if (!window.__ghostty) {
    const mod = await import('/ghostty/ghostty-web.js?v=kanban');
    await mod.init();
    window.__ghostty = mod;
  }
  const ghostty = window.__ghostty;
  body.innerHTML = '';
  const t = new ghostty.Terminal({ fontSize: 12, scrollback: 10000 });
  const fit = new ghostty.FitAddon();
  t.loadAddon(fit);
  t.attachCustomWheelEventHandler((e) => {
    const alt = t.wasmTerm?.isAlternateScreen?.();
    if (!alt) return false;
    const rect = body.getBoundingClientRect();
    const cw = t.renderer?.charWidth || 8;
    const ch = t.renderer?.charHeight || 15;
    const col = Math.max(1, Math.floor((e.clientX - rect.left) / cw) + 1);
    const row = Math.max(1, Math.floor((e.clientY - rect.top) / ch) + 1);
    const btn = e.deltaY < 0 ? 64 : 65;
    const seq = '\\x1b[<' + btn + ';' + col + ';' + row + 'M';
    const ws = record.ws;
    if (ws && ws.readyState === 1) { e.preventDefault(); ws.send(seq); return true; }
    return false;
  });
  t.open(body);
  for (let i = 0; i < 40; i++) {
    if (body.clientWidth > 0 && body.clientHeight > 0) break;
    await new Promise(r => setTimeout(r, 10));
  }
  await new Promise(r => requestAnimationFrame(r));
  const forceFit = () => {
    try { fit.fit(); } catch(_){}
    try {
      const cellW = t.renderer?.dimensions?.css?.cell?.width || t.element?.querySelector('canvas')?.clientWidth / Math.max(1, t.cols) || 8;
      const cellH = t.renderer?.dimensions?.css?.cell?.height || t.element?.querySelector('canvas')?.clientHeight / Math.max(1, t.rows) || 15;
      const newCols = Math.max(20, Math.floor(body.clientWidth / cellW));
      const newRows = Math.max(5, Math.floor(body.clientHeight / cellH));
      if (newCols !== t.cols || newRows !== t.rows) t.resize(newCols, newRows);
    } catch(_){}
  };
  forceFit();
  const doFit = () => { if (body.clientWidth > 0 && body.clientHeight > 0) forceFit(); };
  const pushResize = () => { if (record.ws?.readyState === 1) { try { record.ws.send(JSON.stringify({ type: 'resize', cols: t.cols, rows: t.rows })); } catch(_){} } };
  new ResizeObserver(() => { doFit(); pushResize(); }).observe(body);
  try { t.focus?.(); } catch(_){}
  body.addEventListener('mousedown', () => { setActivePane(taskId); try { t.focus?.(); } catch(_){} });
  body.addEventListener('focus', () => body.style.outline = '1px solid #d9a441', true);
  body.addEventListener('blur', () => body.style.outline = 'none', true);

  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsPath = '/ws/kanban-pty?taskId=' + encodeURIComponent(taskId);
  const ws = new WebSocket(proto + '//' + location.host + wsPath + '&cols=' + t.cols + '&rows=' + t.rows);
  ws.binaryType = 'arraybuffer';
  const MAX_LINES = 500;
  const ansi = /\\x1b\\[[0-9;?]*[A-Za-z]|\\x1b\\][^\\x07]*\\x07|\\x1b[()][A-Za-z]|\\x1b[=>]|[\\x00-\\x08\\x0b-\\x1f\\x7f]/g;
  let lineTail = '';
  const append = (s) => {
    const clean = s.replace(ansi, '').replace(/\\r/g, '');
    const parts = (lineTail + clean).split('\\n');
    lineTail = parts.pop() ?? '';
    for (const p of parts) { record.ringBuffer.push(p); if (record.ringBuffer.length > MAX_LINES) record.ringBuffer.shift(); }
  };
  ws.onmessage = (e) => {
    if (typeof e.data === 'string') { t.write(e.data); append(e.data); }
    else { const u = new Uint8Array(e.data); t.write(u); try { append(new TextDecoder().decode(u)); } catch(_){} }
  };
  t.onData((d) => ws.send(d));
  record.t = t; record.fit = fit; record.ws = ws;
  try {
    t.onSelectionChange?.(() => {
      if (!t.hasSelection?.()) return;
      const sel = t.getSelection?.() || '';
      if (!sel) return;
      showToast('\\u2713 copied ' + sel.length + (sel.length === 1 ? ' char' : ' chars'));
    });
  } catch(_){}
  pane = record;
  savePaneOrder();
  refreshSideToolbar();
}

function closePane(taskId) {
  const p = panes.get(taskId);
  if (!p) return;
  try { p.ws?.close(); } catch(_){}
  const sep = p.paneDiv.previousElementSibling?.classList?.contains('pane-sep')
    ? p.paneDiv.previousElementSibling
    : p.paneDiv.nextElementSibling?.classList?.contains('pane-sep') ? p.paneDiv.nextElementSibling : null;
  try { sep?.remove(); } catch(_){}
  try { p.paneDiv.remove(); } catch(_){}
  panes.delete(taskId);
  if (activePaneId === taskId) {
    const next = panes.keys().next().value;
    if (next) setActivePane(next);
    else { activePaneId = null; currentTaskId = null; pane = null; closeSide(); }
  }
  savePaneOrder();
}

function savePaneOrder() {
  try { localStorage.setItem('autoloop.kanban.openPanes', JSON.stringify([...panes.keys()])); } catch(_){}
}

async function openSide(taskId, title) { return openPane(taskId, title); }

function attachPaneSep(sep) {
  let dragging = false, startX = 0, prev = null, next = null, prevW = 0, nextW = 0;
  sep.addEventListener('pointerdown', (e) => {
    prev = sep.previousElementSibling; next = sep.nextElementSibling;
    if (!prev || !next) return;
    dragging = true;
    startX = e.clientX;
    prevW = prev.getBoundingClientRect().width;
    nextW = next.getBoundingClientRect().width;
    sep.classList.add('dragging');
    sep.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  sep.addEventListener('pointermove', (e) => {
    if (!dragging || !prev || !next) return;
    const dx = e.clientX - startX;
    const total = prevW + nextW;
    const newPrev = Math.max(120, Math.min(total - 120, prevW + dx));
    const newNext = total - newPrev;
    prev.style.flex = '0 0 ' + newPrev + 'px';
    next.style.flex = '0 0 ' + newNext + 'px';
  });
  const stop = (e) => {
    if (!dragging) return;
    dragging = false;
    try { sep.releasePointerCapture(e.pointerId); } catch(_){}
    sep.classList.remove('dragging');
  };
  sep.addEventListener('pointerup', stop);
  sep.addEventListener('pointercancel', stop);
}

function closeSide() {
  const side = document.getElementById('side');
  side.classList.remove('open');
  side.style.flex = '';
  side.style.height = '';
  side.style.maxHeight = '';
  document.body.classList.remove('ov-open');
  document.documentElement.style.removeProperty('--ov-h');
  document.querySelectorAll('.card.active').forEach((c) => c.classList.remove('active'));
  for (const p of panes.values()) {
    try { p.ws?.close(); } catch(_){}
  }
  panes.clear();
  activePaneId = null; currentTaskId = null; pane = null;
  const row = document.getElementById('pane-row');
  if (row) row.innerHTML = '';
  try { localStorage.removeItem('autoloop.kanban.openTask'); } catch(_){}
  try { localStorage.removeItem('autoloop.kanban.openPanes'); } catch(_){}
  document.getElementById('side-empty').style.display = '';
}
window.closeSide = closeSide;
window.openPane = openPane;

let __toastTimer = null;
function showToast(msg) {
  let el = document.getElementById('ktoast');
  if (!el) { el = document.createElement('div'); el.id = 'ktoast'; el.className = 'ktoast'; document.body.appendChild(el); }
  el.textContent = msg;
  el.classList.add('show');
  if (__toastTimer) clearTimeout(__toastTimer);
  __toastTimer = setTimeout(() => { el.classList.remove('show'); }, 1200);
}
window.showToast = showToast;
window.closePane = closePane;
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
}, true);
try {
  const didAutoReopen = sessionStorage.getItem('autoloop.kanban.didAutoReopen');
  if (!didAutoReopen) {
    let ids = [];
    try { const raw = localStorage.getItem('autoloop.kanban.openPanes'); if (raw) ids = JSON.parse(raw); } catch(_){}
    if (!Array.isArray(ids) || !ids.length) {
      const single = localStorage.getItem('autoloop.kanban.openTask');
      if (single) ids = [single];
    }
    if (ids.length) {
      sessionStorage.setItem('autoloop.kanban.didAutoReopen', '1');
      ids.forEach((id, i) => {
        setTimeout(() => {
          const card = document.querySelector('.card[data-id="' + id + '"]');
          if (card) {
            const title = card.querySelector('.title')?.textContent || id;
            try { openPane(id, title); } catch(_){}
          }
        }, 50 + i * 250);
      });
    }
  }
} catch(_){}

const COL_ORDER = ['backlog','in_progress','human_review','rework','merging','done','cancelled'];
document.addEventListener('keydown', (e) => {
  const ae = document.activeElement;
  const tag = ae?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || ae?.closest?.('#pane-row') || ae?.closest?.('#side-term')) return;
  if (document.getElementById('side')?.classList.contains('open') && !ae?.closest?.('header') && !ae?.closest?.('.card')) return;
  if (e.key === '?' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); toggleHelp(); return; }
  if (e.key === '/' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); document.getElementById('search')?.focus(); return; }
  if (e.key === 'n' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); document.querySelector('#new-task input[name=title]')?.focus(); return; }
  if (e.key === 'D' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); toggleCompact(); return; }
  const cur = document.querySelector('.card.kbd-focus') || document.querySelector('.card.active');
  if (!cur) return;
  const id = cur.dataset.id;
  const moveTo = async (col) => {
    await fetch('/api/tasks/' + id, {method:'PATCH', headers:{'content-type':'application/json'}, body: JSON.stringify({column: col})});
  };
  if ((e.key === 'h' || e.key === 'ArrowLeft') && !e.shiftKey) {
    const curCol = cur.closest('.col')?.dataset.col;
    const i = COL_ORDER.indexOf(curCol);
    if (i > 0) { e.preventDefault(); moveTo(COL_ORDER[i-1]); }
    return;
  }
  if ((e.key === 'l' || e.key === 'ArrowRight') && !e.shiftKey) {
    const curCol = cur.closest('.col')?.dataset.col;
    const i = COL_ORDER.indexOf(curCol);
    if (i >= 0 && i < COL_ORDER.length - 1) { e.preventDefault(); moveTo(COL_ORDER[i+1]); }
    return;
  }
  if (/^[1-5]$/.test(e.key)) {
    e.preventDefault();
    fetch('/api/tasks/' + id, {method:'PATCH', headers:{'content-type':'application/json'}, body: JSON.stringify({priority: parseInt(e.key,10)})});
    return;
  }
  if (e.key === 'd') { e.preventDefault(); moveTo('done'); return; }
  if (e.key === 'x') { e.preventDefault(); moveTo('cancelled'); return; }
  if (e.key === 'r') { e.preventDefault(); moveTo('rework'); return; }
}, true);

const filterState = { q: '', prios: new Set(), states: new Set() };
function applyFilters() {
  const q = filterState.q.trim().toLowerCase();
  document.querySelectorAll('.card').forEach((c) => {
    let show = true;
    if (q && !(c.dataset.search || '').includes(q)) show = false;
    if (show && filterState.prios.size && !filterState.prios.has(c.dataset.prio)) show = false;
    if (show && filterState.states.size && !filterState.states.has(c.dataset.state)) show = false;
    c.classList.toggle('filtered-out', !show);
  });
  document.querySelectorAll('.col').forEach((col) => {
    const visible = col.querySelectorAll('.card:not(.filtered-out)').length;
    const badge = col.querySelector('h3 .count');
    if (badge) badge.textContent = visible;
  });
  collapseEmptyCols();
}
const search = document.getElementById('search');
search?.addEventListener('input', () => { filterState.q = search.value; applyFilters(); });
document.querySelectorAll('#prio-chips .chip').forEach((el) => {
  el.addEventListener('click', () => {
    const v = el.dataset.prio;
    el.classList.toggle('on');
    if (filterState.prios.has(v)) filterState.prios.delete(v); else filterState.prios.add(v);
    applyFilters();
  });
});
document.querySelectorAll('#state-chips .chip').forEach((el) => {
  el.addEventListener('click', () => {
    const v = el.dataset.state;
    el.classList.toggle('on');
    if (filterState.states.has(v)) filterState.states.delete(v); else filterState.states.add(v);
    applyFilters();
  });
});

function collapseEmptyCols() {
  const cols = document.querySelectorAll('.col');
  const template = [];
  cols.forEach((col) => {
    const visible = col.querySelectorAll('.card:not(.filtered-out)').length;
    const isInProgress = col.dataset.col === 'in_progress';
    const collapsed = visible === 0 && !isInProgress;
    col.classList.toggle('collapsed', collapsed);
    template.push(collapsed ? '44px' : 'minmax(140px, 1fr)');
  });
  const board = document.getElementById('board');
  if (board) board.style.gridTemplateColumns = template.join(' ');
}
collapseEmptyCols();

function toggleHelp() {
  const el = document.getElementById('kb-help');
  if (!el) return;
  el.classList.toggle('open');
}
window.toggleHelp = toggleHelp;
function applyCompact(on) {
  document.body.classList.toggle('compact', !!on);
  const btn = document.getElementById('btn-compact');
  if (btn) {
    btn.classList.toggle('on', !!on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
}
function toggleCompact() {
  const on = !document.body.classList.contains('compact');
  applyCompact(on);
  try { localStorage.setItem('autoloop.kanban.compact', on ? '1' : '0'); } catch(_){}
}
window.toggleCompact = toggleCompact;
try { applyCompact(localStorage.getItem('autoloop.kanban.compact') === '1'); } catch(_){}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.getElementById('kb-help')?.classList.contains('open')) {
    e.preventDefault(); e.stopPropagation();
    toggleHelp();
  }
}, true);

function syncSideToolbar(task) {
  if (!task) return;
  document.getElementById('sb-prio').value = String(task.priority || 3);
  document.getElementById('sb-col').value = task.column || 'backlog';
  const st = task.autoloop?.state || 'detached';
  const sideState = document.getElementById('side-state');
  sideState.className = 'state-' + st;
  const glyph = ({running:'\\u25b6',idle:'\\u23f8',paused:'\\u23f8',crashed:'\\u26a0',detached:'\\u25cb'})[st] || '\\u25cb';
  sideState.textContent = glyph + ' ' + st;
  const tmux = 'kanban-' + task.id;
  document.getElementById('ss-tmux').textContent = 'tmux: ' + tmux;
  const lastAct = task.autoloop?.last_active;
  document.getElementById('ss-activity').textContent = lastAct ? ('last active: ' + new Date(lastAct).toLocaleTimeString()) : '\\u2014';
}
async function refreshSideToolbar() {
  if (!activePaneId && panes.size === 0) return;
  try {
    const r = await fetch('/api/tasks');
    if (!r.ok) return;
    const list = await r.json();
    const STATE_GLYPH = {running:'\\u25b6',idle:'\\u23f8',paused:'\\u23f8',crashed:'\\u26a0',detached:'\\u25cb'};
    for (const [id, rec] of panes) {
      const task = list.find((t) => t.id === id);
      if (!task) continue;
      const st = task.autoloop?.state || 'detached';
      const g = STATE_GLYPH[st] || '\\u25cb';
      const ps = rec.paneDiv.querySelector('.ps');
      if (ps) { ps.textContent = g; ps.className = 'ps state-' + st; ps.title = st; }
    }
    const active = activePaneId ? list.find((t) => t.id === activePaneId) : null;
    if (active) syncSideToolbar(active);
  } catch(_){}
}
document.getElementById('sb-prio')?.addEventListener('change', (e) => {
  if (!currentTaskId) return;
  fetch('/api/tasks/' + currentTaskId, {method:'PATCH', headers:{'content-type':'application/json'}, body: JSON.stringify({priority: parseInt(e.target.value,10)})});
});
document.getElementById('sb-col')?.addEventListener('change', (e) => {
  if (!currentTaskId) return;
  fetch('/api/tasks/' + currentTaskId, {method:'PATCH', headers:{'content-type':'application/json'}, body: JSON.stringify({column: e.target.value})});
});
document.getElementById('sb-restart')?.addEventListener('click', async () => {
  if (!activePaneId) return;
  if (!confirm('Restart run?\\n\\nKills the running autoloop + tmux session for THIS pane and respawns a fresh one. Transcript preserved. Other panes unaffected.')) return;
  const taskId = activePaneId;
  const title = panes.get(taskId)?.title || '';
  try { await fetch('/api/tasks/' + taskId + '/restart', {method:'POST'}); } catch(_){}
  closePane(taskId);
  setTimeout(() => { openPane(taskId, title); }, 300);
});
document.getElementById('sb-kill')?.addEventListener('click', async () => {
  if (!activePaneId) return;
  if (!confirm('End run?\\n\\nKills the autoloop process and tmux session for THIS pane. The transcript stays on disk; other panes are unaffected.')) return;
  const id = activePaneId;
  try { await fetch('/api/tasks/' + id + '/kill', {method:'POST'}); } catch(_){}
  closePane(id);
});
document.getElementById('sb-detach')?.addEventListener('click', () => closeSide());
document.getElementById('sb-bottom')?.addEventListener('click', () => {
  try { pane?.t?.scrollToBottom?.(); } catch(_){}
  try { pane?.ringBuffer && pane.t?.scrollLines?.(9999); } catch(_){}
});
document.getElementById('sb-copy')?.addEventListener('click', async () => {
  const buf = pane?.ringBuffer?.join('\\n') || '';
  if (!buf) { alert('No terminal output captured yet.'); return; }
  try {
    await navigator.clipboard.writeText(buf);
    showToast('\\u2713 copied ' + buf.length + ' chars (last 200 lines)');
  } catch (err) {
    alert('Clipboard write failed: ' + err.message);
  }
});
const OV_KEY = 'autoloop.kanban.overlayH';
const OV_MIN = 20, OV_MAX = 85, OV_DEFAULT = 45;
function applyOverlayHeight(vh) {
  const side = document.getElementById('side');
  if (!side) return;
  const clamped = Math.max(OV_MIN, Math.min(OV_MAX, Math.round(vh)));
  side.style.maxHeight = clamped + 'vh';
  side.style.height = clamped + 'vh';
  document.documentElement.style.setProperty('--ov-h', clamped + 'vh');
  document.body.classList.add('ov-open');
  try { localStorage.setItem(OV_KEY, String(clamped)); } catch(_){}
}
function loadedOverlayHeight() {
  try { const v = parseInt(localStorage.getItem(OV_KEY) || '', 10); if (Number.isFinite(v)) return v; } catch(_){}
  return OV_DEFAULT;
}

document.getElementById('sb-fullscreen')?.addEventListener('click', () => {
  if (!currentTaskId) return;
  window.open('/kanban/term/' + currentTaskId, '_blank', 'noopener');
});

(() => {
  const handle = document.getElementById('ov-handle');
  const side = document.getElementById('side');
  if (!handle || !side) return;
  let dragging = false;
  handle.addEventListener('pointerdown', (e) => {
    dragging = true;
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('dragging');
    side.classList.add('resizing');
    e.preventDefault();
  });
  handle.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const vh = ((window.innerHeight - e.clientY) / window.innerHeight) * 100;
    applyOverlayHeight(vh);
    try { pane?.ws?.readyState === 1 && pane.ws.send(JSON.stringify({type:'resize',cols:pane.t.cols,rows:pane.t.rows})); } catch(_){}
  });
  const stop = (e) => {
    if (!dragging) return;
    dragging = false;
    try { handle.releasePointerCapture(e.pointerId); } catch(_){}
    handle.classList.remove('dragging');
    side.classList.remove('resizing');
  };
  handle.addEventListener('pointerup', stop);
  handle.addEventListener('pointercancel', stop);
})();
document.addEventListener('keydown', (e) => {
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  const side = document.getElementById('side');
  if (!side?.classList.contains('open')) return;
  if (e.key === '+' || e.key === '=') { e.preventDefault(); applyOverlayHeight(loadedOverlayHeight() + 5); return; }
  if (e.key === '-' || e.key === '_') { e.preventDefault(); applyOverlayHeight(loadedOverlayHeight() - 5); return; }
}, true);

setInterval(() => {
  document.querySelectorAll('.state[data-since]').forEach((el) => {
    const iso = el.getAttribute('data-since');
    if (!iso) return;
    const ms = Date.now() - Date.parse(iso);
    if (!Number.isFinite(ms)) return;
    const s = Math.max(0, Math.floor(ms/1000));
    let rt;
    if (s < 10) rt = 'now'; else if (s < 60) rt = s + 's';
    else if (s < 3600) rt = Math.floor(s/60) + 'm';
    else if (s < 86400) rt = Math.floor(s/3600) + 'h';
    else rt = Math.floor(s/86400) + 'd';
    const rtEl = el.querySelector('.state-rt');
    if (rtEl) rtEl.textContent = rt;
  });
  refreshSideToolbar();
}, 15000);

try {
  const es = new EventSource("/kanban/events");
  es.addEventListener("reload", () => {
    reconcileBoard();
    if (panes && panes.size > 0) refreshSideToolbar();
  });
  es.addEventListener("preview", (e) => {
    try {
      const { id, html } = JSON.parse(e.data);
      const card = document.querySelector('.card[data-id="' + id + '"]');
      if (!card) return;
      let prev = card.querySelector(".preview");
      if (!prev) {
        prev = document.createElement("div");
        prev.className = "preview";
        card.appendChild(prev);
      }
      prev.innerHTML = html || '<div class="preview-empty"></div>';
    } catch(_){}
  });
  es.onmessage = (e) => { if (e.data === "update") reconcileBoard(); };
  es.onerror = () => {
    const live = document.getElementById("live");
    if (live) { live.classList.remove('pulse'); live.textContent = "\\u25cb offline"; live.style.color = '#d55'; }
  };
} catch(_){}
`;
