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
import { NPC_HOLDER_NAMES, constructionCpCost, type GameConfig } from "./config.js";
import { RESEARCH_TREE, SECRET_TECH_IDS, canResearch, researchMods, techById, type ResearchMods } from "./research.js";
import {
  EXTRACTOR_CAP,
  agriFoodMult,
  bestBodyFor,
  bodyTypeOfKey,
  buildingTotal,
  canBuildOnBody,
  canHostPopulation,
  coloniesOf,
  effectiveYields,
  factoryCostMult,
  getBodyBuildings,
  planetLabel,
  siteBodyKey,
  siteOutput,
  systemBuildings,
  systemHasHabitableBody,
  systemSeed,
} from "./bodies.js";
import { CHARTER_SPECS } from "./charters.js";
import { Galaxy } from "./galaxy.js";
import { fleetHullMass, fleetSpeed, laneFuelFactor, planFleetMove, segmentDistance } from "./movement.js";
import { Market, quoteInstant, type ClearableOrder } from "./market.js";
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
  HULL_CLASS_NAMES,
  NPC_HOLDER_PREFIX,
  RESOURCES,
  emptyStockpile,
  emptyCorpResearch,
  isNpcHolderId,
  type NpcHolder,
  type Convoy,
  type Corporation,
  type MegastructureKind,
  type Order,
  type PopulationStage,
  type CharterType,
  type ClientMovement,
  type QueueBuildingKind,
  type QueueItem,
  type Resource,
  type Ship,
  type System,
  type ValuationComponent,
  type War,
} from "./types.js";
import type { Bot, BotFactory, PlayerView } from "./bots/bot.js";
import { HybridBot } from "./bots/hybrid.js";
import type { LedgerCause, LedgerEntry, TurnEvent, TurnReport } from "./report.js";
import { computeOutcome, type GameOutcome } from "./standings.js";

export interface EngineOptions {
  /** Optional per-turn text logger for `--verbose` single-game runs. */
  log?: (line: string) => void;
}

/** Human-readable name for a queued build (Section 24, Phase 4a). */
function queueLabel(item: QueueItem): string {
  switch (item.kind) {
    case "factory": return `${item.recipeId ?? "factory"} processor`;
    case "reactor": return "Reactor";
    case "agridome": return "Hydroponics module";
    case "mining": return "mining upgrade";
    case "habitat": return "habitat upgrade";
    case "power": return "power upgrade";
    case "lab": return "Research lab";
    case "extractor": return `${item.resource ?? "deposit"} extractor`;
  }
}

/** Display names for megastructures (Section 22). */
const MEGASTRUCTURE_LABEL: Record<MegastructureKind, string> = {
  orbitalStation: "Orbital Station",
  spaceElevator: "Space Elevator",
  ringworld: "Ringworld",
};

/**
 * Deterministic 0..1 evidence roll for deniable privateer raids (review Section 11). A pure
 * FNV-style hash of (seed, turn, convoyId) — deliberately NOT the seeded Rng, so the intel
 * layer never consumes from the resolution stream (event payloads must not perturb replay).
 */
