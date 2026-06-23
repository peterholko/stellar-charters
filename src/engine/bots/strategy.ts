/**
 * Shared heuristics used by the bot archetypes.
 *
 * These are greedy, expected-value style helpers — enough varied behaviour to
 * exercise trade, expansion, and raiding so the economy can be measured. No ML.
 */
import { MAX_RANGE_TIER, MEGASTRUCTURE_KINDS, RESOURCES, type MegastructureKind, type MarketOrder, type Order, type RangeTier, type Resource, type System } from "../types.js";
import { EXTRACTOR_CAP, bestBodyFor, effectiveYields, potentialYields, systemBuildings, buildingTotal, type BuildingKind } from "../bodies.js";
import { computeOutcome, type VictoryPath } from "../standings.js";
import { SECRET_TECH_IDS, canResearch, techById, RESEARCH_TREE } from "../research.js";
import type { PlayerView } from "./bot.js";

/** Current per-turn output of a system (worked sites, net of depletion/stellar). */
function liveYields(view: PlayerView, sys: System) {
  return effectiveYields(sys, view.turn, view.config.turns);
}

/** Resources a corporation exports. Outpost-stage systems consume no food, so a
 *  garden world's food is sold to the exchange like any other commodity. Manufactured
 *  goods (fuel/alloys/polymers/components) are sold too, with reserves kept below. */
const EXPORT_RESOURCES: readonly Resource[] = [
  "ice", "metals", "silicates", "helium3", "rareIsotopes", "food",
  "fuel", "alloys", "polymers", "components", "antimatter",
];

/** Raw (extractable) commodities — the rest are manufactured by Processor modules. */
const RAW_RESOURCES: ReadonlySet<Resource> = new Set<Resource>([
  "ice", "metals", "silicates", "helium3", "rareIsotopes", "antimatter",
]);

/** Cap on Processor modules of a given recipe per system (bot self-restraint). */
const PROCESSOR_CAP_PER_RECIPE = 3;

/** Pick the best body to host a building of `kind` — shared with the engine's own affinity
 *  default (`bestBodyFor`), so the bot and the player's auto-placement agree (Section 10). */
const pickBuildBody = bestBodyFor;

/** True if a build of `kind` is already in the system's queue (review Section 10: one queue per
 *  system) — used so bots don't re-pay for a building that's still under construction. */
function alreadyQueued(sys: System, kinds: BuildingKind[]): boolean {
  return (sys.queue ?? []).some((item) => item.kind !== "extractor" && kinds.includes(item.kind));
}

/** Rough commercial value of a system: full-development yield priced at base, minus claim cost.
 *  Uses *potential* output so an unclaimed system (whose deposits aren't worked yet) is valued
 *  by what it could produce, not its current zero. */
export function valueSystem(view: PlayerView, sys: System): number {
  const pot = potentialYields(sys);
  const yieldValue = RESOURCES.reduce(
    (s, r) => s + pot[r] * view.config.tuning.basePrices[r],
    0,
  );
  return yieldValue * 6 - sys.claimCost;
}

/** A system's exposure to nearby raidable routes (used by raider bidding). */
export function routeExposureScore(view: PlayerView, sys: System): number {
  let score = 0;
  for (const rid of sys.routeIds) {
    const r = view.galaxy.routes.get(rid);
    if (r) score += r.exposure;
  }
  return score;
}

/** Build a priority bid list over inner-ring systems given a per-system score. */
export function bidList(
  view: PlayerView,
  score: (sys: System) => number,
  budgetFrac = 0.85,
): { systemId: string; amount: number }[] {
  const ranked = view.galaxy
    .innerRingSystems()
    .filter((s) => s.owner === null)
    .map((s) => ({ sys: s, score: score(s) }))
    .sort((a, b) => b.score - a.score);

  // Jitter each system's rank slightly per corp so identical bot archetypes do not
  // all target the exact same systems (which would leave players empty-handed).
  const jittered = ranked
    .map((e) => ({ sys: e.sys, score: e.score * (0.8 + 0.4 * view.rng.next()) }))
    .sort((a, b) => b.score - a.score);

  const budget = view.me.credits * budgetFrac;
  const priorities: { systemId: string; amount: number }[] = [];
  // Bid hardest on the top pick, then progressively less on a deeper fallback list
  // so losing a premium system does not leave a player with no claim (Section 05).
  const depth = Math.min(6, jittered.length);
  for (let i = 0; i < depth; i++) {
    const entry = jittered[i]!;
    const weight = Math.max(0.3, 1 - i * 0.14);
    const amount = Math.max(entry.sys.claimCost, Math.round(budget * weight));
    priorities.push({ systemId: entry.sys.id, amount });
  }
  return priorities;
}

/** Sell extractable surplus, reserving food/ice a populated system needs for upkeep. */
export function sellSurplus(view: PlayerView, buffer = 0): MarketOrder[] {
  const t = view.config.tuning;
  const inf = t.infrastructure;
  // Hold a little of each upgrade feedstock back (while the corp can still upgrade somewhere) so
  // the raws are carried into next turn's upgrade phase instead of dumped on the market. This is
  // what lets the upgrade sink actually fire — and selling less also lifts the raw's price.
  const owned = view.me.ownedSystemIds.map((id) => view.galaxy.system(id));
  const miningHeadroom = owned.some((s) => buildingTotal(s, "miningRigs") < inf.cap);
  const habitatHeadroom = owned.some((s) => s.populationStage !== "outpost" && buildingTotal(s, "habitats") < inf.cap);
  const powerHeadroom = owned.some((s) => {
    const b = systemBuildings(s);
    return Object.values(b.processors).some((n) => n > 0) && b.powerGrid < inf.cap;
  });
  // Megastructures (Section 22) are huge metal sinks: once a system can host one, hold a large
  // metals reserve back from the exchange to fund construction instead of dumping at the floor.
  const megaHeadroom =
    view.turn >= 12 &&
    owned.some((s) => s.populationStage !== "outpost" && s.megastructures.length < 3);
  const orders: MarketOrder[] = [];
  for (const sysId of view.me.ownedSystemIds) {
    const sys = view.galaxy.system(sysId);
    for (const r of EXPORT_RESOURCES) {
      // Keep two turns of life-support food/ice locally so we don't sell then re-import.
      let reserve = buffer;
      if (r === "food") reserve = Math.max(buffer, t.foodNeed[sys.populationStage] * 2);
      if (r === "ice") {
        reserve = Math.max(buffer, t.iceNeed[sys.populationStage] * 2 + buildingTotal(sys, "hydroponics") * t.hydroponicsIceUse * 2);
      }
      // Keep a few rare isotopes back to build higher-tier warships once Range 2+,
      // but still sell the surplus (frontier income funds those hulls).
      if (r === "rareIsotopes" && view.me.rangeTier >= 2) reserve = Math.max(buffer, 4);
      // Keep manufactured goods the corp consumes itself (Section 07b): fuel for the fleet,
      // alloys for construction, components for hulls. Surplus above the reserve is exported.
      if (r === "fuel") reserve = Math.max(buffer, view.me.ships.length * t.fuelPerShipPerTurn * 3);
      if (r === "alloys") reserve = Math.max(buffer, t.buildAlloyCost * 4);
      if (r === "components") reserve = Math.max(buffer, 6);
      // Reserve upgrade feedstocks (Section 07c) so they fund system upgrades, not the exchange.
      if (r === "metals" && miningHeadroom) reserve = Math.max(reserve, inf.miningMetalsCost * 2);
      if (r === "metals" && megaHeadroom) reserve = Math.max(reserve, 450);
      if (r === "silicates" && habitatHeadroom) reserve = Math.max(reserve, inf.habitatSilicatesCost * 2);
      if (r === "helium3" && powerHeadroom) reserve = Math.max(reserve, inf.powerHelium3Cost * 2);
      const qty = sys.stockpile[r] - reserve;
      if (qty <= 0) continue;
      orders.push({
        kind: "market",
        side: "sell",
        resource: r,
        quantity: qty,
        limitPrice: view.market.floor(r),
        systemId: sysId,
        strict: false,
      });
    }
  }
  return orders;
}

