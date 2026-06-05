import { useState } from "react";
import { store, useApp, type ViewId } from "./match/store";
import { formatCr } from "./match/format";
import { Icon, type IconName } from "./ui/icons";
import { ThemeSwitcher } from "./components/ThemeSwitcher";
import { Inspector } from "./components/Inspector";
import { OrderTray } from "./components/OrderTray";
import { Auction } from "./screens/Auction";
import { Dashboard } from "./screens/Dashboard";
import { GalaxyMap } from "./screens/GalaxyMap";
import { Systems } from "./screens/Systems";
import { Exchange } from "./screens/Exchange";
import { Convoys } from "./screens/Convoys";
import { Fleet } from "./screens/Fleet";
import { Finance } from "./screens/Finance";
import { Report } from "./screens/Report";

const NAV: { id: ViewId; label: string; icon: IconName }[] = [
  { id: "dashboard", label: "Command", icon: "dashboard" },
  { id: "map", label: "Map", icon: "map" },
  { id: "systems", label: "Systems", icon: "systems" },
  { id: "exchange", label: "Exchange", icon: "exchange" },
  { id: "convoys", label: "Convoys", icon: "convoys" },
  { id: "fleet", label: "Fleet", icon: "fleet" },
  { id: "finance", label: "Finance", icon: "finance" },
  { id: "report", label: "Report", icon: "report" },
];

function Screen({ nav }: { nav: ViewId }) {
  switch (nav) {
    case "dashboard": return <Dashboard />;
    case "map": return <GalaxyMap />;
    case "systems": return <Systems />;
    case "exchange": return <Exchange />;
    case "convoys": return <Convoys />;
    case "fleet": return <Fleet />;
    case "finance": return <Finance />;
    case "report": return <Report />;
  }
}

export function App() {
  const state = useApp();
  const { phase, nav, view, staged, resolving, turn, totalTurns, selection, match } = state;
  const [drawer, setDrawer] = useState(false);
  const me = view.me;

  const top = (
    <header className="topbar">
      <div className="topbar__brand">
        <span className="topbar__mark"><Icon name="bolt" size={18} /></span>
        <div className="topbar__brandtext">
          <p className="eyebrow">Charter Command</p>
          <h1>Stellar Charters</h1>
        </div>
      </div>
      <div className="topbar__turn">
        <span className="topbar__turnnum"><Icon name="clock" size={14} /> {phase === "auction" ? "Opening Auction" : `Turn ${turn} / ${totalTurns}`}</span>
        <span className={`topbar__phase ${resolving ? "is-resolving" : ""}`}>{resolving ? "Resolving…" : phase === "over" ? "Match complete" : "Drafting orders"}</span>
      </div>
      <div className="topbar__right">
        <span className="topbar__credits"><Icon name="wallet" size={15} /> {formatCr(me.credits)}</span>
        <ThemeSwitcher />
      </div>
    </header>
  );

  if (phase === "auction") {
    return (
      <div className="shell shell--auction">
        {top}
        <main className="shell__auction">
          <Auction />
        </main>
        {resolving && <ResolveOverlay label="Sealing bids…" />}
      </div>
    );
  }

  return (
    <div className={`shell ${drawer ? "shell--drawer" : ""}`}>
      {top}
      <div className="shell__body">
        <nav className="navrail">
          {NAV.map((n) => (
            <button key={n.id} type="button" className={nav === n.id ? "is-active" : ""} onClick={() => store.setNav(n.id)} title={n.label}>
              <Icon name={n.icon} size={19} />
              <span>{n.label}</span>
            </button>
          ))}
        </nav>

        <main className="workspace">
          <Screen nav={nav} />
        </main>

        <aside className="sidestack">
          <Inspector view={view} humanCorpId={match.humanCorpId} selection={selection} />
          <OrderTray view={view} staged={staged} resolving={resolving} turn={turn} totalTurns={totalTurns} />
        </aside>
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

      {/* Mobile / tablet orders drawer toggle */}
      <button type="button" className="drawer-fab" onClick={() => setDrawer((d) => !d)}>
        <Icon name={drawer ? "x" : "send"} size={18} />
        {staged.length > 0 && <span className="drawer-fab__count">{staged.length}</span>}
      </button>
      {drawer && <div className="drawer-scrim" onClick={() => setDrawer(false)} />}

      {resolving && <ResolveOverlay label="Resolving turn…" />}
      {phase === "over" && <OverModal />}
    </div>
  );
}

function ResolveOverlay({ label }: { label: string }) {
  return (
    <div className="resolve-overlay">
      <div className="resolve-overlay__core">
        <span className="resolve-overlay__ring" />
        <p>{label}</p>
      </div>
    </div>
  );
}

function OverModal() {
  const { view, match } = useApp();
  const standings = [...view.corporations].sort((a, b) => b.valuation - a.valuation);
  const winner = standings[0]!;
  const myRank = standings.findIndex((c) => c.id === match.humanCorpId) + 1;
  return (
    <div className="over">
      <div className="over__panel">
        <p className="eyebrow">Charter Mandate Concluded</p>
        <h1>{winner.id === match.humanCorpId ? "Hegemony Achieved" : "Match Complete"}</h1>
        <p className="over__sub">
          {winner.id === match.humanCorpId
            ? "Your charter dominates the frontier."
            : `${winner.name} holds the strongest charter. You finished #${myRank} of ${standings.length}.`}
        </p>
        <ol className="over__board">
          {standings.map((c, i) => (
            <li key={c.id} className={c.id === match.humanCorpId ? "is-me" : ""}>
              <span>{i + 1}</span>
              <strong>{c.name}{c.id === match.humanCorpId ? " (you)" : ""}</strong>
              <em>{formatCr(c.valuation)}</em>
            </li>
          ))}
        </ol>
        <button type="button" className="primary-btn" onClick={() => location.reload()}>
          <Icon name="bolt" size={15} /> New match
        </button>
      </div>
    </div>
  );
}
