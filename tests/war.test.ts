/**
 * War & conquest (Section 23): invasion capture/repel, the aggressor market lockout + ceasefire,
 * defensive-alliance reinforcement, and ally immunity.
 */
import { describe, expect, it } from "vitest";
import { Engine } from "../src/engine/engine.js";
import { DEFAULT_TUNING, loadScenario, type Scenario } from "../src/engine/config.js";
import type { Bot, BotFactory, PlayerView } from "../src/engine/bots/bot.js";
import type { BidOrder, Order } from "../src/engine/types.js";

/** Hub + three fully-interconnected inner systems (all charted Range-1 lanes). */
function warScenario(): Scenario {
  const lane = (a: string, b: string) => ({ a, b, transitTime: 1, stability: 0.9, capacity: 40, exposure: 0.4, authorityPresence: 0.5, charted: true });
  return {
    name: "war", hubId: "hub", players: 3, turns: 16, bots: ["noop"],
    systems: [
      { id: "hub", name: "Hub", yields: {}, claimCost: 0, upkeep: 0, defense: 99 },
      { id: "s0", name: "S0", yields: { metals: 10 }, claimCost: 1000, upkeep: 0, defense: 2, innerRing: true },
      { id: "s1", name: "S1", yields: { metals: 10 }, claimCost: 1000, upkeep: 0, defense: 2, innerRing: true },
      { id: "s2", name: "S2", yields: { metals: 10 }, claimCost: 1000, upkeep: 0, defense: 2, innerRing: true },
    ],
    routes: [lane("hub", "s0"), lane("hub", "s1"), lane("hub", "s2"), lane("s0", "s1"), lane("s1", "s2"), lane("s0", "s2")],
  };
}

class NoopBot implements Bot {
  readonly id = "noop";
  bid(): BidOrder { return { kind: "bid", priorities: [] }; }
  decide(): Order[] { return []; }
}
const reg = (): Map<string, BotFactory> => new Map([["noop", () => new NoopBot()]]);

/**
 * Deterministic 3-charter board: corp-0 owns S0 (attacker), corp-1 owns S1 (defender),
 * corp-2 owns S2. The attacker gets a fleet at S0; options arm the defender / its ally.
 */
function setup(opts: { attackerCombat: number; defenderEscort?: number; ally2?: boolean; ally2Combat?: number }) {
  const eng = new Engine(loadScenario(warScenario()), 1, reg());
  const [a, d, third] = eng.corps;
  for (const sys of eng.galaxy.allSystems()) if (sys.id !== "hub") sys.owner = null;
  const own = (corp: NonNullable<typeof a>, id: string) => { corp.ownedSystemIds = [id]; corp.hasCharter = true; corp.isFreeOperator = false; eng.galaxy.system(id).owner = corp.id; };
  own(a!, "s0"); own(d!, "s1"); own(third!, "s2");
  a!.ships = [{ rangeTier: 1, combat: opts.attackerCombat, raider: false, stationedAt: "s0" }];
  if (opts.defenderEscort) d!.ships = [{ rangeTier: 1, combat: opts.defenderEscort, raider: false, stationedAt: "s1" }];
  if (opts.ally2) {
    d!.alliancePledges = [third!.id];
    third!.alliancePledges = [d!.id];
    third!.ships = [{ rangeTier: 1, combat: opts.ally2Combat ?? 0, raider: false, stationedAt: "s2" }];
  }
  eng.makeHybrid(a!.id);
  return { eng, a: a!, d: d!, third: third! };
}

