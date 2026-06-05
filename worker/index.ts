/**
 * Stellar Charters auth Worker (Phase 1 slice).
 *
 * Serves the SPA (via the ASSETS binding for non-/api paths) and a small auth API:
 *   POST /api/auth/register      { username, password }
 *   POST /api/auth/login         { username, password }
 *   POST /api/auth/logout
 *   GET  /api/auth/me            -> { user } | 401
 *   GET  /api/auth/providers     -> { password, discord }
 *   GET  /api/auth/discord       -> 302 to Discord (if configured)
 *   GET  /api/auth/discord/callback
 *
 * Passwords: PBKDF2-SHA256 (never plaintext). Sessions: opaque cookie token; only its
 * SHA-256 is stored in D1. The game itself still runs client-side for now — this just
 * gates it behind a real account.
 */

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  DISCORD_CLIENT_ID?: string;
  DISCORD_CLIENT_SECRET?: string;
}

const SESSION_COOKIE = "sc_session";
const STATE_COOKIE = "sc_oauth_state";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const PBKDF2_ITERATIONS = 100_000;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) {
      // Non-API paths are normally served by the asset router (run_worker_first scopes
      // this Worker to /api/*), but fall through defensively.
      return env.ASSETS.fetch(request);
    }
    try {
      return await route(request, env, url);
    } catch (err) {
      console.error("api error", err);
      return json({ error: "internal_error" }, 500);
    }
  },
};

async function route(request: Request, env: Env, url: URL): Promise<Response> {
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
  if (token) {
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256hex(token)).run();
  }
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
  if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET) {
    return json({ error: "discord_not_configured" }, 404);
  }
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const redirectUri = `${url.origin}/api/auth/discord/callback`;
  const authorize = new URL("https://discord.com/api/oauth2/authorize");
  authorize.searchParams.set("client_id", env.DISCORD_CLIENT_ID);
  authorize.searchParams.set("redirect_uri", redirectUri);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("scope", "identify");
  authorize.searchParams.set("state", state);
  return new Response(null, {
    status: 302,
    headers: {
      location: authorize.toString(),
      "set-cookie": serializeCookie(STATE_COOKIE, state, url, 600), // 10 min
    },
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
  const prof = (await profRes.json()) as {
    id: string;
    username: string;
    global_name?: string | null;
    avatar?: string | null;
  };

  const avatar = prof.avatar ? `https://cdn.discordapp.com/avatars/${prof.id}/${prof.avatar}.png` : null;
  const display = prof.global_name || prof.username;

  // Upsert by discord_id.
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
  return new Response(null, {
    status: 302,
    headers: { location: `${url.origin}/`, "set-cookie": setCookie },
  });
}

// ----- sessions -----

async function sessionResponse(
  env: Env,
  url: URL,
  userId: string,
  user: { id: string; username: string; avatar: string | null },
): Promise<Response> {
  const setCookie = await createSession(env, url, userId);
  return new Response(JSON.stringify({ user }), {
    headers: { "content-type": "application/json", "set-cookie": setCookie },
  });
}

async function createSession(env: Env, url: URL, userId: string): Promise<string> {
  const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO sessions (token_hash, user_id, created_ts, expires_ts) VALUES (?, ?, ?, ?)",
  ).bind(await sha256hex(token), userId, now, now + SESSION_TTL_MS).run();
  return serializeCookie(SESSION_COOKIE, token, url, Math.floor(SESSION_TTL_MS / 1000));
}

async function currentUser(
  request: Request,
  env: Env,
): Promise<{ id: string; username: string; avatar: string | null } | null> {
  const token = getCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT u.id, u.display_name, u.avatar, s.expires_ts
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ?`,
  ).bind(await sha256hex(token)).first<{ id: string; display_name: string; avatar: string | null; expires_ts: number }>();
  if (!row || row.expires_ts < Date.now()) return null;
  return { id: row.id, username: row.display_name, avatar: row.avatar };
}

async function uniqueHandle(env: Env, raw: string): Promise<string> {
  const base = (raw.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 18) || "player");
  for (let i = 0; i < 6; i++) {
    const candidate = i === 0 ? base : `${base}_${Math.random().toString(36).slice(2, 6)}`;
    const hit = await env.DB.prepare("SELECT 1 FROM users WHERE username = ?").bind(candidate).first();
    if (!hit) return candidate;
  }
  return `${base}_${crypto.randomUUID().slice(0, 8)}`;
}

// ----- validation -----

function validateCredentials(username: string, password: string): string | null {
  if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) return "invalid_username";
  if (password.length < 8 || password.length > 200) return "invalid_password";
  return null;
}

// ----- crypto helpers (Web Crypto) -----

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `${PBKDF2_ITERATIONS}:${b64(salt)}:${b64(hash)}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [iterStr, saltB64, hashB64] = stored.split(":");
  if (!iterStr || !saltB64 || !hashB64) return false;
  const salt = unb64(saltB64);
  const expected = unb64(hashB64);
  const actual = await pbkdf2(password, salt, parseInt(iterStr, 10));
  return timingSafeEqual(actual, expected);
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, key, 256);
  return new Uint8Array(bits);
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

async function sha256hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function b64(bytes: Uint8Array): string {
  let s = "";
  for (const byte of bytes) s += String.fromCharCode(byte);
  return btoa(s);
}
function unb64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function b64url(bytes: Uint8Array): string {
  return b64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ----- http helpers -----

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

function getCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

function serializeCookie(name: string, value: string, url: URL, maxAgeSecs: number): string {
  const secure = url.protocol === "https:" ? " Secure;" : "";
  return `${name}=${encodeURIComponent(value)}; HttpOnly;${secure} SameSite=Lax; Path=/; Max-Age=${maxAgeSecs}`;
}
function clearCookie(name: string, url: URL): string {
  const secure = url.protocol === "https:" ? " Secure;" : "";
  return `${name}=; HttpOnly;${secure} SameSite=Lax; Path=/; Max-Age=0`;
}
