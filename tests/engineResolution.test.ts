import { describe, expect, it } from "vitest";
import { Engine } from "../src/engine/engine.js";
import { defaultRegistry } from "../src/engine/bots/registry.js";
import type { Bot, BotFactory, PlayerView } from "../src/engine/bots/bot.js";
import { sellSurplus } from "../src/engine/bots/strategy.js";
import type { BidOrder, Order } from "../src/engine/types.js";
import { tinyScenario } from "./helpers.js";

/** A bot that only sells surplus — no other spending, to isolate settlement timing. */
class SellerBot implements Bot {
  readonly id = "seller";
  bid(_view: PlayerView): BidOrder {
    return { kind: "bid", priorities: [] }; // no opening auction any more
  }
  decide(view: PlayerView): Order[] {
    return sellSurplus(view);
  }
}

describe("engine resolution order", () => {
  it("defers convoy settlement to a later turn (no same-turn chaining)", () => {
    // Single seller-only player (zero upkeep): credit changes come only from deferred
    // sale payouts. Systems are seeded at start, so production begins on turn 1. Fleet fuel
    // upkeep (Section 07b) is zeroed so the only per-turn credit movement is sale settlement.
    const base = tinyScenario(1, 1);
    const config = { ...base, turns: 6, tuning: { ...base.tuning, fuelPerShipPerTurn: 0 } };
    const registry = new Map<string, BotFactory>([["miner", () => new SellerBot()]]);
    const engine = new Engine(config, 0, registry);
    const metrics = engine.run();

    const credAt = (t: number) =>
      metrics.snapshots.find((s) => s.turn === t)!.credits["corp-0"]!;

    // Turn 2 ships the first export, but the one-turn convoy has not arrived yet, so
    // credits are unchanged from turn 1 — goods leave before payment.
    expect(credAt(2)).toBe(credAt(1));
    // Turn 3: the export reaches the hub and pays out.
    expect(credAt(3)).toBeGreaterThan(credAt(2));
  });

  it("seeds each player onto a distinct inner-ring starting system", () => {
    const config = { ...tinyScenario(4, 6), turns: 4 };
    const engine = new Engine(config, 7, defaultRegistry());
    // Assignment happens at construction (before any turn).
    const owned = engine.corps.map((c) => c.ownedSystemIds.length);
    expect(owned.filter((n) => n >= 1).length).toBe(4);
    const innerOwners = new Set(
      engine.galaxy.innerRingSystems().filter((s) => s.owner !== null).map((s) => s.owner),
    );
    // Four distinct corporations each hold a distinct inner system at the open.
    expect(innerOwners.size).toBe(4);
  });

  it("produces a snapshot per resolved turn and finite valuations", () => {
    const config = { ...tinyScenario(4, 6), turns: 8 };
    const engine = new Engine(config, 3, defaultRegistry());
    const metrics = engine.run();
    // One snapshot per resolved turn, 1..8.
    expect(metrics.snapshots.length).toBe(8);
    for (const c of engine.corps) {
      expect(Number.isFinite(c.valuation)).toBe(true);
      expect(Number.isFinite(c.credits)).toBe(true);
    }
  });
});
