/**
 * Procedural galaxy generation (the "procedural-atlas-v1" scenario).
 *
 * Each match seed grows its own galaxy: a protected Wormhole Hub at the centre, a band of
 * charted core systems (the start/auction worlds), a ring of uncharted rare-isotope frontier
 * systems, and a sparse outer shell of uncharted antimatter abyss systems. Systems are laid
 * out along seeded spiral arms with jitter and a few relaxation passes so maps look organic
 * and asymmetric rather than a tidy radial ring.
 *
 * Generation is fully deterministic: the same `{ seed, players }` always yields the same
 * Scenario, so the server can rebuild (and replay) a game from its id + seed + player count
 * without ever persisting the map. Generation draws on its own Rng instance, decorrelated
 * from the gameplay Rng (which is seeded from the same number), so spatial layout and in-game
 * randomness never alias each other.
 */
import { generateSystemBodies, type BodyGenOptions } from "./bodies.js";
import type { Scenario, ScenarioRoute, ScenarioSystem } from "./config.js";
import { Rng } from "./rng.js";
import type { RangeTier, Resource, SystemRegion } from "./types.js";

export const PROCEDURAL_SCENARIO_ID = "procedural-atlas-v1";

export interface ProceduralOptions {
  seed: number;
  players: number;
  /** Match length; defaults to the standard 42-turn arc. */
  turns?: number;
}

/** A name pool large enough that most maps draw unique base names before falling back. */
const SYSTEM_NAMES = [
  "Frosthaven", "Vesta", "Pale Harbor", "Caldera", "Greywake", "Deepwell",
  "Tycho", "Cinder", "Halcyon", "Brightfall", "Karst", "Meridian",
  "Onyx", "Saltmarsh", "Verge", "Lowtide", "Ashford", "Petra",
  "Quillon", "Roan", "Sable", "Thornwell", "Umbra", "Wyhaven",
  "Calyx", "Drayer", "Embergate", "Fenwick", "Galene", "Holloway",
  "Ironreach", "Juno", "Kessler", "Larkspur", "Morrow", "Nyx",
  "Orrin", "Perdita", "Quenby", "Reysa", "Sandrift", "Talehel",
];

const FRONTIER_SUFFIXES = ["Deep", "Reach", "Expanse", "Drift", "Verge", "Shoals"];
const ABYSS_SUFFIXES = ["Abyss", "Void", "Maw", "Rift", "Hollow", "Gyre"];

/**
 * Core archetypes (basics only — no rare isotopes or antimatter in the core). Under the
 * body-driven model (Section 21) the `primary` raw is *guaranteed* to appear among the system's
 * generated deposits, which keeps every basic resource (incl. silicates) reachable somewhere in
 * the core; the rest of the system's deposits emerge from its star + planets. `primary`
 * undefined = a varied "mixed" world with no guaranteed raw.
 */
const CORE_PROFILES: { primary?: Resource; claimCost: number; upkeep: number }[] = [
  { primary: "ice", claimCost: 1200, upkeep: 40 },
  { primary: "metals", claimCost: 1100, upkeep: 40 },
  { primary: "helium3", claimCost: 1800, upkeep: 55 },
  { primary: "food", claimCost: 1500, upkeep: 50 },
  { primary: "silicates", claimCost: 1250, upkeep: 42 },
  { primary: undefined, claimCost: 1400, upkeep: 45 },
];

/**
 * Radial bands (world units, hub at the origin) for each region. The shells are pushed well out
 * so the larger galaxy spreads across deep space rather than clumping near the hub — the wider
 * the band, the longer (and higher-range) the tunnels that reach into it.
 */
const BANDS: Record<Exclude<SystemRegion, "hub">, [number, number]> = {
  core: [240, 820],
  frontier: [920, 1340],
  abyss: [1460, 2000],
};

const SPIRAL_K = 0.0042; // radians of arm twist per world unit of radius
const MIN_SEPARATION = 104; // relaxation target spacing between systems
const RELAX_ITERS = 48;
const DIST_PER_TURN = 600; // world units that map to one turn of transit (scaled to the wider map)

