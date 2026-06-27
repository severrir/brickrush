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
        const { data, error } = await sb.from('applications').insert(insert).select().single();
        if (error) throw error;
        await this._pingNew(data || record);
        return data || record;
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
      if (sb) { await sb.from('role_demand').upsert({ role, level }); return; }
      const d = readLocal(DEMAND_KEY, DEFAULT_DEMAND);
      d[role] = level; writeLocal(DEMAND_KEY, d);
    },

    async findByDiscordId(discordId) {
      if (!discordId) return null;
      const all = await this.listApplications();
      return all.find(a => a.discord_id === discordId) || null;
    },
  };

  window.Store = Store;
})();
