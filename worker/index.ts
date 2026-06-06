/**
 * Stellar Charters Worker: serves the SPA (via ASSETS for non-/api paths) and the API:
 *   auth  — /api/auth/register|login|logout|me|providers|discord[/callback]
 *   game  — /api/game (ensure/resume), /api/game/new, /api/game/:id/orders  (see game.ts)
 *
 * Passwords are PBKDF2-SHA256; sessions are opaque cookie tokens (only their SHA-256 is
 * stored). The match itself is now server-authoritative (game.ts) — the client is a view.
 */
import { handleGame } from "./game.js";
import {
  b64url,
  clearCookie,
  createSession,
  currentUser,
  getCookie,
  hashPassword,
  json,
  readJson,
  serializeCookie,
  sha256hex,
  verifyPassword,
  SESSION_COOKIE,
  type Env,
  type SessionUser,
} from "./session.js";

const STATE_COOKIE = "sc_oauth_state";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    try {
      if (url.pathname.startsWith("/api/game")) return await handleGame(request, env, url);
      return await routeAuth(request, env, url);
    } catch (err) {
      console.error("api error", err);
      return json({ error: "internal_error" }, 500);
    }
  },
};

async function routeAuth(request: Request, env: Env, url: URL): Promise<Response> {
  const p = url.pathname;
  const m = request.method;
  if (p === "/api/auth/register" && m === "POST") return register(request, env, url);
  if (p === "/api/auth/login" && m === "POST") return login(request, env, url);
  if (p === "/api/auth/logout" && m === "POST") return logout(request, env, url);
  if (p === "/api/auth/me" && m === "GET") return me(request, env);
  if (p === "/api/auth/providers" && m === "GET") return providers(env);
  if (p === "/api/auth/discord" && m === "GET") return discordStart(env, url);
  if (p === "/api/auth/discord/callback" && m === "GET") return discordCallback(request, env, url);
  return json({ error: "not_found" }, 404);
}

// ----- local username/password -----

async function register(request: Request, env: Env, url: URL): Promise<Response> {
  const body = await readJson(request);
  const username = String(body?.username ?? "").trim();
  const password = String(body?.password ?? "");
  const err = validateCredentials(username, password);
  if (err) return json({ error: err }, 400);

  const handle = username.toLowerCase();
  const existing = await env.DB.prepare("SELECT id FROM users WHERE username = ?").bind(handle).first();
  if (existing) return json({ error: "username_taken" }, 409);

  const id = crypto.randomUUID();
  const pwHash = await hashPassword(password);
  await env.DB.prepare(
    "INSERT INTO users (id, username, display_name, pw_hash, created_ts) VALUES (?, ?, ?, ?, ?)",
  ).bind(id, handle, username, pwHash, Date.now()).run();

  return sessionResponse(env, url, id, { id, username, avatar: null });
}

async function login(request: Request, env: Env, url: URL): Promise<Response> {
  const body = await readJson(request);
  const username = String(body?.username ?? "").trim().toLowerCase();
  const password = String(body?.password ?? "");
  if (!username || !password) return json({ error: "missing_credentials" }, 400);

  const row = await env.DB.prepare(
    "SELECT id, display_name, pw_hash, avatar FROM users WHERE username = ?",
  ).bind(username).first<{ id: string; display_name: string; pw_hash: string | null; avatar: string | null }>();

  if (!row || !row.pw_hash || !(await verifyPassword(password, row.pw_hash))) {
    return json({ error: "invalid_credentials" }, 401);
  }
  return sessionResponse(env, url, row.id, { id: row.id, username: row.display_name, avatar: row.avatar });
}

async function logout(request: Request, env: Env, url: URL): Promise<Response> {
  const token = getCookie(request, SESSION_COOKIE);
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256hex(token)).run();
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "content-type": "application/json", "set-cookie": clearCookie(SESSION_COOKIE, url) },
  });
}

async function me(request: Request, env: Env): Promise<Response> {
  const user = await currentUser(request, env);
  if (!user) return json({ error: "unauthenticated" }, 401);
  return json({ user });
}

