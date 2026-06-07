/**
 * Research & specialization (Section 28): RP generation from labs, completing a queued tech and its
 * live effect, choice-node lockouts, and conquest seizing 1–3 of the loser's techs.
 */
import { describe, expect, it } from "vitest";
import { Engine } from "../src/engine/engine.js";
import { loadScenario, type Scenario } from "../src/engine/config.js";
import { getBodyBuildings, primaryBodyKey } from "../src/engine/bodies.js";
import { canResearch, researchMods, techById } from "../src/engine/research.js";
import type { Bot, BotFactory, PlayerView } from "../src/engine/bots/bot.js";
import type { BidOrder, Order } from "../src/engine/types.js";

class NoopBot implements Bot {
  readonly id = "noop";
  bid(): BidOrder { return { kind: "bid", priorities: [] }; }
  decide(): Order[] { return []; }
}
const reg = (): Map<string, BotFactory> => new Map([["noop", () => new NoopBot()]]);

function lane(a: string, b: string) {
  return { a, b, transitTime: 1, stability: 0.9, capacity: 40, exposure: 0.3, authorityPresence: 0.5, requiredRange: 1 as const, charted: true };
}
function scenario(players: number, n: number): Scenario {
  const systems = [{ id: "hub", name: "Hub", yields: {}, claimCost: 0, upkeep: 0, defense: 99 }];
  const routes = [];
  for (let i = 0; i < n; i++) {
    systems.push({ id: `s${i}`, name: `S${i}`, yields: { metals: 10 }, claimCost: 1000, upkeep: 0, defense: 2, innerRing: true } as never);
    routes.push(lane("hub", `s${i}`));
    if (i > 0) routes.push(lane(`s${i - 1}`, `s${i}`));
  }
  return { name: "research", hubId: "hub", players, turns: 30, bots: ["noop"], systems, routes };
}

describe("research (Section 28)", () => {
  it("labs generate RP, complete a queued tech, and apply its effect", () => {
    const eng = new Engine(loadScenario(scenario(1, 1)), 0, reg());
    const corp = eng.corps[0]!;
    const sys = eng.galaxy.system("s0");
    sys.owner = corp.id; corp.ownedSystemIds = ["s0"]; corp.hasCharter = true; corp.isFreeOperator = false;
    getBodyBuildings(sys, primaryBodyKey(sys)).labs = 2; // 2 × 24 RP = 48/turn
    corp.research.queue = ["pro-extractors"]; // 200 RP → ~5 turns

    expect(researchMods(corp.research.completed).yieldMult).toBeCloseTo(1, 6);
    for (let i = 0; i < 6; i++) eng.stepTurn();

    expect(corp.research.completed).toContain("pro-extractors");
    expect(researchMods(corp.research.completed).yieldMult).toBeCloseTo(1.15, 5); // effect live
  });

  it("a choice node locks out its sibling once one is taken", () => {
    const fork = techById("pro-deepcore")!;
    expect(canResearch(fork, ["pro-extractors"])).toBe(true); // prereq met, nothing chosen yet
    // Having taken the sibling (hydrofrac) locks out deep-core.
    expect(canResearch(fork, ["pro-extractors", "pro-hydrofrac"])).toBe(false);
  });

  it("conquering a charter seizes 1–3 of its techs", () => {
    const eng = new Engine(loadScenario(scenario(2, 2)), 1, reg());
    const [a, d] = eng.corps;
    for (const s of eng.galaxy.allSystems()) if (s.id !== "hub") s.owner = null;
    a!.ownedSystemIds = ["s0"]; a!.hasCharter = true; a!.isFreeOperator = false; eng.galaxy.system("s0").owner = a!.id;
    d!.ownedSystemIds = ["s1"]; d!.hasCharter = true; d!.isFreeOperator = false; eng.galaxy.system("s1").owner = d!.id;
    // Defender holds several techs; attacker holds none and fields an overwhelming fleet.
    d!.research.completed = ["pro-extractors", "fab-assembly", "col-habitat", "sec-plating", "acq-algorithms"];
    a!.ships = [{ rangeTier: 1, combat: 60, raider: false, stationedAt: "s0" }];
    eng.makeHybrid(a!.id);
    eng.setHumanOrders(a!.id, [{ kind: "invade", systemId: "s1" }]);
    eng.stepTurn();

    expect(eng.galaxy.system("s1").owner).toBe(a!.id); // captured
    const gained = a!.research.completed;
    expect(gained.length).toBeGreaterThanOrEqual(1);
    expect(gained.length).toBeLessThanOrEqual(3); // 1–3 transferred
    expect(gained.every((id) => d!.research.completed.includes(id))).toBe(true); // all came from the loser
  });
});
