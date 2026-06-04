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
import { resolveAuction } from "./auction.js";
import type { GameConfig } from "./config.js";
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
  type Order,
  type PopulationStage,
  type Resource,
} from "./types.js";
import type { Bot, BotFactory, PlayerView } from "./bots/bot.js";

export interface EngineOptions {
  /** Optional per-turn text logger for `--verbose` single-game runs. */
  log?: (line: string) => void;
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
  private readonly claimedTurn = new Map<string, number>();
  private turn = 0;
  private readonly log: (line: string) => void;

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
        ships: [{ rangeTier: 1, combat: 0, raider: false }],
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
      finalStageCounts: { outpost: 0, settlement: 0, colony: 0, city: 0, metropolis: 0 },
    };
  }

  /** Run the whole game and return collected metrics. */
  run(): GameMetrics {
    this.turn = 1;
    this.runAuctionTurn();
    for (this.turn = 2; this.turn <= this.config.turns; this.turn++) {
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

  // ----- Opening auction (Section 05) -----

  private runAuctionTurn(): void {
    this.log(`\n=== Turn 1 — Inner Ring Claim Auction ===`);
    const bids = new Map<string, ReturnType<Bot["bid"]>>();
    let fallbackUsers = 0;
    for (const corp of this.corps) {
      const bot = this.bots.get(corp.id)!;
      const order = bot.bid(this.viewFor(corp));
      bids.set(corp.id, order);
      if (order.priorities.length > 1) fallbackUsers++;
    }

    const result = resolveAuction(this.config, this.corps, bids);
    const refundFrac = this.config.tuning.bidRefundFrac;
    let totalDeposits = 0;
    let totalRefunded = 0;

    for (const corp of this.corps) {
      const order = bids.get(corp.id)!;
      const wonSystem = result.awarded.get(corp.id);
      const spent = result.spent.get(corp.id) ?? 0;

      // Fallback bidding is encouraged (Section 05), so it must not be punished:
      // a player pays only its winning bid. A player who wins nothing forfeits just
      // the non-refunded fraction of its top deposit (90–95% returned).
      const topBid = order.priorities[0]?.amount ?? 0;
      if (wonSystem) {
        corp.credits -= spent;
        totalDeposits += topBid;
        totalRefunded += topBid; // deposit fully returned to a winner
      } else {
        const forfeit = topBid * (1 - refundFrac);
        corp.credits -= forfeit;
        totalDeposits += topBid;
        totalRefunded += topBid - forfeit;
      }

      if (wonSystem) {
        const sys = this.galaxy.system(wonSystem);
        sys.owner = corp.id;
        corp.ownedSystemIds.push(wonSystem);
        corp.hasCharter = true;
        this.claimedTurn.set(wonSystem, 1);
        this.log(
          `  ${corp.name} (${corp.botId}) wins ${sys.name} for ${spent} cr`,
        );
      } else {
        this.log(`  ${corp.name} (${corp.botId}) won nothing`);
      }
    }

    this.metrics.auctionRefundFrac =
      totalDeposits > 0 ? totalRefunded / totalDeposits : 1;
    this.metrics.auctionFallbackUsage = fallbackUsers / this.corps.length;
    this.recordSnapshot(0, {});
  }

  // ----- Normal turn -----

  private runNormalTurn(): void {
    this.log(`\n=== Turn ${this.turn} ===`);
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
            this.claimedTurn.set(sys.id, this.turn);
            if (
              corp.ownedSystemIds.length === 2 &&
              this.metrics.secondClaimTurn[corp.id] === -1
            ) {
              this.metrics.secondClaimTurn[corp.id] = this.turn;
            }
            this.log(`  ${corp.name} claims ${sys.name} for ${order.amount} cr`);
            break;
          }
          case "survey": {
            const route = this.galaxy.routes.get(order.routeId);
            if (!route || route.charted) break;
            if (corp.credits < this.config.tuning.surveyCost) break;
            corp.credits -= this.config.tuning.surveyCost;
            route.charted = true;
            this.log(`  ${corp.name} charts route ${route.id}`);
            break;
          }
          case "buildShip": {
            const cost =
              this.config.tuning.shipCost[order.rangeTier] +
              (order.raider ? this.config.tuning.raiderShipExtraCost : 0);
            if (corp.credits < cost) break;
            if (order.rangeTier > corp.rangeTier) break;
            corp.credits -= cost;
            corp.ships.push({
              rangeTier: order.rangeTier,
              combat: order.raider ? 3 : 1,
              raider: order.raider,
            });
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
            this.log(`  ${corp.name} hires a privateer at ${order.basedAt}`);
            break;
          }
          case "buildDepot": {
            // Trade Depots are colonial infrastructure (Section 12); not for Free Operators.
            if (corp.isFreeOperator) break;
            const sys = this.galaxy.systems.get(order.systemId);
            if (!sys || sys.owner !== corp.id || sys.hasDepot) break;
            if (corp.credits < this.config.tuning.depotCost) break;
            corp.credits -= this.config.tuning.depotCost;
            sys.hasDepot = true;
            this.metrics.depotsBuilt += 1;
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
            this.log(`  ${corp.name} builds hydroponics at ${sys.name}`);
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
      for (const r of RESOURCES) {
        sys.stockpile[r] += sys.yields[r] * efficiency;
      }
      // Hydroponics convert ice into food (Section 08), within available ice.
      if (sys.hydroponics > 0) {
        const iceWanted = sys.hydroponics * t.hydroponicsIceUse;
        const iceUsed = Math.min(iceWanted, sys.stockpile.ice);
        sys.stockpile.ice -= iceUsed;
        const ratio = iceWanted > 0 ? iceUsed / iceWanted : 0;
        sys.stockpile.food += sys.hydroponics * t.hydroponicsFoodOutput * ratio;
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
        const escort = Math.min(
          escortBySystem.get(`${corp.id}:${sys.id}`) ?? 0,
          this.escortCapacity(corp),
        );
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
        const escort = Math.min(
          escortBySystem.get(`${corp.id}:${from.id}`) ?? 0,
          this.escortCapacity(corp),
        );
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

    const applyResult = (result: RaidResult, convoy: Convoy, attacker: Corporation) => {
      outcomes[result.outcome]++;
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
        // Fence stolen goods at a discount.
        attacker.credits += result.cargoPlundered * unitValue * 0.5;
      }
      if (result.raiderLosses > 0) this.applyRaiderLosses(attacker, result.raiderLosses);
    };

    // 5. Predictive interdiction: hits convoys whose current segment matches the route.
    for (const corp of this.corps) {
      for (const order of ordersByCorp.get(corp.id) ?? []) {
        if (order.kind !== "interdict") continue;
        const route = this.galaxy.routes.get(order.routeId);
        if (!route) continue;
        if (!canRaidRoute(this.galaxy, corp, route)) continue;
        const targets = this.convoys
          .filter(
            (c) =>
              c.owner !== corp.id &&
              !raided.has(c.id) &&
              c.quantity > 0 &&
              this.convoyCurrentRoute(c) === route.id,
          )
          .sort((a, b) => b.value - a.value);
        const target = targets[0];
        if (!target) {
          outcomes.noContact++;
          continue;
        }
        raided.add(target.id);
        const localDefense = this.localDefenseFor(target);
        const result = resolveRaid(
          this.rng,
          target,
          route,
          corp.id,
          raidStrength(corp),
          localDefense,
        );
        applyResult(result, target, corp);
        this.log(
          `  raid: ${corp.name} interdicts ${route.id} → ${result.outcome}` +
            (result.cargoPlundered ? ` (+${result.cargoPlundered} ${target.resource})` : ""),
        );
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
        applyResult(result, target, corp);
      }
    }

    // Drop fully destroyed/looted convoys.
    this.convoys = this.convoys.filter((c) => c.quantity > 0);
    return { convoysRaided, cargoValueLost, raidOutcomes: outcomes };
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
        corp.credits -= sys.upkeep;

        // Life support (ice) and food demand scale with population (Section 08).
        const foodNeed = t.foodNeed[sys.populationStage];
        const iceNeed = t.iceNeed[sys.populationStage];
        const food = this.consumeOrImport(corp, sys, "food", foodNeed);
        const ice = this.consumeOrImport(corp, sys, "ice", iceNeed);
        const fed = food.met && ice.met;
        // Growth requires LOCAL food (garden/hydroponics/transfer), not emergency
        // imports: imports keep a colony alive but only local supply lets it thrive.
        const thriving = fed && food.local;

        // Tax: a fed, content population pays its charter holder (Sections 08/17).
        if (fed) {
          const tax = t.taxPerStage[sys.populationStage] * (1 - sys.unrest);
          corp.credits += tax;
          taxLevied += tax;
        }

        // Growth vs. unrest (Section 08 food/population loop).
        if (fed) sys.unrest = Math.max(0, sys.unrest - t.unrestRecoveryPerFedTurn);
        else sys.unrest = Math.min(1, sys.unrest + t.unrestPerStarvedTurn);

        if (thriving) {
          sys.populationProgress += t.growthRate[sys.populationStage];
          const idx = stages.indexOf(sys.populationStage);
          if (sys.populationProgress >= t.growthThreshold && idx < stages.length - 1) {
            sys.populationStage = stages[idx + 1]!;
            sys.populationProgress = 0;
            this.log(`  ${sys.name} grows to ${sys.populationStage}`);
          }
        } else if (!fed) {
          sys.populationProgress = Math.max(0, sys.populationProgress - 20);
        }
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
        const yieldTotal = RESOURCES.reduce((s, r) => s + sys.yields[r], 0);
        value += yieldTotal * v.perSystemYieldValue;
        value += v.populationValue[sys.populationStage] * (1 - sys.unrest);
        if (sys.hasDepot) value += v.depotValue;
        value += sys.hydroponics * (v.depotValue * 0.25);
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
      corp.hasCharter = false;
      corp.isFreeOperator = true;
      this.metrics.distressLiquidations += 1;
      distress += 1;
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
    target.hasCharter = false;
    target.isFreeOperator = true;
    // A Free Operator that takes control of a charter re-enters charter play (Section 18).
    acquirer.hasCharter = true;
    acquirer.isFreeOperator = false;
    this.metrics.acquisitionsTotal += 1;
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

  private escortCapacity(corp: Corporation): number {
    return corp.ships.filter((s) => !s.raider).reduce((s, sh) => s + sh.combat, 0);
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
        // Depot patrols harden connected tunnels against raiders (Section 12).
        if (sys.hasDepot) def += this.config.tuning.depotDefenseBonus;
      }
    }
    return def;
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
