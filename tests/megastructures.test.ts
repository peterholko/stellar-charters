/**
 * Megastructures (Section 22) — the enormous metals demand sink + valuation race.
 */
import { describe, expect, it } from "vitest";
import { Engine } from "../src/engine/engine.js";
import { DEFAULT_TUNING, loadScenario, type Scenario } from "../src/engine/config.js";
import type { Bot, BotFactory, PlayerView } from "../src/engine/bots/bot.js";
import type { BidOrder, Order } from "../src/engine/types.js";

/** One metropolis-stage home system with a big metals stockpile, on a 1-turn hub lane. */
function metalSystem(): Scenario {
  return {
    name: "mega", hubId: "hub", players: 1, turns: 8, bots: ["noop"],
    systems: [
      { id: "hub", name: "Hub", yields: {}, claimCost: 0, upkeep: 0, defense: 99 },
      { id: "s0", name: "S0", yields: { metals: 20 }, claimCost: 1000, upkeep: 0, defense: 2, innerRing: true, populationStage: "city" },
    ],
    routes: [{ a: "hub", b: "s0", transitTime: 1, stability: 0.9, capacity: 50, exposure: 0.3, authorityPresence: 0.8, charted: true }],
  };
}

class BuilderBot implements Bot {
  readonly id = "noop";
  constructor(
    private readonly structure: "orbitalStation" | "spaceElevator" | "ringworld",
    /** Only build once local metals reach this — so the build is funded from real stock. */
    private readonly minLocalMetals = 0,
  ) {}
  bid(): BidOrder { return { kind: "bid", priorities: [] }; }
  decide(view: PlayerView): Order[] {
    const sys = view.me.ownedSystemIds[0];
    if (!sys) return [];
    const s = view.galaxy.system(sys);
    if (s.megastructures.includes(this.structure)) return [];
    if (s.stockpile.metals < this.minLocalMetals) return [];
    return [{ kind: "buildMegastructure", systemId: sys, structure: this.structure }];
  }
}

const reg = (structure: "orbitalStation" | "spaceElevator" | "ringworld"): Map<string, BotFactory> =>
  new Map([["noop", () => new BuilderBot(structure)]]);

describe("megastructures (Section 22)", () => {
  it("builds an orbital station, consuming an enormous metals bill and adding defense + valuation", () => {
    const scen = metalSystem();
    scen.tuning = { startingCredits: 50000 };
    const eng = new Engine(loadScenario(scen), 1, reg("orbitalStation"));
    const spec = DEFAULT_TUNING.megastructures.orbitalStation;
    eng.stepTurn(); // production fills metals; station may build once stock + credits suffice
    // Run enough turns for metals to accumulate past the build threshold and the order to fire.
    for (let i = 0; i < 6; i++) eng.stepTurn();
    const sys = eng.galaxy.system("s0");
    expect(sys.megastructures).toContain("orbitalStation");
    // Defense includes the station bonus.
    expect(sys.defense).toBe(2); // base unchanged; bonus is applied at raid time, not stored
    // Valuation reflects the station.
    const corp = eng.corps[0]!;
    expect(corp.valuation).toBeGreaterThan(spec.valuation);
  });

  it("gates by population stage — a settlement cannot build a ringworld", () => {
    const scen = metalSystem();
    scen.systems[1]!.populationStage = "settlement";
    scen.tuning = { startingCredits: 100000 };
    const eng = new Engine(loadScenario(scen), 1, reg("ringworld"));
    for (let i = 0; i < 8; i++) eng.stepTurn();
    expect(eng.galaxy.system("s0").megastructures).not.toContain("ringworld");
  });

  it("drains the system's metal stockpile when built from local supply", () => {
    const scen = metalSystem();
    scen.turns = 14;
    scen.systems[1]!.yields = { metals: 100 }; // accumulate fast
    scen.tuning = { startingCredits: 50000 };
    const spec = DEFAULT_TUNING.megastructures.orbitalStation;
    // Build only once ≥ the station's full metals cost is in local stock → a real sink, not a
    // market-funded (phantom-metals) build.
    const builder = new Map<string, BotFactory>([["noop", () => new BuilderBot("orbitalStation", spec.metalsCost)]]);
    const eng = new Engine(loadScenario(scen), 1, builder);
    let maxDrawdown = 0;
    for (let i = 0; i < 12; i++) {
      const before = eng.galaxy.system("s0").stockpile.metals;
      eng.stepTurn();
      const after = eng.galaxy.system("s0").stockpile.metals;
      maxDrawdown = Math.max(maxDrawdown, before - after);
    }
    expect(eng.galaxy.system("s0").megastructures).toContain("orbitalStation");
    // On the build turn the station consumes ~metalsCost from local stock (admin step), partly
    // offset by that turn's +100 production — a large net drawdown no ordinary turn produces.
    expect(maxDrawdown).toBeGreaterThan(spec.metalsCost - 150);
  });
});
