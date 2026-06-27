# BRICK RUSH — Roblox Studio Website

A premium, multi-page site for the **BRICK RUSH** Roblox studio: an animated intro,
a 3D "stud planet" hero, a multi-step application with **Discord login**, a points-based
**revenue-share** explainer, and an **admin panel** to accept/reject applicants and set
which roles are "most wanted."

It is a **static website** — it runs entirely in the visitor's browser. Your PC is
**never** a server or a database. You host it free on **GitHub Pages**, and (optionally)
use **Supabase** (a free cloud database) so applications persist across devices.

> **It works right now in "demo mode"** with zero setup — data is saved in your browser's
> local storage. Add a few keys to `assets/js/config.js` to make it fully live. Nothing
> else changes.

---

## 1. Quick preview (local)

From this folder:

```bash
python -m http.server 5173
```

Then open <http://localhost:5173>. (This local server is only for previewing — it stops
when you close the terminal. It is **not** your real host.)

- Landing page: <http://localhost:5173/index.html>
- Apply: <http://localhost:5173/apply.html>
- Admin: <http://localhost:5173/admin.html> — password is in `config.js` (default `brickrush-admin`)

---

## 2. The one file you edit: `assets/js/config.js`

Everything configurable lives here:

| Setting | What it does |
|---|---|
| `discordInvite` | Your Discord invite (already set to your link) |
| `adminDiscordId` | Your Discord ID (already set) — owns the admin panel when live |
| `adminPassword` | **Change this** before going public. Anyone with it can accept/reject. |
| `DISCORD_CLIENT_ID` | Turns on **real Discord login** (see §4) |
| `requireDiscordLogin` | `true` = users must log in with Discord to apply |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | Turns on the **real cloud database** (see §5) |
| `DISCORD_WEBHOOK_URL` | Posts each application to your Discord channel (see §6) |
| `social.*` | Your Roblox group / TikTok / YouTube links for the footer |

**What works in demo mode (no setup):** the whole site, the form, accept/reject, and
"most wanted" — all stored in **one browser**. Good for testing on your own machine.

**What going live adds:** applications persist in the cloud so *applicants on their phones*
and *you on your PC* see the same data, real Discord login, and Discord notifications.

---

## 3. Deploy to GitHub Pages (your real host)

1. Create a free GitHub account and a new **public** repository named `brickrush`.
2. Upload **all** the files in this folder (keep the structure — `index.html` must be at the root).
   - Easiest: on the repo page → **Add file → Upload files** → drag everything in → **Commit**.
3. Repo → **Settings → Pages**.
4. Under **Build and deployment**, Source = **Deploy from a branch**, Branch = **main**, folder = **/ (root)** → **Save**.
5. Wait ~1 minute. Your site is live at:

   ```
   https://severrir.github.io/brickrush/
   ```

6. **SEO step:** search the project for `severrir` and replace it with your real GitHub
   username in: `index.html`, `apply.html`, `robots.txt`, `sitemap.xml`. (These power
   Google indexing and social link previews.)

That's it — you have a clean public link. Re-uploading changed files redeploys automatically.

---

## 4. Turn on real Discord login (works on GitHub Pages, no server)

1. Go to <https://discord.com/developers/applications> → **New Application** → name it `BRICK RUSH`.
2. Open **OAuth2**. Copy the **Client ID**.
3. Still in **OAuth2 → Redirects**, click **Add Redirect** and add **both** of these
   *exactly* (one for local testing, one for your live site). Login happens on the
   dedicated **login page**, so the redirect points there:

   ```
   http://localhost:5173/login.html
   https://severrir.github.io/brickrush/login.html
   ```
   Click **Save Changes**.
4. In `config.js`, set:

   ```js
   DISCORD_CLIENT_ID: 'paste-your-client-id-here',
   ```

Now the **Log in / Register with Discord** button does a real Discord authorization and
fills in the applicant's verified Discord username. No secret key is needed — this uses
Discord's browser-side flow, which is safe to ship publicly.

---

## 5. Turn on the real cloud database (Supabase)

This makes applications persist across devices, so applicants can check their
**Pending / Accepted / Rejected** status from anywhere and you manage them from any device.

1. Create a free project at <https://supabase.com>.
2. In the project: **Project Settings → API**. Copy the **Project URL** and the
   **anon public** key. Put them in `config.js`:

   ```js
   SUPABASE_URL: 'https://xxxx.supabase.co',
   SUPABASE_ANON_KEY: 'eyJhbGciOi...your anon key...',
   ```
3. Open **SQL Editor** in Supabase, paste the SQL below, and click **Run**:

