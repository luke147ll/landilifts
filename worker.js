// Landi Lifts — Worker: tiny sync API over D1, else serve the static site.
// GET  /api/state?user=<walt|luke>  -> { data: "<json string>", updated_at }
// PUT  /api/state  { user, data }    -> upsert the user's whole log blob
const USERS = ["walt", "luke"];
const MAX_BYTES = 1_000_000; // 1 MB cap on a user's blob
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/state") {
      try {
        if (request.method === "GET") {
          const user = url.searchParams.get("user");
          if (!USERS.includes(user)) return json({ error: "bad user" }, 400);
          const row = await env.DB.prepare("SELECT data, updated_at FROM state WHERE user = ?")
            .bind(user).first();
          return json({ data: row ? row.data : "{}", updated_at: row ? row.updated_at : 0 });
        }
        if (request.method === "PUT") {
          const body = await request.json().catch(() => null);
          if (!body || !USERS.includes(body.user) || typeof body.data !== "string")
            return json({ error: "bad request" }, 400);
          if (body.data.length > MAX_BYTES) return json({ error: "too large" }, 413);
          try { JSON.parse(body.data); } catch { return json({ error: "data not json" }, 400); }
          const now = Date.now();
          await env.DB.prepare(
            "INSERT INTO state (user, data, updated_at) VALUES (?1, ?2, ?3) " +
            "ON CONFLICT(user) DO UPDATE SET data = ?2, updated_at = ?3"
          ).bind(body.user, body.data, now).run();
          return json({ ok: true, updated_at: now });
        }
        return json({ error: "method not allowed" }, 405);
      } catch (e) {
        return json({ error: "server error", detail: String(e && e.message || e) }, 500);
      }
    }
    // everything else -> static assets
    return env.ASSETS.fetch(request);
  },
};
