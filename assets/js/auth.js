/* =========================================================================
   BRICK RUSH — auth.js
   Live mode: real Discord login via Supabase Auth (secure, RLS-backed).
   Demo mode (no Supabase keys): a local stand-in so the flow works offline.
   getUser() is sync (reads a cached session); call await Auth.init() first.
   ========================================================================= */
(function () {
  const CFG = window.BRICKRUSH_CONFIG;
  const USER_KEY = 'brickrush_user';
  const ADMIN_KEY = 'brickrush_admin_session';
  const OWNER_KEY = 'brickrush_owner';

  const live = () => Boolean(window.SB);

  // Turn a Supabase user into our simple shape; id = the Discord user id.
  function normalize(u) {
    const m = u.user_metadata || {};
    const id = m.provider_id || (u.identities && u.identities[0] && u.identities[0].id) || u.id;
    const name = m.full_name || m.name || m.user_name || m.preferred_username || 'member';
    return { id: String(id), username: name, global_name: m.global_name || name, avatar: m.avatar_url || null, demo: false };
  }

  const Auth = {
    live,

    /* Populate the cached user. In live mode this also finishes an OAuth
       redirect (the Supabase client auto-reads the session from the URL). */
    async init() {
      if (!live()) return;
      try {
        const { data } = await window.SB.auth.getSession();
        const s = data && data.session;
        if (s && s.user) sessionStorage.setItem(USER_KEY, JSON.stringify(normalize(s.user)));
        else sessionStorage.removeItem(USER_KEY);
      } catch (e) { /* leave whatever was cached */ }
    },

    getUser() { try { return JSON.parse(sessionStorage.getItem(USER_KEY)); } catch (e) { return null; } },
    isLoggedIn() { return Boolean(this.getUser()); },
    requireLogin() { return Boolean(CFG.requireDiscordLogin); },

    /* Start login. Live → Discord via Supabase (navigates away). Demo → inline. */
    async loginWithDiscord() {
      if (live()) {
        const redirectTo = location.origin + location.pathname.replace(/[^/]*$/, 'login.html');
        await window.SB.auth.signInWithOAuth({ provider: 'discord', options: { redirectTo } });
        return null; // page redirects to Discord
      }
      const tag = 'brick_' + Math.random().toString(36).slice(2, 7);
      const user = { id: 'demo-' + Date.now(), username: tag, global_name: tag, demo: true };
      sessionStorage.setItem(USER_KEY, JSON.stringify(user));
      return user;
    },

    async logout() {
      if (live()) { try { await window.SB.auth.signOut(); } catch (e) {} }
      sessionStorage.removeItem(USER_KEY);
    },

    /* ---- Owner / admin ---- */
    // Real authority (gates the live dashboard): the signed-in Discord id is the owner.
    isAdmin() {
      if (sessionStorage.getItem(ADMIN_KEY) === 'true') return true;     // demo password unlock
      const u = this.getUser();
      return Boolean(u && !u.demo && u.id === CFG.adminDiscordId);
    },
    // Should we show the Admin button? (owner signed in, or this device unlocked before)
    isOwner() {
      if (localStorage.getItem(OWNER_KEY) === '1') return true;
      const u = this.getUser();
      return Boolean(u && !u.demo && u.id === CFG.adminDiscordId);
    },
    loginAdmin(password) {
      const ok = password === CFG.adminPassword;
      if (ok) { sessionStorage.setItem(ADMIN_KEY, 'true'); localStorage.setItem(OWNER_KEY, '1'); }
      return ok;
    },
    logoutAdmin() { sessionStorage.removeItem(ADMIN_KEY); localStorage.removeItem(OWNER_KEY); this.logout(); },
  };

  window.Auth = Auth;
})();
