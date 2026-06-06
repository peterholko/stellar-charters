import { describe, expect, it } from "vitest";
import {
  generateProceduralScenario,
  PROCEDURAL_SCENARIO_ID,
} from "../src/engine/procedural.js";
import { loadScenario } from "../src/engine/config.js";
import { Galaxy } from "../src/engine/galaxy.js";
import { Engine } from "../src/engine/engine.js";
import { buildClientState } from "../src/engine/clientState.js";
import { defaultRegistry } from "../src/engine/bots/registry.js";
import { RESOURCES, type Resource } from "../src/engine/types.js";

const PLAYER_COUNTS = [2, 4, 6, 8];

function reachableFromHub(scenario: ReturnType<typeof generateProceduralScenario>): Set<string> {
  const adj = new Map<string, string[]>();
  for (const s of scenario.systems) adj.set(s.id, []);
  for (const r of scenario.routes) {
    adj.get(r.a)!.push(r.b);
    adj.get(r.b)!.push(r.a);
  }
  const seen = new Set<string>([scenario.hubId]);
  const queue = [scenario.hubId];
  while (queue.length) {
    const n = queue.shift()!;
    for (const m of adj.get(n) ?? []) {
      if (!seen.has(m)) {
        seen.add(m);
        queue.push(m);
      }
    }
  }
  return seen;
}