interface Placed {
  sys: ScenarioSystem;
  region: SystemRegion;
  /** How to generate this system's bodies + deposits (Section 21); set during placement. */
  gen?: BodyGenOptions;
}

/** Build the full deterministic procedural scenario for a seed + player count. */
export function generateProceduralScenario(opts: ProceduralOptions): Scenario {
  const { seed, players } = opts;
  const turns = opts.turns ?? 42;
  // Decorrelate the layout stream from the gameplay Rng (which uses `seed` directly).
  const rng = new Rng((seed ^ 0x9e3779b1) >>> 0);

  // ~3x the original counts: a big, sprawling galaxy with deep frontier/abyss to explore.
  const coreCount = Math.max(players * 6, 24);
  const frontierCount = Math.max(Math.round(players * 2), 8) + 1;
  const abyssCount = Math.max(Math.round(players * 1.1), 6);

  const armCount = rng.pick([3, 3, 4, 4, 4, 5]);
  const armBase = Array.from({ length: armCount }, (_, i) =>
    (Math.PI * 2 * i) / armCount + rng.float(-0.35, 0.35),
  );

  const names = makeNameAllocator(rng);
  const placed: Placed[] = [];

  // Hub at the centre — protected, no yields, never relaxed away from the origin.
  placed.push({
    region: "hub",
    sys: {
      id: "hub",
      name: "Wormhole Hub",
      yields: {},
      claimCost: 0,
      upkeep: 0,
      defense: 99,
      innerRing: false,
      position: { x: 0, y: 0, region: "hub", visualSeed: rng.int(0, 0x7fffffff) },
    },
  });

  // Core profiles: a shuffled order so every map varies, but all six archetypes appear
  // (coreCount >= 24 > 6) which keeps every basic resource (incl. silicates) available
  // somewhere in the core.
  const profileOrder = rng.shuffle([0, 1, 2, 3, 4, 5]);

  for (let i = 0; i < coreCount; i++) {
    const profile = CORE_PROFILES[profileOrder[i % profileOrder.length]!]!;
    const { x, y } = spiralPoint(rng, "core", i, coreCount, armBase, armCount);
    const id = `s${i}`;
    placed.push({
      region: "core",
      // Habitability is naturally scarce (only some worlds are gardens) — this keeps
      // population/tax concentrated rather than universal. Each corp's *home* system is made
      // habitable for fairness by the engine at assignment time (Section 21).
      gen: { region: "core", primaryResource: profile.primary },
      sys: {
        id,
        name: names.next("core"),
        yields: {},
        claimCost: jitterInt(rng, profile.claimCost, 0.08),
        upkeep: jitterInt(rng, profile.upkeep, 0.1),
        defense: 2,
        innerRing: true,
        position: { x, y, region: "core", visualSeed: rng.int(0, 0x7fffffff) },
      },
    });
  }

  for (let f = 0; f < frontierCount; f++) {
    const { x, y } = spiralPoint(rng, "frontier", f, frontierCount, armBase, armCount);
    placed.push({
      region: "frontier",
      gen: { region: "frontier", primaryResource: "rareIsotopes" },
      sys: {
        id: `f${f}`,
        name: names.next("frontier"),
        yields: {},
        claimCost: jitterInt(rng, 1550, 0.1),
        upkeep: jitterInt(rng, 70, 0.12),
        defense: 1,
        innerRing: false,
        position: { x, y, region: "frontier", visualSeed: rng.int(0, 0x7fffffff) },
      },
    });
  }

  for (let d = 0; d < abyssCount; d++) {
    const { x, y } = spiralPoint(rng, "abyss", d, abyssCount, armBase, armCount);
    placed.push({
      region: "abyss",
      gen: { region: "abyss" },
      sys: {
        id: `d${d}`,
        name: names.next("abyss"),
        yields: {},
        claimCost: jitterInt(rng, 2600, 0.1),
        upkeep: jitterInt(rng, 110, 0.12),
        defense: 1,
        innerRing: false,
        position: { x, y, region: "abyss", visualSeed: rng.int(0, 0x7fffffff) },
      },
    });
  }

  relax(placed);

  const routes = buildRoutes(rng, placed);

  // Bodies pass (Section 21): generate each system's star + planets + belts + deposits on a
  // decorrelated stream, after the layout is final, so positions/routes are unaffected by the
  // (variable) number of body draws.
  const bodyRng = new Rng((seed ^ 0x5bd1e995) >>> 0);
  for (const p of placed) {
    if (!p.gen) continue;
    p.sys.bodies = generateSystemBodies(bodyRng, p.gen);
  }

  // Weighted toward aggressors (Section 23) so the galaxy is a contested, warlike place.
  const bots = Array.from({ length: Math.max(players, 1) }, () =>
    rng.pick(["miner", "raider", "balanced", "raider", "warlord", "balanced", "warlord"]),
  );

  return {
    name: `Procedural Atlas — ${players} charters`,
    id: PROCEDURAL_SCENARIO_ID,
    hubId: "hub",
    players,
    turns,
    systems: placed.map((p) => p.sys),
    routes,
    bots,
  };
}

