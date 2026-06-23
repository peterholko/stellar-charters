/**
 * Off-lane fleet movement + mass×distance fuel (Section 04/07b).
 *
 * Warp lanes are now merely the fuel-efficient option: light combat fleets can jump directly
 * between any two systems within hull range, paying full mass×distance fuel; lanes channel that
 * mass far more cheaply. Convoys stay lane-bound. These tests pin the new resolution behaviour.
 */
import { describe, expect, it } from "vitest";
import { Engine } from "../src/engine/engine.js";
import { buildClientState } from "../src/engine/clientState.js";
import { loadScenario, type Scenario } from "../src/engine/config.js";
import type { Bot, BotFactory, PlayerView } from "../src/engine/bots/bot.js";
import type { BidOrder, Order, SystemRegion } from "../src/engine/types.js";

class NoopBot implements Bot {
  readonly id = "noop";
  bid(): BidOrder { return { kind: "bid", priorities: [] }; }
  decide(): Order[] { return []; }
}
const reg = (): Map<string, BotFactory> => new Map([["noop", () => new NoopBot()]]);

const at = (x: number, y: number, region: SystemRegion) => ({ x, y, region, visualSeed: 0 });
const lane = (a: string, b: string) => ({
  a, b, transitTime: 1, stability: 0.9, capacity: 50, exposure: 0.3, authorityPresence: 0.6, requiredRange: 1 as const, charted: true,
});

/**
 * Hub + s0 (owned by corp-0). sLane is on a charted lane from s0; sOff has NO lane but is a
 * short direct hop away; sFar has no lane and is beyond a Range-1 hull's off-lane reach.
 * Positions drive distance, so off-lane movement and fuel are exercised end to end.
 */
function moveScenario(): Scenario {
  return {
    name: "move", hubId: "hub", players: 2, turns: 12, bots: ["noop"],
    systems: [
      { id: "hub", name: "Hub", yields: {}, claimCost: 0, upkeep: 0, defense: 99, position: at(0, 0, "hub") },
      { id: "s0", name: "S0", yields: { metals: 10 }, claimCost: 1000, upkeep: 0, defense: 2, innerRing: true, position: at(0, 300, "core") },
      { id: "sLane", name: "SLane", yields: { metals: 5 }, claimCost: 1000, upkeep: 0, defense: 2, position: at(0, 600, "core") },
      { id: "sOff", name: "SOff", yields: { metals: 5 }, claimCost: 1000, upkeep: 0, defense: 2, position: at(250, 300, "frontier") },
      { id: "sFar", name: "SFar", yields: { metals: 5 }, claimCost: 1000, upkeep: 0, defense: 2, position: at(0, 1500, "abyss") },
    ],
    // s0 is laned to the hub and to sLane only; sOff and sFar are reachable solely off-lane.
    routes: [lane("hub", "s0"), lane("s0", "sLane")],
  };
}

/** Build the engine, give corp-0 sole ownership of s0 and a single Range-1 warship there. */
function setup(opts: { fuelPerMassDistance?: number } = {}) {
  const base = moveScenario();
  const config = {
    ...loadScenario(base),
    tuning: {
      ...loadScenario(base).tuning,
      fuelPerShipPerTurn: 0, // isolate movement fuel from per-turn upkeep
      ...(opts.fuelPerMassDistance !== undefined ? { fuelPerMassDistance: opts.fuelPerMassDistance } : {}),
    },
  };
  const eng = new Engine(config, 1, reg());
  const a = eng.corps[0]!;
  for (const sys of eng.galaxy.allSystems()) if (sys.id !== "hub") sys.owner = null;
  a.ownedSystemIds = ["s0"]; a.hasCharter = true; a.isFreeOperator = false;
  eng.galaxy.system("s0").owner = a.id;
  // Stock plenty of fuel locally so movement fuel is drawn from the stockpile (measurable) rather
  // than bought at the exchange.
  eng.galaxy.system("s0").stockpile.fuel = 100000;
  a.ships = [{ rangeTier: 1, combat: 6, raider: false, stationedAt: "s0" }];
  eng.makeHybrid(a.id);
  return { eng, a };
}

