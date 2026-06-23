/**
 * Ship-mounted sensors → rival fleet contacts (Section 04). Each of the viewer's ships projects a
 * sensor bubble; a rival fleet IN TRANSIT inside any bubble surfaces as a `ClientContact` (current
 * leg + final heading + a rough force band). Fog of war: stationed garrisons and allies never blip,
 * and only those six fields leak — never the exact composition.
 */
import { describe, expect, it } from "vitest";
import { Engine } from "../src/engine/engine.js";
import { buildClientState } from "../src/engine/clientState.js";
import { loadScenario, type Scenario } from "../src/engine/config.js";
import type { Bot, BotFactory } from "../src/engine/bots/bot.js";
import type { BidOrder, Order, Ship, SystemRegion } from "../src/engine/types.js";

class NoopBot implements Bot {
  readonly id = "noop";
  bid(): BidOrder { return { kind: "bid", priorities: [] }; }
  decide(): Order[] { return []; }
}
const reg = (): Map<string, BotFactory> => new Map([["noop", () => new NoopBot()]]);
const at = (x: number, y: number, region: SystemRegion) => ({ x, y, region, visualSeed: 0 });
const lane = (a: string, b: string) => ({ a, b, transitTime: 1, stability: 0.9, capacity: 50, exposure: 0.3, authorityPresence: 0.6, requiredRange: 1 as const, charted: true });

/** A rival warship parked mid-leg between two systems (frac 0.5), so its atlas position is the
 *  segment midpoint. Off-lane ("" route ids) so it needs no real WarpRoute. */
const inTransit = (path: string[], combat: number): Ship => ({
  rangeTier: 1, combat, raider: false, stationedAt: "",
  transit: { path, routeIds: path.slice(1).map(() => ""), position: 0, segmentTurnsLeft: 1, segmentTimes: path.slice(1).map(() => 2), launchedTurn: 0, attack: false },
});

function scen(): Scenario {
  return {
    name: "sensors", hubId: "hub", players: 2, turns: 12, bots: ["noop"],
    systems: [
      { id: "hub", name: "Hub", yields: {}, claimCost: 0, upkeep: 0, defense: 99, position: at(0, -2000, "hub") },
      { id: "s0", name: "S0", yields: { metals: 5 }, claimCost: 1000, upkeep: 0, defense: 2, innerRing: true, position: at(0, 0, "core") },
      { id: "sA", name: "SA", yields: { metals: 5 }, claimCost: 1000, upkeep: 0, defense: 2, position: at(100, 0, "core") },
      { id: "sB", name: "SB", yields: { metals: 5 }, claimCost: 1000, upkeep: 0, defense: 2, position: at(300, 0, "core") },
      { id: "sFarA", name: "SFarA", yields: { metals: 5 }, claimCost: 1000, upkeep: 0, defense: 2, position: at(5000, 0, "abyss") },
      { id: "sFarB", name: "SFarB", yields: { metals: 5 }, claimCost: 1000, upkeep: 0, defense: 2, position: at(5300, 0, "abyss") },
      { id: "sR", name: "SR", yields: { metals: 5 }, claimCost: 1000, upkeep: 0, defense: 2, position: at(400, 2000, "frontier") },
    ],
    routes: [lane("hub", "s0")],
  };
}

/** corp-0 = the viewer with a picket ship at s0 (sensor range 500); corp-1 = the rival. */
function setup() {
  const eng = new Engine(loadScenario(scen()), 1, reg());
  const [me, rival] = [eng.corps[0]!, eng.corps[1]!];
  for (const sys of eng.galaxy.allSystems()) if (sys.id !== "hub") sys.owner = null;
  me.ownedSystemIds = ["s0"]; me.hasCharter = true; me.isFreeOperator = false;
  eng.galaxy.system("s0").owner = me.id;
  rival.ownedSystemIds = ["sR"]; rival.hasCharter = true; rival.isFreeOperator = false;
  eng.galaxy.system("sR").owner = rival.id;
  me.ships = [{ rangeTier: 1, combat: 6, raider: false, stationedAt: "s0" }];
  return { eng, me, rival };
}

