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
  let filter = 'all';
  let query = '';
  let pendingDecision = null;

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

  /* ---------- Boot dashboard ---------- */
  async function boot() {
    $('#admin-gate').classList.add('hidden');
    $('#admin-dash').classList.remove('hidden');
    $('#admin-logout').classList.remove('hidden');
    $('#demo-banner').classList.toggle('hidden', Store.live);
    await renderDemand();
    await load();
    $('#admin-logout').addEventListener('click', () => { Auth.logoutAdmin(); location.reload(); });
    $('#admin-search').addEventListener('input', (e) => { query = e.target.value.toLowerCase(); renderQueue(); });
    $$('.filter-tabs button').forEach(b => b.addEventListener('click', () => {
      filter = b.dataset.filter; $$('.filter-tabs button').forEach(x => x.classList.remove('active')); b.classList.add('active'); renderQueue();
    }));
    $('#export-csv').addEventListener('click', exportCsv);

    // decision modal
    $('#decide-cancel').addEventListener('click', closeDecide);
    $('#decide-modal').addEventListener('click', (e) => { if (e.target.id === 'decide-modal') closeDecide(); });
    $('#decide-confirm').addEventListener('click', async () => {
      if (!pendingDecision) return;
      const { id, status } = pendingDecision;
      const message = $('#decide-msg').value.trim();
      const c = $('#decide-confirm'); c.disabled = true;
      await Store.updateStatus(id, status, message);
      if (window.Sound) window.Sound.play(status === 'accepted' ? 'accept' : 'reject');
      window.toast(`${esc(cardName(id))} ${status}.`, status === 'accepted' ? 'success' : '');
      c.disabled = false; closeDecide(); await load();
    });
  }

  async function load() {
    const bans = await Store.listBans();
    bannedSet = new Set(bans.map(b => b.discord_id).filter(Boolean));
    apps = await Store.listApplications();
    renderStats(); renderQueue();
  }

  /* ---------- Stats ---------- */
  function renderStats() {
    const by = (s) => apps.filter(a => a.status === s).length;
    $('#stat-total').textContent = apps.length;
    $('#stat-pending').textContent = by('pending');
    $('#stat-accepted').textContent = by('accepted');
    $('#stat-rejected').textContent = by('rejected');
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
      await Store.setDemand(role, v);
      window.toast(`${ROLES.find(r => r.id === role).label} set to "${v.replace('_', ' ')}".`, 'success');
    }));
  }

  /* ---------- Queue ---------- */
  function roleLabel(r) { return (ROLES.find(x => x.id === r) || {}).label || r; }

  function filtered() {
    return apps.filter(a => {
      if (filter !== 'all' && a.status !== filter) return false;
      if (query) {
        const hay = `${a.full_name} ${a.discord_username} ${a.roblox_username} ${roleLabel(a.role)}`.toLowerCase();
        if (!hay.includes(query)) return false;
      }
      return true;
    });
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
            <h3>${esc(a.full_name)}</h3>
            <span class="applicant__role">${meta ? meta.icon : ''} ${roleLabel(a.role)}</span>
            <span class="tag ${statusTag}">${a.status}</span>
            ${banned ? '<span class="tag tag--rejected">⛔ banned</span>' : ''}
          </div>
          <div class="applicant__meta">
            <span>Roblox: <b>${esc(a.roblox_username)}</b></span>
            <span>Discord: <b>${esc(a.discord_username)}</b></span>
            <span>Exp: <b>${esc(a.experience || '—')}</b></span>
            <span>Avail: <b>${esc(a.availability || '—')}${a.timezone ? ' · ' + esc(a.timezone) : ''}</b></span>
            <span>Portfolio: ${safeUrl(a.portfolio_url) ? `<a href="${safeUrl(a.portfolio_url)}" target="_blank" rel="noopener">${esc(a.portfolio_url)}</a>` : esc(a.portfolio_url || '—')}</span>
          </div>
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
          await Store.updateStatus(id, 'rejected');
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
    });
  }
  function cardName(id) { const a = apps.find(x => x.id === id); return a ? a.full_name : 'Applicant'; }

  /* ---------- Accept/reject with a message ---------- */
  function openDecide(id, status) {
    pendingDecision = { id, status };
    const name = cardName(id);
    $('#decide-title').textContent = (status === 'accepted' ? 'Accept ' : 'Reject ') + name;
    $('#decide-sub').textContent = status === 'accepted'
      ? 'Add a welcome or next-steps message they’ll see (optional).'
      : 'Add a reason or note they’ll see (optional).';
    $('#decide-msg').value = '';
    const c = $('#decide-confirm');
    c.textContent = status === 'accepted' ? 'Accept' : 'Reject';
    c.className = 'btn ' + (status === 'accepted' ? 'btn--accept-confirm' : 'btn--reject-confirm');
    $('#decide-modal').classList.remove('hidden');
    setTimeout(() => $('#decide-msg').focus(), 50);
  }
  function closeDecide() { pendingDecision = null; $('#decide-modal').classList.add('hidden'); }

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

  document.addEventListener('DOMContentLoaded', () => {
    // The owner's device (or the real owner signed in with Discord) opens straight in.
    if (Auth.isAdmin() || (Auth.isOwner && Auth.isOwner())) boot(); else showGate();
  });
})();
