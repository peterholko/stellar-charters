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
      // Order the whole register: control requires buying out management as one lot.
      return [{ kind: "buyShares", targetId: "corp-1", shares: 100, limitPrice: 1e9 }];
    }
    // corp-1 keeps trying to grab an unclaimed inner system every turn.
    const free = view.galaxy.innerRingSystems().find((s) => s.owner === null);
    return free ? [{ kind: "claim", systemId: free.id, amount: free.claimCost }] : [];
  }
}

/** Bot where the listed actor corps stage the planned share orders each turn. */
class ShareOrderBot implements Bot {
  readonly id = "miner";
  constructor(
    private plan: (view: PlayerView) => Order[],
    private actors: string[],
  ) {}
  bid(view: PlayerView): BidOrder {
    return { kind: "bid", priorities: bidList(view, (s) => valueSystem(view, s)) };
  }
  decide(view: PlayerView): Order[] {
    return this.actors.includes(view.me.id) ? this.plan(view) : [];
  }
}

function shareGame(plan: (view: PlayerView) => Order[], turns = 3, actors: string[] = ["corp-0"]) {
  const config = { ...tinyScenario(2, 3), turns };
  config.scenario.tuning = { startingCredits: 100000 };
  config.tuning.startingCredits = 100000;
  const registry = new Map<string, BotFactory>([["miner", () => new ShareOrderBot(plan, actors)]]);
  const engine = new Engine(config, 0, registry);
  engine.run();
  return engine;
}

