/**
 * Game engine: turn loop and resolution in the exact Section 20 order.
 *
 *   lock → administrative builds → production → market clearing → convoy launch →
 *   route interdiction → targeted raids → arrivals & settlements →
 *   upkeep/food/debt → valuation → report
 *
 * "No same-turn chaining" (Section 20): goods arriving during a resolution become
 * available only in the next order window. Newly launched convoys therefore do not
 * advance on their launch turn, and systems claimed this turn produce starting next turn.
 */
import type { GameConfig } from "./config.js";
import {
  EXTRACTOR_CAP,
  effectiveYields,
  siteOutput,
  systemHasHabitableBody,
  systemSeed,
} from "./bodies.js";
import { Galaxy } from "./galaxy.js";
import { Market, type ClearableOrder } from "./market.js";
import {
  canRaidRoute,
  raidStrength,
  resolveRaid,
  type RaidResult,
} from "./raiding.js";
import { Rng } from "./rng.js";
import {
  emptyRaidOutcomes,
  type GameMetrics,
  type TurnSnapshot,
} from "./metrics.js";
import {
  RESOURCES,
  type Convoy,
  type Corporation,
  type MegastructureKind,
  type Order,
  type PopulationStage,
  type Resource,
  type System,
} from "./types.js";
import type { Bot, BotFactory, PlayerView } from "./bots/bot.js";
import { HybridBot } from "./bots/hybrid.js";
import type { TurnEvent, TurnReport } from "./report.js";

export interface EngineOptions {
  /** Optional per-turn text logger for `--verbose` single-game runs. */
  log?: (line: string) => void;
}

/** Display names for megastructures (Section 22). */
const MEGASTRUCTURE_LABEL: Record<MegastructureKind, string> = {
  orbitalStation: "Orbital Station",
  spaceElevator: "Space Elevator",
  ringworld: "Ringworld",
};

export class Engine {
  readonly config: GameConfig;
  readonly seed: number;
  readonly galaxy: Galaxy;
  readonly market: Market;
  readonly rng: Rng;
  readonly corps: Corporation[] = [];
  private readonly bots = new Map<string, Bot>();
  private convoys: Convoy[] = [];
  private convoyCounter = 0;
  private readonly claimedTurn = new Map<string, number>();
  private turn = 0;
  private readonly log: (line: string) => void;

  /** Observations collected during the current turn for the interactive TurnReport. */
  private events: TurnEvent[] = [];
  /** Tax levied during the most recent turn (surfaced in the TurnReport). */
  private lastTaxLevied = 0;

  private readonly metrics: GameMetrics;

  constructor(
    config: GameConfig,
    seed: number,
    registry: Map<string, BotFactory>,
    options: EngineOptions = {},
  ) {
    this.config = config;
    this.seed = seed;
    this.rng = new Rng(seed);
    this.galaxy = new Galaxy(config);
    this.market = new Market(config.tuning);
    this.log = options.log ?? (() => {});

    const botIds = config.scenario.bots ?? ["balanced"];
    for (let i = 0; i < config.players; i++) {
      const botId = botIds[i % botIds.length]!;
      const factory = registry.get(botId);
      if (!factory) throw new Error(`Unknown bot '${botId}'`);
      const id = `corp-${i}`;
      const corp: Corporation = {
        id,
        name: `Corp ${i + 1}`,
        credits: config.tuning.startingCredits,
        debt: 0,
        ownedSystemIds: [],
        ships: [{ rangeTier: 1, combat: 0, raider: false, stationedAt: "" }],
        privateers: [],
        rangeTier: 1,
        valuation: 0,
        sharePrice: 0,
        sharesOutstanding: config.tuning.sharesOutstanding,
        shareRegister: { [id]: config.tuning.sharesOutstanding },
        founderId: id,
        recentEarnings: [],
        isFreeOperator: false,
        botId,
        hasCharter: false,
      };
      this.corps.push(corp);
      this.bots.set(corp.id, factory());
    }

    this.metrics = {
      seed,
      players: config.players,
      turns: config.turns,
      snapshots: [],
      secondClaimTurn: Object.fromEntries(this.corps.map((c) => [c.id, -1])),
      range2Turn: Object.fromEntries(this.corps.map((c) => [c.id, -1])),
      auctionRefundFrac: 0,
      auctionFallbackUsage: 0,
      finalValuation: {},
      acquisitionsTotal: 0,
      distressLiquidations: 0,
      finalFreeOperators: 0,
      depotsBuilt: 0,
      shipsBuilt: 0,
      platformsBuilt: 0,
      finalStageCounts: { outpost: 0, settlement: 0, colony: 0, city: 0, metropolis: 0 },
    };

    // No opening auction: each corporation is randomly seeded onto a distinct inner-ring
    // system at match start (deterministic via the seeded Rng).
    this.assignStartingSystems();
  }

