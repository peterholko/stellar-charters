import {
  EXTRACTOR_CAP,
  agriFoodMult,
  canBuildOnBody,
  coloniesOf,
  constructionCpCost,
  factoryCostMult,
  systemBuildings,
  systemSeed,
  stellarOutputMult,
  type ColonyInfo,
  type PlayerView,
  type System,
} from "@engine";
import { store } from "../match/store";
import { formatCr, planetTypeLabel, populationLabel, resourceLabels } from "../match/format";
import { ActionButton, Badge, Bar } from "../ui/primitives";
import { ArtSlot, PlanetTypeArt, StarArt } from "../theme/ArtSlot";
import { ResourceIcon } from "../theme/art";

/** "8 alloys + 6 metals" — the materials a colony building consumes besides credits (Section 27). */
function matsLabel(costs: Record<string, number | undefined>): string {
  return Object.entries(costs)
    .filter(([, n]) => (n ?? 0) > 0)
    .map(([r, n]) => `${n} ${(resourceLabels[r as keyof typeof resourceLabels] ?? r).toLowerCase()}`)
    .join(" + ");
}

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
  const names = colonyNames(sys.name, colonies);

  return (
    <div className="colonies">
      <div className="colonies__head">
        <h4 className="composition__title">Colonies ({colonies.length})</h4>
        {canBuild && <PowerMeter sys={sys} view={view} />}
      </div>
      <div className="colonies__list">
        {colonies.map((c) => (
          <ColonyCard key={c.key} colony={c} name={names.get(c.key) ?? c.bodyLabel} sys={sys} view={view} canBuild={canBuild} />
        ))}
      </div>
    </div>
  );
}

const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "XIV", "XV", "XVI", "XVII", "XVIII", "XIX", "XX"];
const roman = (n: number): string => ROMAN[n] ?? String(n);

/** Conventional planetary designations: "<System> <Roman numeral>" numbered by orbital order
 *  (planets only). Belts read "<System> Belt[ n]", the star's corona "<System> Corona". */
export function colonyNames(sysName: string, colonies: ColonyInfo[]): Map<string, string> {
  const names = new Map<string, string>();
  const beltCount = colonies.filter((c) => c.kind === "belt").length;
  let p = 0;
  let b = 0;
  for (const c of colonies) {
    if (c.kind === "planet") names.set(c.key, `${sysName} ${roman(++p)}`);
    else if (c.kind === "belt") names.set(c.key, beltCount > 1 ? `${sysName} Belt ${++b}` : `${sysName} Belt`);
    else names.set(c.key, `${sysName} Corona`);
  }
  return names;
}

