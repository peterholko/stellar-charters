import { store, useApp } from "../match/store";
import {
  formatCr,
  populationLabel,
  resourceColors,
  resourceLabels,
  stockpileValue,
  systemArchetype,
  sumYields,
} from "../match/format";
import { RESOURCES } from "@engine";
import { PlanetArt } from "../theme/ArtSlot";
import { Panel, PanelTitle, Badge, Bar } from "../ui/primitives";
import { Icon } from "../ui/icons";

export function Systems() {
  const { view, match } = useApp();
  const galaxy = view.galaxy;
  const mine = view.me.ownedSystemIds.map((id) => galaxy.system(id));
  const open = galaxy.allSystems().filter((s) => s.owner === null && s.id !== galaxy.hubId);
  const prices = view.market.prices;
  const t = view.config.tuning;

  return (
    <div className="systems">
      <Panel className="systems__panel">
        <PanelTitle icon="systems" eyebrow="Charter Holdings" title={`Your Systems (${mine.length})`} />
        {mine.length === 0 ? (
          <p className="hint">No systems yet. Claim an open system below to begin extraction.</p>
        ) : (
          <div className="sys-grid">
            {mine.map((s) => {
              const arch = systemArchetype(s);
              return (
                <article key={s.id} className="sys-card" onClick={() => store.select({ kind: "system", id: s.id })}>
                  <PlanetArt archetype={arch} className="sys-card__planet" />
                  <div className="sys-card__body">
                    <div className="sys-card__head">
                      <h3>{s.name}</h3>
                      <Badge tone="neutral">{populationLabel[s.populationStage]}</Badge>
                    </div>
                    <div className="sys-card__meta">
                      <span>{sumYields(s.yields).toFixed(0)} yield/t</span>
                      <span>·</span>
                      <span>{formatCr(stockpileValue(s.stockpile, prices))} stock</span>
                    </div>
                    <Bar value={s.populationProgress} max={t.growthThreshold} tone={s.unrest > 0.01 ? "warn" : "positive"} />
                    <div className="sys-card__stock">
                      {RESOURCES.filter((r) => s.stockpile[r] >= 1).map((r) => (
                        <span key={r} title={resourceLabels[r]}><i style={{ background: resourceColors[r] }} />{Math.round(s.stockpile[r])}</span>
                      ))}
                    </div>
                    <div className="sys-card__infra">
                      {s.hasDepot && <Badge tone="accent">Depot</Badge>}
                      {s.hydroponics > 0 && <Badge tone="accent">Hydro ×{s.hydroponics}</Badge>}
                      {s.platforms > 0 && <Badge tone="accent">Platform ×{s.platforms}</Badge>}
                      {s.unrest > 0.01 && <Badge tone="negative">Unrest</Badge>}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </Panel>

      <Panel className="systems__panel">
        <PanelTitle icon="gavel" eyebrow="Frontier" title={`Open Claims (${open.length})`} />
        <div className="claim-list">
          {open.map((s) => {
            const arch = systemArchetype(s);
            const afford = view.me.credits >= s.claimCost && !view.me.isFreeOperator;
            return (
              <div key={s.id} className="claim-row" onClick={() => store.select({ kind: "system", id: s.id })}>
                <PlanetArt archetype={arch} className="claim-row__planet" />
                <div className="claim-row__info">
                  <strong>{s.name}</strong>
                  <span>{RESOURCES.filter((r) => s.yields[r] > 0).map((r) => `${resourceLabels[r]} +${s.yields[r]}`).join(" · ")}</span>
                </div>
                <button
                  type="button"
                  className="claim-row__btn"
                  disabled={!afford}
                  title={afford ? "Stage claim" : "Cannot afford / Free Operator"}
                  onClick={(e) => { e.stopPropagation(); store.stage({ kind: "claim", systemId: s.id, amount: s.claimCost }); }}
                >
                  <Icon name="gavel" size={13} /> {formatCr(s.claimCost)}
                </button>
              </div>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}
