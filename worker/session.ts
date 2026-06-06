/**
 * Shared Worker utilities: bindings, JSON/cookie helpers, password hashing (PBKDF2),
 * and session create/lookup. Imported by both the auth routes and the game routes.
 */

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  DISCORD_CLIENT_ID?: string;
  DISCORD_CLIENT_SECRET?: string;
}

export interface SessionUser {
  id: string;
  username: string;
  avatar: string | null;
}

export const SESSION_COOKIE = "sc_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const PBKDF2_ITERATIONS = 100_000;

// ----- http -----

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ----- cookies -----

export function getCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

export function serializeCookie(name: string, value: string, url: URL, maxAgeSecs: number): string {
  const secure = url.protocol === "https:" ? " Secure;" : "";
  return `${name}=${encodeURIComponent(value)}; HttpOnly;${secure} SameSite=Lax; Path=/; Max-Age=${maxAgeSecs}`;
}

export function clearCookie(name: string, url: URL): string {
  const secure = url.protocol === "https:" ? " Secure;" : "";
  return `${name}=; HttpOnly;${secure} SameSite=Lax; Path=/; Max-Age=0`;
}

// ----- crypto -----

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `${PBKDF2_ITERATIONS}:${b64(salt)}:${b64(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [iterStr, saltB64, hashB64] = stored.split(":");
  if (!iterStr || !saltB64 || !hashB64) return false;
  const actual = await pbkdf2(password, unb64(saltB64), parseInt(iterStr, 10));
  return timingSafeEqual(actual, unb64(hashB64));
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

export async function sha256hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, "0")).join("");
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
export function b64url(bytes: Uint8Array): string {
  return b64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ----- sessions -----

export async function createSession(env: Env, url: URL, userId: string): Promise<string> {
  const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO sessions (token_hash, user_id, created_ts, expires_ts) VALUES (?, ?, ?, ?)",
  ).bind(await sha256hex(token), userId, now, now + SESSION_TTL_MS).run();
  return serializeCookie(SESSION_COOKIE, token, url, Math.floor(SESSION_TTL_MS / 1000));
}

export async function currentUser(request: Request, env: Env): Promise<SessionUser | null> {
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
