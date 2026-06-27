/* =========================================================================
   BRICK RUSH — auth.js
   Real Discord login/registration via OAuth2 implicit grant — fully
   client-side, works on GitHub Pages (no server, no secret). Falls back to a
   local demo login until DISCORD_CLIENT_ID is set in config.js.
   ========================================================================= */
(function () {
  const CFG = window.BRICKRUSH_CONFIG;
  const USER_KEY = 'brickrush_user';
  const ADMIN_KEY = 'brickrush_admin_session';
  const OWNER_KEY = 'brickrush_owner';      // persistent: this device belongs to the owner
  const STATE_KEY = 'brickrush_oauth_state';

  function redirectUri() {
    // Must EXACTLY match a redirect registered in the Discord app.
    return location.origin + location.pathname;
  }

  const Auth = {
    /* ---- Applicant identity ---- */
    getUser() { try { return JSON.parse(sessionStorage.getItem(USER_KEY)); } catch (e) { return null; } },
    isLoggedIn() { return Boolean(this.getUser()); },
    requireLogin() { return Boolean(CFG.requireDiscordLogin); },
    realDiscord() { return Boolean(CFG.DISCORD_CLIENT_ID); },

    /* Kick off login. Real flow redirects to Discord; demo resolves inline. */
    async loginWithDiscord() {
      if (CFG.DISCORD_CLIENT_ID) {
        const state = Math.random().toString(36).slice(2) + Date.now().toString(36);
        sessionStorage.setItem(STATE_KEY, state);
        const params = new URLSearchParams({
          client_id: CFG.DISCORD_CLIENT_ID,
          redirect_uri: redirectUri(),
          response_type: 'token',
          scope: 'identify',
          state,
          prompt: 'consent',
        });
        location.href = 'https://discord.com/api/oauth2/authorize?' + params.toString();
        return null; // page navigates away
      }
      // demo fallback
      const tag = 'brick_' + Math.random().toString(36).slice(2, 7);
      const user = { id: 'demo-' + Date.now(), username: tag, global_name: tag, demo: true };
      sessionStorage.setItem(USER_KEY, JSON.stringify(user));
      return user;
    },

    /* Called on every page load: if we came back from Discord, finish login. */
    async handleRedirect() {
      if (!location.hash || location.hash.indexOf('access_token') === -1) return null;
      const frag = new URLSearchParams(location.hash.slice(1));
      const token = frag.get('access_token');
      const state = frag.get('state');
      // strip the fragment from the URL bar regardless of outcome
      history.replaceState(null, '', location.pathname + location.search);
      if (!token) return null;
      if (state && sessionStorage.getItem(STATE_KEY) && state !== sessionStorage.getItem(STATE_KEY)) {
        if (window.toast) window.toast('Login check failed — please try again.', 'error');
        return null;
      }
      sessionStorage.removeItem(STATE_KEY);
      try {
        const res = await fetch('https://discord.com/api/users/@me', { headers: { Authorization: 'Bearer ' + token } });
        if (!res.ok) throw new Error('discord');
        const d = await res.json();
        const user = {
          id: d.id,
          username: d.username,
          global_name: d.global_name || d.username,
          discriminator: d.discriminator,
          avatar: d.avatar ? `https://cdn.discordapp.com/avatars/${d.id}/${d.avatar}.png` : null,
          demo: false,
        };
        sessionStorage.setItem(USER_KEY, JSON.stringify(user));
        return user;
      } catch (e) {
        if (window.toast) window.toast('Couldn’t reach Discord — please try again.', 'error');
        return null;
      }
    },

    logout() { sessionStorage.removeItem(USER_KEY); },

    /* ---- Owner / admin ----
       Demo: password gate. Live: signed-in Discord id must equal adminDiscordId. */
    // Active admin session (this tab) OR the real owner signed in with Discord.
    isAdmin() {
      if (sessionStorage.getItem(ADMIN_KEY) === 'true') return true;
      const u = this.getUser();
      return Boolean(u && !u.demo && u.id === CFG.adminDiscordId);
    },
    // Is this the owner's device? (shows the Admin button in the nav.)
    // True if the real owner is signed in, or admin was unlocked here before.
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