/**
 * With auto-procurement removed (playtest decision), construction materials must be ON HAND
 * before a build resolves. Keep a working float of the manufactured inputs the corp can't yet
 * make itself — imported deliberately, on the books, like any other shipment. sellSurplus's
 * reserves (alloys ×4 bills, components 6) sit above these floats, so buy/sell never churns.
 */
export function maintainMaterialReserves(view: PlayerView): MarketOrder[] {
  const me = view.me;
  if (me.ownedSystemIds.length === 0) return [];
  const t = view.config.tuning;
  const homeId = me.ownedSystemIds[0]!;
  const stock = (r: Resource) => me.ownedSystemIds.reduce((s, id) => s + view.galaxy.system(id).stockpile[r], 0);
  const orders: MarketOrder[] = [];
  const buy = (r: Resource, want: number) => {
    const short = Math.ceil(want - stock(r));
    if (short <= 0) return;
    if (me.credits < short * view.market.prices[r] * 1.2 + 400) return; // keep an operating cushion
    orders.push({ kind: "market", side: "buy", resource: r, quantity: short, limitPrice: 1e9, systemId: homeId, strict: false });
  };
  buy("alloys", t.buildAlloyCost * 3); // a few builds' worth — extractors, platforms, a depot
  if (view.turn >= 6) buy("components", t.depotComponentCost);
  return orders;
}

/** Build a Trade Depot on the corp's best export hub once established (Section 12). */
export function maybeBuildDepot(view: PlayerView): Order[] {
  if (view.turn < 14 || view.me.ownedSystemIds.length < 2) return [];
  if (view.me.credits < view.config.tuning.depotCost * 1.1) return [];
  // Pick the owned system with the richest output and no depot yet.
  const candidates = view.me.ownedSystemIds
    .map((id) => view.galaxy.system(id))
    .filter((s) => !s.hasDepot)
    .sort((a, b) => grossYieldValue(view, b) - grossYieldValue(view, a));
  const target = candidates[0];
  if (!target) return [];
  return [{ kind: "buildDepot", systemId: target.id }];
}

/** Build hydroponics on a populated, food-short system to keep it growing (Section 08). */
export function maybeBuildHydroponics(view: PlayerView): Order[] {
  if (view.me.credits < view.config.tuning.hydroponicsCost * 1.5) return [];
  for (const id of view.me.ownedSystemIds) {
    const sys = view.galaxy.system(id);
    if (alreadyQueued(sys, ["agridome"])) continue; // one agri-dome in flight per system (Phase 4a)
    const hydroponics = buildingTotal(sys, "hydroponics");
    if (hydroponics >= 4) continue; // cap modules per system
    const need = view.config.tuning.foodNeed[sys.populationStage];
    const localFood = liveYields(view, sys).food + hydroponics * view.config.tuning.hydroponicsFoodOutput;
    // A colony that can't feed itself locally — local food is what unlocks growth now.
    if (need > 0 && localFood < need) {
      const bodyKey = pickBuildBody(sys, "agridome"); // best farmland (ocean) — Section 24
      if (bodyKey) return [{ kind: "buildHydroponics", systemId: id, bodyKey }];
    }
  }
  return [];
}

/** The recipe (if any) whose output is `res` — used to find a manufactured good's producer. */
function recipeProducing(view: PlayerView, res: Resource) {
  return view.config.tuning.recipes.find((r) => (r.outputs[res] ?? 0) > 0);
}

/**
 * Can this system locally feed `recipe`? Processors consume from the LOCAL stockpile, so raw
 * inputs must be extracted here and manufactured inputs must be produced by a processor on this
 * same system. This keeps the bot building chains bottom-up on integrated "factory worlds"
 * (e.g. fuel → polymers on a silicate-bearing mixed world) rather than starving a processor.
 */
function systemCanFeed(view: PlayerView, sys: System, recipe: { inputs: Partial<Record<Resource, number>> }): boolean {
  const live = liveYields(view, sys);
  for (const res of Object.keys(recipe.inputs) as Resource[]) {
    if (RAW_RESOURCES.has(res)) {
      if ((live[res] ?? 0) <= 0) return false;
    } else {
      const producer = recipeProducing(view, res);
      if (!producer || (systemBuildings(sys).processors[producer.id] ?? 0) <= 0) return false;
    }
  }
  return true;
}

/** Build a Processor where its chain can be fed locally, climbing tiers as upstream comes online. */
export function maybeBuildProcessor(view: PlayerView): Order[] {
  const t = view.config.tuning;
  if (view.turn < 4) return []; // let the opening economy settle first
  for (const recipe of t.recipes) {
    if (view.me.credits < recipe.buildCost * 1.4) continue;
    for (const id of view.me.ownedSystemIds) {
      const sys = view.galaxy.system(id);
      if ((systemBuildings(sys).processors[recipe.id] ?? 0) >= PROCESSOR_CAP_PER_RECIPE) continue;
      if (alreadyQueued(sys, ["factory"])) continue; // one factory in flight per system (Phase 4a)
      if (!systemCanFeed(view, sys, recipe)) continue;
      const bodyKey = pickBuildBody(sys, "factory"); // cheapest industrial world — Section 24
      return [{ kind: "buildProcessor", systemId: id, recipeId: recipe.id, ...(bodyKey ? { bodyKey } : {}) }];
    }
  }
  return [];
}

/** Add reactor capacity to any owned system whose processors out-draw its current power. */
export function maybeBuildReactor(view: PlayerView): Order[] {
  const t = view.config.tuning;
  if (view.me.credits < t.reactorCost * 1.4) return [];
  for (const id of view.me.ownedSystemIds) {
    const sys = view.galaxy.system(id);
    const buildings = systemBuildings(sys);
    let draw = 0;
    for (const recipe of t.recipes) draw += (buildings.processors[recipe.id] ?? 0) * recipe.powerDraw;
    if (draw <= 0) continue;
    if (alreadyQueued(sys, ["reactor"])) continue; // don't stack reactors while one builds (Phase 4a)
    const capacity = t.basePowerPerSystem + buildings.reactors * t.reactorPowerOutput;
    if (capacity < draw) {
      const bodyKey = pickBuildBody(sys, "reactor");
      return [{ kind: "buildReactor", systemId: id, ...(bodyKey ? { bodyKey } : {}) }];
    }
  }
  return [];
}

/**
 * A forward-looking quality multiplier for investing in a deposit (Section 21):
 *  - renewable deposits (bio/gas/ice) earn a premium — they never run dry, so the capital keeps
 *    paying; finite deposits are discounted as their reserves shrink toward exhaustion;
 *  - star type matters: a neutron star's rare-isotope/antimatter sites pulse high, while an aging
 *    red giant's ocean (food) worlds are scorched late in the match, so don't over-invest there.
 */
