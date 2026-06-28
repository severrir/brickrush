// =========================================================================
// BRICK RUSH — roblox-info  (Supabase Edge Function)
// Proxies public Roblox data (avatar, account age, created games) for an
// applicant's username. Roblox blocks browser CORS; this bridges it.
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
    const { username } = await req.json();
    if (!username) return j({ error: "no_username" });

    // username -> user
    const ur = await fetch("https://users.roblox.com/v1/usernames/users", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usernames: [username], excludeBannedUsers: false }),
    });
    const ud = await ur.json();
    const user = ud?.data?.[0];
    if (!user) return j({ found: false });
    const id = user.id;

    const [pr, ar, gr] = await Promise.allSettled([
      fetch(`https://users.roblox.com/v1/users/${id}`),
      fetch(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${id}&size=150x150&format=Png&isCircular=false`),
      fetch(`https://games.roblox.com/v2/users/${id}/games?accessFilter=Public&limit=8&sortOrder=Desc`),
    ]);
    const pd = pr.status === "fulfilled" ? await pr.value.json() : {};
    const ad = ar.status === "fulfilled" ? await ar.value.json() : {};
    const gd = gr.status === "fulfilled" ? await gr.value.json() : {};

    return j({
      found: true,
      id, name: user.name, displayName: user.displayName,
      created: pd?.created ?? null,
      avatar: ad?.data?.[0]?.imageUrl ?? null,
      games: (gd?.data ?? []).map((g: Record<string, unknown>) => ({ name: g.name, id: g.id, visits: g.placeVisits })),
    });
  } catch (e) {
    return j({ error: String(e) });
  }
});