describe("share limit orders (Section 17)", () => {
  it("share prices are quoted from turn 0 — the ticket must never show a 0-cr ladder", () => {
    const registry = new Map<string, BotFactory>([["miner", () => new NoopBot()]]);
    const engine = new Engine({ ...tinyScenario(2, 3), turns: 3 }, 0, registry);
    // No turn has resolved yet: prices come from the creation-time valuation
    // (starting cash + the starting ship).
    for (const corp of engine.corps) {
      expect(corp.valuation).toBeGreaterThan(0);
      expect(corp.sharePrice).toBeGreaterThan(0);
    }
  });

  it("a buy whose limit is under the resolved price does not fill", () => {
    const engine = shareGame(() => [
      { kind: "buyShares", targetId: "corp-1", shares: 10, limitPrice: 1 },
    ]);
    const target = engine.corps.find((c) => c.id === "corp-1")!;
    // Real charters value well above 1 cr/share, so the order never fills.
    expect(target.sharePrice).toBeGreaterThan(1);
    expect(target.shareRegister["corp-0"] ?? 0).toBe(0);
  });

  it("a buy fills at the resolved price when the limit allows it", () => {
    const engine = shareGame((view) => {
      const target = view.corporations.find((c) => c.id === "corp-1")!;
      return [{ kind: "buyShares", targetId: "corp-1", shares: 10, limitPrice: target.sharePrice * 10 + 100 }];
    });
    const target = engine.corps.find((c) => c.id === "corp-1")!;
    expect(target.shareRegister["corp-0"] ?? 0).toBeGreaterThan(0);
  });

  it("selling fills against the NPC blocks' bids and the shares join their stakes", () => {
    let soldTurn = 0;
    let bought = false;
    const engine = shareGame((view) => {
      const target = view.corporations.find((c) => c.id === "corp-1")!;
      const held = target.shareRegister[view.me.id] ?? 0;
      if (held === 0 && !bought) {
        bought = true;
        return [{ kind: "buyShares", targetId: "corp-1", shares: 10, limitPrice: 1e9 }];
      }
      if (held === 0) return [];
      soldTurn = view.turn;
      // Limit at the price floor: always fills (a sell "at market" is a limit of 1).
      return [{ kind: "sellShares", targetId: "corp-1", shares: held, limitPrice: 1 }];
    }, 4);
    const target = engine.corps.find((c) => c.id === "corp-1")!;
    expect(soldTurn).toBeGreaterThan(0);
    expect(target.shareRegister["corp-0"] ?? 0).toBe(0);
    // The 10 sold shares were absorbed by the institutional blocks (5+3+2 per-turn caps).
    const npcHeld = target.npcHolders.reduce((s, npc) => s + (target.shareRegister[npc.id] ?? 0), 0);
    const npcInitial = engine.config.tuning.equity.npcBlocks.reduce((s, b) => s + b.shares, 0);
    expect(npcHeld).toBe(npcInitial); // they sold 10 to the raider, then bought 10 back
    // Register stays whole: management + NPC blocks + raider = shares outstanding.
    const total = Object.values(target.shareRegister).reduce((s, n) => s + n, 0);
    expect(total).toBe(target.sharesOutstanding);
  });

  it("management can sell its own block to raise cash, and buy it back at a loss (no mint)", () => {
    let creditsAfterSale = 0;
    let phase: "sell" | "buyback" | "done" = "sell";
    const engine = shareGame((view) => {
      if (phase === "sell") {
        phase = "buyback";
        return [{ kind: "sellShares", targetId: "corp-0", shares: 10, limitPrice: 1 }];
      }
      if (phase === "buyback") {
        creditsAfterSale = view.me.credits;
        phase = "done";
        return [{ kind: "buyShares", targetId: "corp-0", shares: 10, limitPrice: 1e9 }];
      }
      return [];
    }, 4);
    const me = engine.corps.find((c) => c.id === "corp-0")!;
    // Block restored: sold 10 to the institutions, bought 10 back off their asks.
    expect(me.shareRegister["corp-0"]).toBe(55);
    // The round trip is strictly lossy (bid discount + ask premium): no money printer.
    expect(me.credits).toBeLessThan(creditsAfterSale);
  });

  it("a buyback shrinks the float below what a price-capped raider can sweep", () => {
    // Surgical setup: no claims (no land-rush cash swings), so book value is stable
    // and the stale staging quote tracks the resolved price. The charter flag is set
    // directly — this test is about the equity race, not the colony game.
    let struck = false;
    class RaceBot implements Bot {
      readonly id = "miner";
      bid(): BidOrder {
        return { kind: "bid", priorities: [] };
      }
      decide(view: PlayerView): Order[] {
        if (view.me.id === "corp-1") {
          // Defender: buy 10 of its own float back on turn 1 (cheap NPC asks).
          const own = view.corporations.find((c) => c.id === "corp-1")!;
          return (own.shareRegister["corp-1"] ?? 0) < 65
            ? [{ kind: "buyShares", targetId: "corp-1", shares: 10, limitPrice: 1e9 }]
            : [];
        }
        // Raider: one decisive sweep at up to 2× book — enough for every NPC ask,
        // never enough for the 2.5× management holdout.
        const target = view.corporations.find((c) => c.id === "corp-1")!;
        if (struck || target.sharePrice <= 0) return [];
        struck = true;
        return [{ kind: "buyShares", targetId: "corp-1", shares: 60, limitPrice: target.sharePrice * 2 }];
      }
    }
    const config = { ...tinyScenario(2, 3), turns: 4 };
    config.scenario.tuning = { startingCredits: 100000 };
    config.tuning.startingCredits = 100000;
    const registry = new Map<string, BotFactory>([["miner", () => new RaceBot()]]);
    const engine = new Engine(config, 0, registry);
    for (const c of engine.corps) c.hasCharter = true; // takeover target must be a real charter
    engine.run();

    const target = engine.corps.find((c) => c.id === "corp-1")!;
    // The defender holds 65, so at most 35 float shares existed for the raider: control
    // (>50) is out of reach at any price below the management holdout.
    expect(target.shareRegister["corp-1"]).toBe(65);
    expect(target.shareRegister["corp-0"] ?? 0).toBeLessThanOrEqual(50);
    expect(target.hasCharter).toBe(true);
    expect(target.isFreeOperator).toBe(false);
  });

  it("the management block cannot be nibbled — partial orders stop at the float", () => {
    let struck = false;
    class NibbleBot implements Bot {
      readonly id = "miner";
      bid(): BidOrder {
        return { kind: "bid", priorities: [] };
      }
      decide(view: PlayerView): Order[] {
        if (view.me.id !== "corp-0" || struck) return [];
        const target = view.corporations.find((c) => c.id === "corp-1")!;
        if (target.sharePrice <= 0) return [];
        struck = true;
        // 51 shares would have been control under per-share management pricing.
        return [{ kind: "buyShares", targetId: "corp-1", shares: 51, limitPrice: 1e9 }];
      }
    }
    const config = { ...tinyScenario(2, 3), turns: 2 };
    config.scenario.tuning = { startingCredits: 500000 };
    config.tuning.startingCredits = 500000;
    const registry = new Map<string, BotFactory>([["miner", () => new NibbleBot()]]);
    const engine = new Engine(config, 0, registry);
    for (const c of engine.corps) c.hasCharter = true;
    engine.run();

    const target = engine.corps.find((c) => c.id === "corp-1")!;
    // Cash and limit were no object — but management only sells whole (55 > the 6
    // wanted), so the order stops at the 45-share float and control never happens.
    expect(target.shareRegister["corp-0"]).toBe(45);
    expect(target.shareRegister["corp-1"]).toBe(55);
    expect(target.hasCharter).toBe(true);
  });

  it("the concentration premium makes a big stake cost far more than flat block asks", () => {
    let struck = false;
    class SweepBot implements Bot {
      readonly id = "miner";
      bid(): BidOrder {
        return { kind: "bid", priorities: [] };
      }
      decide(view: PlayerView): Order[] {
        if (view.me.id !== "corp-0" || struck) return [];
        const target = view.corporations.find((c) => c.id === "corp-1")!;
        if (target.sharePrice <= 0) return [];
        struck = true;
        return [{ kind: "buyShares", targetId: "corp-1", shares: 40, limitPrice: 1e9 }];
      }
    }
    const config = { ...tinyScenario(2, 3), turns: 2 };
    config.scenario.tuning = { startingCredits: 100000 };
    config.tuning.startingCredits = 100000;
    const registry = new Map<string, BotFactory>([["miner", () => new SweepBot()]]);
    const engine = new Engine(config, 0, registry);
    for (const c of engine.corps) c.hasCharter = true;
    engine.run();

    const buyer = engine.corps.find((c) => c.id === "corp-0")!;
    const target = engine.corps.find((c) => c.id === "corp-1")!;
    expect(target.shareRegister["corp-0"]).toBe(40);
    const spent = 100000 - buyer.credits;
    // Flat block asks for 40 float shares would be ≤ ~47k (44 × base ≤ ~1,070).
    // The quadratic position premium (avg ×~1.4 across a 0→40% stake) pushes it
    // well past that — creeping to control is priced like the takeover it is.
    expect(spent).toBeGreaterThan(52000);
    expect(spent).toBeLessThan(85000);
  });

  it("contested scarce blocks auction to the highest limit, which pays its own bid", () => {
    // corp-0 and corp-1 sweep corp-2's float in the SAME sealed turn. corp-0 bids
    // 5,000/share, corp-1 bids 2,000. Every contested block goes to corp-0 AT ITS OWN
    // BID until its cash runs dry (100k / 5k = 20 shares); corp-1 then takes the rest
    // of the float at the posted asks — paying nothing like its 2,000 bid.
    const struck = new Set<string>();
    class AuctionBot implements Bot {
      readonly id = "miner";
      bid(): BidOrder {
        return { kind: "bid", priorities: [] };
      }
      decide(view: PlayerView): Order[] {
        if (view.me.id === "corp-2") return [];
        const target = view.corporations.find((c) => c.id === "corp-2")!;
        if (struck.has(view.me.id) || target.sharePrice <= 0) return [];
        struck.add(view.me.id);
        const limit = view.me.id === "corp-0" ? 5000 : 2000;
        return [{ kind: "buyShares", targetId: "corp-2", shares: 40, limitPrice: limit }];
      }
    }
    const config = { ...tinyScenario(3, 3), turns: 3 };
    config.scenario.tuning = { startingCredits: 100000 };
    config.tuning.startingCredits = 100000;
    const registry = new Map<string, BotFactory>([["miner", () => new AuctionBot()]]);
    const engine = new Engine(config, 0, registry);
    for (const c of engine.corps) c.hasCharter = true;
    engine.run();

    const target = engine.corps.find((c) => c.id === "corp-2")!;
    const high = engine.corps.find((c) => c.id === "corp-0")!;
    const low = engine.corps.find((c) => c.id === "corp-1")!;
    // The high bidder won ~20 shares — cash-capped at its own 5,000 bid (small
    // pre-equity upkeep charges shave the exact count by a share)...
    const highShares = target.shareRegister["corp-0"] ?? 0;
    expect(highShares).toBeGreaterThanOrEqual(18);
    expect(highShares).toBeLessThanOrEqual(20);
    // Paid its own 5,000 bid per share: ~all of the 100k bankroll is gone (small
    // per-turn income drifts the exact remainder).
    expect(high.credits).toBeLessThan(12000);
    // ...and the low bidder took the REST of the 45-share float at posted asks
    // (~1,000–1,350/share — far below its 2,000 bid, which it never paid).
    expect(target.shareRegister["corp-1"]).toBe(45 - highShares);
    expect(low.credits).toBeGreaterThan(60000);
    // Register stays whole and nobody crossed the control threshold.
    const total = Object.values(target.shareRegister).reduce((s, n) => s + n, 0);
    expect(total).toBe(target.sharesOutstanding);
    expect(target.hasCharter).toBe(true);
  });

  it("a sell whose limit is above every standing bid does not fill", () => {
    const engine = shareGame((view) => {
      const target = view.corporations.find((c) => c.id === "corp-1")!;
      const held = target.shareRegister[view.me.id] ?? 0;
      if (held === 0) return [{ kind: "buyShares", targetId: "corp-1", shares: 10, limitPrice: 1e9 }];
      return [{ kind: "sellShares", targetId: "corp-1", shares: held, limitPrice: target.sharePrice * 1000 }];
    }, 4);
    const target = engine.corps.find((c) => c.id === "corp-1")!;
    expect(target.shareRegister["corp-0"] ?? 0).toBe(10);
  });
});

