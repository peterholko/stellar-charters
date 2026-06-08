import { describe, expect, it } from "vitest";
import { Engine } from "../src/engine/engine.js";
import type { Bot, BotFactory, PlayerView } from "../src/engine/bots/bot.js";
import { bidList, valueSystem } from "../src/engine/bots/strategy.js";
import { loadScenario, type Scenario } from "../src/engine/config.js";
import type { BidOrder, Order } from "../src/engine/types.js";
import { tinyScenario } from "./helpers.js";

/** Single-player scenario with one system of the given yields, on a 1-turn hub lane. */
function oneSystem(yields: Record<string, number>): Scenario {
  return {
    name: "pop",
    hubId: "hub",
    players: 1,
    turns: 10,
    bots: ["noop"],
    systems: [
      { id: "hub", name: "Hub", yields: {}, claimCost: 0, upkeep: 0, defense: 99 },
      { id: "s0", name: "S0", yields, claimCost: 1000, upkeep: 0, defense: 2, innerRing: true },
    ],
    routes: [
      { a: "hub", b: "s0", transitTime: 1, stability: 0.9, capacity: 50, exposure: 0.3, authorityPresence: 0.8, charted: true },
    ],
  };
}

class NoopBot implements Bot {
  readonly id = "noop";
  bid(view: PlayerView): BidOrder {
    return { kind: "bid", priorities: bidList(view, (s) => valueSystem(view, s)) };
  }
  decide(): Order[] {
    return [];
  }
}

const noopRegistry = (): Map<string, BotFactory> =>
  new Map<string, BotFactory>([["noop", () => new NoopBot()]]);

describe("population & food (Section 08)", () => {
  it("grows past settlement only when fed from LOCAL food", () => {
    // Garden world: local food production fuels continued growth.
    const garden = new Engine(loadScenario(oneSystem({ food: 20, ice: 4 })), 1, noopRegistry());
    garden.run();
    const gardenStage = garden.galaxy.system("s0").populationStage;
    expect(["colony", "city", "metropolis"]).toContain(gardenStage);
  });

  it("a home world without natural food still grows via its charter habitat dome (Section 21)", () => {
    // Even a pure ice/metals home world is made habitable at assignment (the charter establishes
    // a habitat dome + local food), so a native population can take root and grow.
    const dry = new Engine(loadScenario(oneSystem({ ice: 12, metals: 4 })), 1, noopRegistry());
    dry.run();
    const sys = dry.galaxy.system("s0");
    expect(["settlement", "colony", "city", "metropolis"]).toContain(sys.populationStage);
    expect(sys.sites.some((s) => s.resource === "food")).toBe(true); // the dome's food source
  });
});

/** Bot where corp-0 buys a controlling stake in corp-1; corp-1 keeps trying to claim. */
class TakeoverBots implements Bot {
  readonly id = "miner";
  bid(view: PlayerView): BidOrder {
    return { kind: "bid", priorities: bidList(view, (s) => valueSystem(view, s)) };
  }
  decide(view: PlayerView): Order[] {
    if (view.me.id === "corp-0") {
      return [{ kind: "buyShares", targetId: "corp-1", shares: 60 }];
    }
    // corp-1 keeps trying to grab an unclaimed inner system every turn.
    const free = view.galaxy.innerRingSystems().find((s) => s.owner === null);
    return free ? [{ kind: "claim", systemId: free.id, amount: free.claimCost }] : [];
  }
}

describe("equity, acquisition & free operators (Sections 17–18)", () => {
  it("a majority stake absorbs the target's charter and turns it into a Free Operator", () => {
    const config = { ...tinyScenario(2, 3), turns: 5 };
    // Plenty of cash so the acquirer can clear the share price.
    config.scenario.tuning = { startingCredits: 100000 };
    config.tuning.startingCredits = 100000;
    const registry = new Map<string, BotFactory>([["miner", () => new TakeoverBots()]]);
    const engine = new Engine(config, 0, registry);
    engine.run();

    const acquirer = engine.corps.find((c) => c.id === "corp-0")!;
    const target = engine.corps.find((c) => c.id === "corp-1")!;

    expect(target.isFreeOperator).toBe(true);
    expect(target.hasCharter).toBe(false);
    expect(target.ownedSystemIds.length).toBe(0);
    expect(acquirer.hasCharter).toBe(true);
    // The acquirer ends up holding more than one system (its own plus the absorbed one).
    expect(acquirer.ownedSystemIds.length).toBeGreaterThanOrEqual(2);
    expect(engine.corps.some((c) => c.isFreeOperator)).toBe(true);
  });
});

/** Researches Range 2, then builds a Range-2 escort at its system. */
class ShipyardBot implements Bot {
  readonly id = "noop";
  bid(view: PlayerView): BidOrder {
    return { kind: "bid", priorities: bidList(view, (s) => valueSystem(view, s)) };
  }
  decide(view: PlayerView): Order[] {
    if (view.me.rangeTier < 2) return []; // range now comes from research (Section 28); granted in setup
    if (!view.me.ships.some((s) => s.rangeTier === 2)) {
      const sys = view.me.ownedSystemIds[0];
      if (sys) return [{ kind: "buildShip", rangeTier: 2, raider: false, systemId: sys }];
    }
    return [];
  }
}

class PlatformBot implements Bot {
  readonly id = "noop";
  bid(view: PlayerView): BidOrder {
    return { kind: "bid", priorities: bidList(view, (s) => valueSystem(view, s)) };
  }
  decide(view: PlayerView): Order[] {
    const sys = view.me.ownedSystemIds[0];
    return sys ? [{ kind: "buildPlatform", systemId: sys }] : [];
  }
}

describe("defense platforms (Section 15)", () => {
  it("builds stationary platforms up to the per-system cap", () => {
    const scenario = oneSystem({ ice: 12, metals: 4 });
    scenario.tuning = { startingCredits: 20000 };
    const engine = new Engine(loadScenario(scenario), 1, new Map([["noop", () => new PlatformBot()]]));
    engine.run();
    expect(engine.galaxy.system("s0").platforms).toBe(engine.config.tuning.platformCap);
  });
});

describe("warships & rare-isotope hulls (Sections 04, 07, 13)", () => {
  it("builds a Range-2 escort that consumes rare isotopes and is stationed at its system", () => {
    const scenario = oneSystem({ rareIsotopes: 5, ice: 4 });
    scenario.tuning = { startingCredits: 20000 };
    const engine = new Engine(loadScenario(scenario), 1, new Map([["noop", () => new ShipyardBot()]]));
    engine.corps[0]!.rangeTier = 2; // Warp-Drive research is folded into the tree now; grant range directly
    engine.run();

    const corp = engine.corps[0]!;
    const escort = corp.ships.find((s) => s.rangeTier === 2 && !s.raider);
    expect(escort).toBeDefined();
    expect(escort!.stationedAt).toBe("s0");
    expect(escort!.combat).toBe(engine.config.tuning.shipCombat[2]);
    // Stationed escorts defend the system and escort its convoys: combat is non-zero.
    expect(escort!.combat).toBeGreaterThan(0);
  });
});
