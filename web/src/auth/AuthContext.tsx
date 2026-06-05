import { createContext, useContext, type ReactNode } from "react";
import type { AuthUser } from "./api";

interface AuthState {
  user: AuthUser;
  logout: () => void;
}

const Ctx = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth must be used within AuthProvider");
  return c;
}

export function AuthProvider({
  user,
  onLogout,
  children,
}: {
  user: AuthUser;
  onLogout: () => void;
  children: ReactNode;
}) {
  return <Ctx.Provider value={{ user, logout: onLogout }}>{children}</Ctx.Provider>;
}