function depositInvestmentFactor(view: PlayerView, sys: System, site: System["sites"][number]): number {
  let f = 1;
  if (site.reservesRemaining === null) {
    f *= 1.2; // renewable: sustained income
  } else {
    // Discount toward 0 as a finite deposit nears exhaustion (relative to its richness).
    const turnsLeft = site.reservesRemaining / Math.max(0.01, site.richness);
    f *= Math.max(0.2, Math.min(1, turnsLeft / 12));
  }
  const star = sys.bodies?.starType;
  if (star === "neutronStar" && (site.resource === "rareIsotopes" || site.resource === "antimatter")) {
    f *= 1.25; // periodic output pulses
  }
  if (star === "redGiant" && site.resource === "food") {
    const turnsLeft = view.config.turns - view.turn;
    if (turnsLeft < view.config.turns * 0.45) f *= 0.4; // ocean worlds scorch late
  }
  return f;
}

/**
 * Develop the corp's deposits (Section 21): build extractors on the highest-value workable
 * sites across owned systems, climbing toward the cap. This is the core mid-game build loop —
 * a claimed system only pays out once its deposits are worked, so this runs early and often.
 * Bots see true geology (the fog is only for human clients), so they weigh richness, accessibility,
 * depletion, and stellar dynamics directly.
 */
export function maybeBuildExtractor(view: PlayerView): Order[] {
  const t = view.config.tuning;
  if (view.me.ownedSystemIds.length === 0) return [];
  let budget = view.me.credits * 0.5;
  const cands: { sysId: string; siteKey: string; score: number; cost: number }[] = [];
  for (const id of view.me.ownedSystemIds) {
    const sys = view.galaxy.system(id);
    for (const site of sys.sites) {
      if (site.extractorLevel >= EXTRACTOR_CAP) continue;
      // Skip a finite deposit that is nearly exhausted — not worth fresh capital.
      if (site.reservesRemaining !== null && site.reservesRemaining < site.richness * 3) continue;
      const price = t.basePrices[site.resource];
      const score = site.richness * price * site.accessibility * depositInvestmentFactor(view, sys, site);
      const factor =
        (site.extractorLevel + 1) * (1 + (1 - site.accessibility) * t.extractor.accessibilityMult);
      const cost = Math.round(t.extractor.buildCost * factor);
      cands.push({ sysId: id, siteKey: site.key, score, cost });
    }
  }
  cands.sort((a, b) => b.score - a.score);
  const orders: Order[] = [];
  for (const c of cands) {
    if (orders.length >= 3) break; // a few extractors per turn keeps cash for everything else
    if (budget < c.cost * 1.2) continue;
    budget -= c.cost;
    orders.push({ kind: "buildExtractor", systemId: c.sysId, siteKey: c.siteKey });
  }
  return orders;
}

/**
 * Knock a reachable rival's best extractor offline (Section 21). Raiders/Free Operators with a
 * raider hull or privateer near a rival system can sabotage its production, not just its convoys.
 */
export function maybeSabotage(view: PlayerView): Order[] {
  if (!view.me.ships.some((s) => s.raider) && view.me.privateers.length === 0) return [];
  const threat = strategicPosture(view).threatId;
  const cands: { sys: System; siteKey: string; richness: number }[] = [];
  for (const sys of view.galaxy.allSystems()) {
    if (sys.owner === null || sys.owner === view.me.id) continue;
    const reachable =
      view.me.privateers.some(
        (p) => p.basedAt === sys.id || view.galaxy.routeBetween(p.basedAt, sys.id) !== undefined,
      ) ||
      (view.me.ships.some((s) => s.raider) &&
        view.me.ownedSystemIds.some(
          (o) => o === sys.id || view.galaxy.routeBetween(o, sys.id) !== undefined,
        ));
    if (!reachable) continue;
    const worked = sys.sites
      .filter((s) => s.extractorLevel > 0 && s.disabledUntil <= view.turn)
      .sort((a, b) => b.richness - a.richness)[0];
    if (!worked) continue;
    cands.push({ sys, siteKey: worked.key, richness: worked.richness });
  }
  if (cands.length === 0) return [];
  // Kneecap whoever is winning first (Section 29 coalition play); otherwise the richest extractor.
  cands.sort((a, b) => {
    const at = a.sys.owner === threat ? 1 : 0;
    const bt = b.sys.owner === threat ? 1 : 0;
    return bt - at || b.richness - a.richness;
  });
  const pick = cands[0]!;
  return [{ kind: "sabotage", systemId: pick.sys.id, siteKey: pick.siteKey }];
}

const STAGE_ORDER = ["outpost", "settlement", "colony", "city", "metropolis"];

/**
 * Sink overproduced metal into grand construction (Section 22): build the largest megastructure
 * an owned system qualifies for and the corp can afford, biggest sink first. This is the main
 * demand floor that keeps metal off the price floor, plus a late-game valuation play.
 */
export function maybeBuildMegastructure(view: PlayerView): Order[] {
  const t = view.config.tuning;
  if (view.turn < 12) return [];
  const metalsStock = corpStock(view, "metals");
  const alloysStock = corpStock(view, "alloys");
  // Richest/most-developed systems first.
  const systems = view.me.ownedSystemIds
    .map((id) => view.galaxy.system(id))
    .sort((a, b) => STAGE_ORDER.indexOf(b.populationStage) - STAGE_ORDER.indexOf(a.populationStage));
  // Prefer the biggest metal sink the system qualifies for.
  const byCost = [...MEGASTRUCTURE_KINDS].sort((a, b) => t.megastructures[b].metalsCost - t.megastructures[a].metalsCost);
  for (const sys of systems) {
    for (const kind of byCost) {
      if (sys.megastructures.includes(kind)) continue;
      const spec = t.megastructures[kind];
      if (STAGE_ORDER.indexOf(sys.populationStage) < STAGE_ORDER.indexOf(spec.requiresStage)) continue;
      const metalsBill = Math.max(0, spec.metalsCost - metalsStock) * view.market.prices.metals;
      const alloyBill = Math.max(0, spec.alloyCost - alloysStock) * view.market.prices.alloys;
      const total = spec.creditCost + metalsBill + alloyBill;
      if (view.me.credits > total * 1.05) {
        return [{ kind: "buildMegastructure", systemId: sys.id, structure: kind }];
      }
    }
  }
  return [];
}

// ----- War & diplomacy (Section 23) -----

/** Two charters are allied iff each has pledged the other. */
function areAlliedView(view: PlayerView, a: string, b: string): boolean {
  const ca = view.corporations.find((c) => c.id === a);
  const cb = view.corporations.find((c) => c.id === b);
  return !!ca && !!cb && ca.alliancePledges.includes(b) && cb.alliancePledges.includes(a);
}

function atWarView(view: PlayerView, a: string, b: string): boolean {
  return view.wars.some(
    (w) =>
      w.endTurn > view.turn &&
      ((w.aggressorId === a && w.defenderId === b) || (w.aggressorId === b && w.defenderId === a)),
  );
}

function isLockedOutAggressor(view: PlayerView): boolean {
  return view.wars.some((w) => w.aggressorId === view.me.id && w.endTurn > view.turn);
}

/** Aggressors currently at war with us as the defender (directly invaded, or via a defensive pact). */
function warEnemies(view: PlayerView): Set<string> {
  return new Set(view.wars.filter((w) => w.endTurn > view.turn && w.defenderId === view.me.id).map((w) => w.aggressorId));
}

