/**
 * Galaxy construction and warp-route pathfinding (Section 04).
 *
 * The galaxy is a graph of systems connected by warp routes. Convoys move along
 * the cheapest reachable path; ships are limited by their range tier and routes
 * must be charted. The Wormhole Hub is a special protected node.
 */
import { normaliseYields, type GameConfig } from "./config.js";
import { emptyStockpile, type RangeTier, type System, type WarpRoute } from "./types.js";

export class Galaxy {
  readonly systems = new Map<string, System>();
  readonly routes = new Map<string, WarpRoute>();
  readonly hubId: string;
  /** Adjacency: system id -> list of { routeId, otherSystemId }. */
  private adj = new Map<string, { routeId: string; to: string }[]>();

  constructor(config: GameConfig) {
    this.hubId = config.scenario.hubId;

    for (const s of config.scenario.systems) {
      this.systems.set(s.id, {
        id: s.id,
        name: s.name,
        yields: normaliseYields(s.yields),
        claimCost: s.claimCost,
        upkeep: s.upkeep,
        populationStage: s.populationStage ?? "outpost",
        defense: s.defense ?? 1,
        routeIds: [],
        owner: null,
        stockpile: emptyStockpile(),
        innerRing: s.innerRing ?? false,
      });
      this.adj.set(s.id, []);
    }

    let routeCounter = 0;
    for (const r of config.scenario.routes) {
      const id = `route-${routeCounter++}`;
      const route: WarpRoute = {
        id,
        a: r.a,
        b: r.b,
        transitTime: r.transitTime,
        stability: r.stability,
        capacity: r.capacity,
        exposure: r.exposure,
        authorityPresence: r.authorityPresence,
        requiredRange: r.requiredRange ?? 1,
        charted: r.charted ?? false,
        trafficHistory: [],
      };
      this.routes.set(id, route);
      this.systems.get(r.a)?.routeIds.push(id);
      this.systems.get(r.b)?.routeIds.push(id);
      this.adj.get(r.a)?.push({ routeId: id, to: r.b });
      this.adj.get(r.b)?.push({ routeId: id, to: r.a });
    }
  }

  system(id: string): System {
    const s = this.systems.get(id);
    if (!s) throw new Error(`Unknown system ${id}`);
    return s;
  }

  route(id: string): WarpRoute {
    const r = this.routes.get(id);
    if (!r) throw new Error(`Unknown route ${id}`);
    return r;
  }

  /** The route directly connecting two systems, if any. */
  routeBetween(a: string, b: string): WarpRoute | undefined {
    for (const e of this.adj.get(a) ?? []) {
      if (e.to === b) return this.routes.get(e.routeId);
    }
    return undefined;
  }

  /** Effective traversal cost of a route segment (transit weighted by instability). */
  private routeWeight(r: WarpRoute): number {
    const stabilityModifier = 1 + (1 - r.stability) * 0.5;
    return r.transitTime * stabilityModifier;
  }

  /**
   * Cheapest warp path from origin to destination, restricted to charted routes
   * within the given range tier. Returns the ordered system ids and the route ids
   * used, or null if unreachable. Dijkstra over route weights (Section 04).
   */
  shortestWarpPath(
    origin: string,
    destination: string,
    rangeTier: RangeTier,
  ): { systems: string[]; routes: string[]; transitTime: number } | null {
    if (origin === destination) {
      return { systems: [origin], routes: [], transitTime: 0 };
    }
    const dist = new Map<string, number>();
    const prev = new Map<string, { from: string; routeId: string }>();
    const visited = new Set<string>();
    dist.set(origin, 0);

    // Small graphs: linear-scan priority selection is plenty fast and deterministic.
    while (true) {
      let current: string | null = null;
      let best = Infinity;
      for (const [node, d] of dist) {
        if (!visited.has(node) && d < best) {
          best = d;
          current = node;
        }
      }
      if (current === null) break;
      if (current === destination) break;
      visited.add(current);

      for (const e of this.adj.get(current) ?? []) {
        const route = this.routes.get(e.routeId)!;
        if (!route.charted) continue;
        if (route.requiredRange > rangeTier) continue;
        const nd = best + this.routeWeight(route);
        if (nd < (dist.get(e.to) ?? Infinity)) {
          dist.set(e.to, nd);
          prev.set(e.to, { from: current, routeId: e.routeId });
        }
      }
    }

    if (!prev.has(destination) && origin !== destination) {
      if (!dist.has(destination)) return null;
    }
    if (dist.get(destination) === undefined) return null;

    // Reconstruct path.
    const systems: string[] = [];
    const routes: string[] = [];
    let node = destination;
    while (node !== origin) {
      const step = prev.get(node);
      if (!step) return null;
      systems.unshift(node);
      routes.unshift(step.routeId);
      node = step.from;
    }
    systems.unshift(origin);

    const transitTime = routes.reduce(
      (sum, id) => sum + this.routes.get(id)!.transitTime,
      0,
    );
    return { systems, routes, transitTime };
  }

  /** Record one convoy of traffic on a route for the current turn's history bucket. */
  recordTraffic(routeId: string, turn: number): void {
    const r = this.routes.get(routeId);
    if (!r) return;
    while (r.trafficHistory.length <= turn) r.trafficHistory.push(0);
    r.trafficHistory[turn] = (r.trafficHistory[turn] ?? 0) + 1;
  }

  /** Total convoys seen on a route over the last `window` turns up to `turn`. */
  recentTraffic(routeId: string, turn: number, window = 5): number {
    const r = this.routes.get(routeId);
    if (!r) return 0;
    let total = 0;
    for (let t = Math.max(0, turn - window + 1); t <= turn; t++) {
      total += r.trafficHistory[t] ?? 0;
    }
    return total;
  }

  allSystems(): System[] {
    return [...this.systems.values()];
  }

  innerRingSystems(): System[] {
    return this.allSystems().filter((s) => s.innerRing);
  }
}
