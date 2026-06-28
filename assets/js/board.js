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
  const DIFF = {
    easy: { l: 'Easy', c: '#36E2A0', n: 1 }, medium: { l: 'Medium', c: '#FFC24B', n: 2 }, hard: { l: 'Hard', c: '#FF4D6D', n: 3 },
  };
  const diffOf = (t) => DIFF[t.difficulty] ? t.difficulty : 'medium';
  const STATUS_LABEL = { planning: 'Planning', in_dev: 'In development', testing: 'Testing', launched: 'Launched', paused: 'Paused' };

  /* ---- state ---- */
  let ACCESS = { discord_id: '', is_staff: false, leads: [], game_ids: [], memberships: [] };
  let GAMES = [];
  let game = null;            // active game (from GAMES)
  let boards = [], columns = [], tasks = [], members = [];
  let activeDisc = 'overview';
  let rt = null;
  let dragId = null;
  let view = 'board';        // 'board' | 'mytasks' | 'analytics'
  let myTaskList = [];

  /* ---- permissions (mirror RLS) ---- */
  const canManage = () => ACCESS.is_staff;
  const isMember = () => (ACCESS.game_ids || []).includes(game && game.id);
  const myMembership = (gid) => (ACCESS.memberships || []).find(m => m.game_id === gid) || null;
  const isLead = (disc) => (ACCESS.leads || []).includes(disc);
  // who may approve work on a discipline (push a task into Done)
  const canApprove = (disc) => ACCESS.is_staff || (disc !== 'overview' && isLead(disc));
  // who may edit a card's settings (title, points, difficulty…) — staff + leads
  const canEditDisc = (disc) => ACCESS.is_staff || (disc !== 'overview' && isLead(disc));
  // members may carry their own work, but never touch Overview and never self-approve
  const canMoveTask = (t) => {
    if (t.discipline === 'overview') return canManage();
    if (canEditDisc(t.discipline)) return true;
    return isMember() && (t.assignee_id === ACCESS.discord_id || !t.assignee_id);
  };
  // which discipline tabs this person should even see for the active game
  function visibleDiscs() {
    const present = DISC_ORDER.filter(d => boards.some(b => b.discipline === d));
    if (canManage()) return present;
    const allow = new Set(['overview']);
    (ACCESS.leads || []).forEach(d => allow.add(d));
    const mem = myMembership(game && game.id);
    if (mem) {
      if (mem.discipline === 'all') ['scripter', 'modeler_animator', 'uiux'].forEach(d => allow.add(d));
      else allow.add(mem.discipline);
    }
    return present.filter(d => allow.has(d));
  }
  const colById = (id) => columns.find(c => c.id === id) || null;
  const colByName = (boardId, name) => columns.find(c => c.board_id === boardId && c.name.toLowerCase() === name.toLowerCase()) || null;
  const isReviewCol = (id) => { const c = colById(id); return c && c.name.toLowerCase() === 'review'; };
  const isDoneCol = (id) => { const c = colById(id); return c && c.is_done; };

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
      $('#analytics-btn').classList.remove('hidden');
    }
    wireGlobal();
    await loadGames();
    refreshMyCount();
    refreshFeedbackCount();
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
    view = 'board';
    const mtb = $('#mytasks-btn'); if (mtb) mtb.classList.remove('is-active');
    const anb = $('#analytics-btn'); if (anb) anb.classList.remove('is-active');
    $('#board-canvas').classList.remove('board-canvas--list');
    if (canManage()) $('#manage-game').classList.remove('hidden');
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
  const PROD = ['scripter', 'modeler_animator', 'uiux'];   // disciplines that count toward completion
  function discStats() {
    const out = {};
    const doneColIds = new Set(columns.filter(c => c.is_done).map(c => c.id));
    // weight the whole game consistently: by coins if any are set, else by task count
    const usePts = tasks.some(t => PROD.includes(t.discipline) && t.points > 0);
    PROD.forEach(d => {
      const ts = tasks.filter(t => t.discipline === d);
      const done = ts.filter(t => doneColIds.has(t.column_id));
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
    renderMeter();
    $('#game-meter-legend').innerHTML = PROD.map(d => {
      const s = discStats()[d];
      return `<span class="leg"><i style="background:${DISC[d].tint}"></i>${DISC[d].short} ${s.done}/${s.total}</span>`;
    }).join('');
  }

  // Builds the segmented meter once, then updates widths in place so the fill
  // animates smoothly instead of flashing back to 0 on every re-render.
  function renderMeter() {
    const s = discStats();
    const grand = PROD.reduce((a, d) => a + s[d].weight, 0);
    const grandDone = PROD.reduce((a, d) => a + s[d].weightDone, 0);
    const overall = pct(grandDone, grand);
    const host = $('#game-meter');
    let bar = host.querySelector('.meter__bar');
    const fresh = !bar || bar.children.length !== PROD.length;
    if (fresh) {
      host.innerHTML = `<div class="meter__bar">${PROD.map(d =>
        `<span class="seg" data-seg="${d}" style="--tint:${DISC[d].tint}"><span class="seg__fill"></span></span>`).join('')
        }</div><div class="meter__num"><span class="meter__n">0</span><span>%</span></div>`;
      bar = host.querySelector('.meter__bar');
    }
    PROD.forEach(d => {
      const seg = bar.querySelector(`[data-seg="${d}"]`);
      if (!seg) return;
      const basis = grand ? (s[d].weight / grand * 100) : 33.33;
      const fill = s[d].weight ? (s[d].weightDone / s[d].weight * 100) : 0;
      seg.style.flex = String(basis);
      seg.title = `${DISC[d].short}: ${pct(s[d].weightDone, s[d].weight)}% (${s[d].done}/${s[d].total})`;
      seg.querySelector('.seg__fill').style.width = fill + '%';
    });
    const num = host.querySelector('.meter__n'); if (num) num.textContent = overall;
  }

  /* ===================== TABS ===================== */
  function renderTabs() {
    const wrap = $('#board-tabs');
    const discs = visibleDiscs();
    if (!discs.includes(activeDisc)) activeDisc = discs[0] || 'overview';
    wrap.innerHTML = discs.map(d => {
      const n = tasks.filter(t => t.discipline === d).length;
      const ro = d === 'overview' && !canManage();
      return `<button class="board-tab${d === activeDisc ? ' is-active' : ''}" data-disc="${d}" style="--tint:${DISC[d].tint}">
        ${esc(DISC[d].name)}${ro ? ' <span class="tab-ro" title="View only">view</span>' : ''}${n ? ` <span class="tab-n">${n}</span>` : ''}</button>`;
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

  function canClaim(t) {
    if (t.assignee_id || t.discipline === 'overview') return false;
    return ACCESS.is_staff || (ACCESS.leads || []).includes(t.discipline) || isMember();
  }

  function cardHtml(t) {
    const pri = PRI[t.priority] || PRI.medium;
    const d = diffOf(t);
    const chk = Array.isArray(t.checklist) ? t.checklist : [];
    const chkDone = chk.filter(c => c.done).length;
    const due = t.due_date ? dueChip(t.due_date) : '';
    const labels = (t.labels || []).map(l => `<span class="lbl">${esc(l)}</span>`).join('');
    const right = t.assignee_id ? avatarChip(t)
      : (canClaim(t) ? `<button class="claim-btn" data-claim="${t.id}" data-no-sound title="Claim this task">✋ Claim</button>` : '');
    return `<article class="task-card" data-task="${t.id}" draggable="${canMoveTask(t) ? 'true' : 'false'}" style="--pri:${pri.c}">
      <div class="task-card__pri"></div>
      <div class="task-card__title">${esc(t.title)}</div>
      ${labels ? `<div class="task-card__labels">${labels}</div>` : ''}
      <div class="task-card__foot">
        <span class="task-meta">
          <span class="diff diff--${d}" title="Difficulty: ${DIFF[d].l}">${DIFF[d].l}</span>
          ${t.points > 0 ? `<span class="pts">◆ ${t.points}</span>` : ''}
          ${chk.length ? `<span class="chk ${chkDone === chk.length ? 'chk--done' : ''}">☑ ${chkDone}/${chk.length}</span>` : ''}
          ${t.attachment_url ? `<span class="att" title="Has an attachment">🔗</span>` : ''}
          ${due}
        </span>
        ${right}
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
      if (e.target.closest('[data-claim]')) return; // claim button handles itself
      openCard(c.dataset.task);
    }));
    // claim buttons
    $$('#board-canvas [data-claim]').forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); claimTask(b.dataset.claim); }));
    // add-card composers
    $$('#board-canvas .col__add').forEach(btn => btn.addEventListener('click', () => openComposer(btn, board)));
    // drag & drop (desktop)
    $$('#board-canvas .task-card[draggable="true"]').forEach(card => {
      card.addEventListener('dragstart', (e) => { dragId = card.dataset.task; card.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
      card.addEventListener('dragend', () => { dragId = null; $$('.task-card.dragging').forEach(x => x.classList.remove('dragging')); $$('.col__body.drop-on, .col__body.drop-block').forEach(x => x.classList.remove('drop-on', 'drop-block')); });
    });
    $$('#board-canvas .col__body').forEach(body => {
      const colId = body.dataset.drop;
      // can the dragged task legally land here? (members can't approve into Done)
      const blocked = () => {
        if (!dragId) return false;
        const t = tasks.find(x => x.id === dragId);
        return t && isDoneCol(colId) && !canApprove(t.discipline);
      };
      body.addEventListener('dragover', (e) => {
        if (!dragId) return;
        e.preventDefault();
        if (blocked()) { e.dataTransfer.dropEffect = 'none'; body.classList.add('drop-block'); return; }
        e.dataTransfer.dropEffect = 'move';
        body.classList.add('drop-on');
        const dragged = $(`.task-card[data-task="${dragId}"]`);
        if (!dragged) return;
        const after = afterElement(body, e.clientY);
        // only touch the DOM when the position actually changes — kills the flicker
        if (after == null) {
          if (body.lastElementChild !== dragged) body.appendChild(dragged);
        } else if (after !== dragged && after.previousElementSibling !== dragged) {
          body.insertBefore(dragged, after);
        }
      });
      body.addEventListener('dragleave', (e) => { if (!body.contains(e.relatedTarget)) body.classList.remove('drop-on', 'drop-block'); });
      body.addEventListener('drop', (e) => {
        e.preventDefault();
        body.classList.remove('drop-on', 'drop-block');
        if (blocked()) { toast('Submit it to Review — only an admin or the discipline lead can approve into Done.', 'error'); dragId = null; return selectGame(game.id); }
        commitDrop(body);
      });
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
    const oldColId = task.column_id;
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
      fireMoveNotifs(task, oldColId, col);
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

  /* ===================== CLAIM ===================== */
  async function claimTask(id) {
    const r = await window.Board.claimTask(id);
    if (r && r.ok) {
      const u = window.Auth.getUser() || {};
      const t = tasks.find(x => x.id === id);
      if (t) {
        const mem = members.find(m => m.discord_id === ACCESS.discord_id) || {};
        t.assignee_id = ACCESS.discord_id || u.id || 'me';
        t.assignee_name = u.global_name || u.username || mem.username || 'You';
        t.assignee_avatar = u.avatar || '';
      }
      if (window.Sound) window.Sound.play('select');
      toast('Claimed ✓ — it’s in your tasks now.', 'success');
      refreshAfterMutation();
      refreshMyCount();
    } else if (r && r.reason === 'limit') {
      const dl = DIFF[r.difficulty] ? DIFF[r.difficulty].l.toLowerCase() : r.difficulty;
      toast(`Hold on — you’ve already got your ${r.cap} ${dl} task${r.cap > 1 ? 's' : ''} on the go. Finish or drop one first.`, 'error');
    } else if (r && r.reason === 'already_claimed') {
      toast(`Someone just claimed this${r.by ? ' (' + r.by + ')' : ''}.`, 'error');
      if (game) selectGame(game.id);
    } else if (r && r.reason === 'no_access') {
      toast('You’re not on this game’s team yet.', 'error');
    } else if (r && r.reason === 'not_logged_in') {
      toast('Log in with Discord to claim tasks.', 'error');
    } else {
      toast('Couldn’t claim that — try again.', 'error');
    }
  }

  /* ===================== Discord notifications ===================== */
  function fireAssignNotif(task, oldAssignee, newAssignee) {
    if (newAssignee && newAssignee !== oldAssignee && newAssignee !== ACCESS.discord_id) {
      window.Board.notifyTask('assign', task, game && game.name);
    }
  }
  function fireMoveNotifs(task, oldColId, newCol) {
    if (!newCol || oldColId === newCol.id) return;
    const oldCol = columns.find(c => c.id === oldColId);
    if (newCol.is_done && !(oldCol && oldCol.is_done)) window.Board.notifyTask('done', task, game && game.name);
    else if (newCol.name === 'Review' && !(oldCol && oldCol.name === 'Review')) window.Board.notifyTask('review', task, game && game.name);
  }

  /* ===================== MY TASKS ===================== */
  async function refreshMyCount() {
    try { myTaskList = await window.Board.myTasks(); } catch (e) { myTaskList = []; }
    const open = myTaskList.filter(t => !t.completed_at).length;
    const el = $('#mytasks-count');
    if (el) { el.textContent = open; el.classList.toggle('hidden', open === 0); }
  }

  async function showMyTasks() {
    view = 'mytasks';
    $('#mytasks-btn').classList.add('is-active');
    $('#analytics-btn').classList.remove('is-active');
    $$('#game-list .game-card').forEach(c => c.classList.remove('is-active'));
    try { myTaskList = await window.Board.myTasks(); } catch (e) { myTaskList = []; }
    const open = myTaskList.filter(t => !t.completed_at).length;
    const cnt = $('#mytasks-count'); if (cnt) { cnt.textContent = open; cnt.classList.toggle('hidden', open === 0); }

    $('#game-name').textContent = 'My tasks';
    const st = $('#game-status'); st.textContent = myTaskList.length ? `${open} open` : ''; st.className = 'game-status';
    $('#game-meter').innerHTML = ''; $('#game-meter-legend').innerHTML = '';
    $('#board-tabs').innerHTML = '';
    $('#manage-game').classList.add('hidden');
    const canvas = $('#board-canvas');
    canvas.classList.add('board-canvas--list');
    if (!myTaskList.length) {
      canvas.innerHTML = `<div class="board-empty">◎ Nothing assigned to you right now. Claim an unassigned card from a board (✋ Claim) or wait for a lead to assign you one — it lands here, across every game.</div>`;
      return;
    }
    const byGame = {};
    myTaskList.forEach(t => { (byGame[t.game_id] = byGame[t.game_id] || []).push(t); });
    const gName = (id) => { const g = GAMES.find(x => x.id === id); return g ? g.name : 'Game'; };
    const L = CFG.claimLimits || { easy: 3, medium: 2, hard: 1 };
    const earn = await myEarnings();
    const per = CFG.coinsPerPercent || 50;
    const share = (c) => { const v = c / per; return v >= 10 ? v.toFixed(0) : v.toFixed(1); };
    const earnBanner = earn ? `<div class="mt-earn">
      <div class="mt-earn__big">◆ ${earn.earned}<span>earned</span></div>
      <div class="mt-earn__big mt-earn__big--soft">◆ ${earn.pending}<span>in progress</span></div>
      <div class="mt-earn__big mt-earn__big--share">${share(earn.earned)}%<span>≈ rev share</span></div>
    </div>` : '';
    const hint = `<div class="mt-hint">You can hold up to <b>${L.easy} easy</b>, <b>${L.medium} medium</b>, and <b>${L.hard} hard</b> task at once — finishing one frees a slot to claim another.</div>`;
    canvas.innerHTML = earnBanner + hint + Object.keys(byGame).map(gid => `
      <div class="mt-group">
        <div class="mt-group__h">${esc(gName(gid))}</div>
        ${byGame[gid].map(mtItem).join('')}
      </div>`).join('');
    $$('#board-canvas [data-mt]').forEach(el => el.addEventListener('click', () => jumpToTask(el.dataset.mt, el.dataset.game, el.dataset.disc)));
  }

  function mtItem(t) {
    const pri = PRI[t.priority] || PRI.medium;
    const due = t.due_date ? dueChip(t.due_date) : '';
    const done = Boolean(t.completed_at);
    const meta = [DISC[t.discipline] ? DISC[t.discipline].short : t.discipline, DIFF[diffOf(t)].l, t.points > 0 ? `◆ ${t.points}` : ''].filter(Boolean).join(' · ');
    return `<button class="mt-item${done ? ' is-done' : ''}" data-mt="${t.id}" data-game="${t.game_id}" data-disc="${t.discipline}" style="--pri:${pri.c}" data-no-sound>
      <span class="mt-item__pri"></span>
      <span class="mt-item__main"><b>${esc(t.title)}</b>
        <span class="mt-item__meta">${esc(meta)}${due ? ' · ' + due : ''}</span></span>
      ${done ? '<span class="mt-done">✓ done</span>' : `<span class="mt-pri" style="color:${pri.c}">${pri.l}</span>`}
    </button>`;
  }

  async function jumpToTask(taskId, gameId, disc) {
    await selectGame(gameId);
    activeDisc = DISC_ORDER.includes(disc) ? disc : 'overview';
    renderTabs(); renderCanvas();
    openCard(taskId);
  }

  async function myEarnings() {
    try {
      const rows = await window.Board.coinLedger();
      const mine = (rows || []).find(r => r.discord_id === ACCESS.discord_id);
      if (!mine) return { earned: 0, pending: 0 };
      return { earned: Number(mine.earned || 0), pending: Number(mine.pending || 0) };
    } catch (e) { return null; }
  }

  /* ===================== TEAM ANALYTICS (staff) ===================== */
  async function showAnalytics() {
    if (!canManage()) return;
    view = 'analytics';
    $('#mytasks-btn').classList.remove('is-active');
    $('#analytics-btn').classList.add('is-active');
    $$('#game-list .game-card').forEach(c => c.classList.remove('is-active'));
    $('#game-name').textContent = 'Team analytics';
    const stt = $('#game-status'); stt.textContent = 'across all games'; stt.className = 'game-status';
    $('#game-meter').innerHTML = ''; $('#game-meter-legend').innerHTML = '';
    $('#board-tabs').innerHTML = '';
    $('#manage-game').classList.add('hidden');
    const canvas = $('#board-canvas');
    canvas.classList.add('board-canvas--list');
    canvas.innerHTML = '<div class="board-empty">Loading analytics…</div>';

    let devs = [], feed = [], fb = [];
    try { [devs, feed, fb] = await Promise.all([window.Board.devAnalytics(), window.Board.activityFeed(60), window.Board.listFeedback()]); }
    catch (e) { canvas.innerHTML = '<div class="board-empty">Couldn’t load analytics.</div>'; return; }

    const per = CFG.coinsPerPercent || 50;
    const share = (c) => { const v = c / per; return v >= 10 ? v.toFixed(0) : v.toFixed(1); };
    const totDone = devs.reduce((a, d) => a + (d.tasks_done || 0), 0);
    const totPts = devs.reduce((a, d) => a + Number(d.points || 0), 0);
    const active7 = devs.filter(d => (d.actions_7d || 0) > 0).length;

    const cards = `<div class="an-cards">
      <div class="an-card"><span class="an-card__n">${devs.length}</span><span class="an-card__l">developers</span></div>
      <div class="an-card"><span class="an-card__n">${active7}</span><span class="an-card__l">active this week</span></div>
      <div class="an-card"><span class="an-card__n">${totDone}</span><span class="an-card__l">tasks approved</span></div>
      <div class="an-card"><span class="an-card__n">◆ ${totPts}</span><span class="an-card__l">coins awarded</span></div>
    </div>`;

    const devTable = devs.length ? `<div class="an-table">
      <div class="an-row an-row--head"><span>Developer</span><span>Done</span><span>Open</span><span>Coins</span><span>≈ Share</span><span>7d / 30d</span><span>Last active</span></div>
      ${devs.map(d => `<div class="an-row">
        <span class="an-dev"><span class="ava ava--ini">${esc((d.username || '?').charAt(0).toUpperCase())}</span>${esc(d.username || d.discord_id)}</span>
        <span>${d.tasks_done || 0}</span>
        <span class="an-soft">${d.tasks_open || 0}</span>
        <span class="an-coins">◆ ${d.points || 0}</span>
        <span class="an-share">${share(Number(d.points || 0))}%</span>
        <span class="an-soft">${d.actions_7d || 0} / ${d.actions_30d || 0}</span>
        <span class="an-soft">${d.last_active ? rel(d.last_active) : '—'}</span>
      </div>`).join('')}</div>` : '<p class="cm-none">No developer activity yet.</p>';

    const openFb = fb.filter(f => !f.resolved);
    const fbBlock = `<div class="an-sub">Feedback ${openFb.length ? `<span class="an-pill">${openFb.length} open</span>` : ''}</div>
      ${fb.length ? fb.map(fbItem).join('') : '<p class="cm-none">No feedback yet.</p>'}`;

    const feedBlock = `<div class="an-sub">Recent activity</div>
      ${feed.length ? `<div class="an-feed">${feed.map(feedItem).join('')}</div>` : '<p class="cm-none">No activity logged yet.</p>'}`;

    canvas.innerHTML = `<div class="an-wrap">
      <div class="an-col">${cards}<div class="an-sub">Developers</div>${devTable}${fbBlock}</div>
      <div class="an-col an-col--side">${feedBlock}</div>
    </div>`;
    $$('#board-canvas [data-fb-resolve]').forEach(b => b.addEventListener('click', async () => {
      await window.Board.resolveFeedback(b.dataset.fbResolve, b.dataset.fbState === '1');
      showAnalytics();
    }));
  }

  const ACT = {
    created: { i: '✦', t: 'created' }, claimed: { i: '✋', t: 'claimed' }, assigned: { i: '📌', t: 'was assigned' },
    submitted: { i: '🔎', t: 'submitted for review' }, approved: { i: '✓', t: 'approved' }, commented: { i: '💬', t: 'commented on' },
  };
  function feedItem(a) {
    const m = ACT[a.type] || { i: '•', t: a.type };
    const pts = a.meta && a.meta.points ? ` <b class="an-coins">◆ ${a.meta.points}</b>` : '';
    return `<div class="an-act"><span class="an-act__i">${m.i}</span>
      <span class="an-act__b"><b>${esc(a.actor_name || 'Someone')}</b> ${m.t} <i>${esc(a.task_title || '')}</i>${pts}
      <time>${rel(a.created_at)}</time></span></div>`;
  }
  const FBK = { note: '💬 Note', idea: '💡 Idea', issue: '⚠️ Issue', blocker: '🛑 Blocker' };
  function fbItem(f) {
    return `<div class="fb-card${f.resolved ? ' is-resolved' : ''}">
      <div class="fb-card__head"><span class="fb-tag fb-tag--${esc(f.kind)}">${FBK[f.kind] || f.kind}</span>
        <b>${esc(f.author_name || 'dev')}</b><time>${rel(f.created_at)}</time>
        ${canManage() ? `<button class="fb-resolve" data-fb-resolve="${esc(f.id)}" data-fb-state="${f.resolved ? '0' : '1'}" data-no-sound>${f.resolved ? 'Reopen' : '✓ Resolve'}</button>` : ''}</div>
      <div class="fb-card__body">${esc(f.body)}</div></div>`;
  }

  /* ===================== FEEDBACK (compose) ===================== */
  let fbKind = 'note';
  async function openFeedback() {
    fbKind = 'note';
    $$('#fb-kinds .fb-kind').forEach(b => b.classList.toggle('is-active', b.dataset.kind === 'note'));
    $('#fb-body').value = '';
    const list = $('#fb-list');
    list.innerHTML = '';
    try {
      const mine = await window.Board.listFeedback();
      if (mine.length) list.innerHTML = `<div class="an-sub">${canManage() ? 'All feedback' : 'Your feedback'}</div>` + mine.map(fbItem).join('');
    } catch (e) {}
    openModal('#feedback-modal');
    $('#fb-body').focus();
  }
  async function sendFeedback() {
    const body = $('#fb-body').value.trim();
    if (!body) return toast('Write something first.', 'error');
    const r = await window.Board.submitFeedback({ kind: fbKind, body, game_id: game && game.id });
    if (r && r.error) return toast(r.error, 'error');
    if (window.Sound) window.Sound.play('select');
    toast('Thanks — the owner will see this.', 'success');
    closeModal('#feedback-modal');
    refreshFeedbackCount();
  }
  async function refreshFeedbackCount() {
    if (!canManage()) { $('#feedback-count').classList.add('hidden'); return; }
    try {
      const fb = await window.Board.listFeedback();
      const open = fb.filter(f => !f.resolved).length;
      const el = $('#feedback-count'); el.textContent = open; el.classList.toggle('hidden', open === 0);
    } catch (e) {}
  }

  /* ===================== COINS LEDGER ===================== */
  async function openCoins() {
    const wrap = $('#ledger');
    wrap.innerHTML = '<p class="cm-none">Loading…</p>';
    $('#ledger-note').textContent = '';
    openModal('#coins-modal');
    let rows = [];
    try { rows = await window.Board.coinLedger(); } catch (e) { wrap.innerHTML = '<p class="cm-none">Couldn’t load the ledger.</p>'; return; }
    const per = CFG.coinsPerPercent || 50;
    if (!rows.length) {
      wrap.innerHTML = '<p class="cm-none">No coins earned yet. Give tasks a coin value, assign them, and move them to Done — earnings show up here.</p>';
      return;
    }
    const totalEarned = rows.reduce((a, r) => a + Number(r.earned || 0), 0);
    const shareTxt = (coins) => { const s = coins / per; return s >= 10 ? s.toFixed(0) : s.toFixed(1); };
    wrap.innerHTML =
      `<div class="ledger-row ledger-row--head"><span>Developer</span><span>Earned</span><span>In progress</span><span>≈ Share</span></div>` +
      rows.map(r => {
        const earned = Number(r.earned || 0), pending = Number(r.pending || 0);
        return `<div class="ledger-row">
          <span class="ldg-dev"><span class="ava ava--ini">${esc((r.username || '?').charAt(0).toUpperCase())}</span>${esc(r.username || r.discord_id)}</span>
          <span class="ldg-earned">◆ ${earned}</span>
          <span class="ldg-pending">◆ ${pending}</span>
          <span class="ldg-share">${shareTxt(earned)}%</span>
        </div>`;
      }).join('') +
      `<div class="ledger-row ledger-row--total"><span>Total earned</span><span>◆ ${totalEarned}</span><span></span><span>${shareTxt(totalEarned)}%</span></div>`;
    $('#ledger-note').textContent = `${per} coins ≈ 1% revenue share. Earned = coins on approved (Done) tasks. Change the rate in config.js (coinsPerPercent).`;
  }

  /* ===================== CARD MODAL ===================== */
  async function openCard(id) {
    const t = tasks.find(x => x.id === id); if (!t) return;
    const oldAssignee = t.assignee_id; const oldColId = t.column_id;
    const full = canEditDisc(t.discipline);
    const memEdit = canMoveTask(t);
    const mine = t.assignee_id && t.assignee_id === ACCESS.discord_id;
    const inReview = isReviewCol(t.column_id);
    const inDone = isDoneCol(t.column_id);
    const canSubmit = mine && !inReview && !inDone && t.discipline !== 'overview';
    const canReview = canApprove(t.discipline) && !inDone;
    const statusLine = inDone
      ? `<div class="cm-status cm-status--done">✓ Approved${t.approved_by_name ? ' by ' + esc(t.approved_by_name) : ''} · ◆ ${t.points || 0} awarded to ${esc(t.assignee_name || 'the dev')}</div>`
      : inReview
        ? `<div class="cm-status cm-status--review">🔎 In review — waiting on ${canApprove(t.discipline) ? 'your' : 'a lead’s'} approval</div>`
        : '';
    const ro = (cond) => cond ? '' : 'disabled';
    const cols = columns.filter(c => c.board_id === t.board_id).sort((a, b) => a.sort - b.sort);
    const me = window.Auth.getUser() || {};
    const assignOpts = [{ id: '', name: 'Unassigned' }]
      .concat(ACCESS.discord_id ? [{ id: ACCESS.discord_id, name: (me.global_name || me.username || 'Me') + ' (me)' }] : [])
      // leads/staff can hand work to anyone; a member can only take it themselves
      .concat(full ? members.filter(m => m.discord_id !== ACCESS.discord_id).map(m => ({ id: m.discord_id, name: m.username || m.discord_id })) : []);
    const chk = Array.isArray(t.checklist) ? t.checklist.slice() : [];

    const panel = $('#card-modal-panel');
    panel.innerHTML = `
      <button class="modal__x" data-x data-no-sound aria-label="Close">✕</button>
      <span class="card-disc" style="--tint:${DISC[t.discipline].tint}">${esc(DISC[t.discipline].name)}</span>
      <input class="card-title-in" id="cm-title" value="${esc(t.title)}" ${ro(full)} placeholder="Card title" />
      ${statusLine}
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
        <label class="cm-field"><span>Difficulty <i>(sets claim limit)</i></span>
          <select id="cm-diff" data-no-sound ${ro(full)}>
            ${Object.keys(DIFF).map(k => `<option value="${k}" ${k === diffOf(t) ? 'selected' : ''}>${DIFF[k].l}</option>`).join('')}
          </select></label>
        <label class="cm-field"><span>Coins ◆ <i>(toward rev-share)</i></span><input id="cm-pts" type="number" min="0" value="${t.points || 0}" ${ro(full)} /></label>
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
        ${canClaim(t) ? `<button class="btn btn--primary" id="cm-claim" data-no-sound>✋ Claim this task</button>` : ''}
        ${canSubmit ? `<button class="btn btn--primary" id="cm-submit" data-no-sound>Submit for review →</button>` : ''}
        ${canReview && inReview ? `<button class="btn btn--ghost" id="cm-reject" data-no-sound>↩ Request changes</button>` : ''}
        ${canReview ? `<button class="btn btn--primary btn--approve" id="cm-approve" data-no-sound>✓ Approve${t.points > 0 ? ` · ◆ ${t.points}` : ''}</button>` : ''}
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
        patch.difficulty = $('#cm-diff').value;
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
        fireAssignNotif(t, oldAssignee, assigneeId);
        fireMoveNotifs(t, oldColId, col);
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

    if ($('#cm-claim')) $('#cm-claim').addEventListener('click', async () => { closeCard(); await claimTask(t.id); });
    if ($('#cm-submit')) $('#cm-submit').addEventListener('click', () => { closeCard(); moveTaskTo(t, 'Review'); });
    if ($('#cm-approve')) $('#cm-approve').addEventListener('click', () => { closeCard(); moveTaskTo(t, 'Done'); });
    if ($('#cm-reject')) $('#cm-reject').addEventListener('click', async () => {
      const note = prompt('What needs changing? (optional — sent as a comment)');
      closeCard();
      if (note && note.trim()) { try { await window.Board.addComment(t.id, '↩ Changes requested: ' + note.trim()); } catch (e) {} }
      moveTaskTo(t, 'In Progress');
    });

    $$('#card-modal [data-x]').forEach(b => b.addEventListener('click', closeCard));
    openModal('#card-modal');
  }

  /* Move a task to a named column on its own board (submit / approve / reject). */
  async function moveTaskTo(t, colName) {
    const target = colByName(t.board_id, colName);
    if (!target) return toast('Couldn’t find the ' + colName + ' column.', 'error');
    const oldColId = t.column_id;
    const maxSort = Math.max(0, ...tasks.filter(x => x.column_id === target.id).map(x => x.sort)) + 1000;
    try {
      await window.Board.moveTask(t.id, target.id, maxSort, target.is_done);
      t.column_id = target.id; t.sort = maxSort;
      t.completed_at = target.is_done ? new Date().toISOString() : null;
      if (target.is_done) { t.approved_by_name = (window.Auth.getUser() || {}).global_name || (window.Auth.getUser() || {}).username || 'You'; }
      if (window.Sound) window.Sound.play(target.is_done ? 'select' : 'tick');
      const msg = colName === 'Review' ? 'Submitted for review ✓' : colName === 'Done' ? 'Approved ✓ — coins awarded' : 'Sent back for changes';
      toast(msg, 'success');
      fireMoveNotifs(t, oldColId, target);
      refreshAfterMutation();
      refreshMyCount();
    } catch (e) {
      const m = /needs_review/.test(e.message || '') ? 'Only an admin or the discipline lead can approve into Done.' : ('Move failed — ' + e.message);
      toast(m, 'error'); selectGame(game.id);
    }
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
        if (!game || game.id !== gameId || view !== 'board') return;
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
    $('#mytasks-btn').addEventListener('click', showMyTasks);
    $('#analytics-btn').addEventListener('click', showAnalytics);
    $('#feedback-btn').addEventListener('click', openFeedback);
    $('#fb-close').addEventListener('click', () => closeModal('#feedback-modal'));
    $('#fb-send').addEventListener('click', sendFeedback);
    $$('#fb-kinds .fb-kind').forEach(b => b.addEventListener('click', () => {
      fbKind = b.dataset.kind;
      $$('#fb-kinds .fb-kind').forEach(x => x.classList.toggle('is-active', x === b));
    }));
    $('#coins-btn').addEventListener('click', openCoins);
    $('#coins-close').addEventListener('click', () => closeModal('#coins-modal'));
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