function providers(env: Env): Response {
  return json({ password: true, discord: !!(env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET) });
}

// ----- Discord OAuth2 -----

function discordStart(env: Env, url: URL): Response {
  if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET) return json({ error: "discord_not_configured" }, 404);
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const authorize = new URL("https://discord.com/api/oauth2/authorize");
  authorize.searchParams.set("client_id", env.DISCORD_CLIENT_ID);
  authorize.searchParams.set("redirect_uri", `${url.origin}/api/auth/discord/callback`);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("scope", "identify");
  authorize.searchParams.set("state", state);
  return new Response(null, {
    status: 302,
    headers: { location: authorize.toString(), "set-cookie": serializeCookie(STATE_COOKIE, state, url, 600) },
  });
}

async function discordCallback(request: Request, env: Env, url: URL): Promise<Response> {
  if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET) return json({ error: "discord_not_configured" }, 404);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expected = getCookie(request, STATE_COOKIE);
  if (!code || !state || !expected || state !== expected) {
    return Response.redirect(`${url.origin}/?auth_error=discord_state`, 302);
  }

  const redirectUri = `${url.origin}/api/auth/discord/callback`;
  const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.DISCORD_CLIENT_ID,
      client_secret: env.DISCORD_CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  });
  if (!tokenRes.ok) return Response.redirect(`${url.origin}/?auth_error=discord_token`, 302);
  const token = (await tokenRes.json()) as { access_token: string };

  const profRes = await fetch("https://discord.com/api/users/@me", {
    headers: { authorization: `Bearer ${token.access_token}` },
  });
  if (!profRes.ok) return Response.redirect(`${url.origin}/?auth_error=discord_profile`, 302);
  const prof = (await profRes.json()) as { id: string; username: string; global_name?: string | null; avatar?: string | null };

  const avatar = prof.avatar ? `https://cdn.discordapp.com/avatars/${prof.id}/${prof.avatar}.png` : null;
  const display = prof.global_name || prof.username;

  let userId: string;
  const existing = await env.DB.prepare("SELECT id FROM users WHERE discord_id = ?").bind(prof.id).first<{ id: string }>();
  if (existing) {
    userId = existing.id;
    await env.DB.prepare("UPDATE users SET display_name = ?, avatar = ? WHERE id = ?").bind(display, avatar, userId).run();
  } else {
    userId = crypto.randomUUID();
    const handle = await uniqueHandle(env, prof.username || `discord_${prof.id}`);
    await env.DB.prepare(
      "INSERT INTO users (id, username, display_name, pw_hash, discord_id, avatar, created_ts) VALUES (?, ?, ?, NULL, ?, ?, ?)",
    ).bind(userId, handle, display, prof.id, avatar, Date.now()).run();
  }

  const setCookie = await createSession(env, url, userId);
  return new Response(null, { status: 302, headers: { location: `${url.origin}/`, "set-cookie": setCookie } });
}

// ----- helpers -----

async function sessionResponse(env: Env, url: URL, userId: string, user: SessionUser): Promise<Response> {
  const setCookie = await createSession(env, url, userId);
  return new Response(JSON.stringify({ user }), {
    headers: { "content-type": "application/json", "set-cookie": setCookie },
  });
}

async function uniqueHandle(env: Env, raw: string): Promise<string> {
  const base = raw.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 18) || "player";
  for (let i = 0; i < 6; i++) {
    const candidate = i === 0 ? base : `${base}_${Math.random().toString(36).slice(2, 6)}`;
    const hit = await env.DB.prepare("SELECT 1 FROM users WHERE username = ?").bind(candidate).first();
    if (!hit) return candidate;
  }
  return `${base}_${crypto.randomUUID().slice(0, 8)}`;
}

function validateCredentials(username: string, password: string): string | null {
  if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) return "invalid_username";
  if (password.length < 8 || password.length > 200) return "invalid_password";
  return null;
}
