/**
 * Production chains (Section 07b): Processor recipes, same-turn tier chaining, power
 * brownout/restore, and the required-input bills that draw local stock then buy market shortfall.
 */
import { describe, expect, it } from "vitest";
import { Engine } from "../src/engine/engine.js";
import { getBodyBuildings, primaryBodyKey } from "../src/engine/bodies.js";
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

/** Emits a fixed set of orders on its first turn, then nothing. */
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

/**
 * One player on a single inert inner system (no yields), so a Processor's inputs/outputs are
 * exactly whatever we seed. `highPower` removes the power ceiling to isolate recipe I/O from the
 * brownout mechanic (the power test opts out to exercise it). Fleet fuel upkeep and life-support
 * ice draw are zeroed so the only stockpile movement is the chain itself.
 */
function procConfig(highPower: boolean): GameConfig {
  const cfg = loadScenario({
    name: "proc",
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

function engineWith(setup: (sys: System) => void, highPower = true): Engine {
  const reg = new Map<string, BotFactory>([["noop", () => new NoopBot()]]);
  const engine = new Engine(procConfig(highPower), 0, reg);
  setup(engine.galaxy.system("s0")); // corp-0 is seeded onto s0 at construction
  return engine;
}

describe("production chains", () => {
  it("runs a recipe to completion when inputs are fully supplied", () => {
    const e = engineWith((sys) => {
      getBodyBuildings(sys, primaryBodyKey(sys)).processors = { fuel: 1 };
      sys.stockpile.ice = 2;
      sys.stockpile.helium3 = 1;
    });
    e.stepTurn();
    const sys = e.galaxy.system("s0");
    expect(sys.stockpile.fuel).toBeCloseTo(3, 6); // ice2 + helium3 1 → fuel 3
    expect(sys.stockpile.ice).toBeCloseTo(0, 6);
    expect(sys.stockpile.helium3).toBeCloseTo(0, 6);
  });

  it("pro-rates output to the limiting input when inputs are short", () => {
    const e = engineWith((sys) => {
      getBodyBuildings(sys, primaryBodyKey(sys)).processors = { fuel: 1 };
      sys.stockpile.ice = 1; // half the ice the recipe wants (2)
      sys.stockpile.helium3 = 5; // plenty
    });
    e.stepTurn();
    const sys = e.galaxy.system("s0");
    // Limiting ratio = ice 1/2 = 0.5 → fuel 1.5, all ice spent, half the helium3 spent.
    expect(sys.stockpile.fuel).toBeCloseTo(1.5, 6);
    expect(sys.stockpile.ice).toBeCloseTo(0, 6);
    expect(sys.stockpile.helium3).toBeCloseTo(4.5, 6);
  });

  it("chains a tier-1 output into a tier-2 recipe in the same turn", () => {
    const e = engineWith((sys) => {
      getBodyBuildings(sys, primaryBodyKey(sys)).processors = { fuel: 1, polymers: 1 };
      sys.stockpile.ice = 2;
      sys.stockpile.helium3 = 1; // → fuel 3 (recipe ordered before polymers)
      sys.stockpile.silicates = 2; // polymers wants silicates2 + fuel1
    });
    e.stepTurn();
    const sys = e.galaxy.system("s0");
    expect(sys.stockpile.polymers).toBeCloseTo(2, 6); // consumed fuel made this same turn
    expect(sys.stockpile.fuel).toBeCloseTo(2, 6); // 3 produced − 1 used by polymers
    expect(sys.stockpile.silicates).toBeCloseTo(0, 6);
  });

  it("browns out when processor power draw exceeds capacity, and a reactor restores it", () => {
    // Two alloys processors draw 4 power; base power is only 2 → powerFactor 0.5 (half output).
    const brown = engineWith((sys) => {
      getBodyBuildings(sys, primaryBodyKey(sys)).processors = { alloys: 2 };
      sys.stockpile.metals = 100;
      sys.stockpile.helium3 = 100;
    }, false);
    brown.stepTurn();
    expect(brown.galaxy.system("s0").stockpile.alloys).toBeCloseTo(2, 6); // throttled from 4

    // A reactor lifts capacity to meet the draw → full output.
    const lit = engineWith((sys) => {
      const bb = getBodyBuildings(sys, primaryBodyKey(sys));
      bb.processors = { alloys: 2 };
      bb.reactors = 1;
      sys.stockpile.metals = 100;
      sys.stockpile.helium3 = 100;
    }, false);
    lit.stepTurn();
    expect(lit.galaxy.system("s0").stockpile.alloys).toBeCloseTo(4, 6);
  });

  it("draws a build's alloy bill from local stock, then buys the shortfall at market", () => {
    const corpOf = (e: Engine) => e.corps.find((c) => c.id === "corp-0")!;
    const buildShipEngine = (setup: (sys: System) => void): Engine => {
      const order: Order = { kind: "buildShip", rangeTier: 1, raider: false, systemId: "s0" };
      const reg = new Map<string, BotFactory>([["noop", () => new OnceBot([order])]]);
      const engine = new Engine(procConfig(true), 0, reg);
      setup(engine.galaxy.system("s0"));
      return engine;
    };

    // Local alloys cover the bill (shipAlloyCost[1] = 2): no market purchase, only the hull cost.
    const local = buildShipEngine((sys) => {
      sys.stockpile.alloys = 2;
    });
    const startCredits = corpOf(local).credits;
    const shipCost = local.config.tuning.shipCost[1];
    local.stepTurn();
    expect(local.galaxy.system("s0").stockpile.alloys).toBeCloseTo(0, 6);
    expect(corpOf(local).credits).toBeCloseTo(startCredits - shipCost, 6); // shipCost[1] only

    // No local alloys: the 2-alloy bill is bought at the market price (base 40 → +80).
    const market = buildShipEngine(() => {});
    market.stepTurn();
    expect(corpOf(market).credits).toBeCloseTo(startCredits - shipCost - 80, 6);
  });
});