// ----- placement -----

/** A jittered point on a seeded spiral arm within a region's radial band. */
function spiralPoint(
  rng: Rng,
  region: Exclude<SystemRegion, "hub">,
  index: number,
  count: number,
  armBase: number[],
  armCount: number,
): { x: number; y: number } {
  const [rMin, rMax] = BANDS[region];
  const arm = index % armCount;
  // Stratify radius across the band so systems in an arm spread out instead of clumping.
  const perArm = Math.max(1, Math.ceil(count / armCount));
  const slot = Math.floor(index / armCount);
  const t = (slot + rng.float(0.15, 0.85)) / perArm;
  const radius = rMin + (rMax - rMin) * Math.min(1, t);
  const spread = 0.22 + rng.float(0, 0.12);
  const angle = armBase[arm]! + SPIRAL_K * radius + rng.float(-spread, spread);
  return { x: round1(Math.cos(angle) * radius), y: round1(Math.sin(angle) * radius) };
}

/** Push overlapping systems apart over a few passes (the hub stays pinned at the origin). */
function relax(placed: Placed[]): void {
  for (let iter = 0; iter < RELAX_ITERS; iter++) {
    for (let i = 0; i < placed.length; i++) {
      const a = placed[i]!;
      if (a.region === "hub") continue;
      for (let j = i + 1; j < placed.length; j++) {
        const b = placed[j]!;
        const pa = a.sys.position!;
        const pb = b.sys.position!;
        let dx = pb.x - pa.x;
        let dy = pb.y - pa.y;
        let dist = Math.hypot(dx, dy);
        if (dist >= MIN_SEPARATION) continue;
        if (dist < 0.001) {
          // Identical points — nudge along a stable axis to break the tie deterministically.
          dx = 1;
          dy = 0;
          dist = 1;
        }
        const push = (MIN_SEPARATION - dist) / 2;
        const ux = dx / dist;
        const uy = dy / dist;
        if (b.region !== "hub") {
          pb.x = round1(pb.x + ux * push);
          pb.y = round1(pb.y + uy * push);
        }
        pa.x = round1(pa.x - ux * push);
        pa.y = round1(pa.y - uy * push);
      }
    }
  }
}

// ----- routes -----

// A warp junction is a hazard, not a hub airport: every system carries only a handful of tunnels.
const HARD_MAX_TUNNELS = 5; // no system may ever exceed this many warp tunnels (5 is rare)

/** A system's target tunnel count: mostly 2–3, 4 occasional, 5 extremely rare; deep spurs sparser. */
function softTunnelCap(rng: Rng, region: SystemRegion): number {
  const roll = rng.float(0, 1);
  let cap = roll < 0.45 ? 2 : roll < 0.82 ? 3 : roll < 0.97 ? 4 : 5;
  if (region === "frontier") cap = Math.min(cap, 3); // exposed spurs stay thin
  if (region === "abyss") cap = Math.min(cap, 2); // the deepest are near dead-ends
  return cap;
}

/** The hub is a modest junction, not a hairball: 3–4 charted gateways, 5 only rarely. */
function hubTunnelCap(rng: Rng): number {
  const roll = rng.float(0, 1);
  return roll < 0.5 ? 3 : roll < 0.9 ? 4 : 5;
}