/** The owned system holding our largest idle combat fleet — the natural staging base for a campaign. */
function fleetBase(view: PlayerView): { sysId: string; combat: number } | undefined {
  let best: { sysId: string; combat: number } | undefined;
  for (const id of view.me.ownedSystemIds) {
    const combat = view.me.ships
      .filter((s) => s.combat > 0 && !s.transit && s.stationedAt === id)
      .reduce((a, s) => a + s.combat, 0);
    if (combat > 0 && (!best || combat > best.combat)) best = { sysId: id, combat };
  }
  return best;
}

/** A charted path within our range exists between two systems (mobile fleets can pass peacefully). */
function pathExists(view: PlayerView, from: string, to: string): boolean {
  return !!view.galaxy.shortestWarpPath(from, to, view.me.rangeTier);
}

/** True if we already have a fleet committed to an assault (don't open a second front mid-march). */
function fleetOnCampaign(view: PlayerView): boolean {
  return view.me.ships.some((s) => s.transit?.attack);
}

/** A target is reachable if any of our systems connects to it by charted routes within range. */
function reachableFromTerritory(view: PlayerView, sys: System): boolean {
  return view.me.ownedSystemIds.some((id) => pathExists(view, id, sys.id));
}

/** Send our staging fleet to seize/relieve `target` if it's strong enough, else grow the fleet. */
function campaignAgainst(view: PlayerView, target: System, marginBonus: number): Order[] {
  if (fleetOnCampaign(view)) return [];
  const base = fleetBase(view);
  const need = systemDefenseEstimate(view, target) * (view.config.tuning.war.captureRatio + marginBonus);
  if (base && base.combat >= need && pathExists(view, base.sysId, target.id)) {
    return [{ kind: "moveFleet", fromSystemId: base.sysId, toSystemId: target.id }];
  }
  // Not strong enough yet (or no fleet): build the warfleet up at the base.
  const buildAt = base?.sysId ?? view.me.ownedSystemIds[0];
  return buildAt ? buildWarshipAt(view, buildAt) : [];
}

/** Combat strength this corp can bring against a target system (ships/privateers in range). */
function attackForceOn(view: PlayerView, sys: System): number {
  let f = 0;
  for (const ship of view.me.ships) {
    if (ship.combat <= 0 || !ship.stationedAt) continue;
    const r = view.galaxy.routeBetween(ship.stationedAt, sys.id);
    if (r && r.charted && r.requiredRange <= ship.rangeTier) f += ship.combat;
  }
  for (const p of view.me.privateers) {
    const r = view.galaxy.routeBetween(p.basedAt, sys.id);
    if (r && r.charted && r.requiredRange <= view.me.rangeTier) f += p.strength;
  }
  return f;
}

/** Estimate a system's defensive strength (mirrors the engine, incl. allied reinforcement). */
function systemDefenseEstimate(view: PlayerView, sys: System): number {
  const t = view.config.tuning;
  let d = sys.defense + sys.platforms * t.platformDefense + buildingTotal(sys, "miningRigs") * t.infrastructure.miningDefenseBonusPerLevel;
  for (const m of sys.megastructures) d += t.megastructures[m].defenseBonus;
  if (sys.hasDepot) d += t.depotDefenseBonus;
  for (const owner of view.corporations) {
    const allied = sys.owner === owner.id || areAlliedView(view, sys.owner ?? "", owner.id);
    if (!allied) continue;
    for (const sh of owner.ships) if (sh.combat > 0 && sh.stationedAt === sys.id) d += sh.combat;
  }
  return d;
}

/**
 * Conquer a weak, reachable rival system (Section 23). Invading declares war and locks the
 * aggressor out of the Exchange, so a bot only does it when it is militarily dominant, already
 * established, and not already fighting a war it started — the prize must clearly outweigh the
 * lost trade access.
 */
export function maybeInvade(view: PlayerView): Order[] {
  if (view.turn < 16 || view.me.ownedSystemIds.length === 0 || !view.me.hasCharter) return [];
  if (isLockedOutAggressor(view)) return []; // already paying the aggressor penalty
  const myCombat = view.me.ships.reduce((s, sh) => s + sh.combat, 0);
  if (myCombat < 6) return []; // need a real fleet to commit to conquest
  const ratio = view.config.tuning.war.captureRatio + 0.25; // require clear superiority
  let best: { id: string; gain: number } | null = null;
  for (const sys of view.galaxy.allSystems()) {
    if (sys.owner === null || sys.owner === view.me.id || sys.id === view.galaxy.hubId) continue;
    if (areAlliedView(view, view.me.id, sys.owner)) continue;
    const attack = attackForceOn(view, sys);
    if (attack <= 0) continue;
    if (attack < systemDefenseEstimate(view, sys) * ratio) continue;
    const gain = grossYieldValue(view, sys) + 250;
    if (!best || gain > best.gain) best = { id: sys.id, gain };
  }
  return best ? [{ kind: "invade", systemId: best.id }] : [];
}

/** An owned system adjacent to the target on a traversable charted lane (an invasion staging point). */
function stagingFor(view: PlayerView, target: System): System | undefined {
  let best: System | undefined;
  let bestForce = -1;
  for (const id of view.me.ownedSystemIds) {
    const r = view.galaxy.routeBetween(id, target.id);
    if (!r || !r.charted || r.requiredRange > view.me.rangeTier) continue;
    const sys = view.galaxy.system(id);
    const force = view.me.ships.filter((s) => s.combat > 0 && s.stationedAt === id).reduce((s, sh) => s + sh.combat, 0);
    if (force > bestForce) { bestForce = force; best = sys; }
  }
  return best;
}

/** Build the best non-raider warship the corp can afford, stationed at `systemId` (war fleet). */
function buildWarshipAt(view: PlayerView, systemId: string): Order[] {
  const t = view.config.tuning;
  const localIso = corpStock(view, "rareIsotopes");
  const localAlloys = corpStock(view, "alloys");
  for (let cand = view.me.rangeTier; cand >= 1; cand--) {
    const tier = cand as RangeTier;
    const isoBill = Math.max(0, t.shipIsotopeCost[tier] - localIso) * view.market.prices.rareIsotopes;
    const alloyBill = Math.max(0, t.shipAlloyCost[tier] - localAlloys) * view.market.prices.alloys;
    // Commit to the war effort — build as soon as the hull is just affordable.
    if (view.me.credits >= t.shipCost[tier] + isoBill + alloyBill) {
      return [{ kind: "buildShip", rangeTier: tier, raider: false, systemId }];
    }
  }
  return [];
}

/** A bot's read of the victory race (Section 29): where it stands and who, if anyone, is winning. */
export interface Posture {
  /** 1-based rank by victory score. */
  myRank: number;
  amLeader: boolean;
  /** The victory path this corp is currently best positioned for (flavour + steering). */
  myPath: VictoryPath;
  /** The rival the field should coordinate against: the clear score leader, esp. near a win. */
  threatId?: string;
  /** That threat is closing on an outright win (commanding lead, late game, or a looming monopoly). */
  threatUrgent: boolean;
}

/**
 * Read the live standings the same way the end-game does (Section 29) and decide this bot's posture:
 * its rank/path, and — crucially — whether one rival is *winning* and should be ganged up on. Driving
 * coalition warfare off the real victory score (not raw valuation) makes bots play to deny a win, which
 * both reads as smarter and curbs runaway leaders. Threat detection waits a few turns so early-game
 * score noise doesn't trigger a phantom hegemon.
 */
