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
import type { Scenario, ScenarioRoute, ScenarioSystem } from "./config.js";
import { Rng } from "./rng.js";
import type { RangeTier, Stockpile, SystemRegion } from "./types.js";

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

/** Core resource archetypes (basics only — no rare isotopes or antimatter in the core). */
const CORE_PROFILES: { yields: Partial<Stockpile>; claimCost: number; upkeep: number }[] = [
  { yields: { ice: 12, metals: 2 }, claimCost: 1200, upkeep: 40 },
  { yields: { metals: 14, ice: 2 }, claimCost: 1100, upkeep: 40 },
  { yields: { helium3: 8, ice: 2 }, claimCost: 1800, upkeep: 55 },
  { yields: { food: 10, ice: 3 }, claimCost: 1500, upkeep: 50 },
  { yields: { ice: 4, metals: 4, helium3: 2 }, claimCost: 1400, upkeep: 45 },
];

/**
 * Radial bands (world units, hub at the origin) for each region. The shells are pushed well out
 * so the larger galaxy spreads across deep space rather than clumping near the hub — the wider
 * the band, the longer (and higher-range) the tunnels that reach into it.
 */
const BANDS: Record<Exclude<SystemRegion, "hub">, [number, number]> = {
  core: [220, 600],
  frontier: [680, 1100],
  abyss: [1180, 1700],
};

const SPIRAL_K = 0.0042; // radians of arm twist per world unit of radius
const MIN_SEPARATION = 72; // relaxation target spacing between systems
const RELAX_ITERS = 48;
const DIST_PER_TURN = 520; // world units that map to one turn of transit (scaled to the wider map)

interface Placed {
  sys: ScenarioSystem;
  region: SystemRegion;
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

  // Core profiles: a shuffled order so every map varies, but all five archetypes appear
  // (coreCount >= 8 > 5) which keeps every basic resource available somewhere in the core.
  const profileOrder = rng.shuffle([0, 1, 2, 3, 4]);

  for (let i = 0; i < coreCount; i++) {
    const profile = CORE_PROFILES[profileOrder[i % profileOrder.length]!]!;
    const { x, y } = spiralPoint(rng, "core", i, coreCount, armBase, armCount);
    const id = `s${i}`;
    placed.push({
      region: "core",
      sys: {
        id,
        name: names.next("core"),
        yields: profile.yields,
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
      sys: {
        id: `f${f}`,
        name: names.next("frontier"),
        yields: { rareIsotopes: rng.int(4, 6), metals: rng.int(2, 3) },
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
      sys: {
        id: `d${d}`,
        name: names.next("abyss"),
        yields: { antimatter: rng.int(2, 4), rareIsotopes: rng.int(1, 2) },
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

  const bots = Array.from({ length: Math.max(players, 1) }, () =>
    rng.pick(["miner", "raider", "balanced"]),
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

function buildRoutes(rng: Rng, placed: Placed[]): ScenarioRoute[] {
  const routes: ScenarioRoute[] = [];
  const seen = new Set<string>();
  const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const add = (r: ScenarioRoute) => {
    const k = key(r.a, r.b);
    if (seen.has(k)) return;
    seen.add(k);
    routes.push(r);
  };

  const hub = placed.find((p) => p.region === "hub")!;
  const core = placed.filter((p) => p.region === "core");
  const frontier = placed.filter((p) => p.region === "frontier");
  const abyss = placed.filter((p) => p.region === "abyss");

  // Charted hub spokes: every core world has a short protected lane to the hub, so every
  // random start can reach (and sell at) the hub from turn one. Transit scales with distance.
  for (const c of core) {
    add(spokeRoute(rng, hub, c));
  }

  // Charted core cross-links: each core world links to its 1–2 nearest core neighbours,
  // giving the core an irregular network (cycles + shortcuts) rather than a clean ring.
  for (const c of core) {
    const neighbours = nearest(c, core, 2);
    add(ringRoute(rng, c, neighbours[0]!));
    if (neighbours[1] && rng.chance(0.55)) add(ringRoute(rng, c, neighbours[1]!));
  }

  // Uncharted frontier tunnels (Range 2–4): each rare-isotope world hangs off its nearest core
  // world on an exposed, lightly-policed lane that must be surveyed before it can be used. The
  // deeper into the band the world sits, the higher the range needed to reach it.
  for (const f of frontier) {
    const anchor = nearest(f, core, 1)[0]!;
    add(deepRoute(rng, anchor, f, "frontier"));
  }

  // Uncharted abyss tunnels (Range 3–6): each antimatter world hangs off its nearest frontier
  // world (or nearest core if no frontier exists) on the wildest lanes in the galaxy — the
  // deepest demand capital-grade range to traverse. (Range 7–8 hulls stay a combat/escort flex.)
  const abyssAnchors = frontier.length > 0 ? frontier : core;
  for (const a of abyss) {
    const anchor = nearest(a, abyssAnchors, 1)[0]!;
    add(deepRoute(rng, anchor, a, "abyss"));
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
