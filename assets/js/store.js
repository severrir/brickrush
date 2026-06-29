/* =========================================================================
   BRICK RUSH — store.js
   Single data layer. Runs on localStorage in offline-demo mode, and
   auto-switches to Supabase the moment keys are added to config.js.
   Every page talks to this — nothing else knows where data lives.
   ========================================================================= */
(function () {
  const CFG = window.BRICKRUSH_CONFIG;
  const APPS_KEY = 'brickrush_applications';
  const DEMAND_KEY = 'brickrush_demand';
  const BANS_KEY = 'brickrush_bans';
  const ADMINS_KEY = 'brickrush_admins';
  const PV_KEY = 'brickrush_pageviews';
  const VID_KEY = 'brickrush_visitor_id';

  // A stable per-browser id so visitor counts mean "people", not "page loads".
  function visitorId() {
    let v = null;
    try { v = localStorage.getItem(VID_KEY); if (!v) { v = 'v-' + Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem(VID_KEY, v); } }
    catch (e) { v = 'v-anon'; }
    return v;
  }

  const DEFAULT_DEMAND = { scripter: 'open', modeler_animator: 'open', uiux: 'open' };

  /* ---- Supabase client (only if configured) ---- */
  let sb = null;
  if (CFG.isLive && window.supabase) {
    sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  }
  window.SB = sb;   // shared client for auth.js (login) — null in demo mode

  /* ---- Local-demo helpers ---- */
  const readLocal = (k, fallback) => {
    try { return JSON.parse(localStorage.getItem(k)) ?? fallback; }
    catch (e) { return fallback; }
  };
  const writeLocal = (k, v) => localStorage.setItem(k, JSON.stringify(v));

  function seedDemo() {
    if (localStorage.getItem(APPS_KEY)) return;
    const now = Date.now();
    writeLocal(APPS_KEY, [
      {
        id: 'demo-1', created_at: new Date(now - 36e5).toISOString(), role: 'scripter',
        full_name: 'Ava Quinn', roblox_username: 'avaScripts', discord_username: 'ava#0001',
        discord_id: 'demo-ava-001', portfolio_url: 'https://github.com/example/ava',
        experience: 'Advanced', past_projects: 'Built a round-based combat framework for a 5k-CCU game.',
        availability: '20+ hrs/week', timezone: 'GMT+1', why: 'Want to build something from day one and own the upside.',
        age_ok: true, status: 'pending', note: '', reviewed_at: null,
      },
      {
        id: 'demo-2', created_at: new Date(now - 8.6e7).toISOString(), role: 'modeler_animator',
        full_name: 'Theo Marsh', roblox_username: 'theoBuilds', discord_username: 'theo.m',
        discord_id: 'demo-theo-002', portfolio_url: 'https://artstation.com/example',
        experience: 'Intermediate', past_projects: 'Low-poly weapon packs + run/idle animation sets.',
        availability: '10–20 hrs/week', timezone: 'EST', why: 'Love stylized worlds, want a real team.',
        age_ok: true, status: 'accepted', note: 'Strong portfolio.', reviewed_at: new Date(now - 7e7).toISOString(),
      },
    ]);
  }

  /* ---- Discord webhook ---- */
  async function notifyDiscord(content, embed) {
    if (!CFG.DISCORD_WEBHOOK_URL) return; // no-op in demo
    try {
      await fetch(CFG.DISCORD_WEBHOOK_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content, embeds: embed ? [embed] : undefined, username: 'BRICK RUSH',
          allowed_mentions: { parse: [] }, // never let applicant text ping @everyone/roles
        }),
      });
    } catch (e) { /* webhook failures must never block the user */ }
  }

  function roleLabel(r) {
    return { scripter: 'Scripter', modeler_animator: 'Modeler & Animator', uiux: 'UI/UX Designer' }[r] || r;
  }

  /* DM the applicant their result via the Supabase 'notify-applicant' function
     (which holds the Discord bot token). Best-effort — never blocks the admin. */
  async function notifyApplicant(discordId, status, message, fullName) {
    if (!sb || !discordId) return;
    const reviewer = (window.Auth && window.Auth.getUser && window.Auth.getUser()) || {};
    try {
      const { data, error } = await sb.functions.invoke('notify-applicant', {
        body: {
          discord_id: discordId, status, message: message || '', full_name: fullName || '',
          reviewer_name: reviewer.global_name || reviewer.username || '', reviewer_avatar: reviewer.avatar || '',
        },
      });
      if (error) {
        let detail = error.message || 'error';
        try { detail = JSON.stringify(await error.context.json()); } catch (e) {}
        if (window.toast) window.toast('DM failed: ' + detail, 'error', true);
        console.warn('[notify]', detail); return;
      }
      if (data && data.ok) { if (window.toast) window.toast('Applicant DM sent ✓', 'success'); }
      else { if (window.toast) window.toast('DM not sent — ' + JSON.stringify(data), 'error', true); console.warn('[notify]', data); }
    } catch (e) { if (window.toast) window.toast('DM call error: ' + e.message, 'error'); console.warn('[notify]', e); }
  }

  /* ---- Public API ---- */
  const Store = {
    live: Boolean(sb),
    roleLabel,

    async listApplications() {
      if (sb) {
        const { data, error } = await sb.from('applications').select('*').order('created_at', { ascending: false });
        if (error) throw error;
        return data || [];
      }
      seedDemo();
      return readLocal(APPS_KEY, []).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    },

    async submitApplication(app) {
      const record = {
        id: 'app-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
        created_at: new Date().toISOString(), status: 'pending', note: '', reviewed_at: null, ...app,
      };
      if (sb) {
        const { id, ...insert } = record;
        // insert only (applicants can't SELECT the row back — privacy)
        const { error } = await sb.from('applications').insert(insert);
        if (error) throw error;
        await this._pingNew(record);
        return record;
      }
      const apps = readLocal(APPS_KEY, []);
      apps.push(record);
      writeLocal(APPS_KEY, apps);
      await this._pingNew(record);
      return record;
    },

    async _pingNew(a) {
      await notifyDiscord(`✳ **New application** — ${a.full_name} for **${roleLabel(a.role)}**`, {
        title: `${a.full_name} — ${roleLabel(a.role)}`,
        color: 0xff2e6e,
        fields: [
          { name: 'Roblox', value: a.roblox_username || '—', inline: true },
          { name: 'Discord', value: a.discord_username || '—', inline: true },
          { name: 'Experience', value: a.experience || '—', inline: true },
          { name: 'Portfolio', value: a.portfolio_url || '—' },
          { name: 'Why', value: (a.why || '—').slice(0, 400) },
        ],
        timestamp: a.created_at,
      });
    },

    async updateStatus(id, status, message = '', notify = true) {
      let app;
      const reviewer = (window.Auth && window.Auth.getUser && window.Auth.getUser()) || {};
      const patch = {
        status, reviewed_at: new Date().toISOString(), decision_message: message,
        reviewer_id: reviewer.id || null,
        reviewer_name: reviewer.global_name || reviewer.username || null,
        reviewer_avatar: reviewer.avatar || null,
      };
      if (sb) {
        const { data, error } = await sb.from('applications').update(patch).eq('id', id).select().single();
        if (error) throw error; app = data;
      } else {
        const apps = readLocal(APPS_KEY, []);
        app = apps.find(a => a.id === id);
        if (app) { Object.assign(app, patch); writeLocal(APPS_KEY, apps); }
      }
      if (app) {
        const verb = status === 'accepted' ? '✅ **Accepted**' : '❌ **Rejected**';
        await notifyDiscord(`${verb} — ${app.full_name} (${roleLabel(app.role)})${message ? `\n> ${message}` : ''}`);
        if (notify) await notifyApplicant(app.discord_id, status, message, app.full_name);
      }
      return app;
    },

    async setNote(id, note) {
      if (sb) { await sb.from('applications').update({ note }).eq('id', id); return; }
      const apps = readLocal(APPS_KEY, []);
      const a = apps.find(x => x.id === id);
      if (a) { a.note = note; writeLocal(APPS_KEY, apps); }
    },
    async setRating(id, rating) {
      if (sb) { await sb.from('applications').update({ rating }).eq('id', id); return; }
      const apps = readLocal(APPS_KEY, []); const a = apps.find(x => x.id === id);
      if (a) { a.rating = rating; writeLocal(APPS_KEY, apps); }
    },
    async setTags(id, tags) {
      if (sb) { await sb.from('applications').update({ tags }).eq('id', id); return; }
      const apps = readLocal(APPS_KEY, []); const a = apps.find(x => x.id === id);
      if (a) { a.tags = tags; writeLocal(APPS_KEY, apps); }
    },

    /* ---- Bans: stop a Discord identity from applying again ---- */
    async isBanned(discordId) {
      if (!discordId) return false;
      if (sb) {
        const { data } = await sb.from('bans').select('discord_id').eq('discord_id', discordId).maybeSingle();
        return Boolean(data);
      }
      return readLocal(BANS_KEY, []).some(b => b.discord_id === discordId);
    },
    async banUser(app) {
      const rec = {
        discord_id: app.discord_id || '', discord_username: app.discord_username || '',
        full_name: app.full_name || '', banned_at: new Date().toISOString(),
      };
      if (!rec.discord_id) return false; // can't ban without a Discord identity
      if (sb) { await sb.from('bans').upsert(rec, { onConflict: 'discord_id' }); }
      else {
        const bans = readLocal(BANS_KEY, []);
        if (!bans.some(b => b.discord_id === rec.discord_id)) bans.push(rec);
        writeLocal(BANS_KEY, bans);
      }
      // mark their application rejected (without a second DM)
      if (app.id) await this.updateStatus(app.id, 'rejected', '', false);
      await notifyDiscord(`⛔ **Banned** — ${rec.full_name || rec.discord_username || rec.discord_id} can no longer apply.`);
      await notifyApplicant(rec.discord_id, 'banned', '', rec.full_name);
      return true;
    },
    async unbanUser(discordId) {
      if (sb) { await sb.from('bans').delete().eq('discord_id', discordId); return; }
      writeLocal(BANS_KEY, readLocal(BANS_KEY, []).filter(b => b.discord_id !== discordId));
    },
    async listBans() {
      if (sb) { const { data } = await sb.from('bans').select('*'); return data || []; }
      return readLocal(BANS_KEY, []);
    },

    /* ---- Staff / admins (owner can add other admins) ---- */
    async isStaff() {
      const u = (window.Auth && window.Auth.getUser && window.Auth.getUser()) || null;
      if (!u) return false;
      if (u.id === CFG.adminDiscordId) return true; // owner
      if (sb) {
        try { const { data } = await sb.rpc('am_i_staff'); return data === true; } catch (e) { return false; }
      }
      return readLocal(ADMINS_KEY, []).some(a => a.discord_id === u.id);
    },
    async listAdmins() {
      if (sb) { const { data } = await sb.from('admins').select('*').order('added_at', { ascending: true }); return data || []; }
      return readLocal(ADMINS_KEY, []);
    },
    async addAdmin(discordId, username) {
      const rec = { discord_id: String(discordId || '').trim(), username: (username || '').trim(), avatar: '', added_at: new Date().toISOString() };
      if (!/^\d{15,21}$/.test(rec.discord_id)) return { error: 'That doesn’t look like a Discord ID — it should be a ~18-digit number.' };
      if (rec.discord_id === CFG.adminDiscordId) return { error: 'That’s the owner — they already have full access.' };
      if (sb) {
        const { error } = await sb.from('admins').upsert(rec, { onConflict: 'discord_id' });
        if (error) return { error: error.message };
      } else {
        const list = readLocal(ADMINS_KEY, []);
        if (!list.some(a => a.discord_id === rec.discord_id)) list.push(rec);
        writeLocal(ADMINS_KEY, list);
      }
      return { ok: true };
    },
    async removeAdmin(discordId) {
      if (sb) { await sb.from('admins').delete().eq('discord_id', discordId); return; }
      writeLocal(ADMINS_KEY, readLocal(ADMINS_KEY, []).filter(a => a.discord_id !== discordId));
    },

    async getDemand() {
      if (sb) {
        const { data } = await sb.from('role_demand').select('*');
        const out = { ...DEFAULT_DEMAND };
        (data || []).forEach(r => { out[r.role] = r.level; });
        return out;
      }
      return readLocal(DEMAND_KEY, DEFAULT_DEMAND);
    },

    async setDemand(role, level) {
      if (sb) {
        const { data, error } = await sb.from('role_demand').update({ level }).eq('role', role).select();
        if (error) return { error: error.message };
        if (!data || data.length === 0) return { error: 'Saved nothing — check permissions (RLS).' };
        return { ok: true };
      }
      const d = readLocal(DEMAND_KEY, DEFAULT_DEMAND);
      d[role] = level; writeLocal(DEMAND_KEY, d);
      return { ok: true };
    },

    async findByDiscordId(discordId) {
      if (!discordId) return null;
      if (sb) {
        // applicants read only their own safe status via a security-definer RPC
        const { data, error } = await sb.rpc('my_application');
        if (error || !data || !data.length) return null;
        return data[0];
      }
      const all = await this.listApplications();
      return all.find(a => a.discord_id === discordId) || null;
    },

    /* ---- Delete / wipe applications (owner/admin) ---- */
    async deleteApplication(id) {
      if (sb) { const { error } = await sb.from('applications').delete().eq('id', id); if (error) return { error: error.message }; return { ok: true }; }
      writeLocal(APPS_KEY, readLocal(APPS_KEY, []).filter(a => a.id !== id)); return { ok: true };
    },
    async wipeApplications() {
      if (sb) {
        const { error } = await sb.from('applications').delete().not('id', 'is', null);
        if (error) return { error: error.message }; return { ok: true };
      }
      writeLocal(APPS_KEY, []); return { ok: true };
    },

    /* ---- Visitor analytics ---- */
    async trackView(path) {
      const rec = { path: String(path || location.pathname).slice(0, 200), visitor_id: visitorId() };
      if (sb) { try { await sb.from('page_views').insert(rec); } catch (e) {} return; }
      const pv = readLocal(PV_KEY, []);
      pv.push({ ...rec, created_at: new Date().toISOString() });
      if (pv.length > 5000) pv.splice(0, pv.length - 5000);
      writeLocal(PV_KEY, pv);
    },
    async visitorStats() {
      if (sb) { const { data, error } = await sb.rpc('visitor_stats'); if (error) throw error; return data || {}; }
      const pv = readLocal(PV_KEY, []);
      const day = (d) => new Date(d).toISOString().slice(0, 10);
      const today = day(Date.now());
      const weekAgo = Date.now() - 7 * 864e5;
      const uniq = (arr) => new Set(arr.map(r => r.visitor_id)).size;
      const byDay = {};
      pv.filter(r => new Date(r.created_at) > Date.now() - 14 * 864e5).forEach(r => { (byDay[day(r.created_at)] = byDay[day(r.created_at)] || new Set()).add(r.visitor_id); });
      return {
        today_people: uniq(pv.filter(r => day(r.created_at) === today)),
        week_people: uniq(pv.filter(r => new Date(r.created_at) > weekAgo)),
        total_people: uniq(pv),
        total_views: pv.length,
        days: Object.keys(byDay).sort().map(d => ({ d, n: byDay[d].size })),
      };
    },
  };

  window.Store = Store;

  /* =========================================================================
     STUDIO BOARD — Trello-adapted task system (games → boards → columns → cards)
     Same dual-mode contract as Store: Supabase when live, localStorage in demo.
     ========================================================================= */
  const BOARD_KEY = 'brickrush_board';
  const DISCIPLINES = [
    ['overview', 'Overview'],
    ['scripter', 'Scripting'],
    ['modeler_animator', 'Modeling & Animation'],
    ['uiux', 'UI/UX'],
  ];
  const COLS = [['Backlog', false], ['To Do', false], ['In Progress', false], ['Review', false], ['Done', true]];
  const uid = (p) => p + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  // In demo mode there's no Discord login, so we stand in as a seeded member
  // (Ava) — that makes "My tasks" and the coin ledger feel populated offline.
  const DEMO_ME = 'demo-ava-001';
  const myId = () => (window.Auth && window.Auth.getUser && (window.Auth.getUser() || {}).id) || (sb ? '' : DEMO_ME);
  const isDiscordId = (s) => /^\d{15,21}$/.test(s) || String(s).startsWith('demo');

  /* ---- Demo (localStorage) state ---- */
  function makeBoards(state, gameId) {
    DISCIPLINES.forEach(([disc, name], di) => {
      const bid = uid('b');
      state.boards.push({ id: bid, game_id: gameId, discipline: disc, name, sort: di });
      COLS.forEach(([cn, done], ci) => {
        state.columns.push({ id: uid('c'), board_id: bid, game_id: gameId, name: cn, sort: ci, is_done: done });
      });
    });
  }
  function logDemo(st, type, t, meta) {
    const u = (window.Auth && window.Auth.getUser && window.Auth.getUser()) || {};
    const me = myId();
    const mem = st.members.find(m => m.discord_id === me) || {};
    st.activity = st.activity || [];
    st.activity.unshift({
      id: uid('a'), game_id: t.game_id || null, actor_id: me,
      actor_name: u.global_name || u.username || mem.username || 'You',
      type, task_id: t.id || null, task_title: t.title || '', discipline: t.discipline || '',
      meta: meta || {}, created_at: new Date().toISOString(),
    });
    if (st.activity.length > 300) st.activity.length = 300;
  }

  function seedBoard() {
    const st = { games: [], members: [], leads: [], boards: [], columns: [], tasks: [], comments: [], activity: [], feedback: [] };
    const gid = 'demo-game-neon';
    const now = new Date().toISOString();
    st.games.push({ id: gid, name: 'Neon Heist', description: 'Co-op heist obby set in a rain-slicked synthwave city.', cover_url: '', status: 'in_dev', roblox_url: '', sort: 0, archived: false, created_at: now, created_by: 'demo' });
    makeBoards(st, gid);
    st.members.push(
      { id: uid('m'), game_id: gid, discord_id: 'demo-ava-001', username: 'avaScripts', avatar: '', discipline: 'scripter' },
      { id: uid('m'), game_id: gid, discord_id: 'demo-theo-002', username: 'theoBuilds', avatar: '', discipline: 'modeler_animator' },
    );
    const col = (disc, name) => {
      const b = st.boards.find(x => x.game_id === gid && x.discipline === disc);
      return st.columns.find(c => c.board_id === b.id && c.name === name);
    };
    let s = 1000;
    const mk = (disc, colName, t) => {
      const c = col(disc, colName);
      st.tasks.push({
        id: uid('t'), column_id: c.id, board_id: c.board_id, game_id: gid, discipline: disc,
        title: t.title, description: t.description || '', assignee_id: t.assignee_id || null,
        assignee_name: t.assignee_name || '', assignee_avatar: '', priority: t.priority || 'medium',
        due_date: t.due_date || null, labels: t.labels || [], attachment_url: t.attachment_url || '',
        points: t.points || 0, difficulty: t.difficulty || 'medium', checklist: t.checklist || [], sort: (s += 1000),
        completed_at: c.is_done ? now : null, created_at: now, created_by: 'demo', updated_at: now,
      });
    };
    mk('scripter', 'Done', { title: 'Lobby matchmaking + teleport', priority: 'high', difficulty: 'easy', points: 80, assignee_id: 'demo-ava-001', assignee_name: 'avaScripts' });
    mk('scripter', 'In Progress', { title: 'Round-based heist loop', priority: 'high', difficulty: 'hard', points: 120, assignee_id: 'demo-ava-001', assignee_name: 'avaScripts', checklist: [{ text: 'Timer + phases', done: true }, { text: 'Loot spawns', done: false }, { text: 'Escape vehicle', done: false }] });
    mk('scripter', 'To Do', { title: 'Anti-exploit pass on loot pickups', priority: 'urgent', difficulty: 'hard', points: 60 });
    mk('scripter', 'Backlog', { title: 'Daily login rewards', priority: 'low', difficulty: 'easy', points: 30 });
    mk('modeler_animator', 'Done', { title: 'Synthwave city block kit', priority: 'medium', difficulty: 'medium', points: 90, assignee_id: 'demo-theo-002', assignee_name: 'theoBuilds' });
    mk('modeler_animator', 'In Progress', { title: 'Getaway car + rig', priority: 'high', difficulty: 'hard', points: 70, assignee_id: 'demo-theo-002', assignee_name: 'theoBuilds', checklist: [{ text: 'Model', done: true }, { text: 'Rig + drive anim', done: false }] });
    mk('modeler_animator', 'To Do', { title: 'Guard NPC walk/idle/alert set', priority: 'medium', difficulty: 'medium', points: 50 });
    mk('uiux', 'Review', { title: 'Heist HUD: timer, alarm, loot meter', priority: 'high', difficulty: 'medium', points: 55, attachment_url: 'https://www.figma.com/file/example' });
    mk('uiux', 'To Do', { title: 'Results + payout screen', priority: 'medium', difficulty: 'easy', points: 40 });
    mk('overview', 'In Progress', { title: 'Milestone: Playable vertical slice', priority: 'high', points: 0, description: 'One full heist start-to-finish with HUD + payout.' });
    mk('overview', 'Backlog', { title: 'Milestone: Closed beta', priority: 'medium', points: 0 });

    // Seed a little history so analytics + feedback look alive in demo.
    const ago = (h) => new Date(Date.now() - h * 36e5).toISOString();
    st.activity = [
      { id: uid('a'), game_id: gid, actor_id: 'demo-ava-001', actor_name: 'avaScripts', type: 'approved', task_title: 'Lobby matchmaking + teleport', discipline: 'scripter', meta: { points: 80, dev: 'avaScripts' }, created_at: ago(30) },
      { id: uid('a'), game_id: gid, actor_id: 'demo-theo-002', actor_name: 'theoBuilds', type: 'approved', task_title: 'Synthwave city block kit', discipline: 'modeler_animator', meta: { points: 90, dev: 'theoBuilds' }, created_at: ago(52) },
      { id: uid('a'), game_id: gid, actor_id: 'demo-ava-001', actor_name: 'avaScripts', type: 'submitted', task_title: 'Round-based heist loop', discipline: 'scripter', meta: {}, created_at: ago(6) },
      { id: uid('a'), game_id: gid, actor_id: 'demo-ava-001', actor_name: 'avaScripts', type: 'claimed', task_title: 'Round-based heist loop', discipline: 'scripter', meta: { assignee: 'avaScripts' }, created_at: ago(70) },
      { id: uid('a'), game_id: gid, actor_id: 'demo-theo-002', actor_name: 'theoBuilds', type: 'commented', task_title: 'Getaway car + rig', discipline: 'modeler_animator', meta: {}, created_at: ago(3) },
    ];
    st.feedback = [
      { id: uid('f'), author_id: 'demo-ava-001', author_name: 'avaScripts', author_avatar: '', game_id: gid, kind: 'blocker', body: 'The anti-exploit task is blocked until the loot-pickup remote events are finalized — can we pair on the API shape?', resolved: false, created_at: ago(5) },
      { id: uid('f'), author_id: 'demo-theo-002', author_name: 'theoBuilds', author_avatar: '', game_id: gid, kind: 'idea', body: 'We could reuse the city block kit for a night-market sub-area. Cheap win for variety.', resolved: false, created_at: ago(20) },
    ];
    // demo notifications for the stand-in dev (Ava) so the bell isn't empty
    st.notifications = [
      { id: uid('n'), recipient_id: 'demo-ava-001', actor_name: 'You', type: 'approved', task_id: null, task_title: 'Lobby matchmaking + teleport', game_id: gid, discipline: 'scripter', body: 'approved your task (+◆80)', created_at: ago(30), read_at: null },
      { id: uid('n'), recipient_id: 'demo-ava-001', actor_name: 'theoBuilds', type: 'comment', task_id: null, task_title: 'Round-based heist loop', game_id: gid, discipline: 'scripter', body: 'commented on your task', created_at: ago(2), read_at: null },
    ];
    return st;
  }
  function readBoard() {
    let st = readLocal(BOARD_KEY, null);
    if (!st || !st.games) { st = seedBoard(); writeLocal(BOARD_KEY, st); }
    if (!st.activity) st.activity = [];
    if (!st.feedback) st.feedback = [];
    if (!st.notifications) st.notifications = [];
    return st;
  }
  const writeBoard = (st) => writeLocal(BOARD_KEY, st);

  const Board = {
    live: Boolean(sb),
    disciplines: DISCIPLINES,

    async myAccess() {
      if (sb) {
        const { data, error } = await sb.rpc('my_access');
        if (error || !data) return { discord_id: myId(), is_staff: false, leads: [], game_ids: [] };
        return data;
      }
      const st = readBoard();
      return { discord_id: myId() || 'demo', is_staff: true, leads: [], game_ids: st.games.map(g => g.id), memberships: st.games.map(g => ({ game_id: g.id, discipline: 'all' })) };
    },

    async listGames() {
      if (sb) {
        const { data, error } = await sb.rpc('games_overview');
        if (error) throw error;
        return data || [];
      }
      const st = readBoard();
      const doneCols = new Set(st.columns.filter(c => c.is_done).map(c => c.id));
      return st.games.filter(g => !g.archived).map(g => {
        const ts = st.tasks.filter(t => t.game_id === g.id);
        const done = ts.filter(t => doneCols.has(t.column_id));
        return {
          ...g, total: ts.length, done: done.length,
          total_points: ts.reduce((a, t) => a + (t.points || 0), 0),
          done_points: done.reduce((a, t) => a + (t.points || 0), 0),
        };
      }).sort((a, b) => a.sort - b.sort);
    },

    async createGame(g) {
      const rec = {
        name: g.name, description: g.description || '', cover_url: g.cover_url || '',
        status: g.status || 'planning', roblox_url: g.roblox_url || '', sort: g.sort || 0, created_by: myId(),
      };
      if (sb) {
        const { data, error } = await sb.from('games').insert(rec).select().single();
        if (error) throw error;
        return data;
      }
      const st = readBoard();
      const gid = uid('g');
      st.games.push({ id: gid, ...rec, archived: false, created_at: new Date().toISOString() });
      makeBoards(st, gid);
      writeBoard(st);
      return st.games.find(x => x.id === gid);
    },

    async updateGame(id, patch) {
      if (sb) { const { error } = await sb.from('games').update(patch).eq('id', id); if (error) throw error; return; }
      const st = readBoard(); const g = st.games.find(x => x.id === id); if (g) Object.assign(g, patch); writeBoard(st);
    },
    archiveGame(id) { return this.updateGame(id, { archived: true }); },

    async getBoards(gameId) {
      if (sb) { const { data, error } = await sb.from('boards').select('*').eq('game_id', gameId).order('sort'); if (error) throw error; return data || []; }
      return readBoard().boards.filter(b => b.game_id === gameId).sort((a, b) => a.sort - b.sort);
    },
    async getColumns(gameId) {
      if (sb) { const { data, error } = await sb.from('board_columns').select('*').eq('game_id', gameId).order('sort'); if (error) throw error; return data || []; }
      return readBoard().columns.filter(c => c.game_id === gameId).sort((a, b) => a.sort - b.sort);
    },
    async listTasks(gameId) {
      if (sb) { const { data, error } = await sb.from('tasks').select('*').eq('game_id', gameId).order('sort'); if (error) throw error; return data || []; }
      return readBoard().tasks.filter(t => t.game_id === gameId).sort((a, b) => a.sort - b.sort);
    },

    async getMembers(gameId) {
      if (sb) { const { data, error } = await sb.from('game_members').select('*').eq('game_id', gameId).order('added_at'); if (error) throw error; return data || []; }
      return readBoard().members.filter(m => m.game_id === gameId);
    },
    async addMember(gameId, m) {
      const rec = { game_id: gameId, discord_id: String(m.discord_id || '').trim(), username: (m.username || '').trim(), avatar: m.avatar || '', discipline: m.discipline || 'all', added_by: myId() };
      if (!isDiscordId(rec.discord_id)) return { error: 'That doesn’t look like a Discord ID — it should be a ~18-digit number.' };
      if (sb) { const { error } = await sb.from('game_members').upsert(rec, { onConflict: 'game_id,discord_id' }); if (error) return { error: error.message }; return { ok: true }; }
      const st = readBoard();
      if (!st.members.some(x => x.game_id === gameId && x.discord_id === rec.discord_id)) st.members.push({ id: uid('m'), ...rec });
      writeBoard(st); return { ok: true };
    },
    async removeMember(gameId, discordId) {
      if (sb) { await sb.from('game_members').delete().eq('game_id', gameId).eq('discord_id', discordId); return; }
      const st = readBoard(); st.members = st.members.filter(m => !(m.game_id === gameId && m.discord_id === discordId)); writeBoard(st);
    },

    async listLeads() {
      if (sb) { const { data, error } = await sb.from('leads').select('*'); if (error) throw error; return data || []; }
      return readBoard().leads;
    },
    async setLead(discordId, discipline, username) {
      const rec = { discord_id: String(discordId || '').trim(), discipline, username: (username || '').trim(), added_by: myId() };
      if (!isDiscordId(rec.discord_id)) return { error: 'That doesn’t look like a Discord ID.' };
      if (sb) { const { error } = await sb.from('leads').upsert(rec, { onConflict: 'discord_id,discipline' }); if (error) return { error: error.message }; return { ok: true }; }
      const st = readBoard();
      if (!st.leads.some(l => l.discord_id === rec.discord_id && l.discipline === discipline)) st.leads.push(rec);
      writeBoard(st); return { ok: true };
    },
    async removeLead(discordId, discipline) {
      if (sb) { await sb.from('leads').delete().eq('discord_id', discordId).eq('discipline', discipline); return; }
      const st = readBoard(); st.leads = st.leads.filter(l => !(l.discord_id === discordId && l.discipline === discipline)); writeBoard(st);
    },

    async createTask(t) {
      const rec = {
        column_id: t.column_id, board_id: t.board_id, game_id: t.game_id, discipline: t.discipline,
        title: t.title, description: t.description || '', assignee_id: t.assignee_id || null,
        assignee_name: t.assignee_name || '', assignee_avatar: t.assignee_avatar || '', priority: t.priority || 'medium',
        difficulty: t.difficulty || 'medium',
        due_date: t.due_date || null, labels: t.labels || [], attachment_url: t.attachment_url || '',
        points: t.points || 0, checklist: t.checklist || [], sort: t.sort != null ? t.sort : 1000, created_by: myId(),
      };
      if (sb) { const { data, error } = await sb.from('tasks').insert(rec).select().single(); if (error) throw error; return data; }
      const st = readBoard();
      const row = { id: uid('t'), ...rec, submitted_at: null, approved_at: null, approved_by: null, approved_by_name: '', completed_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      st.tasks.push(row); logDemo(st, 'created', row); writeBoard(st); return row;
    },
    async updateTask(id, patch) {
      const p = { ...patch, updated_at: new Date().toISOString() };
      if (sb) { const { data, error } = await sb.from('tasks').update(p).eq('id', id).select().single(); if (error) throw error; return data; }
      const st = readBoard(); const t = st.tasks.find(x => x.id === id); if (t) Object.assign(t, p); writeBoard(st); return t;
    },
    async moveTask(id, columnId, sort, isDone) {
      const p = { column_id: columnId, sort, completed_at: isDone ? new Date().toISOString() : null, updated_at: new Date().toISOString() };
      if (sb) { const { error } = await sb.from('tasks').update(p).eq('id', id); if (error) throw error; return; }
      const st = readBoard(); const t = st.tasks.find(x => x.id === id);
      if (t) {
        const wasDone = !!t.completed_at;
        const col = st.columns.find(c => c.id === columnId) || {};
        const u = (window.Auth && window.Auth.getUser && window.Auth.getUser()) || {};
        if (isDone) { p.approved_at = new Date().toISOString(); p.approved_by = myId(); p.approved_by_name = u.global_name || u.username || 'You'; }
        else if (wasDone) { p.approved_at = null; p.approved_by = null; p.approved_by_name = ''; }
        if (col.name && col.name.toLowerCase() === 'review') p.submitted_at = new Date().toISOString();
        Object.assign(t, p);
        if (isDone && !wasDone) logDemo(st, 'approved', t, { points: t.points, dev: t.assignee_name });
        else if (col.name && col.name.toLowerCase() === 'review') logDemo(st, 'submitted', t);
      }
      writeBoard(st);
    },
    async deleteTask(id) {
      if (sb) { await sb.from('tasks').delete().eq('id', id); return; }
      const st = readBoard(); st.tasks = st.tasks.filter(t => t.id !== id); st.comments = st.comments.filter(c => c.task_id !== id); writeBoard(st);
    },

    /* ---- Self-claim a task, enforcing per-difficulty limits ---- */
    async claimTask(taskId) {
      if (sb) {
        const { data, error } = await sb.rpc('claim_task', { p_task: taskId });
        if (error) return { ok: false, reason: 'error', message: error.message };
        return data;
      }
      const st = readBoard(); const me = myId();
      const t = st.tasks.find(x => x.id === taskId);
      if (!t) return { ok: false, reason: 'not_found' };
      if (t.assignee_id && t.assignee_id !== me) return { ok: false, reason: 'already_claimed', by: t.assignee_name };
      const diff = t.difficulty || 'medium';
      const caps = CFG.claimLimits || { easy: 3, medium: 2, hard: 1 };
      const cap = caps[diff] != null ? caps[diff] : 2;
      const doneCols = new Set(st.columns.filter(c => c.is_done).map(c => c.id));
      const current = st.tasks.filter(x => x.assignee_id === me && (x.difficulty || 'medium') === diff && !doneCols.has(x.column_id) && x.id !== taskId).length;
      if (current >= cap) return { ok: false, reason: 'limit', difficulty: diff, cap, current };
      const u = (window.Auth && window.Auth.getUser && window.Auth.getUser()) || {};
      const mem = st.members.find(m => m.discord_id === me) || {};
      t.assignee_id = me;
      t.assignee_name = u.global_name || u.username || mem.username || 'You';
      t.assignee_avatar = u.avatar || '';
      // claim auto-moves the card to In Progress
      const ip = st.columns.find(c => c.board_id === t.board_id && c.name.toLowerCase() === 'in progress');
      if (ip) { t.column_id = ip.id; t.completed_at = null; }
      logDemo(st, 'claimed', t, { assignee: t.assignee_name });
      writeBoard(st);
      return { ok: true, moved: Boolean(ip) };
    },

    async listComments(taskId) {
      if (sb) { const { data, error } = await sb.from('task_comments').select('*').eq('task_id', taskId).order('created_at'); if (error) throw error; return data || []; }
      return readBoard().comments.filter(c => c.task_id === taskId).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    },
    async addComment(taskId, body) {
      const u = (window.Auth && window.Auth.getUser && window.Auth.getUser()) || {};
      const rec = { task_id: taskId, author_id: u.id || 'demo', author_name: u.global_name || u.username || 'member', author_avatar: u.avatar || '', body };
      if (sb) { const { data, error } = await sb.from('task_comments').insert(rec).select().single(); if (error) throw error; return data; }
      const st = readBoard(); const row = { id: uid('tc'), ...rec, created_at: new Date().toISOString() }; st.comments.push(row);
      const t = st.tasks.find(x => x.id === taskId) || {}; logDemo(st, 'commented', { game_id: t.game_id, id: taskId, title: t.title, discipline: t.discipline });
      writeBoard(st); return row;
    },

    /* ---- Coins ledger: who's earned what (drives rev-share) ---- */
    async coinLedger() {
      if (sb) { const { data, error } = await sb.rpc('coin_ledger'); if (error) throw error; return data || []; }
      const st = readBoard();
      const doneCols = new Set(st.columns.filter(c => c.is_done).map(c => c.id));
      const map = {};
      st.tasks.filter(t => t.assignee_id).forEach(t => {
        const m = map[t.assignee_id] || (map[t.assignee_id] = { discord_id: t.assignee_id, username: t.assignee_name, avatar: t.assignee_avatar || '', earned: 0, pending: 0, tasks_done: 0, tasks_open: 0 });
        if (doneCols.has(t.column_id)) { m.earned += t.points || 0; m.tasks_done++; }
        else { m.pending += t.points || 0; m.tasks_open++; }
      });
      return Object.values(map).sort((a, b) => b.earned - a.earned || b.pending - a.pending);
    },

    /* ---- Everything assigned to me, across all games ---- */
    async myTasks() {
      if (sb) { const { data, error } = await sb.rpc('my_tasks'); if (error) throw error; return data || []; }
      const me = myId(); const st = readBoard();
      return st.tasks.filter(t => t.assignee_id === me).map(t => {
        const c = st.columns.find(x => x.id === t.column_id) || {};
        return { ...t, col_name: c.name || '', is_done: !!c.is_done, is_review: (c.name || '').toLowerCase() === 'review' };
      }).sort((a, b) => (a.is_done - b.is_done) || (new Date(a.due_date || '2999') - new Date(b.due_date || '2999')));
    },

    /* ---- Submit one of my tasks for review (moves it to its Review column) ---- */
    async submitForReview(taskId) {
      if (sb) {
        const { data: t, error: e1 } = await sb.from('tasks').select('board_id').eq('id', taskId).single();
        if (e1) return { error: e1.message };
        const { data: c } = await sb.from('board_columns').select('id').eq('board_id', t.board_id).ilike('name', 'review').maybeSingle();
        if (!c) return { error: 'No review column.' };
        const { error } = await sb.from('tasks').update({ column_id: c.id, submitted_at: new Date().toISOString() }).eq('id', taskId);
        if (error) return { error: error.message };
        return { ok: true };
      }
      const st = readBoard(); const t = st.tasks.find(x => x.id === taskId);
      if (!t) return { error: 'Not found.' };
      const c = st.columns.find(x => x.board_id === t.board_id && x.name.toLowerCase() === 'review');
      if (!c) return { error: 'No review column.' };
      t.column_id = c.id; t.submitted_at = new Date().toISOString(); logDemo(st, 'submitted', t); writeBoard(st);
      return { ok: true };
    },

    /* ---- Notifications (things a dev should know about) ---- */
    async myNotifications(limit) {
      if (sb) { const { data, error } = await sb.rpc('my_notifications', { p_limit: limit || 40 }); if (error) throw error; return data || []; }
      return readBoard().notifications.filter(n => n.recipient_id === myId()).slice(0, limit || 40);
    },
    async markNotificationsRead() {
      if (sb) { await sb.rpc('mark_notifications_read'); return; }
      const st = readBoard(); const me = myId();
      st.notifications.forEach(n => { if (n.recipient_id === me && !n.read_at) n.read_at = new Date().toISOString(); });
      writeBoard(st);
    },

    /* ---- Tasks a developer can grab right now (their discipline, unclaimed) ---- */
    async availableToClaim() {
      if (sb) { const { data, error } = await sb.rpc('available_to_claim'); if (error) throw error; return data || []; }
      const st = readBoard();
      const doneCols = new Set(st.columns.filter(c => c.is_done).map(c => c.id));
      const order = { urgent: 0, high: 1, medium: 2, low: 3 };
      return st.tasks
        .filter(t => !t.assignee_id && t.discipline !== 'overview' && !doneCols.has(t.column_id))
        .sort((a, b) => (order[a.priority] ?? 3) - (order[b.priority] ?? 3) || (b.points || 0) - (a.points || 0));
    },

    /* ---- Owner/lead analytics: per-developer work stats (discipline-scoped) ---- */
    async devAnalytics(discipline) {
      if (sb) { const { data, error } = await sb.rpc('dev_analytics', { p_discipline: discipline || null }); if (error) throw error; return data || []; }
      const st = readBoard();
      const doneCols = new Set(st.columns.filter(c => c.is_done).map(c => c.id));
      const map = {};
      st.tasks.filter(t => t.assignee_id && (!discipline || t.discipline === discipline)).forEach(t => {
        const m = map[t.assignee_id] || (map[t.assignee_id] = { discord_id: t.assignee_id, username: t.assignee_name, tasks_done: 0, tasks_open: 0, points: 0, pending_points: 0 });
        if (doneCols.has(t.column_id)) { m.tasks_done++; m.points += t.points || 0; }
        else { m.tasks_open++; m.pending_points += t.points || 0; }
        if (t.assignee_name) m.username = t.assignee_name;
      });
      const now = Date.now();
      Object.values(map).forEach(m => {
        const acts = st.activity.filter(a => a.actor_id === m.discord_id);
        m.last_active = acts.length ? acts[0].created_at : null;
        m.actions_7d = acts.filter(a => now - new Date(a.created_at) < 7 * 864e5).length;
        m.actions_30d = acts.filter(a => now - new Date(a.created_at) < 30 * 864e5).length;
        m.comments = st.comments.filter(c => c.author_id === m.discord_id).length;
      });
      return Object.values(map).sort((a, b) => b.points - a.points || b.tasks_done - a.tasks_done);
    },

    /* ---- Activity feed: who did what, lately (discipline-scoped) ---- */
    async activityFeed(limit, discipline) {
      if (sb) { const { data, error } = await sb.rpc('activity_feed', { p_limit: limit || 80, p_discipline: discipline || null }); if (error) throw error; return data || []; }
      return readBoard().activity.filter(a => !discipline || a.discipline === discipline).slice(0, limit || 80);
    },

    /* ---- Dev feedback ---- */
    async submitFeedback({ kind, body, game_id }) {
      const u = (window.Auth && window.Auth.getUser && window.Auth.getUser()) || {};
      const okKind = ['note', 'idea', 'issue', 'blocker'].includes(kind) ? kind : 'note';
      const rec = { author_id: myId(), author_name: u.global_name || u.username || 'You', author_avatar: u.avatar || '', game_id: game_id || null, kind: okKind, body: String(body || '').slice(0, 2000) };
      if (sb) { const { error } = await sb.from('feedback').insert(rec); if (error) return { error: error.message }; return { ok: true }; }
      const st = readBoard(); st.feedback.unshift({ id: uid('f'), ...rec, resolved: false, created_at: new Date().toISOString() }); writeBoard(st);
      return { ok: true };
    },
    async listFeedback() {
      if (sb) { const { data, error } = await sb.from('feedback').select('*').order('created_at', { ascending: false }); if (error) throw error; return data || []; }
      return readBoard().feedback.slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    },
    async resolveFeedback(id, resolved) {
      if (sb) { await sb.from('feedback').update({ resolved }).eq('id', id); return; }
      const st = readBoard(); const f = st.feedback.find(x => x.id === id); if (f) f.resolved = resolved; writeBoard(st);
    },

    /* ---- Discord notifications (best-effort; dormant until configured) ---- */
    async notifyTask(kind, t, gameName) {
      const by = (window.Auth && window.Auth.getUser && window.Auth.getUser()) || {};
      const byName = by.global_name || by.username || 'Someone';
      const g = gameName ? ` · ${gameName}` : '';
      if (kind === 'assign') {
        notifyDiscord(`📌 **${byName}** assigned **${t.title}** to **${t.assignee_name || 'a developer'}**${g}`);
        if (sb && t.assignee_id && !String(t.assignee_id).startsWith('demo')) {
          try {
            await sb.functions.invoke('notify-task', {
              body: {
                discord_id: t.assignee_id, title: t.title, game: gameName || '',
                by_name: byName, by_avatar: by.avatar || '',
                url: location.origin + location.pathname.replace(/[^/]*$/, 'board.html'),
              },
            });
          } catch (e) { /* DM is best-effort */ }
        }
      } else if (kind === 'review') {
        notifyDiscord(`🔎 **Ready for review** — ${t.title}${g}${t.assignee_name ? ` (by ${t.assignee_name})` : ''}`);
      } else if (kind === 'done') {
        notifyDiscord(`✅ **Done** — ${t.title}${g}${t.assignee_name ? ` (${t.assignee_name})` : ''}`);
      }
    },

    realtime(gameId, onChange) {
      if (!sb) return null;
      const ch = sb.channel('board-' + gameId)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks', filter: 'game_id=eq.' + gameId }, onChange)
        .subscribe();
      return ch;
    },
  };

  window.Board = Board;
})();
