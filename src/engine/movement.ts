/**
 * Fleet movement planning + movement-fuel math (Section 04/07b).
 *
 * Shared by the engine (which *charges* movement fuel at launch) and the web client (which
 * *previews* it before you commit a move), so the number the player sees is byte-identical to
 * the one the engine will bill. Warp lanes are merely the fuel-efficient option: a fleet can jump
 * off-lane directly to any system in range, paying full mass × distance fuel, while lanes channel
 * that mass cheaply (more so on higher-capacity/stability lanes). Pure functions — no engine state.
 */
import type { Galaxy } from "./galaxy.js";
import type { Tuning } from "./config.js";
import type { RangeTier, Ship, WarpRoute } from "./types.js";

export interface FleetPlan {
  /** Ordered system ids from origin to destination. */
  path: string[];
  /** Route ids per segment; "" marks an off-lane (laneless) hop. */
  routeIds: string[];
  /** Turns each segment takes. */
  segmentTimes: number[];
  /** Fuel per unit of hull mass for the chosen route (multiply by fleet mass for the bill). */
  fuelPerMass: number;
  /** True if the chosen route is a direct off-lane jump. */
  offLane: boolean;
}

/** Atlas length of a lane segment, falling back to time × distancePerTurn for position-less maps. */
export function segmentDistance(galaxy: Galaxy, tuning: Tuning, route: WarpRoute): number {
  return galaxy.distanceBetween(route.a, route.b) ?? route.transitTime * tuning.distancePerTurn;
}

/**
 * Fraction of mass-fuel that survives travelling a lane: 1 for an off-lane jump (full cost), down
 * to (1 - laneFuelEfficiency) for a perfect lane. Better lanes (higher capacity/stability) channel
 * mass cheaper — the concrete reason lanes matter for bulk freight.
 */
export function laneFuelFactor(tuning: Tuning, route: WarpRoute): number {
  const capNorm = Math.min(1, route.capacity / Math.max(1, tuning.laneCapacityRef));
  const quality = Math.max(0, Math.min(1, (route.stability + capNorm) / 2));
  return 1 - tuning.laneFuelEfficiency * quality;
}

/** Total combat-hull mass of a fleet (a freighter's mass, by contrast, is its cargo quantity). */
export function fleetHullMass(tuning: Tuning, fleet: Ship[]): number {
  return fleet.reduce((sum, s) => sum + tuning.hullMass[s.rangeTier], 0);
}

/**
 * A fleet travels at its SLOWEST ship's speed (Section 04) — the minimum `shipSpeed` multiplier over
 * the fleet, mirroring how the weakest hull caps the fleet's off-lane range (`minTier`).
 */
export function fleetSpeed(tuning: Tuning, fleet: Ship[]): number {
  return fleet.reduce((m, s) => Math.min(m, tuning.shipSpeed[s.rangeTier]), Infinity);
}

/**
 * Plan a fleet move from→to for a fleet whose weakest hull is `minTier`. Compares the cheapest
 * charted lane against a single direct off-lane jump and returns the faster (tie → lane, which is
 * cheaper fuel). Off-lane is gated by hull range (maxOffLaneJumpDist) and needs atlas positions.
 * Null if there is no charted lane in range and the direct jump is out of range.
 */
export function planFleetMove(
  galaxy: Galaxy,
  tuning: Tuning,
  fromId: string,
  toId: string,
  minTier: RangeTier,
  fleetSpeedMult = 1,
): FleetPlan | null {
  const lane = galaxy.shortestWarpPath(fromId, toId, minTier);
  const laneOk = !!lane && lane.routes.length > 0;
  // Speed scales lane transit too (Section 04): a faster fleet crosses each segment in fewer turns;
  // a capital hull crawls. Per-segment so the comparison and the stored times stay consistent.
  const laneSegmentTimes = laneOk
    ? lane!.routes.map((rid) => Math.max(1, Math.round(galaxy.route(rid).transitTime / fleetSpeedMult)))
    : [];
  const laneTime = laneOk ? laneSegmentTimes.reduce((a, b) => a + b, 0) : Infinity;

  const directDist = galaxy.distanceBetween(fromId, toId);
  const canDirect = directDist !== null && directDist <= tuning.maxOffLaneJumpDist[minTier];
  const directTime = canDirect
    ? Math.max(1, Math.round(directDist! / (tuning.distancePerTurn * fleetSpeedMult)))
    : Infinity;

  let useDirect: boolean;
  if (laneOk && canDirect) useDirect = directTime < laneTime; // fleets prefer the faster route
  else if (laneOk) useDirect = false;
  else if (canDirect) useDirect = true;
  else return null;

  if (useDirect) {
    return {
      path: [fromId, toId],
      routeIds: [""],
      segmentTimes: [directTime],
      fuelPerMass: directDist! * tuning.fuelPerMassDistance, // laneFactor = 1 off-lane (full cost)
      offLane: true,
    };
  }
  let fuelPerMass = 0;
  for (const rid of lane!.routes) {
    const route = galaxy.route(rid);
    fuelPerMass += segmentDistance(galaxy, tuning, route) * tuning.fuelPerMassDistance * laneFuelFactor(tuning, route);
  }
  return { path: lane!.systems, routeIds: lane!.routes, segmentTimes: laneSegmentTimes, fuelPerMass, offLane: false };
}

/** Bottom-line preview for the UI (Section 04): total fuel + ETA for moving a system's idle fleet. */
export interface MovePreview {
  ok: boolean;
  fuel: number;
  eta: number;
  offLane: boolean;
}

/**
 * Resolve the single fuel figure + ETA the UI shows when staging a move — never the underlying
 * mass × distance × lane formula. `ships` is the moving corp's full ship list; the idle combat
 * ships stationed at `fromId` are the fleet that travels.
 */
export function previewFleetMove(
  galaxy: Galaxy,
  tuning: Tuning,
  fromId: string,
  toId: string,
  ships: Ship[],
): MovePreview {
  if (fromId === toId) return { ok: false, fuel: 0, eta: 0, offLane: false };
  const fleet = ships.filter((s) => s.combat > 0 && !s.transit && s.stationedAt === fromId);
  if (fleet.length === 0) return { ok: false, fuel: 0, eta: 0, offLane: false };
  const minTier = fleet.reduce((a, s) => (s.rangeTier < a ? s.rangeTier : a), fleet[0]!.rangeTier);
  const plan = planFleetMove(galaxy, tuning, fromId, toId, minTier, fleetSpeed(tuning, fleet));
  if (!plan) return { ok: false, fuel: 0, eta: 0, offLane: false };
  return {
    ok: true,
    fuel: fleetHullMass(tuning, fleet) * plan.fuelPerMass,
    eta: plan.segmentTimes.reduce((a, b) => a + b, 0),
    offLane: plan.offLane,
  };
}
