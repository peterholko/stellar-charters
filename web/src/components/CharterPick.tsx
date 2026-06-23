/**
 * One-time charter-type pick at join (review Section 5 — asymmetric identity at setup): four
 * kinds of corporation, each one strong bonus + one real penalty. Shown as an overlay until the
 * seat has picked; the choice takes effect from the next resolved turn and cannot be changed.
 */
import { CHARTER_SPECS, CHARTER_TYPES } from "@engine";
import { store, useApp } from "../match/store";
import { Panel, PanelTitle, Badge } from "../ui/primitives";

export function CharterPick() {
  const { view, humanCorpId, mySeat } = useApp();
  if (!view || !mySeat) return null;
  const me = view.corporations.find((c) => c.id === humanCorpId);
  if (!me || me.charter) return null;

  return (
    <div className="charterpick">
      <Panel className="charterpick__panel">
        <PanelTitle icon="gavel" eyebrow="Incorporation" title="Choose your charter" />
        <p className="hint">
          What kind of corporation is this? One strong edge, one real cost — permanent, public,
          and in effect from your next turn.
        </p>
        <div className="charterpick__grid">
          {CHARTER_TYPES.map((t) => {
            const spec = CHARTER_SPECS[t];
            return (
              <button key={t} type="button" className="charterpick__card" onClick={() => store.pickCharter(t)}>
                <strong>{spec.name}</strong>
                <span className="charterpick__blurb">{spec.blurb}</span>
                <span className="charterpick__mods">
                  <Badge tone="accent">{spec.bonus}</Badge>
                  <Badge tone="warn">{spec.penalty}</Badge>
                </span>
              </button>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}