```sql
-- Applications
create table if not exists applications (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz default now(),
  status        text default 'pending',          -- pending | accepted | rejected
  role          text not null,                    -- scripter | modeler_animator | uiux
  full_name     text,
  roblox_username text,
  discord_username text,
  discord_id    text,
  portfolio_url text,
  experience    text,
  past_projects text,
  availability  text,
  timezone      text,
  role_answer   text,
  why           text,
  age_ok        boolean default false,
  note          text,             -- private, owner only
  decision_message text,          -- shown to the applicant on accept/reject
  reviewed_at   timestamptz
);

-- Live role demand for the "most wanted" badges
create table if not exists role_demand (
  role  text primary key,   -- scripter | modeler_animator | uiux
  level text default 'open' -- most_wanted | open | closed
);
insert into role_demand (role, level) values
  ('scripter','open'), ('modeler_animator','open'), ('uiux','open')
on conflict (role) do nothing;

-- Banned Discord identities (can't apply again)
create table if not exists bans (
  discord_id       text primary key,
  discord_username text,
  full_name        text,
  banned_at        timestamptz default now()
);

-- Row Level Security
alter table applications enable row level security;
alter table role_demand  enable row level security;
alter table bans         enable row level security;

-- An applicant can check whether THEIR OWN id is banned
create policy "check my ban"
  on bans for select to anon, authenticated using (true);

-- Anyone may submit an application (insert only)
create policy "anyone can apply"
  on applications for insert to anon, authenticated with check (true);

-- Anyone may read the public "most wanted" demand
create policy "demand is public"
  on role_demand for select to anon, authenticated using (true);
```

> **Securing the admin reads/writes:** the safest production setup is to enable the
> **Discord provider** under Supabase **Authentication → Providers**, then sign in as the
> owner so only your Discord ID can read all applications and change demand. Until you do
> that, keep the admin panel on the **password gate** and only run it on your own machine.
> See `docs/` notes inside `store.js` for the exact data calls if you want to extend this.

4. (Recommended) **Authentication → Providers → Discord**: enable it, paste the same
   Discord Client ID + the Client **Secret** from the Discord Developer portal, and add
   the Supabase callback URL it shows you to your Discord app's redirects.

---

## 6. Discord webhook — get pinged on every application

1. In your Discord server: **Server Settings → Integrations → Webhooks → New Webhook**.
2. Pick the channel, **Copy Webhook URL**, paste into `config.js`:

   ```js
   DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/....',
   ```

Now every new application — and every accept/reject — posts to that channel automatically.
(Applicant text can never ping `@everyone`; that's blocked.)

---

## 7. How the application flow works

1. **Apply** → user logs in with Discord, picks a role, fills the form → it's saved to the
   database **and** posted to your Discord webhook.
2. **Review** → you open `admin.html`, see the queue, and click **Accept** / **Reject**
   (with private notes, search, filters, CSV export, and stat counts).
3. **Status** → the applicant returns to the Apply page; because they're logged in with
   Discord, they see their live **Pending / Accepted / Rejected** screen. Accepted folks
   are told to expect an **interview on Discord**.
4. **Most wanted** → in the admin panel you flag which roles are hottest; the landing page
   badges update from that.

---

## 8. Revenue-share model (shown on the site)

Departments — **Scripting**, **Visual** (modeling + animation), and **UI/UX** — each hold
a share of a game's revenue. Inside a department, work earns **points** by difficulty
(a small system ≈ 2 points; a big, hard one ≈ 10). Points convert to a real percentage of
revenue (e.g. ~100 points ≈ 2%). Edit the wording in `index.html` (the `#revshare` section)
and the FAQ anytime.

---

## 9. File structure

```
brickrush/
├── index.html          Landing: intro → hero → build → roles → process → rev-share → values → FAQ → CTA
├── apply.html          Discord login → role select → 4-step form → status screen
├── admin.html          Owner dashboard: accept/reject, notes, search, CSV, "most wanted"
├── 404.html            Glitchy on-brand not-found page
├── robots.txt, sitemap.xml, .nojekyll   SEO + GitHub Pages helpers
├── README.md           This file
└── assets/
    ├── css/  base · components · landing · apply · admin
    ├── img/  logo.png
    └── js/
        ├── config.js       ← edit me
        ├── data.js         roles + demand labels
        ├── sound.js        UI sound effects + ambient music slot
        ├── store.js        data layer (localStorage ↔ Supabase)
        ├── auth.js         Discord login + admin session
        ├── ui.js           nav, reveals, cursor, toasts, counters
        ├── loader.js       intro animation
        ├── hero.js         3D stud-planet (Three.js)
        ├── landing.js      roles + demand + FAQ
        ├── apply.js        multi-step form
        └── admin.js        dashboard
```

## 10. Before you go public — checklist

- [ ] Change `adminPassword` in `config.js`
- [ ] Replace `severrir` in `index.html`, `apply.html`, `robots.txt`, `sitemap.xml`
- [ ] (Optional) Add `DISCORD_CLIENT_ID` for real login
- [ ] (Optional) Add Supabase keys for cross-device data
- [ ] (Optional) Add `DISCORD_WEBHOOK_URL` for channel notifications
- [ ] Drop a royalty-free track at `assets/audio/ambient.mp3` if you want background music

## 11. Ambient music

The sound toggle in the nav plays UI sound effects out of the box (no files needed). For
background music, add a file at `assets/audio/ambient.mp3` — it stays muted until a visitor
turns sound on, then fades in softly.