/** Smallest absolute angle between two bearings, accounting for wraparound. */
function angleGap(a: number, b: number): number {
  const d = Math.abs(a - b) % (Math.PI * 2);
  return Math.min(d, Math.PI * 2 - d);
}

/**
 * The core worlds the hub spokes directly to: the nearest core in each of `count` angular sectors
 * around the disc, so the hub's few gateways are spread across the arms (every arm gets a short
 * protected lane to the Exchange) instead of clustering on one side. Tops up with the next-nearest
 * worlds if the core is too clumped to fill every sector.
 */
function hubSpokeTargets(hub: Placed, core: Placed[], count: number): Placed[] {
  const ranked = core
    .map((c) => ({ c, d: dist(hub, c), ang: Math.atan2(c.sys.position!.y, c.sys.position!.x) }))
    .sort((x, y) => x.d - y.d || (x.c.sys.id < y.c.sys.id ? -1 : 1));
  const minSep = ((Math.PI * 2) / Math.max(1, count)) * 0.6;
  const picked: typeof ranked = [];
  for (const cand of ranked) {
    if (picked.length >= count) break;
    if (picked.every((p) => angleGap(p.ang, cand.ang) >= minSep)) picked.push(cand);
  }
  for (const cand of ranked) {
    if (picked.length >= count) break;
    if (!picked.includes(cand)) picked.push(cand);
  }
  return picked.map((p) => p.c);
}

