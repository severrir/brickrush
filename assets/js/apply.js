/* =========================================================================
   BRICK RUSH — apply.js
   Login-gated 5-step application: Role → Rev-share (read) → You → Skills →
   Review → submit → live status screen.
   ========================================================================= */
(function () {
  const ROLES = window.BRICKRUSH_ROLES;
  const Store = window.Store, Auth = window.Auth, CFG = window.BRICKRUSH_CONFIG;

  const state = {
    step: 1, role: null,
    full_name: '', roblox_username: '', discord_username: '', discord_id: '',
    age_ok: false, revshare_ack: false, experience: '', portfolio_url: '', past_projects: '',
    availability: '', timezone: '', role_answer: '', why: '',
  };

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const steps = $$('.step');
  const stepNodes = $$('.stepper__node');
  const TOTAL = 5;
  const escapeHtml = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ---------- Roles ---------- */
  function renderRoles() {
    const wrap = $('#role-select');
    wrap.innerHTML = ROLES.map(r => `
      <button type="button" class="role-opt" data-role="${r.id}">
        <span class="role-opt__check"></span>
        <span class="role-opt__ico">${r.icon}</span>
        <h3>${r.label}</h3>
        <p>${r.blurb}</p>
        <div class="role-opt__skills">${r.skills.map(s => `<span class="tag">${s}</span>`).join('')}</div>
      </button>`).join('');
    $$('.role-opt', wrap).forEach(b => b.addEventListener('click', () => selectRole(b.dataset.role)));
  }
  function selectRole(id) {
    state.role = id;
    $$('.role-opt').forEach(b => b.classList.toggle('selected', b.dataset.role === id));
    if (window.Sound) window.Sound.play('select');
    const meta = ROLES.find(r => r.id === id);
    $('#rolespecific-label').textContent = meta.questionLabel;
    $('#s1-next').disabled = false;
  }

  /* ---------- Stepper ---------- */
  function goTo(n) {
    state.step = n;
    steps.forEach(s => s.classList.toggle('active', +s.dataset.step === n));
    stepNodes.forEach(node => {
      const i = +node.dataset.step;
      node.classList.toggle('active', i === n);
      node.classList.toggle('done', i < n);
    });
    if (window.Sound) window.Sound.play('step');
    const top = $('.apply-head');
    if (window.__lenis) window.__lenis.scrollTo(top, { offset: -90 });
    else window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ---------- Validation ---------- */
  function setInvalid(field, bad) { field.closest('.field, .check-row')?.classList.toggle('invalid', bad); }
  function validateStep(n) {
    let ok = true;
    if (n === 1) return Boolean(state.role);
    if (n === 2) {
      const ack = $('#revshare-ack'); const bad = !ack.checked;
      setInvalid(ack, bad); if (bad) ok = false;
    }
    if (n === 3) {
      const name = $('#f-name'), rob = $('#f-roblox'), dis = $('#f-discord'), age = $('#age-ok');
      [[name, name.value.trim().length >= 2], [rob, rob.value.trim().length >= 2], [dis, dis.value.trim().length >= 2]]
        .forEach(([el, good]) => { setInvalid(el, !good); if (!good) ok = false; });
      const ageBad = !age.checked; setInvalid(age, ageBad); if (ageBad) ok = false;
    }
    if (n === 4) {
      const port = $('#f-portfolio');
      const portOk = /^https?:\/\/.+\..+/.test(port.value.trim());
      setInvalid(port, !portOk); if (!portOk) ok = false;
      if (!state.experience) { $('#exp-error').style.display = 'block'; ok = false; } else $('#exp-error').style.display = 'none';
      if (!state.availability) { $('#avail-error').style.display = 'block'; ok = false; } else $('#avail-error').style.display = 'none';
    }
    if (!ok && window.Sound) window.Sound.play('error');
    return ok;
  }

  function capture(n) {
    if (n === 2) state.revshare_ack = $('#revshare-ack').checked;
    if (n === 3) {
      state.full_name = $('#f-name').value.trim();
      state.roblox_username = $('#f-roblox').value.trim();
      state.discord_username = $('#f-discord').value.trim();
      state.age_ok = $('#age-ok').checked;
    }
    if (n === 4) {
      state.portfolio_url = $('#f-portfolio').value.trim();
      state.past_projects = $('#f-projects').value.trim();
      state.timezone = $('#f-timezone').value.trim();
      state.role_answer = $('#f-rolespecific').value.trim();
    }
    if (n === 5) state.why = $('#f-why').value.trim();
  }

  function buildReview() {
    const meta = ROLES.find(r => r.id === state.role);
    const rows = [
      ['Role', meta.label], ['Full name', state.full_name], ['Roblox', state.roblox_username],
      ['Discord', state.discord_username], ['Experience', state.experience],
      ['Portfolio', state.portfolio_url], ['Availability', state.availability + (state.timezone ? ' · ' + state.timezone : '')],
      [meta.questionLabel, state.role_answer || '—'], ['Past projects', state.past_projects || '—'],
    ];
    $('#review-list').innerHTML = rows.map(([k, v]) =>
      `<div class="review-row"><dt>${k}</dt><dd>${escapeHtml(v)}</dd></div>`).join('');
  }

  /* ---------- Submit ---------- */
  async function submit() {
    capture(5);
    if (!state.why || state.why.length < 10) { setInvalid($('#f-why'), true); if (window.Sound) window.Sound.play('error'); return; }
    setInvalid($('#f-why'), false);
    const btn = $('#submit-app');
    const user = Auth.getUser();
    // safety: blocked applicants can't submit
    try { if (user && await Store.isBanned(user.id)) { showStatus('banned'); return; } } catch (e) {}
    btn.disabled = true; btn.textContent = 'Submitting…';
    try {
      await Store.submitApplication({
        role: state.role, full_name: state.full_name, roblox_username: state.roblox_username,
        discord_username: state.discord_username, discord_id: user?.id || '',
        portfolio_url: state.portfolio_url, experience: state.experience, past_projects: state.past_projects,
        availability: state.availability, timezone: state.timezone, role_answer: state.role_answer,
        why: state.why, age_ok: state.age_ok,
      });
      confetti();
      if (window.Sound) window.Sound.play('success');
      showStatus('pending');
    } catch (e) {
      btn.disabled = false; btn.textContent = 'Submit application';
      window.toast('Something went wrong — try again.', 'error');
    }
  }

  function showStatus(status, when, message) {
    $('#form-wrap').classList.add('hidden');
    $('.stepper').classList.add('hidden');
    const screen = $('#status-screen');
    screen.classList.remove('hidden');
    const extra = $('#status-extra');
    if (message) { extra.textContent = message; extra.classList.remove('hidden'); }
    else extra.classList.add('hidden');
    const map = {
      pending: { icon: '⏳', title: 'Application received', cls: 'pending',
        msg: 'You’re in the queue. We review every application by hand — if it’s a fit, the next step is a quick interview on Discord.' },
      accepted: { icon: '🎉', title: 'You’re in.', cls: 'accepted',
        msg: 'Welcome to BRICK RUSH. Head to our Discord — you’ll be pinged to set up your interview and get your role.' },
      rejected: { icon: '✳', title: 'Not this time', cls: 'rejected',
        msg: 'We’re not moving forward right now — but you can sharpen your portfolio and apply again anytime. Keep building.' },
      banned: { icon: '⛔', title: 'You can’t apply right now', cls: 'rejected',
        msg: 'Your access to applications has been closed. If you think this is a mistake, reach out to us on Discord.' },
    };
    const s = map[status] || map.pending;
    $('#status-badge').className = 'status-badge ' + s.cls;
    $('#status-badge').textContent = s.icon;
    $('#status-title').textContent = s.title;
    $('#status-msg').textContent = s.msg;
    // Rejected or accepted applicants can apply again; pending/banned cannot.
    $('#status-reapply-row').hidden = !(status === 'accepted' || status === 'rejected');
    $('#status-discord').classList.remove('hidden');
    $('#status-meta').textContent = when ? 'Submitted ' + new Date(when).toLocaleDateString() : 'Status: ' + status.toUpperCase();
  }

  function confetti() {
    const colors = ['#ff2e6e', '#7c5cff', '#2bd2ff', '#ffffff'];
    for (let i = 0; i < 80; i++) {
      const c = document.createElement('div');
      c.className = 'confetti';
      c.style.left = Math.random() * 100 + 'vw';
      c.style.background = colors[i % colors.length];
      c.style.animation = `fall ${1.6 + Math.random() * 1.4}s ${Math.random() * 0.4}s var(--ease) forwards`;
      c.style.transform = `rotate(${Math.random() * 360}deg)`;
      document.body.appendChild(c);
      setTimeout(() => c.remove(), 3400);
    }
  }

  /* ---------- Pills ---------- */
  function wirePills(groupSel, key, errId) {
    $$(groupSel + ' .pill-opt').forEach(p => p.addEventListener('click', () => {
      $$(groupSel + ' .pill-opt').forEach(x => x.classList.remove('active'));
      p.classList.add('active'); state[key] = p.dataset.val;
      if (errId) $(errId).style.display = 'none';
      if (window.Sound) window.Sound.play('tick');
    }));
  }

  /* ---------- Logged-in prefill + status ---------- */
  function applyUser(u) {
    if (!u) return;
    state.discord_username = u.username; state.discord_id = u.id;
    const f = $('#f-discord'); if (f) f.value = u.username;
    const row = $('#signed-in-row'); if (row) { row.style.display = 'flex'; $('#signed-in-name').textContent = u.global_name || u.username; }
  }
  async function checkExistingStatus() {
    const user = Auth.getUser();
    if (!user) return false;
    try {
      const existing = await Store.findByDiscordId(user.id);
      if (existing) { showStatus(existing.status, existing.created_at, existing.decision_message); return true; }
    } catch (e) {}
    return false;
  }

  /* ---------- Init ---------- */
  document.addEventListener('DOMContentLoaded', async () => {
    await Auth.init();   // load the session before deciding anything
    // Login is required to apply
    if (Auth.requireLogin() && !Auth.isLoggedIn()) {
      location.replace('login.html?return=' + encodeURIComponent('apply.html' + (location.hash || '')));
      return;
    }
    renderRoles();
    wirePills('#exp-group', 'experience', '#exp-error');
    wirePills('#avail-group', 'availability', '#avail-error');

    $('#revshare-ack')?.addEventListener('change', (e) => { if (e.target.checked) setInvalid(e.target, false); if (window.Sound) window.Sound.play('tick'); });

    // Nav buttons
    $('#s1-next').addEventListener('click', () => { if (validateStep(1)) goTo(2); });
    $('#s2-back').addEventListener('click', () => goTo(1));
    $('#s2-next').addEventListener('click', () => { if (validateStep(2)) { capture(2); goTo(3); } });
    $('#s3-back').addEventListener('click', () => goTo(2));
    $('#s3-next').addEventListener('click', () => { if (validateStep(3)) { capture(3); goTo(4); } });
    $('#s4-back').addEventListener('click', () => goTo(3));
    $('#s4-next').addEventListener('click', () => { if (validateStep(4)) { capture(4); buildReview(); goTo(5); } });
    $('#s5-back').addEventListener('click', () => goTo(4));
    $('#submit-app').addEventListener('click', submit);

    // Preselect role from ?role=
    const params = new URLSearchParams(location.search);
    const pre = params.get('role');
    if (pre && ROLES.some(r => r.id === pre)) selectRole(pre);

    const user = Auth.getUser();
    if (user) applyUser(user);

    // Banned from applying? Show the closed screen, hide the form.
    if (user) {
      try { if (await Store.isBanned(user.id)) { showStatus('banned'); return; } } catch (e) {}
    }

    // Show their existing status — unless they clicked "Apply again" (?fresh)
    if (!params.has('fresh')) await checkExistingStatus();
  });
})();
