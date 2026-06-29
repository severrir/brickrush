// =========================================================================
// BRICK RUSH — verify-roblox-group  (Supabase Edge Function)
// Resolves a Roblox username -> userId and checks whether that user is a
// member of the studio's Roblox group. Roblox blocks browser CORS; this
// bridges it server-side. Returns { found, member, role }.
// =========================================================================
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const j = (o: unknown) => new Response(JSON.stringify(o), { headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { username, groupId } = await req.json();
    if (!username) return j({ error: "no_username" });
    const gid = String(groupId || "");
    if (!gid) return j({ error: "no_group" });

    // username -> user id
    const ur = await fetch("https://users.roblox.com/v1/usernames/users", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usernames: [username], excludeBannedUsers: false }),
    });
    const ud = await ur.json();
    const user = ud?.data?.[0];
    if (!user) return j({ found: false, member: false });
    const id = user.id;

    // group memberships
    const gr = await fetch(`https://groups.roblox.com/v1/users/${id}/groups/roles`);
    const gd = await gr.json();
    const groups: Array<Record<string, any>> = gd?.data ?? [];
    const hit = groups.find((g) => String(g?.group?.id) === gid);

    return j({
      found: true,
      member: Boolean(hit),
      id,
      name: user.name,
      role: hit?.role?.name ?? null,
    });
  } catch (e) {
    // fail-open marker so the client can decide; never hard-block on our error
    return j({ error: String(e) });
  }
});