function buildRoutes(rng: Rng, placed: Placed[]): ScenarioRoute[] {
  const routes: ScenarioRoute[] = [];
  const seen = new Set<string>();
  const degree = new Map<string, number>();
  for (const p of placed) degree.set(p.sys.id, 0);
  const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const deg = (p: Placed) => degree.get(p.sys.id)!;

  // Per-system tunnel budget (capped so the map reads as a sparse lane network, not a star burst).
  const cap = new Map<string, number>();
  for (const p of placed) cap.set(p.sys.id, softTunnelCap(rng, p.region));
  const hub = placed.find((p) => p.region === "hub")!;
  cap.set(hub.sys.id, hubTunnelCap(rng));
  const capOf = (p: Placed) => cap.get(p.sys.id)!;

  const add = (r: ScenarioRoute) => {
    const k = key(r.a, r.b);
    if (seen.has(k)) return;
    seen.add(k);
    routes.push(r);
    degree.set(r.a, degree.get(r.a)! + 1);
    degree.set(r.b, degree.get(r.b)! + 1);
  };
  const canAdd = (a: Placed, b: Placed, max: number) =>
    a.sys.id !== b.sys.id && !seen.has(key(a.sys.id, b.sys.id)) && deg(a) < max && deg(b) < max;

  // The right lane shape for a pair: hub→spoke, core↔core ring, or an uncharted deep tunnel into
  // whichever endpoint sits in the deeper band (range scales with that outer world's depth).
  const depthOf = (p: Placed) => (p.region === "abyss" ? 2 : p.region === "frontier" ? 1 : 0);
  const laneFor = (a: Placed, b: Placed): ScenarioRoute => {
    if (a.region === "hub" || b.region === "hub") return spokeRoute(rng, hub, a.region === "hub" ? b : a);
    if (depthOf(a) === 0 && depthOf(b) === 0) return ringRoute(rng, a, b);
    const outer = depthOf(a) >= depthOf(b) ? a : b;
    const anchor = outer === a ? b : a;
    return deepRoute(rng, anchor, outer, outer.region === "abyss" ? "abyss" : "frontier");
  };

  // Attach `node` to the nearest member of `pool` with spare capacity — preferring the soft cap,
  // falling back to the hard ceiling so connectivity is always guaranteed without ever exceeding 5.
  const connect = (node: Placed, pool: Placed[]): void => {
    const ranked = pool
      .filter((p) => p.sys.id !== node.sys.id && !seen.has(key(node.sys.id, p.sys.id)))
      .map((p) => ({ p, d: dist(node, p) }))
      .sort((x, y) => x.d - y.d || (x.p.sys.id < y.p.sys.id ? -1 : 1));
    const target =
      ranked.find((e) => deg(e.p) < capOf(e.p) && deg(node) < capOf(node))?.p ??
      ranked.find((e) => deg(e.p) < HARD_MAX_TUNNELS && deg(node) < HARD_MAX_TUNNELS)?.p;
    if (target) add(laneFor(node, target));
  };

  const core = placed.filter((p) => p.region === "core");
  const frontier = placed.filter((p) => p.region === "frontier");
  const abyss = placed.filter((p) => p.region === "abyss");
  const byHubDist = (a: Placed, b: Placed) => dist(hub, a) - dist(hub, b) || (a.sys.id < b.sys.id ? -1 : 1);

  // ---- Charted core backbone (Range 1) ----
  // A handful of hub gateways, spread across the arms, then every other core world chains in to the
  // nearest already-connected core/hub with spare capacity. The result is a charted spanning tree:
  // every core world is reachable from the hub on Range-1 lanes, but the hub itself stays sparse.
  const connected: Placed[] = [hub];
  const inSet = new Set<string>([hub.sys.id]);
  for (const c of hubSpokeTargets(hub, core, capOf(hub))) {
    add(spokeRoute(rng, hub, c));
    connected.push(c);
    inSet.add(c.sys.id);
  }
  for (const c of core.filter((x) => !inSet.has(x.sys.id)).sort(byHubDist)) {
    connect(c, connected);
    connected.push(c);
    inSet.add(c.sys.id);
  }
  // A few charted cross-links so the core is a network (cycles + shortcuts), not a brittle tree —
  // only where both ends still have soft-cap room, so degrees stay mostly 2–3.
  for (const c of core) {
    for (const n of nearest(c, core, 2)) {
      if (rng.chance(0.28) && canAdd(c, n, Math.min(capOf(c), capOf(n)))) add(ringRoute(rng, c, n));
    }
  }

  // ---- Uncharted deep spurs ----
  // Frontier (Range 2–4): each rare-isotope world hangs off its nearest core/frontier on an exposed,
  // survey-gated tunnel. Abyss (Range 3–6): each antimatter world hangs off its nearest frontier (or
  // core) on the wildest lanes. Both attach via `connect`, so no spur ever overruns the tunnel cap.
  const frontierPool = [...core];
  for (const f of [...frontier].sort(byHubDist)) {
    connect(f, frontierPool);
    frontierPool.push(f);
  }
  const abyssPool = frontier.length > 0 ? [...frontier, ...core] : [...core];
  for (const a of [...abyss].sort(byHubDist)) {
    connect(a, abyssPool);
    abyssPool.push(a);
  }

  return routes;
}

function spokeRoute(rng: Rng, hub: Placed, c: Placed): ScenarioRoute {
  return {
    a: hub.sys.id,
    b: c.sys.id,
    transitTime: transitFor(dist(hub, c), 1, 2),
    stability: jitter(rng, 0.9, 0.06),
    capacity: jitterInt(rng, 50, 0.15),
    exposure: jitter(rng, 0.3, 0.1),
    authorityPresence: jitter(rng, 0.8, 0.08),
    requiredRange: 1,
    charted: true,
  };
}

function ringRoute(rng: Rng, a: Placed, b: Placed): ScenarioRoute {
  return {
    a: a.sys.id,
    b: b.sys.id,
    transitTime: transitFor(dist(a, b), 1, 2),
    stability: jitter(rng, 0.7, 0.07),
    capacity: jitterInt(rng, 30, 0.18),
    exposure: jitter(rng, 0.58, 0.12),
    authorityPresence: jitter(rng, 0.3, 0.1),
    requiredRange: 1,
    charted: true,
  };
}

/** Range windows per deep band — how high a ship's range must climb to reach into the band. */
const DEEP_RANGE: Record<"frontier" | "abyss", [RangeTier, RangeTier]> = {
  frontier: [2, 4],
  abyss: [3, 6],
};

/** Transit-turn clamps per deep band (independent of the range tier — deeper bands cost more). */
const DEEP_TRANSIT: Record<"frontier" | "abyss", [number, number]> = {
  frontier: [1, 3],
  abyss: [2, 5],
};

