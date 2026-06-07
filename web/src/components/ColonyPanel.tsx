import {
  EXTRACTOR_CAP,
  agriFoodMult,
  canBuildOnBody,
  coloniesOf,
  factoryCostMult,
  systemBuildings,
  systemSeed,
  stellarOutputMult,
  type ColonyInfo,
  type PlayerView,
  type System,
} from "@engine";
import { store } from "../match/store";
import { formatCr, planetTypeLabel, resourceLabels } from "../match/format";
import { ActionButton, Badge } from "../ui/primitives";
import { PlanetTypeArt, StarArt } from "../theme/ArtSlot";
import { ResourceIcon } from "../theme/art";

/**
 * The colony screen (Section 24): the system is a container; each planet / belt / star is a
 * first-class colony you develop. For an owned system this is the Master-of-Orion-style management
 * surface — pick a body, work its deposits, and build its factories, reactor, agri-dome, and
 * infrastructure (each build order carries the body's `bodyKey`). For a rival/unowned system it is a
 * read-only roster of the worlds and their (fogged) deposits.
 *
 * Power is pooled at the system (Phase 1 re-home kept it balance-neutral), so the power meter is
 * system-wide while factories/reactors are built per body — exactly what the engine resolves.
 */
export function ColonyPanel({
  sys,
  view,
  canBuild,
}: {
  sys: System;
  view: PlayerView;
  canBuild: boolean;
}) {
  const colonies = coloniesOf(sys);
  if (colonies.length === 0) return null;
  const t = view.config.tuning;

  return (
    <div className="colonies">
      <div className="colonies__head">
        <h4 className="composition__title">Colonies ({colonies.length})</h4>
        {canBuild && <PowerMeter sys={sys} view={view} />}
      </div>
      <div className="colonies__list">
        {colonies.map((c) => (
          <ColonyCard key={c.key} colony={c} sys={sys} view={view} canBuild={canBuild} />
        ))}
      </div>
    </div>
  );
}

/** System-wide power balance — factory draw vs. base + power-grid + reactor capacity (Section 07b). */
function PowerMeter({ sys, view }: { sys: System; view: PlayerView }) {
  const t = view.config.tuning;
  const b = systemBuildings(sys);
  let draw = 0;
  for (const r of t.recipes) draw += (b.processors[r.id] ?? 0) * r.powerDraw;
  const capacity =
    t.basePowerPerSystem +
    b.powerGrid * t.infrastructure.powerCapacityPerLevel +
    b.reactors * t.reactorPowerOutput;
  if (draw <= 0 && b.reactors === 0) return null;
  const short = draw > capacity;
  return (
    <Badge tone={short ? "negative" : draw > 0 ? "accent" : "neutral"}>
      Power {draw.toFixed(0)}/{capacity.toFixed(0)}
      {short ? " — brownout" : ""}
    </Badge>
  );
}

