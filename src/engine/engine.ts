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
import { RESOURCES, type Convoy, type Corporation, type Order, type Resource } from "./types.js";
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
      const corp: Corporation = {
        id: `corp-${i}`,
        name: `Corp ${i + 1}`,
        credits: config.tuning.startingCredits,
        debt: 0,
        ownedSystemIds: [],
        ships: [{ rangeTier: 1, combat: 0, raider: false }],
        privateers: [],
        rangeTier: 1,
        valuation: 0,
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

    // 1. Lock: collect orders from every bot.
    const ordersByCorp = new Map<string, Order[]>();
    const orderCounts: Record<string, number> = {};
    for (const corp of this.corps) {
      const bot = this.bots.get(corp.id)!;
      const orders = bot.decide(this.viewFor(corp));
      ordersByCorp.set(corp.id, orders);
      orderCounts[corp.id] = orders.length;
    }

    // 1.5 Administrative builds (claims, surveys, ships, research, privateers).
    this.resolveAdministrative(ordersByCorp);

    // 2. Production into local stockpiles.
    this.resolveProduction();

    // 3. Market clearing + 4. convoy launch.
    const launchInfo = this.resolveMarketAndLaunch(ordersByCorp);

    // 5. Route interdiction (predictive) + 6. targeted raids.
    const raidStats = this.resolveRaids(ordersByCorp);

    // 7. Arrivals & settlements.
    this.resolveArrivals();

    // 8. Upkeep, food, debt.
    this.resolveUpkeep();

    // 9. Valuation.
    this.updateValuations();

    // 10. Report.
    this.recordSnapshot(this.turn, orderCounts, launchInfo, raidStats);
  }

  private resolveAdministrative(ordersByCorp: Map<string, Order[]>): void {
    for (const corp of this.corps) {
      for (const order of ordersByCorp.get(corp.id) ?? []) {
        switch (order.kind) {
          case "claim": {
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
          default:
            break;
        }
      }
    }
  }

  private resolveProduction(): void {
    for (const sys of this.galaxy.allSystems()) {
      if (sys.owner === null) continue;
      if ((this.claimedTurn.get(sys.id) ?? 0) >= this.turn) continue; // claimed this turn
      for (const r of RESOURCES) {
        sys.stockpile[r] += sys.yields[r];
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
        const unitCost = price + this.config.tuning.shippingFeePerHop * hops;
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
        const shipping = this.config.tuning.shippingFeePerHop * hops * qty;
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
        convoy.segmentTurnsLeft = nextRoute ? nextRoute.transitTime : 1;
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

  private resolveUpkeep(): void {
    for (const corp of this.corps) {
      for (const sysId of corp.ownedSystemIds) {
        const sys = this.galaxy.system(sysId);
        corp.credits -= sys.upkeep;
        const need = this.config.tuning.foodNeed[sys.populationStage];
        if (need > 0) {
          sys.stockpile.food = Math.max(0, sys.stockpile.food - need);
        }
      }
      if (corp.debt > 0) corp.debt *= 1 + this.config.tuning.debtInterest;
      // Decrement privateer contracts.
      for (const p of corp.privateers) p.turnsLeft -= 1;
      corp.privateers = corp.privateers.filter((p) => p.turnsLeft > 0);
    }
  }

  private updateValuations(): void {
    const v = this.config.tuning.valuation;
    for (const corp of this.corps) {
      let value = corp.credits - corp.debt;
      value += corp.ships.length * v.shipValue;
      for (const sysId of corp.ownedSystemIds) {
        const sys = this.galaxy.system(sysId);
        const yieldTotal = RESOURCES.reduce((s, r) => s + sys.yields[r], 0);
        value += yieldTotal * v.perSystemYieldValue;
        value += v.populationValue[sys.populationStage];
        for (const r of RESOURCES) {
          value += sys.stockpile[r] * this.config.tuning.basePrices[r] * v.stockpileFrac;
        }
      }
      corp.valuation = Math.round(value);
    }
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
      segmentTurnsLeft: firstRoute ? firstRoute.transitTime : 1,
      launchedTurn: this.turn,
      payout,
      escort,
      value,
    };
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
      if (sys && sys.owner === convoy.owner) def += sys.defense;
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
    };
    this.metrics.snapshots.push(snapshot);
  }
}