describe("equity, acquisition & free operators (Sections 17–18)", () => {
  it("a majority stake absorbs the target's charter and turns it into a Free Operator", () => {
    const config = { ...tinyScenario(2, 3), turns: 5 };
    config.scenario.tuning = { startingCredits: 100000 };
    config.tuning.startingCredits = 100000;
    const registry = new Map<string, BotFactory>([["miner", () => new TakeoverBots()]]);
    const engine = new Engine(config, 0, registry);
    // Control costs ~1.2× the target's market cap (concentration premium), so equals
    // can't absorb equals — give the acquirer the war chest of a stronger corp. This
    // test exercises absorption, not affordability.
    engine.corps.find((c) => c.id === "corp-0")!.credits = 400000;
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
    engine.galaxy.system("s0").stockpile.alloys = 100; // materials must be ON HAND (no auto-buy)
    engine.run();
    expect(engine.galaxy.system("s0").platforms).toBe(engine.config.tuning.platformCap);
  });
});

describe("warships & rare-isotope hulls (Sections 04, 07, 13)", () => {
  it("builds a Range-2 escort that consumes rare isotopes and is stationed at its system", () => {
    const scenario = oneSystem({ rareIsotopes: 5, ice: 4 });
    scenario.tuning = { startingCredits: 20000 };
    const engine = new Engine(loadScenario(scenario), 1, new Map([["noop", () => new ShipyardBot()]]));
    const yard = engine.galaxy.system("s0");
    yard.stockpile.alloys = 100; // hull materials must be ON HAND (no auto-buy)
    yard.stockpile.components = 20;
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
