/* =========================================================================
   BRICK RUSH — board.js
   The Studio workspace: per-game, per-discipline Kanban boards.
   Talks only to window.Board (store.js) — live (Supabase) or demo (local).
   ========================================================================= */
(function () {
  const CFG = window.BRICKRUSH_CONFIG;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const toast = (m, t) => window.toast && window.toast(m, t);

  const DISC = {
    overview: { name: 'Overview', short: 'Overview', tint: 'var(--magenta)' },
    scripter: { name: 'Scripting', short: 'Scripting', tint: 'var(--cyan)' },
    modeler_animator: { name: 'Modeling & Animation', short: 'Modeling', tint: 'var(--violet)' },
    uiux: { name: 'UI/UX', short: 'UI/UX', tint: 'var(--magenta)' },
  };
  const DISC_ORDER = ['overview', 'scripter', 'modeler_animator', 'uiux'];
  const PRI = {
    low: { l: 'Low', c: '#5C6276' }, medium: { l: 'Medium', c: '#2BD2FF' },
    high: { l: 'High', c: '#FFC24B' }, urgent: { l: 'Urgent', c: '#FF4D6D' },
  };
  const STATUS_LABEL = { planning: 'Planning', in_dev: 'In development', testing: 'Testing', launched: 'Launched', paused: 'Paused' };

  /* ---- state ---- */
  let ACCESS = { discord_id: '', is_staff: false, leads: [], game_ids: [] };
  let GAMES = [];
  let game = null;            // active game (from GAMES)
  let boards = [], columns = [], tasks = [], members = [];
  let activeDisc = 'overview';
  let rt = null;
  let dragId = null;

  /* ---- permissions (mirror RLS) ---- */
  const canManage = () => ACCESS.is_staff;
  const isMember = () => (ACCESS.game_ids || []).includes(game && game.id);
  const canEditDisc = (disc) => ACCESS.is_staff || (disc !== 'overview' && (ACCESS.leads || []).includes(disc));
  const canMoveTask = (t) => canEditDisc(t.discipline) || (isMember() && (t.assignee_id === ACCESS.discord_id || !t.assignee_id));

  /* ===================== BOOT / GATE ===================== */
  async function boot() {
    if (window.Auth && window.Auth.init) { try { await window.Auth.init(); } catch (e) {} }
    const user = window.Auth.getUser();

    if (window.Board.live && !user) return gate('login');
    try { ACCESS = await window.Board.myAccess(); } catch (e) { ACCESS = { is_staff: false, leads: [], game_ids: [] }; }
    const hasAccess = !window.Board.live || ACCESS.is_staff || (ACCESS.leads || []).length || (ACCESS.game_ids || []).length;
    if (!hasAccess) return gate('noaccess');

    $('#board-gate').classList.add('hidden');
    $('#board-app').classList.remove('hidden');
    if (!window.Board.live) $('#demo-banner').classList.remove('hidden');
    if (canManage()) {
      $('#new-game').classList.remove('hidden');
      $('#nav-admin-link').classList.remove('hidden');
      $('#manage-game').classList.remove('hidden');
    }
    wireGlobal();
    await loadGames();
  }

  function gate(kind) {
    const g = $('#board-gate'); g.classList.remove('hidden');
    $('#board-app').classList.add('hidden');
    const here = (location.pathname.split('/').pop() || 'board.html');
    if (kind === 'login') {
      $('#gate-icon').textContent = '🔒';
      $('#gate-title').textContent = 'Studio access';
      $('#gate-msg').textContent = 'Log in with Discord to reach your team’s boards.';
      $('#gate-actions').innerHTML = `<a class="btn btn--primary" href="login.html?return=${encodeURIComponent(here)}">Log in with Discord</a>`;
    } else {
      $('#gate-icon').textContent = '✦';
      $('#gate-title').textContent = 'You’re not on a team yet';
      $('#gate-msg').textContent = 'You’re logged in, but you haven’t been added to a game. Ask an admin to add you to the studio.';
      $('#gate-actions').innerHTML = `<a class="btn btn--ghost" href="index.html">Back to site</a> <button class="btn btn--ghost" data-logout>Log out</button>`;
      const lo = $('#gate-actions [data-logout]');
      if (lo) lo.addEventListener('click', async () => { await window.Auth.logout(); location.href = 'index.html'; });
    }
  }

  /* ===================== GAMES (rail) ===================== */
  async function loadGames() {
    GAMES = await window.Board.listGames();
    if (!GAMES.length) {
      game = null;
      renderGameList();
      renderEmptyStage();
      return;
    }
    if (!game || !GAMES.some(g => g.id === game.id)) game = GAMES[0];
    else game = GAMES.find(g => g.id === game.id);
    renderGameList();
    await selectGame(game.id);
  }

  function pct(done, total) { return total ? Math.round(done / total * 100) : 0; }

  function renderGameList() {
    const wrap = $('#game-list');
    if (!GAMES.length) {
      wrap.innerHTML = `<p class="rail-empty">No games yet.${canManage() ? ' Create your first one →' : ''}</p>`;
      return;
    }
    wrap.innerHTML = GAMES.map(g => {
      const total = g.total_points > 0 ? g.total_points : g.total;
      const done = g.total_points > 0 ? g.done_points : g.done;
      const p = pct(done, total);
      return `<button class="game-card${game && g.id === game.id ? ' is-active' : ''}" data-game="${g.id}">
        <span class="game-card__top">
          <span class="game-card__name">${esc(g.name)}</span>
          <span class="game-card__pct">${p}%</span>
        </span>
        <span class="game-card__bar"><span style="width:${p}%"></span></span>
        <span class="game-card__meta"><span class="dot dot--${esc(g.status)}"></span>${esc(STATUS_LABEL[g.status] || g.status)} · ${g.done}/${g.total} tasks</span>
      </button>`;
    }).join('');
    $$('#game-list .game-card').forEach(b => b.addEventListener('click', () => selectGame(b.dataset.game)));
  }

  function renderEmptyStage() {
    $('#game-name').textContent = canManage() ? 'No games yet' : 'Nothing here yet';
    $('#game-status').textContent = '';
    $('#game-meter').innerHTML = '';
    $('#game-meter-legend').innerHTML = '';
    $('#board-tabs').innerHTML = '';
    $('#board-canvas').innerHTML = `<div class="board-empty">${canManage()
      ? '✦ Create your first game from the left to spin up its Scripting, Modeling and UI/UX boards.'
      : '✦ You’ll see boards here once you’re added to a game.'}</div>`;
  }

  async function selectGame(id) {
    game = GAMES.find(g => g.id === id) || game;
    [boards, columns, tasks, members] = await Promise.all([
      window.Board.getBoards(id), window.Board.getColumns(id),
      window.Board.listTasks(id), window.Board.getMembers(id),
    ]);
    if (!DISC_ORDER.includes(activeDisc) || !boards.some(b => b.discipline === activeDisc)) activeDisc = 'overview';
    renderGameList();
    renderHead();
    renderTabs();
    renderCanvas();
    subscribeRealtime(id);
  }

  /* ===================== HEAD + METER ===================== */
  function discStats() {
    const out = {};
    ['scripter', 'modeler_animator', 'uiux'].forEach(d => {
      const ts = tasks.filter(t => t.discipline === d);
      const doneColIds = new Set(columns.filter(c => c.is_done).map(c => c.id));
      const done = ts.filter(t => doneColIds.has(t.column_id));
      const usePts = ts.some(t => t.points > 0);
      out[d] = {
        total: ts.length, done: done.length,
        weight: usePts ? ts.reduce((a, t) => a + (t.points || 0), 0) : ts.length,
        weightDone: usePts ? done.reduce((a, t) => a + (t.points || 0), 0) : done.length,
      };
    });
    return out;
  }

  function renderHead() {
    $('#game-name').textContent = game.name;
    const st = $('#game-status');
    st.textContent = STATUS_LABEL[game.status] || game.status;
    st.className = 'game-status dot-pre dot--' + game.status;

    const s = discStats();
    const grand = ['scripter', 'modeler_animator', 'uiux'].reduce((a, d) => a + s[d].weight, 0);
    const grandDone = ['scripter', 'modeler_animator', 'uiux'].reduce((a, d) => a + s[d].weightDone, 0);
    const overall = pct(grandDone, grand);
    const seg = ['scripter', 'modeler_animator', 'uiux'].map(d => {
      const basis = grand ? (s[d].weight / grand * 100) : 33.33;
      const fill = s[d].weight ? (s[d].weightDone / s[d].weight * 100) : 0;
      return `<span class="seg" style="flex:${basis};--tint:${DISC[d].tint}" title="${DISC[d].short}: ${pct(s[d].weightDone, s[d].weight)}%">
        <span class="seg__fill" style="width:${fill}%"></span></span>`;
    }).join('');
    $('#game-meter').innerHTML = `<div class="meter__bar">${seg}</div><div class="meter__num">${overall}<span>%</span></div>`;
    $('#game-meter-legend').innerHTML = ['scripter', 'modeler_animator', 'uiux'].map(d =>
      `<span class="leg"><i style="background:${DISC[d].tint}"></i>${DISC[d].short} ${s[d].done}/${s[d].total}</span>`
    ).join('');
  }

  /* ===================== TABS ===================== */
  function renderTabs() {
    const wrap = $('#board-tabs');
    wrap.innerHTML = DISC_ORDER.filter(d => boards.some(b => b.discipline === d)).map(d => {
      const n = tasks.filter(t => t.discipline === d).length;
      return `<button class="board-tab${d === activeDisc ? ' is-active' : ''}" data-disc="${d}" style="--tint:${DISC[d].tint}">
        ${esc(DISC[d].name)}${n ? ` <span class="tab-n">${n}</span>` : ''}</button>`;
    }).join('');
    $$('#board-tabs .board-tab').forEach(b => b.addEventListener('click', () => { activeDisc = b.dataset.disc; renderTabs(); renderCanvas(); }));
  }

  /* ===================== CANVAS (columns + cards) ===================== */
  function renderCanvas() {
    const board = boards.find(b => b.discipline === activeDisc);
    const canvas = $('#board-canvas');
    if (!board) { canvas.innerHTML = ''; return; }
    const cols = columns.filter(c => c.board_id === board.id).sort((a, b) => a.sort - b.sort);
    const editable = canEditDisc(activeDisc);
    canvas.innerHTML = cols.map(col => {
      const cardEls = tasks.filter(t => t.column_id === col.id).sort((a, b) => a.sort - b.sort).map(cardHtml).join('');
      return `<section class="col" data-col="${col.id}" data-done="${col.is_done ? 1 : 0}">
        <header class="col__head"><span class="col__name">${esc(col.name)}</span><span class="col__count">${tasks.filter(t => t.column_id === col.id).length}</span></header>
        <div class="col__body" data-drop="${col.id}">${cardEls}</div>
        ${editable ? `<button class="col__add" data-add="${col.id}" data-no-sound>＋ Add a card</button>` : ''}
      </section>`;
    }).join('');
    wireCanvas(board);
  }

  function cardHtml(t) {
    const pri = PRI[t.priority] || PRI.medium;
    const chk = Array.isArray(t.checklist) ? t.checklist : [];
    const chkDone = chk.filter(c => c.done).length;
    const due = t.due_date ? dueChip(t.due_date) : '';
    const assignee = t.assignee_id ? avatarChip(t) : '';
    const labels = (t.labels || []).map(l => `<span class="lbl">${esc(l)}</span>`).join('');
    return `<article class="task-card" data-task="${t.id}" draggable="${canMoveTask(t) ? 'true' : 'false'}" style="--pri:${pri.c}">
      <div class="task-card__pri"></div>
      <div class="task-card__title">${esc(t.title)}</div>
      ${labels ? `<div class="task-card__labels">${labels}</div>` : ''}
      <div class="task-card__foot">
        <span class="task-meta">
          ${t.points > 0 ? `<span class="pts">◆ ${t.points}</span>` : ''}
          ${chk.length ? `<span class="chk ${chkDone === chk.length ? 'chk--done' : ''}">☑ ${chkDone}/${chk.length}</span>` : ''}
          ${t.attachment_url ? `<span class="att" title="Has an attachment">🔗</span>` : ''}
          ${due}
        </span>
        ${assignee}
      </div>
    </article>`;
  }

  function dueChip(d) {
    const date = new Date(d + 'T00:00:00');
    const days = Math.ceil((date - new Date().setHours(0, 0, 0, 0)) / 864e5);
    const cls = days < 0 ? 'due--over' : days <= 2 ? 'due--soon' : '';
    const txt = days < 0 ? `${-days}d late` : days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return `<span class="due ${cls}">📅 ${esc(txt)}</span>`;
  }
  function avatarChip(t) {
    if (t.assignee_avatar) return `<img class="ava" src="${esc(t.assignee_avatar)}" alt="${esc(t.assignee_name)}" title="${esc(t.assignee_name)}" />`;
    const ini = (t.assignee_name || '?').charAt(0).toUpperCase();
    return `<span class="ava ava--ini" title="${esc(t.assignee_name)}">${esc(ini)}</span>`;
  }

  function wireCanvas(board) {
    // open card
    $$('#board-canvas .task-card').forEach(c => c.addEventListener('click', (e) => {
      if (c.classList.contains('dragging')) return;
      openCard(c.dataset.task);
    }));
    // add-card composers
    $$('#board-canvas .col__add').forEach(btn => btn.addEventListener('click', () => openComposer(btn, board)));
    // drag & drop (desktop)
    $$('#board-canvas .task-card[draggable="true"]').forEach(card => {
      card.addEventListener('dragstart', (e) => { dragId = card.dataset.task; card.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
      card.addEventListener('dragend', () => { dragId = null; $$('.task-card.dragging').forEach(x => x.classList.remove('dragging')); $$('.col__body.drop-on').forEach(x => x.classList.remove('drop-on')); });
    });
    $$('#board-canvas .col__body').forEach(body => {
      body.addEventListener('dragover', (e) => {
        if (!dragId) return;
        e.preventDefault();
        body.classList.add('drop-on');
        const after = afterElement(body, e.clientY);
        const dragged = $(`.task-card[data-task="${dragId}"]`);
        if (!dragged) return;
        if (after == null) body.appendChild(dragged);
        else body.insertBefore(dragged, after);
      });
      body.addEventListener('dragleave', (e) => { if (!body.contains(e.relatedTarget)) body.classList.remove('drop-on'); });
      body.addEventListener('drop', (e) => { e.preventDefault(); body.classList.remove('drop-on'); commitDrop(body); });
    });
  }

  function afterElement(body, y) {
    const els = $$('.task-card:not(.dragging)', body);
    let closest = { offset: -Infinity, el: null };
    els.forEach(el => {
      const box = el.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) closest = { offset, el };
    });
    return closest.el;
  }

  async function commitDrop(body) {
    const id = dragId; dragId = null;
    if (!id) return;
    const colId = body.dataset.drop;
    const col = columns.find(c => c.id === colId);
    const task = tasks.find(t => t.id === id);
    if (!task || !col) return;
    // figure new neighbours from the DOM order
    const order = $$('.task-card', body).map(el => el.dataset.task);
    const idx = order.indexOf(id);
    const aboveId = order[idx - 1], belowId = order[idx + 1];
    const sortOf = (tid) => { const t = tasks.find(x => x.id === tid); return t ? t.sort : null; };
    const above = aboveId ? sortOf(aboveId) : null, below = belowId ? sortOf(belowId) : null;
    let newSort;
    if (above != null && below != null) newSort = (above + below) / 2;
    else if (below != null) newSort = below - 1;
    else if (above != null) newSort = above + 1;
    else newSort = 1000;
    task.column_id = colId; task.sort = newSort; task.completed_at = col.is_done ? new Date().toISOString() : null;
    try {
      await window.Board.moveTask(id, colId, newSort, col.is_done);
      if (window.Sound) window.Sound.play('tick');
      refreshAfterMutation();
    } catch (e) { toast('Move failed — ' + e.message, 'error'); selectGame(game.id); }
  }

  /* ---- inline add-card composer ---- */
  function openComposer(btn, board) {
    const colId = btn.dataset.add;
    const col = btn.closest('.col'); const bodyHtml = btn.outerHTML;
    const box = document.createElement('div'); box.className = 'composer';
    box.innerHTML = `<textarea class="composer__in" placeholder="Card title…" rows="2"></textarea>
      <div class="composer__row"><button class="btn btn--primary btn--sm" data-add-go data-no-sound>Add card</button>
      <button class="btn btn--ghost btn--sm" data-add-cancel data-no-sound>Cancel</button></div>`;
    btn.replaceWith(box);
    const ta = $('.composer__in', box); ta.focus();
    const cancel = () => { const b = document.createElement('button'); b.className = 'col__add'; b.dataset.add = colId; b.dataset.noSound = ''; b.textContent = '＋ Add a card'; box.replaceWith(b); b.addEventListener('click', () => openComposer(b, board)); };
    const go = async () => {
      const title = ta.value.trim(); if (!title) return cancel();
      const maxSort = Math.max(0, ...tasks.filter(t => t.column_id === colId).map(t => t.sort));
      try {
        const created = await window.Board.createTask({ column_id: colId, board_id: board.id, game_id: game.id, discipline: board.discipline, title, sort: maxSort + 1000 });
        tasks.push(created);
        if (window.Sound) window.Sound.play('select');
        refreshAfterMutation();
      } catch (e) { toast('Couldn’t add card — ' + e.message, 'error'); }
    };
    $('[data-add-go]', box).addEventListener('click', go);
    $('[data-add-cancel]', box).addEventListener('click', cancel);
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go(); } if (e.key === 'Escape') cancel(); });
  }

  function refreshAfterMutation() {
    renderHead(); renderTabs(); renderCanvas();
    // update the rail card progress for this game without a full refetch
    const s = discStats();
    const g = GAMES.find(x => x.id === game.id);
    if (g) {
      const doneColIds = new Set(columns.filter(c => c.is_done).map(c => c.id));
      g.total = tasks.length; g.done = tasks.filter(t => doneColIds.has(t.column_id)).length;
      g.total_points = tasks.reduce((a, t) => a + (t.points || 0), 0);
      g.done_points = tasks.filter(t => doneColIds.has(t.column_id)).reduce((a, t) => a + (t.points || 0), 0);
    }
    renderGameList();
  }

  /* ===================== CARD MODAL ===================== */
  async function openCard(id) {
    const t = tasks.find(x => x.id === id); if (!t) return;
    const full = canEditDisc(t.discipline);
    const memEdit = canMoveTask(t);
    const ro = (cond) => cond ? '' : 'disabled';
    const cols = columns.filter(c => c.board_id === t.board_id).sort((a, b) => a.sort - b.sort);
    const me = window.Auth.getUser() || {};
    const assignOpts = [{ id: '', name: 'Unassigned' }]
      .concat(ACCESS.discord_id ? [{ id: ACCESS.discord_id, name: (me.global_name || me.username || 'Me') + ' (me)' }] : [])
      .concat(members.filter(m => m.discord_id !== ACCESS.discord_id).map(m => ({ id: m.discord_id, name: m.username || m.discord_id })));
    const chk = Array.isArray(t.checklist) ? t.checklist.slice() : [];

    const panel = $('#card-modal-panel');
    panel.innerHTML = `
      <button class="modal__x" data-x data-no-sound aria-label="Close">✕</button>
      <span class="card-disc" style="--tint:${DISC[t.discipline].tint}">${esc(DISC[t.discipline].name)}</span>
      <input class="card-title-in" id="cm-title" value="${esc(t.title)}" ${ro(full)} placeholder="Card title" />
      <div class="card-grid">
        <label class="cm-field"><span>Assignee</span>
          <select id="cm-assignee" data-no-sound ${ro(full || memEdit)}>
            ${assignOpts.map(o => `<option value="${esc(o.id)}" ${o.id === (t.assignee_id || '') ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}
          </select></label>
        <label class="cm-field"><span>Column</span>
          <select id="cm-col" data-no-sound ${ro(memEdit)}>
            ${cols.map(c => `<option value="${esc(c.id)}" ${c.id === t.column_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
          </select></label>
        <label class="cm-field"><span>Priority</span>
          <select id="cm-pri" data-no-sound ${ro(full)}>
            ${Object.keys(PRI).map(k => `<option value="${k}" ${k === t.priority ? 'selected' : ''}>${PRI[k].l}</option>`).join('')}
          </select></label>
        <label class="cm-field"><span>Points</span><input id="cm-pts" type="number" min="0" value="${t.points || 0}" ${ro(full)} /></label>
        <label class="cm-field"><span>Due date</span><input id="cm-due" type="date" value="${esc(t.due_date || '')}" ${ro(full)} /></label>
        <label class="cm-field"><span>Labels <i>(comma-sep)</i></span><input id="cm-labels" value="${esc((t.labels || []).join(', '))}" ${ro(full)} /></label>
      </div>
      <label class="cm-field"><span>Attachment link</span><input id="cm-att" value="${esc(t.attachment_url || '')}" ${ro(full)} placeholder="Figma / Drive / Roblox link" /></label>
      <label class="cm-field"><span>Description</span><textarea id="cm-desc" rows="3" ${ro(full)} placeholder="Details, acceptance criteria…">${esc(t.description || '')}</textarea></label>

      <div class="cm-checklist">
        <div class="cm-sub">Checklist <span id="cm-chk-prog"></span></div>
        <div id="cm-chk-list"></div>
        ${(full || memEdit) ? `<div class="cm-chk-add"><input id="cm-chk-new" placeholder="Add a subtask…" /><button class="btn btn--ghost btn--sm" id="cm-chk-add" data-no-sound>Add</button></div>` : ''}
      </div>

      <div class="cm-comments">
        <div class="cm-sub">Comments</div>
        <div id="cm-comment-list" class="cm-comment-list">Loading…</div>
        <div class="cm-comment-add"><textarea id="cm-comment-new" rows="2" placeholder="Write a comment…"></textarea><button class="btn btn--primary btn--sm" id="cm-comment-send" data-no-sound>Send</button></div>
      </div>

      <div class="modal__actions">
        ${full ? `<button class="btn btn--ghost btn--danger" id="cm-delete" data-no-sound>Delete</button>` : ''}
        <span style="flex:1"></span>
        <button class="btn btn--ghost" data-x data-no-sound>Close</button>
        ${(full || memEdit) ? `<button class="btn btn--primary" id="cm-save" data-no-sound>Save changes</button>` : ''}
      </div>`;

    function renderChk() {
      const prog = $('#cm-chk-prog'); const done = chk.filter(c => c.done).length;
      prog.textContent = chk.length ? `${done}/${chk.length}` : '';
      $('#cm-chk-list').innerHTML = chk.map((c, i) => `<label class="chk-item ${c.done ? 'is-done' : ''}">
        <input type="checkbox" ${c.done ? 'checked' : ''} ${(full || memEdit) ? '' : 'disabled'} data-chk="${i}" />
        <span>${esc(c.text)}</span>
        ${full ? `<button class="chk-del" data-chk-del="${i}" data-no-sound>✕</button>` : ''}</label>`).join('');
      $$('#cm-chk-list [data-chk]').forEach(cb => cb.addEventListener('change', () => { chk[+cb.dataset.chk].done = cb.checked; renderChk(); }));
      $$('#cm-chk-list [data-chk-del]').forEach(b => b.addEventListener('click', () => { chk.splice(+b.dataset.chkDel, 1); renderChk(); }));
    }
    renderChk();
    if ($('#cm-chk-add')) $('#cm-chk-add').addEventListener('click', () => {
      const inp = $('#cm-chk-new'); const v = inp.value.trim(); if (!v) return; chk.push({ text: v, done: false }); inp.value = ''; renderChk(); inp.focus();
    });

    // comments
    loadComments(id);
    $('#cm-comment-send').addEventListener('click', async () => {
      const inp = $('#cm-comment-new'); const v = inp.value.trim(); if (!v) return;
      inp.value = '';
      try { await window.Board.addComment(id, v); loadComments(id); } catch (e) { toast('Comment failed — ' + e.message, 'error'); }
    });

    // save
    const save = $('#cm-save');
    if (save) save.addEventListener('click', async () => {
      const newCol = $('#cm-col').value;
      const col = columns.find(c => c.id === newCol);
      const assigneeId = $('#cm-assignee') ? $('#cm-assignee').value : (t.assignee_id || '');
      const am = members.find(m => m.discord_id === assigneeId);
      const aName = assigneeId === ACCESS.discord_id ? (me.global_name || me.username || '') : (am ? am.username : (t.assignee_id === assigneeId ? t.assignee_name : ''));
      const patch = {
        column_id: newCol,
        completed_at: col && col.is_done ? (t.completed_at || new Date().toISOString()) : null,
        assignee_id: assigneeId || null,
        assignee_name: assigneeId ? aName : '',
        assignee_avatar: assigneeId === ACCESS.discord_id ? (me.avatar || '') : (assigneeId === t.assignee_id ? t.assignee_avatar : ''),
      };
      if (full) {
        patch.title = $('#cm-title').value.trim() || t.title;
        patch.description = $('#cm-desc').value;
        patch.priority = $('#cm-pri').value;
        patch.points = Math.max(0, parseInt($('#cm-pts').value, 10) || 0);
        patch.due_date = $('#cm-due').value || null;
        patch.attachment_url = $('#cm-att').value.trim();
        patch.labels = $('#cm-labels').value.split(',').map(s => s.trim()).filter(Boolean);
        patch.checklist = chk;
      } else {
        patch.checklist = chk; // members can tick subtasks
      }
      try {
        const updated = await window.Board.updateTask(id, patch);
        Object.assign(t, updated || patch);
        closeCard();
        refreshAfterMutation();
        toast('Saved', 'success');
      } catch (e) { toast('Save failed — ' + e.message, 'error'); }
    });

    if ($('#cm-delete')) $('#cm-delete').addEventListener('click', async () => {
      if (!confirm('Delete this card? This can’t be undone.')) return;
      try { await window.Board.deleteTask(id); tasks = tasks.filter(x => x.id !== id); closeCard(); refreshAfterMutation(); }
      catch (e) { toast('Delete failed — ' + e.message, 'error'); }
    });

    $$('#card-modal [data-x]').forEach(b => b.addEventListener('click', closeCard));
    openModal('#card-modal');
  }

  async function loadComments(taskId) {
    const wrap = $('#cm-comment-list'); if (!wrap) return;
    try {
      const list = await window.Board.listComments(taskId);
      wrap.innerHTML = list.length ? list.map(c => `<div class="cmt">
        <span class="cmt__ava ava--ini">${esc((c.author_name || '?').charAt(0).toUpperCase())}</span>
        <div><div class="cmt__head"><b>${esc(c.author_name || 'member')}</b> <time>${rel(c.created_at)}</time></div>
        <div class="cmt__body">${esc(c.body)}</div></div></div>`).join('') : '<p class="cm-none">No comments yet.</p>';
    } catch (e) { wrap.innerHTML = '<p class="cm-none">Couldn’t load comments.</p>'; }
  }

  /* ===================== GAME create/edit ===================== */
  let editingGame = null;
  function openGameModal(g) {
    editingGame = g || null;
    $('#game-modal-title').textContent = g ? 'Edit game' : 'New game';
    $('#gm-name').value = g ? g.name : '';
    $('#gm-desc').value = g ? (g.description || '') : '';
    $('#gm-status').value = g ? g.status : 'planning';
    $('#gm-roblox').value = g ? (g.roblox_url || '') : '';
    $('#gm-archive').classList.toggle('hidden', !g);
    openModal('#game-modal');
    $('#gm-name').focus();
  }
  async function saveGame() {
    const name = $('#gm-name').value.trim();
    if (!name) return toast('Give the game a name first.', 'error');
    const data = { name, description: $('#gm-desc').value.trim(), status: $('#gm-status').value, roblox_url: $('#gm-roblox').value.trim() };
    try {
      if (editingGame) { await window.Board.updateGame(editingGame.id, data); }
      else { const ng = await window.Board.createGame(data); game = ng; }
      closeModal('#game-modal');
      await loadGames();
      toast(editingGame ? 'Game updated' : 'Game created ✓', 'success');
    } catch (e) { toast('Couldn’t save — ' + e.message, 'error'); }
  }

  /* ===================== MANAGE (members + leads) ===================== */
  async function openManage() {
    $('#manage-game-name').textContent = game.name;
    await renderMembers();
    await renderLeads();
    openModal('#manage-modal');
  }
  async function renderMembers() {
    members = await window.Board.getMembers(game.id);
    $('#members-list').innerHTML = members.length ? members.map(m => `<span class="chip">
      <b>${esc(m.username || m.discord_id)}</b><i>${esc(DISC[m.discipline] ? DISC[m.discipline].short : m.discipline)}</i>
      <button data-rm-member="${esc(m.discord_id)}" data-no-sound aria-label="Remove">✕</button></span>`).join('') : '<p class="cm-none">No members yet.</p>';
    $$('#members-list [data-rm-member]').forEach(b => b.addEventListener('click', async () => {
      await window.Board.removeMember(game.id, b.dataset.rmMember); renderMembers();
    }));
  }
  async function renderLeads() {
    const leads = await window.Board.listLeads();
    $('#leads-list').innerHTML = leads.length ? leads.map(l => `<span class="chip">
      <b>${esc(l.username || l.discord_id)}</b><i>Head of ${esc(DISC[l.discipline] ? DISC[l.discipline].short : l.discipline)}</i>
      <button data-rm-lead="${esc(l.discord_id)}|${esc(l.discipline)}" data-no-sound aria-label="Remove">✕</button></span>`).join('') : '<p class="cm-none">No leads appointed.</p>';
    $$('#leads-list [data-rm-lead]').forEach(b => b.addEventListener('click', async () => {
      const [id, disc] = b.dataset.rmLead.split('|'); await window.Board.removeLead(id, disc); renderLeads();
    }));
  }

  /* ===================== REALTIME ===================== */
  let rtTimer = null;
  function subscribeRealtime(gameId) {
    if (rt) { try { rt.unsubscribe(); } catch (e) {} rt = null; }
    rt = window.Board.realtime(gameId, () => {
      clearTimeout(rtTimer);
      rtTimer = setTimeout(async () => {
        if (!game || game.id !== gameId) return;
        tasks = await window.Board.listTasks(gameId);
        renderHead(); renderTabs(); renderCanvas();
      }, 350);
    });
  }

  /* ===================== modal helpers + global wiring ===================== */
  function openModal(sel) { const m = $(sel); m.classList.remove('hidden'); document.body.style.overflow = 'hidden'; }
  function closeModal(sel) { $(sel).classList.add('hidden'); document.body.style.overflow = ''; }
  function closeCard() { closeModal('#card-modal'); }

  function wireGlobal() {
    $('#new-game').addEventListener('click', () => openGameModal(null));
    $('#manage-game').addEventListener('click', () => game && openManage());
    $('#gm-cancel').addEventListener('click', () => closeModal('#game-modal'));
    $('#gm-save').addEventListener('click', saveGame);
    $('#gm-archive').addEventListener('click', async () => {
      if (!editingGame || !confirm('Archive this game? It’ll be hidden from the studio.')) return;
      await window.Board.archiveGame(editingGame.id); closeModal('#game-modal'); game = null; await loadGames(); toast('Game archived', 'success');
    });
    $('#manage-close').addEventListener('click', () => closeModal('#manage-modal'));
    $('#mm-add').addEventListener('click', async () => {
      const r = await window.Board.addMember(game.id, { discord_id: $('#mm-id').value, username: $('#mm-name').value, discipline: $('#mm-disc').value });
      if (r && r.error) return toast(r.error, 'error');
      $('#mm-id').value = ''; $('#mm-name').value = ''; renderMembers(); toast('Member added ✓', 'success');
    });
    $('#ml-add').addEventListener('click', async () => {
      const r = await window.Board.setLead($('#ml-id').value, $('#ml-disc').value, $('#ml-name').value);
      if (r && r.error) return toast(r.error, 'error');
      $('#ml-id').value = ''; $('#ml-name').value = ''; renderLeads(); toast('Lead appointed ✓', 'success');
    });
    // double-click game name to edit (staff)
    $('#game-name').addEventListener('dblclick', () => { if (canManage() && game) openGameModal(game); });
    // overlay click + Esc to close
    $$('.modal-overlay').forEach(o => o.addEventListener('click', (e) => { if (e.target === o) { o.classList.add('hidden'); document.body.style.overflow = ''; } }));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $$('.modal-overlay:not(.hidden)').forEach(o => { o.classList.add('hidden'); document.body.style.overflow = ''; }); });
  }

  /* ---- util ---- */
  function rel(iso) {
    const s = Math.floor((Date.now() - new Date(iso)) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