describe("off-lane fleet movement (Section 04)", () => {
  it("jumps a fleet off-lane directly to an un-laned system within hull range", () => {
    const { eng, a } = setup();
    expect(eng.galaxy.routeBetween("s0", "sOff")).toBeUndefined(); // no lane exists
    eng.setHumanOrders(a.id, [{ kind: "moveFleet", fromSystemId: "s0", toSystemId: "sOff" }]);
    eng.stepTurn();
    // A distance-1 jump completes in a single turn: the launch turn counts as the first travel
    // segment (matching convoys), so the fleet re-bases at the previously unreachable system at once.
    expect(a.ships[0]!.transit).toBeUndefined();
    expect(a.ships.some((s) => s.stationedAt === "sOff")).toBe(true);
    // The leg it crossed was an off-lane "" hop, not a charted lane.
    const log = buildClientState(eng, a.id, "g", []).movementLog;
    expect(log.some((m) => m.kind === "fleet" && m.toSystemId === "sOff" && m.offLane)).toBe(true);
  });

  it("refuses an off-lane jump beyond the hull's range and leaves the fleet put", () => {
    const { eng, a } = setup();
    expect(eng.galaxy.routeBetween("s0", "sFar")).toBeUndefined();
    eng.setHumanOrders(a.id, [{ kind: "moveFleet", fromSystemId: "s0", toSystemId: "sFar" }]);
    eng.stepTurn();
    expect(a.ships[0]!.transit).toBeUndefined(); // order had no valid plan
    expect(a.ships[0]!.stationedAt).toBe("s0"); // fleet stayed home
  });

  it("prefers a warp lane when one exists rather than burning off-lane fuel", () => {
    const { eng, a } = setup();
    expect(eng.galaxy.routeBetween("s0", "sLane")).toBeDefined();
    eng.setHumanOrders(a.id, [{ kind: "moveFleet", fromSystemId: "s0", toSystemId: "sLane" }]);
    eng.stepTurn();
    // The single-segment lane move arrives in one turn; the recorded leg is a real lane, not an
    // off-lane "" hop.
    expect(a.ships.some((s) => s.stationedAt === "sLane")).toBe(true);
    const leg = buildClientState(eng, a.id, "g", []).movementLog.find((m) => m.kind === "fleet" && m.toSystemId === "sLane");
    expect(leg).toBeDefined();
    expect(leg!.offLane).toBe(false);
  });

  it("resolves an off-lane jump identically from the same seed (determinism)", () => {
    const run = () => {
      const { eng, a } = setup();
      eng.setHumanOrders(a.id, [{ kind: "moveFleet", fromSystemId: "s0", toSystemId: "sOff" }]);
      eng.stepTurn();
      eng.setHumanOrders(a.id, null);
      for (let i = 0; i < 3; i++) eng.stepTurn();
      return { stationed: a.ships.map((s) => s.stationedAt).sort(), fuel: eng.galaxy.system("s0").stockpile.fuel };
    };
    expect(run()).toEqual(run());
  });

  it("an off-lane jump costs more fuel than a comparable lane move", () => {
    // Off-lane to sOff (dist 250, no discount) vs lane to sLane (dist 300, heavily discounted).
    // Despite the lane move being LONGER, the lane efficiency makes it cheaper — proving lanes
    // reduce the fuel needed to move mass.
    const fuelFor = (dest: string) => {
      const { eng, a } = setup();
      const before = eng.galaxy.system("s0").stockpile.fuel;
      eng.setHumanOrders(a.id, [{ kind: "moveFleet", fromSystemId: "s0", toSystemId: dest }]);
      eng.stepTurn(); // fuel is charged at launch
      return before - eng.galaxy.system("s0").stockpile.fuel;
    };
    const offLane = fuelFor("sOff");
    const lane = fuelFor("sLane");
    expect(offLane).toBeGreaterThan(0);
    expect(lane).toBeGreaterThan(0);
    expect(offLane).toBeGreaterThan(lane);
  });
});

