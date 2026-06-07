/**
 * Survey vessels (Section 25): an unarmed scout flies to a system — even a rival's — surveys all its
 * deposits (revealing richness + reserves to the surveyor's fog of war), then returns home.
 */
import { describe, expect, it } from "vitest";
import { Engine } from "../src/engine/engine.js";
import { loadScenario, type Scenario } from "../src/engine/config.js";
import { buildClientState } from "../src/engine/clientState.js";
import type { Bot, BotFactory, PlayerView } from "../src/engine/bots/bot.js";
import type { BidOrder, Order } from "../src/engine/types.js";

class NoopBot implements Bot {
  readonly id = "noop";
  bid(): BidOrder { return { kind: "bid", priorities: [] }; }
  decide(): Order[] { return []; }
}
const reg = (): Map<string, BotFactory> => new Map([["noop", () => new NoopBot()]]);

function scenario(): Scenario {
  const lane = (a: string, b: string) => ({ a, b, transitTime: 1, stability: 0.9, capacity: 40, exposure: 0.3, authorityPresence: 0.5, requiredRange: 1 as const, charted: true });
  return {
    name: "survey", hubId: "hub", players: 2, turns: 24, bots: ["noop"],
    systems: [
      { id: "hub", name: "Hub", yields: {}, claimCost: 0, upkeep: 0, defense: 99 },
      { id: "s0", name: "S0", yields: {}, claimCost: 1000, upkeep: 0, defense: 2, innerRing: true,
        bodies: { starType: "mainSequence", planets: [{ type: "ocean", orbit: 1, habitable: true, visualSeed: 0, deposits: [{ resource: "food", richness: 8, reserves: null, accessibility: 1 }] }], asteroidBelts: [] } },
      { id: "s1", name: "S1", yields: {}, claimCost: 1000, upkeep: 0, defense: 2, innerRing: true,
        bodies: { starType: "mainSequence", planets: [{ type: "rocky", orbit: 1, habitable: false, visualSeed: 0, deposits: [{ resource: "metals", richness: 12, reserves: 500, accessibility: 1 }] }], asteroidBelts: [] } },
    ],
    routes: [lane("hub", "s0"), lane("hub", "s1"), lane("s0", "s1")],
  };
}

describe("survey vessel (Section 25)", () => {
  it("scouts a rival system and reveals its deposit intel to the surveyor only", () => {
    const eng = new Engine(loadScenario(scenario()), 1, reg());
    const [a, b] = eng.corps;
    // Deterministic board: corp-0 owns S0, corp-1 owns S1; S1's deposit is dark (unworked).
    for (const sys of eng.galaxy.allSystems()) if (sys.id !== "hub") sys.owner = null;
    a!.ownedSystemIds = ["s0"]; a!.hasCharter = true; a!.isFreeOperator = false; eng.galaxy.system("s0").owner = a!.id;
    b!.ownedSystemIds = ["s1"]; b!.hasCharter = true; b!.isFreeOperator = false; eng.galaxy.system("s1").owner = b!.id;
    for (const site of eng.galaxy.system("s1").sites) { site.extractorLevel = 0; site.prospected = false; }
    // corp-0 fields a survey vessel at S0.
    a!.ships = [{ rangeTier: 1, combat: 0, raider: false, surveyor: true, stationedAt: "s0" }];
    eng.makeHybrid(a!.id);

    // Before surveying, the rival's deposit richness is hidden from corp-0.
    const s1Before = buildClientState(eng, a!.id, "g", []).systems.find((s) => s.id === "s1")!;
    expect(s1Before.sites[0]!.richness).toBeNull();
    expect(s1Before.sites[0]!.reservesRemaining).toBeNull();

    // Dispatch the survey vessel to scout S1.
    eng.setHumanOrders(a!.id, [{ kind: "surveySystem", fromSystemId: "s0", targetSystemId: "s1" }]);
    eng.stepTurn();
    eng.setHumanOrders(a!.id, []);
    for (let i = 0; i < 4; i++) eng.stepTurn(); // travel → arrive → survey → head home

    // The surveyor now holds full intel on S1; the rival owner does not see corp-0's knowledge.
    expect(a!.surveyedSystemIds).toContain("s1");
    const s1After = buildClientState(eng, a!.id, "g", []).systems.find((s) => s.id === "s1")!;
    expect(s1After.sites[0]!.richness).toBe(12);
    expect(s1After.sites[0]!.reservesRemaining).toBe(500);
    // The intel is per-corp fog — surveying does NOT flip the deposit's global "publicly worked"
    // flag, so the knowledge stays private to the surveyor rather than leaking to everyone.
    expect(eng.galaxy.system("s1").sites[0]!.prospected).toBe(false);

    // The scout is not stranded in rival territory — it's home or on its way back.
    const scout = a!.ships.find((s) => s.surveyor)!;
    expect(scout.stationedAt === "s0" || scout.stationedAt === "" || scout.transit !== undefined).toBe(true);
    expect(scout.stationedAt).not.toBe("s1");
  });
});
