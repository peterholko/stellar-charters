/**
 * Warp Disruptor platform (Section 04). A buildable (instant, one-per-system) that holds any rival
 * fleet whose destination is the disruptor system for `disruptorDelay` extra turns on its final
 * approach. Own/allied arrivals are never slowed. Built like a Trade Depot (owner-only, not for Free
 * Operators, charged credits + materials).
 */
import { describe, expect, it } from "vitest";
import { Engine } from "../src/engine/engine.js";
import { loadScenario, type Scenario } from "../src/engine/config.js";
import type { Bot, BotFactory } from "../src/engine/bots/bot.js";
import type { BidOrder, Order } from "../src/engine/types.js";

class NoopBot implements Bot {
  readonly id = "noop";
  bid(): BidOrder { return { kind: "bid", priorities: [] }; }
  decide(): Order[] { return []; }
}
const reg = (): Map<string, BotFactory> => new Map([["noop", () => new NoopBot()]]);
// Position-less lanes so a move is lane-bound (no off-lane shortcut) and single-segment.
const lane = (a: string, b: string, transitTime = 1) => ({ a, b, transitTime, stability: 0.9, capacity: 40, exposure: 0.4, authorityPresence: 0.5, charted: true });

function scen(): Scenario {
  return {
    name: "disruptor", hubId: "hub", players: 2, turns: 16, bots: ["noop"],
    systems: [
      { id: "hub", name: "Hub", yields: {}, claimCost: 0, upkeep: 0, defense: 99 },
      { id: "s0", name: "S0", yields: { metals: 5 }, claimCost: 1000, upkeep: 0, defense: 2, innerRing: true },
      { id: "sTarget", name: "STarget", yields: { metals: 5 }, claimCost: 1000, upkeep: 0, defense: 2 },
      { id: "sOwn", name: "SOwn", yields: { metals: 5 }, claimCost: 1000, upkeep: 0, defense: 2 },
    ],
    routes: [lane("hub", "s0"), lane("s0", "sTarget"), lane("s0", "sOwn")],
  };
}

/** corp-0 = attacker (owns s0 + sOwn, with a strong fleet); corp-1 = defender (owns sTarget). */
function setup() {
  const eng = new Engine(loadScenario(scen()), 1, reg());
  const [atk, def] = [eng.corps[0]!, eng.corps[1]!];
  for (const sys of eng.galaxy.allSystems()) if (sys.id !== "hub") sys.owner = null;
  atk.ownedSystemIds = ["s0", "sOwn"]; atk.hasCharter = true; atk.isFreeOperator = false;
  eng.galaxy.system("s0").owner = atk.id; eng.galaxy.system("sOwn").owner = atk.id;
  def.ownedSystemIds = ["sTarget"]; def.hasCharter = true; def.isFreeOperator = false;
  eng.galaxy.system("sTarget").owner = def.id;
  eng.galaxy.system("s0").stockpile.fuel = 100000;
  atk.ships = [{ rangeTier: 1, combat: 30, raider: false, stationedAt: "s0" }];
  eng.makeHybrid(atk.id);
  return { eng, atk, def };
}

/** Turns from order to the fleet leaving transit (arrival / battle resolution). */
function turnsToResolve(eng: Engine, atkId: string, atk: { ships: { transit?: unknown }[] }, to: string): number {
  eng.setHumanOrders(atkId, [{ kind: "moveFleet", fromSystemId: "s0", toSystemId: to }]);
  eng.stepTurn();
  eng.setHumanOrders(atkId, null);
  let turns = 1;
  while (atk.ships.some((s) => s.transit) && turns < 12) { eng.stepTurn(); turns++; }
  return turns;
}

