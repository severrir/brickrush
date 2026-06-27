// =========================================================================
// BRICK RUSH — notify-applicant  (Supabase Edge Function)
// DMs an applicant their decision (accepted / rejected / banned) + your
// message, using a Discord bot. Only the owner can call it.
//
// Secrets it needs (set in Supabase → Edge Functions → Secrets):
//   DISCORD_BOT_TOKEN   – your bot token
// (SUPABASE_URL and SUPABASE_ANON_KEY are provided by Supabase automatically.)
// =========================================================================

// tolerate a stray trailing comma in the secret name (a common paste mistake)
const BOT_TOKEN = (Deno.env.get("DISCORD_BOT_TOKEN") ?? Deno.env.get("DISCORD_BOT_TOKEN,") ?? "").trim();
const OWNER_ID = "903304467531845644"; // your Discord id
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
    // 1) Verify the caller is the owner (their Discord id must match).
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const ures = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: ANON },
    });
    if (!ures.ok) return json({ ok: false, reason: "unauthorized_token" });
    const user = await ures.json();
    const callerId = user?.user_metadata?.provider_id ?? user?.user_metadata?.sub ?? user?.identities?.[0]?.id;
    if (String(callerId) !== OWNER_ID) return json({ ok: false, reason: "not_owner", detected_id: String(callerId), expected: OWNER_ID });

    // 2) Read the request.
    const { discord_id, status, message, full_name } = await req.json();
    if (!discord_id) return json({ ok: false, reason: "missing_discord_id" });
    if (!BOT_TOKEN) return json({ ok: false, reason: "no_bot_token_secret" });

    // 3) Open a DM channel with the applicant.
    const dmRes = await fetch("https://discord.com/api/v10/users/@me/channels", {
      method: "POST",
      headers: { Authorization: `Bot ${BOT_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ recipient_id: String(discord_id) }),
    });
    if (!dmRes.ok) return json({ ok: false, reason: "cannot_open_dm", detail: await dmRes.text() });
    const dm = await dmRes.json();

    // 4) Compose and send the message.
    const TITLES: Record<string, string> = {
      accepted: "🎉 You've been accepted to BRICK RUSH!",
      rejected: "Update on your BRICK RUSH application",
      banned: "Your BRICK RUSH application",
    };
    const BASE: Record<string, string> = {
      accepted: `Welcome aboard${full_name ? ", " + full_name : ""}! We loved your application. Next step: we'll set up your interview here on Discord.`,
      rejected: "Thanks for applying. We're not moving forward right now — but you can sharpen your portfolio and apply again anytime.",
      banned: "Your access to BRICK RUSH applications has been closed.",
    };
    const COLORS: Record<string, number> = { accepted: 0x36e2a0, rejected: 0xff4d6d, banned: 0xff4d6d };

    const embed = {
      title: TITLES[status] ?? "BRICK RUSH",
      description: (BASE[status] ?? "") + (message ? `\n\n**A message from the team:**\n${message}` : ""),
      color: COLORS[status] ?? 0x7c5cff,
      footer: { text: "BRICK RUSH" },
    };
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