function deepRoute(
  rng: Rng,
  anchor: Placed,
  outer: Placed,
  band: "frontier" | "abyss",
): ScenarioRoute {
  const f = band === "frontier";
  const [minRange, maxRange] = DEEP_RANGE[band];
  const [minT, maxT] = DEEP_TRANSIT[band];
  return {
    a: anchor.sys.id,
    b: outer.sys.id,
    transitTime: transitFor(dist(anchor, outer), minT, maxT),
    stability: jitter(rng, f ? 0.5 : 0.4, 0.06),
    capacity: jitterInt(rng, f ? 20 : 12, 0.18),
    exposure: jitter(rng, f ? 0.85 : 0.94, f ? 0.06 : 0.04),
    authorityPresence: jitter(rng, f ? 0.12 : 0.06, 0.04),
    requiredRange: requiredRangeForDepth(outer, band, minRange, maxRange),
    charted: false,
  };
}

/**
 * The range tier a deep tunnel demands, scaled by how far into its band the outer world sits:
 * worlds at the inner edge need the band's minimum range, the deepest need its maximum. Uses the
 * world's radius from the hub (positions are final by the time routes are built).
 */
function requiredRangeForDepth(
  outer: Placed,
  band: "frontier" | "abyss",
  minRange: RangeTier,
  maxRange: RangeTier,
): RangeTier {
  const [rMin, rMax] = BANDS[band];
  const radius = Math.hypot(outer.sys.position!.x, outer.sys.position!.y);
  const t = clamp01((radius - rMin) / (rMax - rMin));
  const tier = Math.round(minRange + t * (maxRange - minRange));
  return clampInt(tier, minRange, maxRange) as RangeTier;
}

// ----- small helpers -----

function transitFor(d: number, min: number, max: number): number {
  return clampInt(Math.round(d / DIST_PER_TURN), min, max);
}

function dist(a: Placed, b: Placed): number {
  return Math.hypot(a.sys.position!.x - b.sys.position!.x, a.sys.position!.y - b.sys.position!.y);
}

/** The `k` nearest other systems to `from` within `pool`, by world distance. */
function nearest(from: Placed, pool: Placed[], k: number): Placed[] {
  return pool
    .filter((p) => p.sys.id !== from.sys.id)
    .map((p) => ({ p, d: dist(from, p) }))
    .sort((x, y) => x.d - y.d || (x.p.sys.id < y.p.sys.id ? -1 : 1))
    .slice(0, k)
    .map((e) => e.p);
}

function jitter(rng: Rng, base: number, amt: number): number {
  return clamp01(round2(base + rng.float(-amt, amt)));
}

function jitterInt(rng: Rng, base: number, frac: number): number {
  return Math.max(1, Math.round(base * (1 + rng.float(-frac, frac))));
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function clampInt(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Deterministic, mostly-unique system names with region-flavoured suffixes. */
function makeNameAllocator(rng: Rng): { next: (region: SystemRegion) => string } {
  const pool = rng.shuffle([...SYSTEM_NAMES]);
  const used = new Set<string>();
  let i = 0;
  const base = (): string => {
    const name = pool[i % pool.length]!;
    i++;
    return i > pool.length ? `${name} ${roman(Math.ceil(i / pool.length))}` : name;
  };
  const unique = (name: string): string => {
    let candidate = name;
    let n = 2;
    while (used.has(candidate)) candidate = `${name} ${roman(n++)}`;
    used.add(candidate);
    return candidate;
  };
  return {
    next(region: SystemRegion): string {
      const b = base();
      if (region === "frontier") return unique(`${b} ${rng.pick(FRONTIER_SUFFIXES)}`);
      if (region === "abyss") return unique(`${b} ${rng.pick(ABYSS_SUFFIXES)}`);
      return unique(b);
    },
  };
}

function roman(n: number): string {
  const table: [number, string][] = [
    [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
  ];
  let out = "";
  let v = n;
  for (const [val, sym] of table) {
    while (v >= val) {
      out += sym;
      v -= val;
    }
  }
  return out || "I";
}
