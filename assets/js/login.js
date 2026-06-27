/* =========================================================================
   BRICK RUSH — login.js
   Runs the standalone login page. Remembers where the user came from and
   returns them there after a successful Discord login.
   ========================================================================= */
(function () {
  const Auth = window.Auth, CFG = window.BRICKRUSH_CONFIG;
  const RET_KEY = 'brickrush_return';
  const params = new URLSearchParams(location.search);
  const card = document.getElementById('auth-card');

  // Capture where to return to (only on a fresh arrival, not the Discord round-trip)
  const incoming = params.get('return');
  if (incoming) sessionStorage.setItem(RET_KEY, incoming);

  function destination() {
    const r = sessionStorage.getItem(RET_KEY) || 'index.html';
    sessionStorage.removeItem(RET_KEY);
    return r;
  }
  function go() { location.href = destination(); }

  function showBusy(msg) {
    card.innerHTML = `<img class="auth-card__logo" src="assets/img/logo.png" alt="" />
      <h1>${msg}</h1><div class="auth-busy"><span class="spin"></span> One moment…</div>`;
  }

  document.addEventListener('DOMContentLoaded', async () => {
    await Auth.init();   // finishes an OAuth redirect if we just came back from Discord
    if (Auth.isLoggedIn()) { showBusy('Logged in'); if (window.Sound) window.Sound.play('accept'); return go(); }

    const demoNote = document.getElementById('demo-note');
    if (demoNote && !Auth.live()) demoNote.textContent = 'Demo mode — add Supabase keys in config.js for real Discord login.';

    const btn = document.getElementById('discord-login');
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      const u = await Auth.loginWithDiscord(); // demo resolves here; real navigates away
      if (u) { showBusy('Welcome'); if (window.Sound) window.Sound.play('accept'); go(); }
    });
  });
})();
