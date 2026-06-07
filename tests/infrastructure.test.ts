/**
 * System infrastructure upgrades (Section 07c): raw-fed upgrade tracks that consume
 * metals/silicates/helium3 and boost yields, population/tax, and power.
 */
import { describe, expect, it } from "vitest";
import { Engine } from "../src/engine/engine.js";
import { buildingTotal, getBodyBuildings, primaryBodyKey } from "../src/engine/bodies.js";
import { loadScenario, type GameConfig } from "../src/engine/config.js";
import type { Bot, BotFactory, PlayerView } from "../src/engine/bots/bot.js";
import type { BidOrder, Order, System } from "../src/engine/types.js";

class NoopBot implements Bot {
  readonly id = "noop";
  bid(_v: PlayerView): BidOrder {
    return { kind: "bid", priorities: [] };
  }
  decide(_v: PlayerView): Order[] {
    return [];
  }
}

class OnceBot implements Bot {
  readonly id = "once";
  constructor(private orders: Order[]) {}
  bid(_v: PlayerView): BidOrder {
    return { kind: "bid", priorities: [] };
  }
  decide(_v: PlayerView): Order[] {
    const o = this.orders;
    this.orders = [];
    return o;
  }
}

function procConfig(highPower: boolean): GameConfig {
  const cfg = loadScenario({
    name: "infra",
    hubId: "hub",
    players: 1,
    turns: 4,
    bots: ["noop"],
    systems: [
      { id: "hub", name: "Hub", yields: {}, claimCost: 0, upkeep: 0, defense: 99 },
      { id: "s0", name: "S0", yields: {}, claimCost: 100, upkeep: 0, defense: 1, innerRing: true },
    ],
    routes: [
      { a: "hub", b: "s0", transitTime: 1, stability: 0.9, capacity: 50, exposure: 0.3, authorityPresence: 0.8, requiredRange: 1, charted: true },
    ],
  });
  cfg.tuning.fuelPerShipPerTurn = 0;
  cfg.tuning.iceNeed = { ...cfg.tuning.iceNeed, outpost: 0 };
  if (highPower) cfg.tuning.basePowerPerSystem = 1000;
  return cfg;
}

function engineWith(setup: (sys: System) => void, highPower = true, orders: Order[] = []): Engine {
  const reg = new Map<string, BotFactory>([["noop", () => (orders.length ? new OnceBot(orders) : new NoopBot())]]);
  const engine = new Engine(procConfig(highPower), 0, reg);
  setup(engine.galaxy.system("s0")); // corp-0 is seeded onto s0
  return engine;
}

const corpOf = (e: Engine) => e.corps.find((c) => c.id === "corp-0")!;

describe("system infrastructure upgrades", () => {
  it("spends credits + the track's raw to add a level", () => {
    const e = engineWith((sys) => {
      sys.stockpile.metals = 18; // exactly miningMetalsCost × level 1
    }, true, [{ kind: "upgradeInfrastructure", systemId: "s0", track: "mining" }]);
    const start = corpOf(e).credits;
    e.stepTurn();
    const sys = e.galaxy.system("s0");
    expect(buildingTotal(sys, "miningRigs")).toBe(1);
    expect(sys.stockpile.metals).toBeCloseTo(0, 6); // drawn from local stock
    expect(corpOf(e).credits).toBeCloseTo(start - 350, 6); // miningCreditCost only (raw was local)
  });

  it("refuses to upgrade past the cap", () => {
    const e = engineWith((sys) => {
      getBodyBuildings(sys, primaryBodyKey(sys)).miningRigs = 4; // at cap
      sys.stockpile.metals = 1000;
    }, true, [{ kind: "upgradeInfrastructure", systemId: "s0", track: "mining" }]);
    const start = corpOf(e).credits;
    e.stepTurn();
    expect(buildingTotal(e.galaxy.system("s0"), "miningRigs")).toBe(4);
    expect(corpOf(e).credits).toBeCloseTo(start, 6); // nothing charged
  });

  it("lowers system upkeep per Mining Rig level (fortification, no added supply)", () => {
    // Upkeep is the only credit movement here (no yields, no fleet fuel, outpost pays no tax).
    const base = engineWith((sys) => {
      sys.upkeep = 100;
    });
    const startBase = corpOf(base).credits;
    base.stepTurn();
    expect(startBase - corpOf(base).credits).toBeCloseTo(100, 6);

    const fort = engineWith((sys) => {
      sys.upkeep = 100;
      getBodyBuildings(sys, primaryBodyKey(sys)).miningRigs = 2; // −2 × 0.1 = −20% upkeep
    });
    const startFort = corpOf(fort).credits;
    fort.stepTurn();
    expect(startFort - corpOf(fort).credits).toBeCloseTo(80, 6);

    // And extraction is unchanged by Mining Rigs (pure sink, no supply feedback). A fully-worked
    // metals site (Section 21) produces its richness regardless of the Mining Rig level.
    const yieldCheck = engineWith((sys) => {
      sys.sites.push({
        key: "test:metals", bodyKind: "planet", bodyType: "rocky", bodyLabel: "Test world",
        orbit: 0, habitable: false, resource: "metals", richness: 10, reservesRemaining: null,
        accessibility: 1, extractorLevel: 3, prospected: true, disabledUntil: 0,
      });
      getBodyBuildings(sys, primaryBodyKey(sys)).miningRigs = 4;
    });
    yieldCheck.stepTurn();
    expect(yieldCheck.galaxy.system("s0").stockpile.metals).toBeCloseTo(10, 6);
  });

  it("Power Grid levels supply power, relieving a brownout without a reactor", () => {
    // Two alloys processors draw 4 power; base is 2 → brownout halves output to 2.
    const brown = engineWith((sys) => {
      getBodyBuildings(sys, primaryBodyKey(sys)).processors = { alloys: 2 };
      sys.stockpile.metals = 100;
      sys.stockpile.helium3 = 100;
    }, false);
    brown.stepTurn();
    expect(brown.galaxy.system("s0").stockpile.alloys).toBeCloseTo(2, 6);

    // One Power Grid level adds 4 capacity → draw met → full output.
    const lit = engineWith((sys) => {
      const bb = getBodyBuildings(sys, primaryBodyKey(sys));
      bb.processors = { alloys: 2 };
      bb.powerGrid = 1;
      sys.stockpile.metals = 100;
      sys.stockpile.helium3 = 100;
    }, false);
    lit.stepTurn();
    expect(lit.galaxy.system("s0").stockpile.alloys).toBeCloseTo(4, 6);
  });
});

