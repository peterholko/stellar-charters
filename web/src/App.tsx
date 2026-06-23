import { useEffect, useRef, useState } from "react";
import { store, useApp, type ViewId } from "./match/store";
import { formatCr } from "./match/format";
import { Icon, type IconName } from "./ui/icons";
import { CorpCrest } from "./theme/art";
import { useAuth } from "./auth/AuthContext";
import { ThemeSwitcher } from "./components/ThemeSwitcher";
import { CharterPick } from "./components/CharterPick";
import { Inspector } from "./components/Inspector";
import { Dashboard } from "./screens/Dashboard";
import { GalaxyMap } from "./screens/GalaxyMap";
import { Systems } from "./screens/Systems";
import { Exchange } from "./screens/Exchange";
import { Convoys } from "./screens/Convoys";
import { Ships } from "./screens/Ships";
import { Combat } from "./screens/Combat";
import { Finance } from "./screens/Finance";
import { Research } from "./screens/Research";
import { Turn } from "./screens/Turn";
import { Report } from "./screens/Report";
import { Standings, VICTORY } from "./screens/Standings";

const NAV: { id: ViewId; label: string; icon: IconName }[] = [
  { id: "dashboard", label: "Command", icon: "dashboard" },
  { id: "map", label: "Map", icon: "map" },
  { id: "systems", label: "Systems", icon: "systems" },
  { id: "exchange", label: "Exchange", icon: "exchange" },
  { id: "convoys", label: "Convoys", icon: "convoys" },
  { id: "ships", label: "Ships", icon: "ship" },
  { id: "combat", label: "Combat", icon: "crosshair" },
  { id: "finance", label: "Finance", icon: "finance" },
  { id: "research", label: "Research", icon: "flask" },
  { id: "turn", label: "Turn", icon: "send" },
  { id: "report", label: "Report", icon: "report" },
  { id: "standings", label: "Standings", icon: "trending" },
];

function Screen({ nav }: { nav: ViewId }) {
  switch (nav) {
    case "dashboard": return <Dashboard />;
    case "map": return <GalaxyMap />;
    case "systems": return <Systems />;
    case "exchange": return <Exchange />;
    case "convoys": return <Convoys />;
    case "ships": return <Ships />;
    case "combat": return <Combat />;
    case "finance": return <Finance />;
    case "research": return <Research />;
    case "turn": return <Turn />;
    case "report": return <Report />;
    case "standings": return <Standings />;
  }
}

export function App() {
  const state = useApp();
  const { status, phase, nav, view, staged, resolving, turn, totalTurns, selection, humanCorpId, mySeat, players, submittedCount } = state;
  const [drawer, setDrawer] = useState(false);
  const { user, logout } = useAuth();

  useEffect(() => {
    store.init(user.id);
  }, [user.id]);

  // On phones the inspector/order tray live in a slide-out drawer, so selecting a system,
  // lane, or convoy would otherwise change nothing visible — the details render in the
  // collapsed drawer. Surface the drawer whenever the selection changes on a selection
  // screen (map/systems/convoys) so a tap reveals the details and actions.
  // EXCEPTION: selecting a fleet or survey vessel puts the map in "tap a destination" mode — opening
  // the drawer (with its full-screen scrim) would block that destination tap, so keep the map clear.
  const prevSelKey = useRef<string | null>(null);
  useEffect(() => {
    const key = selection ? `${selection.kind}:${selection.id}` : null;
    const changed = key && key !== prevSelKey.current && prevSelKey.current !== null;
    // The map owns its own floating selection panel (full-bleed redesign), so it no longer drives
    // the shared drawer — only the convoys screen still opens the inspector drawer on a pick.
    const onSelectScreen = nav === "convoys";
    const moveMode = selection?.kind === "fleet" || selection?.kind === "survey";
    if (changed && onSelectScreen && !moveMode && typeof window !== "undefined" &&
        window.matchMedia("(max-width: 1180px)").matches) {
      setDrawer(true);
    }
    prevSelKey.current = key;
  }, [selection, nav]);

  if (status === "error") {
    return (
      <div className="auth auth--loading">
        <div className="auth__field" aria-hidden />
        <p style={{ color: "var(--negative)", fontFamily: "var(--font-display)" }}>
          Uplink failed. Reload to retry.
        </p>
      </div>
    );
  }
  if (status !== "ready") {
    return (
      <div className="auth auth--loading">
        <div className="auth__field" aria-hidden />
        <div className="auth__spinner" />
      </div>
    );
  }
  if (!mySeat || !view) return <InProgress username={user.username} />;
  const me = view.me;
  const iSubmitted = players.find((p) => p.isYou)?.submitted ?? false;
  const waiting = phase === "play" && iSubmitted && submittedCount < players.length;

  const top = (
    <header className="topbar">
      <div className="topbar__brand">
        <span className="topbar__mark"><img className="topbar__logo" src="/assets/brand-logo.png" alt="" /></span>
        <div className="topbar__brandtext">
          <p className="eyebrow">Charter Command</p>
          <h1>Stellar Charters</h1>
        </div>
      </div>
      <div className="topbar__turn">
        <span className="topbar__turnnum"><Icon name="clock" size={14} /> Turn {Math.min(turn + 1, totalTurns)} / {totalTurns}</span>
        <span className={`topbar__phase ${resolving || waiting ? "is-resolving" : ""}`}>{resolving ? "Submitting…" : waiting ? "Waiting for players" : phase === "over" ? "Match complete" : "Drafting orders"}</span>
      </div>
      <div className="topbar__right">
        <span className="topbar__credits"><Icon name="wallet" size={15} /> {formatCr(me.credits)}</span>
        <ThemeSwitcher />
        <div className="topbar__user">
          {user.avatar ? (
            <img className="topbar__avatar" src={user.avatar} alt="" />
          ) : (
            <span className="topbar__avatar topbar__avatar--initial">{user.username.charAt(0).toUpperCase()}</span>
          )}
          <span className="topbar__username">{user.username}</span>
          <button type="button" className="topbar__logout" title="Sign out" onClick={logout}>
            <Icon name="logout" size={15} />
          </button>
        </div>
      </div>
    </header>
  );

  return (
    <div className={`shell ${drawer ? "shell--drawer" : ""}`}>
      {top}
      <div className={`shell__body${nav === "systems" || nav === "map" ? " shell__body--full" : ""}`}>
        <nav className="navrail">
          {NAV.map((n) => (
            <button key={n.id} type="button" className={`navrail__btn${nav === n.id ? " is-active" : ""}`} onClick={() => store.setNav(n.id)} title={n.label}>
              <Icon name={n.icon} size={19} />
              <span>{n.label}</span>
              {n.id === "turn" && staged.length > 0 && <span className="navrail__count">{staged.length}</span>}
            </button>
          ))}
        </nav>

        <main className={`workspace${nav === "map" ? " workspace--map" : ""}`}>
          <Screen nav={nav} />
        </main>
        {/* One-time charter pick at join (review Section 5) — overlays until chosen. */}
        <CharterPick />

        {/* The map renders its own floating selection panel (full-bleed redesign); Systems has its
            own master→detail. Every other screen keeps the docked inspector sidebar. */}
        {nav !== "systems" && nav !== "map" && (
          <aside className="sidestack">
            <Inspector view={view} humanCorpId={humanCorpId} selection={selection} />
          </aside>
        )}
      </div>

      {/* Mobile bottom nav */}
      <nav className="mobilenav">
        {NAV.map((n) => (
          <button key={n.id} type="button" className={nav === n.id ? "is-active" : ""} onClick={() => store.setNav(n.id)}>
            <Icon name={n.icon} size={18} />
            <span>{n.label}</span>
          </button>
        ))}
      </nav>

      {/* Mobile / tablet: jump to the Turn screen to review & submit (orders moved out of the drawer) */}
      {nav !== "turn" && (
        <button type="button" className="drawer-fab" onClick={() => store.setNav("turn")} title="Review & submit turn">
          <Icon name="send" size={18} />
          {staged.length > 0 && <span className="drawer-fab__count">{staged.length}</span>}
        </button>
      )}
      {drawer && <div className="drawer-scrim" onClick={() => setDrawer(false)} />}

      {phase === "over" && <OverModal />}
    </div>
  );
}

