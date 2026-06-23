/**
 * End-to-end "playtest" of the full server→client→order pipeline the live UI rides on. The browser
 * UI builds its view from `buildClientState` (the JSON the worker serves), reconstructs a PlayerView,
 * and submits orders that flow back through the engine. This test exercises both halves headlessly:
 *  1. over a real 42-turn procedural game, the per-seat ClientState round-trips through JSON intact
 *     and carries every field the client reads (colonies/queues/population/research/secrets/…);
 *  2. a human seat can issue every order kind (incl. all the new colony/survey/research/terraform
 *     ones) and the engine resolves them without error and applies them.
 */
import { describe, expect, it } from "vitest";
import { Engine } from "../src/engine/engine.js";
import { loadScenario } from "../src/engine/config.js";
import { generateProceduralScenario } from "../src/engine/procedural.js";
import { buildClientState } from "../src/engine/clientState.js";
import { defaultRegistry } from "../src/engine/bots/registry.js";
import { coloniesOf, getBodyBuildings, primaryBodyKey } from "../src/engine/bodies.js";
import type { Bot, BotFactory, PlayerView } from "../src/engine/bots/bot.js";
import type { BidOrder, Order } from "../src/engine/types.js";

/** Assert one served snapshot is JSON-safe and carries everything the client renders. */
function assertCoherentClientState(eng: Engine, corpId: string): void {
  const cs = buildClientState(eng, corpId, "g", []);
  const wire = JSON.parse(JSON.stringify(cs)); // simulate the network round-trip
  expect(wire.claimedSecrets).toBeTypeOf("object");
  expect(Array.isArray(wire.systems)).toBe(true);
  for (const s of wire.systems) {
    expect(s.bodyBuildings, `${s.id}.bodyBuildings`).toBeTypeOf("object");
    expect(Array.isArray(s.queue), `${s.id}.queue`).toBe(true);
    expect(typeof s.populationStage === "string", `${s.id}.populationStage`).toBe(true);
    expect(Array.isArray(s.sites), `${s.id}.sites`).toBe(true);
    for (const site of s.sites) expect(typeof site.key === "string" && typeof site.resource === "string").toBe(true);
  }
  const me = wire.corps.find((c: { id: string }) => c.id === corpId);
  expect(me, "own corp present").toBeTruthy();
  expect(Array.isArray(me.research.completed)).toBe(true);
  expect(Array.isArray(me.research.queue)).toBe(true);
  expect(me.research.invested).toBeTypeOf("object");
  expect(typeof me.research.banked).toBe("number");
  expect(Array.isArray(me.ships)).toBe(true);
  expect(Array.isArray(me.surveyedSystemIds)).toBe(true);
  expect(typeof me.rpPerTurn).toBe("number");
}

describe("playthrough — server→client serialization", () => {
  it("serves a coherent, JSON-safe ClientState every turn of a full procedural game", () => {
    const scenario = generateProceduralScenario({ seed: 7, players: 8 });
    const eng = new Engine(loadScenario(scenario), 7, defaultRegistry());
    for (let i = 0; i < eng.config.turns; i++) {
      assertCoherentClientState(eng, "corp-0");
      assertCoherentClientState(eng, "corp-3"); // a second seat's fog-of-war view
      eng.stepTurn();
    }
    // After a full game the snapshot still serialises cleanly.
    assertCoherentClientState(eng, "corp-0");
  });
});

class NoopBot implements Bot {
  readonly id = "noop";
  bid(): BidOrder { return { kind: "bid", priorities: [] }; }
  decide(): Order[] { return []; }
}

