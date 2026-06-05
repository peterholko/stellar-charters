import { useCallback, useEffect, useState, type ReactNode } from "react";
import { fetchMe, logoutAccount, type AuthUser } from "./api";
import { AuthProvider } from "./AuthContext";
import { AuthScreen } from "./AuthScreen";

/**
 * Gates the app behind authentication. Checks the session on load; shows the login /
 * register screen if signed out, otherwise renders the app with the user in context.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<"loading" | "out" | "in">("loading");
  const [user, setUser] = useState<AuthUser | null>(null);

  const check = useCallback(async () => {
    const u = await fetchMe();
    if (u) {
      setUser(u);
      setStatus("in");
    } else {
      setUser(null);
      setStatus("out");
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  const handleLogout = useCallback(async () => {
    await logoutAccount();
    setUser(null);
    setStatus("out");
  }, []);

  if (status === "loading") {
    return (
      <div className="auth auth--loading">
        <div className="auth__field" aria-hidden />
        <div className="auth__spinner" />
      </div>
    );
  }

  if (status === "out" || !user) {
    return <AuthScreen onAuthed={check} />;
  }

  return (
    <AuthProvider user={user} onLogout={() => void handleLogout()}>
      {children}
    </AuthProvider>
  );
}
