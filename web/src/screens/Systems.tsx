import { useState } from "react";
import { store, useApp } from "../match/store";
import {
  formatCr,
  planetTypeLabel,
  populationLabel,
  starTypeLabel,
  stockpileValue,
  sumPotential,
  systemArchetype,
} from "../match/format";
import { coloniesOf, type ColonyInfo, type PlayerView, type StarType, type System } from "@engine";
import { ColonyCard, PowerMeter, colonyNames } from "../components/ColonyPanel";
import { PlanetArt, PlanetTypeArt, StarArt } from "../theme/ArtSlot";
import { ResourceIcon } from "../theme/art";
import { Badge, Panel, PanelTitle, ActionButton } from "../ui/primitives";

/**
 * The Systems workspace (Section 24/26): a master → detail drill-down. The left rail lists the
 * charter's claimed systems; selecting one slides open a wide panel listing that system's worlds at
 * a glance; selecting a world opens its full colony screen (deposits + build menu).
 */
export function Systems() {
  const { view } = useApp();
  const [selSys, setSelSys] = useState<string | null>(null);
  const [selBody, setSelBody] = useState<string | null>(null);
  if (!view) return null;
  const galaxy = view.galaxy;
  const owned = view.me.ownedSystemIds.map((id) => galaxy.system(id));
  const sys = selSys ? galaxy.systems.get(selSys) ?? null : null;
  const canBuild = !view.me.isFreeOperator;

  // Drive only this screen's local state — the right-sidebar inspector is hidden on the Systems
  // screen, so we deliberately don't call store.select here (that would resurface the old panel).
  const pickSystem = (id: string) => { setSelSys(id); setSelBody(null); };

  return (
    <div className="systems2">
      <aside className="systems2__list">
        <PanelTitle icon="systems" eyebrow="Charter Holdings" title={`Your Systems (${owned.length})`} />
        {owned.length === 0 ? (
          <p className="hint">No systems yet. Claim an open system from the Map to begin extraction.</p>
        ) : (
          <div className="syslist">
            {owned.map((s) => {
              const worked = s.sites.filter((x) => x.extractorLevel > 0).length;
              return (
                <button
                  key={s.id}
                  type="button"
                  className={`syslist__row${s.id === selSys ? " is-active" : ""}`}
                  onClick={() => pickSystem(s.id)}
                >
                  <PlanetArt archetype={systemArchetype(s)} className="syslist__art" />
                  <div className="syslist__text">
                    <strong>{s.name}</strong>
                    <span className="syslist__sub">
                      {populationLabel[s.populationStage]} · {worked}/{s.sites.length} worked
                    </span>
                  </div>
                  <span className="syslist__chev" aria-hidden>›</span>
                </button>
              );
            })}
          </div>
        )}
      </aside>

      <section className="systems2__detail" key={selSys ?? "none"}>
        {!sys ? (
          <Panel className="systems2__empty">
            <p className="hint">Select one of your systems to view its worlds.</p>
          </Panel>
        ) : selBody ? (
          <PlanetDetail sys={sys} bodyKey={selBody} view={view} canBuild={canBuild} onBack={() => setSelBody(null)} />
        ) : (
          <SystemView sys={sys} view={view} canBuild={canBuild} onPickBody={setSelBody} />
        )}
      </section>
    </div>
  );
}

