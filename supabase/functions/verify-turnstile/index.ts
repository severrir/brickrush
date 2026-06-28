// =========================================================================
// BRICK RUSH — verify-turnstile  (Supabase Edge Function)
// Verifies a Cloudflare Turnstile token server-side before an application is
// allowed through. Secret: TURNSTILE_SECRET.
// =========================================================================
const SECRET = Deno.env.get("TURNSTILE_SECRET") ?? "";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const j = (o: unknown) => new Response(JSON.stringify(o), { headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    if (!SECRET) return j({ ok: true, skipped: true }); // not configured → don't block
    const { token } = await req.json();
    if (!token) return j({ ok: false, reason: "no_token" });
    const form = new URLSearchParams({ secret: SECRET, response: token });
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form,
    });
    const data = await res.json();
    return j({ ok: Boolean(data.success), reason: data["error-codes"] });
  } catch (e) {
    return j({ ok: false, reason: String(e) });
  }
});
