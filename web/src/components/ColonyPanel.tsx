import {
  EXTRACTOR_CAP,
  agriFoodMult,
  canBuildOnBody,
  canHostPopulation,
  coloniesOf,
  constructionCpCost,
  factoryCostMult,
  researchMods,
  siteOutput,
  systemBuildings,
  systemSeed,
  stellarOutputMult,
  type ColonyInfo,
  type PlayerView,
  type Resource,
  type System,
} from "@engine";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { store } from "../match/store";
import { extractorNames, formatCr, planetTypeLabel, populationLabel, resourceLabels } from "../match/format";
import { ActionButton, Badge, Bar, Panel, PanelTitle } from "../ui/primitives";
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
      {/* ONE queue per system (review Section 10): items show the body they land on. */}
      {sys.queue.length > 0 && <SystemQueue sys={sys} names={names} rate={view.config.tuning.construction.pointsPerTurn} canBuild={canBuild} />}
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

/**
 * System-wide power balance — factory draw vs. base + power-grid + reactor capacity (Section 07b).
 * When the engine's authoritative production state is present (owner-only), the brown-out factor
 * and each recipe's limiting input are shown HARD — no silent multipliers (design rule #2).
 */
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
  const prod = sys.production;
  const throttled = prod ? prod.powerFactor < 1 : draw > capacity;
  return (
    <span className="powermeter">
      <Badge tone={throttled ? "negative" : draw > 0 ? "accent" : "neutral"}>
        Power {draw.toFixed(0)}/{capacity.toFixed(0)}
        {throttled ? ` — BROWNOUT ×${(prod?.powerFactor ?? capacity / Math.max(1, draw)).toFixed(2)}` : ""}
      </Badge>
      {prod?.limited.map((l) => (
        <Badge key={l.recipeId} tone="warn">
          {l.recipeId}: {resourceLabels[l.input].toLowerCase()}-limited ×{l.ratio.toFixed(2)}
        </Badge>
      ))}
    </span>
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
        {/* Population is per-SYSTEM now (review Section 10) — the Inspector pop-meter shows it;
            a body just signals whether it supports the population. */}
        {canHostPopulation(colony) && <Badge tone="neutral">{populationLabel[sys.populationStage]}</Badge>}
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
          // The deposit reads as a leveled STRUCTURE (playtest feedback): "Metal Mine L2 —
          // producing 4.2/t". Building/upgrading it lives in the Build-structure catalogue with
          // every other structure — this row is the status readout, with a tooltip pointing there.
          const star = sys.bodies?.starType;
          const seed = systemSeed(sys);
          const out = siteOutput(site, star, seed, turn, view.config.turns);
          const mineName = extractorNames[site.resource];
          const buildable = canBuild && site.extractorLevel < EXTRACTOR_CAP && !dry;
          const hint = buildable
            ? worked
              ? `Upgrade to ${mineName} L${site.extractorLevel + 1} via the "Build structure" button below`
              : `Work this deposit: build a ${mineName} via the "Build structure" button below`
            : undefined;
          return (
            <div key={site.key} className={`site-row${offline ? " site-row--offline" : ""}`} title={hint}>
              <div className="site-row__body">
                <ResourceIcon resource={site.resource} size={16} />
                <div className="site-row__text">
                  <strong>{worked ? `${mineName} L${site.extractorLevel}` : `${resourceLabels[site.resource]} deposit`}</strong>
                  <span className="site-row__sub">
                    {site.prospected ? `rich ${site.richness}` : "unsurveyed"} · {reserveStr}
                  </span>
                </div>
                <span className="site-row__ext">
                  {buildable && workStaged(site.key) && (
                    <Badge tone="accent">{worked ? `L${site.extractorLevel + 1} queued` : `${mineName} queued`}</Badge>
                  )}
                  {offline ? (
                    <Badge tone="negative">Offline</Badge>
                  ) : dry ? (
                    <Badge tone="neutral">Depleted</Badge>
                  ) : worked ? (
                    <Badge tone="accent">{out.toFixed(1)}/t</Badge>
                  ) : (
                    <Badge tone="neutral">Unworked</Badge>
                  )}
                </span>
              </div>
              {canBuild && !site.prospected && (
                <div className="site-row__actions">
                  <span className="site-row__unsurveyed">unsurveyed — send a survey vessel</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {canBuild && colony.kind !== "star" && (
        <BuildStructureLauncher
          colony={colony}
          name={name}
          typeLabel={typeLabel}
          sys={sys}
          view={view}
          // One QUEUED structure per body: while this world's slot is taken, the catalogue's
          // queue builds are disabled — extractors resolve instantly and stay available.
          queueBlocked={
            sys.queue.some((q) => q.kind !== "extractor" && q.bodyKey === colony.key)
              ? "This world's build slot is taken — remove the queued structure first."
              : staged.some((s) => "bodyKey" in s.order && s.order.bodyKey === colony.key && s.order.kind !== "cancelBuild" && s.order.kind !== "terraform")
                ? "A build for this world is already queued this turn."
                : null
          }
        />
      )}
    </div>
  );
}

/**
 * Compact construction entry point (playtest: the full per-body build menu drowned the inspector).
 * One "Build structure" button per colony; the catalogue itself opens in an overlay panel.
 * `queueBlocked` (one queued structure per body) disables the catalogue's queue builds —
 * extractors are instant and remain buildable.
 */
function BuildStructureLauncher({
  colony,
  name,
  typeLabel,
  sys,
  view,
  queueBlocked,
}: {
  colony: ColonyInfo;
  name: string;
  typeLabel: string;
  sys: System;
  view: PlayerView;
  queueBlocked?: string | null;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <div className="action-row">
        <ActionButton
          icon="systems"
          title={`Open the build catalogue for ${name}${queueBlocked ? ` — ${queueBlocked} Extractors stay available.` : ""}`}
          onClick={() => setOpen(true)}
        >
          Build structure
        </ActionButton>
      </div>
      {/* Portal to <body>: ancestors with backdrop-filter (.panel) hijack position:fixed in Chrome,
          which would pin the overlay to the inspector panel instead of the viewport. */}
      {open && createPortal(
        <div className="buildmodal" onClick={() => setOpen(false)}>
          <div className="buildmodal__inner" onClick={(e) => e.stopPropagation()}>
            <Panel className="buildmodal__panel">
              <PanelTitle
                icon="systems"
                eyebrow={typeLabel}
                title={`Build on ${name}`}
                right={
                  <button type="button" className="buildmodal__close" title="Close (Esc)" onClick={() => setOpen(false)}>
                    ✕
                  </button>
                }
              />
              {/* System-wide power context — the call a reactor/power-grid build hinges on. */}
              <PowerMeter sys={sys} view={view} />
              <ColonyBuilds colony={colony} sys={sys} view={view} queueBlocked={queueBlocked} onStaged={() => setOpen(false)} />
            </Panel>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

const QUEUE_LABEL: Record<string, string> = {
  factory: "factory", reactor: "reactor", agridome: "agri-dome",
  mining: "mining rig", habitat: "habitat", power: "power grid", lab: "research lab",
};

/** THE system's construction queue (review Section 10): one list, each item tagged with the body
 *  it lands on. Paid items build front-first; an unpaid item waits for its materials without
 *  blocking the rest, until they arrive or the player removes it (✕ → `cancelBuild`). */
function SystemQueue({ sys, names, rate, canBuild }: { sys: System; names: Map<string, string>; rate: number; canBuild: boolean }) {
  // The item construction points are flowing into: the first paid one (matches the engine).
  const activeIdx = sys.queue.findIndex((q) => q.paid);
  const staged = store.state.staged;
  const cancelStaged = (item: { bodyKey: string; siteKey?: string }) =>
    staged.some((s) =>
      s.order.kind === "cancelBuild" && s.order.systemId === sys.id &&
      (item.siteKey ? s.order.siteKey === item.siteKey : !s.order.siteKey && s.order.bodyKey === item.bodyKey));
  return (
    <div className="colony__queue">
      <span className="colony__buildlabel">Under construction</span>
      <div className="colony__queuelist">
        {sys.queue.map((item, i) => {
          const what =
            item.kind === "factory" ? `${item.recipeId ?? "factory"} factory`
            : item.kind === "extractor" ? (item.resource ? extractorNames[item.resource] : "extractor")
            : QUEUE_LABEL[item.kind] ?? item.kind;
          const where = names.get(item.bodyKey);
          const label = where ? `${what} @ ${where}` : what;
          const frac = item.cpCost > 0 ? Math.max(0, Math.min(1, item.cpDone / item.cpCost)) : 0;
          const turnsLeft = rate > 0 ? Math.ceil((item.cpCost - item.cpDone) / rate) : 0;
          const bill = `${formatCr(item.creditCost)}${Object.values(item.mats).some((n) => (n ?? 0) > 0) ? ` + ${matsLabel(item.mats)}` : ""}`;
          const removing = cancelStaged(item);
          return (
            <div key={item.siteKey ?? item.bodyKey} className={`queue-row${i === activeIdx ? " queue-row--active" : ""}${!item.paid ? " queue-row--waiting" : ""}${removing ? " queue-row--removing" : ""}`}>
              <span className="queue-row__label">{label}</span>
              {!item.paid ? (
                <span className="queue-row__wait" title={`Bill: ${bill} — charged automatically once it's all on hand`}>awaiting materials</span>
              ) : i === activeIdx ? (
                <span className="queue-row__bar"><span className="queue-row__fill" style={{ width: `${Math.round(frac * 100)}%` }} /></span>
              ) : (
                <span className="queue-row__wait">queued</span>
              )}
              <span className="queue-row__eta">{item.paid && i === activeIdx ? `~${turnsLeft}t` : ""}</span>
              {canBuild && (removing ? (
                <span className="queue-row__removing">removing…</span>
              ) : (
                <button
                  type="button"
                  className="queue-row__remove"
                  title={item.paid ? `Remove — refunds ${bill} (progress lost)` : "Remove from the queue (nothing was charged)"}
                  onClick={() => store.stage({ kind: "cancelBuild", systemId: sys.id, bodyKey: item.bodyKey, ...(item.siteKey ? { siteKey: item.siteKey } : {}) })}
                >
                  ✕
                </button>
              ))}
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
  /** Resource icon shown instead of `art` — used by extractor options. */
  icon?: Resource;
  name: string;
  desc: string;
  /** e.g. "×2" for countables, "Lv 1/4" for upgrade tracks. */
  have: string;
  /** The bill: credits + per-resource materials (rendered with icons; short ones highlighted). */
  credits: number;
  mats: Partial<Record<Resource, number>>;
  /** Extra cost context, e.g. "ocean ×1.2". */
  note?: string;
  /** Whole turns at the construction rate; 0 = instant (resolves next turn, e.g. extractors). */
  turns: number;
  afford: boolean;
  maxed?: boolean;
  /** Already staged this turn — shown as "Queued", disabled. */
  staged?: boolean;
  /** Set when the one-queued-structure-per-body rule blocks this option. */
  disabledReason?: string;
  action: string; // button label
  onClick: () => void;
}

/** Per-body build menu (Section 24): each option shows what it does, its bill (credits + material
 *  icons, shortfalls highlighted), and how long it takes. Deposit extractors appear here as regular
 *  structures alongside the buildings; they resolve instantly instead of via the queue. Every order
 *  carries `bodyKey: colony.key` (extractors their `siteKey`), so the build lands on this world.
 *  Rendered inside the build-structure overlay; staging an option closes it via `onStaged`. */
function ColonyBuilds({
  colony,
  sys,
  view,
  queueBlocked,
  onStaged,
}: {
  colony: ColonyInfo;
  sys: System;
  view: PlayerView;
  queueBlocked?: string | null;
  onStaged?: () => void;
}) {
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
  // Build bills draw on the corp's stockpiles across ALL owned systems (Section 27) — short
  // materials are highlighted in the bill so a missing "2 alloys" is impossible to miss.
  const stockOf = (r: Resource) =>
    view.me.ownedSystemIds.reduce((sum, id) => sum + (view.galaxy.systems.get(id)?.stockpile[r] ?? 0), 0);
  const staged = store.state.staged;

  const opts: BuildOpt[] = [];
  // Deposit extractors (Section 21) — regular structures in the catalogue, instant-on-affordability.
  const star = sys.bodies?.starType;
  const seed = systemSeed(sys);
  for (const site of [...colony.sites].sort((a, c) => a.resource.localeCompare(c.resource))) {
    const dry = site.reservesRemaining !== null && site.reservesRemaining <= 0;
    if (dry || site.extractorLevel >= EXTRACTOR_CAP) continue;
    const worked = site.extractorLevel > 0;
    const out = siteOutput(site, star, seed, view.turn, view.config.turns);
    const nextOut = siteOutput({ ...site, extractorLevel: site.extractorLevel + 1 }, star, seed, view.turn, view.config.turns);
    const factor = (site.extractorLevel + 1) * (1 + (1 - site.accessibility) * t.extractor.accessibilityMult);
    const cost = Math.round(t.extractor.buildCost * factor);
    const mineName = extractorNames[site.resource];
    const gain = site.prospected ? `${worked ? `+${(nextOut - out).toFixed(1)}` : `~${nextOut.toFixed(1)}`}/t` : "output unknown until surveyed";
    opts.push({
      key: `x-${site.key}`, art: "", icon: site.resource,
      name: worked ? `${mineName} L${site.extractorLevel + 1}` : mineName,
      desc: `Works this world's ${resourceLabels[site.resource].toLowerCase()} deposit${site.prospected ? ` (rich ${site.richness})` : ""} — ${gain}.`,
      have: worked ? `L${site.extractorLevel}/${EXTRACTOR_CAP}` : "",
      credits: cost, mats: { alloys: t.extractor.alloyCost },
      turns: 0, // instant: online next turn, no queue slot used
      afford: credits >= cost,
      staged: staged.some((s) => s.order.kind === "buildExtractor" && s.order.siteKey === site.key),
      action: worked ? "Upgrade" : "Build",
      onClick: () => store.stage({ kind: "buildExtractor", systemId: sys.id, siteKey: site.key }),
    });
  }
  // Terraforming (Section 28, Phase 2): turn a non-habitable world habitable, if research unlocked it.
  if (colony.kind === "planet" && !colony.habitable && researchMods(view.me.research.completed).canTerraform) {
    opts.push({
      key: "terraform", art: "building-agridome", name: "Terraform",
      desc: "Make this world habitable so it can seed and grow a population.",
      have: "", credits: t.terraformCost, mats: t.buildResources.agridome,
      turns: 1, afford: credits >= t.terraformCost, action: "Terraform",
      onClick: () => store.stage({ kind: "terraform", systemId: sys.id, bodyKey: colony.key }),
    });
  }
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
        credits: cost, mats: t.buildResources.factory,
        note: factoryMult !== 1 ? `${type} ×${factoryMult}` : undefined,
        turns: turnsOf("factory", r.tier),
        afford: credits >= cost,
        disabledReason: queueBlocked ?? undefined,
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
      credits: t.reactorCost, mats: t.buildResources.reactor,
      turns: turnsOf("reactor"), afford: credits >= t.reactorCost,
      disabledReason: queueBlocked ?? undefined, action: "Build",
      onClick: () => store.stage({ kind: "buildReactor", systemId: sys.id, bodyKey: colony.key }),
    });
  }
  if (canBuildOnBody("lab", type)) {
    opts.push({
      key: "lab", art: "building-lab", name: "Research Lab",
      desc: "Generates research points each turn toward your charter's tech tree (Research screen).",
      have: `×${b.labs}`,
      credits: t.labCost, mats: t.buildResources.lab,
      turns: turnsOf("lab"), afford: credits >= t.labCost,
      disabledReason: queueBlocked ?? undefined, action: "Build",
      onClick: () => store.stage({ kind: "buildLab", systemId: sys.id, bodyKey: colony.key }),
    });
  }
  if (canBuildOnBody("agridome", type)) {
    opts.push({
      key: "agridome", art: "building-agridome", name: "Agri-dome",
      desc: `Converts ice into food (×${agriMult} on a ${(planetTypeLabel[type as keyof typeof planetTypeLabel] ?? "world").toLowerCase()}); local food fuels population growth.`,
      have: `×${b.hydroponics}`,
      credits: t.hydroponicsCost, mats: t.buildResources.agridome,
      turns: turnsOf("agridome"), afford: credits >= t.hydroponicsCost,
      disabledReason: queueBlocked ?? undefined, action: "Build",
      onClick: () => store.stage({ kind: "buildHydroponics", systemId: sys.id, bodyKey: colony.key }),
    });
  }
  if (canBuildOnBody("mining", type)) {
    const lvl = b.miningRigs, cost = inf.miningCreditCost * (lvl + 1);
    opts.push({
      key: "mining", art: "building-miningrig", name: "Mining rig",
      desc: "Fortifies the system against raids and trims its per-turn upkeep, each level.",
      have: `Lv ${lvl}/${inf.cap}`,
      credits: cost, mats: { metals: inf.miningMetalsCost * (lvl + 1) },
      turns: turnsOf("mining"), afford: credits >= cost, maxed: lvl >= inf.cap,
      disabledReason: queueBlocked ?? undefined, action: "Upgrade",
      onClick: () => store.stage({ kind: "upgradeInfrastructure", systemId: sys.id, track: "mining", bodyKey: colony.key }),
    });
  }
  if (canBuildOnBody("habitat", type)) {
    const lvl = b.habitats, cost = inf.habitatCreditCost * (lvl + 1);
    opts.push({
      key: "habitat", art: "building-habitat", name: "Habitat",
      desc: "Speeds this colony's population growth and raises the tax it pays, each level.",
      have: `Lv ${lvl}/${inf.cap}`,
      credits: cost, mats: { silicates: inf.habitatSilicatesCost * (lvl + 1) },
      turns: turnsOf("habitat"), afford: credits >= cost, maxed: lvl >= inf.cap,
      disabledReason: queueBlocked ?? undefined, action: "Upgrade",
      onClick: () => store.stage({ kind: "upgradeInfrastructure", systemId: sys.id, track: "habitat", bodyKey: colony.key }),
    });
  }
  if (canBuildOnBody("power", type)) {
    const lvl = b.powerGrid, cost = inf.powerCreditCost * (lvl + 1);
    opts.push({
      key: "power", art: "building-powergrid", name: "Power grid",
      desc: `Adds +${inf.powerCapacityPerLevel} baseline power per level — a cheaper standby than reactors.`,
      have: `Lv ${lvl}/${inf.cap}`,
      credits: cost, mats: { helium3: inf.powerHelium3Cost * (lvl + 1) },
      turns: turnsOf("power"), afford: credits >= cost, maxed: lvl >= inf.cap,
      disabledReason: queueBlocked ?? undefined, action: "Upgrade",
      onClick: () => store.stage({ kind: "upgradeInfrastructure", systemId: sys.id, track: "power", bodyKey: colony.key }),
    });
  }

  return (
    <div className="colony__builds">
      <div className="boptlist">
        {opts.map((o) => {
          const billText = `${formatCr(o.credits)}${matsLabel(o.mats) ? ` + ${matsLabel(o.mats)}` : ""}`;
          const timeText = o.turns === 0 ? "online next turn" : `~${o.turns} turn${o.turns === 1 ? "" : "s"}`;
          const disabled = o.maxed || o.staged || !!o.disabledReason;
          // Everything missing from the bill, spelled out: red when short, green when covered.
          const creditsShort = credits < o.credits;
          const missing: string[] = creditsShort ? [`${Math.ceil(o.credits - credits).toLocaleString()} Cr`] : [];
          for (const [r, n] of Object.entries(o.mats) as [Resource, number | undefined][]) {
            if ((n ?? 0) > 0 && stockOf(r) < (n ?? 0)) missing.push(`${Math.ceil((n ?? 0) - stockOf(r))} ${resourceLabels[r].toLowerCase()}`);
          }
          // Materials short → the build is NOT staged. Instead the button jumps to the Exchange
          // with the import prepared (player reviews and stages it there), then builds after the
          // cargo lands. Goods not yet listed on the Exchange can only be produced locally.
          const listed = store.state.listedResources;
          const shortRes = (Object.entries(o.mats) as [Resource, number | undefined][])
            .filter(([r, n]) => (n ?? 0) > 0 && stockOf(r) < (n ?? 0))
            .map(([r, n]) => ({ r, shortBy: Math.ceil((n ?? 0) - stockOf(r)), listed: listed.includes(r) }));
          const importable = shortRes.filter((m) => m.listed);
          const unlistedOnly = shortRes.length > 0 && importable.length === 0;
          return (
            <div key={o.key} className={`bopt${o.maxed ? " bopt--maxed" : ""}`}>
              {o.icon ? (
                <span className="bopt__art bopt__art--resource"><ResourceIcon resource={o.icon} size={26} /></span>
              ) : (
                <ArtSlot slot={o.art} className="bopt__art" />
              )}
              <div className="bopt__info">
                <div className="bopt__top"><strong>{o.name}</strong><span className="bopt__have">{o.have}</span></div>
                <p className="bopt__desc">{o.desc}</p>
                <span className="bopt__cost">
                  <span className={creditsShort ? "bopt__short" : ""} title={creditsShort ? `${formatCr(o.credits)} — only ${formatCr(Math.floor(credits))} on hand` : undefined}>
                    {formatCr(o.credits)}
                  </span>
                  {(Object.entries(o.mats) as [Resource, number | undefined][])
                    .filter(([, n]) => (n ?? 0) > 0)
                    .map(([r, n]) => {
                      const short = stockOf(r) < (n ?? 0);
                      return (
                        <span
                          key={r}
                          className={`bopt__mat${short ? " bopt__short" : ""}`}
                          title={`${n} ${resourceLabels[r].toLowerCase()}${short ? ` — only ${Math.floor(stockOf(r))} on hand` : ""}`}
                        >
                          + <ResourceIcon resource={r} size={13} /> {n}
                        </span>
                      );
                    })}
                  {o.note && <span className="bopt__note"> · {o.note}</span>}
                  {" · "}
                  <span className="bopt__time">{timeText}</span>
                </span>
                {!o.maxed && (missing.length > 0 ? (
                  <span className="bopt__status bopt__status--short">✗ Short {missing.join(" + ")}</span>
                ) : (
                  <span className="bopt__status bopt__status--ok">✓ Enough resources / credits</span>
                ))}
              </div>
              <button
                type="button"
                className={`bopt__btn${shortRes.length > 0 ? " bopt__btn--import" : o.afford || disabled ? "" : " bopt__btn--poor"}`}
                disabled={disabled || unlistedOnly}
                title={
                  o.maxed ? "At maximum level"
                  : o.staged ? "Already queued this turn"
                  : o.disabledReason ? o.disabledReason
                  : unlistedOnly ? `Missing ${shortRes.map((m) => `${m.shortBy} ${resourceLabels[m.r].toLowerCase()}`).join(" + ")} — not traded on the Exchange yet; produce it locally first`
                  : importable.length
                    ? `Missing ${shortRes.map((m) => `${m.shortBy} ${resourceLabels[m.r].toLowerCase()}`).join(" + ")} — opens the Exchange with the import prepared; come back to build once it lands`
                    : `${o.action} · ${billText} · ${timeText}`
                }
                onClick={() => {
                  if (importable.length) {
                    // Do NOT stage the build — send the player to the Exchange with the first
                    // missing material's import ready to submit.
                    store.draftImport({ resource: importable[0]!.r, systemId: sys.id, quantity: importable[0]!.shortBy });
                    onStaged?.(); // close the catalogue
                    return;
                  }
                  o.onClick();
                  onStaged?.();
                }}
              >
                {o.maxed ? "Max" : o.staged ? "Queued" : o.disabledReason ? o.action : importable.length ? "Import missing resources" : o.action}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
