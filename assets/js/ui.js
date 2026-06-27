/* =========================================================================
   BRICK RUSH — ui.js
   Shared chrome: nav, scroll reveals, toasts, custom cursor, sound toggle,
   footer/discord-link injection, mobile menu. Runs on every page.
   ========================================================================= */
(function () {
  const CFG = window.BRICKRUSH_CONFIG;

  /* ---------- Inject config-driven links ---------- */
  function wireLinks() {
    document.querySelectorAll('[data-discord]').forEach(a => { a.href = CFG.discordInvite; a.target = '_blank'; a.rel = 'noopener'; });
    document.querySelectorAll('[data-social="robloxGroup"]').forEach(a => setSocial(a, CFG.social.robloxGroup));
    document.querySelectorAll('[data-social="tiktok"]').forEach(a => setSocial(a, CFG.social.tiktok));
    document.querySelectorAll('[data-social="youtube"]').forEach(a => setSocial(a, CFG.social.youtube));
    document.querySelectorAll('[data-year]').forEach(el => { el.textContent = new Date().getFullYear(); });
  }
  function setSocial(a, url) {
    if (url) { a.href = url; a.target = '_blank'; a.rel = 'noopener'; a.removeAttribute('aria-disabled'); }
    else { a.href = '#'; a.setAttribute('aria-disabled', 'true'); a.title = 'Coming soon'; a.addEventListener('click', e => e.preventDefault()); }
  }

  /* ---------- Sticky nav + mobile menu ---------- */
  function nav() {
    const bar = document.querySelector('.nav');
    if (!bar) return;
    const onScroll = () => bar.classList.toggle('scrolled', window.scrollY > 24);
    onScroll(); window.addEventListener('scroll', onScroll, { passive: true });

    const burger = bar.querySelector('.nav__burger');
    const links = bar.querySelector('.nav__links');
    if (burger && links) {
      burger.addEventListener('click', () => links.classList.toggle('open'));
      links.querySelectorAll('a').forEach(a => a.addEventListener('click', () => links.classList.remove('open')));
    }
  }

  /* ---------- Scroll reveals ---------- */
  function reveals() {
    const els = document.querySelectorAll('.reveal');
    if (!els.length) return;
    if (!('IntersectionObserver' in window)) { els.forEach(e => e.classList.add('in')); return; }
    const io = new IntersectionObserver((entries) => {
      entries.forEach(en => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
    els.forEach(e => io.observe(e));
  }

  /* ---------- Animated counters ---------- */
  function counters() {
    const els = document.querySelectorAll('[data-count]');
    if (!els.length || !('IntersectionObserver' in window)) { els.forEach(e => e.textContent = e.dataset.count); return; }
    const io = new IntersectionObserver((entries) => {
      entries.forEach(en => {
        if (!en.isIntersecting) return;
        const el = en.target, target = parseFloat(el.dataset.count), suffix = el.dataset.suffix || '';
        let t0 = null;
        const tick = (ts) => {
          if (!t0) t0 = ts;
          const p = Math.min((ts - t0) / 1100, 1);
          el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3))) + suffix;
          if (p < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick); io.unobserve(el);
      });
    }, { threshold: 0.6 });
    els.forEach(e => io.observe(e));
  }

  /* ---------- Sound toggle button ---------- */
  function soundToggle() {
    const btn = document.querySelector('.sound-toggle');
    if (!btn || !window.Sound) return;
    const sync = () => {
      const muted = window.Sound.muted;
      btn.classList.toggle('muted', muted);
      btn.classList.toggle('playing', !muted);
      btn.setAttribute('aria-label', muted ? 'Unmute sound' : 'Mute sound');
      btn.setAttribute('aria-pressed', String(!muted));
    };
    sync();
    btn.addEventListener('click', () => { window.Sound.toggle(); sync(); });
    window.Sound.bind();
  }

  /* ---------- Custom cursor (desktop, tasteful) ---------- */
  function cursor() {
    if (window.matchMedia('(hover: none)').matches || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const dot = document.createElement('div');
    const ring = document.createElement('div');
    dot.className = 'cursor-dot'; ring.className = 'cursor-ring';
    dot.style.opacity = ring.style.opacity = '0';
    document.body.append(dot, ring);
    document.body.classList.add('has-cursor');
    let mx = innerWidth / 2, my = innerHeight / 2, rx = mx, ry = my, shown = false;
    window.addEventListener('pointermove', (e) => {
      mx = e.clientX; my = e.clientY;
      dot.style.transform = `translate(${mx}px, ${my}px)`;
      if (!shown) { shown = true; dot.style.opacity = ring.style.opacity = '1'; }
    });
    const loop = () => {
      rx += (mx - rx) * 0.18; ry += (my - ry) * 0.18;
      ring.style.transform = `translate(${rx}px, ${ry}px)`;
      requestAnimationFrame(loop);
    };
    loop();
    document.addEventListener('pointerover', (e) => {
      const hot = e.target.closest && e.target.closest('a,button,.role-opt,.card,input,textarea,select,.pill-opt');
      ring.classList.toggle('hot', Boolean(hot));
    });
    window.addEventListener('pointerdown', () => ring.classList.add('down'));
    window.addEventListener('pointerup', () => ring.classList.remove('down'));
  }

  /* ---------- Toasts ---------- */
  function ensureWrap() {
    let w = document.querySelector('.toast-wrap');
    if (!w) { w = document.createElement('div'); w.className = 'toast-wrap'; document.body.appendChild(w); }
    return w;
  }
  window.toast = function (msg, type = '') {
    const w = ensureWrap();
    const t = document.createElement('div');
    t.className = 'toast' + (type ? ' toast--' + type : '');
    t.innerHTML = `<span class="toast__dot"></span><span>${msg}</span>`;
    w.appendChild(t);
    if (window.Sound) window.Sound.play(type === 'error' ? 'error' : type === 'success' ? 'success' : 'tick');
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 400); }, 4200);
  };

  /* ---------- Year ---------- */
  /* ---------- Nav auth state (Log in  ↔  account menu) ---------- */
  const escapeHtml = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function authNav() {
    const slot = document.querySelector('[data-auth-slot]');
    if (!slot || !window.Auth) return;
    const user = window.Auth.getUser();
    const here = (location.pathname.split('/').pop() || 'index.html') + location.search;
    const adminBtn = (window.Auth.isOwner && window.Auth.isOwner())
      ? `<a class="btn btn--sm nav-admin-btn" href="admin.html"><span class="nav-admin-btn__full">✳ Admin panel</span><span class="nav-admin-btn__short">✳</span></a>` : '';
    if (!user) {
      slot.innerHTML = adminBtn + `<a class="btn btn--ghost btn--sm" href="login.html?return=${encodeURIComponent(here)}">Log in</a>`;
      return;
    }
    const initial = (user.global_name || user.username || '?').charAt(0).toUpperCase();
    const avatar = user.avatar
      ? `<img src="${escapeHtml(user.avatar)}" alt="" />`
      : `<span class="nav-account__fallback">${escapeHtml(initial)}</span>`;
    slot.innerHTML = adminBtn + `
      <div class="nav-account">
        <button class="nav-account__btn" aria-haspopup="true" aria-expanded="false">
          ${avatar}<span class="nav-account__name">${escapeHtml(user.global_name || user.username)}</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M6 9l6 6 6-6"/></svg>
        </button>
        <div class="nav-account__menu">
          <a href="apply.html#status">My application</a>
          <button type="button" data-logout>Log out</button>
        </div>
      </div>`;
    const acc = slot.querySelector('.nav-account');
    const btn = slot.querySelector('.nav-account__btn');
    btn.addEventListener('click', (e) => { e.stopPropagation(); const open = acc.classList.toggle('open'); btn.setAttribute('aria-expanded', String(open)); });
    document.addEventListener('click', () => acc.classList.remove('open'));
    slot.querySelector('[data-logout]').addEventListener('click', () => { window.Auth.logout(); location.href = 'index.html'; });
  }

  // QA mode (?audit): force all entrance animations to final state for screenshots
  if (/[?&]audit\b/.test(location.search)) document.documentElement.classList.add('audit');

  document.addEventListener('DOMContentLoaded', async () => {
    if (window.Auth && window.Auth.init) { try { await window.Auth.init(); } catch (e) {} }
    wireLinks(); nav(); reveals(); counters(); soundToggle(); cursor(); authNav();
  });
})();
