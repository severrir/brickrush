/* =========================================================================
   BRICK RUSH — config.js
   The ONE file you edit to go from offline-demo to a real cloud backend.
   Nothing else needs to change.
   ========================================================================= */

window.BRICKRUSH_CONFIG = {
  /* --- Brand --- */
  studioName: 'BRICK RUSH',
  tagline: 'We build worlds at the speed of play.',
  discordInvite: 'https://discord.gg/CjVpen7Jvt',
  email: 'team@brickrush.gg',

  /* Social links — replace '' with real URLs when you have them.
     Empty links render as "coming soon" and don't break anything. */
  social: {
    robloxGroup: '',   // e.g. https://www.roblox.com/groups/0000000/Brick-Rush
    tiktok: '',        // e.g. https://www.tiktok.com/@brickrush
    youtube: '',       // e.g. https://www.youtube.com/@brickrush
  },

  /* --- Admin --- */
  // Only this Discord ID can administer once real Discord login is wired up.
  adminDiscordId: '903304467531845644',
  // Until real OAuth is set up, the admin panel is unlocked with this password.
  // CHANGE THIS before you deploy publicly.
  adminPassword: 'BR-v0id7uRBE0W1',

  /* --- Real Discord login (works on GitHub Pages, no server needed) ---
     1. Go to https://discord.com/developers/applications  > New Application
     2. OAuth2 > copy the CLIENT ID below
     3. OAuth2 > Redirects > add BOTH of these exact URLs:
          http://localhost:5173/login.html
          https://severrir.github.io/brickrush/login.html   (your real Pages URL)
     When DISCORD_CLIENT_ID is set, the "Log in with Discord" button does a
     real Discord authorization. Left blank, it uses a local demo login. */
  DISCORD_CLIENT_ID: '',
  // Require Discord login before someone can submit an application?
  requireDiscordLogin: true,

  /* --- Backend (leave blank for offline-demo mode) ---
     Fill these in to switch the whole site to the real cloud database.
     1. Create a free project at https://supabase.com
     2. Paste the Project URL and the public "anon" key below
     3. Run the SQL in README.md to create the tables
     The site auto-detects these and stops using local storage. */
  SUPABASE_URL: 'https://fkptagpyuevukyzgwyle.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_SrfoAQbAguATXGOr6GVMEg_C_Nfv0se',

  /* --- Discord webhook (optional) ---
     Server Settings > Integrations > Webhooks > New Webhook > Copy URL.
     When set, every new application is also posted to your Discord channel. */
  DISCORD_WEBHOOK_URL: '',
};

/* Helper: are we running against a real backend, or local-demo? */
window.BRICKRUSH_CONFIG.isLive = Boolean(
  window.BRICKRUSH_CONFIG.SUPABASE_URL && window.BRICKRUSH_CONFIG.SUPABASE_ANON_KEY
);
