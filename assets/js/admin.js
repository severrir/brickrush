/* =========================================================================
   BRICK RUSH — admin.js
   Owner dashboard: gate, stat counts, demand controls, applicant queue with
   accept/reject, private notes, search + filter, CSV export.
   ========================================================================= */
(function () {
  const Store = window.Store, Auth = window.Auth, CFG = window.BRICKRUSH_CONFIG;
  const ROLES = window.BRICKRUSH_ROLES;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  let apps = [];
  let bannedSet = new Set();
  let filter = 'pending';
  let query = '';
  let pendingDecision = null;
  let selected = new Set();
  let sortMode = 'oldest';   // 'oldest' (longest waiting) | 'newest' | 'rating'
  let lastDecision = null;
  let newCount = 0;

  const TAGS = [
    { id: 'top', label: '⭐ Top pick', cls: 'tag--hot' },
    { id: 'follow', label: 'Follow up', cls: 'tag--pending' },
    { id: 'maybe', label: 'Maybe', cls: 'tag' },
    { id: 'portfolio', label: 'Strong portfolio', cls: 'tag--open' },
  ];
  const tagPreset = (t) => TAGS.find(p => p.id === t);
  const tagCls = (t) => (tagPreset(t) || {}).cls || 'tag--custom';
  const tagLabel = (t) => (tagPreset(t) || {}).label || t;

  /* ---------- Gate ---------- */
  function showGate() {
    $('#admin-gate').classList.remove('hidden');
    $('#admin-dash').classList.add('hidden');
    const form = $('#admin-gate-form');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const pass = $('#admin-pass').value;
      if (Auth.loginAdmin(pass)) { if (window.Sound) window.Sound.play('accept'); boot(); }
      else { $('#gate-err').textContent = 'Wrong password.'; if (window.Sound) window.Sound.play('error'); }
    });
  }

  /* Live mode gate: sign in with the owner Discord account. */
  function showDiscordGate(user) {
    $('#admin-gate').classList.remove('hidden');
    $('#admin-dash').classList.add('hidden');
    const gate = $('#admin-gate');
    gate.querySelector('h2').textContent = 'Owner access';
    gate.querySelector('p').textContent = user
      ? 'This panel is for the studio owner only.'
      : 'Sign in with the owner Discord account to manage applications.';
    $('#admin-gate-form').innerHTML = user
      ? `<div class="err" style="color:var(--amber);display:block;margin-bottom:1rem">Signed in as ${esc(user.username)} — that's not the owner account.</div>
         <a class="btn btn--ghost btn--block" href="index.html">Back to site</a>`
      : `<a class="btn btn--discord btn--block" href="login.html?return=admin.html">Sign in with Discord</a>`;
  }

  /* ---------- Boot dashboard ---------- */
  async function boot() {
    $('#admin-gate').classList.add('hidden');
    $('#admin-dash').classList.remove('hidden');
    $('#admin-logout').classList.remove('hidden');
    $('#demo-banner').classList.toggle('hidden', Store.live);
    await renderDemand();
    // Admin management is owner-only.
    if (Auth.isOwner && Auth.isOwner()) { $('#admin-manage').classList.remove('hidden'); await renderAdminManage(); }
    await load();
    $('#admin-logout').addEventListener('click', async () => { await Auth.logoutAdmin(); location.href = 'index.html'; });
    $('#admin-search').addEventListener('input', (e) => { query = e.target.value.toLowerCase(); renderQueue(); });
    $$('.filter-tabs button').forEach(b => b.addEventListener('click', () => {
      filter = b.dataset.filter; $$('.filter-tabs button').forEach(x => x.classList.remove('active')); b.classList.add('active'); renderQueue();
    }));
    $('#export-csv').addEventListener('click', exportCsv);

    // decision modal
    $('#decide-cancel').addEventListener('click', closeDecide);
    $('#decide-modal').addEventListener('click', (e) => { if (e.target.id === 'decide-modal') closeDecide(); });

    // add-to-game (enroll) modal
    $('#enroll-cancel').addEventListener('click', () => $('#enroll-modal').classList.add('hidden'));
    $('#enroll-modal').addEventListener('click', (e) => { if (e.target.id === 'enroll-modal') $('#enroll-modal').classList.add('hidden'); });
    $('#enroll-confirm').addEventListener('click', confirmEnroll);
    $('#decide-template').addEventListener('change', (e) => {
      const tpls = getTemplates(); const i = e.target.value;
      if (i !== '' && tpls[i]) $('#decide-msg').value = tpls[i].text;
      e.target.value = '';
    });
    $('#decide-save-tpl').addEventListener('click', () => {
      const text = $('#decide-msg').value.trim();
      if (!text) { window.toast('Type a message first.', 'error'); return; }
      const tpls = getTemplates();
      tpls.push({ label: text.slice(0, 28) + (text.length > 28 ? '…' : ''), text });
      try { localStorage.setItem(TPL_KEY, JSON.stringify(tpls)); } catch (e) {}
      window.toast('Saved as a template.', 'success');
      renderDecideQuick(pendingDecision ? pendingDecision.status : 'accepted');
    });
    $('#decide-confirm').addEventListener('click', async () => {
      if (!pendingDecision) return;
      const { id, status } = pendingDecision;
      const message = $('#decide-msg').value.trim();
      const c = $('#decide-confirm'); c.disabled = true;
      const appObj = apps.find(x => x.id === id);
      lastDecision = { id, prev: appObj ? appObj.status : 'pending' };
      await Store.updateStatus(id, status, message);
      if (window.Sound) window.Sound.play(status === 'accepted' ? 'accept' : 'reject');
      window.toast(`${esc(cardName(id))} ${status}.`, status === 'accepted' ? 'success' : '');
      $('#undo-last').classList.remove('hidden');
      c.disabled = false; closeDecide(); await load();
    });

    // bulk actions
    $$('[data-bulk]', $('#bulk-bar')).forEach(b => b.addEventListener('click', async () => {
      const act = b.dataset.bulk; const ids = [...selected]; if (!ids.length) return;
      b.disabled = true;
      for (const id of ids) {
        const appObj = apps.find(x => x.id === id);
        if (act === 'ban') { if (appObj) await Store.banUser(appObj); }
        else await Store.updateStatus(id, act);
      }
      if (window.Sound) window.Sound.play(act === 'accepted' ? 'accept' : 'reject');
      window.toast(`${ids.length} ${act === 'ban' ? 'banned' : act}.`, act === 'accepted' ? 'success' : '');
      selected.clear(); b.disabled = false; await load();
    }));
    $('#bulk-clear').addEventListener('click', () => { selected.clear(); renderQueue(); });

    // sort toggle: longest-waiting → newest → top-rated
    $('#sort-toggle').addEventListener('click', () => {
      sortMode = sortMode === 'oldest' ? 'newest' : sortMode === 'newest' ? 'rating' : 'oldest';
      $('#sort-toggle').innerHTML = sortMode === 'rating' ? '★ Top-rated' : sortMode === 'newest' ? '🕑 Newest' : '🕑 Longest waiting';
      renderQueue();
    });

    // wipe all applications (double-confirm)
    $('#wipe-apps').addEventListener('click', async () => {
      if (!apps.length) { window.toast('Nothing to wipe.', ''); return; }
      const n = apps.length;
      if (!confirm(`⚠ Wipe ALL ${n} application${n > 1 ? 's' : ''} permanently? This cannot be undone.`)) return;
      if (!confirm(`Last check — this deletes every application (${n}). Continue?`)) return;
      const r = await Store.wipeApplications();
      if (r && r.error) { window.toast(r.error, 'error', true); return; }
      if (window.Sound) window.Sound.play('reject');
      window.toast('All applications wiped.', '');
      selected.clear(); await load();
    });

    // undo last decision
    $('#undo-last').addEventListener('click', async () => {
      if (!lastDecision) return;
      await Store.updateStatus(lastDecision.id, lastDecision.prev, '', false);
      window.toast('Decision undone.', '');
      lastDecision = null; $('#undo-last').classList.add('hidden'); await load();
    });

    $('#rt-badge').addEventListener('click', async () => {
      newCount = 0; $('#rt-badge').classList.add('hidden'); await load();
    });

    $('#cheat-close').addEventListener('click', () => $('#cheat-modal').classList.add('hidden'));
    $('#show-cheat').addEventListener('click', () => $('#cheat-modal').classList.remove('hidden'));
    wireKeyboard();
    wireCmdk();
    wirePush();
    subscribeRealtime();
  }

  /* ---------- Command palette (Ctrl/⌘+K) ---------- */
  let cmdkItems = [], cmdkIndex = 0;
  function openCmdk() {
    $('#cmdk').classList.remove('hidden');
    const i = $('#cmdk-input'); i.value = ''; renderCmdk(''); i.focus();
  }
  function closeCmdk() { $('#cmdk').classList.add('hidden'); }
  function jumpToApplicant(id) {
    filter = 'all'; query = ''; $('#admin-search').value = '';
    $$('.filter-tabs button').forEach(b => b.classList.toggle('active', b.dataset.filter === 'all'));
    renderQueue();
    setTimeout(() => { const cards = $$('.applicant'); const card = $(`.applicant[data-id="${id}"]`); if (card) setActive(cards.indexOf(card)); }, 60);
  }
  function renderCmdk(q) {
    q = (q || '').toLowerCase();
    const actions = [
      { label: '⬇  Export CSV', act: exportCsv },
      { label: '🔀  Toggle sort (newest / top-rated)', act: () => $('#sort-toggle').click() },
      { label: '⌨  Keyboard shortcuts', act: () => $('#cheat-modal').classList.remove('hidden') },
    ].filter(a => !q || a.label.toLowerCase().includes(q));
    const matches = apps
      .filter(a => !q || `${a.full_name} ${a.discord_username} ${a.roblox_username} ${roleLabel(a.role)}`.toLowerCase().includes(q))
      .slice(0, 8)
      .map(a => ({ label: `👤  ${a.full_name} · ${roleLabel(a.role)} · ${a.status}`, act: () => jumpToApplicant(a.id) }));
    cmdkItems = [...matches, ...actions]; cmdkIndex = 0;
    $('#cmdk-results').innerHTML = cmdkItems.length
      ? cmdkItems.map((it, i) => `<button class="cmdk__item${i === 0 ? ' active' : ''}" data-i="${i}">${esc(it.label)}</button>`).join('')
      : '<div class="cmdk__empty">No matches</div>';
    $$('#cmdk-results .cmdk__item').forEach(b => b.addEventListener('click', () => { cmdkItems[+b.dataset.i].act(); closeCmdk(); }));
  }
  function cmdkMove(d) {
    if (!cmdkItems.length) return;
    cmdkIndex = (cmdkIndex + d + cmdkItems.length) % cmdkItems.length;
    $$('#cmdk-results .cmdk__item').forEach((b, i) => b.classList.toggle('active', i === cmdkIndex));
    $$('#cmdk-results .cmdk__item')[cmdkIndex]?.scrollIntoView({ block: 'nearest' });
  }
  function wireCmdk() {
    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); openCmdk(); }
    });
    $('#cmdk').addEventListener('click', (e) => { if (e.target.id === 'cmdk') closeCmdk(); });
    $('#cmdk-input').addEventListener('input', (e) => renderCmdk(e.target.value));
    $('#cmdk-input').addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); cmdkMove(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); cmdkMove(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); if (cmdkItems[cmdkIndex]) { cmdkItems[cmdkIndex].act(); closeCmdk(); } }
      else if (e.key === 'Escape') { closeCmdk(); }
    });
  }

  /* ---------- Keyboard shortcuts ---------- */
  let activeIndex = -1;
  function setActive(i) {
    const cards = $$('.applicant');
    if (!cards.length) return;
    activeIndex = Math.max(0, Math.min(cards.length - 1, i));
    cards.forEach((c, idx) => c.classList.toggle('applicant--active', idx === activeIndex));
    cards[activeIndex].scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  function wireKeyboard() {
    document.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const typing = e.target.matches && e.target.matches('input, textarea, select, [contenteditable]');
      if (e.key === 'Escape') { closeDecide(); $('#cheat-modal').classList.add('hidden'); return; }
      if (typing) return;
      const cards = $$('.applicant');
      if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); setActive(activeIndex < 0 ? 0 : activeIndex + 1); }
      else if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); setActive(activeIndex < 0 ? 0 : activeIndex - 1); }
      else if (e.key === '/') { e.preventDefault(); $('#admin-search').focus(); }
      else if (e.key === '?') { e.preventDefault(); $('#cheat-modal').classList.toggle('hidden'); }
      else if ((e.key === 'a' || e.key === 'r') && cards[activeIndex]) { e.preventDefault(); openDecide(cards[activeIndex].dataset.id, e.key === 'a' ? 'accepted' : 'rejected'); }
      else if (e.key === 'b' && cards[activeIndex]) { e.preventDefault(); const btn = cards[activeIndex].querySelector('[data-ban="ban"]'); if (btn) btn.click(); }
    });
  }

  /* ---------- Live updates ---------- */
  function subscribeRealtime() {
    if (!Store.live || !window.SB) return;
    try {
      window.SB.channel('apps-rt')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'applications' }, () => {
          newCount++;
          const cnt = $('#rt-count'); if (cnt) cnt.textContent = newCount;
          $('#rt-badge').classList.remove('hidden');
          if (window.Sound) window.Sound.play('select');
        })
        .subscribe();
    } catch (e) {}
  }

  /* ---------- Phone push notifications ---------- */
  async function wirePush() {
    const bar = $('#push-bar'); const toggle = $('#push-toggle'); const state = $('#push-state');
    if (!bar || !toggle || !window.BrickPush || !Store.live) return;
    if (!window.BrickPush.supported()) return; // unsupported → stay hidden
    bar.classList.remove('hidden');

    const sync = async () => {
      const on = await window.BrickPush.isOn();
      state.textContent = on ? 'On' : 'Off';
      bar.classList.toggle('push-bar--on', on);
      toggle.textContent = on ? 'Turn off' : 'Turn on';
    };
    await sync();

    toggle.addEventListener('click', async () => {
      toggle.disabled = true;
      const on = await window.BrickPush.isOn();
      const res = on ? await window.BrickPush.disable() : await window.BrickPush.enable();
      if (res.error) window.toast(res.error, 'error', true);
      else window.toast(on ? 'Phone alerts turned off.' : 'Phone alerts on ✓', on ? '' : 'success');
      toggle.disabled = false; await sync();
    });

    // Install-as-app prompt (Android/desktop Chrome)
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault(); window.__brDeferredPrompt = e; $('#install-app').classList.remove('hidden');
    });
    $('#install-app').addEventListener('click', async () => {
      if (window.__brDeferredPrompt) { window.__brDeferredPrompt.prompt(); window.__brDeferredPrompt = null; $('#install-app').classList.add('hidden'); }
    });
  }

  async function load() {
    const bans = await Store.listBans();
    bannedSet = new Set(bans.map(b => b.discord_id).filter(Boolean));
    apps = await Store.listApplications();
    renderStats(); renderInsights(); renderVisitors(); renderQueue();
  }

  /* ---------- Visitor analytics ---------- */
  async function renderVisitors() {
    const el = $('#visitor-grid'); if (!el) return;
    let s = {};
    try { s = await Store.visitorStats(); } catch (e) { el.innerHTML = '<p class="muted" style="font-size:0.85rem">Couldn’t load visitor stats.</p>'; return; }
    const days = s.days || [];
    const dmax = Math.max(1, ...days.map(d => d.n));
    el.innerHTML = `
      <div class="vstat"><div class="vstat__n gradient-text">${s.today_people || 0}</div><div class="vstat__l">Today</div></div>
      <div class="vstat"><div class="vstat__n">${s.week_people || 0}</div><div class="vstat__l">This week</div></div>
      <div class="vstat"><div class="vstat__n">${s.total_people || 0}</div><div class="vstat__l">All-time people</div></div>
      <div class="vstat"><div class="vstat__n">${s.total_views || 0}</div><div class="vstat__l">Total views</div></div>
      <div class="vstat vstat--spark"><div class="vstat__l">Last 14 days (people/day)</div>
        <div class="spark">${days.length ? days.map(d => `<span class="spark__bar" style="height:${Math.max(8, d.n / dmax * 100)}%" title="${esc(d.d)}: ${d.n}"></span>`).join('') : '<span class="muted" style="font-size:0.8rem">No visits logged yet.</span>'}</div></div>`;
  }

  function renderInsights() {
    const el = $('#insights'); if (!el) return;
    const total = apps.length;
    const decided = apps.filter(a => a.status !== 'pending').length;
    const acc = apps.filter(a => a.status === 'accepted').length;
    const rate = decided ? Math.round((acc / decided) * 100) : 0;
    const byRole = ROLES.map(r => ({ label: r.label, n: apps.filter(a => a.role === r.id).length }));
    const max = Math.max(1, ...byRole.map(r => r.n));
    const days = [...Array(7)].map((_, i) => { const d = new Date(); d.setDate(d.getDate() - (6 - i)); return d; });
    const dayCounts = days.map(d => apps.filter(a => new Date(a.created_at).toDateString() === d.toDateString()).length);
    const dmax = Math.max(1, ...dayCounts);
    el.innerHTML = `
      <h3>Insights</h3>
      <div class="insights__grid">
        <div class="insight"><div class="insight__n gradient-text">${rate}%</div><div class="insight__l">Acceptance rate</div></div>
        <div class="insight insight--bars">
          <div class="insight__l">By role</div>
          ${byRole.map(r => `<div class="ibar"><span class="ibar__lab">${esc(r.label)}</span><span class="ibar__track"><i style="width:${(r.n / max * 100)}%"></i></span><span class="ibar__n">${r.n}</span></div>`).join('')}
        </div>
        <div class="insight insight--spark">
          <div class="insight__l">Last 7 days</div>
          <div class="spark">${dayCounts.map((n, i) => `<span class="spark__bar" style="height:${Math.max(8, n / dmax * 100)}%" title="${days[i].toLocaleDateString(undefined, { weekday: 'short' })}: ${n}"></span>`).join('')}</div>
        </div>
      </div>`;
  }

  /* ---------- Stats ---------- */
  function renderStats() {
    const by = (s) => apps.filter(a => a.status === s).length;
    $('#stat-total').textContent = apps.length;
    $('#stat-pending').textContent = by('pending');
    $('#stat-accepted').textContent = by('accepted');
    $('#stat-rejected').textContent = by('rejected');
  }

  /* ---------- Admin management (owner only) ---------- */
  async function renderAdminManage() {
    const list = await Store.listAdmins();
    const wrap = $('#admins-list');
    wrap.innerHTML = list.length
      ? list.map(a => `<div class="admin-row" data-id="${esc(a.discord_id)}">
          <span class="admin-row__who"><b>${esc(a.username || 'Admin')}</b> <span class="mono">${esc(a.discord_id)}</span></span>
          <button class="btn btn--reject btn--sm" data-remove>Remove</button></div>`).join('')
      : '<p class="muted" style="font-size:0.86rem;margin-top:0.8rem">No admins yet — just you, the owner.</p>';
    wrap.querySelectorAll('[data-remove]').forEach(b => b.addEventListener('click', async () => {
      const id = b.closest('.admin-row').dataset.id;
      await Store.removeAdmin(id); if (window.Sound) window.Sound.play('tick');
      window.toast('Admin removed.', ''); await renderAdminManage();
    }));
    const addBtn = $('#admin-add-btn');
    if (addBtn && !addBtn.dataset.wired) {
      addBtn.dataset.wired = '1';
      addBtn.addEventListener('click', async () => {
        const res = await Store.addAdmin($('#admin-add-id').value, $('#admin-add-name').value);
        if (res.error) { window.toast(res.error, 'error', true); return; }
        $('#admin-add-id').value = ''; $('#admin-add-name').value = '';
        if (window.Sound) window.Sound.play('success');
        window.toast('Admin added ✓', 'success'); await renderAdminManage();
      });
    }
  }

  /* ---------- Demand controls ---------- */
  async function renderDemand() {
    const wrap = $('#demand-rows');
    let demand = await Store.getDemand();
    wrap.innerHTML = ROLES.map(r => `
      <div class="demand-row" data-role="${r.id}">
        <span class="demand-row__name"><span>${r.icon}</span> ${r.label}</span>
        <span class="demand-seg">
          <button data-v="most_wanted" class="${demand[r.id] === 'most_wanted' ? 'active' : ''}">✳ Most wanted</button>
          <button data-v="open" class="${demand[r.id] === 'open' ? 'active' : ''}">Open</button>
          <button data-v="closed" class="${demand[r.id] === 'closed' ? 'active' : ''}">Closed</button>
        </span>
      </div>`).join('');
    $$('.demand-seg button', wrap).forEach(btn => btn.addEventListener('click', async () => {
      const row = btn.closest('.demand-row'); const role = row.dataset.role; const v = btn.dataset.v;
      $$('.demand-seg button', row).forEach(x => x.classList.remove('active')); btn.classList.add('active');
      const res = await Store.setDemand(role, v);
      if (res && res.error) { window.toast('Could not save demand: ' + res.error, 'error', true); await renderDemand(); return; }
      window.toast(`${ROLES.find(r => r.id === role).label} set to "${v.replace('_', ' ')}".`, 'success');
    }));
  }

  /* ---------- Queue ---------- */
  function roleLabel(r) { return (ROLES.find(x => x.id === r) || {}).label || r; }

  function filtered() {
    const out = apps.filter(a => {
      if (filter === 'reviewed') { if (a.status === 'pending') return false; }
      else if (filter !== 'all' && a.status !== filter) return false;
      if (query) {
        const hay = `${a.full_name} ${a.discord_username} ${a.roblox_username} ${roleLabel(a.role)} ${(a.tags || []).join(' ')}`.toLowerCase();
        if (!hay.includes(query)) return false;
      }
      return true;
    });
    if (sortMode === 'rating') {
      out.sort((a, b) => (b.rating || 0) - (a.rating || 0) || new Date(b.created_at) - new Date(a.created_at));
    } else if (sortMode === 'oldest') {
      out.sort((a, b) => new Date(a.created_at) - new Date(b.created_at)); // longest waiting first
    } else {
      out.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }
    return out;
  }

  function renderQueue() {
    const list = $('#queue');
    const data = filtered();
    if (!data.length) {
      list.innerHTML = `<div class="empty"><div class="big">✳</div><h3>No applications here</h3>
        <p>${apps.length ? 'Nothing matches this filter.' : 'New applications will land here as they come in.'}</p></div>`;
      return;
    }
    list.innerHTML = data.map(a => {
      const meta = ROLES.find(r => r.id === a.role);
      const statusTag = { pending: 'tag--pending', accepted: 'tag--accepted', rejected: 'tag--rejected' }[a.status];
      const banned = a.discord_id && bannedSet.has(a.discord_id);
      return `
      <article class="card applicant${banned ? ' applicant--banned' : ''}" data-id="${a.id}">
        <div class="applicant__main">
          <div class="applicant__head">
            <input type="checkbox" class="applicant__select" data-id="${a.id}" ${selected.has(a.id) ? 'checked' : ''} aria-label="Select applicant" />
            <h3>${esc(a.full_name)}</h3>
            <span class="applicant__role">${meta ? meta.icon : ''} ${roleLabel(a.role)}</span>
            <span class="tag ${statusTag}">${a.status}</span>
            ${banned ? '<span class="tag tag--rejected">⛔ banned</span>' : ''}
          </div>
          <div class="applicant__rate">
            <div class="stars" data-id="${a.id}">
              ${[1, 2, 3, 4, 5].map(n => `<button type="button" class="star${(a.rating || 0) >= n ? ' on' : ''}" data-star="${n}" aria-label="${n} star">★</button>`).join('')}
            </div>
            <div class="applicant__tags">
              ${(a.tags || []).map(t => `<span class="tag ${tagCls(t)}">${esc(tagLabel(t))}<button class="tag-x" data-rmtag="${esc(t)}" aria-label="remove tag" data-no-sound>×</button></span>`).join('')}
              <details class="tag-add">
                <summary data-no-sound>+ tag</summary>
                <div class="tag-add__menu">
                  ${TAGS.map(p => `<button type="button" class="tag-add__opt ${p.cls}" data-addtag="${p.id}">${p.label}</button>`).join('')}
                  <input class="input" data-customtag placeholder="Custom tag, press Enter" />
                </div>
              </details>
            </div>
          </div>
          <div class="applicant__meta">
            <span>Roblox: <b>${esc(a.roblox_username)}</b></span>
            <span>Discord: <b>${esc(a.discord_username)}</b></span>
            <span>Exp: <b>${esc(a.experience || '—')}</b></span>
            <span>Avail: <b>${esc(a.availability || '—')}${a.timezone ? ' · ' + esc(a.timezone) : ''}</b></span>
            <span>Portfolio: ${safeUrl(a.portfolio_url) ? `<a href="${safeUrl(a.portfolio_url)}" target="_blank" rel="noopener">${esc(a.portfolio_url)}</a>` : esc(a.portfolio_url || '—')}</span>
          </div>
          <div class="roblox-card" data-rbx="${esc(a.roblox_username || '')}"></div>
          <div class="applicant__qa">
            ${a.role_answer ? `<div><div class="q">${esc(meta ? meta.questionLabel : 'Role answer')}</div><div class="a">${esc(a.role_answer)}</div></div>` : ''}
            ${a.past_projects ? `<div><div class="q">Past projects</div><div class="a">${esc(a.past_projects)}</div></div>` : ''}
            <div><div class="q">Why BRICK RUSH</div><div class="a">${esc(a.why || '—')}</div></div>
          </div>
          <input class="input applicant__note" placeholder="Private note (only you see this)…" value="${esc(a.note || '')}" />
        </div>
        <div class="applicant__actions">
          <span class="applicant__when">${timeago(a.created_at)}</span>
          <button class="btn btn--accept" data-act="accepted" ${a.status === 'accepted' ? 'disabled' : ''}>✓ Accept</button>
          <button class="btn btn--reject" data-act="rejected" ${a.status === 'rejected' ? 'disabled' : ''}>✕ Reject</button>
          ${banned
            ? `<button class="btn btn--unban" data-ban="unban">↩ Unban</button>`
            : `<button class="btn btn--ban" data-ban="ban"${a.discord_id ? '' : ' disabled title="No Discord ID — can\'t ban"'}>⛔ Ban</button>`}
          <button class="btn btn--ghost btn--sm" data-pdf data-no-sound>⤓ PDF</button>
          ${a.status === 'accepted' && a.discord_id ? `<button class="btn btn--primary btn--sm" data-enroll data-no-sound>＋ Add to game</button>` : ''}
          <button class="btn btn--ghost btn--sm btn--danger" data-delete data-no-sound title="Delete application">🗑</button>
        </div>
      </article>`;
    }).join('');

    $$('.applicant', list).forEach(card => {
      const id = card.dataset.id;
      $$('[data-act]', card).forEach(btn => btn.addEventListener('click', () => openDecide(id, btn.dataset.act)));
      const banBtn = $('[data-ban]', card);
      if (banBtn) banBtn.addEventListener('click', async () => {
        const appObj = apps.find(x => x.id === id);
        banBtn.disabled = true;
        if (banBtn.dataset.ban === 'ban') {
          const ok = await Store.banUser(appObj);
          if (!ok) { banBtn.disabled = false; window.toast('Can’t ban — this application has no Discord ID.', 'error'); return; }
          if (window.Sound) window.Sound.play('reject');
          window.toast(`${esc(cardName(id))} banned from applying.`, '');
        } else {
          await Store.unbanUser(appObj.discord_id);
          window.toast(`${esc(cardName(id))} can apply again.`, 'success');
        }
        await load();
      });
      const note = $('.applicant__note', card);
      let timer;
      note.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { Store.setNote(id, note.value); }, 500); });

      // star rating
      $$('.star', card).forEach(s => s.addEventListener('click', async () => {
        const a = apps.find(x => x.id === id); const cur = a ? (a.rating || 0) : 0;
        const v = +s.dataset.star; const next = (cur === v) ? 0 : v;  // click the same star to clear
        if (a) a.rating = next;
        $$('.star', card).forEach(x => x.classList.toggle('on', +x.dataset.star <= next));
        await Store.setRating(id, next); if (window.Sound) window.Sound.play('tick');
      }));

      // tags
      const a0 = apps.find(x => x.id === id) || { tags: [] };
      $$('[data-addtag]', card).forEach(b => b.addEventListener('click', async () => {
        const t = b.dataset.addtag; const cur = a0.tags || [];
        if (!cur.includes(t)) { a0.tags = [...cur, t]; await Store.setTags(id, a0.tags); renderQueue(); }
      }));
      $$('[data-rmtag]', card).forEach(b => b.addEventListener('click', async (e) => {
        e.preventDefault(); a0.tags = (a0.tags || []).filter(x => x !== b.dataset.rmtag);
        await Store.setTags(id, a0.tags); renderQueue();
      }));
      const ct = $('[data-customtag]', card);
      if (ct) ct.addEventListener('keydown', async (e) => {
        if (e.key !== 'Enter') return; e.preventDefault();
        const t = ct.value.trim().slice(0, 24); if (!t || (a0.tags || []).includes(t)) { ct.value = ''; return; }
        a0.tags = [...(a0.tags || []), t]; await Store.setTags(id, a0.tags); renderQueue();
      });

      // bulk select
      const cb = $('.applicant__select', card);
      if (cb) cb.addEventListener('change', () => { cb.checked ? selected.add(id) : selected.delete(id); updateBulkBar(); });

      const pdf = $('[data-pdf]', card);
      if (pdf) pdf.addEventListener('click', () => exportPdf(id));

      const enroll = $('[data-enroll]', card);
      if (enroll) enroll.addEventListener('click', () => openEnroll(apps.find(x => x.id === id)));

      const del = $('[data-delete]', card);
      if (del) del.addEventListener('click', async () => {
        const a = apps.find(x => x.id === id);
        if (!confirm(`Delete ${a ? a.full_name : 'this application'} permanently? This can’t be undone.`)) return;
        const r = await Store.deleteApplication(id);
        if (r && r.error) { window.toast(r.error, 'error', true); return; }
        if (window.Sound) window.Sound.play('tick');
        selected.delete(id);
        window.toast('Application deleted.', '');
        await load();
      });

      // roblox info (live only)
      if (Store.live && window.SB) loadRoblox(card);
    });
    updateBulkBar();
  }

  /* ---------- Roblox auto-fetch ---------- */
  const robloxCache = {};
  function yearsSince(iso) { try { return Math.floor((Date.now() - new Date(iso)) / (365.25 * 864e5)); } catch (e) { return null; } }
  async function loadRoblox(card) {
    const el = card.querySelector('.roblox-card'); if (!el) return;
    const u = el.dataset.rbx; if (!u) { el.innerHTML = ''; return; }
    if (!robloxCache[u]) {
      robloxCache[u] = window.SB.functions.invoke('roblox-info', { body: { username: u } }).then(r => r.data).catch(() => ({ error: true }));
    }
    const d = await robloxCache[u];
    if (!d || d.error || d.found === false) { el.innerHTML = `<div class="rbx-mini muted">🎮 Roblox: couldn’t find @${esc(u)}</div>`; return; }
    const age = d.created != null ? yearsSince(d.created) : null;
    el.innerHTML =
      `<div class="rbx-mini">
        ${d.avatar ? `<img src="${esc(d.avatar)}" alt="" class="rbx-av" loading="lazy" />` : ''}
        <div class="rbx-meta">
          <a href="https://www.roblox.com/users/${d.id}/profile" target="_blank" rel="noopener"><b>${esc(d.displayName || d.name)}</b> <span class="mono">@${esc(d.name)}</span></a>
          <span>${age != null ? age + ' yr account' : ''}${d.games && d.games.length ? ' · ' + d.games.length + ' game' + (d.games.length > 1 ? 's' : '') : ''}</span>
        </div>
      </div>
      ${d.games && d.games.length ? `<div class="rbx-games">${d.games.slice(0, 4).map(g => `<span class="tag">${esc(g.name)}</span>`).join('')}</div>` : ''}`;
  }

  function updateBulkBar() {
    const bar = $('#bulk-bar'); if (!bar) return;
    bar.classList.toggle('hidden', selected.size === 0);
    const c = $('#bulk-count'); if (c) c.textContent = `${selected.size} selected`;
  }
  function cardName(id) { const a = apps.find(x => x.id === id); return a ? a.full_name : 'Applicant'; }

  /* ---------- Quick-fill chips + saved templates ---------- */
  const ACCEPT_CHIPS = ['Welcome aboard! 🎉', 'Loved your portfolio.', 'Let’s set up your interview on Discord.'];
  const REJECT_CHIPS = ['Not the right fit right now.', 'Sharpen your portfolio and apply again anytime.', 'We need more experience for this role currently.'];
  const TPL_KEY = 'brickrush_msg_templates';
  const getTemplates = () => { try { return JSON.parse(localStorage.getItem(TPL_KEY)) || []; } catch (e) { return []; } };
  function renderDecideQuick(status) {
    const chips = status === 'accepted' ? ACCEPT_CHIPS : REJECT_CHIPS;
    $('#decide-chips').innerHTML = chips.map(t => `<button type="button" class="decide-chip" data-chip data-no-sound>${esc(t)}</button>`).join('');
    $$('#decide-chips [data-chip]').forEach(b => b.addEventListener('click', () => {
      const ta = $('#decide-msg'); ta.value = (ta.value ? ta.value.trim() + ' ' : '') + b.textContent; ta.focus();
    }));
    const tpls = getTemplates();
    $('#decide-template').innerHTML = '<option value="">Saved templates…</option>' +
      tpls.map((t, i) => `<option value="${i}">${esc(t.label)}</option>`).join('');
  }

  /* ---------- Add an accepted applicant to a game (Studio) ---------- */
  let enrollApp = null;
  async function openEnroll(app) {
    if (!app) return;
    enrollApp = app;
    $('#enroll-sub').textContent = `Add ${app.full_name || app.discord_username || 'this developer'} to a game's team — they'll see that game's board and can be assigned tasks.`;
    const sel = $('#enroll-game');
    sel.innerHTML = '<option value="">Loading…</option>';
    $('#enroll-modal').classList.remove('hidden');
    let games = [];
    try { games = await window.Board.listGames(); } catch (e) {}
    if (!games.length) {
      sel.innerHTML = '<option value="">No games yet — create one in the Studio</option>';
    } else {
      sel.innerHTML = games.map(g => `<option value="${g.id}">${esc(g.name)}</option>`).join('');
    }
    const disc = $('#enroll-disc');
    if (['scripter', 'modeler_animator', 'uiux'].includes(app.role)) disc.value = app.role;
  }
  async function confirmEnroll() {
    if (!enrollApp) return;
    const gameId = $('#enroll-game').value;
    if (!gameId) { window.toast && window.toast('Create a game in the Studio first.', 'error'); return; }
    const btn = $('#enroll-confirm'); btn.disabled = true;
    const r = await window.Board.addMember(gameId, {
      discord_id: enrollApp.discord_id,
      username: enrollApp.discord_username || enrollApp.full_name || '',
      discipline: $('#enroll-disc').value,
    });
    btn.disabled = false;
    if (r && r.error) { window.toast && window.toast(r.error, 'error'); return; }
    $('#enroll-modal').classList.add('hidden');
    window.toast && window.toast('Added to the game ✓ They can open the Studio now.', 'success');
  }

  /* ---------- Accept/reject with a message ---------- */
  function openDecide(id, status) {
    pendingDecision = { id, status };
    const name = cardName(id);
    $('#decide-title').textContent = (status === 'accepted' ? 'Accept ' : 'Reject ') + name;
    $('#decide-sub').textContent = status === 'accepted'
      ? 'Add a welcome or next-steps message they’ll see (optional).'
      : 'Add a reason or note they’ll see (optional).';
    $('#decide-msg').value = '';
    renderDecideQuick(status);
    const c = $('#decide-confirm');
    c.textContent = status === 'accepted' ? 'Accept' : 'Reject';
    c.className = 'btn ' + (status === 'accepted' ? 'btn--accept-confirm' : 'btn--reject-confirm');
    $('#decide-modal').classList.remove('hidden');
    setTimeout(() => $('#decide-msg').focus(), 50);
  }
  function closeDecide() { pendingDecision = null; $('#decide-modal').classList.add('hidden'); }

  /* ---------- Per-applicant PDF (print) ---------- */
  function exportPdf(id) {
    const a = apps.find(x => x.id === id); if (!a) return;
    const meta = ROLES.find(r => r.id === a.role);
    const w = window.open('', '_blank'); if (!w) { window.toast('Allow pop-ups to export a PDF.', 'error'); return; }
    const row = (k, v) => v ? `<tr><td class="k">${esc(k)}</td><td>${esc(v)}</td></tr>` : '';
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(a.full_name)} — BRICK RUSH</title>
      <style>body{font-family:system-ui,-apple-system,sans-serif;color:#111;max-width:680px;margin:40px auto;padding:0 24px}
      h1{margin:0 0 4px;font-size:26px}.sub{color:#666;margin-bottom:26px;font-size:14px}
      table{width:100%;border-collapse:collapse}td{padding:9px 0;border-bottom:1px solid #eee;vertical-align:top;font-size:14px}
      .k{color:#999;width:170px;font-size:12px;text-transform:uppercase;letter-spacing:.5px}
      .why{margin-top:24px}.why h3{font-size:12px;color:#999;text-transform:uppercase;letter-spacing:1px}.why p{font-size:14px;line-height:1.6}
      .star{color:#e0457a}</style></head><body>
      <h1>${esc(a.full_name)}</h1>
      <div class="sub">${esc(meta ? meta.label : a.role)} &middot; ${esc(a.status)} &middot; applied ${new Date(a.created_at).toLocaleDateString()}</div>
      <table>
        ${row('Roblox', a.roblox_username)}${row('Discord', a.discord_username)}${row('Experience', a.experience)}
        ${row('Availability', (a.availability || '') + (a.timezone ? ' · ' + a.timezone : ''))}${row('Portfolio', a.portfolio_url)}
        ${row(meta ? meta.questionLabel : 'Role answer', a.role_answer)}${row('Past projects', a.past_projects)}
        ${a.rating ? `<tr><td class="k">Rating</td><td class="star">${'★'.repeat(a.rating)}${'☆'.repeat(5 - a.rating)}</td></tr>` : ''}
        ${(a.tags && a.tags.length) ? row('Tags', a.tags.join(', ')) : ''}
      </table>
      <div class="why"><h3>Why BRICK RUSH</h3><p>${esc(a.why || '—')}</p></div>
      <script>onload=function(){setTimeout(function(){print()},150)}<\/script></body></html>`);
    w.document.close();
  }

  /* ---------- CSV ---------- */
  function exportCsv() {
    const cols = ['created_at', 'status', 'role', 'full_name', 'roblox_username', 'discord_username',
      'experience', 'availability', 'timezone', 'portfolio_url', 'role_answer', 'past_projects', 'why', 'note'];
    const rows = [cols.join(',')].concat(apps.map(a => cols.map(c => `"${String(a[c] ?? '').replace(/"/g, '""')}"`).join(',')));
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = `brickrush-applications-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click(); URL.revokeObjectURL(url);
    window.toast('Exported applications to CSV.', 'success');
  }

  /* ---------- utils ---------- */
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // Only allow http/https links to be clickable — block javascript:/data: etc.
  const safeUrl = (u) => /^https?:\/\//i.test(String(u || '')) ? esc(u) : '';
  function timeago(d) {
    const s = (Date.now() - new Date(d)) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  }

  document.addEventListener('DOMContentLoaded', async () => {
    await Auth.init();
    if (Auth.live()) {
      // Real backend: the owner OR any added admin gets in.
      const u = Auth.getUser();
      if (u && await Store.isStaff()) boot();
      else showDiscordGate(u);
    } else {
      // Demo: password (and this device stays unlocked once entered).
      if (Auth.isAdmin() || (Auth.isOwner && Auth.isOwner())) boot(); else showGate();
    }
  });
})();
