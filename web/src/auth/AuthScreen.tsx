import { useEffect, useState, type FormEvent } from "react";
import { fetchProviders, loginAccount, registerAccount } from "./api";

const ERRORS: Record<string, string> = {
  invalid_username: "Username must be 3–20 letters, numbers, or underscores.",
  invalid_password: "Password must be at least 8 characters.",
  username_taken: "That username is already taken.",
  invalid_credentials: "Incorrect username or password.",
  missing_credentials: "Enter a username and password.",
  internal_error: "Something went wrong. Try again.",
};

export function AuthScreen({ onAuthed }: { onAuthed: () => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [discord, setDiscord] = useState(false);

  useEffect(() => {
    fetchProviders().then((p) => setDiscord(p.discord));
    const params = new URLSearchParams(location.search);
    if (params.get("auth_error")) setErr("Discord sign-in failed. Try again.");
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    const fn = mode === "login" ? loginAccount : registerAccount;
    const res = await fn(username.trim(), password);
    setBusy(false);
    if (res.ok) onAuthed();
    else setErr(ERRORS[res.error ?? ""] ?? "Could not sign in.");
  };

  return (
    <div className="auth">
      <div className="auth__field" aria-hidden />
      <img className="auth__splash" src="/assets/key-art-splash.png" alt="" aria-hidden />
      <main className="auth__panel">
        <img className="auth__logo" src="/assets/brand-logo.png" alt="Stellar Charters" />
        <p className="auth__eyebrow">Wormhole Authority · Charter Command</p>
        <h1 className="auth__title">STELLAR CHARTERS</h1>
        <p className="auth__sub">{mode === "login" ? "Sign in to your charter" : "Register a new charter"}</p>

        <div className="auth__tabs">
          <button type="button" className={mode === "login" ? "is-active" : ""} onClick={() => { setMode("login"); setErr(""); }}>
            Sign in
          </button>
          <button type="button" className={mode === "register" ? "is-active" : ""} onClick={() => { setMode("register"); setErr(""); }}>
            Register
          </button>
        </div>

        <form className="auth__form" onSubmit={submit}>
          <label>
            <span>Username</span>
            <input
              value={username}
              autoCapitalize="none"
              autoComplete="username"
              spellCheck={false}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="3–20 characters"
            />
          </label>
          <label>
            <span>Password</span>
            <input
              type="password"
              value={password}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === "register" ? "at least 8 characters" : "••••••••"}
            />
          </label>

          {err && <p className="auth__error">{err}</p>}

          <button type="submit" className="auth__submit" disabled={busy || !username || !password}>
            {busy ? "…" : mode === "login" ? "Sign in" : "Create charter"}
          </button>
        </form>

        {discord && (
          <>
            <div className="auth__or"><span>or</span></div>
            <a className="auth__discord" href="/api/auth/discord">
              <DiscordMark /> Continue with Discord
            </a>
          </>
        )}
      </main>
    </div>
  );
}

function DiscordMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M20.3 4.4A19 19 0 0 0 15.6 3l-.2.4a14 14 0 0 1 4.1 1.3 13 13 0 0 0-11-.0A14 14 0 0 1 12.6 3.4L12.4 3A19 19 0 0 0 7.7 4.4 19.7 19.7 0 0 0 4.3 17.7a19 19 0 0 0 5.8 2.9l.5-.8a12 12 0 0 1-1.8-.9l.4-.3a9 9 0 0 0 7.7 0l.4.3a12 12 0 0 1-1.8.9l.5.8a19 19 0 0 0 5.8-2.9 19.6 19.6 0 0 0-3.5-13.3ZM9.7 15.3c-.9 0-1.7-.9-1.7-1.9s.8-1.9 1.7-1.9 1.7.9 1.7 1.9-.8 1.9-1.7 1.9Zm4.6 0c-.9 0-1.7-.9-1.7-1.9s.8-1.9 1.7-1.9 1.7.9 1.7 1.9-.7 1.9-1.7 1.9Z" />
    </svg>
  );
}
