import type { PlayerView } from "@engine";
import { store, useApp } from "../match/store";
import { buildDigest } from "../match/digest";
import { formatCr } from "../match/format";
import { Panel, PanelTitle, Sparkline, Badge, Stat, EmptyState } from "../ui/primitives";
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
  if (me.rangeTier < 2 && turn >= 6) return "Research Range 2 in Fleet & Security to chart frontier lanes and reach rare isotopes.";
  if (turn >= 10 && me.ownedSystemIds.length < 2) return "Consider a second claim or a Trade Depot to grow valuation before the consolidation phase.";
  return null;
}

export function Dashboard() {
  const { view, lastReport, valuationHistory, turn, totalTurns, humanCorpId } = useApp();
  if (!view) return null;
  const me = view.me;
  const phase = phaseOf(Math.max(1, turn), totalTurns);
  const digest = lastReport ? buildDigest(lastReport, view, humanCorpId).filter((l) => l.scope === "me") : [];
  const tip = coachTip(view, turn);

  const standings = [...view.corporations]
    .sort((a, b) => b.valuation - a.valuation)
    .slice(0, 5);

  return (
    <div className="dashboard">
      <div className="dashboard__stats">
        <Stat label="Credits" value={`${formatCr(me.credits)}`} icon="wallet" tone={me.credits < 500 ? "warn" : undefined} />
        <Stat label="Debt" value={`${formatCr(me.debt)}`} icon="finance" tone={me.debt > 0 ? "warn" : undefined} />
        <Stat label="Valuation" value={formatCr(me.valuation)} icon="trending" sub={<Sparkline data={valuationHistory.length ? valuationHistory : [me.valuation, me.valuation]} color="auto" width={92} height={26} />} />
        <Stat label="Range" value={`Tier ${me.rangeTier}`} icon="radar" />
        <Stat label="Systems" value={me.ownedSystemIds.length} icon="systems" />
        <Stat label="Charter" value={me.isFreeOperator ? "Free Operator" : "Chartered"} icon="gavel" tone={me.isFreeOperator ? "negative" : undefined} />
      </div>

      <div className="dashboard__grid">
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
