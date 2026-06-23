/**
 * Per-ship SPEED scaling (Section 04). `shipSpeed[tier]` is a multiplier that scales BOTH lane and
 * off-lane transit times; a fleet travels at its slowest hull's speed. Tier 1 is exactly 1.0, so the
 * baseline timings (and every existing tier-1 movement test) are unchanged.
 */
import { describe, expect, it } from "vitest";
import { Engine } from "../src/engine/engine.js";
import { previewFleetMove } from "../src/engine/movement.js";
import { loadScenario, type Scenario } from "../src/engine/config.js";
import type { Bot, BotFactory } from "../src/engine/bots/bot.js";
import type { BidOrder, Order, RangeTier, Ship, SystemRegion } from "../src/engine/types.js";

class NoopBot implements Bot {
  readonly id = "noop";
  bid(): BidOrder { return { kind: "bid", priorities: [] }; }
  decide(): Order[] { return []; }
}
const reg = (): Map<string, BotFactory> => new Map([["noop", () => new NoopBot()]]);
const at = (x: number, y: number, region: SystemRegion) => ({ x, y, region, visualSeed: 0 });
const ship = (tier: RangeTier, stationedAt = "s0"): Ship => ({ rangeTier: tier, combat: 6, raider: false, stationedAt });

/** Position-LESS galaxy: distanceBetween is null → off-lane is disabled, so the fleet must use lanes
 *  and we measure lane-time scaling without the off-lane shortcut competing. */
const flatLane = (a: string, b: string, transitTime = 1) => ({ a, b, transitTime, stability: 0.9, capacity: 40, exposure: 0.4, authorityPresence: 0.5, charted: true });
function laneScenario(): Scenario {
  return {
    name: "speed-lane", hubId: "hub", players: 2, turns: 16, bots: ["noop"],
    systems: [
      { id: "hub", name: "Hub", yields: {}, claimCost: 0, upkeep: 0, defense: 99 },
      { id: "s0", name: "S0", yields: { metals: 10 }, claimCost: 1000, upkeep: 0, defense: 2, innerRing: true },
      { id: "sMid", name: "SMid", yields: { metals: 5 }, claimCost: 1000, upkeep: 0, defense: 2 },
      { id: "sEnd", name: "SEnd", yields: { metals: 5 }, claimCost: 1000, upkeep: 0, defense: 2 },
    ],
    routes: [flatLane("hub", "s0", 1), flatLane("s0", "sMid", 1), flatLane("sMid", "sEnd", 1)],
  };
}

/** Positioned galaxy with an un-laned far system, to exercise off-lane speed scaling. */
const lane = (a: string, b: string, transitTime = 1) => ({ a, b, transitTime, stability: 0.9, capacity: 50, exposure: 0.3, authorityPresence: 0.6, requiredRange: 1 as const, charted: true });
function offLaneScenario(): Scenario {
  return {
    name: "speed-off", hubId: "hub", players: 2, turns: 16, bots: ["noop"],
    systems: [
      { id: "hub", name: "Hub", yields: {}, claimCost: 0, upkeep: 0, defense: 99, position: at(0, -800, "hub") },
      { id: "s0", name: "S0", yields: { metals: 10 }, claimCost: 1000, upkeep: 0, defense: 2, innerRing: true, position: at(0, 0, "core") },
      { id: "sFar", name: "SFar", yields: { metals: 5 }, claimCost: 1000, upkeep: 0, defense: 2, position: at(1000, 0, "frontier") },
    ],
    routes: [lane("hub", "s0", 1)],
  };
}

function makeEngine(scen: Scenario) {
  const eng = new Engine(loadScenario(scen), 1, reg());
  const a = eng.corps[0]!;
  for (const sys of eng.galaxy.allSystems()) if (sys.id !== "hub") sys.owner = null;
  a.ownedSystemIds = ["s0"]; a.hasCharter = true; a.isFreeOperator = false;
  eng.galaxy.system("s0").owner = a.id;
  eng.galaxy.system("s0").stockpile.fuel = 100000;
  eng.makeHybrid(a.id);
  return { eng, a };
}