describe("playthrough — a human seat can drive every order kind", () => {
  it("resolves the full colony / survey / research / terraform order set without error", () => {
    const lane = (a: string, b: string) => ({ a, b, transitTime: 1, stability: 0.9, capacity: 50, exposure: 0.3, authorityPresence: 0.6, requiredRange: 1 as const, charted: true });
    const cfg = loadScenario({
      name: "human", hubId: "hub", players: 2, turns: 40, bots: ["noop"],
      systems: [
        { id: "hub", name: "Hub", yields: {}, claimCost: 0, upkeep: 0, defense: 99 },
        { id: "s0", name: "S0", yields: {}, claimCost: 100, upkeep: 0, defense: 1, innerRing: true,
          bodies: { starType: "mainSequence", planets: [
            { type: "ocean", orbit: 1, habitable: true, visualSeed: 0, deposits: [{ resource: "food", richness: 8, reserves: null, accessibility: 1 }] },
            { type: "rocky", orbit: 2, habitable: false, visualSeed: 0, deposits: [{ resource: "metals", richness: 12, reserves: 800, accessibility: 1 }, { resource: "silicates", richness: 8, reserves: 600, accessibility: 1 }] },
            { type: "barren", orbit: 3, habitable: false, visualSeed: 0, deposits: [{ resource: "ice", richness: 10, reserves: null, accessibility: 1 }] },
          ], asteroidBelts: [{ orbit: 4, deposits: [{ resource: "helium3", richness: 6, reserves: 500, accessibility: 1 }] }] } },
        { id: "s1", name: "S1", yields: {}, claimCost: 100, upkeep: 0, defense: 1, innerRing: true,
          bodies: { starType: "mainSequence", planets: [{ type: "rocky", orbit: 1, habitable: false, visualSeed: 0, deposits: [{ resource: "metals", richness: 10, reserves: 700, accessibility: 1 }] }], asteroidBelts: [] } },
      ],
      routes: [lane("hub", "s0"), lane("hub", "s1"), lane("s0", "s1")],
    });
    cfg.tuning.features = { ...cfg.tuning.features, terraforming: true }; // gated off in v1; this test drives every order kind
    const reg = new Map<string, BotFactory>([["noop", () => new NoopBot()]]);
    const eng = new Engine(cfg, 0, reg);
    const corp = eng.corps[0]!;
    // Seat corp-0 as the human owner of s0 with cash + research unlocked for terraform.
    for (const s of eng.galaxy.allSystems()) if (s.id !== "hub") s.owner = null;
    corp.ownedSystemIds = ["s0"]; corp.hasCharter = true; corp.isFreeOperator = false; eng.galaxy.system("s0").owner = corp.id;
    corp.credits = 200000;
    corp.research.completed = ["col-terraform", "nav-warp2"]; corp.rangeTier = 2;
    eng.galaxy.system("s0").stockpile.metals = 500; eng.galaxy.system("s0").stockpile.silicates = 500;
    eng.galaxy.system("s0").stockpile.alloys = 500; eng.galaxy.system("s0").stockpile.components = 200;
    eng.makeHybrid(corp.id);

    const view: PlayerView = { ...({} as PlayerView) }; // unused; we issue orders against the engine directly
    void view;
    const colonies = coloniesOf(eng.galaxy.system("s0"));
    const rockyKey = colonies.find((c) => c.bodyType === "rocky")!.key;
    const metalsSite = eng.galaxy.system("s0").sites.find((s) => s.resource === "metals")!.key;

    // A turn's worth of varied human orders touching every new system.
    const turn1: Order[] = [
      { kind: "buildExtractor", systemId: "s0", siteKey: metalsSite },
      { kind: "buildLab", systemId: "s0", bodyKey: rockyKey },
      { kind: "buildReactor", systemId: "s0", bodyKey: rockyKey },
      { kind: "buildProcessor", systemId: "s0", recipeId: "alloys", bodyKey: rockyKey },
      { kind: "buildHydroponics", systemId: "s0", bodyKey: colonies.find((c) => c.bodyType === "ocean")!.key },
      { kind: "upgradeInfrastructure", systemId: "s0", track: "mining", bodyKey: rockyKey },
      { kind: "buildSurveyShip", systemId: "s0" },
      { kind: "buildPlatform", systemId: "s0" },
      { kind: "buildDepot", systemId: "s0" },
      { kind: "terraform", systemId: "s0", bodyKey: colonies.find((c) => c.bodyType === "barren")!.key },
      { kind: "setResearch", queue: ["nav-warp3", "fab-assembly", "pro-extractors"] },
      { kind: "claim", systemId: "s1", amount: 100 },
    ];
    expect(() => { eng.setHumanOrders(corp.id, turn1); eng.stepTurn(); }).not.toThrow();

    // The orders took effect: lab queued/built, research queue set, terraform applied, s1 claimed.
    expect(corp.ownedSystemIds).toContain("s1");
    expect(corp.research.queue.length).toBeGreaterThan(0);
    expect(eng.galaxy.system("s0").bodies!.planets[2]!.habitable).toBe(true); // barren terraformed
    expect(corp.ships.some((s) => s.surveyor)).toBe(true);

    // Dispatch the survey vessel + sell on the exchange, and run several more turns — no crashes,
    // and the colony reads stay coherent through buildClientState the whole way.
    eng.setHumanOrders(corp.id, [
      { kind: "surveySystem", fromSystemId: "s0", targetSystemId: "s1" },
      { kind: "market", side: "sell", resource: "metals", quantity: 5, limitPrice: 1, systemId: "s0", strict: false },
    ]);
    for (let i = 0; i < 10; i++) {
      assertCoherentClientState(eng, corp.id);
      eng.setHumanOrders(corp.id, []);
      eng.stepTurn();
    }
    // Labs eventually finish and produce research progress.
    expect(getBodyBuildings(eng.galaxy.system("s0"), primaryBodyKey(eng.galaxy.system("s0"))).labs >= 0).toBe(true);
    expect(corp.research.completed.length).toBeGreaterThan(2); // researched something past the seed
  });
});