/** System-wide power balance — factory draw vs. base + power-grid + reactor capacity (Section 07b). */
export function PowerMeter({ sys, view }: { sys: System; view: PlayerView }) {
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

export function ColonyCard({
  colony,
  name,
  sys,
  view,
  canBuild,
}: {
  colony: ColonyInfo;
  name: string;
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
  // Reflect orders already staged this turn so a click gives immediate feedback (these resolve next turn).
  const staged = store.state.staged;
  const workStaged = (key: string) => staged.some((s) => s.order.kind === "buildExtractor" && s.order.siteKey === key);
  // World type → shown as the subtitle now that the title carries the planet's designation.
  const typeLabel =
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
          <strong>{name}</strong>
          <span className="colony__sub">
            {typeLabel}
            {colony.orbit >= 0 ? ` · orbit ${colony.orbit}` : ""}
            {colony.habitable ? " · habitable" : ""}
          </span>
        </div>
        {colony.population && <Badge tone="neutral">{populationLabel[colony.population.stage]}</Badge>}
        {stellarBadge && <Badge tone={stellarBadge.tone}>{stellarBadge.label}</Badge>}
      </div>

      {colony.population && (
        <div className="colony__pop">
          <Bar
            value={colony.population.progress}
            max={view.config.tuning.growthThreshold}
            tone={colony.population.unrest > 0.01 ? "warn" : "positive"}
          />
          {colony.population.unrest > 0.01 && <span className="colony__unrest">unrest {Math.round(colony.population.unrest * 100)}%</span>}
        </div>
      )}

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
                    workStaged(site.key) ? (
                      <Badge tone="accent">{worked ? "Deepen queued" : "Work queued"}</Badge>
                    ) : (
                      <ActionButton
                        icon="systems"
                        onClick={() => store.stage({ kind: "buildExtractor", systemId: sys.id, siteKey: site.key })}
                      >
                        {worked ? "Deepen" : "Work"}
                      </ActionButton>
                    )
                  )}
                  {!site.prospected && <span className="site-row__unsurveyed">unsurveyed — send a survey vessel</span>}
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

interface BuildOpt {
  key: string;
  /** Art-slot id for the building's icon (placeholder until the PNG is generated). */
  art: string;
  name: string;
  desc: string;
  /** e.g. "×2" for countables, "Lv 1/4" for upgrade tracks. */
  have: string;
  costNote: string;
  /** Whole turns to raise at the colony's current construction rate. */
  turns: number;
  afford: boolean;
  maxed?: boolean;
  action: string; // button label
  onClick: () => void;
}

/** Per-body build menu (Section 24): each option shows what it does, its cost, and how long it takes.
 *  Every order carries `bodyKey: colony.key`, so the build lands on this specific world. */
function ColonyBuilds({ colony, sys, view }: { colony: ColonyInfo; sys: System; view: PlayerView }) {
  const t = view.config.tuning;
  const inf = t.infrastructure;
  const b = colony.buildings;
  const credits = view.me.credits;
  const type = colony.bodyType;
  const factoryMult = factoryCostMult(type);
  const agriMult = agriFoodMult(type);
  const rate = t.construction.pointsPerTurn;
  const turnsOf = (kind: Parameters<typeof constructionCpCost>[1], tier = 1) => Math.max(1, Math.ceil(constructionCpCost(t, kind, tier) / rate));
  const resList = (m: Record<string, number | undefined>) =>
    Object.entries(m).filter(([, n]) => (n ?? 0) > 0).map(([r, n]) => `${n} ${(resourceLabels[r as keyof typeof resourceLabels] ?? r).toLowerCase()}`).join(" + ");

  const opts: BuildOpt[] = [];
  if (canBuildOnBody("factory", type)) {
    for (const r of t.recipes) {
      const cost = Math.round(r.buildCost * factoryMult);
      const ins = resList(r.inputs);
      const outs = resList(r.outputs);
      opts.push({
        key: `f-${r.id}`, art: "building-factory",
        name: `${r.id} factory`,
        desc: `Each turn refines ${ins} → ${outs} (needs power).`,
        have: `×${b.processors[r.id] ?? 0}`,
        costNote: `${formatCr(cost)} + ${matsLabel(t.buildResources.factory)}${factoryMult !== 1 ? ` · ${type} ×${factoryMult}` : ""}`,
        turns: turnsOf("factory", r.tier),
        afford: credits >= cost,
        action: "Build",
        onClick: () => store.stage({ kind: "buildProcessor", systemId: sys.id, recipeId: r.id, bodyKey: colony.key }),
      });
    }
  }
  if (canBuildOnBody("reactor", type)) {
    opts.push({
      key: "reactor", art: "building-reactor", name: "Reactor",
      desc: `Adds +${t.reactorPowerOutput} power; burns helium-3 to keep this system's factories running.`,
      have: `×${b.reactors}`,
      costNote: `${formatCr(t.reactorCost)} + ${matsLabel(t.buildResources.reactor)}`,
      turns: turnsOf("reactor"), afford: credits >= t.reactorCost, action: "Build",
      onClick: () => store.stage({ kind: "buildReactor", systemId: sys.id, bodyKey: colony.key }),
    });
  }
  if (canBuildOnBody("agridome", type)) {
    opts.push({
      key: "agridome", art: "building-agridome", name: "Agri-dome",
      desc: `Converts ice into food (×${agriMult} on a ${(planetTypeLabel[type as keyof typeof planetTypeLabel] ?? "world").toLowerCase()}); local food fuels population growth.`,
      have: `×${b.hydroponics}`,
      costNote: `${formatCr(t.hydroponicsCost)} + ${matsLabel(t.buildResources.agridome)}`,
      turns: turnsOf("agridome"), afford: credits >= t.hydroponicsCost, action: "Build",
      onClick: () => store.stage({ kind: "buildHydroponics", systemId: sys.id, bodyKey: colony.key }),
    });
  }
  if (canBuildOnBody("mining", type)) {
    const lvl = b.miningRigs, cost = inf.miningCreditCost * (lvl + 1);
    opts.push({
      key: "mining", art: "building-miningrig", name: "Mining rig",
      desc: "Fortifies the system against raids and trims its per-turn upkeep, each level.",
      have: `Lv ${lvl}/${inf.cap}`,
      costNote: `${formatCr(cost)} + ${inf.miningMetalsCost * (lvl + 1)} metals`,
      turns: turnsOf("mining"), afford: credits >= cost, maxed: lvl >= inf.cap, action: "Upgrade",
      onClick: () => store.stage({ kind: "upgradeInfrastructure", systemId: sys.id, track: "mining", bodyKey: colony.key }),
    });
  }
  if (canBuildOnBody("habitat", type)) {
    const lvl = b.habitats, cost = inf.habitatCreditCost * (lvl + 1);
    opts.push({
      key: "habitat", art: "building-habitat", name: "Habitat",
      desc: "Speeds this colony's population growth and raises the tax it pays, each level.",
      have: `Lv ${lvl}/${inf.cap}`,
      costNote: `${formatCr(cost)} + ${inf.habitatSilicatesCost * (lvl + 1)} silicates`,
      turns: turnsOf("habitat"), afford: credits >= cost, maxed: lvl >= inf.cap, action: "Upgrade",
      onClick: () => store.stage({ kind: "upgradeInfrastructure", systemId: sys.id, track: "habitat", bodyKey: colony.key }),
    });
  }
  if (canBuildOnBody("power", type)) {
    const lvl = b.powerGrid, cost = inf.powerCreditCost * (lvl + 1);
    opts.push({
      key: "power", art: "building-powergrid", name: "Power grid",
      desc: `Adds +${inf.powerCapacityPerLevel} baseline power per level — a cheaper standby than reactors.`,
      have: `Lv ${lvl}/${inf.cap}`,
      costNote: `${formatCr(cost)} + ${inf.powerHelium3Cost * (lvl + 1)} helium-3`,
      turns: turnsOf("power"), afford: credits >= cost, maxed: lvl >= inf.cap, action: "Upgrade",
      onClick: () => store.stage({ kind: "upgradeInfrastructure", systemId: sys.id, track: "power", bodyKey: colony.key }),
    });
  }

  return (
    <div className="colony__builds">
      <span className="colony__buildlabel">Build</span>
      <div className="boptlist">
        {opts.map((o) => (
          <div key={o.key} className={`bopt${o.maxed ? " bopt--maxed" : ""}`}>
            <ArtSlot slot={o.art} className="bopt__art" />
            <div className="bopt__info">
              <div className="bopt__top"><strong>{o.name}</strong><span className="bopt__have">{o.have}</span></div>
              <p className="bopt__desc">{o.desc}</p>
              <span className="bopt__cost">{o.costNote} · <span className="bopt__time">~{o.turns} turn{o.turns === 1 ? "" : "s"}</span></span>
            </div>
            <button
              type="button"
              className={`bopt__btn${o.afford || o.maxed ? "" : " bopt__btn--poor"}`}
              disabled={o.maxed}
              title={o.maxed ? "At maximum level" : `${o.action} · ${o.costNote} · ~${o.turns} turns`}
              onClick={o.onClick}
            >
              {o.maxed ? "Max" : o.action}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
