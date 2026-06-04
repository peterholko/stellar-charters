import { describe, expect, it } from "vitest";
import { Engine } from "../src/engine/engine.js";
import { defaultRegistry } from "../src/engine/bots/registry.js";
import { tinyScenario } from "./helpers.js";

describe("engine resolution order", () => {
  it("defers convoy settlement to a later turn (no same-turn chaining)", () => {
    // Single player, zero upkeep: credit changes come only from deferred sale payouts.
    const config = { ...tinyScenario(1, 1), turns: 6 };
    const engine = new Engine(config, 0, defaultRegistry());
    const metrics = engine.run();

    const credAt = (t: number) =>
      metrics.snapshots.find((s) => s.turn === t)!.credits["corp-0"]!;

    // Auction (turn 0), turn 2 (first production), and turn 3 (export launches) all
    // hold the same credits — goods leave but payment has not yet arrived.
    expect(credAt(2)).toBe(credAt(0));
    expect(credAt(3)).toBe(credAt(0));
    // Turn 4: the one-turn export reaches the hub and pays out.
    expect(credAt(4)).toBeGreaterThan(credAt(3));
  });

  it("awards one system per player in the opening auction", () => {
    const config = { ...tinyScenario(4, 6), turns: 4 };
    const engine = new Engine(config, 7, defaultRegistry());
    engine.run();
    const owned = engine.corps.map((c) => c.ownedSystemIds.length);
    // Each player wins exactly one inner system at the open (before any expansion this short).
    expect(owned.filter((n) => n >= 1).length).toBe(4);
    const totalInnerOwned = engine.galaxy
      .innerRingSystems()
      .filter((s) => s.owner !== null).length;
    expect(totalInnerOwned).toBeGreaterThanOrEqual(4);
  });

  it("produces a snapshot per resolved turn and finite valuations", () => {
    const config = { ...tinyScenario(4, 6), turns: 8 };
    const engine = new Engine(config, 3, defaultRegistry());
    const metrics = engine.run();
    // Auction snapshot (turn 0) plus turns 2..8.
    expect(metrics.snapshots.length).toBe(1 + 7);
    for (const c of engine.corps) {
      expect(Number.isFinite(c.valuation)).toBe(true);
      expect(Number.isFinite(c.credits)).toBe(true);
    }
  });
});