/** Level 2 — a system overview: header + container actions + a roster of its worlds (high level). */
function SystemView({ sys, view, canBuild, onPickBody }: { sys: System; view: PlayerView; canBuild: boolean; onPickBody: (key: string) => void }) {
  const t = view.config.tuning;
  const colonies = coloniesOf(sys);
  const names = colonyNames(sys.name, colonies);
  const prices = view.market.prices;

  return (
    <Panel className="sysview">
      <div className="sysview__head">
        {sys.bodies?.starType ? <StarArt starType={sys.bodies.starType} className="sysview__star" /> : null}
        <div className="sysview__title">
          <h2>{sys.name}</h2>
          <span className="sysview__sub">
            {sys.bodies?.starType ? starTypeLabel[sys.bodies.starType] : "Charter system"} · {populationLabel[sys.populationStage]}
          </span>
        </div>
        {canBuild && <PowerMeter sys={sys} view={view} />}
      </div>

      <div className="sysview__stats">
        <div><dt>Worlds</dt><dd>{colonies.length}</dd></div>
        <div><dt>Yield</dt><dd>{sumPotential(sys).toFixed(0)}/t</dd></div>
        <div><dt>Stock</dt><dd>{formatCr(stockpileValue(sys.stockpile, prices))}</dd></div>
        <div><dt>Upkeep</dt><dd>{formatCr(sys.upkeep)}/t</dd></div>
      </div>

      {canBuild && (
        <div className="sysview__actions">
          <ActionButton icon="exchange" onClick={() => { store.select({ kind: "system", id: sys.id }); store.setNav("exchange"); }}>Trade</ActionButton>
          {!sys.hasDepot && <ActionButton icon="systems" onClick={() => store.stage({ kind: "buildDepot", systemId: sys.id })}>Depot</ActionButton>}
          {sys.platforms < t.platformCap && <ActionButton icon="shield" onClick={() => store.stage({ kind: "buildPlatform", systemId: sys.id })}>Platform</ActionButton>}
          <ActionButton icon="radar" title={`Build a survey vessel · ${formatCr(t.surveyShipCost)}`} onClick={() => store.stage({ kind: "buildSurveyShip", systemId: sys.id })}>Survey ship</ActionButton>
        </div>
      )}

      <h4 className="composition__title">Worlds ({colonies.length})</h4>
      <div className="roster">
        {colonies.map((c) => (
          <WorldRow key={c.key} colony={c} starType={sys.bodies?.starType} name={names.get(c.key) ?? c.bodyLabel} onClick={() => onPickBody(c.key)} />
        ))}
      </div>
    </Panel>
  );
}

/** A single high-level world row in the system roster (clickable → full detail). */
function WorldRow({ colony, starType, name, onClick }: { colony: ColonyInfo; starType?: StarType; name: string; onClick: () => void }) {
  const typeLabel =
    colony.kind === "belt" ? "Asteroid belt"
    : colony.kind === "star" ? colony.bodyLabel
    : planetTypeLabel[colony.bodyType as keyof typeof planetTypeLabel] ?? colony.bodyLabel;
  const worked = colony.sites.filter((s) => s.extractorLevel > 0).length;
  const b = colony.buildings;
  const factories = Object.values(b.processors).reduce((s, n) => s + n, 0);
  const builds = [
    factories ? `${factories}⚙` : "",
    b.reactors ? `${b.reactors}⚡` : "",
    b.hydroponics ? `${b.hydroponics}🌱` : "",
  ].filter(Boolean).join(" ");
  const queued = colony.queue.length;

  return (
    <button type="button" className="roster__row" onClick={onClick}>
      {colony.kind === "star" && starType ? (
        <StarArt starType={starType} className="roster__art" />
      ) : colony.kind === "planet" ? (
        <PlanetTypeArt planetType={colony.bodyType as never} className="roster__art" />
      ) : (
        <span className={`roster__art${colony.kind === "belt" ? " colony__belt" : ""}`} aria-hidden />
      )}
      <div className="roster__text">
        <strong>{name}</strong>
        <span className="roster__sub">{typeLabel}{colony.habitable ? " · habitable" : ""}</span>
      </div>
      <div className="roster__meta">
        {colony.population && <Badge tone="neutral">{populationLabel[colony.population.stage]}</Badge>}
        {colony.sites.length > 0 && (
          <span className="roster__deps" title="worked / total deposits">
            {colony.sites.slice(0, 4).map((s) => (
              <ResourceIcon key={s.key} resource={s.resource} size={14} />
            ))}
            <span className="roster__count">{worked}/{colony.sites.length}</span>
          </span>
        )}
        {builds && <span className="roster__builds">{builds}</span>}
        {queued > 0 && <Badge tone="accent">{queued} building</Badge>}
      </div>
      <span className="roster__chev" aria-hidden>›</span>
    </button>
  );
}

/** Level 3 — the full colony screen for one world (deposits + build menu), with a back link. */
function PlanetDetail({ sys, bodyKey, view, canBuild, onBack }: { sys: System; bodyKey: string; view: PlayerView; canBuild: boolean; onBack: () => void }) {
  const colonies = coloniesOf(sys);
  const colony = colonies.find((c) => c.key === bodyKey);
  const names = colonyNames(sys.name, colonies);
  if (!colony) { onBack(); return null; }
  return (
    <Panel className="planetdetail">
      <button type="button" className="planetdetail__back" onClick={onBack}>‹ {sys.name}</button>
      <ColonyCard colony={colony} name={names.get(colony.key) ?? colony.bodyLabel} sys={sys} view={view} canBuild={canBuild} />
    </Panel>
  );
}