function InProgress({ username }: { username: string }) {
  return (
    <div className="auth auth--loading">
      <div className="auth__field" aria-hidden />
      <main className="auth__panel" style={{ textAlign: "center" }}>
        <p className="auth__eyebrow">{username} · Charter Command</p>
        <h1 className="auth__title" style={{ fontSize: "1.6rem" }}>All seats taken</h1>
        <p className="auth__sub">Every charter in the galaxy is controlled. You'll be seated when a seat opens or a new game begins.</p>
        <button type="button" className="auth__submit" onClick={() => location.reload()}>Refresh</button>
      </main>
    </div>
  );
}

function OverModal() {
  const { outcome, humanCorpId } = useApp();
  if (!outcome || outcome.standings.length === 0) return null;
  const { standings, winnerId, victoryType } = outcome;
  const winner = standings.find((c) => c.corpId === winnerId) ?? standings[0]!;
  const myRank = standings.findIndex((c) => c.corpId === humanCorpId) + 1;
  const youWon = winner.corpId === humanCorpId;
  const vic = victoryType ? VICTORY[victoryType] : null;
  return (
    <div className="over">
      <div className="over__panel">
        <p className="eyebrow">{outcome.decisive ? "Decisive Victory" : "Charter Mandate Concluded"}</p>
        <h1>{youWon ? "Hegemony Achieved" : "Match Complete"}</h1>
        {vic && <p className="over__victory"><strong>{vic.title}</strong> — {youWon ? "you held " : `${winner.name} held `}{vic.blurb}.</p>}
        <p className="over__sub">
          {youWon
            ? "Your charter dominates the frontier."
            : `${winner.name} holds the strongest charter. You finished #${myRank} of ${standings.length}.`}
        </p>
        <ol className="over__board">
          {standings.slice(0, 5).map((c) => (
            <li key={c.corpId} className={c.corpId === humanCorpId ? "is-me" : ""}>
              <span>{c.corpId === winnerId ? "★" : c.rank}</span>
              <CorpCrest corpId={c.corpId} size={22} className="over__crest" />
              <strong>{c.name}{c.corpId === humanCorpId ? " (you)" : ""}</strong>
              <em>{c.score.toLocaleString()} pts</em>
            </li>
          ))}
        </ol>
        <div className="over__actions">
          <button type="button" className="ghost-btn" onClick={() => store.setNav("standings")}>
            <Icon name="trending" size={15} /> Full standings
          </button>
          <button type="button" className="primary-btn" onClick={() => store.newMatch()}>
            <Icon name="bolt" size={15} /> New match
          </button>
        </div>
      </div>
    </div>
  );
}
