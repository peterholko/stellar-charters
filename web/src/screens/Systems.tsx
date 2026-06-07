import { store, useApp } from "../match/store";
import {
  formatCr,
  populationLabel,
  resourceLabels,
  starTypeLabel,
  stockpileValue,
  systemArchetype,
  sumPotential,
} from "../match/format";
import { RESOURCES } from "@engine";
import { PlanetArt } from "../theme/ArtSlot";
import { ResourceIcon } from "../theme/art";
import { Panel, PanelTitle, Badge, Bar } from "../ui/primitives";

export function Systems() {
  const { view } = useApp();
  if (!view) return null;
  const galaxy = view.galaxy;
  const mine = view.me.ownedSystemIds.map((id) => galaxy.system(id));
  const prices = view.market.prices;
  const t = view.config.tuning;

  return (
    <div className="systems">
      <Panel className="systems__panel">
        <PanelTitle icon="systems" eyebrow="Charter Holdings" title={`Your Systems (${mine.length})`} />
        {mine.length === 0 ? (
          <p className="hint">No systems yet. Claim an open system from the Map to begin extraction.</p>
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
                      <span>{sumPotential(s).toFixed(0)} yield/t</span>
                      <span>·</span>
                      <span>{s.sites.filter((x) => x.extractorLevel > 0).length}/{s.sites.length} worked</span>
                      <span>·</span>
                      <span>{formatCr(stockpileValue(s.stockpile, prices))} stock</span>
                    </div>
                    {s.bodies?.starType && (
                      <div className="sys-card__star">{starTypeLabel[s.bodies.starType]}</div>
                    )}
                    <Bar value={s.populationProgress} max={t.growthThreshold} tone={s.unrest > 0.01 ? "warn" : "positive"} />
                    <div className="sys-card__stock">
                      {RESOURCES.filter((r) => s.stockpile[r] >= 1).map((r) => (
                        <span key={r} title={resourceLabels[r]}><ResourceIcon resource={r} size={16} />{Math.round(s.stockpile[r])}</span>
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
    </div>
  );
}