describe("freighter mass-fuel + position-less fallback (Section 04)", () => {
  it("charges a convoy fuel scaled by cargo mass, reduced on the lane", () => {
    const consumedSelling = (qty: number) => {
      const { eng, a } = setup();
      eng.galaxy.system("s0").stockpile.metals = 500;
      const beforeFuel = eng.galaxy.system("s0").stockpile.fuel;
      eng.setHumanOrders(a.id, [{ kind: "market", side: "sell", resource: "metals", quantity: qty, limitPrice: 1, systemId: "s0", strict: false }]);
      eng.stepTurn(); // the sell convoy launches this turn and is charged freighter fuel
      return beforeFuel - eng.galaxy.system("s0").stockpile.fuel;
    };
    const light = consumedSelling(20);
    const heavy = consumedSelling(80);
    expect(light).toBeGreaterThan(0); // freighters now burn fuel to move mass
    expect(heavy).toBeGreaterThan(light); // and a heavier shipment burns more
  });

  it("emits last-turn fleet legs to their owner but redacts them from rivals (fog of war)", () => {
    const { eng, a } = setup();
    eng.setHumanOrders(a.id, [{ kind: "moveFleet", fromSystemId: "s0", toSystemId: "sOff" }]);
    eng.stepTurn(); // launch + advance + arrive in one turn → the leg is recorded this turn
    const mine = buildClientState(eng, a.id, "g", []);
    const rivalId = eng.corps[1]!.id;
    const theirs = buildClientState(eng, rivalId, "g", []);
    expect(mine.movementLog.some((m) => m.kind === "fleet" && m.owner === a.id && m.toSystemId === "sOff")).toBe(true);
    // A rival never sees my fleet movement (their ships are fogged).
    expect(theirs.movementLog.some((m) => m.kind === "fleet" && m.owner === a.id)).toBe(false);
  });

  it("falls back to lane-only movement when the galaxy carries no positions", () => {
    // No `position` on any system → distanceBetween is null → off-lane is disabled. A fleet can
    // still march along charted lanes exactly as before.
    const l = (a: string, b: string) => ({ a, b, transitTime: 1, stability: 0.9, capacity: 40, exposure: 0.4, authorityPresence: 0.5, charted: true });
    const scen: Scenario = {
      name: "flat", hubId: "hub", players: 2, turns: 8, bots: ["noop"],
      systems: [
        { id: "hub", name: "Hub", yields: {}, claimCost: 0, upkeep: 0, defense: 99 },
        { id: "s0", name: "S0", yields: { metals: 5 }, claimCost: 1000, upkeep: 0, defense: 2, innerRing: true },
        { id: "s1", name: "S1", yields: { metals: 5 }, claimCost: 1000, upkeep: 0, defense: 2, innerRing: true },
      ],
      routes: [l("hub", "s0"), l("hub", "s1")],
    };
    const eng = new Engine(loadScenario(scen), 1, reg());
    const a = eng.corps[0]!;
    for (const sys of eng.galaxy.allSystems()) if (sys.id !== "hub") sys.owner = null;
    a.ownedSystemIds = ["s0"]; a.hasCharter = true; a.isFreeOperator = false;
    eng.galaxy.system("s0").owner = a.id;
    a.ships = [{ rangeTier: 1, combat: 6, raider: false, stationedAt: "s0" }];
    eng.makeHybrid(a.id);
    expect(eng.galaxy.distanceBetween("s0", "s1")).toBeNull();
    eng.setHumanOrders(a.id, [{ kind: "moveFleet", fromSystemId: "s0", toSystemId: "s1" }]);
    eng.stepTurn();
    const tr = a.ships[0]!.transit!;
    expect(tr.routeIds.length).toBeGreaterThan(0);
    expect(tr.routeIds.every((r) => r !== "")).toBe(true); // marched via the hub lane, never off-lane
  });
});