export function strategicPosture(view: PlayerView): Posture {
  const o = computeOutcome(view.corporations, view.galaxy, view.config.tuning, view.turn, view.config.turns);
  const meRow = o.standings.find((s) => s.corpId === view.me.id);
  const leader = o.standings[0];
  const second = o.standings[1];
  const charters = o.standings.filter((s) => s.hasCharter);
  const posture: Posture = {
    myRank: meRow?.rank ?? o.standings.length,
    amLeader: leader?.corpId === view.me.id,
    myPath: meRow?.path ?? "economic",
    threatUrgent: false,
  };
  if (view.turn >= 8 && leader && leader.corpId !== view.me.id && leader.hasCharter) {
    const lead = leader.score / Math.max(1, second?.score ?? 1);
    const turnsLeft = view.config.turns - view.turn;
    if (lead >= 1.35 || (charters.length <= 2 && leader.hasCharter)) posture.threatId = leader.corpId;
    if (posture.threatId && (lead >= 1.7 || turnsLeft <= 8 || charters.length <= 2 || leader.secrets >= 1)) {
      posture.threatUrgent = true;
    }
  }
  return posture;
}

/** The dominant rival the galaxy should gang up on (the score leader closing on a win), if any. */
function hegemonId(view: PlayerView): string | undefined {
  return strategicPosture(view).threatId;
}

/** Pick (and persist) a valuable, reachable rival system worth conquering — favouring grudges
 *  (retaliation) and the over-mighty hegemon (coalition warfare). */
function resolveConquestTarget(view: PlayerView, state: BotState): System | undefined {
  const valid = (sys: System | undefined): sys is System =>
    !!sys && sys.owner !== null && sys.owner !== view.me.id && sys.id !== view.galaxy.hubId &&
    !areAlliedView(view, view.me.id, sys.owner) && reachableFromTerritory(view, sys);
  const current = state.conquestTarget ? view.galaxy.systems.get(state.conquestTarget) : undefined;
  if (valid(current)) return current;
  const cap = view.config.tuning.shipCombat[view.me.rangeTier] * 5 + 50; // willing to mass for a defended prize
  const hegemon = hegemonId(view);
  const grudge = view.me.grudges ?? {};
  const enemies = warEnemies(view); // aggressors at war with us / our allies — counter-attack first
  const score = (s: System): number => {
    let v = grossYieldValue(view, s);
    if (s.owner && enemies.has(s.owner)) v += 6000; // honour the pact: hit those warring on us
    if (s.owner === hegemon) v += 4000; // dogpile the runaway leader
    v += (grudge[s.owner ?? ""] ?? 0) * 300; // settle scores with those who wronged us
    return v;
  };
  const candidates = view.galaxy.allSystems()
    .filter((s): s is System => valid(s) && systemDefenseEstimate(view, s) <= cap)
    .sort((a, b) => score(b) - score(a));
  state.conquestTarget = candidates[0]?.id;
  return candidates[0];
}

/**
 * Conquest doctrine (Section 23): striving to dominate, mass a warfleet and seize a rival's most
 * valuable reachable system. Concentrates force at a staging system (redeploying scattered
 * warships + building capital hulls), then invades once clearly superior. The Exchange lockout is
 * the price of empire — only a corp that can fund a real fleet pursues this.
 */
export function maybeConquest(view: PlayerView, state: BotState): Order[] {
  if (view.turn < 11 || !view.me.hasCharter || view.me.isFreeOperator) return [];
  // (No one-war limit: with only a trade tariff rather than a full lockout, a warlord can press
  // multiple fronts — Section 23.)
  const target = resolveConquestTarget(view, state);
  if (!target) return [];
  return campaignAgainst(view, target, 0.05);
}

/**
 * Honour a defensive pact (Section 23): when we are at war as a defender — whether we were invaded
 * directly or drawn in to defend an ally — counter-attack the aggressor's nearest reachable system.
 * This runs for *every* archetype (even peaceful miners), since a defensive war is justified, and
 * it carries no aggressor tariff (counter-invasion is defensive). Masses a fleet if not yet strong.
 */
export function maybeDefendAlly(view: PlayerView, state: BotState): Order[] {
  if (!view.me.hasCharter || view.me.isFreeOperator) return [];
  const enemies = warEnemies(view);
  if (enemies.size === 0) return [];
  const targets = view.galaxy.allSystems().filter(
    (s): s is System => s.owner !== null && enemies.has(s.owner) && reachableFromTerritory(view, s),
  );
  if (targets.length === 0) return [];
  const target = targets.sort((a, b) => grossYieldValue(view, b) - grossYieldValue(view, a))[0]!;
  return campaignAgainst(view, target, 0);
}

/**
 * Take out a mutual defensive alliance with a comparable charter (Section 23) — cheap insurance
 * that deters invasion. One ally is plenty; never ally with a charter we're at war with.
 */
export function maybeAlliance(view: PlayerView): Order[] {
  if (view.turn < 8 || !view.me.hasCharter) return [];
  if (view.corporations.some((c) => c.id !== view.me.id && areAlliedView(view, view.me.id, c.id))) return [];
  const hegemon = hegemonId(view); // never ally with the corp the galaxy should be ganging up on
  const peers = view.corporations
    .filter((c) => c.id !== view.me.id && c.id !== hegemon && c.hasCharter && c.ownedSystemIds.length > 0 && !atWarView(view, view.me.id, c.id))
    .sort((a, b) => Math.abs(a.valuation - view.me.valuation) - Math.abs(b.valuation - view.me.valuation));
  return peers[0] ? [{ kind: "alliancePledge", targetId: peers[0].id }] : [];
}

/** Total of a resource across all of a corp's owned-system stockpiles. */
function corpStock(view: PlayerView, res: Resource): number {
  let n = 0;
  for (const id of view.me.ownedSystemIds) n += view.galaxy.system(id).stockpile[res];
  return n;
}

/**
 * Spend the corp's overproduced raws on system upgrades (Section 07c): Mining Rigs (metals) on
 * the richest worlds, Habitats (silicates) on populated worlds, Power Grids (helium3) on worlds
 * running processors. Each upgrade is only taken when the raw is already in the corp's
 * stockpiles — so it drains owned overproduction rather than buying from the market — and at
 * most half of cash is committed per turn. This is the main sink that keeps raw prices off the floor.
 */
