/**
 * Shared heuristics used by the bot archetypes.
 *
 * These are greedy, expected-value style helpers — enough varied behaviour to
 * exercise trade, expansion, and raiding so the economy can be measured. No ML.
 */
import { RESOURCES, type MarketOrder, type Order, type Resource, type System } from "../types.js";
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

/** Sell everything extractable beyond a small buffer, at the price floor so it fills. */
export function sellSurplus(view: PlayerView, buffer = 0): MarketOrder[] {
  const orders: MarketOrder[] = [];
  for (const sysId of view.me.ownedSystemIds) {
    const sys = view.galaxy.system(sysId);
    for (const r of EXPORT_RESOURCES) {
      const qty = sys.stockpile[r] - buffer;
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

/** Research Range 2 once the corp has spare cash and hasn't yet (Section 04). */
export function maybeResearchRange2(view: PlayerView): Order[] {
  if (view.me.rangeTier >= 2) return [];
  const cost = view.config.tuning.rangeResearchCost[2];
  if (view.turn >= 5 && view.me.credits > cost * 1.6) {
    return [{ kind: "researchRange", targetTier: 2 }];
  }
  return [];
}

/** Gross per-turn export value of a system priced at base. */
function grossYieldValue(view: PlayerView, sys: System): number {
  return RESOURCES.reduce((s, r) => s + sys.yields[r] * view.config.tuning.basePrices[r], 0);
}

/** Claim the best unclaimed inner-ring system if affordable (second/third claim). */
export function maybeExpand(view: PlayerView): Order[] {
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
    if (reachable && view.me.credits > sys.claimCost + 600) {
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

/** Escort the busiest owned export system if the corp has defensive ships. */
export function maybeEscort(view: PlayerView): Order[] {
  const capacity = view.me.ships
    .filter((s) => !s.raider)
    .reduce((s, sh) => s + sh.combat, 0);
  if (capacity <= 0 || view.me.ownedSystemIds.length === 0) return [];
  const sysId = view.me.ownedSystemIds[0]!;
  return [{ kind: "escort", systemId: sysId, strength: capacity }];
}