function ColonyCard({
  colony,
  sys,
  view,
  canBuild,
}: {
  colony: ColonyInfo;
  sys: System;
  view: PlayerView;
  canBuild: boolean;
}) {
  const turn = view.turn;
  const star = sys.bodies?.starType;
  // Any stellar event acting on this body's output this turn (flare brownout / pulse surge).
  const stellar = star
    ? colony.sites.reduce(
        (acc, s) => {
          const m = stellarOutputMult(star, s, systemSeed(sys), turn, view.config.turns);
          return { min: Math.min(acc.min, m), max: Math.max(acc.max, m) };
        },
        { min: 1, max: 1 },
      )
    : { min: 1, max: 1 };
  const stellarBadge =
    stellar.min <= 0
      ? { tone: "negative" as const, label: "Flare — offline" }
      : stellar.max > 1.05
        ? { tone: "accent" as const, label: "Output surge" }
        : stellar.min < 0.95
          ? { tone: "warn" as const, label: "Output dampened" }
          : null;

  const sites = [...colony.sites].sort((a, b) => a.resource.localeCompare(b.resource));
  const label =
    colony.kind === "belt"
      ? "Asteroid belt"
      : colony.kind === "star"
        ? colony.bodyLabel
        : planetTypeLabel[colony.bodyType as keyof typeof planetTypeLabel] ?? colony.bodyLabel;

  return (
    <div className="colony">
      <div className="colony__head">
        {colony.kind === "star" && star ? (
          <StarArt starType={star} className="colony__art" />
        ) : colony.kind === "planet" ? (
          <PlanetTypeArt planetType={colony.bodyType as never} className="colony__art" />
        ) : (
          <span className="colony__art colony__belt" aria-hidden />
        )}
        <div className="colony__title">
          <strong>{label}</strong>
          <span className="colony__sub">
            {colony.orbit >= 0 ? `orbit ${colony.orbit}` : "corona"}
            {colony.habitable ? " · habitable" : ""}
          </span>
        </div>
        {stellarBadge && <Badge tone={stellarBadge.tone}>{stellarBadge.label}</Badge>}
      </div>

      <div className="colony__deposits">
        {sites.length === 0 && <span className="colony__empty">No deposits</span>}
        {sites.map((site) => {
          const offline = site.disabledUntil > turn;
          const dry = site.reservesRemaining !== null && site.reservesRemaining <= 0;
          const worked = site.extractorLevel > 0;
          const reserveStr = !site.prospected
            ? "reserves ?"
            : site.reservesRemaining === null
              ? "renewable"
              : `${Math.round(site.reservesRemaining)} left`;
          return (
            <div key={site.key} className={`site-row${offline ? " site-row--offline" : ""}`}>
              <div className="site-row__body">
                <ResourceIcon resource={site.resource} size={16} />
                <div className="site-row__text">
                  <strong>{resourceLabels[site.resource]}</strong>
                  <span className="site-row__sub">
                    {site.prospected ? `rich ${site.richness}` : "unsurveyed"} · {reserveStr}
                  </span>
                </div>
                <span className="site-row__ext">
                  {offline ? (
                    <Badge tone="negative">Offline</Badge>
                  ) : dry ? (
                    <Badge tone="neutral">Depleted</Badge>
                  ) : worked ? (
                    <Badge tone="accent">
                      Lv {site.extractorLevel}/{EXTRACTOR_CAP}
                    </Badge>
                  ) : (
                    <Badge tone="neutral">Unworked</Badge>
                  )}
                </span>
              </div>
              {canBuild && (
                <div className="site-row__actions">
                  {site.extractorLevel < EXTRACTOR_CAP && !dry && (
                    <ActionButton
                      icon="systems"
                      onClick={() => store.stage({ kind: "buildExtractor", systemId: sys.id, siteKey: site.key })}
                    >
                      {worked ? "Deepen" : "Work"}
                    </ActionButton>
                  )}
                  {!site.prospected && (
                    <ActionButton
                      icon="radar"
                      title={`Assay · ${formatCr(view.config.tuning.assayCost)}`}
                      onClick={() => store.stage({ kind: "assay", systemId: sys.id, siteKey: site.key })}
                    >
                      Assay
                    </ActionButton>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {colony.queue.length > 0 && <ColonyQueue colony={colony} rate={view.config.tuning.construction.pointsPerTurn} />}
      {canBuild && colony.kind !== "star" && <ColonyBuilds colony={colony} sys={sys} view={view} />}
    </div>
  );
}

const QUEUE_LABEL: Record<string, string> = {
  factory: "factory", reactor: "reactor", agridome: "agri-dome",
  mining: "mining rig", habitat: "habitat", power: "power grid",
};

/** The colony's construction queue (Section 24, Phase 4a): front item building, rest waiting. */
function ColonyQueue({ colony, rate }: { colony: ColonyInfo; rate: number }) {
  return (
    <div className="colony__queue">
      <span className="colony__buildlabel">Under construction</span>
      <div className="colony__queuelist">
        {colony.queue.map((item, i) => {
          const label = item.kind === "factory" ? `${item.recipeId ?? "factory"} factory` : QUEUE_LABEL[item.kind] ?? item.kind;
          const frac = Math.max(0, Math.min(1, item.cpDone / item.cpCost));
          const turnsLeft = rate > 0 ? Math.ceil((item.cpCost - item.cpDone) / rate) : 0;
          return (
            <div key={i} className={`queue-row${i === 0 ? " queue-row--active" : ""}`}>
              <span className="queue-row__label">{label}</span>
              {i === 0 ? (
                <span className="queue-row__bar"><span className="queue-row__fill" style={{ width: `${Math.round(frac * 100)}%` }} /></span>
              ) : (
                <span className="queue-row__wait">queued</span>
              )}
              <span className="queue-row__eta">{i === 0 ? `~${turnsLeft}t` : ""}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Per-body build menu (Section 24): factories, reactor, agri-dome, and the 07c upgrade tracks.
 *  Every order carries `bodyKey: colony.key`, so the build lands on this specific world. */
function ColonyBuilds({ colony, sys, view }: { colony: ColonyInfo; sys: System; view: PlayerView }) {
  const t = view.config.tuning;
  const inf = t.infrastructure;
  const b = colony.buildings;
  const credits = view.me.credits;
  const type = colony.bodyType;
  // What this world type can host (Section 24) — domes/habitats need a livable surface, etc.
  const canFactory = canBuildOnBody("factory", type);
  const canReactor = canBuildOnBody("reactor", type);
  const canAgri = canBuildOnBody("agridome", type);
  const canHab = canBuildOnBody("habitat", type);
  const canMining = canBuildOnBody("mining", type);
  const canPower = canBuildOnBody("power", type);
  const factoryMult = factoryCostMult(type);
  const agriMult = agriFoodMult(type);

  return (
    <div className="colony__builds">
      <span className="colony__buildlabel">Buildings</span>
      <div className="colony__buildgrid">
        {canFactory &&
          t.recipes.map((r) => {
            const cost = Math.round(r.buildCost * factoryMult);
            return (
              <BuildChip
                key={r.id}
                label={`${r.id} factory`}
                count={b.processors[r.id] ?? 0}
                costNote={`${formatCr(cost)} + ${t.buildAlloyCost} alloys${factoryMult !== 1 ? ` (${type} ×${factoryMult})` : ""}`}
                afford={credits >= cost}
                onClick={() => store.stage({ kind: "buildProcessor", systemId: sys.id, recipeId: r.id, bodyKey: colony.key })}
              />
            );
          })}
        {canReactor && (
          <BuildChip
            label="Reactor"
            count={b.reactors}
            costNote={`${formatCr(t.reactorCost)} + ${t.buildAlloyCost} alloys`}
            afford={credits >= t.reactorCost}
            onClick={() => store.stage({ kind: "buildReactor", systemId: sys.id, bodyKey: colony.key })}
          />
        )}
        {canAgri && (
          <BuildChip
            label="Agri-dome"
            count={b.hydroponics}
            costNote={`${formatCr(t.hydroponicsCost)} · food ×${agriMult}`}
            afford={credits >= t.hydroponicsCost}
            onClick={() => store.stage({ kind: "buildHydroponics", systemId: sys.id, bodyKey: colony.key })}
          />
        )}
        {canMining && (
          <UpgradeChip
            label="Mining rig"
            level={b.miningRigs}
            cap={inf.cap}
            costNote={`${formatCr(inf.miningCreditCost * (b.miningRigs + 1))} + ${inf.miningMetalsCost * (b.miningRigs + 1)} metals`}
            afford={credits >= inf.miningCreditCost * (b.miningRigs + 1)}
            onClick={() => store.stage({ kind: "upgradeInfrastructure", systemId: sys.id, track: "mining", bodyKey: colony.key })}
          />
        )}
        {canHab && (
          <UpgradeChip
            label="Habitat"
            level={b.habitats}
            cap={inf.cap}
            costNote={`${formatCr(inf.habitatCreditCost * (b.habitats + 1))} + ${inf.habitatSilicatesCost * (b.habitats + 1)} silicates`}
            afford={credits >= inf.habitatCreditCost * (b.habitats + 1)}
            onClick={() => store.stage({ kind: "upgradeInfrastructure", systemId: sys.id, track: "habitat", bodyKey: colony.key })}
          />
        )}
        {canPower && (
          <UpgradeChip
            label="Power grid"
            level={b.powerGrid}
            cap={inf.cap}
            costNote={`${formatCr(inf.powerCreditCost * (b.powerGrid + 1))} + ${inf.powerHelium3Cost * (b.powerGrid + 1)} helium-3`}
            afford={credits >= inf.powerCreditCost * (b.powerGrid + 1)}
            onClick={() => store.stage({ kind: "upgradeInfrastructure", systemId: sys.id, track: "power", bodyKey: colony.key })}
          />
        )}
      </div>
    </div>
  );
}

/** A countable building (factories / reactor / agri-dome): shows current count + a build button. */
function BuildChip({
  label,
  count,
  costNote,
  afford,
  onClick,
}: {
  label: string;
  count: number;
  costNote: string;
  afford: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`build-chip${afford ? "" : " build-chip--poor"}`}
      title={`Build ${label} · ${costNote}`}
      onClick={onClick}
    >
      <span className="build-chip__label">{label}</span>
      <span className="build-chip__count">×{count}</span>
      <span className="build-chip__plus">+</span>
    </button>
  );
}

/** A levelled upgrade track (07c): shows level/cap + an upgrade button (disabled at the cap). */
function UpgradeChip({
  label,
  level,
  cap,
  costNote,
  afford,
  onClick,
}: {
  label: string;
  level: number;
  cap: number;
  costNote: string;
  afford: boolean;
  onClick: () => void;
}) {
  const maxed = level >= cap;
  return (
    <button
      type="button"
      className={`build-chip${maxed ? " build-chip--maxed" : afford ? "" : " build-chip--poor"}`}
      title={maxed ? `${label} at max (${cap})` : `Upgrade ${label} to L${level + 1} · ${costNote}`}
      disabled={maxed}
      onClick={onClick}
    >
      <span className="build-chip__label">{label}</span>
      <span className="build-chip__count">
        L{level}/{cap}
      </span>
      {!maxed && <span className="build-chip__plus">+</span>}
    </button>
  );
}