export function maybeUpgradeInfrastructure(view: PlayerView): Order[] {
  const inf = view.config.tuning.infrastructure;
  if (view.turn < 5) return [];
  const stock: Record<"metals" | "silicates" | "helium3", number> = {
    metals: corpStock(view, "metals"),
    silicates: corpStock(view, "silicates"),
    helium3: corpStock(view, "helium3"),
  };
  let budget = view.me.credits * 0.5;
  const orders: Order[] = [];

  const systems = view.me.ownedSystemIds
    .map((id) => view.galaxy.system(id))
    .sort((a, b) => grossYieldValue(view, b) - grossYieldValue(view, a));

  const tryUpgrade = (
    sys: System,
    track: "mining" | "habitat" | "power",
    level: number,
    raw: "metals" | "silicates" | "helium3",
    creditBase: number,
    rawBase: number,
  ): void => {
    if (level >= inf.cap) return;
    // Habitats need a livable world, mining rigs a solid one (Section 24) — skip if none can host it.
    const kind: BuildingKind = track === "mining" ? "mining" : track === "habitat" ? "habitat" : "power";
    if (alreadyQueued(sys, [kind])) return; // don't re-queue a track that's already building (Phase 4a)
    const bodyKey = pickBuildBody(sys, kind);
    if (!bodyKey) return;
    const factor = level + 1; // cost scales with the level being reached
    const cost = creditBase * factor;
    const need = rawBase * factor;
    if (budget < cost || stock[raw] < need) return;
    budget -= cost;
    stock[raw] -= need;
    orders.push({ kind: "upgradeInfrastructure", systemId: sys.id, track, bodyKey });
  };

  for (const sys of systems) {
    if (orders.length >= 5) break; // a handful of upgrades per turn is plenty
    const buildings = systemBuildings(sys);
    if (grossYieldValue(view, sys) > 0) {
      tryUpgrade(sys, "mining", buildings.miningRigs, "metals", inf.miningCreditCost, inf.miningMetalsCost);
    }
    if (sys.populationStage !== "outpost") {
      tryUpgrade(sys, "habitat", buildings.habitats, "silicates", inf.habitatCreditCost, inf.habitatSilicatesCost);
    }
    if (Object.values(buildings.processors).some((n) => n > 0)) {
      tryUpgrade(sys, "power", buildings.powerGrid, "helium3", inf.powerCreditCost, inf.powerHelium3Cost);
    }
  }
  return orders;
}

/** Mutable per-bot memory so a financier locks onto one acquisition target. */
export interface BotState {
  acqTarget?: string;
  /** A reachable rival system this corp is massing a warfleet to conquer (Section 23). */
  conquestTarget?: string;
}

/** Resolve (and persist) which charter rival this corp is trying to take over. */
function lockTarget(view: PlayerView, state: BotState): PlayerView["corporations"][number] | undefined {
  const current = state.acqTarget
    ? view.corporations.find((c) => c.id === state.acqTarget)
    : undefined;
  // Keep an existing valid, still-chartered target; otherwise pick the weakest rival.
  if (current && current.hasCharter && current.ownedSystemIds.length > 0) return current;
  const next = weakestRival(view);
  state.acqTarget = next?.id;
  return next;
}

/**
 * Financier play (Section 17): once rivals have real assets and debt, lock onto the
 * weakest charter and accumulate a controlling stake decisively (borrowing against our
 * own valuation if cash is short), rather than spreading bids thin across rivals.
 */
export function financierOrders(
  view: PlayerView,
  state: BotState,
  opts: { sinceTurn?: number; maxTargetStrength?: number } = {},
): Order[] {
  const since = opts.sinceTurn ?? 13;
  if (view.turn < since) return [];
  // Only an established charter pursues takeovers, and only of a meaningfully
  // weaker rival — this keeps consolidation an endgame move, not a snowball that
  // swallows near-peers (Section 17 onboarding pacing).
  if (!view.me.hasCharter || view.me.valuation <= 0) return [];
  const target = lockTarget(view, state);
  if (!target) return [];
  const maxStrength = opts.maxTargetStrength ?? 0.4;
  if (target.valuation > view.me.valuation * maxStrength) {
    state.acqTarget = undefined;
    return [];
  }

  const price = target.sharePrice;
  const held = target.shareRegister[view.me.id] ?? 0;
  // Aim just past the control threshold and buy as much of the gap as affordable.
  const goal = Math.ceil(view.config.tuning.acquisitionThreshold * target.sharesOutstanding) + 1;
  const remaining = goal - held;
  if (remaining <= 0) return [];

  const orders: Order[] = [];
  // Control requires buying out the management block WHOLE (Section 17), so order the
  // entire register — fills clamp to what's available and affordable. A full takeover
  // runs ~2.2× the target's market cap (quad-priced float + the 2.5× buyout).
  const cost = Math.max(remaining * price, target.valuation * 2.2);
  if (cost > view.me.credits && view.me.valuation > 0) {
    orders.push({ kind: "borrow", amount: Math.ceil(cost - view.me.credits) });
  }
  // Limit at 8× book clears the 2.5× buyout and the quad-priced float even at high
  // sentiment — cheapest when the target is depressed, which is when financiers strike.
  orders.push({ kind: "buyShares", targetId: target.id, shares: target.sharesOutstanding, limitPrice: price * 8 });
  return orders;
}

/** The most acquirable charter rival: lowest valuation among other charter holders. */
function weakestRival(view: PlayerView): PlayerView["corporations"][number] | undefined {
  return view.corporations
    .filter((c) => c.id !== view.me.id && c.hasCharter && c.ownedSystemIds.length > 0)
    .sort((a, b) => a.valuation - b.valuation)[0];
}

/**
 * Post-charter play (Section 18): a Free Operator can't claim or build colonial
 * infrastructure, so it earns through plunder and speculates on a comeback by buying
 * a controlling stake in a weak charter.
 */
export function freeOperatorOrders(view: PlayerView, state: BotState): Order[] {
  const orders: Order[] = [];
  // Merchant/privateer income: haunt the busiest lane, and sabotage rival production.
  orders.push(...planRaid(view, { fundFactor: 1.1 }));
  orders.push(...maybeSabotage(view));
  // Comeback: buy toward control of a locked target charter when flush.
  const target = lockTarget(view, state);
  if (target && view.me.credits > target.sharePrice * 5) {
    const held = target.shareRegister[view.me.id] ?? 0;
    const goal = Math.ceil(view.config.tuning.acquisitionThreshold * target.sharesOutstanding) + 1;
    const want = Math.min(
      goal - held,
      Math.floor((view.me.credits * 0.6) / Math.max(0.01, target.sharePrice)),
    );
    if (want > 0) orders.push({ kind: "buyShares", targetId: target.id, shares: want, limitPrice: target.sharePrice * 8 });
  }
  return orders;
}

/**
 * Earliest turn a corp will reach for each range tier (keeps fleets advancing). The eight-tier
 * ladder is paced to fit the 42-turn arc, so aggressive corps can climb to capital hulls late.
 */
/** Gross full-development export value of a system priced at base (potential, not current). */
function grossYieldValue(view: PlayerView, sys: System): number {
  const pot = potentialYields(sys);
  return RESOURCES.reduce((s, r) => s + pot[r] * view.config.tuning.basePrices[r], 0);
}

/** Claim the best unclaimed inner-ring system if affordable (second/third claim). */
export function maybeExpand(view: PlayerView): Order[] {
  // Cap early sprawl so cash is left for depots, frontier reach, and equity plays.
  if (view.me.ownedSystemIds.length >= 3) return [];
  // Rank by gross output; over the remaining turns a productive system pays for itself.
  const candidates = view.galaxy
    .innerRingSystems()
    .filter((s) => s.owner === null)
    .map((s) => ({ sys: s, yieldValue: grossYieldValue(view, s) }))
    .filter((c) => c.yieldValue >= 60)
    .sort((a, b) => b.yieldValue - a.yieldValue);
  const best = candidates[0];
  if (!best) return [];
  // Keep a working buffer above the claim cost so upkeep doesn't bankrupt the corp.
  if (view.me.credits < best.sys.claimCost + 1000) return [];
  return [{ kind: "claim", systemId: best.sys.id, amount: best.sys.claimCost }];
}

