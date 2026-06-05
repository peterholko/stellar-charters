export interface AuthUser {
  id: string;
  username: string;
  avatar: string | null;
}

export interface AuthResult {
  ok: boolean;
  status: number;
  error?: string;
  user?: AuthUser;
}

async function post(path: string, body?: unknown): Promise<AuthResult> {
  const res = await fetch(path, {
    method: "POST",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as { user?: AuthUser; error?: string };
  return { ok: res.ok, status: res.status, error: data.error, user: data.user };
}

export async function fetchMe(): Promise<AuthUser | null> {
  try {
    const res = await fetch("/api/auth/me");
    if (!res.ok) return null;
    const { user } = (await res.json()) as { user: AuthUser };
    return user;
  } catch {
    return null;
  }
}

export async function fetchProviders(): Promise<{ password: boolean; discord: boolean }> {
  try {
    const res = await fetch("/api/auth/providers");
    return (await res.json()) as { password: boolean; discord: boolean };
  } catch {
    return { password: true, discord: false };
  }
}

export const registerAccount = (username: string, password: string) =>
  post("/api/auth/register", { username, password });
export const loginAccount = (username: string, password: string) =>
  post("/api/auth/login", { username, password });
export const logoutAccount = () => post("/api/auth/logout");
