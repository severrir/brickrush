// =========================================================================
// BRICK RUSH — notify-task  (Supabase Edge Function)
// DMs a developer when they're assigned a Studio Board task, using the
// Discord bot. Any signed-in team member can call it (best-effort).
//
// Secrets (Supabase → Edge Functions → Secrets):
//   DISCORD_BOT_TOKEN – your bot token (already set for notify-applicant)
// =========================================================================

const BOT_TOKEN = (Deno.env.get("DISCORD_BOT_TOKEN") ?? Deno.env.get("DISCORD_BOT_TOKEN,") ?? "").trim();
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    // Caller must be a signed-in user (prevents anonymous DM spam).
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const ures = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: ANON },
    });
    if (!ures.ok) return json({ ok: false, reason: "unauthorized" });

    const { discord_id, title, game, by_name, by_avatar, url } = await req.json();
    if (!discord_id) return json({ ok: false, reason: "missing_discord_id" });
    if (!BOT_TOKEN) return json({ ok: false, reason: "no_bot_token_secret" });
    if (String(discord_id).startsWith("demo")) return json({ ok: true, reason: "demo_noop" });

    // Open a DM channel with the assignee.
    const dmRes = await fetch("https://discord.com/api/v10/users/@me/channels", {
      method: "POST",
      headers: { Authorization: `Bot ${BOT_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ recipient_id: String(discord_id) }),
    });
    if (!dmRes.ok) return json({ ok: false, reason: "cannot_open_dm", detail: await dmRes.text() });
    const dm = await dmRes.json();

    const embed: Record<string, unknown> = {
      title: "📌 New task assigned to you",
      description: `**${title ?? "A task"}**${game ? `\nGame: **${game}**` : ""}\n\nOpen the Studio board to get started.`,
      color: 0x7c5cff,
      footer: { text: "BRICK RUSH — Studio" },
    };
    if (url) embed.url = url;
    if (by_name) embed.author = { name: `Assigned by ${by_name}`, icon_url: by_avatar || undefined };

    const msgRes = await fetch(`https://discord.com/api/v10/channels/${dm.id}/messages`, {
      method: "POST",
      headers: { Authorization: `Bot ${BOT_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ embeds: [embed] }),
    });
    return json({ ok: msgRes.ok, reason: msgRes.ok ? "sent" : await msgRes.text() });
  } catch (e) {
    return json({ error: String(e) });
  }
});