describe("ship-mounted sensors (Section 04)", () => {
  it("detects a rival fleet in transit within a ship's sensor range", () => {
    const { eng, me, rival } = setup();
    rival.ships = [inTransit(["sA", "sB"], 10)]; // midpoint (200,0) — 200 from the s0 picket, range 500
    const cs = buildClientState(eng, me.id, "g", []);
    expect(cs.contacts.length).toBe(1);
    const c = cs.contacts[0]!;
    expect(c.owner).toBe(rival.id);
    expect(c.fromSystemId).toBe("sA");
    expect(c.toSystemId).toBe("sB");
    expect(c.headingSystemId).toBe("sB");
    expect(c.offLane).toBe(true);
    expect(c.forceEstimate).toBe("medium"); // combat 10 → 8..20
  });

  it("does not detect a rival beyond sensor range", () => {
    const { eng, me, rival } = setup();
    rival.ships = [inTransit(["sFarA", "sFarB"], 10)]; // ~5150 from the picket
    expect(buildClientState(eng, me.id, "g", []).contacts).toEqual([]);
  });

  it("never blips a stationed rival garrison, even within range", () => {
    const { eng, me, rival } = setup();
    rival.ships = [{ rangeTier: 1, combat: 50, raider: false, stationedAt: "sA" }]; // 100 from picket, but parked
    expect(buildClientState(eng, me.id, "g", []).contacts).toEqual([]);
  });

  it("does not blip an allied fleet", () => {
    const { eng, me, rival } = setup();
    me.alliancePledges = [rival.id]; rival.alliancePledges = [me.id];
    rival.ships = [inTransit(["sA", "sB"], 10)];
    expect(buildClientState(eng, me.id, "g", []).contacts).toEqual([]);
  });

  it("groups co-located rivals into one contact and sums their force band", () => {
    const { eng, me, rival } = setup();
    rival.ships = [inTransit(["sA", "sB"], 10), inTransit(["sA", "sB"], 10)]; // same leg + launchedTurn → one group
    const cs = buildClientState(eng, me.id, "g", []);
    expect(cs.contacts.length).toBe(1);
    expect(cs.contacts[0]!.forceEstimate).toBe("heavy"); // 20 combat → ≥20
  });

  it("disables sensors on a position-less galaxy", () => {
    const flat: Scenario = {
      name: "flat", hubId: "hub", players: 2, turns: 8, bots: ["noop"],
      systems: [
        { id: "hub", name: "Hub", yields: {}, claimCost: 0, upkeep: 0, defense: 99 },
        { id: "s0", name: "S0", yields: { metals: 5 }, claimCost: 1000, upkeep: 0, defense: 2, innerRing: true },
        { id: "s1", name: "S1", yields: { metals: 5 }, claimCost: 1000, upkeep: 0, defense: 2 },
        { id: "s2", name: "S2", yields: { metals: 5 }, claimCost: 1000, upkeep: 0, defense: 2 },
      ],
      routes: [{ a: "hub", b: "s0", transitTime: 1, stability: 0.9, capacity: 40, exposure: 0.4, authorityPresence: 0.5, charted: true }],
    };
    const eng = new Engine(loadScenario(flat), 1, reg());
    const [me, rival] = [eng.corps[0]!, eng.corps[1]!];
    for (const sys of eng.galaxy.allSystems()) if (sys.id !== "hub") sys.owner = null;
    me.ownedSystemIds = ["s0"]; eng.galaxy.system("s0").owner = me.id;
    me.ships = [{ rangeTier: 1, combat: 6, raider: false, stationedAt: "s0" }];
    rival.ships = [inTransit(["s1", "s2"], 10)];
    expect(buildClientState(eng, me.id, "g", []).contacts).toEqual([]);
  });

  it("produces byte-identical contacts when built twice (determinism)", () => {
    const { eng, me, rival } = setup();
    rival.ships = [inTransit(["sA", "sB"], 10)];
    expect(buildClientState(eng, me.id, "g", []).contacts).toEqual(buildClientState(eng, me.id, "g", []).contacts);
  });

  it("leaks only the leg, heading, off-lane flag, owner and a force band — never composition", () => {
    const { eng, me, rival } = setup();
    rival.ships = [inTransit(["sA", "sB"], 10)];
    const c = buildClientState(eng, me.id, "g", []).contacts[0]!;
    expect(Object.keys(c).sort()).toEqual(["forceEstimate", "fromSystemId", "headingSystemId", "offLane", "owner", "toSystemId"]);
  });
});