/** A system anchored by a habitable ocean world (so no starter "home garden" is injected — that
 *  would add food we don't control) plus a second `testType` planet at planet:1 we build the dome on. */
function bodiesEngine(testType: "ocean" | "rocky"): Engine {
  const cfg = loadScenario({
    name: "affinity",
    hubId: "hub",
    players: 1,
    turns: 4,
    bots: ["noop"],
    systems: [
      { id: "hub", name: "Hub", yields: {}, claimCost: 0, upkeep: 0, defense: 99 },
      {
        id: "s0", name: "S0", yields: {}, claimCost: 100, upkeep: 0, defense: 1, innerRing: true,
        bodies: {
          starType: "mainSequence",
          planets: [
            { type: "ocean", orbit: 1, habitable: true, visualSeed: 0, deposits: [] }, // anchor — no deposits, no dome
            { type: testType, orbit: 2, habitable: testType === "ocean", visualSeed: 0, deposits: [] }, // dome goes here
          ],
          asteroidBelts: [],
        },
      },
    ],
    routes: [
      { a: "hub", b: "s0", transitTime: 1, stability: 0.9, capacity: 50, exposure: 0.3, authorityPresence: 0.8, requiredRange: 1, charted: true },
    ],
  });
  cfg.tuning.fuelPerShipPerTurn = 0;
  cfg.tuning.iceNeed = { ...cfg.tuning.iceNeed, outpost: 0 };
  cfg.tuning.foodNeed = { ...cfg.tuning.foodNeed, outpost: 0 };
  const reg = new Map<string, BotFactory>([["noop", () => new NoopBot()]]);
  return new Engine(cfg, 0, reg);
}

describe("planet-type affinities (Section 24)", () => {
  it("an ocean agri-dome out-farms a rocky one from the same ice", () => {
    const food = (type: "ocean" | "rocky") => {
      const e = bodiesEngine(type);
      const sys = e.galaxy.system("s0");
      getBodyBuildings(sys, "planet:1").hydroponics = 1; // dome on the test-type world
      sys.stockpile.ice = 100; // ice is not the limiter
      e.stepTurn();
      return e.galaxy.system("s0").stockpile.food;
    };
    const ocean = food("ocean");
    const rocky = food("rocky");
    expect(rocky).toBeGreaterThan(0);
    expect(ocean / rocky).toBeCloseTo(1.5, 5); // agriFoodMult ocean 1.5 vs rocky 1.0
  });

  it("refuses to build an agri-dome on a gas giant (no livable surface)", () => {
    const reg = new Map<string, BotFactory>([["noop", () => new OnceBot([{ kind: "buildHydroponics", systemId: "s0", bodyKey: "planet:0" }])]]);
    const cfg = loadScenario({
      name: "gate", hubId: "hub", players: 1, turns: 4, bots: ["noop"],
      systems: [
        { id: "hub", name: "Hub", yields: {}, claimCost: 0, upkeep: 0, defense: 99 },
        { id: "s0", name: "S0", yields: {}, claimCost: 100, upkeep: 0, defense: 1, innerRing: true,
          bodies: { starType: "mainSequence", planets: [{ type: "gasGiant", orbit: 1, habitable: false, visualSeed: 0, deposits: [] }], asteroidBelts: [] } },
      ],
      routes: [{ a: "hub", b: "s0", transitTime: 1, stability: 0.9, capacity: 50, exposure: 0.3, authorityPresence: 0.8, requiredRange: 1, charted: true }],
    });
    cfg.tuning.fuelPerShipPerTurn = 0;
    cfg.tuning.iceNeed = { ...cfg.tuning.iceNeed, outpost: 0 };
    const e = new Engine(cfg, 0, reg);
    const start = e.corps.find((c) => c.id === "corp-0")!.credits;
    e.stepTurn();
    expect(buildingTotal(e.galaxy.system("s0"), "hydroponics")).toBe(0); // gated out
    expect(e.corps.find((c) => c.id === "corp-0")!.credits).toBeCloseTo(start, 6); // nothing charged
  });
});