/** Per-archetype research doctrines (Section 28): the ordered tech queue a bot pursues. Each leans
 *  into ~2 divisions matching its play, so the sim exercises the whole tree and bots specialise too. */
export const RESEARCH_PLANS: Record<string, string[]> = {
  // Every doctrine opens with Warp Drive II/III (range fuels expansion + reach), then leans into ~2
  // divisions. Range now comes from research (Section 28 Phase 2), so it's part of the queue.
  miner: ["nav-warp2", "pro-extractors", "nav-warp3", "pro-deepcore", "nav-warp4", "fab-assembly", "fab-lean", "col-habitat", "pro-antimatter"],
  balanced: ["nav-warp2", "fab-assembly", "fab-modular", "nav-warp3", "col-habitat", "col-charter", "fab-metallurgy", "acq-algorithms", "col-terraform", "col-arcology"],
  raider: ["nav-warp2", "acq-algorithms", "acq-takeover", "acq-insider", "acq-espionage", "nav-warp3", "sec-plating", "sec-firecontrol"],
  warlord: ["nav-warp2", "sec-plating", "nav-warp3", "sec-firecontrol", "nav-warp4", "nav-warp5", "sec-capital", "sec-orbital", "pro-extractors"],
  hybrid: ["nav-warp2", "fab-assembly", "nav-warp3", "fab-modular", "fab-metallurgy", "pro-extractors", "fab-nanofab"],
};

/** Fund research (Section 28): keep a few Research Labs going and steer the tech queue by doctrine. */
export function maybeResearch(view: PlayerView, plan: string[] | undefined): Order[] {
  const me = view.me;
  if (!plan || me.isFreeOperator || !me.hasCharter || me.ownedSystemIds.length === 0) return [];
  const orders: Order[] = [];

  // Keep up to one lab per owned system; build when cash allows and none is already in flight.
  const owned = me.ownedSystemIds.map((id) => view.galaxy.system(id));
  const labs = owned.reduce((n, s) => n + buildingTotal(s, "labs"), 0);
  const labQueued = owned.some((s) => (s.queue ?? []).some((it) => it.kind === "lab"));
  if (labs < me.ownedSystemIds.length && !labQueued && me.credits > view.config.tuning.labCost * 4) {
    const sys = owned[0]!;
    const body = pickBuildBody(sys, "lab");
    if (body) orders.push({ kind: "buildLab", systemId: sys.id, bodyKey: body });
  }

  // (Re)set the research queue only when it drifts from the doctrine (e.g. after a tech completes).
  const desired = adaptSecretRace(view, plan.filter((id) => !me.research.completed.includes(id)));
  const cur = me.research.queue;
  const same = desired.length === cur.length && desired.every((id, i) => cur[i] === id);
  if (!same && desired.length > 0) orders.push({ kind: "setResearch", queue: desired });
  return orders;
}

/** Secret capstones already locked by some other charter (a lost galaxy-unique race — Section 28). */
function rivalLockedSecrets(view: PlayerView): Set<string> {
  const locked = new Set<string>();
  for (const c of view.corporations) {
    if (c.id === view.me.id) continue;
    for (const id of c.research.completed) if (SECRET_TECH_IDS.includes(id)) locked.add(id);
  }
  return locked;
}

/**
 * Don't pour RP into a secret a rival already owns (it's galaxy-unique). Drop any locked capstone from
 * the doctrine tail and, if the bot is still in the race, retarget to the best *open* secret it can
 * actually reach — preferring a division it has already invested in. Keeps the tech race live instead
 * of stubbornly chasing a lost project.
 */
function adaptSecretRace(view: PlayerView, desired: string[]): string[] {
  const locked = rivalLockedSecrets(view);
  const nonSecret = desired.filter((id) => !SECRET_TECH_IDS.includes(id));
  const myOpenSecret = desired.find((id) => SECRET_TECH_IDS.includes(id) && !locked.has(id));
  if (myOpenSecret) return desired; // current target still winnable — leave the plan as-is
  if (!desired.some((id) => SECRET_TECH_IDS.includes(id))) return desired; // doctrine queued no secret

  // Our planned capstone got sniped — find a reachable replacement (prereqs met by what we'll have).
  const willHave = [...view.me.research.completed, ...nonSecret];
  const myDivCounts: Record<string, number> = {};
  for (const id of view.me.research.completed) {
    const t = techById(id);
    if (t) myDivCounts[t.division] = (myDivCounts[t.division] ?? 0) + 1;
  }
  const replacement = RESEARCH_TREE
    .filter((t) => t.secret && !locked.has(t.id) && !view.me.research.completed.includes(t.id))
    .filter((t) => canResearch(t, willHave))
    .sort((a, b) => (myDivCounts[b.division] ?? 0) - (myDivCounts[a.division] ?? 0))[0];
  return replacement ? [...nonSecret, replacement.id] : nonSecret;
}

/**
 * Operate a survey vessel (Section 25): keep one unarmed scout in the fleet and send it to chart the
 * deposit intel of the nearest reachable system the charter hasn't surveyed yet (frontier worlds it
 * might claim, or a rival's economy it might move on). The scout returns home on its own after each
 * run, so this re-dispatches it whenever it's idle.
 */
export function maybeSurvey(view: PlayerView): Order[] {
  const me = view.me;
  if (me.isFreeOperator || !me.hasCharter || me.ownedSystemIds.length === 0) return [];
  const t = view.config.tuning;
  const scouts = me.ships.filter((s) => s.surveyor);

  // Send an idle scout to the cheapest-to-reach system we neither own nor have surveyed.
  const idle = scouts.find((s) => !s.transit && s.stationedAt);
  if (idle) {
    const known = new Set([...me.ownedSystemIds, ...me.surveyedSystemIds]);
    const target = view.galaxy
      .allSystems()
      .filter((s) => s.id !== view.galaxy.hubId && s.id !== idle.stationedAt && !known.has(s.id))
      .map((s) => ({ s, path: view.galaxy.shortestWarpPath(idle.stationedAt, s.id, idle.rangeTier) }))
      .filter((e) => e.path && e.path.routes.length > 0)
      .sort((a, b) => a.path!.transitTime - b.path!.transitTime)[0];
    if (target) return [{ kind: "surveySystem", fromSystemId: idle.stationedAt, targetSystemId: target.s.id }];
  }

  // Otherwise keep exactly one survey vessel in the fleet, built once the corp can spare the cash.
  if (scouts.length === 0 && me.credits > t.surveyShipCost * 4) {
    return [{ kind: "buildSurveyShip", systemId: me.ownedSystemIds[0]! }];
  }
  return [];
}

/**
 * Push toward the frontier once Range 2 is available (Section 04 / Section 19 turn 8+):
 * chart an uncharted deep tunnel off an owned system, then claim the rare-isotope
 * system beyond it. This brings high-value cargo onto exposed routes — the prime
 * raiding target the design wants to test.
 */
