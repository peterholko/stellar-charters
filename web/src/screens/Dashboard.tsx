import type { LogisticsFocus, PlayerView, ValuationComponent } from "@engine";
import { store, useApp } from "../match/store";
import { buildDigest } from "../match/digest";
import { buildWarnings } from "../match/warnings";
import { formatCr } from "../match/format";
import { Panel, PanelTitle, Sparkline, Badge, Stat, EmptyState } from "../ui/primitives";
import { Advisor } from "../components/Advisor";
import { Icon } from "../ui/icons";
import { CorpCrest } from "../theme/art";
import { ArtSlot } from "../theme/ArtSlot";

function phaseOf(turn: number, total: number): { label: string; note: string } {
  const p = turn / total;
  if (p < 0.25) return { label: "Frontier Security", note: "Claim, produce, export. Privateers test exposed lanes." };
  if (p < 0.6) return { label: "Security Wars", note: "Escorts, platforms, interdiction. Reach the frontier for isotopes." };
  return { label: "Corporate Consolidation", note: "Debt, equity, and hostile takeovers decide the charter hegemon." };
}

function coachTip(view: PlayerView, turn: number): string | null {
  const me = view.me;
  if (me.ownedSystemIds.length === 0) return "You hold no systems. Claim an open system from the Map or Systems screen to start producing.";
  if (turn <= 3) return "Sell surplus from your system on the Exchange — exports pay on arrival, so cash lags a turn.";
  if (me.rangeTier < 2 && turn >= 6) return "Research Warp Drive in Fleet & Security to chart frontier lanes and reach rare isotopes.";
  if (turn >= 10 && me.ownedSystemIds.length < 2) return "Consider a second claim or a Trade Depot to grow valuation before the consolidation phase.";
  return null;
}

const partLabels: Record<ValuationComponent, string> = {
  cash: "Cash", debt: "Debt", fleet: "Fleet", momentum: "Earnings momentum", yields: "System yields",
  extractors: "Extractors", population: "Population", infrastructure: "Infrastructure",
  megastructures: "Megastructures", stockpiles: "Stockpiles",
};

const FOCUS_OPTIONS: { id: LogisticsFocus; label: string; desc: string }[] = [
  { id: "escortNext", label: "Escort convoys", desc: "Harden this turn's outbound convoys against raiders." },
  { id: "expediteBuild", label: "Expedite build", desc: "Shave a turn off a build already in progress." },
  { id: "surveyPush", label: "Push survey", desc: "Speed an in-flight survey vessel by a turn." },
];

/** Phase D — the single per-turn standing decision. Exclusive (one focus), spent each turn. */
function LogisticsFocusPanel({ staged }: { staged: ReturnType<typeof useApp>["staged"] }) {
  const current = staged.find((s) => s.order.kind === "logisticsFocus")?.order;
  const focus = current && current.kind === "logisticsFocus" ? current.focus : null;
  return (
    <Panel className="dashboard__logistics">
      <PanelTitle icon="bolt" eyebrow="Standing Order" title="Logistics Focus" />
      <p className="hint">One focus per turn — it's spent this turn, never banked.</p>
      <div className="focus-grid">
        {FOCUS_OPTIONS.map((o) => (
          <button
            key={o.id}
            type="button"
            className={`focus-btn ${focus === o.id ? "is-active" : ""}`}
            onClick={() => store.setLogisticsFocus(focus === o.id ? null : o.id)}
            title={o.desc}
          >
            <strong>{o.label}</strong>
            <span>{o.desc}</span>
          </button>
        ))}
      </div>
    </Panel>
  );
}