describe("warp disruptor — fleet hold (Section 04)", () => {
  it("holds a rival fleet's arrival by exactly disruptorDelay turns", () => {
    const baseEng = setup();
    const base = turnsToResolve(baseEng.eng, baseEng.atk.id, baseEng.atk, "sTarget");

    const heldEng = setup();
    heldEng.eng.galaxy.system("sTarget").hasDisruptor = true;
    const held = turnsToResolve(heldEng.eng, heldEng.atk.id, heldEng.atk, "sTarget");

    expect(held - base).toBe(heldEng.eng.config.tuning.disruptorDelay);
  });

  it("does not slow a move into your OWN disruptor system", () => {
    const { eng, atk } = setup();
    eng.galaxy.system("sOwn").hasDisruptor = true;
    eng.setHumanOrders(atk.id, [{ kind: "moveFleet", fromSystemId: "s0", toSystemId: "sOwn" }]);
    eng.stepTurn(); // single-segment lane, launch counts → arrives this turn, no hold
    expect(atk.ships.some((s) => s.transit)).toBe(false);
    expect(atk.ships.some((s) => s.stationedAt === "sOwn")).toBe(true);
  });

  it("does not slow a move into an ALLIED disruptor system", () => {
    const { eng, atk, def } = setup();
    eng.galaxy.system("sTarget").hasDisruptor = true;
    atk.alliancePledges = [def.id]; def.alliancePledges = [atk.id];
    eng.setHumanOrders(atk.id, [{ kind: "moveFleet", fromSystemId: "s0", toSystemId: "sTarget" }]);
    eng.stepTurn();
    expect(atk.ships.some((s) => s.transit)).toBe(false); // peaceful, undisrupted arrival in one turn
    expect(atk.ships.some((s) => s.stationedAt === "sTarget")).toBe(true);
  });

  it("resolves a disrupted assault identically from the same seed (determinism)", () => {
    const run = () => {
      const { eng, atk } = setup();
      eng.galaxy.system("sTarget").hasDisruptor = true;
      eng.setHumanOrders(atk.id, [{ kind: "moveFleet", fromSystemId: "s0", toSystemId: "sTarget" }]);
      for (let i = 0; i < 8; i++) { eng.stepTurn(); eng.setHumanOrders(atk.id, null); }
      return { owner: eng.galaxy.system("sTarget").owner, fuel: eng.galaxy.system("s0").stockpile.fuel };
    };
    expect(run()).toEqual(run());
  });
});

describe("warp disruptor — build rules (Section 04)", () => {
  it("builds a disruptor for a solvent owner and charges credits", () => {
    const { eng, atk } = setup();
    eng.galaxy.system("s0").stockpile.alloys = 1000;
    eng.galaxy.system("s0").stockpile.components = 1000;
    atk.credits = 100000;
    const before = atk.credits;
    eng.setHumanOrders(atk.id, [{ kind: "buildDisruptor", systemId: "s0" }]);
    eng.stepTurn();
    expect(eng.galaxy.system("s0").hasDisruptor).toBe(true);
    expect(atk.credits).toBeLessThan(before);

    // Cap of one: a second build is a no-op and never charges the cost again.
    const beforeSecond = atk.credits;
    eng.setHumanOrders(atk.id, [{ kind: "buildDisruptor", systemId: "s0" }]);
    eng.stepTurn();
    expect(beforeSecond - atk.credits).toBeLessThan(eng.config.tuning.disruptorCost);
    expect(eng.galaxy.system("s0").hasDisruptor).toBe(true);
  });

  it("refuses a disruptor on a system you don't own", () => {
    const { eng, atk } = setup();
    eng.galaxy.system("s0").stockpile.alloys = 1000;
    eng.galaxy.system("s0").stockpile.components = 1000;
    atk.credits = 100000;
    eng.setHumanOrders(atk.id, [{ kind: "buildDisruptor", systemId: "sTarget" }]); // owned by the defender
    eng.stepTurn();
    expect(eng.galaxy.system("sTarget").hasDisruptor).toBe(false);
  });

  it("refuses a disruptor for a Free Operator", () => {
    const { eng, atk } = setup();
    atk.isFreeOperator = true;
    eng.galaxy.system("s0").stockpile.alloys = 1000;
    eng.galaxy.system("s0").stockpile.components = 1000;
    atk.credits = 100000;
    eng.setHumanOrders(atk.id, [{ kind: "buildDisruptor", systemId: "s0" }]);
    eng.stepTurn();
    expect(eng.galaxy.system("s0").hasDisruptor).toBe(false);
  });

  it("refuses a disruptor the owner can't afford", () => {
    const { eng, atk } = setup();
    eng.galaxy.system("s0").stockpile.alloys = 1000;
    eng.galaxy.system("s0").stockpile.components = 1000;
    atk.credits = 10;
    eng.setHumanOrders(atk.id, [{ kind: "buildDisruptor", systemId: "s0" }]);
    eng.stepTurn();
    expect(eng.galaxy.system("s0").hasDisruptor).toBe(false);
  });
});