export function maybeFrontier(view: PlayerView): Order[] {
  if (view.me.rangeTier < 2) return [];
  const orders: Order[] = [];

  // 1) Claim a reachable, already-charted frontier system we can traverse and afford.
  for (const sys of view.galaxy.allSystems()) {
    if (sys.owner !== null || sys.innerRing || sys.id === view.galaxy.hubId) continue;
    const reachable = sys.routeIds.some((rid) => {
      const r = view.galaxy.routes.get(rid);
      if (!r || !r.charted || r.requiredRange > view.me.rangeTier) return false;
      const anchor = r.a === sys.id ? r.b : r.a;
      return view.me.ownedSystemIds.includes(anchor);
    });
    if (reachable && view.me.credits > sys.claimCost + 200) {
      orders.push({ kind: "claim", systemId: sys.id, amount: sys.claimCost });
      return orders;
    }
  }

  // 2) Otherwise chart a deep tunnel we can actually use, hanging off one of our systems.
  for (const sysId of view.me.ownedSystemIds) {
    const sys = view.galaxy.system(sysId);
    for (const rid of sys.routeIds) {
      const r = view.galaxy.routes.get(rid);
      if (
        r &&
        !r.charted &&
        r.requiredRange <= view.me.rangeTier &&
        view.me.credits > view.config.tuning.surveyCost + 500
      ) {
        orders.push({ kind: "survey", routeId: r.id });
        return orders;
      }
    }
  }
  return orders;
}

/**
 * Plan raids on the busiest exposed warp lanes (Sections 13–14).
 *
 * Privateers can haunt any tunnel, so the raider bases them at each lane's vulnerable
 * (non-hub) mouth and issues interdictions there. Hire + interdict are submitted together:
 * the engine processes the hire (administrative step) before it resolves raids, so a
 * freshly-contracted privateer is eligible the same turn. Raiders work several lanes at
 * once so raiding scales with the convoy volume rather than touching one shipment a turn.
 */
export function planRaid(
  view: PlayerView,
  opts: { minTraffic?: number; fundFactor?: number; lanes?: number } = {},
): Order[] {
  const minTraffic = opts.minTraffic ?? 1;
  const fundFactor = opts.fundFactor ?? 1.5;
  const maxLanes = opts.lanes ?? 3;

  // Score each lane by the export value of the systems it connects (frontier/antimatter
  // lanes are fat; bulk-ice lanes are lean), nudged by any rich convoy seen on it now.
  const convoyPrize = new Map<string, number>();
  for (const c of view.convoys) {
    if (c.owner === view.me.id) continue;
    for (const rid of [c.routeIds[c.position], c.routeIds[c.position + 1]]) {
      if (rid) convoyPrize.set(rid, Math.max(convoyPrize.get(rid) ?? 0, c.value));
    }
  }
  const exportValue = (sysId: string) => {
    const sys = view.galaxy.systems.get(sysId);
    return sys ? grossYieldValue(view, sys) : 0;
  };

  const lanes: { routeId: string; mouth: string; traffic: number; value: number }[] = [];
  for (const route of view.galaxy.routes.values()) {
    const mouth = route.a === view.galaxy.hubId ? route.b : route.a;
    if (mouth === view.galaxy.hubId) continue; // wholly inside protected space
    const traffic = view.galaxy.recentTraffic(route.id, view.turn - 1);
    if (traffic < minTraffic) continue;
    const value = Math.max(
      exportValue(route.a),
      exportValue(route.b),
      convoyPrize.get(route.id) ?? 0,
    );
    lanes.push({ routeId: route.id, mouth, traffic, value });
  }
  // Prioritise the richest lanes first (so a limited privateer budget hunts the best loot),
  // then fall back to busy lanes.
  lanes.sort((a, b) => b.value - a.value || b.traffic - a.traffic);

  const orders: Order[] = [];
  let budget = view.me.credits;
  for (const lane of lanes.slice(0, maxLanes)) {
    const covered =
      view.me.privateers.some((p) => p.basedAt === lane.mouth && p.turnsLeft > 0) ||
      (view.me.ships.some((s) => s.raider) &&
        view.me.ownedSystemIds.some(
          (o) => o === lane.mouth || view.galaxy.routeBetween(o, lane.mouth) !== undefined,
        ));
    if (!covered) {
      if (budget <= view.config.tuning.privateerCost * fundFactor) continue; // can't reach this lane
      orders.push({ kind: "hirePrivateer", basedAt: lane.mouth });
      budget -= view.config.tuning.privateerCost;
    }
    orders.push({ kind: "interdict", routeId: lane.routeId });
  }
  return orders;
}

/**
 * Build a cheap stationary defense platform (Section 15) on an under-defended owned
 * system. Platforms are the baseline guard — they don't escort convoys like ships, but
 * they cheaply harden a system's tunnel mouths, especially on exposed frontier lanes.
 */
export function maybeBuildPlatforms(view: PlayerView): Order[] {
  if (view.turn < 7 || view.me.credits < view.config.tuning.platformCost * 2) return [];
  const ranked = view.me.ownedSystemIds
    .map((id) => view.galaxy.system(id))
    // Baseline guard: one platform per system, two on exposed frontier worlds.
    .map((s) => ({ sys: s, want: potentialYields(s).rareIsotopes > 0 ? 2 : 1 }))
    .filter((e) => e.sys.platforms < Math.min(e.want, view.config.tuning.platformCap))
    .map((e) => ({ sys: e.sys, score: routeExposureScore(view, e.sys) + grossYieldValue(view, e.sys) / 50 }))
    .sort((a, b) => b.score - a.score);
  const target = ranked[0];
  if (!target) return [];
  return [{ kind: "buildPlatform", systemId: target.sys.id }];
}

/**
 * Build escort/defense warships and station them at the corp's most valuable, most
 * exposed systems — defending those systems' tunnel mouths and automatically escorting
 * the convoys that carry their trade goods. Higher-tier hulls consume rare isotopes, so
 * controlling the frontier translates directly into stronger fleets.
 */
export function maybeBuildWarships(view: PlayerView): Order[] {
  if (view.turn < 9 || view.me.ownedSystemIds.length === 0) return [];

  // Field the best hull we can AFFORD up to our tech tier — falling back to a cheaper
  // tier rather than stalling. Rare-isotope cost is covered by our own frontier output
  // first, with any shortfall bought from the exchange (priced into the bill).
  const t = view.config.tuning;
  const localIsotopes = view.me.ownedSystemIds.reduce(
    (s, id) => s + view.galaxy.system(id).stockpile.rareIsotopes,
    0,
  );
  let tier: RangeTier | undefined;
  for (let cand = view.me.rangeTier; cand >= 1; cand--) {
    const isoBill =
      Math.max(0, t.shipIsotopeCost[cand as RangeTier] - localIsotopes) *
      view.market.prices.rareIsotopes;
    if (view.me.credits > (t.shipCost[cand as RangeTier] + isoBill) * 1.1) {
      tier = cand as RangeTier;
      break;
    }
  }
  if (tier === undefined) return [];

  // A system needs a hull if it is under-guarded, or if we can now field a strictly
  // better tier than anything stationed there (an isotope-fuelled flagship upgrade).
  const ranked = view.me.ownedSystemIds
    .map((id) => view.galaxy.system(id))
    .map((s) => {
      const escorts = view.me.ships.filter((sh) => !sh.raider && sh.stationedAt === s.id);
      const bestTier = escorts.reduce((m, sh) => Math.max(m, sh.rangeTier), 0);
      return {
        sys: s,
        value: grossYieldValue(view, s),
        count: escorts.length,
        bestTier,
        desired: potentialYields(s).rareIsotopes > 0 ? 3 : 2,
      };
    })
    .filter((e) => e.value > 0 && (e.count < e.desired || e.bestTier < tier))
    .sort((a, b) => b.value - a.value);

  const target = ranked[0];
  if (!target) return [];
  return [{ kind: "buildShip", rangeTier: tier, raider: false, systemId: target.sys.id }];
}