describe("war & conquest (Section 23)", () => {
  it("captures a weakly-defended system with an overwhelming fleet and declares war", () => {
    const { eng, a, d } = setup({ attackerCombat: 30 });
    eng.setHumanOrders(a.id, [{ kind: "invade", systemId: "s1" }]);
    eng.stepTurn();
    expect(eng.galaxy.system("s1").owner).toBe(a.id);
    expect(a.ownedSystemIds).toContain("s1");
    expect(d.ownedSystemIds).not.toContain("s1");
    expect(eng.activeWars.some((w) => w.aggressorId === a.id && w.defenderId === d.id)).toBe(true);
  });

  it("is repelled by a strong defense, costing the attacker ships, but still starts the war", () => {
    const { eng, a } = setup({ attackerCombat: 10, defenderEscort: 24 });
    eng.setHumanOrders(a.id, [{ kind: "invade", systemId: "s1" }]);
    eng.stepTurn();
    expect(eng.galaxy.system("s1").owner).not.toBe(a.id); // not captured
    expect(a.ships.reduce((s, sh) => s + sh.combat, 0)).toBeLessThan(10); // took losses
    expect(eng.warTariffFor(a.id)).toBeGreaterThan(0); // war declared regardless
  });

  it("tariffs the aggressor's Exchange trades until a ceasefire ends the war", () => {
    const { eng, a } = setup({ attackerCombat: 30 });
    eng.setHumanOrders(a.id, [{ kind: "invade", systemId: "s1" }]);
    eng.stepTurn(); // turn 1: war declared, endTurn = 1 + durationTurns(6) = 7
    eng.setHumanOrders(a.id, null);
    expect(eng.warTariffFor(a.id)).toBeGreaterThan(0);
    for (let i = 0; i < 6; i++) eng.stepTurn(); // through turn 7 — ceasefire
    expect(eng.warTariffFor(a.id)).toBe(0);
  });

  it("an aggressor still trades but its Exchange proceeds are tariffed", () => {
    const tariff = DEFAULT_TUNING.war.aggressorTariff;
    const sell = (atWar: boolean): number => {
      const { eng, a } = setup({ attackerCombat: 30 });
      eng.galaxy.system("s0").stockpile.metals = 100;
      if (atWar) { eng.setHumanOrders(a.id, [{ kind: "invade", systemId: "s1" }]); eng.stepTurn(); }
      const before = a.credits;
      eng.setHumanOrders(a.id, [{ kind: "market", side: "sell", resource: "metals", quantity: 40, limitPrice: 1, systemId: "s0", strict: false }]);
      eng.stepTurn();
      // Export pays on arrival (1-turn hub lane), so advance one more turn to collect.
      eng.setHumanOrders(a.id, null);
      eng.stepTurn();
      return a.credits - before;
    };
    const peace = sell(false);
    const war = sell(true);
    expect(tariff).toBeGreaterThan(0);
    expect(war).toBeGreaterThan(0); // trade still flows (not a full lockout)
    expect(war).toBeLessThan(peace); // but the war tariff skims the proceeds
  });

  it("a defensive alliance reinforces the defender, turning a capture into a repel", () => {
    // Without the ally, attack 20 vs defense ~2 would capture; the ally's 40 combat at adjacent
    // S2 reinforces S1's defense past the capture threshold.
    const { eng, a } = setup({ attackerCombat: 20, ally2: true, ally2Combat: 40 });
    eng.setHumanOrders(a.id, [{ kind: "invade", systemId: "s1" }]);
    eng.stepTurn();
    expect(eng.galaxy.system("s1").owner).not.toBe(a.id); // alliance held the line
  });

  it("redeploys a warship to concentrate force, enabling a capture that single-system force couldn't", () => {
    // Attacker owns S0 (adjacent to defender's S1) and S2 (adjacent to S1 too), with a warship at
    // each. Neither alone beats the defense; mobilising S2's fleet to S0 concentrates enough force.
    const { eng, a } = setup({ attackerCombat: 7, defenderEscort: 8 });
    a.ownedSystemIds = ["s0", "s2"];
    eng.galaxy.system("s2").owner = a.id;
    a.ships = [
      { rangeTier: 1, combat: 7, raider: false, stationedAt: "s0" },
      { rangeTier: 1, combat: 7, raider: false, stationedAt: "s2" },
    ];
    // Redeploy S2's warship to S0, then invade S1 with the combined 14 vs defense ~12.
    eng.setHumanOrders(a.id, [
      { kind: "redeployShip", fromSystemId: "s2", toSystemId: "s0" },
      { kind: "invade", systemId: "s1" },
    ]);
    eng.stepTurn();
    expect(eng.galaxy.system("s1").owner).toBe(a.id); // concentrated force took the system
  });

  it("allies cannot invade each other", () => {
    const { eng, a, d } = setup({ attackerCombat: 30 });
    a.alliancePledges = [d.id];
    d.alliancePledges = [a.id];
    eng.setHumanOrders(a.id, [{ kind: "invade", systemId: "s1" }]);
    eng.stepTurn();
    expect(eng.galaxy.system("s1").owner).toBe(d.id); // invasion ignored between allies
    expect(eng.activeWars.length).toBe(0);
  });
});