function evidenceHash(seed: number, turn: number, convoyId: string): number {
  let h = (2166136261 ^ seed) >>> 0;
  h = Math.imul(h ^ turn, 16777619) >>> 0;
  for (let i = 0; i < convoyId.length; i++) h = Math.imul(h ^ convoyId.charCodeAt(i), 16777619) >>> 0;
  return (h >>> 8) / 0x1000000;
}

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
  /** Active wars (Section 23). */
  private wars: War[] = [];
  private readonly claimedTurn = new Map<string, number>();
  private turn = 0;
  private readonly log: (line: string) => void;

  /** Observations collected during the current turn for the interactive TurnReport. */
  private events: TurnEvent[] = [];
  /** Credits as of the last report — earnings baseline that charges planning-window instant
   *  actions to the turn they precede (set at end of stepTurn). */
  private planningCreditsBase: Map<string, number> | null = null;
  /** Every credit movement this turn, with cause (design rule #1: no invisible hands). */
  private ledgerLines: LedgerEntry[] = [];
  /** Convoy/fleet legs traversed during the most recent turn, for the map's movement replay. */
  private movements: ClientMovement[] = [];
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
      // Cap table (Section 17): every charter is publicly traded by law. The seeded
      // institutional blocks hold the float; what they don't cover is the founder's
      // management block. Names are seeded so each game's cast differs (rule #13).
      const npcHolders: NpcHolder[] = config.tuning.equity.npcBlocks.map((block, slot) => {
        const pool = NPC_HOLDER_NAMES[slot] ?? NPC_HOLDER_NAMES[NPC_HOLDER_NAMES.length - 1]!;
        return {
          id: `${NPC_HOLDER_PREFIX}${id}:${slot}`,
          name: pool[Math.floor(this.rng.next() * pool.length)]!,
          askPremium: block.askPremium,
          bidDiscount: block.bidDiscount,
          absorbPerTurn: block.absorbPerTurn,
        };
      });
      const npcShares = config.tuning.equity.npcBlocks.reduce((s, b) => s + b.shares, 0);
      const managementShares = Math.max(0, config.tuning.sharesOutstanding - npcShares);
      const shareRegister: Record<string, number> = { [id]: managementShares };
      config.tuning.equity.npcBlocks.forEach((block, slot) => {
        shareRegister[npcHolders[slot]!.id] = block.shares;
      });
      const corp: Corporation = {
        id,
        name: `Corp ${i + 1}`,
        credits: config.tuning.startingCredits,
        debt: 0,
        hubStockpile: emptyStockpile(),
        warehouseLevel: 0,
        ownedSystemIds: [],
        ships: [{ rangeTier: 1, combat: 0, raider: false, surveyor: true, stationedAt: "" }],
        privateers: [],
        surveyedSystemIds: [],
        research: emptyCorpResearch(),
        rangeTier: 1,
        valuation: 0,
        sharePrice: 0,
        sharesOutstanding: config.tuning.sharesOutstanding,
        shareRegister,
        npcHolders,
        sentiment: 1,
        founderId: id,
        recentEarnings: [],
        isFreeOperator: false,
        botId,
        hasCharter: false,
        alliancePledges: [],
        grudges: {},
      };
      this.corps.push(corp);
      this.bots.set(corp.id, factory());
    }

    // Value the corps immediately (cash + starting ship): share prices must be real
    // from turn 0, or the equity ticket quotes a ladder of zeros before the first
    // resolution. Pure arithmetic — consumes no Rng, so replay is unaffected.
    this.updateValuations();

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
      disruptorsBuilt: 0,
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
    // Then bias starts toward the Wormhole Hub: rank by charted Range-1 distance (hops, then
    // transit time) and seat charters on the nearest systems. The hub is a sparse junction now,
    // so not everyone can be hub-adjacent — but everyone starts as close as the map allows, with a
    // short, defensible supply line to the Exchange. (A rival never severs that line: warp paths
    // ignore ownership, so convoys still transit rival systems — a rival can only pressure the lane
    // via interdiction/raids, not block it.) A stable sort keeps the shuffle's order within each
    // equidistant band, so which near-hub systems are used still varies per seed.
    const hubId = this.galaxy.hubId;
    const hopsToHub = (id: string): number => {
      const path = this.galaxy.shortestWarpPath(hubId, id, 1);
      return path ? path.routes.length * 1000 + path.transitTime : Number.MAX_SAFE_INTEGER;
    };
    const rank = new Map(pool.map((s) => [s.id, hopsToHub(s.id)]));
    pool.sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
    this.corps.forEach((corp, idx) => {
      const sys = pool[idx];
      if (!sys) return;
      sys.owner = corp.id;
      corp.ownedSystemIds.push(sys.id);
      corp.hasCharter = true;
      // Base the corp's starting survey skiff at its home system so it can be dispatched on a
      // sensor mission from turn 1 (an unstationed ship has nowhere to launch from — Section 25).
      for (const ship of corp.ships) {
        if (!ship.stationedAt && !ship.transit) ship.stationedAt = sys.id;
      }
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
    const hasFood = sys.sites.some((s) => s.resource === "food");
    if (sys.bodies && sys.bodies.planets.length > 0) {
      // Establish the habitat dome on ONE real planet (Section 24, Phase 4b: a single population
      // seed, not a separate synthetic body), so the home system has exactly one starting colony.
      const idx = sys.bodies.planets.findIndex((pl) => pl.type === "ocean");
      const pIdx = idx >= 0 ? idx : 0;
      const p = sys.bodies.planets[pIdx]!;
      p.habitable = true;
      if (!hasFood) {
        sys.sites.push({
          key: `planet:${pIdx}:food`, bodyKind: "planet", bodyType: p.type, bodyLabel: planetLabel(p.type),
          orbit: p.orbit, habitable: true, resource: "food", richness: 6, reservesRemaining: null,
          accessibility: 1, extractorLevel: 1, prospected: true, disabledUntil: 0,
        });
      }
    } else if (!hasFood) {
      // Legacy/bodyless systems: fall back to a synthetic habitat-dome colony.
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
      // Same per-turn buffer lifecycle as stepTurn (which resets AFTER building each report so
      // planning-window instant actions accumulate into the next turn) — headless games have no
      // planning window, so reset right away or ledger-derived metrics compound across turns.
      this.events = [];
      this.ledgerLines = [];
      this.planningCreditsBase = new Map(this.corps.map((c) => [c.id, c.credits]));
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

  /**
   * Live victory standings + final outcome (Section 29). Read-only over current state, so it
   * adds no resolution logic and is safe to call any turn. Note `outcome.over` can be true before
   * `isOver` (a decisive monopoly ends the game early); consumers that gate on the turn limit
   * should check `outcome.over`, not just `isOver`.
   */
  get outcome(): GameOutcome {
    return computeOutcome(this.corps, this.galaxy, this.config.tuning, this.turn, this.config.turns);
  }

  /** Convoy/fleet legs traversed during the most recent resolved turn (for the map replay). */
  get lastMovements(): ClientMovement[] {
    return this.movements;
  }

  /** The current turn number (0 before the first turn, then 1..N as turns resolve). */
  get currentTurn(): number {
    return this.turn;
  }

  /** Convoys currently live on the map. */
  get activeConvoys(): readonly Convoy[] {
    return this.convoys;
  }

  /** Wars currently active (Section 23). */
  get activeWars(): readonly War[] {
    return this.wars;
  }

  /**
   * Resources currently listed on the Exchange (review Section 13: commodity staging). A good
   * lists once ANY charter fields its gate tier — deterministic and public, so the market's
   * vocabulary grows with the frontier. Unlisted goods can't be bought or sold on the Exchange
   * (production, stockpiles, and administrative procurement are unaffected).
   */
  listedResources(): Resource[] {
    const maxTier = this.corps.reduce((m, c) => (c.rangeTier > m ? c.rangeTier : m), 1 as number);
    return RESOURCES.filter((r) => this.config.tuning.resourceTierGate[r] <= maxTier);
  }

  /** Tech ids locked behind feature gates (review Section 13: deferred from v1). */
  private gatedTechs(): Set<string> {
    const f = this.config.tuning.features;
    const out = new Set<string>();
    if (!f.terraforming) out.add("col-terraform");
    if (!f.espionage) out.add("acq-espionage");
    return out;
  }

  /**
   * The Exchange tariff `corpId` pays (Section 23 + review Risk 5): the war-aggressor tariff
   * while at war, otherwise the hegemon tariff once valuation runs past a multiple of the
   * median — the runaway leader's trades fund everyone else's catch-up.
   */
  warTariffFor(corpId: string): number {
    if (this.isAggressorAtWar(corpId)) return this.config.tuning.war.aggressorTariff;
    const h = this.config.tuning.hegemon;
    const corp = this.corps.find((c) => c.id === corpId);
    if (!corp || h.tariff <= 0) return 0;
    const vals = this.corps.map((c) => c.valuation).sort((a, b) => a - b);
    const median = vals.length % 2 ? vals[(vals.length - 1) / 2]! : (vals[vals.length / 2 - 1]! + vals[vals.length / 2]!) / 2;
    return median > 0 && corp.valuation > median * h.valuationMultiple ? h.tariff : 0;
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
    const report = this.buildReport("normal");
    // Buffers reset AFTER the report so planning-window instant actions (instantBuy) recorded
    // between turns accumulate into the NEXT turn's events + ledger (ledger invariant holds:
    // their credit deltas land in the same turn their lines are reported).
    this.events = [];
    this.ledgerLines = [];
    this.planningCreditsBase = new Map(this.corps.map((c) => [c.id, c.credits]));
    return report;
  }

  // ----- Instant Exchange actions (ruleset v10) -----
  //
  // THE RULE: trades execute instantly at the Exchange when the goods are at the hub — the
  // Exchange supplies buys; sells need YOUR stock in the hub warehouse. Instant trades pay a
  // spread around the posted price and walk it along the clearing's own elasticity curve as
  // they fill (large orders pay their own slippage), so timing the market costs real money.
  // Physical movement is always convoys. The worker logs these calls and replays them in
  // submission order between turns, keeping the event-sourced game deterministic. Each
  // method returns null on success or a human-readable rejection (a no-op during replay).

  /** Total capacity of a corp's Exchange warehouse (units across all resources). */
  warehouseCapacity(corp: Corporation): number {
    const w = this.config.tuning.warehouse;
    return w.baseCapacity + w.capacityPerLevel * corp.warehouseLevel;
  }

  /** Units currently stored in a corp's Exchange warehouse. */
  warehouseUsed(corp: Corporation): number {
    return RESOURCES.reduce((s, r) => s + corp.hubStockpile[r], 0);
  }

  /** Instant BUY: into the warehouse when `destSystemId` is the hub (no convoy, no shipping),
   *  otherwise a freighter departs at once and flies during the coming resolution. */
  instantBuy(corpId: string, resource: Resource, quantity: number, destSystemId: string): string | null {
    if (this.isOver) return "the match is over";
    const corp = this.corps.find((c) => c.id === corpId);
    if (!corp) return "unknown corporation";
    const qty = Math.floor(quantity);
    if (!Number.isFinite(qty) || qty <= 0 || qty > 1_000_000) return "invalid quantity";
    if (!this.listedResources().includes(resource)) return `${resource} is not listed on the Exchange yet`;
    const t = this.config.tuning;
    const marketEdge = this.mods(corp).marketEdge; // Market Algorithms (Section 28): better fills
    const quote = quoteInstant(t, this.market.prices[resource], resource, "buy", qty);

    if (destSystemId === this.galaxy.hubId) {
      const free = this.warehouseCapacity(corp) - this.warehouseUsed(corp);
      if (qty > free) return `warehouse full — ${Math.max(0, Math.floor(free))} units free (upgrade it for more)`;
      const cost = quote.total * (1 - marketEdge) * (1 + this.warTariffFor(corp.id));
      if (corp.credits < cost) return `costs ${Math.ceil(cost)} Cr — only ${Math.floor(corp.credits)} Cr on hand`;
      this.market.prices[resource] = quote.newPrice;
      this.credit(corp, -cost, "marketBuy", `${qty} ${resource} @ ~${quote.avgPrice.toFixed(1)} → warehouse (instant)`);
      corp.hubStockpile[resource] += qty;
      this.events.push({ type: "fill", corpId: corp.id, side: "buy", resource, quantity: qty, price: quote.avgPrice, systemId: this.galaxy.hubId });
      this.log(`  ${corp.name} instant-buys ${qty} ${resource} into the hub warehouse`);
      return null;
    }

    const dest = this.galaxy.systems.get(destSystemId);
    if (!dest) return "unknown destination system";
    const path = this.galaxy.shortestWarpPath(this.galaxy.hubId, destSystemId, corp.rangeTier);
    if (!path) return "no charted path from the Hub at your range";
    const hops = path.routes.length;
    const shipMult = this.shippingMultiplier(path.systems, corp.id);
    const cost = (quote.total * (1 - marketEdge) + t.shippingFeePerHop * hops * shipMult * qty) * (1 + this.warTariffFor(corp.id));
    if (corp.credits < cost) return `costs ${Math.ceil(cost)} Cr — only ${Math.floor(corp.credits)} Cr on hand`;
    this.market.prices[resource] = quote.newPrice;
    this.credit(corp, -cost, "marketBuy", `${qty} ${resource} @ ~${quote.avgPrice.toFixed(1)} + shipping (instant)`, destSystemId);
    this.events.push({ type: "fill", corpId: corp.id, side: "buy", resource, quantity: qty, price: quote.avgPrice, systemId: destSystemId });
    this.convoys.push(
      this.makeConvoy(corp.id, "buy", resource, qty, path.systems, path.routes, 0, 0, qty * t.basePrices[resource]),
    );
    for (const rid of path.routes) this.galaxy.recordTraffic(rid, this.turn + 1); // it flies next resolution
    this.log(`  ${corp.name} instant-buys ${qty} ${resource} → ${dest.name}`);
    return null;
  }

  /** Instant SELL from the hub warehouse — the rule's sell side: goods already AT the
   *  Exchange trade instantly, at the walked-down price minus the spread. */
  instantSell(corpId: string, resource: Resource, quantity: number): string | null {
    if (this.isOver) return "the match is over";
    const corp = this.corps.find((c) => c.id === corpId);
    if (!corp) return "unknown corporation";
    const qty = Math.floor(quantity);
    if (!Number.isFinite(qty) || qty <= 0) return "invalid quantity";
    if (!this.listedResources().includes(resource)) return `${resource} is not listed on the Exchange yet`;
    const have = Math.floor(corp.hubStockpile[resource]);
    if (have < qty) return have <= 0 ? `no ${resource} in your hub warehouse — ship some there first` : `only ${have} ${resource} in your hub warehouse`;
    const quote = quoteInstant(this.config.tuning, this.market.prices[resource], resource, "sell", qty);
    const proceeds = quote.total * (1 + this.mods(corp).marketEdge) * (1 - this.warTariffFor(corp.id));
    this.market.prices[resource] = quote.newPrice;
    corp.hubStockpile[resource] -= qty;
    this.credit(corp, proceeds, "convoyPayout", `${qty} ${resource} sold from warehouse @ ~${quote.avgPrice.toFixed(1)} (instant)`);
    this.events.push({ type: "fill", corpId: corp.id, side: "sell", resource, quantity: qty, price: quote.avgPrice, systemId: this.galaxy.hubId });
    this.log(`  ${corp.name} instant-sells ${qty} ${resource} from the hub warehouse`);
    return null;
  }

  /** Instant DISPATCH: ship warehouse goods home — the freighter departs at once and flies
   *  during the coming resolution (normal transit, normal raid exposure). */
  instantDispatch(corpId: string, resource: Resource, quantity: number, destSystemId: string): string | null {
    if (this.isOver) return "the match is over";
    const corp = this.corps.find((c) => c.id === corpId);
    if (!corp) return "unknown corporation";
    const qty = Math.floor(quantity);
    if (!Number.isFinite(qty) || qty <= 0) return "invalid quantity";
    const have = Math.floor(corp.hubStockpile[resource]);
    if (have < qty) return have <= 0 ? `no ${resource} in your hub warehouse` : `only ${have} ${resource} in your hub warehouse`;
    const dest = this.galaxy.systems.get(destSystemId);
    if (!dest || dest.owner !== corp.id) return "destination must be one of your systems";
    const path = this.galaxy.shortestWarpPath(this.galaxy.hubId, destSystemId, corp.rangeTier);
    if (!path) return "no charted path from the Hub at your range";
    corp.hubStockpile[resource] -= qty;
    this.convoys.push(
      this.makeConvoy(corp.id, "transfer", resource, qty, path.systems, path.routes, 0, 0, qty * this.config.tuning.basePrices[resource]),
    );
    for (const rid of path.routes) this.galaxy.recordTraffic(rid, this.turn + 1);
    this.log(`  ${corp.name} dispatches ${qty} ${resource} from the warehouse → ${dest.name}`);
    return null;
  }

  private buildReport(phase: "auction" | "normal" = "normal"): TurnReport {
    return {
      turn: this.turn,
      phase,
      events: this.events.slice(),
      ledger: this.ledgerLines.slice(),
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
    // events/ledgerLines deliberately NOT cleared here: planning-window instant actions have
    // already written into them and belong to this turn's report (cleared at end of stepTurn).
    this.movements = [];
    // Earnings baseline: credits as of the LAST report, so instant spends made during the
    // planning window count against this turn's earnings delta.
    const creditsBefore = this.planningCreditsBase ?? new Map(this.corps.map((c) => [c.id, c.credits]));

    // 0. End wars whose ceasefire has arrived (lifts the aggressor's trade tariff); fade grudges.
    this.expireWars();
    for (const c of this.corps) {
      for (const k of Object.keys(c.grudges)) {
        c.grudges[k]! *= 0.85;
        if (c.grudges[k]! < 0.5) delete c.grudges[k];
      }
    }

    // 1. Lock: collect orders from every bot.
    const ordersByCorp = new Map<string, Order[]>();
    const orderCounts: Record<string, number> = {};
    for (const corp of this.corps) {
      const bot = this.bots.get(corp.id)!;
      const orders = bot.decide(this.viewFor(corp));
      ordersByCorp.set(corp.id, orders);
      orderCounts[corp.id] = orders.length;
    }

    // 1.4 Construction: advance each colony's build queue (Section 24, Phase 4a) BEFORE new orders
    // are queued, so a build only progresses on the turns after it was ordered (no same-turn chain).
    this.advanceConstruction();

    // 1.5 Administrative builds (claims, surveys, ships, research, depots, finance).
    this.resolveAdministrative(ordersByCorp);

    // 2. Production into local stockpiles (scaled by unrest; hydroponics add food).
    this.resolveProduction();

    // 3. Market clearing + 4. convoy launch.
    const launchInfo = this.resolveMarketAndLaunch(ordersByCorp);

    // 5. Route interdiction (predictive) + 6. targeted raids.
    const raidStats = this.resolveRaids(ordersByCorp);

    // 6.6 Fleet movement (Section 23): advance travelling fleets; arrivals at hostile systems fight.
    this.resolveFleetMovement();

    // 6.7 Invasions & conquest (Section 23): capture adjacent rival systems (the static-force path).
    this.resolveInvasions(ordersByCorp);

    // 7. Arrivals & settlements.
    this.resolveArrivals();

    // 8. Upkeep, population/food, tax, debt.
    const popStats = this.resolvePopulationAndUpkeep();
    this.lastTaxLevied = popStats.taxLevied;

    // 8.5 Research: generate points (labs + population) and advance each charter's tech queue (Section 28).
    this.resolveResearch();

    // 9. Valuation + share prices, then market sentiment (Section 17: sentiment scales
    // trade execution only, so it must be fresh before the equity batch resolves).
    this.updateValuations();
    this.updateSentiment();

    // 9.5 Equity: share purchases, acquisitions, distress liquidation (Sections 17–18).
    const equityStats = this.resolveEquity(ordersByCorp);
    equityStats.taxLevied = popStats.taxLevied;

    // Record per-turn earnings for valuation momentum. Share trades are capital flows,
    // not operating income: without netting them out, a defensive buyback reads as an
    // earnings crash (amplified by the momentum weight) that cheapens the very shares
    // being defended, and a block sale reads as a windfall quarter.
    const equityFlows = new Map<string, number>();
    for (const line of this.ledgerLines) {
      if (line.cause === "shareTrade") {
        equityFlows.set(line.corpId, (equityFlows.get(line.corpId) ?? 0) + line.delta);
      }
    }
    for (const corp of this.corps) {
      const delta =
        corp.credits - (creditsBefore.get(corp.id) ?? corp.credits) - (equityFlows.get(corp.id) ?? 0);
      corp.recentEarnings.push(delta);
      if (corp.recentEarnings.length > 3) corp.recentEarnings.shift();
    }

    // 10. Report.
    this.recordSnapshot(this.turn, orderCounts, launchInfo, raidStats, equityStats);
  }

  /** Construction-point cost of one queued building kind (Section 24, Phase 4a). */
  private constructionCost(kind: QueueBuildingKind, recipeId?: string): number {
    const tier = kind === "factory" && recipeId
      ? this.config.tuning.recipes.find((r) => r.id === recipeId)?.tier ?? 1
      : 1;
    return constructionCpCost(this.config.tuning, kind, tier);
  }

  /** Land a finished queue item into its colony's buildings (Section 24, Phase 4a). */
  private completeBuild(sys: System, item: QueueItem): void {
    const bb = getBodyBuildings(sys, item.bodyKey);
    switch (item.kind) {
      case "factory": if (item.recipeId) bb.processors[item.recipeId] = (bb.processors[item.recipeId] ?? 0) + 1; break;
      case "reactor": bb.reactors += 1; break;
      case "agridome": bb.hydroponics += 1; break;
      case "mining": bb.miningRigs += 1; break;
      case "habitat": bb.habitats += 1; break;
      case "power": bb.powerGrid += 1; break;
      case "lab": bb.labs += 1; break;
      case "extractor": {
        // A waiting extractor (Section 21) finally paid its bill — work the deposit now.
        const site = sys.sites.find((s) => s.key === item.siteKey);
        if (site && site.extractorLevel < EXTRACTOR_CAP) {
          site.extractorLevel += 1;
          site.prospected = true; // working a deposit reveals its true richness
        }
        break;
      }
    }
  }

  /**
   * Pour each SYSTEM's per-turn construction points into its single build queue (review
   * Section 10: one queue per system). Unpaid items first retry their bill (front of the queue
   * gets first claim on materials); construction points then flow into PAID items in queue
   * order — an unpaid item waiting on materials never stalls a funded build behind it.
   * Finished items land on the body recorded at enqueue (`item.bodyKey`); leftover points
   * roll forward, so a system with spare capacity chains short builds.
   */
  private advanceConstruction(): void {
    const baseRate = this.config.tuning.construction.pointsPerTurn;
    if (baseRate <= 0) return;
    for (const sys of this.galaxy.allSystems()) {
      if (sys.queue.length === 0) continue;
      // Modular Construction (Section 28) speeds the owning charter's build queue.
      const owner = this.corps.find((c) => c.id === sys.owner);
      if (owner) {
        for (const item of sys.queue) {
          if (!item.paid && this.tryPayBuild(sys, owner, item)) {
            this.log(`  ${owner.name} starts ${queueLabel(item)} at ${sys.name} — materials now on hand`);
          }
        }
      }
      // Zero-CP items (waiting extractors) complete the moment they're paid — they consume no
      // construction points and never compete with the buildings behind them.
      for (const item of [...sys.queue]) {
        if (item.paid && item.cpDone >= item.cpCost) {
          sys.queue.splice(sys.queue.indexOf(item), 1);
          this.completeBuild(sys, item);
          this.events.push({ type: "build", corpId: sys.owner ?? "", what: queueLabel(item), systemId: sys.id });
        }
      }
      let points = baseRate * (owner ? this.mods(owner).constructionRateMult : 1);
      while (points > 0) {
        const item = sys.queue.find((q) => q.paid);
        if (!item) break;
        const need = item.cpCost - item.cpDone;
        if (points >= need) {
          points -= need;
          sys.queue.splice(sys.queue.indexOf(item), 1);
          this.completeBuild(sys, item);
          this.events.push({ type: "build", corpId: sys.owner ?? "", what: queueLabel(item), systemId: sys.id });
        } else {
          item.cpDone += points;
          points = 0;
        }
      }
    }
  }

  /**
   * Append a build to the system's queue, paying its bill now if affordable (Section 24,
   * Phase 4a). An unaffordable build is NOT dropped: it waits in the queue unpaid and the
   * engine retries each turn (`advanceConstruction`) until the materials arrive or the player
   * cancels it. Returns null — order rejected — only when the body already has a queued item
   * (one structure per body).
   */
  private enqueueBuild(
    sys: System,
    corp: Corporation,
    bodyKey: string,
    kind: QueueBuildingKind,
    creditCost: number,
    mats: Partial<Record<Resource, number>>,
    recipeId?: string,
  ): QueueItem | null {
    // One queued BUILDING per body; waiting extractors are per-deposit and don't take the slot.
    if (sys.queue.some((q) => q.kind !== "extractor" && q.bodyKey === bodyKey)) return null;
    const item: QueueItem = {
      kind, recipeId, bodyKey,
      cpCost: this.constructionCost(kind, recipeId), cpDone: 0,
      paid: false, creditCost, mats,
    };
    this.tryPayBuild(sys, corp, item);
    sys.queue.push(item);
    return item;
  }

  /** Charge a queued item's bill if the corp can cover it: credits out, materials consumed from
   *  the corp's stockpiles (Section 27 — no auto-buy). True once the item is paid. */
  private tryPayBuild(sys: System, corp: Corporation, item: QueueItem): boolean {
    if (item.paid) return true;
    if (corp.credits < item.creditCost || !this.hasResources(corp, item.mats)) return false;
    this.consumeResources(corp, item.mats);
    this.credit(corp, -item.creditCost, "build", queueLabel(item), sys.id);
    item.paid = true;
    return true;
  }

  /** Count of a building kind already built (system-wide) + still queued, for cap checks. */
  private builtPlusQueued(sys: System, kind: QueueBuildingKind, recipeId?: string): number {
    const b = systemBuildings(sys);
    const built =
      kind === "factory" ? (recipeId ? b.processors[recipeId] ?? 0 : 0)
      : kind === "reactor" ? b.reactors
      : kind === "agridome" ? b.hydroponics
      : kind === "mining" ? b.miningRigs
      : kind === "habitat" ? b.habitats
      : kind === "lab" ? b.labs
      : b.powerGrid;
    const queued = sys.queue.filter((q) => q.kind === kind && (kind !== "factory" || q.recipeId === recipeId)).length;
    return built + queued;
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
            this.credit(corp, -order.amount, "claim", `Claimed ${sys.name}`, sys.id);
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
            // Lane Stabilization research (Section 28) discounts charting.
            const surveyCost = Math.round(this.config.tuning.surveyCost * this.mods(corp).surveyCostMult);
            if (corp.credits < surveyCost) break;
            this.credit(corp, -surveyCost, "build", "Charted warp lane");
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
            // Capital Shipyards research (Section 28) discounts capital hulls (Range 5+).
            const hullMult = order.rangeTier >= 5 ? this.mods(corp).capitalHullCostMult : 1;
            const cost =
              (t.shipCost[order.rangeTier] + (order.raider ? t.raiderShipExtraCost : 0)) * hullMult;
            // Higher-tier hulls require strategic resources — rare isotopes (Range 2+) and
            // antimatter (capital Range 4+ hulls) — drawn from the corp's own stockpiles
            // first, with any shortfall bought from the exchange. Controlling the frontier
            // makes advanced fleets cheaper; everyone else pays market price.
            // Hulls also need manufactured alloys + components (Section 07b), drawn from the
            // corp's stockpiles first with any shortfall bought from the exchange.
            const hullMats: Partial<Record<Resource, number>> = {
              rareIsotopes: t.shipIsotopeCost[order.rangeTier],
              antimatter: t.shipAntimatterCost[order.rangeTier],
              alloys: t.shipAlloyCost[order.rangeTier],
              components: t.shipComponentCost[order.rangeTier],
            };
            if (corp.credits < cost || !this.hasResources(corp, hullMats)) break; // materials must be on hand
            this.consumeResources(corp, hullMats);
            const hullClass = HULL_CLASS_NAMES[order.rangeTier];
            this.credit(corp, -cost, "build", `${hullClass} ${order.raider ? "raider" : "escort"} hull`, sys.id);
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
              what: `${hullClass} ${order.raider ? "raider" : "escort"}`,
              systemId: sys.id,
            });
            this.log(
              `  ${corp.name} builds a ${hullClass} ${order.raider ? "raider" : "escort"} (Range ${order.rangeTier}) at ${sys.name}`,
            );
            break;
          }
          case "terraform": {
            // Terraforming (Section 28, Phase 2): make a non-habitable owned world habitable so it can
            // grow a population. Requires the Terraforming tech; costs credits + materials.
            if (!this.config.tuning.features.terraforming) break; // deferred from v1 (review Section 13)
            if (corp.isFreeOperator) break;
            if (!this.mods(corp).canTerraform) break;
            const sys = this.galaxy.systems.get(order.systemId);
            if (!sys || sys.owner !== corp.id || !sys.bodies) break;
            const m = order.bodyKey.match(/^planet:(\d+)$/);
            const planet = m ? sys.bodies.planets[Number(m[1])] : undefined;
            if (!planet || planet.habitable) break;
            const t = this.config.tuning;
            const mats = this.scaleMats(corp, t.buildResources.agridome);
            if (corp.credits < t.terraformCost || !this.hasResources(corp, mats)) break;
            this.consumeResources(corp, mats);
            this.credit(corp, -t.terraformCost, "build", `Terraformed ${planet.type} world`, sys.id);
            planet.habitable = true;
            // Reflect it on the world's worked sites so the colony reads as habitable.
            for (const site of sys.sites) if (siteBodyKey(site) === order.bodyKey) site.habitable = true;
            this.events.push({ type: "build", corpId: corp.id, what: `Terraformed ${planet.type} world`, systemId: sys.id });
            this.log(`  ${corp.name} terraforms a ${planet.type} world at ${sys.name}`);
            break;
          }
          case "hirePrivateer": {
            if (corp.credits < this.config.tuning.privateerCost) break;
            this.credit(corp, -this.config.tuning.privateerCost, "build", "Hired privateer", order.basedAt);
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
            const depotMats: Partial<Record<Resource, number>> = { alloys: t.buildAlloyCost, components: t.depotComponentCost };
            if (corp.credits < t.depotCost || !this.hasResources(corp, depotMats)) break;
            this.consumeResources(corp, depotMats);
            this.credit(corp, -t.depotCost, "build", "Trade Depot", sys.id);
            sys.hasDepot = true;
            this.metrics.depotsBuilt += 1;
            this.events.push({ type: "build", corpId: corp.id, what: "Trade Depot", systemId: sys.id });
            this.log(`  ${corp.name} builds a Trade Depot at ${sys.name}`);
            break;
          }
          case "buildDisruptor": {
            // Warp Disruptors are colonial defense infrastructure (Section 04); not for Free Operators.
            if (corp.isFreeOperator) break;
            const t = this.config.tuning;
            const sys = this.galaxy.systems.get(order.systemId);
            if (!sys || sys.owner !== corp.id || sys.hasDisruptor) break;
            const mats: Partial<Record<Resource, number>> = { alloys: t.buildAlloyCost, components: t.disruptorComponentCost };
            if (corp.credits < t.disruptorCost || !this.hasResources(corp, mats)) break;
            this.consumeResources(corp, mats);
            this.credit(corp, -t.disruptorCost, "build", "Warp Disruptor", sys.id);
            sys.hasDisruptor = true;
            this.metrics.disruptorsBuilt += 1;
            this.events.push({ type: "build", corpId: corp.id, what: "Warp Disruptor", systemId: sys.id });
            this.log(`  ${corp.name} builds a Warp Disruptor at ${sys.name}`);
            break;
          }
          case "buildHydroponics": {
            if (corp.isFreeOperator) break;
            const sys = this.galaxy.systems.get(order.systemId);
            if (!sys || sys.owner !== corp.id) break;
            // Land on the best farmland by affinity unless the order names a body (Section 10).
            const bodyKey = order.bodyKey ?? bestBodyFor(sys, "agridome");
            // Agri-domes need a livable surface (Section 24) — not a gas giant, lava world, or belt.
            if (!bodyKey || !canBuildOnBody("agridome", bodyTypeOfKey(sys, bodyKey))) break;
            const domeMats = this.scaleMats(corp, this.config.tuning.buildResources.agridome); // silicates + metals (Section 27)
            const dome = this.enqueueBuild(sys, corp, bodyKey, "agridome", this.config.tuning.hydroponicsCost, domeMats);
            if (!dome) break; // body already has a queued build (one structure per body)
            this.log(`  ${corp.name} queues hydroponics at ${sys.name}${dome.paid ? "" : " (awaiting materials)"}`);
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
            const procKey = order.bodyKey ?? bestBodyFor(sys, "factory");
            if (!procKey) break;
            // Factory build cost depends on the host world's type (Section 24): metal-rich rocky/lava
            // worlds are cheap to tool up, oceans and orbital-over-giants cost a premium.
            const recipeCost = Math.round(recipe.buildCost * factoryCostMult(bodyTypeOfKey(sys, procKey)));
            const facMats = this.scaleMats(corp, t.buildResources.factory); // alloys + metals (Section 27)
            const proc = this.enqueueBuild(sys, corp, procKey, "factory", recipeCost, facMats, recipe.id);
            if (!proc) break; // body already has a queued build (one structure per body)
            this.log(`  ${corp.name} queues a ${recipe.id} processor at ${sys.name}${proc.paid ? "" : " (awaiting materials)"}`);
            break;
          }
          case "buildReactor": {
            // Reactors add power capacity and burn helium3 to run processors (Section 07b).
            if (corp.isFreeOperator) break;
            const t = this.config.tuning;
            const sys = this.galaxy.systems.get(order.systemId);
            if (!sys || sys.owner !== corp.id) break;
            const reactorMats = this.scaleMats(corp, t.buildResources.reactor); // alloys + silicates (Section 27)
            const reactorKey = order.bodyKey ?? bestBodyFor(sys, "reactor");
            if (!reactorKey) break;
            const reactor = this.enqueueBuild(sys, corp, reactorKey, "reactor", t.reactorCost, reactorMats);
            if (!reactor) break; // body already has a queued build (one structure per body)
            this.log(`  ${corp.name} queues a reactor at ${sys.name}${reactor.paid ? "" : " (awaiting materials)"}`);
            break;
          }
          case "upgradeInfrastructure": {
            // Raw-fed system upgrades (Section 07c): a scaling sink for metals/silicates/helium3.
            if (corp.isFreeOperator) break;
            const inf = this.config.tuning.infrastructure;
            const sys = this.galaxy.systems.get(order.systemId);
            if (!sys || sys.owner !== corp.id) break;
            // Habitats need a livable surface, mining rigs a solid one (Section 24).
            const upBuildKind = order.track === "mining" ? "mining" : order.track === "habitat" ? "habitat" : "power";
            const upKey = order.bodyKey ?? bestBodyFor(sys, upBuildKind);
            if (!upKey || !canBuildOnBody(upBuildKind, bodyTypeOfKey(sys, upKey))) break;
            const creditBase = order.track === "mining" ? inf.miningCreditCost : order.track === "habitat" ? inf.habitatCreditCost : inf.powerCreditCost;
            const rawRes: Resource = order.track === "mining" ? "metals" : order.track === "habitat" ? "silicates" : "helium3";
            const rawBase = order.track === "mining" ? inf.miningMetalsCost : order.track === "habitat" ? inf.habitatSilicatesCost : inf.powerHelium3Cost;
            // The level this upgrade *reaches* counts what's built AND already queued (Phase 4a), so
            // queuing two upgrades charges L1 then L2 and never overshoots the cap.
            const level = this.builtPlusQueued(sys, upBuildKind);
            if (level >= inf.cap) break;
            const factor = level + 1; // cost scales with the level being reached
            const creditCost = creditBase * factor;
            const rawNeed = rawBase * factor;
            const up = this.enqueueBuild(sys, corp, upKey, upBuildKind, creditCost, { [rawRes]: rawNeed });
            if (!up) break; // body already has a queued build (one structure per body)
            this.log(`  ${corp.name} queues ${order.track} upgrade at ${sys.name} to L${level + 1}${up.paid ? "" : " (awaiting materials)"}`);
            break;
          }
          case "buildPlatform": {
            if (corp.isFreeOperator) break;
            const t = this.config.tuning;
            const sys = this.galaxy.systems.get(order.systemId);
            if (!sys || sys.owner !== corp.id) break;
            if (sys.platforms >= t.platformCap) break;
            if (corp.credits < t.platformCost || !this.hasStrategic(corp, "alloys", t.buildAlloyCost)) break;
            this.consumeStrategic(corp, "alloys", t.buildAlloyCost);
            this.credit(corp, -t.platformCost, "build", "Defense platform", sys.id);
            sys.platforms += 1;
            this.metrics.platformsBuilt += 1;
            this.events.push({ type: "build", corpId: corp.id, what: "Defense platform", systemId: sys.id });
            this.log(`  ${corp.name} builds a defense platform at ${sys.name}`);
            break;
          }
          case "buildLab": {
            // A Research Lab (Section 28): produces research points each turn once built.
            if (corp.isFreeOperator) break;
            const t = this.config.tuning;
            const sys = this.galaxy.systems.get(order.systemId);
            if (!sys || sys.owner !== corp.id) break;
            const labKey = order.bodyKey ?? bestBodyFor(sys, "lab");
            if (!labKey || !canBuildOnBody("lab", bodyTypeOfKey(sys, labKey))) break;
            const labMats = this.scaleMats(corp, t.buildResources.lab);
            const lab = this.enqueueBuild(sys, corp, labKey, "lab", t.labCost, labMats);
            if (!lab) break; // body already has a queued build (one structure per body)
            this.log(`  ${corp.name} queues a research lab at ${sys.name}${lab.paid ? "" : " (awaiting materials)"}`);
            break;
          }
          case "upgradeWarehouse": {
            // More hub storage for instant trading (ruleset v10) — the anti-hoarding lever:
            // capacity is scarce until paid for. Cost scales with the level being reached.
            const w = this.config.tuning.warehouse;
            if (corp.warehouseLevel >= w.levelCap) break;
            const lvl = corp.warehouseLevel + 1;
            const cost = w.upgradeCreditCost * lvl;
            const mats: Partial<Record<Resource, number>> = { metals: w.upgradeMetalsCost * lvl };
            if (corp.credits < cost || !this.hasResources(corp, mats)) break;
            this.consumeResources(corp, mats);
            this.credit(corp, -cost, "build", `Exchange warehouse L${lvl}`);
            corp.warehouseLevel = lvl;
            this.events.push({ type: "build", corpId: corp.id, what: `Exchange warehouse L${lvl}` });
            this.log(`  ${corp.name} expands its Exchange warehouse to L${lvl}`);
            break;
          }
          case "cancelBuild": {
            // Pull a queued build: buildings by bodyKey (one per body), waiting extractors by
            // siteKey (one per deposit). A paid item refunds its full bill — credits to the
            // corp, materials into THIS system's stockpile (they were drawn corp-wide; landing
            // them here keeps it simple and they're spendable again next turn). Construction
            // progress is forfeit.
            const sys = this.galaxy.systems.get(order.systemId);
            if (!sys || sys.owner !== corp.id) break;
            const idx = sys.queue.findIndex((q) =>
              order.siteKey ? q.kind === "extractor" && q.siteKey === order.siteKey : q.kind !== "extractor" && q.bodyKey === order.bodyKey,
            );
            if (idx < 0) break;
            const [item] = sys.queue.splice(idx, 1);
            if (item!.paid) {
              if (item!.creditCost > 0) this.credit(corp, item!.creditCost, "build", `Cancelled ${queueLabel(item!)} — refund`, sys.id);
              for (const [r, n] of Object.entries(item!.mats)) sys.stockpile[r as Resource] += n ?? 0;
            }
            this.log(`  ${corp.name} cancels the queued ${queueLabel(item!)} at ${sys.name}${item!.paid ? " (bill refunded)" : ""}`);
            break;
          }
          case "setResearch": {
            // Set the charter's research queue (Section 28): keep only valid, prereq-reachable techs,
            // de-duped, with completed ones dropped — the engine pours RP into queue[0] each turn.
            if (corp.isFreeOperator) break;
            const done = corp.research.completed;
            const seen = new Set<string>();
            const queue: string[] = [];
            // Validate in order, treating earlier queued techs as "will be completed" for prereq checks.
            const willHave = [...done];
            const gated = this.gatedTechs();
            for (const id of order.queue) {
              if (gated.has(id)) continue; // feature-gated tech (review Section 13)
              const tech = techById(id);
              if (!tech || seen.has(id) || done.includes(id)) continue;
              if (!tech.prereqs.every((p) => willHave.includes(p))) continue;
              // A galaxy-unique secret project a rival already finished can't be queued (Phase 3).
              if (tech.secret) { const o = this.secretOwner(id); if (o !== null && o !== corp.id) continue; }
              seen.add(id);
              queue.push(id);
              willHave.push(id);
            }
            corp.research.queue = queue;
            break;
          }
          case "buildSurveyShip": {
            // An unarmed scout (Section 25): cheap, no combat, used to survey systems.
            if (corp.isFreeOperator) break;
            const t = this.config.tuning;
            const sys = this.galaxy.systems.get(order.systemId);
            if (!sys || sys.owner !== corp.id) break;
            if (corp.credits < t.surveyShipCost) break;
            this.credit(corp, -t.surveyShipCost, "build", "Survey vessel");
            corp.ships.push({ rangeTier: corp.rangeTier, combat: 0, raider: false, surveyor: true, stationedAt: sys.id });
            this.events.push({ type: "build", corpId: corp.id, what: "Survey vessel", systemId: sys.id });
            this.log(`  ${corp.name} builds a survey vessel at ${sys.name}`);
            break;
          }
          case "surveySystem": {
            // Dispatch one idle survey vessel to scout `targetSystemId` (Section 25). It flies the
            // cheapest charted path, surveys the system on arrival, then returns home — always
            // peaceful (a scout never fights), so it can slip into rival territory for intel.
            const from = this.galaxy.systems.get(order.fromSystemId);
            const to = this.galaxy.systems.get(order.targetSystemId);
            if (!from || !to || from.id === to.id) break;
            const ship = corp.ships.find((s) => s.surveyor && !s.transit && s.stationedAt === from.id);
            if (!ship) break;
            const path = this.galaxy.shortestWarpPath(from.id, to.id, ship.rangeTier);
            if (!path || path.routes.length === 0) break; // no charted path within range
            const firstRoute = this.galaxy.routes.get(path.routes[0]!);
            ship.stationedAt = "";
            ship.transit = {
              path: path.systems,
              routeIds: path.routes,
              position: 0,
              segmentTurnsLeft: firstRoute ? firstRoute.transitTime : 1,
              launchedTurn: this.turn,
              attack: false,
              surveyReturnTo: from.id,
            };
            this.events.push({ type: "build", corpId: corp.id, what: `Survey en route to ${to.name}`, systemId: to.id });
            this.log(`  ${corp.name} dispatches a survey vessel from ${from.name} to scout ${to.name}`);
            break;
          }
          case "moveFleet": {
            // Send every idle combat ship at `fromSystemId` travelling to `toSystemId` (Section 23
            // — mobile fleets). Fleets are light, so they can jump off-lane directly to any system
            // in range; warp lanes are merely the fuel-efficient option. The planner picks the
            // faster of {cheapest charted lane, direct off-lane jump}. Passage is peaceful; arriving
            // at a non-allied rival's system gives battle.
            const from = this.galaxy.systems.get(order.fromSystemId);
            const to = this.galaxy.systems.get(order.toSystemId);
            if (!from || !to || from.id === to.id) break;
            const fleet = corp.ships.filter((s) => s.combat > 0 && !s.transit && s.stationedAt === from.id);
            if (fleet.length === 0) break;
            const minTier = fleet.reduce((a, s) => (s.rangeTier < a ? s.rangeTier : a), fleet[0]!.rangeTier);
            const speed = fleetSpeed(this.config.tuning, fleet); // a fleet travels at its slowest hull's speed
            const plan = planFleetMove(this.galaxy, this.config.tuning, from.id, to.id, minTier, speed);
            if (!plan) break; // no charted lane in range and the direct jump is beyond hull range
            const attack = to.owner !== null && to.owner !== corp.id && !this.areAllied(corp.id, to.owner);
            // Provision the jump up-front (Section 07b): mass × distance fuel, discounted on lanes;
            // drawn from stockpiles with any shortfall auto-bought at the exchange.
            this.chargeFuel(corp, fleetHullMass(this.config.tuning, fleet) * plan.fuelPerMass, "fuelMove", `fleet ${from.name} → ${to.name}${plan.offLane ? " (off-lane)" : ""}`);
            for (const ship of fleet) {
              ship.stationedAt = ""; // leaves home — no longer defends/escorts
              ship.transit = {
                path: plan.path,
                routeIds: plan.routeIds,
                position: 0,
                segmentTurnsLeft: plan.segmentTimes[0] ?? 1,
                segmentTimes: plan.segmentTimes,
                launchedTurn: this.turn,
                attack,
              };
            }
            this.events.push({ type: "build", corpId: corp.id, what: `Fleet to ${to.name}`, systemId: to.id });
            this.log(`  ${corp.name} sends a fleet from ${from.name} toward ${to.name}${attack ? " (assault)" : ""}${plan.offLane ? " [off-lane]" : ""}`);
            break;
          }
          case "redeployShip": {
            // Mobilise a warfleet (Section 23): move the strongest combat ship between two owned
            // systems to concentrate force for an invasion or reinforce a threatened defense.
            const from = this.galaxy.systems.get(order.fromSystemId);
            const to = this.galaxy.systems.get(order.toSystemId);
            if (!from || !to || from.id === to.id) break;
            if (from.owner !== corp.id || to.owner !== corp.id) break;
            let best: (typeof corp.ships)[number] | undefined;
            for (const s of corp.ships) {
              if (s.stationedAt === from.id && s.combat > 0 && (!best || s.combat > best.combat)) best = s;
            }
            if (!best) break;
            best.stationedAt = to.id;
            this.events.push({ type: "build", corpId: corp.id, what: "Redeployed warship", systemId: to.id });
            this.log(`  ${corp.name} redeploys a Range-${best.rangeTier} warship to ${to.name}`);
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
            // Advanced Metallurgy research (Section 28) discounts megastructure construction.
            const megaMult = this.mods(corp).megastructureCostMult;
            const megaMats: Partial<Record<Resource, number>> = { metals: spec.metalsCost, alloys: spec.alloyCost };
            if (corp.credits < spec.creditCost * megaMult || !this.hasResources(corp, megaMats)) break;
            this.consumeResources(corp, megaMats);
            this.credit(corp, -spec.creditCost * megaMult, "build", MEGASTRUCTURE_LABEL[order.structure], sys.id);
            sys.megastructures.push(order.structure);
            this.events.push({ type: "build", corpId: corp.id, what: MEGASTRUCTURE_LABEL[order.structure], systemId: sys.id });
            this.log(`  ${corp.name} completes a ${MEGASTRUCTURE_LABEL[order.structure]} at ${sys.name}`);
            break;
          }
          case "buildExtractor": {
            // Work (or deepen) a deposit on one of the system's bodies (Section 21). Instant when
            // the bill is on hand; otherwise it WAITS in the queue as a zero-CP item and comes
            // online the moment the materials arrive (or the player cancels it).
            if (corp.isFreeOperator) break;
            const t = this.config.tuning;
            const sys = this.galaxy.systems.get(order.systemId);
            if (!sys || sys.owner !== corp.id) break;
            const site = sys.sites.find((s) => s.key === order.siteKey);
            if (!site || site.extractorLevel >= EXTRACTOR_CAP) break;
            if (sys.queue.some((q) => q.kind === "extractor" && q.siteKey === site.key)) break; // one queued build per deposit
            // Cost climbs with the level reached and with how inaccessible the deposit is.
            const factor =
              (site.extractorLevel + 1) * (1 + (1 - site.accessibility) * t.extractor.accessibilityMult);
            const cost = Math.round(t.extractor.buildCost * factor);
            const item: QueueItem = {
              kind: "extractor", siteKey: site.key, resource: site.resource, bodyKey: siteBodyKey(site),
              cpCost: 0, cpDone: 0, paid: false, creditCost: cost, mats: { alloys: t.extractor.alloyCost },
            };
            if (this.tryPayBuild(sys, corp, item)) {
              site.extractorLevel += 1;
              site.prospected = true; // working a deposit reveals its true richness
              this.events.push({ type: "build", corpId: corp.id, what: `${site.resource} extractor`, systemId: sys.id });
              this.log(`  ${corp.name} builds a ${site.resource} extractor at ${sys.name} (L${site.extractorLevel})`);
            } else {
              sys.queue.push(item);
              this.log(`  ${corp.name} queues a ${site.resource} extractor at ${sys.name} (awaiting materials)`);
            }
            break;
          }
          case "alliancePledge": {
            // Pledge to defend another charter (Section 23). Allied once the pledge is mutual.
            const target = this.corps.find((c) => c.id === order.targetId);
            if (!target || target.id === corp.id) break;
            if (!corp.alliancePledges.includes(target.id)) corp.alliancePledges.push(target.id);
            // Emit an alliance event when this completes a mutual pledge.
            if (target.alliancePledges.includes(corp.id)) {
              this.events.push({ type: "alliance", aId: corp.id, bId: target.id });
              this.log(`  ${corp.name} and ${target.name} form a defensive alliance`);
            }
            break;
          }
          case "allianceBreak": {
            corp.alliancePledges = corp.alliancePledges.filter((id) => id !== order.targetId);
            break;
          }
          case "borrow": {
            // Debt is capped to a multiple of valuation (Section 17).
            const ceiling = Math.max(0, corp.valuation * this.config.tuning.maxDebtToValuation);
            const room = Math.max(0, ceiling - corp.debt);
            const amount = Math.min(order.amount, room);
            if (amount <= 0) break;
            this.credit(corp, amount, "borrow", `Drew ${Math.round(amount)} against valuation`);
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
      // Unrest from starvation drags extraction output down (Section 08); research (Section 28) lifts
      // yield (Prospectus) and slows finite-deposit depletion.
      const owner = this.corps.find((c) => c.id === sys.owner);
      const rm = owner ? this.mods(owner) : researchMods([]);
      const efficiency = (1 - t.unrestProductionPenalty * sys.unrest) * rm.yieldMult;
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
          // Deep-Core Drilling (Section 28) makes reserves drain slower than what's extracted.
          site.reservesRemaining = Math.max(0, site.reservesRemaining - extracted * rm.depletionMult);
        }
      }
      // Agri-domes convert ice into food (Section 08), within available ice. Output now scales with
      // the host world's type (Section 24): an ocean dome out-farms a barren one (`agriFoodMult`).
      let domes = 0; // raw dome count drives ice draw
      let effDomes = 0; // type-weighted domes drive food output
      for (const c of coloniesOf(sys)) {
        const n = c.buildings.hydroponics;
        if (n <= 0) continue;
        domes += n;
        effDomes += n * agriFoodMult(c.bodyType);
      }
      if (domes > 0) {
        const iceWanted = domes * t.hydroponicsIceUse;
        const iceUsed = Math.min(iceWanted, sys.stockpile.ice);
        sys.stockpile.ice -= iceUsed;
        const ratio = iceWanted > 0 ? iceUsed / iceWanted : 0;
        sys.stockpile.food += effDomes * t.hydroponicsFoodOutput * ratio;
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
    // Processor/reactor/power-grid counts are aggregated across the system's bodies (Section 24).
    const buildings = systemBuildings(sys);
    // Total power the system's processors want this turn.
    let powerNeed = 0;
    for (const recipe of t.recipes) powerNeed += (buildings.processors[recipe.id] ?? 0) * recipe.powerDraw;
    sys.production = undefined; // refreshed below; stays unset for processor-less systems
    if (powerNeed <= 0) return; // no processors → nothing to power or run

    // Baseline power = free baseline + Power Grid upgrades (Section 07c); reactors fill the gap.
    const baseline = t.basePowerPerSystem + buildings.powerGrid * t.infrastructure.powerCapacityPerLevel;
    let powerCapacity = baseline;
    const fromReactors = Math.min(
      Math.max(0, powerNeed - baseline),
      buildings.reactors * t.reactorPowerOutput,
    );
    if (fromReactors > 0) {
      const h3Want = (fromReactors / t.reactorPowerOutput) * t.reactorHelium3Use;
      const h3Used = Math.min(h3Want, sys.stockpile.helium3);
      sys.stockpile.helium3 -= h3Used;
      const fuelledFrac = h3Want > 0 ? h3Used / h3Want : 1;
      powerCapacity += fromReactors * fuelledFrac;
    }
    const powerFactor = Math.max(0, Math.min(1, powerCapacity / powerNeed));
    // Assembly Lines (Section 28) lift processor output without raising input draw.
    const owner = this.corps.find((c) => c.id === sys.owner);
    const factoryOutputMult = owner ? this.mods(owner).factoryOutputMult : 1;

    // No silent multipliers (design rule #2): the brown-out factor and each recipe's limiting
    // input are recorded on the system so the owner's UI/report can show factor, cause, and fix.
    const limited: { recipeId: string; input: Resource; ratio: number }[] = [];

    for (const recipe of t.recipes) {
      const count = buildings.processors[recipe.id] ?? 0;
      if (count <= 0) continue;
      const scale = count * efficiency * powerFactor; // desired throughput
      if (scale <= 0) continue;
      // Pro-rate by the limiting input (same shape as hydroponics' ice ratio).
      let ratio = 1;
      let limitingInput: Resource | null = null;
      for (const res of Object.keys(recipe.inputs) as Resource[]) {
        const want = (recipe.inputs[res] ?? 0) * scale;
        if (want <= 0) continue;
        const r = sys.stockpile[res] / want;
        if (r < ratio) {
          ratio = r;
          limitingInput = res;
        }
      }
      ratio = Math.max(0, Math.min(1, ratio));
      if (limitingInput && ratio < 1) limited.push({ recipeId: recipe.id, input: limitingInput, ratio });
      if (ratio <= 0) continue;
      for (const res of Object.keys(recipe.inputs) as Resource[]) {
        sys.stockpile[res] -= (recipe.inputs[res] ?? 0) * scale * ratio;
      }
      for (const res of Object.keys(recipe.outputs) as Resource[]) {
        sys.stockpile[res] += (recipe.outputs[res] ?? 0) * scale * ratio * factoryOutputMult;
      }
    }
    sys.production = { powerFactor, limited };
  }

  private resolveMarketAndLaunch(
    ordersByCorp: Map<string, Order[]>,
  ): { convoysLaunched: number; cargoValueShipped: number; routeTraffic: Record<string, number>; escortOrders: number } {
    // Build the escort pool per corp and per-system escort assignments.
    const escortBySystem = new Map<string, number>(); // key `${corpId}:${systemId}`
    let escortOrders = 0; // defender-elasticity proxy (review Section 11)
    for (const corp of this.corps) {
      for (const order of ordersByCorp.get(corp.id) ?? []) {
        if (order.kind === "escort") {
          escortBySystem.set(`${corp.id}:${order.systemId}`, order.strength);
          escortOrders += 1;
        }
      }
    }

    // Collect clearable market orders. Unlisted goods (commodity staging, review Section 13)
    // simply don't clear yet — the Exchange's vocabulary grows as range tiers are fielded.
    const listed = new Set(this.listedResources());
    const clearables: ClearableOrder[] = [];
    const orderMeta = new Map<ClearableOrder, { corp: Corporation }>();
    for (const corp of this.corps) {
      for (const order of ordersByCorp.get(corp.id) ?? []) {
        if (order.kind !== "market") continue;
        if (!listed.has(order.resource)) continue;
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
      const marketEdge = this.mods(corp).marketEdge; // Market Algorithms (Section 28): better fills

      if (fill.order.side === "buy") {
        const path = this.galaxy.shortestWarpPath(
          this.galaxy.hubId,
          fill.order.systemId,
          corp.rangeTier,
        );
        if (!path) continue;
        const hops = path.routes.length;
        const shipMult = this.shippingMultiplier(path.systems, corp.id);
        // War aggressors pay a tariff on Exchange trades (Section 23) — imports cost more.
        const unitCost = (price * (1 - marketEdge) + this.config.tuning.shippingFeePerHop * hops * shipMult) * (1 + this.warTariffFor(corp.id));
        const affordable = Math.min(
          fill.filledQuantity,
          Math.floor(corp.credits / Math.max(0.01, unitCost)),
        );
        if (affordable <= 0) continue;
        this.credit(corp, -affordable * unitCost, "marketBuy", `${Math.round(affordable)} ${resource} @ ${price.toFixed(1)} + shipping`, fill.order.systemId);
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
        // War aggressors pay a tariff on Exchange trades (Section 23) — exports earn less.
        const payout = Math.max(0, (qty * price * (1 + marketEdge) - shipping) * (1 - this.warTariffFor(corp.id)));
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
        // Destination "hub" = ship to YOUR Exchange warehouse (ruleset v10) — sell it yourself
        // later, instantly, when the price suits you. Any other destination must be owned.
        const toHub = order.toSystemId === this.galaxy.hubId;
        if (!from || !to || from.owner !== corp.id || (!toHub && to.owner !== corp.id)) continue;
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

    return { convoysLaunched, cargoValueShipped, routeTraffic, escortOrders };
  }

  private resolveRaids(
    ordersByCorp: Map<string, Order[]>,
  ): { convoysRaided: number; cargoValueLost: number; largestSingleRaidLoss: number; raidOutcomes: ReturnType<typeof emptyRaidOutcomes> } {
    const outcomes = emptyRaidOutcomes();
    let convoysRaided = 0;
    let cargoValueLost = 0;
    let largestSingleRaidLoss = 0;
    const raided = new Set<string>();

    const applyResult = (result: RaidResult, convoy: Convoy, attacker: Corporation, routeId: string, attackStrength: number, localDefense: number) => {
      outcomes[result.outcome]++;
      if (result.outcome !== "noContact") {
        // Attribution as an intel system (review Section 11): a privateer-led strike is deniable —
        // it leaves a deterministic evidence trail rather than certain attribution. Derived from a
        // pure hash (seed/turn/convoy), NOT the rng stream, so the intel layer never perturbs
        // resolution. Open ship raids are always fully attributed.
        const privateerStrength = attacker.privateers.reduce((s, p) => s + p.strength, 0);
        const shipStrength = attacker.ships.filter((s) => s.raider).reduce((s, sh) => s + sh.combat, 0);
        const deniable = privateerStrength > shipStrength;
        const sponsorEvidence = deniable
          ? 0.25 + 0.65 * evidenceHash(this.seed, this.turn, convoy.id)
          : 1;
        this.events.push({
          type: "raid",
          attackerId: attacker.id,
          defenderId: convoy.owner,
          routeId,
          convoyId: convoy.id,
          outcome: result.outcome,
          resource: convoy.resource,
          cargoLost: result.cargoDestroyed + result.cargoPlundered,
          cargoDestroyed: result.cargoDestroyed,
          cargoPlundered: result.cargoPlundered,
          // Shown math (design rule #8): named forces, not a bare outcome.
          attackStrength,
          defenseStrength: convoy.escort + localDefense,
          escort: convoy.escort,
          localDefense,
          sponsorEvidence,
        });
        // A struck convoy stokes a grievance against the raider (Section 23 retaliation) — but
        // only when the victim has real evidence of WHO (review Section 11: deniability works).
        if (result.cargoDestroyed + result.cargoPlundered > 0 && sponsorEvidence >= 0.5) {
          this.addGrudge(convoy.owner, attacker.id, 1);
        }
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
        this.credit(attacker, result.cargoPlundered * unitValue * this.config.tuning.plunderFenceRate, "plunderFence", `Fenced ${Math.round(result.cargoPlundered)} ${convoy.resource}`);
      }
      largestSingleRaidLoss = Math.max(largestSingleRaidLoss, (result.cargoDestroyed + result.cargoPlundered) * unitValue);
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
          const localDefense = this.localDefenseFor(target);
          const result = resolveRaid(
            this.rng,
            target,
            route,
            corp.id,
            strength,
            localDefense,
          );
          applyResult(result, target, corp, route.id, strength, localDefense);
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
        const targetedStrength = raidStrength(corp);
        const targetedDefense = this.localDefenseFor(target);
        const result = resolveRaid(
          this.rng,
          target,
          route,
          corp.id,
          targetedStrength,
          targetedDefense,
        );
        applyResult(result, target, corp, route.id, targetedStrength, targetedDefense);
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
        this.addGrudge(sys.owner, corp.id, success ? 1.5 : 0.5);
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
    return { convoysRaided, cargoValueLost, largestSingleRaidLoss, raidOutcomes: outcomes };
  }

  /** A system's standing raid defense (platforms, mining-rig fortification, depot, stationed ships). */
  private systemDefense(sys: System): number {
    const t = this.config.tuning;
    let def = sys.defense;
    def += sys.platforms * t.platformDefense;
    def += buildingTotal(sys, "miningRigs") * t.infrastructure.miningDefenseBonusPerLevel;
    for (const m of sys.megastructures) def += t.megastructures[m].defenseBonus;
    if (sys.hasDepot) def += t.depotDefenseBonus;
    if (sys.hasDisruptor) def += t.disruptorDefenseBonus;
    if (sys.owner) def += this.stationedDefense(sys.id, sys.owner);
    // Hull Plating / Point-Defense research (Section 28) hardens the owner's systems.
    const owner = this.corps.find((c) => c.id === sys.owner);
    return owner ? def * this.mods(owner).defenseMult : def;
  }

  // ----- War & conquest (Section 23) -----

  private name(corpId: string): string {
    return this.corps.find((c) => c.id === corpId)?.name ?? corpId;
  }

  /** Record a grievance so the victim is biased toward retaliating against the offender (Section 23). */
  private addGrudge(victimId: string, offenderId: string, weight: number): void {
    if (victimId === offenderId) return;
    const v = this.corps.find((c) => c.id === victimId);
    if (v) v.grudges[offenderId] = (v.grudges[offenderId] ?? 0) + weight;
  }

  /** Two charters are allied iff each has pledged to defend the other (Section 23). */
  private areAllied(a: string, b: string): boolean {
    if (a === b) return false;
    const ca = this.corps.find((c) => c.id === a);
    const cb = this.corps.find((c) => c.id === b);
    return !!ca && !!cb && ca.alliancePledges.includes(b) && cb.alliancePledges.includes(a);
  }

  /** True if the corp is the aggressor in any still-active war (→ barred from the Exchange). */
  private isAggressorAtWar(corpId: string): boolean {
    return this.wars.some((w) => w.aggressorId === corpId && w.endTurn > this.turn);
  }

  /** End wars whose ceasefire turn has arrived. */
  private expireWars(): void {
    for (const w of this.wars) {
      if (w.endTurn <= this.turn) {
        this.events.push({ type: "warEnded", aggressorId: w.aggressorId, defenderId: w.defenderId });
        this.log(`  Ceasefire: ${this.name(w.aggressorId)} ↔ ${this.name(w.defenderId)}`);
      }
    }
    this.wars = this.wars.filter((w) => w.endTurn > this.turn);
  }

  /**
   * Declare a war (or extend an existing one) for an act of aggression. A *defensive*
   * counter-invasion — the attacker is the defender of an existing war — only extends that war
   * and does not make the counter-attacker an aggressor (so it keeps Exchange access).
   */
  private declareOrExtendWar(aggressorId: string, defenderId: string, silent = false): void {
    const newEnd = this.turn + this.config.tuning.war.durationTurns;
    const reverse = this.wars.find(
      (w) => w.aggressorId === defenderId && w.defenderId === aggressorId && w.endTurn > this.turn,
    );
    if (reverse) {
      reverse.endTurn = Math.max(reverse.endTurn, newEnd);
      return;
    }
    const existing = this.wars.find(
      (w) => w.aggressorId === aggressorId && w.defenderId === defenderId && w.endTurn > this.turn,
    );
    if (existing) {
      existing.endTurn = Math.max(existing.endTurn, newEnd);
      return;
    }
    this.wars.push({ aggressorId, defenderId, startTurn: this.turn, endTurn: newEnd });
    if (!silent) {
      this.events.push({ type: "warDeclared", aggressorId, defenderId });
      this.log(`  WAR DECLARED: ${this.name(aggressorId)} invades ${this.name(defenderId)}'s territory`);
    }
  }

  /** Combat strength an attacker can bring to bear on a target system (ships/privateers in range). */
  private invasionAttackForce(attacker: Corporation, target: System): number {
    let force = 0;
    for (const ship of attacker.ships) {
      if (ship.combat <= 0 || !ship.stationedAt) continue;
      const route = this.galaxy.routeBetween(ship.stationedAt, target.id);
      if (route && route.charted && route.requiredRange <= ship.rangeTier) force += ship.combat;
    }
    for (const p of attacker.privateers) {
      const route = this.galaxy.routeBetween(p.basedAt, target.id);
      if (route && route.charted && route.requiredRange <= attacker.rangeTier) force += p.strength;
    }
    return force * this.mods(attacker).shipCombatMult; // Fire-Control research (Section 28)
  }

  /** A target system's total defensive strength, including allied reinforcement (Section 23). */
  private invasionDefenseForce(target: System): number {
    let def = this.systemDefense(target);
    if (!target.owner) return def;
    for (const ally of this.corps) {
      if (!this.areAllied(target.owner, ally.id)) continue;
      for (const ship of ally.ships) {
        if (ship.combat <= 0 || !ship.stationedAt) continue;
        const route = this.galaxy.routeBetween(ship.stationedAt, target.id);
        if (route && route.charted) def += ship.combat;
      }
    }
    return def;
  }

  /** Destroy `committed × frac` worth of an invader's combat (privateers first, then warships). */
  private applyInvaderLosses(corp: Corporation, committed: number, frac: number): void {
    let remaining = committed * frac;
    for (const p of corp.privateers) {
      if (remaining <= 0) break;
      const a = Math.min(p.strength, remaining);
      p.strength -= a;
      remaining -= a;
    }
    corp.privateers = corp.privateers.filter((p) => p.strength > 0);
    const destroyed = new Set<(typeof corp.ships)[number]>();
    for (const ship of corp.ships) {
      if (remaining <= 0) break;
      if (ship.combat <= 0) continue;
      const a = Math.min(ship.combat, remaining);
      ship.combat -= a;
      remaining -= a;
      if (ship.combat <= 0) destroyed.add(ship);
    }
    corp.ships = corp.ships.filter((s) => !destroyed.has(s));
  }

  /**
   * Resolve invasions (Section 23): each captures the target if the attacker's reachable fleet
   * beats the defense (with allied reinforcement) by `captureRatio`, else is repelled. Every
   * invasion declares/extends war; capture transfers the system (and may unseat a charter).
   */
  private resolveInvasions(ordersByCorp: Map<string, Order[]>): void {
    for (const corp of this.corps) {
      for (const order of ordersByCorp.get(corp.id) ?? []) {
        if (order.kind !== "invade") continue;
        const sys = this.galaxy.systems.get(order.systemId);
        if (!sys || sys.owner === null || sys.owner === corp.id) continue;
        if (sys.id === this.galaxy.hubId) continue; // the hub is Authority-protected
        if (this.areAllied(corp.id, sys.owner)) continue; // allies don't invade each other
        const attack = this.invasionAttackForce(corp, sys);
        if (attack <= 0) continue; // no military able to reach the target
        this.resolveBattle(corp, sys, attack, null);
      }
    }
  }

  /**
   * Resolve a battle for a system (Section 23): declare/extend war, pull the defender's allies in,
   * and capture the system if the attacker's committed force beats the defense by `captureRatio`,
   * else repel it. Losses fall on `fleet` if given (a mobile fleet), otherwise on the attacker's
   * stationed military. Returns whether the system was captured.
   */
  private resolveBattle(attacker: Corporation, sys: System, attackForce: number, fleet: Ship[] | null): boolean {
    const t = this.config.tuning.war;
    const defenderId = sys.owner!;
    const defense = this.invasionDefenseForce(sys);
    this.declareOrExtendWar(attacker.id, defenderId);
    this.addGrudge(defenderId, attacker.id, 3); // invasion is the gravest grievance
    // Defensive pact (Section 23): draw the defender's allies into the war against the aggressor.
    for (const ally of this.corps) {
      if (!this.areAllied(defenderId, ally.id)) continue;
      this.declareOrExtendWar(attacker.id, ally.id, true);
      this.addGrudge(ally.id, attacker.id, 3);
      this.events.push({ type: "pactInvoked", protectorId: ally.id, aggressorId: attacker.id, allyId: defenderId });
      this.log(`  PACT: ${this.name(ally.id)} joins the war against ${this.name(attacker.id)} to defend ${this.name(defenderId)}`);
    }
    // Orbital Dominance research (Section 28, Phase 3) lowers the attacker's capture threshold.
    const captured = attackForce >= Math.max(1, defense) * t.captureRatio * this.mods(attacker).captureRatioMult;
    if (captured) {
      const prevOwner = this.corps.find((c) => c.id === defenderId);
      if (prevOwner) {
        prevOwner.ownedSystemIds = prevOwner.ownedSystemIds.filter((id) => id !== sys.id);
        for (const ship of prevOwner.ships) if (ship.stationedAt === sys.id) ship.stationedAt = "";
        // Pillage R&D (Section 28): the conqueror seizes 1–3 random techs the loser holds that it lacks.
        this.transferTech(prevOwner, attacker);
        if (prevOwner.ownedSystemIds.length === 0) {
          prevOwner.hasCharter = false;
          prevOwner.isFreeOperator = true;
        }
      }
      sys.owner = attacker.id;
      attacker.ownedSystemIds.push(sys.id);
      this.grantStarterExtractor(sys);
    }
    const frac = captured ? t.captureLossFrac : t.repelLossFrac;
    if (fleet) this.applyFleetLosses(attacker, fleet, attackForce, frac);
    else this.applyInvaderLosses(attacker, attackForce, frac);
    this.events.push({ type: "invasion", attackerId: attacker.id, defenderId, systemId: sys.id, captured, attackForce: Math.round(attackForce), defenseForce: Math.round(defense) });
    this.log(`  INVASION: ${attacker.name} ${captured ? "captures" : "is repelled at"} ${sys.name}`);
    return captured;
  }

  /** Destroy `committed × frac` of a specific fleet's combat (Section 23 mobile-fleet battle). */
  private applyFleetLosses(corp: Corporation, fleet: Ship[], committed: number, frac: number): void {
    let remaining = committed * frac;
    const destroyed = new Set<Ship>();
    for (const ship of fleet) {
      if (remaining <= 0) break;
      if (ship.combat <= 0) continue;
      const a = Math.min(ship.combat, remaining);
      ship.combat -= a;
      remaining -= a;
      if (ship.combat <= 0) destroyed.add(ship);
    }
    corp.ships = corp.ships.filter((s) => !destroyed.has(s));
  }

  /**
   * Advance every ship in transit one turn (Section 23). On reaching its destination a fleet
   * re-bases there — unless the destination is a non-allied rival system, in which case the
   * arriving ships give battle: a win captures and occupies the system, a loss falls back.
   */
  /** Record that `corp` has fully scouted `sys` (Section 25): grants it richness + reserves intel
   *  on every deposit there, even in rival territory. Owned systems are always fully known. */
  private surveyReveal(corp: Corporation, sys: System): void {
    if (!corp.surveyedSystemIds.includes(sys.id)) corp.surveyedSystemIds.push(sys.id);
    this.events.push({ type: "build", corpId: corp.id, what: `Survey complete: ${sys.name}`, systemId: sys.id });
    this.log(`  ${corp.name}'s survey vessel scouts ${sys.name} — full deposit intel acquired`);
  }

  private resolveFleetMovement(): void {
    // Group ships that arrive at the same destination this turn so a fleet fights as one.
    const arrivals = new Map<string, { corp: Corporation; sys: System; ships: Ship[]; attack: boolean }>();
    for (const corp of this.corps) {
      for (const ship of corp.ships) {
        const tr = ship.transit;
        if (!tr) continue;
        // Transit counts from the launch resolution, exactly like convoys (Section 20 / ruleset v8):
        // a fleet ordered on turn T crosses its first segment THIS turn, so a single-segment move
        // arrives when T resolves and the fleet is usable on T+1. Total travel turns therefore equal
        // the previewed ETA (Σ segment times) — no hidden +1 launch turn. The surveyor's return leg
        // is created later in this same pass and so first advances next turn (it can't fly two legs
        // in one turn), which is correct.
        tr.segmentTurnsLeft -= 1;
        if (tr.segmentTurnsLeft > 0) continue;
        // A Warp Disruptor (Section 04) holds a rival fleet on its FINAL approach: as the last
        // segment completes (position not yet stepped onto the destination), if the destination
        // carries a non-allied rival's disruptor, freeze the fleet for `disruptorDelay` extra turns
        // — exactly once (`tr.disrupted`). Evaluated here at step 6.6, after all administrative
        // builds settle, so it is independent of intra-turn build/move order.
        if (tr.position + 1 === tr.path.length - 1 && !tr.disrupted) {
          const destId = tr.path[tr.path.length - 1]!;
          const destSys = this.galaxy.systems.get(destId);
          if (destSys && destSys.hasDisruptor && destSys.owner !== null
              && destSys.owner !== corp.id && !this.areAllied(corp.id, destSys.owner)) {
            tr.disrupted = true;
            tr.segmentTurnsLeft = this.config.tuning.disruptorDelay;
            continue;
          }
        }
        tr.position += 1;
        // Record the leg just completed for the map's "Last turn movements" replay.
        this.movements.push({
          kind: "fleet",
          owner: corp.id,
          fromSystemId: tr.path[tr.position - 1]!,
          toSystemId: tr.path[tr.position]!,
          offLane: tr.routeIds[tr.position - 1] === "",
        });
        if (tr.position < tr.path.length - 1) {
          // Off-lane legs carry a "" route id (no WarpRoute): prefer the stored speed-baked
          // per-segment time, falling back to the route's own transit time only for lane-only
          // transits (e.g. survey vessels) that never recorded segmentTimes.
          const nextRid = tr.routeIds[tr.position]!;
          const nextRoute = nextRid ? this.galaxy.routes.get(nextRid) : undefined;
          tr.segmentTurnsLeft = tr.segmentTimes?.[tr.position] ?? (nextRoute ? nextRoute.transitTime : 1);
          continue;
        }
        // Reached the destination.
        const dest = tr.path[tr.path.length - 1]!;
        const sys = this.galaxy.systems.get(dest);
        const hostile = !!sys && sys.owner !== null && sys.owner !== corp.id && !this.areAllied(corp.id, sys.owner);
        if (sys && hostile && tr.attack && dest !== this.galaxy.hubId) {
          const key = `${corp.id}|${dest}`;
          const g = arrivals.get(key) ?? { corp, sys, ships: [], attack: true };
          g.ships.push(ship);
          arrivals.set(key, g);
          ship.stationedAt = ""; // resolved below
          ship.transit = undefined;
        } else if (ship.surveyor && sys) {
          // A survey vessel (Section 25) reaches its target — even in rival space (it never fights).
          // It scouts the whole system, then flies home; if it can't, it bases where it can.
          this.surveyReveal(corp, sys);
          const home = tr.surveyReturnTo;
          const back = home && home !== dest && this.galaxy.systems.has(home)
            ? this.galaxy.shortestWarpPath(dest, home, ship.rangeTier)
            : null;
          if (back && back.routes.length > 0) {
            const firstRoute = this.galaxy.routes.get(back.routes[0]!);
            ship.stationedAt = "";
            ship.transit = {
              path: back.systems, routeIds: back.routes, position: 0,
              segmentTurnsLeft: firstRoute ? firstRoute.transitTime : 1,
              launchedTurn: this.turn, attack: false, surveyReturnTo: undefined,
            };
          } else {
            // Already home, or no way back — base in own/neutral space, never in a rival's system.
            ship.stationedAt = sys.owner === corp.id || sys.owner === null ? dest : (home ?? dest);
            ship.transit = undefined;
          }
        } else {
          // Peaceful arrival (own/allied/neutral) — re-base here. (A would-be attack on a system
          // that is no longer hostile just becomes a peaceful move.)
          ship.stationedAt = sys ? dest : tr.path[tr.position - 1] ?? dest;
          ship.transit = undefined;
        }
      }
    }
    // Resolve each arriving fleet's battle.
    for (const { corp, sys, ships } of arrivals.values()) {
      if (sys.owner === null || sys.owner === corp.id) {
        for (const s of ships) s.stationedAt = sys.id; // target changed hands first — just occupy
        continue;
      }
      const force = ships.reduce((sum, s) => sum + s.combat, 0) * this.mods(corp).shipCombatMult; // Section 28
      const fallback = sys.routeIds
        .map((rid) => this.galaxy.route(rid))
        .map((r) => (r.a === sys.id ? r.b : r.a))
        .find((id) => {
          const n = this.galaxy.systems.get(id);
          return n && (n.owner === corp.id || n.owner === null || this.areAllied(corp.id, n.owner ?? ""));
        }) ?? sys.id;
      const captured = this.resolveBattle(corp, sys, force, ships);
      // Survivors occupy on a win, fall back to a friendly/neutral neighbour on a loss.
      for (const s of corp.ships) if (ships.includes(s)) s.stationedAt = captured ? sys.id : fallback;
    }
  }

  private resolveArrivals(): void {
    const surviving: Convoy[] = [];
    for (const convoy of this.convoys) {
      // Transit counts from the launch resolution (ruleset v8): a convoy launched at step 4
      // crosses its first segment THIS turn — through the step-5 interdiction window — so a
      // 1-hop import ordered on turn T is in the destination stockpile when T resolves and
      // usable on T+1. Every segment still spends exactly one raid window in flight.
      convoy.segmentTurnsLeft -= 1;
      if (convoy.segmentTurnsLeft > 0) {
        surviving.push(convoy);
        continue;
      }
      convoy.position += 1;
      // Record the leg just completed for the map's "Last turn movements" replay.
      this.movements.push({
        kind: "convoy",
        owner: convoy.owner,
        fromSystemId: convoy.path[convoy.position - 1]!,
        toSystemId: convoy.path[convoy.position]!,
        offLane: convoy.routeIds[convoy.position - 1] === "",
      });
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
      convoyId: convoy.id,
      kind: convoy.kind,
      resource: convoy.resource,
      quantity: convoy.quantity,
      payout: convoy.kind === "sell" ? convoy.payout : 0,
      destSystemId: convoy.path[convoy.path.length - 1]!,
    });
    if (convoy.kind === "sell") {
      this.credit(owner, convoy.payout, "convoyPayout", `${Math.round(convoy.quantity)} ${convoy.resource} delivered to the Exchange`);
      this.log(
        `  arrival: ${owner.name} sell ${convoy.quantity} ${convoy.resource} → +${Math.round(convoy.payout)} cr`,
      );
    } else if (convoy.kind === "transfer" && convoy.path[convoy.path.length - 1] === this.galaxy.hubId) {
      // Warehouse delivery (ruleset v10): capacity-clamped. Overflow never vanishes — it's
      // consigned, sold immediately at the walked-down instant price.
      const free = Math.max(0, this.warehouseCapacity(owner) - this.warehouseUsed(owner));
      const stored = Math.min(convoy.quantity, free);
      owner.hubStockpile[convoy.resource] += stored;
      const overflow = Math.floor(convoy.quantity - stored);
      if (overflow > 0) {
        const quote = quoteInstant(this.config.tuning, this.market.prices[convoy.resource], convoy.resource, "sell", overflow);
        const proceeds = quote.total * (1 - this.warTariffFor(owner.id));
        this.market.prices[convoy.resource] = quote.newPrice;
        this.credit(owner, proceeds, "convoyPayout", `${overflow} ${convoy.resource} warehouse overflow — consigned @ ~${quote.avgPrice.toFixed(1)}`);
        this.log(`  ${owner.name} warehouse overflow: ${overflow} ${convoy.resource} consigned`);
      }
      this.log(`  arrival: ${owner.name} stores ${Math.round(stored)} ${convoy.resource} in the hub warehouse`);
    } else {
      const dest = this.galaxy.systems.get(convoy.path[convoy.path.length - 1]!);
      if (dest) dest.stockpile[convoy.resource] += convoy.quantity;
    }
  }

  /** The live research modifiers a charter currently enjoys (Section 28), overlaid with its
   *  charter-type identity (review Section 5) once the pick's effective turn is reached. */
  private mods(corp: Corporation): ResearchMods {
    const m = researchMods(corp.research.completed);
    if (corp.charter && this.turn >= (corp.charterFrom ?? 0)) CHARTER_SPECS[corp.charter].apply(m);
    return m;
  }

  /**
   * Record a seat's charter-type pick (review Section 5). `fromTurn` is the first turn the
   * effects apply — the worker passes the turn AFTER the pick was made, so the event-sourced
   * replay re-derives every earlier turn identically.
   */
  setCharter(corpId: string, charter: CharterType, fromTurn: number): void {
    const corp = this.corps.find((c) => c.id === corpId);
    if (!corp || corp.charter) return; // a charter identity is picked once
    corp.charter = charter;
    corp.charterFrom = fromTurn;
  }

  /** Seize 1–3 random techs the conquered charter holds that the conqueror lacks (Section 28). A
   *  pillaged tech bypasses choice-group lockouts — you can end up holding both sides of a fork. */
  private transferTech(from: Corporation, to: Corporation): void {
    // Secret projects are galaxy-unique and can't be seized or inherited — they stay with their maker.
    const pool = from.research.completed.filter((id) => !to.research.completed.includes(id) && !SECRET_TECH_IDS.includes(id));
    if (pool.length === 0) return;
    const take = Math.min(pool.length, this.rng.int(1, 3));
    for (let i = 0; i < take; i++) {
      const id = pool.splice(this.rng.int(0, pool.length - 1), 1)[0]!;
      to.research.completed.push(id);
      this.events.push({ type: "research", corpId: to.id, techId: id });
      this.log(`  ${to.name} seizes research from ${from.name}: ${techById(id)?.name ?? id}`);
    }
  }

  /**
   * Generate research points (Research Labs + populated colonies) and pour them into each charter's
   * active research project (Section 28). Finished techs move to `completed`; leftover RP banks when
   * the queue empties. Effects are read live via {@link mods}, so completing a tech needs no apply step.
   */
  private resolveResearch(): void {
    const t = this.config.tuning;
    for (const corp of this.corps) {
      const r = corp.research;
      if (corp.isFreeOperator) { r.banked = 0; continue; }
      let rp = r.banked;
      for (const sysId of corp.ownedSystemIds) {
        const sys = this.galaxy.system(sysId);
        rp += buildingTotal(sys, "labs") * t.labRpOutput;
        // One population per system (review Section 10): its stage drives the populace RP.
        if (coloniesOf(sys).some((c) => canHostPopulation(c))) rp += t.researchPopBase[sys.populationStage];
      }
      while (rp > 0 && r.queue.length > 0) {
        const id = r.queue[0]!;
        const tech = techById(id);
        if (!tech || r.completed.includes(id) || !canResearch(tech, r.completed)) { r.queue.shift(); continue; }
        // Secret-project race (Phase 3): if a rival already claimed this galaxy-unique tech, the race
        // is lost — drop it and bank back the RP already invested rather than waste it.
        if (tech.secret && this.secretOwner(id) !== null) {
          rp += r.invested[id] ?? 0;
          delete r.invested[id];
          r.queue.shift();
          continue;
        }
        const need = tech.rpCost - (r.invested[id] ?? 0);
        if (rp >= need) {
          rp -= need;
          delete r.invested[id];
          r.queue.shift();
          r.completed.push(id);
          // Warp-Drive research raises the charter's range tier (Section 28, Phase 2).
          if (tech.grantsRangeTier && tech.grantsRangeTier > corp.rangeTier) {
            corp.rangeTier = tech.grantsRangeTier as typeof corp.rangeTier;
            if (corp.rangeTier >= 2 && this.metrics.range2Turn[corp.id] === -1) this.metrics.range2Turn[corp.id] = this.turn;
          }
          if (id === "nav-wormhole") this.applyWormholeEngineering(corp); // Phase 3 secret-project effect
          this.events.push({ type: "research", corpId: corp.id, techId: id });
          this.log(`  ${corp.name} completes research: ${tech.name}${tech.secret ? " (secret project!)" : ""}`);
        } else {
          r.invested[id] = (r.invested[id] ?? 0) + rp;
          rp = 0;
        }
      }
      r.banked = rp; // leftover banks for next turn (e.g. an empty queue)
    }
    this.resolveEspionage();
  }

  /** Which charter (if any) has already completed a galaxy-unique secret project (Section 28, Phase 3). */
  private secretOwner(techId: string): string | null {
    for (const c of this.corps) if (c.research.completed.includes(techId)) return c.id;
    return null;
  }

  /** Wormhole Engineering (Phase 3): instantly chart every warp lane touching the holder's systems. */
  private applyWormholeEngineering(corp: Corporation): void {
    for (const sysId of corp.ownedSystemIds) {
      for (const rid of this.galaxy.system(sysId).routeIds) {
        const route = this.galaxy.routes.get(rid);
        if (route) route.charted = true;
      }
    }
  }

  /** Industrial Espionage (Phase 3): charters with a spy network steal one random tech they lack from
   *  a random rival that holds it, every few turns. Secret projects can't be stolen (galaxy-unique). */
  private resolveEspionage(): void {
    if (this.turn % this.config.tuning.espionageInterval !== 0) return;
    for (const corp of this.corps) {
      if (!this.config.tuning.features.espionage) continue; // deferred from v1 (review Section 13)
      if (corp.isFreeOperator || !this.mods(corp).stealsTech) continue;
      const stealable = new Set<string>();
      for (const rival of this.corps) {
        if (rival.id === corp.id) continue;
        for (const id of rival.research.completed) {
          if (!corp.research.completed.includes(id) && !SECRET_TECH_IDS.includes(id)) stealable.add(id);
        }
      }
      const pool = [...stealable];
      if (pool.length === 0) continue;
      const id = pool[this.rng.int(0, pool.length - 1)]!;
      corp.research.completed.push(id);
      this.events.push({ type: "research", corpId: corp.id, techId: id });
      this.log(`  ESPIONAGE: ${corp.name} steals research: ${techById(id)?.name ?? id}`);
    }
  }

  private resolvePopulationAndUpkeep(): { taxLevied: number } {
    const t = this.config.tuning;
    const stages: PopulationStage[] = ["outpost", "settlement", "colony", "city", "metropolis"];
    let taxLevied = 0;

    for (const corp of this.corps) {
      const rm = this.mods(corp); // research effects (Section 28): upkeep, growth, fleet fuel
      for (const sysId of corp.ownedSystemIds) {
        const sys = this.galaxy.system(sysId);
        // Building counts are aggregated across the system's bodies (Section 24).
        const buildings = systemBuildings(sys);
        // Mining Rig fortification lowers a system's upkeep (Section 07c). Upkeep is per-SYSTEM;
        // Charter Reform research trims it further.
        const upkeepFrac = Math.max(0, 1 - buildings.miningRigs * t.infrastructure.miningUpkeepReductionPerLevel);
        this.credit(corp, -sys.upkeep * upkeepFrac * rm.upkeepMult, "upkeep", `${sys.name} charter upkeep`, sys.id);

        // Megastructures (space elevator / ringworld) accelerate growth across the whole system.
        const megaGrowth = sys.megastructures.reduce((s, m) => s + t.megastructures[m].growthBonus, 0);

        // ONE population per system (review Section 10): one feed, one growth roll, one tax line.
        // Habitable/domed world count multiplies growth and tax, so a multi-habitable system stays
        // a genuinely richer prize without per-world feeding orders, unrest, or tax accounting.
        const habitableWorlds = coloniesOf(sys).filter((c) => canHostPopulation(c)).length;
        if (habitableWorlds > 0) {
          // Life support (food + ice) scales with the system's stage, drawn from the shared
          // warehouse; any shortfall falls back to premium emergency imports (ledgered).
          const food = this.consumeOrImport(corp, sys, "food", t.foodNeed[sys.populationStage]);
          const ice = this.consumeOrImport(corp, sys, "ice", t.iceNeed[sys.populationStage]);
          const fed = food.met && ice.met;
          // Growth needs LOCAL food (the system's own gardens/domes, not emergency imports).
          const thriving = fed && food.local;

          // The Habitats track is THE population-growth investment (review Section 13), now
          // system-level: levels are summed across bodies and apply to the one population.
          const habs = buildings.habitats;
          const worldGrowthMult = 1 + (habitableWorlds - 1) * t.habitableGrowthBonusPerWorld;
          const worldTaxMult = 1 + (habitableWorlds - 1) * t.habitableTaxBonusPerWorld;
          const habitatTaxMult = 1 + habs * t.infrastructure.habitatTaxBonusPerLevel;
          const habitatGrowthMult = 1 + habs * t.infrastructure.habitatGrowthBonusPerLevel + megaGrowth;

          if (fed) {
            const tax = t.taxPerStage[sys.populationStage] * (1 - sys.unrest) * habitatTaxMult * worldTaxMult * rm.taxMult;
            taxLevied += tax;
            this.credit(corp, tax, "tax", `${sys.name} population tax`, sys.id);
            sys.unrest = Math.max(0, sys.unrest - t.unrestRecoveryPerFedTurn);
          } else {
            sys.unrest = Math.min(1, sys.unrest + t.unrestPerStarvedTurn);
            this.events.push({ type: "starved", corpId: corp.id, systemId: sys.id });
          }

          if (thriving) {
            sys.populationProgress += t.growthRate[sys.populationStage] * habitatGrowthMult * worldGrowthMult * rm.growthMult;
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
      }

      // Fleet operation burns fuel each turn (Section 07b): a recurring sink that keeps the
      // fuel market live. Drawn from the corp's stockpiles first, shortfall bought at market.
      this.chargeFuel(corp, corp.ships.length * t.fuelPerShipPerTurn * rm.shipFuelMult, "fuelUpkeep", `${corp.ships.length} ship${corp.ships.length === 1 ? "" : "s"} operating fuel`);

      if (corp.debt > 0) {
        const interest = corp.debt * t.debtInterest;
        corp.debt += interest;
        // Interest accrues to DEBT, not credits — delta 0 keeps the Σledger==Δcredits invariant
        // honest while still putting the liability growth on the statement (design rule #1).
        this.ledgerLines.push({ corpId: corp.id, delta: 0, cause: "debtInterest", detail: `debt +${Math.round(interest)} (${Math.round(t.debtInterest * 100)}% interest)` });
      }
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
      this.credit(corp, -affordable * unitCost, "emergencyImport", `${Math.round(affordable)} ${resource} @ ${unitCost.toFixed(1)} (premium humanity import)`);
      shortfall -= affordable;
    }
    return { met: shortfall <= 0, local: false };
  }

  private updateValuations(): void {
    const v = this.config.tuning.valuation;
    for (const corp of this.corps) {
      // equity = system assets + population + infrastructure + ships + stockpiles
      //          + cash + earnings momentum - debt  (Section 17)
      // Built as a per-component breakdown (design rule: the win metric is not a black box) —
      // the owner's UI decomposes the share price on demand from `valuationParts`.
      const parts: Record<ValuationComponent, number> = {
        cash: corp.credits,
        debt: -corp.debt,
        fleet: corp.ships.length * v.shipValue,
        momentum:
          corp.recentEarnings.length > 0
            ? (corp.recentEarnings.reduce((s, e) => s + e, 0) / corp.recentEarnings.length) *
              v.earningsMomentumWeight
            : 0,
        yields: 0,
        extractors: 0,
        population: 0,
        infrastructure: 0,
        megastructures: 0,
        stockpiles: 0,
      };
      for (const sysId of corp.ownedSystemIds) {
        const sys = this.galaxy.system(sysId);
        // Value the realised per-turn extraction (Section 21: worked sites, net of depletion +
        // stellar), plus the extractor capital sunk into the system's sites.
        const ey = effectiveYields(sys, this.turn, this.config.turns);
        const yieldTotal = RESOURCES.reduce((s, r) => s + ey[r], 0);
        parts.yields += yieldTotal * v.perSystemYieldValue;
        parts.extractors += sys.sites.reduce((s, st) => s + st.extractorLevel, 0) * v.extractorValue;
        // One population per system (review Section 10), with habitable-world count as the
        // richness multiplier — a multi-habitable system is still the better prize.
        const habitableWorlds = coloniesOf(sys).filter((c) => canHostPopulation(c)).length;
        if (habitableWorlds > 0) {
          parts.population +=
            v.populationValue[sys.populationStage] * (1 - sys.unrest) *
            (1 + (habitableWorlds - 1) * this.config.tuning.habitableTaxBonusPerWorld);
        }
        const buildings = systemBuildings(sys);
        parts.infrastructure +=
          (sys.hasDepot ? v.depotValue : 0) +
          buildings.hydroponics * (v.depotValue * 0.25) +
          Object.values(buildings.processors).reduce((s, n) => s + n, 0) * v.processorValue +
          buildings.reactors * v.reactorValue +
          (buildings.miningRigs + buildings.habitats + buildings.powerGrid) * v.infraLevelValue +
          sys.platforms * this.config.tuning.platformCost;
        // Megastructures are prestige capital (Section 22).
        for (const m of sys.megastructures) parts.megastructures += this.config.tuning.megastructures[m].valuation;
        for (const r of RESOURCES) {
          parts.stockpiles += sys.stockpile[r] * this.config.tuning.basePrices[r] * v.stockpileFrac;
        }
      }
      corp.valuationParts = parts;
      corp.valuation = Math.round(Object.values(parts).reduce((s, n) => s + n, 0));
      corp.sharePrice = Math.max(1, corp.valuation / corp.sharesOutstanding);
    }
  }

  /**
   * Sentiment (Section 17): the market-mood multiplier on share trades. A pure function
   * of this turn's shown events (raids, lost systems, war, distress, earnings) plus mean
   * reversion and a small off-stream seeded jitter (evidenceHash — never the resolution
   * Rng, so replay is not perturbed). Decomposed into parts so the Finance UI can explain
   * every move (rule #6). Affects trade execution ONLY — valuation/standings read book.
   */
  private updateSentiment(): void {
    const s = this.config.tuning.equity.sentiment;
    // Tally this turn's shocks per corp from the shown event stream — factors, not dice.
    const shocks = new Map<string, number>();
    const add = (corpId: string, x: number) => shocks.set(corpId, (shocks.get(corpId) ?? 0) + x);
    for (const e of this.events) {
      if (e.type === "raid") add(e.defenderId, s.raidImpulse);
      else if (e.type === "invasion" && e.captured) add(e.defenderId, s.systemLostImpulse);
      else if (e.type === "warDeclared") add(e.defenderId, s.warImpulse);
    }
    for (const corp of this.corps) {
      let shock = shocks.get(corp.id) ?? 0;
      if (corp.credits < this.config.tuning.distressCreditFloor / 2) shock += s.nearDistressImpulse;
      // Positive-only: a cash-negative turn usually means reinvestment (builds, claims),
      // not a bad quarter — genuine trouble already arrives as raid/war/distress shocks.
      const lastEarnings = corp.recentEarnings[corp.recentEarnings.length - 1] ?? 0;
      if (lastEarnings > 0) shock += s.earningsImpulse;
      // A triple-raid turn is a bad day, not a death spiral.
      shock = Math.max(-s.maxShockPerTurn, Math.min(s.maxShockPerTurn, shock));

      const reverted = corp.sentiment + (1 - corp.sentiment) * s.reversion;
      const afterEvents = reverted * (1 + shock);
      const jitter = (evidenceHash(this.seed, this.turn, corp.id) * 2 - 1) * s.jitter;
      const next = Math.max(s.min, Math.min(s.max, afterEvents + jitter));
      corp.sentimentParts = {
        reversion: reverted - corp.sentiment,
        events: afterEvents - reverted,
        jitter: next - afterEvents, // includes any clamping
      };
      corp.sentiment = next;
      if (Math.abs(corp.sentimentParts.events) > 0.001) {
        this.log(`  ${corp.name} sentiment ${corp.sentiment.toFixed(2)} (events ${(shock * 100).toFixed(0)}%)`);
      }
    }
  }

  /**
   * Equity layer (Sections 17–18): resolve share purchases, then check for control
   * changes (hostile/friendly acquisitions) and distress liquidations.
   */
  private resolveEquity(
    ordersByCorp: Map<string, Order[]>,
  ): { acquisitions: number; distress: number; taxLevied: number } {
    const eq = this.config.tuning.equity;

    // Share purchases (Section 17): ONE sealed batch per target — seat order never
    // matters. Blocks sell cheapest-ask-first; demand a block can satisfy trades at
    // its posted ask, even from several buyers at once. When buyers contend for a
    // SCARCE block, it auctions: the highest effective limit wins the shares and pays
    // its own limit (your limit is your bid), exact ties splitting the block evenly.
    // Buying your own charter is a buyback (defense): you shop every block but your own.
    type BuyIntent = { buyer: Corporation; remaining: number; limit: number; discount: number };
    const buysByTarget = new Map<string, BuyIntent[]>();
    for (const corp of this.corps) {
      for (const order of ordersByCorp.get(corp.id) ?? []) {
        if (order.kind !== "buyShares") continue;
        if (!this.corps.some((c) => c.id === order.targetId)) continue;
        const list = buysByTarget.get(order.targetId) ?? [];
        list.push({
          buyer: corp,
          remaining: Math.max(0, Math.floor(order.shares)),
          // Legacy event-log orders predate mandatory limits and replay uncapped.
          limit: order.limitPrice ?? Number.POSITIVE_INFINITY,
          // Hostile Takeover research (Section 28) makes share raids cheaper: a
          // discounted buyer outbids at the same cash limit (limit ÷ discount).
          discount: this.mods(corp).acquisitionCostMult,
        });
        buysByTarget.set(order.targetId, list);
      }
    }
    for (const [targetId, intents] of buysByTarget) {
      const target = this.corps.find((c) => c.id === targetId)!;
      const tradedBase = target.sharePrice * target.sentiment;

      type Ask = { holder: string; label: string; ask: number; sellerCorp?: Corporation; wholeBlock?: boolean };
      const asks: Ask[] = [];
      for (const npc of target.npcHolders) {
        if ((target.shareRegister[npc.id] ?? 0) > 0) {
          asks.push({ holder: npc.id, label: npc.name, ask: tradedBase * npc.askPremium });
        }
      }
      for (const holder of Object.keys(target.shareRegister)) {
        if (isNpcHolderId(holder)) continue;
        if ((target.shareRegister[holder] ?? 0) <= 0) continue;
        if (holder === target.founderId) {
          // The management block: a buyout of the officers — it only ever sells WHOLE,
          // at the steepest premium, and the proceeds are the corp's own treasury
          // (it is the corp selling itself).
          asks.push({ holder, label: "management block", ask: tradedBase * eq.managementHoldoutMult, sellerCorp: target, wholeBlock: true });
        } else {
          const sellerCorp = this.corps.find((c) => c.id === holder);
          asks.push({ holder, label: sellerCorp?.name ?? holder, ask: tradedBase * eq.corpHoldoutMult, sellerCorp });
        }
      }
      asks.sort((a, b) => a.ask - b.ask || a.holder.localeCompare(b.holder));

      // Concentration premium: the marginal share costs more as the buyer's stake
      // grows (quadratic in position) — creeping to control is priced like the
      // takeover it is. Buybacks of your own charter are exempt.
      const posMult = (buyer: Corporation): number => {
        if (buyer.id === target.id) return 1;
        const frac = (target.shareRegister[buyer.id] ?? 0) / Math.max(1, target.sharesOutstanding);
        return 1 + eq.positionImpact * frac * frac;
      };
      // Cash price of the buyer's NEXT share from block `a`, right now.
      const floorPrice = (it: BuyIntent, a: { ask: number }): number => a.ask * posMult(it.buyer) * it.discount;

      // Move shares + money for one fill. NPC sellers pocket proceeds off-map (a
      // sink); corp sellers — including the target's own treasury — are paid for real.
      // Ledger lines stay anonymous: you trade against the market, not a named holder
      // (the public register reveals stakes, but never who traded with whom).
      const fillShares = (it: BuyIntent, a: Ask, wanted: number, price: number): number => {
        const available = target.shareRegister[a.holder] ?? 0;
        const take = Math.min(wanted, available, Math.floor(it.buyer.credits / Math.max(0.01, price)));
        if (take <= 0) return 0;
        const cost = take * price;
        this.credit(it.buyer, -cost, "shareTrade", `Bought ${take} ${target.name} shares @ ${price.toFixed(0)}`);
        target.shareRegister[a.holder] = available - take;
        target.shareRegister[it.buyer.id] = (target.shareRegister[it.buyer.id] ?? 0) + take;
        if (a.sellerCorp) this.credit(a.sellerCorp, cost, "shareTrade", `Sold ${take} ${target.name} shares @ ${price.toFixed(0)}`);
        it.remaining -= take;
        return take;
      };

      for (const a of asks) {
        if (a.wholeBlock) {
          // Management sells only as one lot: a negotiated buyout of the officers at a
          // single per-share price. The concentration premium does NOT apply — it exists
          // to stop creeping accumulation, and a whole-block buyout is not creeping; the
          // holdout multiple IS its premium. The order must want the whole block, clear
          // the price with its limit, and pay cash in full.
          const blockShares = target.shareRegister[a.holder] ?? 0;
          if (blockShares <= 0) continue;
          const claimants = intents
            .filter((it) => {
              if (it.remaining < blockShares || it.buyer.id === a.holder) return false;
              const price = a.ask * it.discount;
              return it.limit >= price - 1e-9 && it.buyer.credits >= price * blockShares;
            })
            .sort((x, y) => y.limit / y.discount - x.limit / x.discount || x.buyer.id.localeCompare(y.buyer.id));
          const contested = claimants.length > 1;
          for (const it of claimants) {
            // Contested buyouts go to the highest limit, which pays it (its bid).
            const price = contested ? it.limit : a.ask * it.discount;
            if (it.buyer.credits < price * blockShares) continue;
            fillShares(it, a, blockShares, price);
            break;
          }
          continue;
        }
        // Auction loop for one block: each pass re-checks eligibility as fills consume
        // shares and cash, and either fills at least one share or exits.
        for (;;) {
          const available = target.shareRegister[a.holder] ?? 0;
          if (available <= 0) break;
          const eligible = intents.filter(
            (it) =>
              it.remaining > 0 &&
              it.buyer.id !== a.holder && // nobody buys out of their own stake
              it.limit >= floorPrice(it, a) - 1e-9 &&
              it.buyer.credits >= floorPrice(it, a),
          );
          if (eligible.length === 0) break;
          const demand = eligible.reduce(
            (s, it) => s + Math.min(it.remaining, Math.floor(it.buyer.credits / Math.max(0.01, floorPrice(it, a)))),
            0,
          );
          if (eligible.length === 1 || demand <= available) {
            // No scarcity: everyone trades at the posted ask × their position premium,
            // share by share — the price creeps up as the stake grows, and the fill
            // stops at the limit (or the wallet) on its own.
            for (const it of eligible) {
              while (it.remaining > 0 && (target.shareRegister[a.holder] ?? 0) > 0) {
                const p = floorPrice(it, a);
                if (p > it.limit + 1e-9 || it.buyer.credits < p) break;
                if (fillShares(it, a, 1, p) <= 0) break;
              }
            }
            break;
          }
          // Contested: the price jumps to the highest effective limit, whose owner(s)
          // take the shares at that price. Lower bidders wait for what is left.
          const top = Math.max(...eligible.map((it) => it.limit / it.discount));
          const winners = eligible
            .filter((it) => it.limit / it.discount >= top - 1e-9)
            .sort((x, y) => x.buyer.id.localeCompare(y.buyer.id));
          let progressed = 0;
          let again = true;
          // Tied winners alternate single shares so an odd remainder lands fairly.
          while (again) {
            again = false;
            for (const w of winners) {
              if (w.remaining <= 0 || (target.shareRegister[a.holder] ?? 0) <= 0) continue;
              // The concentration floor climbs as the stake grows — a winner whose
              // floor passes their own bid stops winning.
              if (floorPrice(w, a) > w.limit + 1e-9) continue;
              const got = fillShares(w, a, 1, Math.max(top * w.discount, floorPrice(w, a)));
              progressed += got;
              if (got > 0 && w.remaining > 0) again = true;
            }
          }
          if (progressed === 0) {
            // Winners bid more than they can pay — void their orders so the next tier
            // (or the posted ask) can clear instead of looping forever.
            for (const w of winners) w.remaining = 0;
          }
        }
      }
    }

    // Share sales (Section 17): the mirror batch — every sell competes for the
    // institutions' limited per-turn absorption, best bid first, the most willing
    // seller (lowest limit) filling first; everyone receives the POSTED bid. The
    // discount + caps keep round trips strictly lossy (no mint to pump). Selling your
    // OWN charter's shares is equity financing: the management block shrinks (takeover
    // exposure rises) and the proceeds land in the corp treasury. Sells resolve after
    // buys so sale proceeds cannot fund a purchase in the same resolution.
    type SellIntent = { seller: Corporation; remaining: number; limit: number };
    const sellsByTarget = new Map<string, SellIntent[]>();
    for (const corp of this.corps) {
      for (const order of ordersByCorp.get(corp.id) ?? []) {
        if (order.kind !== "sellShares") continue;
        if (!this.corps.some((c) => c.id === order.targetId)) continue;
        const list = sellsByTarget.get(order.targetId) ?? [];
        // Legacy event-log orders predate mandatory limits and replay uncapped.
        list.push({ seller: corp, remaining: Math.max(0, Math.floor(order.shares)), limit: order.limitPrice ?? 0 });
        sellsByTarget.set(order.targetId, list);
      }
    }
    for (const [targetId, intents] of sellsByTarget) {
      const target = this.corps.find((c) => c.id === targetId)!;
      const tradedBase = target.sharePrice * target.sentiment;
      const bids = target.npcHolders
        .map((npc) => ({ npc, bid: tradedBase * npc.bidDiscount }))
        .sort((a, b) => b.bid - a.bid || a.npc.id.localeCompare(b.npc.id));
      for (const { npc, bid } of bids) {
        let capacity = npc.absorbPerTurn;
        const eligible = intents
          .filter((it) => it.remaining > 0 && bid >= it.limit - 1e-9)
          .sort((x, y) => x.limit - y.limit || x.seller.id.localeCompare(y.seller.id));
        for (const it of eligible) {
          if (capacity <= 0) break;
          const held = target.shareRegister[it.seller.id] ?? 0;
          const sold = Math.min(it.remaining, held, capacity);
          if (sold <= 0) continue;
          target.shareRegister[it.seller.id] = held - sold;
          target.shareRegister[npc.id] = (target.shareRegister[npc.id] ?? 0) + sold;
          this.credit(it.seller, sold * bid, "shareTrade", `Sold ${sold} ${target.name} shares @ ${bid.toFixed(0)}`);
          it.remaining -= sold;
          capacity -= sold;
        }
      }
    }

    // Control changes: any holder past the threshold acquires the charter.
    let acquisitions = 0;
    const threshold = this.config.tuning.acquisitionThreshold * this.config.tuning.sharesOutstanding;
    for (const target of this.corps) {
      if (!target.hasCharter) continue; // nothing to absorb from a charterless shell
      // Corps only: the Earthside float can hold shares but never takes control.
      const holder = this.largestHolder(target, null, true);
      if (!holder || holder === target.founderId) continue;
      if ((target.shareRegister[holder] ?? 0) <= threshold) continue;
      const acquirer = this.corps.find((c) => c.id === holder);
      if (!acquirer || acquirer.id === target.id) continue;
      this.transferTech(target, acquirer); // inherit 1–3 of the absorbed charter's techs (Section 28, Phase 3)
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

  /** The holder (other than `exclude`) owning the most of a corporation's shares.
   *  `corpsOnly` skips the Earthside float — used for control checks, where off-map
   *  investors must never mask (or stage) a takeover. */
  private largestHolder(target: Corporation, exclude: string | null, corpsOnly = false): string | undefined {
    let best: string | undefined;
    let bestShares = -1;
    for (const [holder, shares] of Object.entries(target.shareRegister)) {
      if (holder === exclude) continue;
      if (corpsOnly && !this.corps.some((c) => c.id === holder)) continue;
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
    // The target's Exchange warehouse empties into the acquirer's (ruleset v10) — what fits
    // is kept, the rest is consigned at the instant price. Storage levels don't transfer.
    for (const r of RESOURCES) {
      const qty = Math.floor(target.hubStockpile[r]);
      target.hubStockpile[r] = 0;
      if (qty <= 0) continue;
      const free = Math.max(0, this.warehouseCapacity(acquirer) - this.warehouseUsed(acquirer));
      const kept = Math.min(qty, Math.floor(free));
      acquirer.hubStockpile[r] += kept;
      const excess = qty - kept;
      if (excess > 0) {
        const quote = quoteInstant(this.config.tuning, this.market.prices[r], r, "sell", excess);
        this.market.prices[r] = quote.newPrice;
        this.credit(acquirer, quote.total, "convoyPayout", `${excess} ${r} absorbed warehouse overflow — consigned`);
      }
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
    // Freighter mass-fuel (Section 04/07b): bulk cargo burns fuel by mass × distance, but warp
    // lanes channel that mass cheaply (laneFuelFactor) — the headline reason lanes matter for
    // trade. Charged to the owner at launch, mirroring fleet movement fuel; convoys are lane-only
    // so every segment has a real route to score.
    const fuelCorp = this.corps.find((c) => c.id === owner);
    if (fuelCorp) {
      let fuel = 0;
      for (const rid of routeIds) {
        const route = this.galaxy.routes.get(rid);
        if (!route) continue;
        fuel += quantity * segmentDistance(this.galaxy, this.config.tuning, route) * this.config.tuning.fuelPerMassDistance * laneFuelFactor(this.config.tuning, route);
      }
      this.chargeFuel(fuelCorp, fuel, "fuelFreight", `${Math.round(quantity)} ${resource} freighter run`);
    }
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

  /**
   * Draw `amount` of fuel from a corp's stockpiles, auto-buying any shortfall at the exchange,
   * itemized in the ledger by what the fuel was FOR (upkeep vs fleet move vs freighter cargo).
   */
  private chargeFuel(corp: Corporation, amount: number, cause: "fuelUpkeep" | "fuelMove" | "fuelFreight", detail?: string): void {
    if (amount <= 0) return;
    let local = 0;
    for (const id of corp.ownedSystemIds) local += this.galaxy.system(id).stockpile.fuel;
    const short = Math.max(0, amount - local);
    this.consumeFromStockpiles(corp, "fuel", Math.min(amount, local));
    const bill = short * this.market.prices.fuel;
    // Preserves the original semantics: an unaffordable fuel bill is simply not charged.
    if (bill > 0 && corp.credits >= bill) {
      this.credit(corp, -bill, cause, detail ?? `bought ${Math.ceil(short)} fuel @ ${this.market.prices.fuel.toFixed(1)}`);
    }
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
        def += buildingTotal(sys, "miningRigs") * this.config.tuning.infrastructure.miningDefenseBonusPerLevel;
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

  /**
   * Move credits AND write the ledger line in one step (design rule #1: every credit that
   * moves appears as a ledger line with a cause). All credit mutations must flow through
   * here — tests/ledger.test.ts enforces Σledger == Δcredits per corp per turn.
   */
  private credit(corp: Corporation, delta: number, cause: LedgerCause, detail?: string, systemId?: string): void {
    if (delta === 0) return;
    corp.credits += delta;
    this.ledgerLines.push({ corpId: corp.id, delta, cause, ...(detail ? { detail } : {}), ...(systemId ? { systemId } : {}) });
  }

  /**
   * True if the corp holds at least `need` of a resource across its systems' stockpiles.
   * NO AUTO-PROCUREMENT (playtest decision): a build's materials must be on hand, or the
   * order does not happen — sourcing materials is the player's own logistics problem.
   */
  private hasStrategic(corp: Corporation, resource: Resource, need: number): boolean {
    if (need <= 0) return true;
    let local = 0;
    for (const id of corp.ownedSystemIds) local += this.galaxy.system(id).stockpile[resource];
    return local >= need;
  }

  /** Multi-resource availability check for build bills (Section 27). */
  private hasResources(corp: Corporation, costs: Partial<Record<Resource, number>>): boolean {
    return RESOURCES.every((r) => this.hasStrategic(corp, r, costs[r] ?? 0));
  }

  /** Scale a build's material bill by the charter's Lean-Manufacturing research (Section 28). */
  private scaleMats(corp: Corporation, costs: Partial<Record<Resource, number>>): Partial<Record<Resource, number>> {
    const mult = this.mods(corp).buildMaterialsMult;
    if (mult === 1) return costs;
    const out: Partial<Record<Resource, number>> = {};
    for (const [r, n] of Object.entries(costs)) out[r as Resource] = Math.round((n ?? 0) * mult);
    return out;
  }

  /** Consume a multi-resource build bill from local stockpiles, buying any shortfall (Section 27). */
  private consumeResources(corp: Corporation, costs: Partial<Record<Resource, number>>): void {
    for (const r of RESOURCES) this.consumeStrategic(corp, r, costs[r] ?? 0);
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
      wars: this.wars,
      rng: this.rng,
    };
  }

  private recordSnapshot(
    turn: number,
    orderCounts: Record<string, number>,
    launch?: { convoysLaunched: number; cargoValueShipped: number; routeTraffic: Record<string, number>; escortOrders?: number },
    raid?: { convoysRaided: number; cargoValueLost: number; largestSingleRaidLoss?: number; raidOutcomes: ReturnType<typeof emptyRaidOutcomes> },
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
      largestSingleRaidLoss: raid?.largestSingleRaidLoss ?? 0,
      escortOrders: launch?.escortOrders ?? 0,
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