describe("ship speed scales transit (Section 04)", () => {
  it("a slower hull crosses a single lane in more turns than a fast one", () => {
    const { eng } = makeEngine(laneScenario());
    const g = eng.galaxy, t = eng.config.tuning;
    const fast = previewFleetMove(g, t, "s0", "sMid", [ship(1)]); // speed 1.0
    const slow = previewFleetMove(g, t, "s0", "sMid", [ship(8)]); // speed 0.6
    expect(fast.ok && slow.ok).toBe(true);
    expect(fast.eta).toBe(1); // round(1 / 1.0)
    expect(slow.eta).toBe(Math.max(1, Math.round(1 / t.shipSpeed[8]))); // round(1 / 0.6) = 2
    expect(slow.eta).toBeGreaterThan(fast.eta);
  });

  it("scales a multi-segment lane path and a fleet moves at its SLOWEST ship's speed", () => {
    const { eng } = makeEngine(laneScenario());
    const g = eng.galaxy, t = eng.config.tuning;
    const fast = previewFleetMove(g, t, "s0", "sEnd", [ship(1)]);          // 1 + 1
    const slow = previewFleetMove(g, t, "s0", "sEnd", [ship(8)]);          // 2 + 2
    const mixed = previewFleetMove(g, t, "s0", "sEnd", [ship(1), ship(8)]); // min speed = slow
    expect(fast.eta).toBe(2);
    expect(slow.eta).toBe(2 * Math.max(1, Math.round(1 / t.shipSpeed[8]))); // 4
    expect(mixed.eta).toBe(slow.eta);
  });

  it("the engine resolves arrival in exactly the previewed (speed-scaled) number of turns", () => {
    for (const tier of [1, 8] as RangeTier[]) {
      const { eng, a } = makeEngine(laneScenario());
      a.ships = [ship(tier)];
      const eta = previewFleetMove(eng.galaxy, eng.config.tuning, "s0", "sEnd", a.ships).eta;
      eng.setHumanOrders(a.id, [{ kind: "moveFleet", fromSystemId: "s0", toSystemId: "sEnd" }]);
      let turns = 0;
      for (let i = 0; i < 12; i++) { eng.stepTurn(); eng.setHumanOrders(a.id, null); turns++; if (a.ships.some((s) => s.stationedAt === "sEnd")) break; }
      expect(turns).toBe(eta); // launch turn counts, so total travel turns == ETA == sum of speed-baked segmentTimes
    }
  });

  it("scales an off-lane jump and gates it by hull range", () => {
    const { eng } = makeEngine(offLaneScenario());
    const g = eng.galaxy, t = eng.config.tuning;
    // s0 → sFar is 1000 units with no lane. A Range-1 hull (jump 400) can't reach it at all.
    expect(previewFleetMove(g, t, "s0", "sFar", [ship(1)]).ok).toBe(false);
    const mid = previewFleetMove(g, t, "s0", "sFar", [ship(4)]); // range 1200, speed 0.85
    const slow = previewFleetMove(g, t, "s0", "sFar", [ship(8)]); // range 3000, speed 0.6
    expect(mid.ok && slow.ok).toBe(true);
    expect(mid.offLane && slow.offLane).toBe(true);
    expect(slow.eta).toBeGreaterThan(mid.eta); // the slower hull takes more turns over the same gap
  });

  it("leaves tier-1 timing and fuel unchanged (regression lock)", () => {
    const { eng } = makeEngine(laneScenario());
    const g = eng.galaxy, t = eng.config.tuning;
    const p = previewFleetMove(g, t, "s0", "sEnd", [ship(1)]);
    expect(p.eta).toBe(2);          // raw transitTime sum (1 + 1) — speed 1.0 changes nothing
    expect(p.fuel).toBeGreaterThan(0);
  });

  it("resolves a speed-scaled move identically from the same seed (determinism)", () => {
    const run = () => {
      const { eng, a } = makeEngine(laneScenario());
      a.ships = [ship(8)];
      eng.setHumanOrders(a.id, [{ kind: "moveFleet", fromSystemId: "s0", toSystemId: "sEnd" }]);
      for (let i = 0; i < 8; i++) { eng.stepTurn(); eng.setHumanOrders(a.id, null); }
      return { stationed: a.ships.map((s) => s.stationedAt).sort(), fuel: eng.galaxy.system("s0").stockpile.fuel };
    };
    expect(run()).toEqual(run());
  });
});
