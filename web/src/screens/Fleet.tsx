import { useState } from "react";
import { canRaidRoute, raidStrength, type RangeTier } from "@engine";
import { store, useApp } from "../match/store";
import { corpColor, formatCr, resourceLabels, sizeBucket } from "../match/format";
import { Panel, PanelTitle, Badge, Segmented, EmptyState } from "../ui/primitives";
import { ArtSlot } from "../theme/ArtSlot";
import { Icon } from "../ui/icons";

const TIERS: RangeTier[] = [1, 2, 3, 4];

export function Fleet() {
  const { view, humanCorpId } = useApp();
  if (!view) return null;
  const t = view.config.tuning;
  const me = view.me;
  const mySystems = me.ownedSystemIds.map((id) => view.galaxy.system(id));
  const [buildTier, setBuildTier] = useState<RangeTier>(1);
  const [raider, setRaider] = useState(false);
  const [baseId, setBaseId] = useState(mySystems[0]?.id ?? "");

  const rivalConvoys = view.convoys.filter((c) => c.owner !== humanCorpId);

  return (
    <div className="fleet">
      {/* Range tech ladder */}
      <Panel className="fleet__tech">
        <PanelTitle icon="radar" eyebrow="Research" title="Range-Tech Ladder" />
        <div className="ladder">
          {TIERS.map((tier) => {
            const owned = me.rangeTier >= tier;
            const next = tier === me.rangeTier + 1;
            const cost = t.rangeResearchCost[tier];
            return (
              <div key={tier} className={`ladder__rung ${owned ? "is-owned" : next ? "is-next" : "is-locked"}`}>
                <div className="ladder__tier">R{tier}</div>
                <div className="ladder__info">
                  <strong>Range {tier}</strong>
                  <span>{tier === 1 ? "Inner ring" : tier === 2 ? "Frontier lanes" : tier === 3 ? "Deep frontier" : "Corporate fleet"}</span>
                </div>
                {owned ? (
                  <Badge tone="positive">Online</Badge>
                ) : next ? (
                  <button type="button" className="mini-btn" disabled={me.credits < cost} onClick={() => store.stage({ kind: "researchRange", targetTier: tier })}>
                    {formatCr(cost)}
                  </button>
                ) : (
                  <Badge tone="neutral">Locked</Badge>
                )}
              </div>
            );
          })}
        </div>
      </Panel>

      {/* Build yard */}
      <Panel className="fleet__yard">
        <PanelTitle icon="ship" eyebrow="Shipyard" title="Build Warship" />
        {mySystems.length === 0 ? (
          <p className="hint">Claim a system to base a fleet.</p>
        ) : (
          <>
            <ArtSlot slot={raider ? "ship-raider" : buildTier >= 4 ? "ship-fleet" : buildTier === 3 ? "ship-clipper" : buildTier >= 2 ? "ship-escort" : "ship-cargo"} className="fleet__shipart" />
            <Segmented value={raider ? "raider" : "escort"} onChange={(v) => setRaider(v === "raider")} options={[{ value: "escort", label: "Escort" }, { value: "raider", label: "Raider" }]} />
            <label className="field">
              <span>Hull tier</span>
              <select value={buildTier} onChange={(e) => setBuildTier(Number(e.target.value) as RangeTier)}>
                {TIERS.filter((tier) => tier <= me.rangeTier).map((tier) => (
                  <option key={tier} value={tier}>Range {tier} · combat {t.shipCombat[tier] + (raider ? t.raiderCombatBonus : 0)}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Base at</span>
              <select value={baseId} onChange={(e) => setBaseId(e.target.value)}>
                {mySystems.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <div className="preview">
              <div className="preview__row"><span>Hull</span><strong>{formatCr(t.shipCost[buildTier] + (raider ? t.raiderShipExtraCost : 0))}</strong></div>
              {t.shipIsotopeCost[buildTier] > 0 && <div className="preview__row"><span>Isotopes</span><strong>{t.shipIsotopeCost[buildTier]} units</strong></div>}
              <div className="preview__row"><span>Role</span><strong>{raider ? "Interdiction" : "Escort / defense"}</strong></div>
            </div>
            <button type="button" className="primary-btn" onClick={() => store.stage({ kind: "buildShip", rangeTier: buildTier, raider, systemId: baseId })}>
              <Icon name="plus" size={15} /> Stage build
            </button>
            <button type="button" className="ghost-btn" disabled={!baseId} onClick={() => store.stage({ kind: "hirePrivateer", basedAt: baseId })}>
              <Icon name="skull" size={14} /> Hire privateer · {formatCr(t.privateerCost)}
            </button>
          </>
        )}
      </Panel>

      {/* Fleet roster */}
      <Panel className="fleet__roster">
        <PanelTitle icon="fleet" eyebrow="Order of Battle" title="Your Fleet" right={<Badge tone="accent">Raid str {raidStrength(me)}</Badge>} />
        <div className="roster">
          {me.ships.length === 0 && me.privateers.length === 0 ? (
            <EmptyState icon="ship">No ships built. The shipyard hardens lanes and enables raiding.</EmptyState>
          ) : (
            <>
              {me.ships.map((s, i) => (
                <div key={i} className="roster__row">
                  <Icon name={s.raider ? "skull" : "shield"} size={15} />
                  <span>Range {s.rangeTier} {s.raider ? "raider" : "escort"}</span>
                  <span className="roster__sub">{s.stationedAt ? view.galaxy.system(s.stationedAt).name : "unstationed"}</span>
                  <Badge tone="neutral">cbt {s.combat}</Badge>
                </div>
              ))}
              {me.privateers.map((p, i) => (
                <div key={`p${i}`} className="roster__row">
                  <Icon name="skull" size={15} />
                  <span>Privateer</span>
                  <span className="roster__sub">{view.galaxy.system(p.basedAt).name}</span>
                  <Badge tone="warn">{p.turnsLeft}t left</Badge>
                </div>
              ))}
            </>
          )}
        </div>
      </Panel>

      {/* Raid planner */}
      <Panel className="fleet__raids">
        <PanelTitle icon="crosshair" eyebrow="Interdiction" title="Raid Targets" />
        {rivalConvoys.length === 0 ? (
          <EmptyState icon="crosshair">No visible rival convoys. Interdict lanes from the Map to trap next-tick traffic.</EmptyState>
        ) : (
          <div className="raid-list">
            {rivalConvoys.slice(0, 8).map((c) => {
              const route = view.galaxy.routes.get(c.routeIds[c.position] ?? "");
              const eligible = route ? canRaidRoute(view.galaxy, me, route) : false;
              const targetable = c.routeIds.length >= 2 && c.launchedTurn < view.turn;
              const owner = view.corporations.find((x) => x.id === c.owner);
              return (
                <div key={c.id} className="raid-row">
                  <span className="raid-row__dot" style={{ background: corpColor(c.owner) }} />
                  <div className="raid-row__info">
                    <strong>{resourceLabels[c.resource]} · {sizeBucket(c.value)}</strong>
                    <span>{owner?.name}</span>
                  </div>
                  <button
                    type="button"
                    className="mini-btn mini-btn--danger"
                    disabled={!eligible || !targetable}
                    title={targetable ? (eligible ? "Target convoy" : "No raiders in range") : "Protected 1-turn run"}
                    onClick={() => store.stage({ kind: "targetConvoy", convoyId: c.id })}
                  >
                    <Icon name="crosshair" size={13} /> Target
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </Panel>
    </div>
  );
}