describe("procedural generator — determinism", () => {
  it("replays byte-identically for the same seed + player count", () => {
    for (const players of PLAYER_COUNTS) {
      const a = generateProceduralScenario({ seed: 12345, players });
      const b = generateProceduralScenario({ seed: 12345, players });
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
  });

  it("diverges across different seeds", () => {
    const a = generateProceduralScenario({ seed: 1, players: 4 });
    const b = generateProceduralScenario({ seed: 2, players: 4 });
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it("tags the scenario with the stable id", () => {
    expect(generateProceduralScenario({ seed: 7, players: 4 }).id).toBe(PROCEDURAL_SCENARIO_ID);
  });
});

describe("procedural generator — structure", () => {
  it("has unique system ids and a centred hub", () => {
    const s = generateProceduralScenario({ seed: 99, players: 6 });
    const ids = s.systems.map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
    const hub = s.systems.find((x) => x.id === s.hubId)!;
    expect(hub.position).toEqual({ x: 0, y: 0, region: "hub", visualSeed: hub.position!.visualSeed });
  });

  it("every route connects two distinct, existing systems", () => {
    for (const players of PLAYER_COUNTS) {
      const s = generateProceduralScenario({ seed: players * 13, players });
      const ids = new Set(s.systems.map((x) => x.id));
      const pairs = new Set<string>();
      for (const r of s.routes) {
        expect(ids.has(r.a)).toBe(true);
        expect(ids.has(r.b)).toBe(true);
        expect(r.a).not.toBe(r.b);
        const key = r.a < r.b ? `${r.a}|${r.b}` : `${r.b}|${r.a}`;
        expect(pairs.has(key)).toBe(false); // no duplicate edges
        pairs.add(key);
      }
    }
  });

  it("gives every player a distinct start plus open core targets", () => {
    for (const players of PLAYER_COUNTS) {
      const s = generateProceduralScenario({ seed: 500 + players, players });
      const inner = s.systems.filter((x) => x.innerRing).length;
      expect(inner).toBeGreaterThanOrEqual(players);
      // At least one spare core world remains for expansion beyond each player's seed.
      expect(inner).toBeGreaterThan(players);
    }
  });
});

describe("procedural generator — spacing", () => {
  it("keeps systems from overlapping after relaxation", () => {
    for (const players of PLAYER_COUNTS) {
      const s = generateProceduralScenario({ seed: players * 7 + 3, players });
      const pts = s.systems.map((x) => x.position!);
      let min = Infinity;
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          min = Math.min(min, Math.hypot(pts[i]!.x - pts[j]!.x, pts[i]!.y - pts[j]!.y));
        }
      }
      expect(min).toBeGreaterThan(60);
    }
  });
});

describe("procedural generator — resources by region", () => {
  it("makes every resource available somewhere", () => {
    const s = generateProceduralScenario({ seed: 314, players: 8 });
    const present = new Set<Resource>();
    for (const sys of s.systems) {
      for (const r of RESOURCES) {
        if ((sys.yields[r] ?? 0) > 0) present.add(r);
      }
    }
    for (const r of RESOURCES) expect(present.has(r)).toBe(true);
  });

  it("gates deep tunnels by range, scaling beyond the old Range-3 ceiling", () => {
    // Aggregate over several seeds/sizes so we see the full distance-scaled range spread.
    const required = new Set<number>();
    for (const players of PLAYER_COUNTS) {
      const s = generateProceduralScenario({ seed: 600 + players, players });
      for (const r of s.routes) {
        if (!r.charted) required.add(r.requiredRange ?? 1);
        // Charted lanes are always inner-ring Range 1.
        if (r.charted) expect(r.requiredRange ?? 1).toBe(1);
      }
    }
    const max = Math.max(...required);
    expect(max).toBeGreaterThan(3); // deep tunnels now demand more than the legacy Range-3 cap
    expect(max).toBeLessThanOrEqual(8); // never beyond the ladder ceiling
    expect(required.has(2)).toBe(true); // shallow frontier tunnels still open at Range 2
  });

  it("biases resources by region (basics in core, isotopes on the frontier, antimatter in the abyss)", () => {
    for (const players of PLAYER_COUNTS) {
      const s = generateProceduralScenario({ seed: players * 29, players });
      for (const sys of s.systems) {
        const region = sys.position!.region;
        if (region === "core") {
          expect(sys.yields.rareIsotopes ?? 0).toBe(0);
          expect(sys.yields.antimatter ?? 0).toBe(0);
        }
        if (region === "frontier") expect(sys.yields.rareIsotopes ?? 0).toBeGreaterThan(0);
        if (region === "abyss") expect(sys.yields.antimatter ?? 0).toBeGreaterThan(0);
      }
    }
  });
});

describe("procedural generator — connectivity", () => {
  it("connects the whole galaxy back to the hub", () => {
    for (const players of PLAYER_COUNTS) {
      const s = generateProceduralScenario({ seed: 1000 + players, players });
      expect(reachableFromHub(s).size).toBe(s.systems.length);
    }
  });

  it("reaches every frontier/abyss world only via uncharted, deeper-range tunnels", () => {
    const s = generateProceduralScenario({ seed: 77, players: 4 });
    // Charted range-1 routes alone reach the core; deeper worlds need surveys + range.
    const charted = new Map<string, string[]>();
    for (const sys of s.systems) charted.set(sys.id, []);
    for (const r of s.routes) {
      if (r.charted && (r.requiredRange ?? 1) === 1) {
        charted.get(r.a)!.push(r.b);
        charted.get(r.b)!.push(r.a);
      }
    }
    const seen = new Set([s.hubId]);
    const q = [s.hubId];
    while (q.length) {
      const n = q.shift()!;
      for (const m of charted.get(n) ?? []) if (!seen.has(m)) (seen.add(m), q.push(m));
    }
    const core = s.systems.filter((x) => x.position!.region === "core");
    for (const c of core) expect(seen.has(c.id)).toBe(true); // every core world reachable charted
    const deep = s.systems.filter((x) => x.position!.region !== "core" && x.id !== s.hubId);
    for (const d of deep) expect(seen.has(d.id)).toBe(false); // abyss/frontier gated behind surveys
  });
});

describe("procedural reconstruction", () => {
  function runDigest(seed: number, players: number): string {
    const scenario = generateProceduralScenario({ seed, players });
    const config = loadScenario({ ...scenario, players, bots: scenario.bots });
    return JSON.stringify(new Engine(config, seed, defaultRegistry()).run());
  }

  it("replays a full match identically from seed + player count", () => {
    for (const players of [4, 8]) {
      expect(runDigest(4242, players)).toBe(runDigest(4242, players));
    }
  });

  it("seats every corporation on a distinct starting world", () => {
    const scenario = generateProceduralScenario({ seed: 8, players: 8 });
    const config = loadScenario({ ...scenario, players: 8, bots: scenario.bots });
    const engine = new Engine(config, 8, defaultRegistry());
    const starts = engine.corps.map((c) => c.ownedSystemIds[0]);
    expect(starts.every((id) => id !== undefined)).toBe(true);
    expect(new Set(starts).size).toBe(engine.corps.length);
    expect(engine.corps.every((c) => c.hasCharter)).toBe(true);
  });

  it("round-trips positions and route ids through ClientState back into a Galaxy", () => {
    const seed = 2024;
    const players = 4;
    const scenario = generateProceduralScenario({ seed, players });
    const config = loadScenario({ ...scenario, players, bots: scenario.bots });
    const engine = new Engine(config, seed, defaultRegistry());
    for (let t = 0; t < 4; t++) {
      for (const c of engine.corps) engine.setHumanOrders(c.id, null);
      engine.stepTurn();
    }
    const cs = buildClientState(engine, "corp-0", "game1", []);
    expect(cs.scenarioId).toBe(PROCEDURAL_SCENARIO_ID);
    expect(cs.systems.every((s) => s.position)).toBe(true);

    // Mirror the client's `scenarioFromState` reconstruction and check id/position alignment.
    const rebuilt = loadScenario({
      name: "live",
      id: cs.scenarioId,
      hubId: "hub",
      players: cs.corps.length,
      turns: cs.totalTurns,
      systems: cs.systems.map((s) => ({
        id: s.id,
        name: s.name,
        yields: s.yields,
        claimCost: s.claimCost,
        upkeep: s.upkeep,
        defense: s.defense,
        innerRing: s.innerRing,
        position: s.position,
      })),
      routes: cs.routes.map((r) => ({
        a: r.a,
        b: r.b,
        transitTime: r.transitTime,
        stability: r.stability,
        capacity: r.capacity,
        exposure: r.exposure,
        authorityPresence: r.authorityPresence,
        requiredRange: r.requiredRange,
        charted: r.charted,
      })),
    });
    const galaxy = new Galaxy(rebuilt);
    for (const cr of cs.routes) {
      const rt = galaxy.routes.get(cr.id);
      expect(rt?.a).toBe(cr.a);
      expect(rt?.b).toBe(cr.b);
    }
    expect(galaxy.system("hub").position).toEqual({ x: 0, y: 0, region: "hub", visualSeed: galaxy.system("hub").position!.visualSeed });
  });
});