export function Dashboard() {
  const { view, lastReport, valuationHistory, turn, totalTurns, humanCorpId, staged } = useApp();
  if (!view) return null;
  const me = view.me;
  const phase = phaseOf(Math.max(1, turn), totalTurns);
  const digest = lastReport ? buildDigest(lastReport, view, humanCorpId).filter((l) => l.scope === "me") : [];
  const tip = coachTip(view, turn);
  const warnings = buildWarnings(view);
  // Valuation decomposition (Section 17): the win metric is not a black box.
  const parts = me.valuationParts
    ? (Object.entries(me.valuationParts) as [ValuationComponent, number][])
        .filter(([, v]) => Math.abs(v) >= 1)
        .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    : [];

  const standings = [...view.corporations]
    .sort((a, b) => b.valuation - a.valuation)
    .slice(0, 5);

  return (
    <div className="dashboard">
      <div className="dashboard__stats">
        <Stat label="Credits" value={`${formatCr(me.credits)}`} icon="wallet" tone={me.credits < 500 ? "warn" : undefined} />
        <Stat label="Debt" value={`${formatCr(me.debt)}`} icon="finance" tone={me.debt > 0 ? "warn" : undefined} />
        <Stat label="Valuation" value={formatCr(me.valuation)} icon="trending" sub={<Sparkline data={valuationHistory.length ? valuationHistory : [me.valuation, me.valuation]} color="auto" width={92} height={26} />} />
        <Stat label="Systems" value={me.ownedSystemIds.length} icon="systems" />
        <Stat label="Charter" value={me.isFreeOperator ? "Free Operator" : "Chartered"} icon="gavel" tone={me.isFreeOperator ? "negative" : undefined} />
      </div>

      <Advisor />

      {parts.length > 0 && (
        <details className="dashboard__valparts">
          <summary className="hint">Where the valuation comes from ▾</summary>
          <div className="ledger">
            {parts.map(([k, v]) => (
              <div key={k} className="preview__row"><span>{partLabels[k]}</span><strong>{v > 0 ? "+" : ""}{formatCr(Math.round(v))}</strong></div>
            ))}
          </div>
        </details>
      )}

      <div className="dashboard__grid">
        {warnings.length > 0 && (
          <Panel className="dashboard__warnings">
            <PanelTitle icon="alert" eyebrow="Needs Attention" title="Warnings" right={<Badge tone={warnings.some((w) => w.tone === "bad") ? "negative" : "warn"}>{warnings.length}</Badge>} />
            <div className="digest">
              {warnings.slice(0, 6).map((w, i) => (
                <div key={i} className={`digest__row digest__row--${w.tone}`}>
                  <Icon name="alert" size={15} />
                  <div><strong>{w.title}</strong><span>{w.body}</span></div>
                  {w.fix && <button type="button" className="mini-btn" onClick={w.fix.run}>{w.fix.label}</button>}
                </div>
              ))}
            </div>
          </Panel>
        )}
        <Panel className="dashboard__phase">
          <PanelTitle icon="bolt" eyebrow={`Turn ${Math.min(turn + 1, totalTurns)} of ${totalTurns}`} title={phase.label} />
          <p className="dashboard__phase-note">{phase.note}</p>
          {tip && (
            <div className="coach">
              <Icon name="info" size={16} />
              <p>{tip}</p>
            </div>
          )}
        </Panel>

        <LogisticsFocusPanel staged={staged} />

        <Panel className="dashboard__digest">
          <PanelTitle icon="report" eyebrow="Last Resolution" title={lastReport ? `Turn ${lastReport.turn} Digest` : "Awaiting first turn"} right={lastReport ? <Badge tone="info">{formatCr(lastReport.taxLevied)} tax</Badge> : undefined} />
          <div className="digest">
            {digest.length === 0 ? (
              <EmptyState icon="check">No notable events for your charter last turn.</EmptyState>
            ) : (
              digest.slice(0, 8).map((l, i) => (
                <div key={i} className={`digest__row digest__row--${l.tone}`}>
                  {l.art ? (
                    <ArtSlot slot={l.art} className="digest__art" />
                  ) : (
                    <Icon name={l.tone === "good" ? "check" : l.tone === "bad" ? "alert" : l.tone === "warn" ? "alert" : "info"} size={15} />
                  )}
                  <div>
                    <strong>{l.title}</strong>
                    <span>{l.body}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </Panel>

        <Panel className="dashboard__standings">
          <PanelTitle icon="trending" eyebrow="Galactic Exchange" title="Charter Standings" />
          <div className="standings">
            {standings.map((c, i) => (
              <div key={c.id} className={`standings__row ${c.id === me.id ? "is-me" : ""}`}>
                <span className="standings__rank">{i + 1}</span>
                <CorpCrest corpId={c.id} size={20} className="standings__crest" />
                <span className="standings__name">{c.name}{c.id === me.id ? " (you)" : ""}</span>
                <span className="standings__val">{formatCr(c.valuation)}</span>
                {c.isFreeOperator && <Badge tone="neutral">Free Op</Badge>}
              </div>
            ))}
          </div>
          <button type="button" className="link-btn" onClick={() => store.setNav("finance")}>
            Open Finance & Equity <Icon name="chevron" size={14} />
          </button>
        </Panel>
      </div>
    </div>
  );
}
