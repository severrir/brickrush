// =========================================================================
// BRICK RUSH — push-notify  (Supabase Edge Function)
// Called by a DB trigger on every new application. Sends a web-push to every
// stored admin/owner subscription. Protected by an internal secret header.
//
// Secrets: PUSH_INTERNAL_SECRET, VAPID_PUBLIC, VAPID_PRIVATE, VAPID_SUBJECT
// (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are provided automatically.)
// =========================================================================
import webpush from "npm:web-push@3.6.7";

const SECRET = Deno.env.get("PUSH_INTERNAL_SECRET") ?? "";
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC") ?? "";
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE") ?? "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:team@brickrush.gg";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

const ROLE: Record<string, string> = {
  scripter: "Scripter", modeler_animator: "Modeler & Animator", uiux: "UI/UX Designer",
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");
  if ((req.headers.get("x-internal-secret") ?? "") !== SECRET) {
    return new Response(JSON.stringify({ error: "forbidden" }), { status: 403 });
  }
  const { full_name, role } = await req.json().catch(() => ({}));
  const payload = JSON.stringify({
    title: "✳ New application",
    body: `${full_name || "Someone"} — ${ROLE[role] ?? role ?? ""}`,
    url: "admin.html",
  });

  // read every subscription (service role bypasses RLS)
  const res = await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?select=endpoint,subscription`, {
    headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` },
  });
  const subs = (await res.json()) as Array<{ endpoint: string; subscription: unknown }>;

  let sent = 0;
  await Promise.all((subs || []).map(async (row) => {
    try { await webpush.sendNotification(row.subscription, payload); sent++; }
    catch (e) {
      const code = (e && (e as { statusCode?: number }).statusCode) || 0;
      if (code === 404 || code === 410) {
        // subscription is dead — clean it up
        await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(row.endpoint)}`, {
          method: "DELETE", headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` },
        });
      }
    }
  }));

  return new Response(JSON.stringify({ ok: true, sent }), { headers: { "Content-Type": "application/json" } });
});
