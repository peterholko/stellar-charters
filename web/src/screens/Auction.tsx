import { useMemo, useState } from "react";
import { useApp, store } from "../match/store";
import { archetypeLabel, formatCr, starTypeColor, starTypeLabel, systemArchetype } from "../match/format";
import { Panel, PanelTitle, Badge, ActionButton } from "../ui/primitives";
import { NumberInput } from "../ui/NumberInput";
import { Icon } from "../ui/icons";

/**
 * Opening Inner Ring Claim Auction (Section 05). The game's first decision: every charter submits a
 * sealed, priority-ordered bid for a home system. Highest valid bid wins each system (one home per
 * charter); losing bids are mostly refunded; a charter that wins nothing still gets a fallback home —
 * so the worst case is a weaker start, never no start. Resolves once every seated charter has bid.
 */
export function Auction() {
  const { view, players, submittedCount, totalSeats, resolving } = useApp();
  const [amounts, setAmounts] = useState<Record<string, number>>({});

  const iBid = players.find((p) => p.isYou)?.submitted ?? false;
  const credits = view?.me.credits ?? 0;

  const biddable = useMemo(() => {
    if (!view) return [];
    const hubId = view.galaxy.hubId;
    return [...view.galaxy.systems.values()]
      .filter((s) => s.innerRing && s.owner === null && s.id !== hubId)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [view]);

  if (!view) return null;

  const priorities = Object.entries(amounts)
    .filter(([, v]) => v > 0)
    .map(([systemId, amount]) => ({ systemId, amount }))
    .sort((a, b) => b.amount - a.amount);
  const topBid = priorities[0]?.amount ?? 0;
  const overspend = topBid > credits; // your winning bid is the most you can ever pay
  const nameOf = (id: string) => view.galaxy.systems.get(id)?.name ?? id;

  // ----- already bid: waiting for the rest of the table -----
  if (iBid) {
    return (
      <div className="auction">
        <Panel className="auction__wait">
          <PanelTitle icon="gavel" eyebrow="Opening Auction" title="Bids locked" />
          <p className="hint">Your sealed bid is in. The auction resolves and homes are awarded once every charter has bid.</p>
          <div className="auction__waitmeter">
            <Icon name="clock" size={16} />
            <strong>{submittedCount} / {totalSeats}</strong> charters have bid
          </div>
          {priorities.length > 0 && (
            <ol className="auction__yourbids">
              {priorities.map((p) => (
                <li key={p.systemId}><span>{nameOf(p.systemId)}</span><em>{formatCr(p.amount)}</em></li>
              ))}
            </ol>
          )}
        </Panel>
      </div>
    );
  }

  // ----- compose your bid -----
  return (
    <div className="auction">
      <Panel className="auction__intro">
        <PanelTitle icon="gavel" eyebrow="Section 05 · Opening Auction" title="Stake Your Charter's Home" />
        <p className="hint">
          Bid on the Inner Ring systems below. You win <strong>at most one</strong> — the highest valid
          bid takes each system. You pay only your <strong>winning</strong> bid; losing bids are ~92%
          refunded. Win nothing and you're still granted a fallback home, so bidding wide is safe.
        </p>
        <div className="auction__summary">
          <div><span className="eyebrow">Treasury</span><strong>{formatCr(credits)}</strong></div>
          <div><span className="eyebrow">Systems bid</span><strong>{priorities.length}</strong></div>
          <div><span className="eyebrow">Max you'll pay</span><strong className={overspend ? "is-bad" : ""}>{formatCr(topBid)}</strong></div>
        </div>
        {overspend && <p className="auction__err">Your top bid exceeds your treasury — lower it to at most {formatCr(credits)}.</p>}
        <ActionButton
          icon="gavel"
          variant="primary"
          disabled={resolving || overspend}
          title={priorities.length === 0 ? "Submit with no bids to take a fallback home" : "Submit your sealed bid"}
          onClick={() => store.submitBid(priorities)}
        >
          {resolving ? "Submitting…" : priorities.length === 0 ? "Skip — take a fallback home" : `Submit ${priorities.length} bid${priorities.length > 1 ? "s" : ""}`}
        </ActionButton>
      </Panel>

      <div className="auction__grid">
        {biddable.map((s) => {
          const arch = systemArchetype(s);
          const amt = amounts[s.id] ?? 0;
          return (
            <Panel key={s.id} className={`auction__card${amt > 0 ? " is-bid" : ""}`}>
              <div className="auction__cardhead">
                <strong>{s.name}</strong>
                {amt > 0 && <Badge tone="accent">bid</Badge>}
              </div>
              <p className="auction__arch">
                {archetypeLabel[arch]}
                {s.bodies?.starType && (
                  <> · <span style={{ color: starTypeColor[s.bodies.starType] }}>{starTypeLabel[s.bodies.starType]}</span></>
                )}
              </p>
              <div className="auction__bidrow">
                <NumberInput
                  min={0}
                  step={250}
                  value={amt}
                  onCommit={(v) => setAmounts((a) => ({ ...a, [s.id]: Math.max(0, Math.round(v)) }))}
                />
                <span className="auction__cr">Cr</span>
              </div>
            </Panel>
          );
        })}
      </div>
    </div>
  );
}
