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

/** Emits one wave of orders per turn, in sequence (for multi-turn order scripts). */
class TurnsBot implements Bot {
  readonly id = "turns";
  constructor(private waves: Order[][]) {}
  bid(_v: PlayerView): BidOrder {
    return { kind: "bid", priorities: [] };
  }
  decide(_v: PlayerView): Order[] {
    return this.waves.shift() ?? [];
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
  it("charges an upgrade up front, then completes it over the construction queue (Phase 4a)", () => {
    const e = engineWith((sys) => {
      sys.stockpile.metals = 18; // exactly miningMetalsCost × level 1
    }, true, [{ kind: "upgradeInfrastructure", systemId: "s0", track: "mining" }]);
    const start = corpOf(e).credits;
    e.stepTurn();
    const sys = e.galaxy.system("s0");
    // Charged immediately (credits + the local raw), but the rig is still under construction.
    expect(buildingTotal(sys, "miningRigs")).toBe(0);
    expect(sys.stockpile.metals).toBeCloseTo(0, 6); // drawn from local stock at queue time
    expect(corpOf(e).credits).toBeCloseTo(start - 350, 6); // miningCreditCost only (raw was local)
    expect(sys.queue.length).toBe(1);
    // Construction points accumulate; the rig lands once cpCost (130) is met (≤ 2 turns at 100/turn).
    e.stepTurn();
    e.stepTurn();
    expect(buildingTotal(e.galaxy.system("s0"), "miningRigs")).toBe(1);
    expect(e.galaxy.system("s0").queue.length).toBe(0); // queue drained
  });

  it("keeps an unaffordable build queued unpaid, then pays and starts it when materials arrive", () => {
    const e = engineWith((sys) => {
      sys.stockpile.metals = 0; // cannot cover the 18-metal bill yet
    }, true, [{ kind: "upgradeInfrastructure", systemId: "s0", track: "mining" }]);
    const start = corpOf(e).credits;
    e.stepTurn();
    const sys = e.galaxy.system("s0");
    expect(sys.queue.length).toBe(1);
    expect(sys.queue[0]!.paid).toBe(false); // waiting, not dropped
    expect(corpOf(e).credits).toBeCloseTo(start, 6); // nothing charged while waiting
    // Materials arrive (an import lands) — the bill clears and construction begins.
    sys.stockpile.metals = 18;
    e.stepTurn();
    expect(sys.queue[0]!.paid).toBe(true);
    expect(sys.stockpile.metals).toBeCloseTo(0, 6);
    expect(corpOf(e).credits).toBeCloseTo(start - 350, 6);
    e.stepTurn(); // cpCost 130 met at 100/turn
    expect(buildingTotal(e.galaxy.system("s0"), "miningRigs")).toBe(1);
    expect(e.galaxy.system("s0").queue.length).toBe(0);
  });

  it("cancelBuild removes a queued item and refunds a paid bill in full", () => {
    const reg = new Map<string, BotFactory>([["noop", () => new TurnsBot([
      [{ kind: "upgradeInfrastructure", systemId: "s0", track: "mining" }],
      [{ kind: "cancelBuild", systemId: "s0", bodyKey: "home" }],
    ])]]);
    const e = new Engine(procConfig(true), 0, reg);
    const sys = e.galaxy.system("s0");
    sys.stockpile.metals = 18;
    const start = corpOf(e).credits;
    e.stepTurn(); // charged + queued (cpCost 130 > 100/turn, so it cannot finish before the cancel)
    expect(sys.queue.length).toBe(1);
    expect(sys.queue[0]!.paid).toBe(true);
    e.stepTurn(); // cancel: credits refunded, metals land back in the system stockpile
    expect(sys.queue.length).toBe(0);
    expect(buildingTotal(sys, "miningRigs")).toBe(0); // progress forfeit, nothing built
    expect(corpOf(e).credits).toBeCloseTo(start, 6);
    expect(sys.stockpile.metals).toBeCloseTo(18, 6);
  });

  it("allows only one queued structure per body", () => {
    const e = engineWith((sys) => {
      sys.stockpile.metals = 100;
      sys.stockpile.silicates = 100;
    }, true, [
      { kind: "upgradeInfrastructure", systemId: "s0", track: "mining" },
      { kind: "upgradeInfrastructure", systemId: "s0", track: "habitat", bodyKey: "home" },
    ]);
    const start = corpOf(e).credits;
    e.stepTurn();
    const sys = e.galaxy.system("s0");
    expect(sys.queue.length).toBe(1); // the body already holds the mining build — habitat refused
    expect(sys.queue[0]!.kind).toBe("mining");
    expect(sys.stockpile.silicates).toBeCloseTo(100, 6); // refused order charged nothing
    expect(corpOf(e).credits).toBeCloseTo(start - 350, 6); // only the mining upgrade billed
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
  cfg.tuning.startupInventoryTurns = 0; // isolate dome output — no injected startup food (see above)
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

  it("serialises a colony's build queue FIFO, rolling leftover points forward (Phase 4a)", () => {
    const e = bodiesEngine("ocean");
    const sys = e.galaxy.system("s0");
    // Two builds landing on planet:1 — agri-dome (90 cp) then reactor (140 cp), at 100 points/turn.
    sys.queue = [
      { kind: "agridome", bodyKey: "planet:1", cpCost: 90, cpDone: 0, paid: true, creditCost: 0, mats: {} },
      { kind: "reactor", bodyKey: "planet:1", cpCost: 140, cpDone: 0, paid: true, creditCost: 0, mats: {} },
    ];
    e.stepTurn(); // +100 → dome completes (90), 10 rolls onto the reactor
    expect(getBodyBuildings(e.galaxy.system("s0"), "planet:1").hydroponics).toBe(1);
    expect(getBodyBuildings(e.galaxy.system("s0"), "planet:1").reactors).toBe(0);
    e.stepTurn(); // reactor 10+100 = 110 < 140
    expect(getBodyBuildings(e.galaxy.system("s0"), "planet:1").reactors).toBe(0);
    e.stepTurn(); // 110+100 = 210 ≥ 140 → reactor lands
    expect(getBodyBuildings(e.galaxy.system("s0"), "planet:1").reactors).toBe(1);
    expect(e.galaxy.system("s0").queue.length).toBe(0); // drained
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

describe("per-system population with habitable-world multipliers (review Section 10)", () => {
  const STAGES = ["outpost", "settlement", "colony", "city", "metropolis"];

  /** One system, `worlds` habitable ocean planets each with a fully-worked food deposit. */
  function popEngine(worlds: number): Engine {
    const planets = Array.from({ length: worlds }, (_, i) => ({
      type: "ocean" as const, orbit: i + 1, habitable: true, visualSeed: 0,
      deposits: [{ resource: "food" as const, richness: 30, reserves: null, accessibility: 1 }],
    }));
    const cfg = loadScenario({
      name: "pop", hubId: "hub", players: 1, turns: 20, bots: ["noop"],
      systems: [
        { id: "hub", name: "Hub", yields: {}, claimCost: 0, upkeep: 0, defense: 99 },
        { id: "s0", name: "S0", yields: {}, claimCost: 100, upkeep: 0, defense: 1, innerRing: true,
          bodies: { starType: "mainSequence", planets, asteroidBelts: [] } },
      ],
      routes: [{ a: "hub", b: "s0", transitTime: 1, stability: 0.9, capacity: 50, exposure: 0.3, authorityPresence: 0.8, requiredRange: 1, charted: true }],
    });
    cfg.tuning.fuelPerShipPerTurn = 0;
    cfg.tuning.iceNeed = { outpost: 0, settlement: 0, colony: 0, city: 0, metropolis: 0 };
    const reg = new Map<string, BotFactory>([["noop", () => new NoopBot()]]);
    const e = new Engine(cfg, 0, reg);
    for (const site of e.galaxy.system("s0").sites) if (site.resource === "food") site.extractorLevel = 3;
    return e;
  }

  it("grows ONE population per system; extra habitable worlds make it grow faster", () => {
    const one = popEngine(1);
    const two = popEngine(2);
    for (let i = 0; i < 12; i++) { one.stepTurn(); two.stepTurn(); }
    const s1 = one.galaxy.system("s0");
    const s2 = two.galaxy.system("s0");
    // Fed local food → the system population advances past Outpost (one stage, one progress bar).
    expect(s2.populationStage).not.toBe("outpost");
    // The 2-habitable system is the richer prize: it is further along, by stage then progress.
    const rank = (s: typeof s1) => STAGES.indexOf(s.populationStage) * 1000 + s.populationProgress;
    expect(rank(s2)).toBeGreaterThan(rank(s1));
  });
});
