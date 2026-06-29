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
    robloxGroup: 'https://www.roblox.com/communities/473814178/BrickRush#!/about',
    tiktok: 'https://www.tiktok.com/@brickrushhh?lang=en',
    youtube: 'https://www.youtube.com/channel/UC0OQbcJf10pKR2Zk0MTGsCg',
  },

  /* Roblox group that applicants MUST be in before they can apply.
     Membership is verified server-side via the verify-roblox-group function. */
  robloxGroupId: '473814178',
  robloxGroupUrl: 'https://www.roblox.com/communities/473814178/BrickRush#!/about',
  requireRobloxGroup: true,

  /* --- Admin --- */
  // Only this Discord ID can administer once real Discord login is wired up.
  adminDiscordId: '903304467531845644',
  // Until real OAuth is set up, the admin panel is unlocked with this password.
  // CHANGE THIS before you deploy publicly.
  adminPassword: 'BR-v0id7uRBE0W1',

  /* --- Studio Board: coins → rev-share conversion ---
     Each task is worth some coins; coins a developer earns on finished tasks
     roll up toward their revenue share. This sets the exchange rate. Default:
     50 coins ≈ 1% (so ~100 coins ≈ 2%, matching the rev-share page). */
  coinsPerPercent: 50,

  /* How many tasks one person can CLAIM for themselves at once, by difficulty
     (open tasks only — finishing one frees a slot). Admins/leads can still
     assign past these limits. Keep in sync with the claim_task DB function. */
  claimLimits: { easy: 3, medium: 2, hard: 1 },

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

  /* Cloudflare Turnstile (invisible bot protection on the form).
     Free widget at dash.cloudflare.com > Turnstile. Paste the SITE key here
     (public); the SECRET goes in the verify-turnstile function. Blank = off. */
  turnstileSiteKey: '',

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

  /* Web-push public key (safe to expose; pairs with the private key kept in the
     push-notify function). Powers the admin phone-notification app. */
  vapidPublicKey: 'BMX8o7pSmHwEWRAj9dJ57kQQxd_WpbgtHeT4zjOodxHMA4gnuit_Ph9ZeIRzC1jTDEl8qCugdZtIdoJESpDQ-bc',
};

/* Helper: are we running against a real backend, or local-demo? */
window.BRICKRUSH_CONFIG.isLive = Boolean(
  window.BRICKRUSH_CONFIG.SUPABASE_URL && window.BRICKRUSH_CONFIG.SUPABASE_ANON_KEY
);