  /**
   * Randomly assign each corporation a distinct inner-ring starting system. Replaces the
   * opening auction — systems are owned from turn 1 and produce immediately.
   */
  private assignStartingSystems(): void {
    const pool = this.galaxy.innerRingSystems().filter((s) => s.owner === null);
    // Fisher–Yates shuffle using the seeded Rng (deterministic for replay).
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng.next() * (i + 1));
      [pool[i], pool[j]] = [pool[j]!, pool[i]!];
    }
    this.corps.forEach((corp, idx) => {
      const sys = pool[idx];
      if (!sys) return;
      sys.owner = corp.id;
      corp.ownedSystemIds.push(sys.id);
      corp.hasCharter = true;
      this.ensureStartHabitable(sys);
      this.grantStarterExtractor(sys);
    });
  }

  /**
   * Guarantee a corp's home system can host a population (Section 21): if it has no habitable
   * world, the charter establishes a habitat dome (a habitable planet + a small local food
   * source). Applied only to starting systems — later expansion claims get no such grant, so
   * garden worlds stay a scarce prize and population/tax doesn't become universal.
   */
  private ensureStartHabitable(sys: System): void {
    if (systemHasHabitableBody(sys)) return;
    if (sys.bodies && sys.bodies.planets.length > 0) {
      const p = sys.bodies.planets.find((pl) => pl.type === "ocean") ?? sys.bodies.planets[0]!;
      p.habitable = true;
    }
    if (!sys.sites.some((s) => s.resource === "food")) {
      sys.sites.push({
        key: "home:food", bodyKind: "planet", bodyType: "ocean", bodyLabel: "Habitat dome",
        orbit: 0, habitable: true, resource: "food", richness: 6, reservesRemaining: null,
        accessibility: 1, extractorLevel: 1, prospected: true, disabledUntil: 0,
      });
    }
  }

  /**
   * Grant a fresh charter system a free level-1 extractor on its best raw deposit (Section 21),
   * so a newly-claimed/assigned world produces immediately instead of sitting inert until the
   * owner has built an extractor. No-op on legacy `yields` systems (already fully developed).
   */
  private grantStarterExtractor(sys: System): void {
    if (sys.sites.some((s) => s.extractorLevel > 0)) return;
    const candidates = sys.sites
      .filter((s) => s.extractorLevel === 0)
      // Prefer an accessible, rich, basic raw to bootstrap the economy.
      .map((s) => ({ s, score: s.richness * s.accessibility * (s.resource === "antimatter" ? 0.3 : 1) }))
      .sort((a, b) => b.score - a.score);
    const pick = candidates[0]?.s;
    if (pick) {
      pick.extractorLevel = 1;
      pick.prospected = true;
    }
  }

  /** Run the whole game and return collected metrics. */
  run(): GameMetrics {
    for (this.turn = 1; this.turn <= this.config.turns; this.turn++) {
      this.runNormalTurn();
    }
    for (const c of this.corps) {
      this.metrics.finalValuation[c.id] = c.valuation;
      if (c.isFreeOperator) this.metrics.finalFreeOperators += 1;
    }
    for (const sys of this.galaxy.allSystems()) {
      if (sys.owner !== null) this.metrics.finalStageCounts[sys.populationStage] += 1;
    }
    return this.metrics;
  }

  // ----- Interactive stepping API (web client) -----
  //
  // The headless `run()` drives the whole match in one call. The web client drives
  // it one turn at a time, injecting the human seat's orders between turns (via a
  // HumanBot whose bid()/decide() return UI-staged orders). These wrappers add no new
  // resolution logic — they reuse the same private turn methods — so the simulator and
  // its determinism tests are unaffected.

  /** True once the match has played its final turn. */
  get isOver(): boolean {
    return this.turn >= this.config.turns;
  }

  /** The current turn number (0 before the first turn, then 1..N as turns resolve). */
  get currentTurn(): number {
    return this.turn;
  }

  /** Convoys currently live on the map. */
  get activeConvoys(): readonly Convoy[] {
    return this.convoys;
  }

  /** A player's full view of the game (the same surface bots reason over). */
  playerView(corpId: string): PlayerView {
    const corp = this.corps.find((c) => c.id === corpId);
    if (!corp) throw new Error(`Unknown corporation ${corpId}`);
    return this.viewFor(corp);
  }

  /**
   * Make a seat human-controllable: wrap its AI bot in a HybridBot so it can take human
   * orders (and fall back to the AI on turns with none). Idempotent-ish; call once per
   * human seat after construction.
   */
  makeHybrid(corpId: string): void {
    const existing = this.bots.get(corpId);
    if (existing && !(existing instanceof HybridBot)) {
      this.bots.set(corpId, new HybridBot(existing));
    }
  }

  /**
   * Stage a human seat's orders for the next `stepTurn`. Pass `null` to defer that seat
   * to its fallback AI for this turn (how replay reproduces pre-takeover turns).
   */
  setHumanOrders(corpId: string, orders: Order[] | null): void {
    const bot = this.bots.get(corpId);
    if (bot && "pendingOrders" in bot) {
      (bot as { pendingOrders: Order[] | null }).pendingOrders = orders;
    }
  }

  /** Resolve one turn and return its report. (Turn 1 is the first playable turn.) */
  stepTurn(): TurnReport {
    if (this.isOver) throw new Error("Match is over");
    this.turn += 1;
    this.runNormalTurn();
    if (this.isOver) {
      for (const c of this.corps) {
        this.metrics.finalValuation[c.id] = c.valuation;
        if (c.isFreeOperator) this.metrics.finalFreeOperators += 1;
      }
    }
    return this.buildReport("normal");
  }

  private buildReport(phase: "auction" | "normal" = "normal"): TurnReport {
    return {
      turn: this.turn,
      phase,
      events: this.events.slice(),
      prices: { ...this.market.prices },
      corps: this.corps.map((c) => ({
        id: c.id,
        credits: Math.round(c.credits),
        valuation: c.valuation,
        sharePrice: c.sharePrice,
      })),
      taxLevied: Math.round(this.lastTaxLevied),
    };
  }

  // ----- Normal turn -----

  private runNormalTurn(): void {
    this.log(`\n=== Turn ${this.turn} ===`);
    this.events = [];
    const creditsBefore = new Map(this.corps.map((c) => [c.id, c.credits]));

    // 1. Lock: collect orders from every bot.
    const ordersByCorp = new Map<string, Order[]>();
    const orderCounts: Record<string, number> = {};
    for (const corp of this.corps) {
      const bot = this.bots.get(corp.id)!;
      const orders = bot.decide(this.viewFor(corp));
      ordersByCorp.set(corp.id, orders);
      orderCounts[corp.id] = orders.length;
    }

    // 1.5 Administrative builds (claims, surveys, ships, research, depots, finance).
    this.resolveAdministrative(ordersByCorp);

    // 2. Production into local stockpiles (scaled by unrest; hydroponics add food).
    this.resolveProduction();

    // 3. Market clearing + 4. convoy launch.
    const launchInfo = this.resolveMarketAndLaunch(ordersByCorp);

    // 5. Route interdiction (predictive) + 6. targeted raids.
    const raidStats = this.resolveRaids(ordersByCorp);

    // 7. Arrivals & settlements.
    this.resolveArrivals();

    // 8. Upkeep, population/food, tax, debt.
    const popStats = this.resolvePopulationAndUpkeep();
    this.lastTaxLevied = popStats.taxLevied;

    // 9. Valuation + share prices.
    this.updateValuations();

    // 9.5 Equity: share purchases, acquisitions, distress liquidation (Sections 17–18).
    const equityStats = this.resolveEquity(ordersByCorp);
    equityStats.taxLevied = popStats.taxLevied;

    // Record per-turn earnings for valuation momentum.
    for (const corp of this.corps) {
      const delta = corp.credits - (creditsBefore.get(corp.id) ?? corp.credits);
      corp.recentEarnings.push(delta);
      if (corp.recentEarnings.length > 3) corp.recentEarnings.shift();
    }

    // 10. Report.
    this.recordSnapshot(this.turn, orderCounts, launchInfo, raidStats, equityStats);
  }

  private resolveAdministrative(ordersByCorp: Map<string, Order[]>): void {
    for (const corp of this.corps) {
      for (const order of ordersByCorp.get(corp.id) ?? []) {
        switch (order.kind) {
          case "claim": {
            // Free Operators cannot register new charter claims (Section 18).
            if (corp.isFreeOperator) break;
            const sys = this.galaxy.systems.get(order.systemId);
            if (!sys || sys.owner !== null) break;
            if (corp.credits < order.amount) break;
            corp.credits -= order.amount;
            sys.owner = corp.id;
            corp.ownedSystemIds.push(sys.id);
            this.grantStarterExtractor(sys);
            this.claimedTurn.set(sys.id, this.turn);
            if (
              corp.ownedSystemIds.length === 2 &&
              this.metrics.secondClaimTurn[corp.id] === -1
            ) {
              this.metrics.secondClaimTurn[corp.id] = this.turn;
            }
            this.events.push({ type: "build", corpId: corp.id, what: "Claimed system", systemId: sys.id });
            this.log(`  ${corp.name} claims ${sys.name} for ${order.amount} cr`);
            break;
          }
          case "survey": {
            const route = this.galaxy.routes.get(order.routeId);
            if (!route || route.charted) break;
            if (corp.credits < this.config.tuning.surveyCost) break;
            corp.credits -= this.config.tuning.surveyCost;
            route.charted = true;
            this.events.push({ type: "build", corpId: corp.id, what: "Charted warp route" });
            this.log(`  ${corp.name} charts route ${route.id}`);
            break;
          }
          case "buildShip": {
            const t = this.config.tuning;
            const sys = this.galaxy.systems.get(order.systemId);
            if (!sys || sys.owner !== corp.id) break; // must base it at an owned system
            if (order.rangeTier > corp.rangeTier) break;
            const cost =
              t.shipCost[order.rangeTier] + (order.raider ? t.raiderShipExtraCost : 0);
            // Higher-tier hulls require strategic resources — rare isotopes (Range 2+) and
            // antimatter (capital Range 4+ hulls) — drawn from the corp's own stockpiles
            // first, with any shortfall bought from the exchange. Controlling the frontier
            // makes advanced fleets cheaper; everyone else pays market price.
            // Hulls also need manufactured alloys + components (Section 07b), drawn from the
            // corp's stockpiles first with any shortfall bought from the exchange.
            const isoBill = this.strategicBill(corp, "rareIsotopes", t.shipIsotopeCost[order.rangeTier]);
            const amBill = this.strategicBill(corp, "antimatter", t.shipAntimatterCost[order.rangeTier]);
            const alloyBill = this.strategicBill(corp, "alloys", t.shipAlloyCost[order.rangeTier]);
            const compBill = this.strategicBill(corp, "components", t.shipComponentCost[order.rangeTier]);
            if (corp.credits < cost + isoBill + amBill + alloyBill + compBill) break;
            this.consumeStrategic(corp, "rareIsotopes", t.shipIsotopeCost[order.rangeTier]);
            this.consumeStrategic(corp, "antimatter", t.shipAntimatterCost[order.rangeTier]);
            this.consumeStrategic(corp, "alloys", t.shipAlloyCost[order.rangeTier]);
            this.consumeStrategic(corp, "components", t.shipComponentCost[order.rangeTier]);
            corp.credits -= cost + isoBill + amBill + alloyBill + compBill;
            corp.ships.push({
              rangeTier: order.rangeTier,
              combat: t.shipCombat[order.rangeTier] + (order.raider ? t.raiderCombatBonus : 0),
              raider: order.raider,
              stationedAt: sys.id,
            });
            this.metrics.shipsBuilt += 1;
            this.events.push({
              type: "build",
              corpId: corp.id,
              what: `Range-${order.rangeTier} ${order.raider ? "raider" : "escort"}`,
              systemId: sys.id,
            });
            this.log(
              `  ${corp.name} builds a Range-${order.rangeTier} ${order.raider ? "raider" : "escort"} at ${sys.name}`,
            );
            break;
          }
          case "researchRange": {
            const cost = this.config.tuning.rangeResearchCost[order.targetTier];
            if (order.targetTier <= corp.rangeTier) break;
            if (corp.credits < cost) break;
            corp.credits -= cost;
            corp.rangeTier = order.targetTier;
            if (order.targetTier >= 2 && this.metrics.range2Turn[corp.id] === -1) {
              this.metrics.range2Turn[corp.id] = this.turn;
            }
            this.events.push({ type: "build", corpId: corp.id, what: `Researched Range ${order.targetTier}` });
            this.log(`  ${corp.name} researches Range ${order.targetTier}`);
            break;
          }
          case "hirePrivateer": {
            if (corp.credits < this.config.tuning.privateerCost) break;
            corp.credits -= this.config.tuning.privateerCost;
            corp.privateers.push({
              basedAt: order.basedAt,
              strength: this.config.tuning.privateerStrength,
              turnsLeft: this.config.tuning.privateerTurns,
            });
            this.events.push({ type: "build", corpId: corp.id, what: "Hired privateer", systemId: order.basedAt });
            this.log(`  ${corp.name} hires a privateer at ${order.basedAt}`);
            break;
          }
          case "buildDepot": {
            // Trade Depots are colonial infrastructure (Section 12); not for Free Operators.
            if (corp.isFreeOperator) break;
            const t = this.config.tuning;
            const sys = this.galaxy.systems.get(order.systemId);
            if (!sys || sys.owner !== corp.id || sys.hasDepot) break;
            // Construction consumes alloys; a depot also needs components (Section 07b).
            const alloyBill = this.strategicBill(corp, "alloys", t.buildAlloyCost);
            const compBill = this.strategicBill(corp, "components", t.depotComponentCost);
            if (corp.credits < t.depotCost + alloyBill + compBill) break;
            this.consumeStrategic(corp, "alloys", t.buildAlloyCost);
            this.consumeStrategic(corp, "components", t.depotComponentCost);
            corp.credits -= t.depotCost + alloyBill + compBill;
            sys.hasDepot = true;
            this.metrics.depotsBuilt += 1;
            this.events.push({ type: "build", corpId: corp.id, what: "Trade Depot", systemId: sys.id });
            this.log(`  ${corp.name} builds a Trade Depot at ${sys.name}`);
            break;
          }
          case "buildHydroponics": {
            if (corp.isFreeOperator) break;
            const sys = this.galaxy.systems.get(order.systemId);
            if (!sys || sys.owner !== corp.id) break;
            if (corp.credits < this.config.tuning.hydroponicsCost) break;
            corp.credits -= this.config.tuning.hydroponicsCost;
            sys.hydroponics += 1;
            this.events.push({ type: "build", corpId: corp.id, what: "Hydroponics module", systemId: sys.id });
            this.log(`  ${corp.name} builds hydroponics at ${sys.name}`);
            break;
          }
          case "buildProcessor": {
            // A Processor runs one production-chain recipe each turn (Section 07b).
            if (corp.isFreeOperator) break;
            const t = this.config.tuning;
            const sys = this.galaxy.systems.get(order.systemId);
            if (!sys || sys.owner !== corp.id) break;
            const recipe = t.recipes.find((r) => r.id === order.recipeId);
            if (!recipe) break;
            const alloyBill = this.strategicBill(corp, "alloys", t.buildAlloyCost);
            if (corp.credits < recipe.buildCost + alloyBill) break;
            this.consumeStrategic(corp, "alloys", t.buildAlloyCost);
            corp.credits -= recipe.buildCost + alloyBill;
            sys.processors[recipe.id] = (sys.processors[recipe.id] ?? 0) + 1;
            this.events.push({ type: "build", corpId: corp.id, what: `${recipe.id} processor`, systemId: sys.id });
            this.log(`  ${corp.name} builds a ${recipe.id} processor at ${sys.name}`);
            break;
          }
          case "buildReactor": {
            // Reactors add power capacity and burn helium3 to run processors (Section 07b).
            if (corp.isFreeOperator) break;
            const t = this.config.tuning;
            const sys = this.galaxy.systems.get(order.systemId);
            if (!sys || sys.owner !== corp.id) break;
            const alloyBill = this.strategicBill(corp, "alloys", t.buildAlloyCost);
            if (corp.credits < t.reactorCost + alloyBill) break;
            this.consumeStrategic(corp, "alloys", t.buildAlloyCost);
            corp.credits -= t.reactorCost + alloyBill;
            sys.reactors += 1;
            this.events.push({ type: "build", corpId: corp.id, what: "Reactor", systemId: sys.id });
            this.log(`  ${corp.name} builds a reactor at ${sys.name}`);
            break;
          }
          case "upgradeInfrastructure": {
            // Raw-fed system upgrades (Section 07c): a scaling sink for metals/silicates/helium3.
            if (corp.isFreeOperator) break;
            const inf = this.config.tuning.infrastructure;
            const sys = this.galaxy.systems.get(order.systemId);
            if (!sys || sys.owner !== corp.id) break;
            let level: number;
            let creditBase: number;
            let rawRes: Resource;
            let rawBase: number;
            if (order.track === "mining") {
              level = sys.miningRigs; creditBase = inf.miningCreditCost; rawRes = "metals"; rawBase = inf.miningMetalsCost;
            } else if (order.track === "habitat") {
              level = sys.habitats; creditBase = inf.habitatCreditCost; rawRes = "silicates"; rawBase = inf.habitatSilicatesCost;
            } else {
              level = sys.powerGrid; creditBase = inf.powerCreditCost; rawRes = "helium3"; rawBase = inf.powerHelium3Cost;
            }
            if (level >= inf.cap) break;
            const factor = level + 1; // cost scales with the level being reached
            const creditCost = creditBase * factor;
            const rawNeed = rawBase * factor;
            const rawBill = this.strategicBill(corp, rawRes, rawNeed);
            if (corp.credits < creditCost + rawBill) break;
            this.consumeStrategic(corp, rawRes, rawNeed);
            corp.credits -= creditCost + rawBill;
            if (order.track === "mining") sys.miningRigs += 1;
            else if (order.track === "habitat") sys.habitats += 1;
            else sys.powerGrid += 1;
            this.events.push({ type: "build", corpId: corp.id, what: `${order.track} upgrade`, systemId: sys.id });
            this.log(`  ${corp.name} upgrades ${order.track} at ${sys.name} to L${level + 1}`);
            break;
          }
          case "buildPlatform": {
            if (corp.isFreeOperator) break;
            const t = this.config.tuning;
            const sys = this.galaxy.systems.get(order.systemId);
            if (!sys || sys.owner !== corp.id) break;
            if (sys.platforms >= t.platformCap) break;
            const alloyBill = this.strategicBill(corp, "alloys", t.buildAlloyCost);
            if (corp.credits < t.platformCost + alloyBill) break;
            this.consumeStrategic(corp, "alloys", t.buildAlloyCost);
            corp.credits -= t.platformCost + alloyBill;
            sys.platforms += 1;
            this.metrics.platformsBuilt += 1;
            this.events.push({ type: "build", corpId: corp.id, what: "Defense platform", systemId: sys.id });
            this.log(`  ${corp.name} builds a defense platform at ${sys.name}`);
            break;
          }
          case "buildMegastructure": {
            // Pour overproduced metal into a grand construction (Section 22). One of each per
            // system, gated by population; consumes an enormous metals + alloys bill (drawn from
            // owned stockpiles first, shortfall bought at market — which lifts the metals price).
            if (corp.isFreeOperator) break;
            const t = this.config.tuning;
            const sys = this.galaxy.systems.get(order.systemId);
            if (!sys || sys.owner !== corp.id) break;
            if (sys.megastructures.includes(order.structure)) break;
            const spec = t.megastructures[order.structure];
            const stages: PopulationStage[] = ["outpost", "settlement", "colony", "city", "metropolis"];
            if (stages.indexOf(sys.populationStage) < stages.indexOf(spec.requiresStage)) break;
            const metalsBill = this.strategicBill(corp, "metals", spec.metalsCost);
            const alloyBill = this.strategicBill(corp, "alloys", spec.alloyCost);
            if (corp.credits < spec.creditCost + metalsBill + alloyBill) break;
            this.consumeStrategic(corp, "metals", spec.metalsCost);
            this.consumeStrategic(corp, "alloys", spec.alloyCost);
            corp.credits -= spec.creditCost + metalsBill + alloyBill;
            sys.megastructures.push(order.structure);
            this.events.push({ type: "build", corpId: corp.id, what: MEGASTRUCTURE_LABEL[order.structure], systemId: sys.id });
            this.log(`  ${corp.name} completes a ${MEGASTRUCTURE_LABEL[order.structure]} at ${sys.name}`);
            break;
          }
          case "buildExtractor": {
            // Work (or deepen) a deposit on one of the system's bodies (Section 21).
            if (corp.isFreeOperator) break;
            const t = this.config.tuning;
            const sys = this.galaxy.systems.get(order.systemId);
            if (!sys || sys.owner !== corp.id) break;
            const site = sys.sites.find((s) => s.key === order.siteKey);
            if (!site || site.extractorLevel >= EXTRACTOR_CAP) break;
            // Cost climbs with the level reached and with how inaccessible the deposit is.
            const factor =
              (site.extractorLevel + 1) * (1 + (1 - site.accessibility) * t.extractor.accessibilityMult);
            const cost = Math.round(t.extractor.buildCost * factor);
            const alloyBill = this.strategicBill(corp, "alloys", t.extractor.alloyCost);
            if (corp.credits < cost + alloyBill) break;
            this.consumeStrategic(corp, "alloys", t.extractor.alloyCost);
            corp.credits -= cost + alloyBill;
            site.extractorLevel += 1;
            site.prospected = true; // working a deposit reveals its true richness
            this.events.push({ type: "build", corpId: corp.id, what: `${site.resource} extractor`, systemId: sys.id });
            this.log(`  ${corp.name} builds a ${site.resource} extractor at ${sys.name} (L${site.extractorLevel})`);
            break;
          }
          case "assay": {
            // Survey a deposit to reveal its exact richness/reserves (Section 21).
            if (corp.isFreeOperator) break;
            const sys = this.galaxy.systems.get(order.systemId);
            if (!sys || sys.owner !== corp.id) break;
            const site = sys.sites.find((s) => s.key === order.siteKey);
            if (!site || site.prospected) break;
            if (corp.credits < this.config.tuning.assayCost) break;
            corp.credits -= this.config.tuning.assayCost;
            site.prospected = true;
            this.events.push({ type: "build", corpId: corp.id, what: `Assayed ${site.resource} deposit`, systemId: sys.id });
            break;
          }
          case "borrow": {
            // Debt is capped to a multiple of valuation (Section 17).
            const ceiling = Math.max(0, corp.valuation * this.config.tuning.maxDebtToValuation);
            const room = Math.max(0, ceiling - corp.debt);
            const amount = Math.min(order.amount, room);
            if (amount <= 0) break;
            corp.credits += amount;
            corp.debt += amount;
            break;
          }
          default:
            break;
        }
      }
    }
  }

  private resolveProduction(): void {
    const t = this.config.tuning;
    for (const sys of this.galaxy.allSystems()) {
      if (sys.owner === null) continue;
      if ((this.claimedTurn.get(sys.id) ?? 0) >= this.turn) continue; // claimed this turn
      // Unrest from starvation drags extraction output down (Section 08).
      const efficiency = 1 - t.unrestProductionPenalty * sys.unrest;
      // Body-driven extraction (Section 21): each worked site produces richness × extractor
      // efficiency × stellar modifier, clamped to its remaining reserves. Finite deposits
      // deplete by what they actually extract, so rich worlds eventually run dry.
      const starType = sys.bodies?.starType;
      const seed = systemSeed(sys);
      for (const site of sys.sites) {
        const base = siteOutput(site, starType, seed, this.turn, this.config.turns);
        if (base <= 0) continue;
        const extracted = base * efficiency;
        if (extracted <= 0) continue;
        sys.stockpile[site.resource] += extracted;
        if (site.reservesRemaining !== null) {
          site.reservesRemaining = Math.max(0, site.reservesRemaining - extracted);
        }
      }
      // Hydroponics convert ice into food (Section 08), within available ice.
      if (sys.hydroponics > 0) {
        const iceWanted = sys.hydroponics * t.hydroponicsIceUse;
        const iceUsed = Math.min(iceWanted, sys.stockpile.ice);
        sys.stockpile.ice -= iceUsed;
        const ratio = iceWanted > 0 ? iceUsed / iceWanted : 0;
        sys.stockpile.food += sys.hydroponics * t.hydroponicsFoodOutput * ratio;
      }
      // Production chains (Section 07b): reactors supply power, processors run recipes.
      this.resolveProcessors(sys, efficiency);
    }
  }

  /**
   * Run a system's Processor modules for the turn (Section 07b). Reactors burn helium3 to meet
   * the processors' power draw; any deficit browns the whole system out via `powerFactor`.
   * Recipes run in dependency order (config), so a tier-1 output (e.g. alloys) is available to
   * a tier-2 recipe (e.g. components) the same turn — exactly as hydroponics consumes same-turn ice.
   */
  private resolveProcessors(sys: System, efficiency: number): void {
    const t = this.config.tuning;
    // Total power the system's processors want this turn.
    let powerNeed = 0;
    for (const recipe of t.recipes) powerNeed += (sys.processors[recipe.id] ?? 0) * recipe.powerDraw;
    if (powerNeed <= 0) return; // no processors → nothing to power or run

    // Baseline power = free baseline + Power Grid upgrades (Section 07c); reactors fill the gap.
    const baseline = t.basePowerPerSystem + sys.powerGrid * t.infrastructure.powerCapacityPerLevel;
    let powerCapacity = baseline;
    const fromReactors = Math.min(
      Math.max(0, powerNeed - baseline),
      sys.reactors * t.reactorPowerOutput,
    );
    if (fromReactors > 0) {
      const h3Want = (fromReactors / t.reactorPowerOutput) * t.reactorHelium3Use;
      const h3Used = Math.min(h3Want, sys.stockpile.helium3);
      sys.stockpile.helium3 -= h3Used;
      const fuelledFrac = h3Want > 0 ? h3Used / h3Want : 1;
      powerCapacity += fromReactors * fuelledFrac;
    }
    const powerFactor = Math.max(0, Math.min(1, powerCapacity / powerNeed));

    for (const recipe of t.recipes) {
      const count = sys.processors[recipe.id] ?? 0;
      if (count <= 0) continue;
      const scale = count * efficiency * powerFactor; // desired throughput
      if (scale <= 0) continue;
      // Pro-rate by the limiting input (same shape as hydroponics' ice ratio).
      let ratio = 1;
      for (const res of Object.keys(recipe.inputs) as Resource[]) {
        const want = (recipe.inputs[res] ?? 0) * scale;
        if (want <= 0) continue;
        ratio = Math.min(ratio, sys.stockpile[res] / want);
      }
      ratio = Math.max(0, Math.min(1, ratio));
      if (ratio <= 0) continue;
      for (const res of Object.keys(recipe.inputs) as Resource[]) {
        sys.stockpile[res] -= (recipe.inputs[res] ?? 0) * scale * ratio;
      }
      for (const res of Object.keys(recipe.outputs) as Resource[]) {
        sys.stockpile[res] += (recipe.outputs[res] ?? 0) * scale * ratio;
      }
    }
  }

  private resolveMarketAndLaunch(
    ordersByCorp: Map<string, Order[]>,
  ): { convoysLaunched: number; cargoValueShipped: number; routeTraffic: Record<string, number> } {
    // Build the escort pool per corp and per-system escort assignments.
    const escortBySystem = new Map<string, number>(); // key `${corpId}:${systemId}`
    for (const corp of this.corps) {
      for (const order of ordersByCorp.get(corp.id) ?? []) {
        if (order.kind === "escort") {
          escortBySystem.set(`${corp.id}:${order.systemId}`, order.strength);
        }
      }
    }

    // Collect clearable market orders.
    const clearables: ClearableOrder[] = [];
    const orderMeta = new Map<ClearableOrder, { corp: Corporation }>();
    for (const corp of this.corps) {
      for (const order of ordersByCorp.get(corp.id) ?? []) {
        if (order.kind !== "market") continue;
        const co: ClearableOrder = {
          ownerId: corp.id,
          side: order.side,
          resource: order.resource,
          quantity: order.quantity,
          limitPrice: order.limitPrice,
          strict: order.strict,
          systemId: order.systemId,
        };
        clearables.push(co);
        orderMeta.set(co, { corp });
      }
    }

    const { fills } = this.market.clear(clearables);
    let convoysLaunched = 0;
    let cargoValueShipped = 0;
    const routeTraffic: Record<string, number> = {};

    const recordRoutes = (routeIds: string[]) => {
      for (const rid of routeIds) {
        this.galaxy.recordTraffic(rid, this.turn);
        routeTraffic[rid] = (routeTraffic[rid] ?? 0) + 1;
      }
    };

    for (const fill of fills) {
      if (fill.filledQuantity <= 0) continue;
      const corp = orderMeta.get(fill.order)!.corp;
      const price = fill.clearingPrice;
      const resource = fill.order.resource;

      if (fill.order.side === "buy") {
        const path = this.galaxy.shortestWarpPath(
          this.galaxy.hubId,
          fill.order.systemId,
          corp.rangeTier,
        );
        if (!path) continue;
        const hops = path.routes.length;
        const shipMult = this.shippingMultiplier(path.systems, corp.id);
        const unitCost = price + this.config.tuning.shippingFeePerHop * hops * shipMult;
        const affordable = Math.min(
          fill.filledQuantity,
          Math.floor(corp.credits / Math.max(0.01, unitCost)),
        );
        if (affordable <= 0) continue;
        corp.credits -= affordable * unitCost;
        const value = affordable * this.config.tuning.basePrices[resource];
        this.events.push({
          type: "fill",
          corpId: corp.id,
          side: "buy",
          resource,
          quantity: affordable,
          price,
          systemId: fill.order.systemId,
        });
        this.convoys.push(
          this.makeConvoy(corp.id, "buy", resource, affordable, path.systems, path.routes, 0, 0, value),
        );
        convoysLaunched++;
        cargoValueShipped += value;
        recordRoutes(path.routes);
      } else {
        const sys = this.galaxy.systems.get(fill.order.systemId);
        if (!sys || sys.owner !== corp.id) continue;
        const available = sys.stockpile[resource];
        const qty = Math.min(fill.filledQuantity, available);
        if (qty <= 0) continue;
        const path = this.galaxy.shortestWarpPath(
          sys.id,
          this.galaxy.hubId,
          corp.rangeTier,
        );
        if (!path) continue;
        const hops = path.routes.length;
        sys.stockpile[resource] -= qty;
        const shipMult = this.shippingMultiplier(path.systems, corp.id);
        const shipping = this.config.tuning.shippingFeePerHop * hops * qty * shipMult;
        const payout = Math.max(0, qty * price - shipping);
        const value = qty * this.config.tuning.basePrices[resource];
        this.events.push({
          type: "fill",
          corpId: corp.id,
          side: "sell",
          resource,
          quantity: qty,
          price,
          systemId: sys.id,
        });
        // Warships stationed at the origin escort its outbound convoys automatically.
        const escort =
          this.stationedDefense(sys.id, corp.id) + (escortBySystem.get(`${corp.id}:${sys.id}`) ?? 0);
        this.convoys.push(
          this.makeConvoy(corp.id, "sell", resource, qty, path.systems, path.routes, payout, escort, value),
        );
        convoysLaunched++;
        cargoValueShipped += value;
        recordRoutes(path.routes);
      }
    }

    // Internal transfers.
    for (const corp of this.corps) {
      for (const order of ordersByCorp.get(corp.id) ?? []) {
        if (order.kind !== "transfer") continue;
        const from = this.galaxy.systems.get(order.fromSystemId);
        const to = this.galaxy.systems.get(order.toSystemId);
        if (!from || !to || from.owner !== corp.id || to.owner !== corp.id) continue;
        const qty = Math.min(order.quantity, from.stockpile[order.resource]);
        if (qty <= 0) continue;
        const path = this.galaxy.shortestWarpPath(from.id, to.id, corp.rangeTier);
        if (!path) continue;
        from.stockpile[order.resource] -= qty;
        const value = qty * this.config.tuning.basePrices[order.resource];
        const escort =
          this.stationedDefense(from.id, corp.id) + (escortBySystem.get(`${corp.id}:${from.id}`) ?? 0);
        this.convoys.push(
          this.makeConvoy(corp.id, "transfer", order.resource, qty, path.systems, path.routes, 0, escort, value),
        );
        convoysLaunched++;
        cargoValueShipped += value;
        recordRoutes(path.routes);
      }
    }

    return { convoysLaunched, cargoValueShipped, routeTraffic };
  }

  private resolveRaids(
    ordersByCorp: Map<string, Order[]>,
  ): { convoysRaided: number; cargoValueLost: number; raidOutcomes: ReturnType<typeof emptyRaidOutcomes> } {
    const outcomes = emptyRaidOutcomes();
    let convoysRaided = 0;
    let cargoValueLost = 0;
    const raided = new Set<string>();

    const applyResult = (result: RaidResult, convoy: Convoy, attacker: Corporation, routeId: string) => {
      outcomes[result.outcome]++;
      if (result.outcome !== "noContact") {
        this.events.push({
          type: "raid",
          attackerId: attacker.id,
          defenderId: convoy.owner,
          routeId,
          outcome: result.outcome,
          resource: convoy.resource,
          cargoLost: result.cargoDestroyed + result.cargoPlundered,
        });
      }
      if (
        result.outcome === "noContact" ||
        result.outcome === "shadowed"
      ) {
        return;
      }
      convoysRaided++;
      if (result.delayAdded > 0) convoy.segmentTurnsLeft += result.delayAdded;
      const unitValue = convoy.value / Math.max(1, convoy.quantity);
      if (result.cargoDestroyed > 0) {
        convoy.quantity -= result.cargoDestroyed;
        convoy.payout *= convoy.quantity / Math.max(1, convoy.quantity + result.cargoDestroyed);
        cargoValueLost += result.cargoDestroyed * unitValue;
      }
      if (result.cargoPlundered > 0) {
        convoy.quantity -= result.cargoPlundered;
        convoy.payout *= convoy.quantity / Math.max(1, convoy.quantity + result.cargoPlundered);
        cargoValueLost += result.cargoPlundered * unitValue;
        // Fence stolen goods (Section 13): the raider realises a fraction of their value.
        attacker.credits += result.cargoPlundered * unitValue * this.config.tuning.plunderFenceRate;
      }
      if (result.raiderLosses > 0) this.applyRaiderLosses(attacker, result.raiderLosses);
    };

    // 5. Predictive interdiction: hits convoys whose current segment matches the route.
    //    A stronger raid force can strike several shipments on a congested lane.
    for (const corp of this.corps) {
      for (const order of ordersByCorp.get(corp.id) ?? []) {
        if (order.kind !== "interdict") continue;
        const route = this.galaxy.routes.get(order.routeId);
        if (!route) continue;
        if (!canRaidRoute(this.galaxy, corp, route)) continue;
        const strength = raidStrength(corp);
        const targets = this.convoys
          .filter(
            (c) =>
              c.owner !== corp.id &&
              !raided.has(c.id) &&
              c.quantity > 0 &&
              this.convoyCurrentRoute(c) === route.id,
          )
          .sort((a, b) => b.value - a.value);
        if (targets.length === 0) {
          outcomes.noContact++;
          continue;
        }
        const maxHits = 1 + Math.floor(strength / 4); // e.g. a strength-5 privateer hits 2
        for (const target of targets.slice(0, maxHits)) {
          raided.add(target.id);
          const result = resolveRaid(
            this.rng,
            target,
            route,
            corp.id,
            strength,
            this.localDefenseFor(target),
          );
          applyResult(result, target, corp, route.id);
          this.log(
            `  raid: ${corp.name} interdicts ${route.id} → ${result.outcome}` +
              (result.cargoPlundered ? ` (+${result.cargoPlundered} ${target.resource})` : ""),
          );
        }
      }
    }

    // 6. Targeted raids against multi-segment in-transit convoys (Section 15: not 1-turn hub runs).
    for (const corp of this.corps) {
      for (const order of ordersByCorp.get(corp.id) ?? []) {
        if (order.kind !== "targetConvoy") continue;
        const target = this.convoys.find((c) => c.id === order.convoyId);
        if (!target || raided.has(target.id) || target.owner === corp.id) continue;
        if (target.launchedTurn >= this.turn) continue; // not yet in transit
        if (target.routeIds.length < 2) continue; // protected 1-turn run
        const route = this.galaxy.routes.get(this.convoyCurrentRoute(target) ?? "");
        if (!route || !canRaidRoute(this.galaxy, corp, route)) continue;
        raided.add(target.id);
        const result = resolveRaid(
          this.rng,
          target,
          route,
          corp.id,
          raidStrength(corp),
          this.localDefenseFor(target),
        );
        applyResult(result, target, corp, route.id);
      }
    }

    // 6.5 Extraction sabotage (Section 21): knock a rival system's extractor offline. Needs a
    //     raider/privateer able to reach one of the target system's tunnel mouths, and enough
    //     raid strength to beat its local defense plus a sabotage threshold.
    for (const corp of this.corps) {
      for (const order of ordersByCorp.get(corp.id) ?? []) {
        if (order.kind !== "sabotage") continue;
        const sys = this.galaxy.systems.get(order.systemId);
        if (!sys || sys.owner === null || sys.owner === corp.id) continue;
        const site = sys.sites.find((s) => s.key === order.siteKey);
        if (!site || site.extractorLevel <= 0 || site.disabledUntil > this.turn) continue;
        const eligible = sys.routeIds.some((rid) => {
          const r = this.galaxy.routes.get(rid);
          return r ? canRaidRoute(this.galaxy, corp, r) : false;
        });
        if (!eligible) continue;
        const strength = raidStrength(corp);
        const success = strength >= this.systemDefense(sys) + this.config.tuning.sabotage.minStrength;
        if (success) site.disabledUntil = this.turn + this.config.tuning.sabotage.disableTurns;
        this.events.push({
          type: "sabotage",
          attackerId: corp.id,
          defenderId: sys.owner,
          systemId: sys.id,
          resource: site.resource,
          success,
        });
        this.log(
          `  sabotage: ${corp.name} → ${sys.name} ${site.resource} extractor ${success ? "offline" : "repelled"}`,
        );
      }
    }

    // Drop fully destroyed/looted convoys.
    this.convoys = this.convoys.filter((c) => c.quantity > 0);
    return { convoysRaided, cargoValueLost, raidOutcomes: outcomes };
  }

  /** A system's standing raid defense (platforms, mining-rig fortification, depot, stationed ships). */
  private systemDefense(sys: System): number {
    const t = this.config.tuning;
    let def = sys.defense;
    def += sys.platforms * t.platformDefense;
    def += sys.miningRigs * t.infrastructure.miningDefenseBonusPerLevel;
    for (const m of sys.megastructures) def += t.megastructures[m].defenseBonus;
    if (sys.hasDepot) def += t.depotDefenseBonus;
    if (sys.owner) def += this.stationedDefense(sys.id, sys.owner);
    return def;
  }

  private resolveArrivals(): void {
    const surviving: Convoy[] = [];
    for (const convoy of this.convoys) {
      if (convoy.launchedTurn >= this.turn) {
        surviving.push(convoy); // launched this turn; does not advance yet
        continue;
      }
      convoy.segmentTurnsLeft -= 1;
      if (convoy.segmentTurnsLeft > 0) {
        surviving.push(convoy);
        continue;
      }
      convoy.position += 1;
      if (convoy.position >= convoy.path.length - 1) {
        this.deliverConvoy(convoy);
      } else {
        const nextRoute = this.galaxy.routes.get(convoy.routeIds[convoy.position]!);
        convoy.segmentTurnsLeft = nextRoute ? this.effectiveSegmentTime(nextRoute, convoy.owner) : 1;
        surviving.push(convoy);
      }
    }
    this.convoys = surviving;
  }

  private deliverConvoy(convoy: Convoy): void {
    const owner = this.corps.find((c) => c.id === convoy.owner);
    if (!owner) return;
    this.events.push({
      type: "arrival",
      corpId: convoy.owner,
      kind: convoy.kind,
      resource: convoy.resource,
      quantity: convoy.quantity,
      payout: convoy.kind === "sell" ? convoy.payout : 0,
      destSystemId: convoy.path[convoy.path.length - 1]!,
    });
    if (convoy.kind === "sell") {
      owner.credits += convoy.payout;
      this.log(
        `  arrival: ${owner.name} sell ${convoy.quantity} ${convoy.resource} → +${Math.round(convoy.payout)} cr`,
      );
    } else {
      const dest = this.galaxy.systems.get(convoy.path[convoy.path.length - 1]!);
      if (dest) dest.stockpile[convoy.resource] += convoy.quantity;
    }
  }

  private resolvePopulationAndUpkeep(): { taxLevied: number } {
    const t = this.config.tuning;
    const stages: PopulationStage[] = ["outpost", "settlement", "colony", "city", "metropolis"];
    let taxLevied = 0;

    for (const corp of this.corps) {
      for (const sysId of corp.ownedSystemIds) {
        const sys = this.galaxy.system(sysId);
        // Mining Rig fortification lowers a system's upkeep (Section 07c).
        const upkeepFrac = Math.max(0, 1 - sys.miningRigs * t.infrastructure.miningUpkeepReductionPerLevel);
        corp.credits -= sys.upkeep * upkeepFrac;

        // Life support (ice) and food demand scale with population (Section 08).
        const foodNeed = t.foodNeed[sys.populationStage];
        const iceNeed = t.iceNeed[sys.populationStage];
        const food = this.consumeOrImport(corp, sys, "food", foodNeed);
        const ice = this.consumeOrImport(corp, sys, "ice", iceNeed);
        const fed = food.met && ice.met;
        if (!fed) this.events.push({ type: "starved", corpId: corp.id, systemId: sys.id });
        // Growth requires LOCAL food (garden/hydroponics/transfer), not emergency
        // imports: imports keep a colony alive but only local supply lets it thrive.
        // Habitability gate (Section 21): a population can only take root where there is a
        // habitable world or an artificial habitat (hydroponics). Dead stars (white dwarf /
        // neutron) and giant-only systems stay pure industrial outposts unless terraformed.
        const habitable = systemHasHabitableBody(sys) || sys.hydroponics > 0;
        const thriving = fed && food.local && habitable;

        // Habitat upgrades raise both tax yield and growth speed (Section 07c); megastructures
        // (space elevator / ringworld) accelerate growth further (Section 22).
        const habitatTaxMult = 1 + sys.habitats * t.infrastructure.habitatTaxBonusPerLevel;
        const megaGrowth = sys.megastructures.reduce((s, m) => s + t.megastructures[m].growthBonus, 0);
        const habitatGrowthMult = 1 + sys.habitats * t.infrastructure.habitatGrowthBonusPerLevel + megaGrowth;

        // Tax: a fed, content population pays its charter holder (Sections 08/17).
        if (fed) {
          const tax = t.taxPerStage[sys.populationStage] * (1 - sys.unrest) * habitatTaxMult;
          corp.credits += tax;
          taxLevied += tax;
        }

        // Growth vs. unrest (Section 08 food/population loop).
        if (fed) sys.unrest = Math.max(0, sys.unrest - t.unrestRecoveryPerFedTurn);
        else sys.unrest = Math.min(1, sys.unrest + t.unrestPerStarvedTurn);

        if (thriving) {
          sys.populationProgress += t.growthRate[sys.populationStage] * habitatGrowthMult;
          const idx = stages.indexOf(sys.populationStage);
          if (sys.populationProgress >= t.growthThreshold && idx < stages.length - 1) {
            sys.populationStage = stages[idx + 1]!;
            sys.populationProgress = 0;
            this.events.push({ type: "growth", corpId: corp.id, systemId: sys.id, newStage: sys.populationStage });
            this.log(`  ${sys.name} grows to ${sys.populationStage}`);
          }
        } else if (!fed) {
          sys.populationProgress = Math.max(0, sys.populationProgress - 20);
        }
      }

      // Fleet operation burns fuel each turn (Section 07b): a recurring sink that keeps the
      // fuel market live. Drawn from the corp's stockpiles first, shortfall bought at market.
      const fuelNeed = corp.ships.length * t.fuelPerShipPerTurn;
      if (fuelNeed > 0) {
        const fuelBill = this.strategicBill(corp, "fuel", fuelNeed);
        this.consumeStrategic(corp, "fuel", fuelNeed);
        if (corp.credits >= fuelBill) corp.credits -= fuelBill;
      }

      if (corp.debt > 0) corp.debt *= 1 + t.debtInterest;
      for (const p of corp.privateers) p.turnsLeft -= 1;
      corp.privateers = corp.privateers.filter((p) => p.turnsLeft > 0);
    }
    return { taxLevied };
  }

  /**
   * Consume `need` of a resource from a system's local stockpile. Any shortfall is
   * covered by an emergency humanity import at a premium if the owner can afford it
   * (Section 08). `met` is whether the need was fully satisfied; `local` is whether it
   * was satisfied entirely from local supply (which is what fuels population growth).
   */
  private consumeOrImport(
    corp: Corporation,
    sys: { stockpile: Record<Resource, number> },
    resource: Resource,
    need: number,
  ): { met: boolean; local: boolean } {
    if (need <= 0) return { met: true, local: true };
    const fromStock = Math.min(need, sys.stockpile[resource]);
    sys.stockpile[resource] -= fromStock;
    let shortfall = need - fromStock;
    if (shortfall <= 0) return { met: true, local: true };
    // Emergency import from the exchange at a premium (humanity imports).
    const unitCost = this.market.prices[resource] * this.config.tuning.emergencyImportPremium;
    const affordable = Math.min(shortfall, Math.floor(corp.credits / Math.max(0.01, unitCost)));
    if (affordable > 0) {
      corp.credits -= affordable * unitCost;
      shortfall -= affordable;
    }
    return { met: shortfall <= 0, local: false };
  }

  private updateValuations(): void {
    const v = this.config.tuning.valuation;
    for (const corp of this.corps) {
      // equity = system assets + population + infrastructure + ships + stockpiles
      //          + cash + earnings momentum - debt  (Section 17)
      let value = corp.credits - corp.debt;
      value += corp.ships.length * v.shipValue;
      const momentum =
        corp.recentEarnings.length > 0
          ? (corp.recentEarnings.reduce((s, e) => s + e, 0) / corp.recentEarnings.length) *
            v.earningsMomentumWeight
          : 0;
      value += momentum;
      for (const sysId of corp.ownedSystemIds) {
        const sys = this.galaxy.system(sysId);
        // Value the realised per-turn extraction (Section 21: worked sites, net of depletion +
        // stellar), plus the extractor capital sunk into the system's sites.
        const ey = effectiveYields(sys, this.turn, this.config.turns);
        const yieldTotal = RESOURCES.reduce((s, r) => s + ey[r], 0);
        value += yieldTotal * v.perSystemYieldValue;
        value += sys.sites.reduce((s, st) => s + st.extractorLevel, 0) * v.extractorValue;
        value += v.populationValue[sys.populationStage] * (1 - sys.unrest);
        if (sys.hasDepot) value += v.depotValue;
        value += sys.hydroponics * (v.depotValue * 0.25);
        value += Object.values(sys.processors).reduce((s, n) => s + n, 0) * v.processorValue;
        value += sys.reactors * v.reactorValue;
        value += (sys.miningRigs + sys.habitats + sys.powerGrid) * v.infraLevelValue;
        value += sys.platforms * this.config.tuning.platformCost;
        // Megastructures are prestige capital (Section 22).
        for (const m of sys.megastructures) value += this.config.tuning.megastructures[m].valuation;
        for (const r of RESOURCES) {
          value += sys.stockpile[r] * this.config.tuning.basePrices[r] * v.stockpileFrac;
        }
      }
      corp.valuation = Math.round(value);
      corp.sharePrice = Math.max(1, corp.valuation / corp.sharesOutstanding);
    }
  }

  /**
   * Equity layer (Sections 17–18): resolve share purchases, then check for control
   * changes (hostile/friendly acquisitions) and distress liquidations.
   */
  private resolveEquity(
    ordersByCorp: Map<string, Order[]>,
  ): { acquisitions: number; distress: number; taxLevied: number } {
    // Share purchases: shares are bought from the largest existing holder at share price.
    for (const corp of this.corps) {
      for (const order of ordersByCorp.get(corp.id) ?? []) {
        if (order.kind !== "buyShares") continue;
        const target = this.corps.find((c) => c.id === order.targetId);
        if (!target || target.id === corp.id) continue;
        const seller = this.largestHolder(target, corp.id);
        if (!seller) continue;
        const available = target.shareRegister[seller] ?? 0;
        const price = target.sharePrice;
        const wanted = Math.min(order.shares, available);
        const affordable = Math.min(wanted, Math.floor(corp.credits / Math.max(0.01, price)));
        if (affordable <= 0) continue;
        const cost = affordable * price;
        corp.credits -= cost;
        target.shareRegister[seller] = available - affordable;
        target.shareRegister[corp.id] = (target.shareRegister[corp.id] ?? 0) + affordable;
        const sellerCorp = this.corps.find((c) => c.id === seller);
        if (sellerCorp) sellerCorp.credits += cost; // founder/holder is bought out
      }
    }

    // Control changes: any holder past the threshold acquires the charter.
    let acquisitions = 0;
    const threshold = this.config.tuning.acquisitionThreshold * this.config.tuning.sharesOutstanding;
    for (const target of this.corps) {
      if (!target.hasCharter) continue; // nothing to absorb from a charterless shell
      const holder = this.largestHolder(target, null);
      if (!holder || holder === target.founderId) continue;
      if ((target.shareRegister[holder] ?? 0) <= threshold) continue;
      const acquirer = this.corps.find((c) => c.id === holder);
      if (!acquirer || acquirer.id === target.id) continue;
      this.absorb(acquirer, target);
      acquisitions += 1;
    }

    // Distress liquidation: a charter that runs deep into the red loses its charter.
    let distress = 0;
    for (const corp of this.corps) {
      if (!corp.hasCharter) continue;
      if (corp.credits >= this.config.tuning.distressCreditFloor) continue;
      for (const sysId of corp.ownedSystemIds) this.galaxy.system(sysId).owner = null;
      corp.ownedSystemIds = [];
      for (const s of corp.ships) s.stationedAt = ""; // fleet retreats from lost systems
      corp.hasCharter = false;
      corp.isFreeOperator = true;
      this.metrics.distressLiquidations += 1;
      distress += 1;
      this.events.push({ type: "distress", corpId: corp.id });
      this.log(`  ${corp.name} collapses into distress liquidation → Free Operator`);
    }

    return { acquisitions, distress, taxLevied: 0 };
  }

  /** The holder (other than `exclude`) owning the most of a corporation's shares. */
  private largestHolder(target: Corporation, exclude: string | null): string | undefined {
    let best: string | undefined;
    let bestShares = -1;
    for (const [holder, shares] of Object.entries(target.shareRegister)) {
      if (holder === exclude) continue;
      if (shares > bestShares) {
        bestShares = shares;
        best = holder;
      }
    }
    return best;
  }

  /** Acquirer absorbs the target's chartered systems and debt (Sections 17–18). */
  private absorb(acquirer: Corporation, target: Corporation): void {
    for (const sysId of target.ownedSystemIds) {
      this.galaxy.system(sysId).owner = acquirer.id;
      acquirer.ownedSystemIds.push(sysId);
    }
    acquirer.debt += target.debt;
    target.debt = 0;
    target.ownedSystemIds = [];
    for (const s of target.ships) s.stationedAt = ""; // ousted fleet leaves the charter's systems
    target.hasCharter = false;
    target.isFreeOperator = true;
    // A Free Operator that takes control of a charter re-enters charter play (Section 18).
    acquirer.hasCharter = true;
    acquirer.isFreeOperator = false;
    this.metrics.acquisitionsTotal += 1;
    this.events.push({ type: "acquisition", acquirerId: acquirer.id, targetId: target.id });
    this.log(`  ACQUISITION: ${acquirer.name} absorbs ${target.name}'s charter`);
  }

  // ----- helpers -----

  private makeConvoy(
    owner: string,
    kind: Convoy["kind"],
    resource: Resource,
    quantity: number,
    path: string[],
    routeIds: string[],
    payout: number,
    escort: number,
    value: number,
  ): Convoy {
    const firstRoute = this.galaxy.routes.get(routeIds[0] ?? "");
    return {
      id: `convoy-${this.convoyCounter++}`,
      owner,
      kind,
      resource,
      quantity,
      path,
      routeIds,
      position: 0,
      segmentTurnsLeft: firstRoute ? this.effectiveSegmentTime(firstRoute, owner) : 1,
      launchedTurn: this.turn,
      payout,
      escort,
      value,
    };
  }

  /** Route transit time after Trade Depot improvements (Section 12). */
  private effectiveSegmentTime(route: { a: string; b: string; transitTime: number }, ownerId: string): number {
    if (this.routeHasOwnerDepot(route, ownerId)) {
      return Math.max(1, route.transitTime - this.config.tuning.depotTransitBonus);
    }
    return route.transitTime;
  }

  /** True if a route touches a depot the given corporation owns. */
  private routeHasOwnerDepot(route: { a: string; b: string }, ownerId: string): boolean {
    for (const ep of [route.a, route.b]) {
      const sys = this.galaxy.systems.get(ep);
      if (sys && sys.owner === ownerId && sys.hasDepot) return true;
    }
    return false;
  }

  /** Shipping cost multiplier after Trade Depot discounts on the path (Section 12). */
  private shippingMultiplier(pathSystems: string[], ownerId: string): number {
    for (const id of pathSystems) {
      const sys = this.galaxy.systems.get(id);
      if (sys && sys.owner === ownerId && sys.hasDepot) {
        return 1 - this.config.tuning.depotShippingDiscount;
      }
    }
    return 1;
  }

  private convoyCurrentRoute(c: Convoy): string | undefined {
    return c.routeIds[c.position];
  }

  /** Combat of (non-raider) escort ships a corp has stationed at a system. */
  private stationedDefense(systemId: string, corpId: string): number {
    const corp = this.corps.find((c) => c.id === corpId);
    if (!corp) return 0;
    return corp.ships
      .filter((s) => !s.raider && s.stationedAt === systemId)
      .reduce((sum, s) => sum + s.combat, 0);
  }

  private localDefenseFor(convoy: Convoy): number {
    // Defense from the non-hub endpoint of the current route segment.
    const routeId = this.convoyCurrentRoute(convoy);
    if (!routeId) return 0;
    const route = this.galaxy.routes.get(routeId)!;
    let def = 0;
    for (const ep of [route.a, route.b]) {
      if (ep === this.galaxy.hubId) continue;
      const sys = this.galaxy.systems.get(ep);
      if (sys && sys.owner === convoy.owner) {
        def += sys.defense;
        // Stationary defense platforms harden the system's tunnel mouths (Section 15).
        def += sys.platforms * this.config.tuning.platformDefense;
        // Mining Rig fortification hardens the system's tunnel mouths (Section 07c).
        def += sys.miningRigs * this.config.tuning.infrastructure.miningDefenseBonusPerLevel;
        // Megastructures (orbital station, etc.) harden the system's tunnel mouths (Section 22).
        for (const m of sys.megastructures) def += this.config.tuning.megastructures[m].defenseBonus;
        // Depot patrols harden connected tunnels against raiders (Section 12).
        if (sys.hasDepot) def += this.config.tuning.depotDefenseBonus;
        // Warships stationed here defend the system's tunnel mouths.
        def += this.stationedDefense(sys.id, convoy.owner);
      }
    }
    return def;
  }

  /** Credits a corp must pay to buy any shortfall of a build resource from the exchange. */
  private strategicBill(corp: Corporation, resource: Resource, need: number): number {
    if (need <= 0) return 0;
    let local = 0;
    for (const id of corp.ownedSystemIds) local += this.galaxy.system(id).stockpile[resource];
    return Math.max(0, need - local) * this.market.prices[resource];
  }

  /** Consume up to `need` of a build resource from local stockpiles (shortfall is bought). */
  private consumeStrategic(corp: Corporation, resource: Resource, need: number): void {
    if (need <= 0) return;
    let local = 0;
    for (const id of corp.ownedSystemIds) local += this.galaxy.system(id).stockpile[resource];
    this.consumeFromStockpiles(corp, resource, Math.min(need, local));
  }

  /** Consume `need` of a resource from a corp's owned-system stockpiles; true if covered. */
  private consumeFromStockpiles(corp: Corporation, resource: Resource, need: number): boolean {
    if (need <= 0) return true;
    let have = 0;
    for (const id of corp.ownedSystemIds) have += this.galaxy.system(id).stockpile[resource];
    if (have < need) return false;
    let remaining = need;
    for (const id of corp.ownedSystemIds) {
      if (remaining <= 0) break;
      const sys = this.galaxy.system(id);
      const take = Math.min(sys.stockpile[resource], remaining);
      sys.stockpile[resource] -= take;
      remaining -= take;
    }
    return true;
  }

  private applyRaiderLosses(corp: Corporation, losses: number): void {
    let remaining = losses;
    for (const p of corp.privateers) {
      if (remaining <= 0) break;
      const absorb = Math.min(p.strength, remaining);
      p.strength -= absorb;
      remaining -= absorb;
    }
    corp.privateers = corp.privateers.filter((p) => p.strength > 0);
    for (const ship of corp.ships) {
      if (remaining <= 0) break;
      if (!ship.raider) continue;
      const absorb = Math.min(ship.combat, remaining);
      ship.combat -= absorb;
      remaining -= absorb;
    }
    corp.ships = corp.ships.filter((s) => !s.raider || s.combat > 0);
  }

  private viewFor(corp: Corporation): PlayerView {
    return {
      turn: this.turn,
      config: this.config,
      galaxy: this.galaxy,
      market: this.market,
      me: corp,
      corporations: this.corps,
      convoys: this.convoys,
      rng: this.rng,
    };
  }

  private recordSnapshot(
    turn: number,
    orderCounts: Record<string, number>,
    launch?: { convoysLaunched: number; cargoValueShipped: number; routeTraffic: Record<string, number> },
    raid?: { convoysRaided: number; cargoValueLost: number; raidOutcomes: ReturnType<typeof emptyRaidOutcomes> },
    equity?: { acquisitions: number; distress: number; taxLevied: number },
  ): void {
    const credits: Record<string, number> = {};
    const valuation: Record<string, number> = {};
    for (const c of this.corps) {
      credits[c.id] = Math.round(c.credits);
      valuation[c.id] = c.valuation;
    }
    const snapshot: TurnSnapshot = {
      turn,
      prices: { ...this.market.prices },
      credits,
      valuation,
      ordersPerCorp: { ...orderCounts },
      convoysLaunched: launch?.convoysLaunched ?? 0,
      convoysRaided: raid?.convoysRaided ?? 0,
      cargoValueShipped: launch?.cargoValueShipped ?? 0,
      cargoValueLost: raid?.cargoValueLost ?? 0,
      raidOutcomes: raid?.raidOutcomes ?? emptyRaidOutcomes(),
      routeTraffic: launch?.routeTraffic ?? {},
      taxLevied: Math.round(equity?.taxLevied ?? 0),
      acquisitions: equity?.acquisitions ?? 0,
      distress: equity?.distress ?? 0,
      freeOperators: this.corps.filter((c) => c.isFreeOperator).length,
    };
    this.metrics.snapshots.push(snapshot);
  }
}
