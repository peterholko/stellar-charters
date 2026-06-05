/**
 * Shared heuristics used by the bot archetypes.
 *
 * These are greedy, expected-value style helpers — enough varied behaviour to
 * exercise trade, expansion, and raiding so the economy can be measured. No ML.
 */
import { RESOURCES, type MarketOrder, type Order, type RangeTier, type Resource, type System } from "../types.js";
import type { PlayerView } from "./bot.js";

/** Resources a corporation exports. Outpost-stage systems consume no food, so a
 *  garden world's food is sold to the exchange like any other commodity. */
const EXPORT_RESOURCES: readonly Resource[] = ["ice", "metals", "helium3", "rareIsotopes", "food"];

/** Rough commercial value of a system: per-turn yield priced at base, minus claim cost. */
export function valueSystem(view: PlayerView, sys: System): number {
  const yieldValue = RESOURCES.reduce(
    (s, r) => s + sys.yields[r] * view.config.tuning.basePrices[r],
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
  const orders: MarketOrder[] = [];
  for (const sysId of view.me.ownedSystemIds) {
    const sys = view.galaxy.system(sysId);
    for (const r of EXPORT_RESOURCES) {
      // Keep two turns of life-support food/ice locally so we don't sell then re-import.
      let reserve = buffer;
      if (r === "food") reserve = Math.max(buffer, t.foodNeed[sys.populationStage] * 2);
      if (r === "ice") {
        reserve = Math.max(buffer, t.iceNeed[sys.populationStage] * 2 + sys.hydroponics * t.hydroponicsIceUse * 2);
      }
      // Keep a few rare isotopes back to build higher-tier warships once Range 2+,
      // but still sell the surplus (frontier income funds those hulls).
      if (r === "rareIsotopes" && view.me.rangeTier >= 2) reserve = Math.max(buffer, 4);
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
    if (sys.hydroponics >= 4) continue; // cap modules per system
    const need = view.config.tuning.foodNeed[sys.populationStage];
    const localFood = sys.yields.food + sys.hydroponics * view.config.tuning.hydroponicsFoodOutput;
    // A colony that can't feed itself locally — local food is what unlocks growth now.
    if (need > 0 && localFood < need) {
      return [{ kind: "buildHydroponics", systemId: id }];
    }
  }
  return [];
}

/** Mutable per-bot memory so a financier locks onto one acquisition target. */
export interface BotState {
  acqTarget?: string;
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
  const cost = remaining * price;
  if (cost > view.me.credits && view.me.valuation > 0) {
    orders.push({ kind: "borrow", amount: Math.ceil(cost - view.me.credits) });
  }
  orders.push({ kind: "buyShares", targetId: target.id, shares: remaining });
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
  // Merchant/privateer income: haunt the busiest lane.
  orders.push(...planRaid(view, { fundFactor: 1.1 }));
  // Comeback: buy toward control of a locked target charter when flush.
  const target = lockTarget(view, state);
  if (target && view.me.credits > target.sharePrice * 5) {
    const held = target.shareRegister[view.me.id] ?? 0;
    const goal = Math.ceil(view.config.tuning.acquisitionThreshold * target.sharesOutstanding) + 1;
    const want = Math.min(
      goal - held,
      Math.floor((view.me.credits * 0.6) / Math.max(0.01, target.sharePrice)),
    );
    if (want > 0) orders.push({ kind: "buyShares", targetId: target.id, shares: want });
  }
  return orders;
}

/** Earliest turn a corp will reach for each range tier (keeps fleets advancing). */
const RANGE_MIN_TURN: Record<number, number> = { 2: 7, 3: 16, 4: 26 };

/**
 * Climb the range-tech ladder one tier at a time (Section 04). Reaching Range 2 opens
 * the frontier; Range 3/4 unlock progressively stronger hulls so fleets don't stall.
 */
export function maybeResearchRange(view: PlayerView): Order[] {
  const next = (view.me.rangeTier + 1) as RangeTier;
  if (next > 4) return [];
  const cost = view.config.tuning.rangeResearchCost[next];
  const minTurn = RANGE_MIN_TURN[next] ?? 99;
  if (view.turn >= minTurn && view.me.credits > cost * 1.3) {
    return [{ kind: "researchRange", targetTier: next }];
  }
  return [];
}

/** Gross per-turn export value of a system priced at base. */
function grossYieldValue(view: PlayerView, sys: System): number {
  return RESOURCES.reduce((s, r) => s + sys.yields[r] * view.config.tuning.basePrices[r], 0);
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

/**
 * Push toward the frontier once Range 2 is available (Section 04 / Section 19 turn 8+):
 * chart an uncharted deep tunnel off an owned system, then claim the rare-isotope
 * system beyond it. This brings high-value cargo onto exposed routes — the prime
 * raiding target the design wants to test.
 */
export function maybeFrontier(view: PlayerView): Order[] {
  if (view.me.rangeTier < 2) return [];
  const orders: Order[] = [];

  // 1) Claim a reachable, already-charted frontier system we can afford.
  for (const sys of view.galaxy.allSystems()) {
    if (sys.owner !== null || sys.innerRing || sys.id === view.galaxy.hubId) continue;
    const reachable = sys.routeIds.some((rid) => {
      const r = view.galaxy.routes.get(rid);
      if (!r || !r.charted) return false;
      const anchor = r.a === sys.id ? r.b : r.a;
      return view.me.ownedSystemIds.includes(anchor);
    });
    if (reachable && view.me.credits > sys.claimCost + 200) {
      orders.push({ kind: "claim", systemId: sys.id, amount: sys.claimCost });
      return orders;
    }
  }

  // 2) Otherwise chart a deep tunnel hanging off one of our systems.
  for (const sysId of view.me.ownedSystemIds) {
    const sys = view.galaxy.system(sysId);
    for (const rid of sys.routeIds) {
      const r = view.galaxy.routes.get(rid);
      if (r && !r.charted && view.me.credits > view.config.tuning.surveyCost + 500) {
        orders.push({ kind: "survey", routeId: r.id });
        return orders;
      }
    }
  }
  return orders;
}

/**
 * Plan a raid on the busiest exposed warp lane (Sections 13–14).
 *
 * Privateers can haunt any tunnel, so the raider bases one at the lane's vulnerable
 * (non-hub) mouth and issues an interdiction there. The hire and interdict are
 * submitted together: the engine processes the hire (administrative step) before it
 * resolves raids, so the freshly-contracted privateer is eligible the same turn.
 */
export function planRaid(
  view: PlayerView,
  opts: { minTraffic?: number; fundFactor?: number } = {},
): Order[] {
  const minTraffic = opts.minTraffic ?? 1;
  const fundFactor = opts.fundFactor ?? 1.5;

  let best: { routeId: string; mouth: string; traffic: number } | undefined;
  for (const route of view.galaxy.routes.values()) {
    const mouth = route.a === view.galaxy.hubId ? route.b : route.a;
    if (mouth === view.galaxy.hubId) continue; // wholly inside protected space
    const traffic = view.galaxy.recentTraffic(route.id, view.turn - 1);
    if (traffic < minTraffic) continue;
    if (!best || traffic > best.traffic) best = { routeId: route.id, mouth, traffic };
  }
  if (!best) return [];

  const orders: Order[] = [];
  const haveLivePrivateer = view.me.privateers.some(
    (p) => p.basedAt === best!.mouth && p.turnsLeft > 0,
  );
  const haveAdjacentRaiderShip =
    view.me.ships.some((s) => s.raider) &&
    view.me.ownedSystemIds.some(
      (o) => o === best!.mouth || view.galaxy.routeBetween(o, best!.mouth) !== undefined,
    );
  if (
    !haveLivePrivateer &&
    !haveAdjacentRaiderShip &&
    view.me.credits > view.config.tuning.privateerCost * fundFactor
  ) {
    orders.push({ kind: "hirePrivateer", basedAt: best.mouth });
  }
  orders.push({ kind: "interdict", routeId: best.routeId });
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
    .map((s) => ({ sys: s, want: s.yields.rareIsotopes > 0 ? 2 : 1 }))
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
        desired: s.yields.rareIsotopes > 0 ? 3 : 2,
      };
    })
    .filter((e) => e.value > 0 && (e.count < e.desired || e.bestTier < tier))
    .sort((a, b) => b.value - a.value);

  const target = ranked[0];
  if (!target) return [];
  return [{ kind: "buildShip", rangeTier: tier, raider: false, systemId: target.sys.id }];
}
