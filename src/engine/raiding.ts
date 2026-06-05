/**
 * Warp-route convoy raiding (Sections 13–16).
 *
 * Two actions: interdict a route (predictive trap for convoys launched or passing
 * next tick, including 1-turn routes) and target a specific in-transit convoy.
 * Eligibility requires a raider force with access to the route. Outcomes are rolled
 * against exposure, authority presence, defense, and escort. The balance rule
 * (Section 13) is that raids usually delay/damage/partially loot rather than erase.
 */
import type { Galaxy } from "./galaxy.js";
import type { Rng } from "./rng.js";
import type { Convoy, Corporation, WarpRoute } from "./types.js";

export type RaidOutcome =
  | "noContact"
  | "shadowed"
  | "harassed"
  | "damaged"
  | "plundered"
  | "repelled"
  | "ambushed";

export interface RaidResult {
  convoyId: string;
  attackerId: string;
  outcome: RaidOutcome;
  /** Cargo destroyed (units). */
  cargoDestroyed: number;
  /** Cargo stolen and credited to attacker (units). */
  cargoPlundered: number;
  /** Extra transit turns added by harassment. */
  delayAdded: number;
  /** Combat strength lost by the raider (repelled/ambushed). */
  raiderLosses: number;
}

/**
 * Whether a corporation can reach a route to raid it (Section 13 eligibility).
 *
 * A raid strikes the route's *vulnerable* (non-hub) endpoints. The attacker is
 * eligible if it can stage a raider force at, or one hop from, such an endpoint —
 * via owned systems with raider ships, or via a privateer's base.
 */
export function canRaidRoute(
  galaxy: Galaxy,
  corp: Corporation,
  route: WarpRoute,
): boolean {
  const vulnerable = [route.a, route.b].filter((id) => id !== galaxy.hubId);
  if (vulnerable.length === 0) return false; // fully inside protected hub space

  // Systems from which this corp can launch a raid.
  const bases: string[] = [];
  if (corp.ships.some((s) => s.raider)) bases.push(...corp.ownedSystemIds);
  for (const p of corp.privateers) {
    if (p.turnsLeft > 0) bases.push(p.basedAt);
  }
  if (bases.length === 0) return false;

  for (const base of bases) {
    for (const ep of vulnerable) {
      if (base === ep || areAdjacent(galaxy, base, ep)) return true;
    }
  }
  return false;
}

/** True if two systems are directly connected by a warp route. */
function areAdjacent(galaxy: Galaxy, a: string, b: string): boolean {
  return galaxy.routeBetween(a, b) !== undefined;
}

/** Combined raid strength a corporation can bring to bear on a route. */
export function raidStrength(corp: Corporation): number {
  const shipStrength = corp.ships
    .filter((s) => s.raider)
    .reduce((sum, s) => sum + s.combat, 0);
  const privStrength = corp.privateers
    .filter((p) => p.turnsLeft > 0)
    .reduce((sum, p) => sum + p.strength, 0);
  return shipStrength + privStrength;
}

/**
 * Resolve a single raid attempt against a convoy on a given route.
 * `attackStrength` is the raider force; `routeExposure` and `authority` shape the
 * odds; the convoy's escort and the destination/origin defense resist it.
 */
export function resolveRaid(
  rng: Rng,
  convoy: Convoy,
  route: WarpRoute,
  attackerId: string,
  attackStrength: number,
  localDefense: number,
): RaidResult {
  const base: RaidResult = {
    convoyId: convoy.id,
    attackerId,
    outcome: "noContact",
    cargoDestroyed: 0,
    cargoPlundered: 0,
    delayAdded: 0,
    raiderLosses: 0,
  };

  // Defense = convoy escort + local system defense; offense = raider strength
  // scaled by route exposure (easy to intercept) and reduced by Authority presence.
  const defense = convoy.escort + localDefense;
  const exposureFactor = 0.5 + route.exposure; // 0.5..1.5
  const authorityPenalty = 1 - route.authorityPresence * 0.5;
  const offense = attackStrength * exposureFactor * authorityPenalty;

  // Contact chance rises with exposure; some raids simply find nothing.
  if (!rng.chance(0.35 + route.exposure * 0.5)) {
    return base; // noContact
  }

  const ratio = offense / Math.max(1, offense + defense); // 0..1, raider advantage
  const roll = rng.next();

  // Strong defense can turn the raid around.
  if (defense > offense * 1.4) {
    if (roll < 0.4) {
      return { ...base, outcome: "ambushed", raiderLosses: Math.ceil(attackStrength * 0.5) };
    }
    if (roll < 0.75) {
      return { ...base, outcome: "repelled", raiderLosses: Math.ceil(attackStrength * 0.25) };
    }
    return { ...base, outcome: "shadowed" };
  }

  // Outcome bands scale with raider advantage. When a raid does land it more often
  // plunders (raider keeps the cargo) than destroys, so raiding is a viable living and
  // not just sabotage — but most contacts only shadow or delay, so the cargo lost across
  // all trade stays a moderate tax, not a wipeout.
  if (roll < 0.18 - ratio * 0.1) {
    return { ...base, outcome: "shadowed" };
  }
  if (roll < 0.55 - ratio * 0.2) {
    return { ...base, outcome: "harassed", delayAdded: 1 };
  }
  if (roll < 0.75 - ratio * 0.1) {
    const destroyed = Math.max(1, Math.round(convoy.quantity * (0.15 + ratio * 0.25)));
    return { ...base, outcome: "damaged", cargoDestroyed: Math.min(convoy.quantity, destroyed) };
  }
  // Plundered: steal a portion, delivered to the raider.
  const plundered = Math.max(1, Math.round(convoy.quantity * (0.3 + ratio * 0.4)));
  return {
    ...base,
    outcome: "plundered",
    cargoPlundered: Math.min(convoy.quantity, plundered),
  };
}
