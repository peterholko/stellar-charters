/**
 * Slice D identity & drama rules: charter types apply from their recorded pick turn (so the
 * event-sourced replay is stable), and commodity staging keeps unlisted goods off the Exchange.
 */
import { describe, expect, it } from "vitest";
import { Engine } from "../src/engine/engine.js";
import { defaultRegistry } from "../src/engine/bots/registry.js";
import type { Bot, BotFactory } from "../src/engine/bots/bot.js";
import type { BidOrder, Order } from "../src/engine/types.js";
import { tinyScenario } from "./helpers.js";

class NoopBot implements Bot {
  readonly id = "noop";
  bid(): BidOrder { return { kind: "bid", priorities: [] }; }
  decide(): Order[] { return []; }
}
// tinyScenario declares its seats as bot id "miner" — register the do-nothing bot under it.
const noopReg = (): Map<string, BotFactory> => new Map([["miner", () => new NoopBot()]]);

describe("charter types (review Section 5)", () => {
  it("applies the charter's modifiers only from its recorded pick turn", () => {
    // Security Contractor pays +15% upkeep. Pick effective from turn 3: turns 1–2 bill base
    // upkeep, turn 3+ bills the premium — exactly how the event-sourced replay re-derives it.
    const upkeepAt = (turn: number): number => {
      const config = { ...tinyScenario(1, 1), turns: 6 };
      const eng = new Engine(config, 0, noopReg());
      eng.galaxy.system("s0").upkeep = 100;
      eng.setCharter("corp-0", "security", 3);
      let upkeep = 0;
      for (let t = 1; t <= turn; t++) {
        const rep = eng.stepTurn();
        if (t === turn) upkeep = rep.ledger.filter((l) => l.cause === "upkeep" && l.corpId === "corp-0").reduce((s, l) => s - l.delta, 0);
      }
      return upkeep;
    };
    expect(upkeepAt(2)).toBeCloseTo(100, 4); // before the pick turn: base
    expect(upkeepAt(3)).toBeCloseTo(115, 4); // from the pick turn: the Security premium
  });

  it("is picked once — a second setCharter is ignored", () => {
    const eng = new Engine({ ...tinyScenario(1, 1), turns: 4 }, 0, noopReg());
    eng.setCharter("corp-0", "shipping", 1);
    eng.setCharter("corp-0", "security", 1);
    expect(eng.corps[0]!.charter).toBe("shipping");
  });
});

describe("commodity staging (review Section 13)", () => {
  it("lists only tier-gated goods and refuses Exchange orders for the rest", () => {
    const config = { ...tinyScenario(1, 1), turns: 6 };
    const eng = new Engine(config, 0, defaultRegistry());
    // Everyone is Range 1 → the early board: 6 goods, no silicates/antimatter.
    const listed = eng.listedResources();
    expect(listed).toEqual(["ice", "metals", "helium3", "food", "fuel", "alloys"]);
    // A sell order for an unlisted good does not clear (no fill event, stockpile untouched).
    const sys = eng.galaxy.system("s0");
    sys.stockpile.antimatter = 50;
    eng.makeHybrid("corp-0");
    eng.setHumanOrders("corp-0", [{ kind: "market", side: "sell", resource: "antimatter", quantity: 10, limitPrice: 1, systemId: "s0", strict: false }]);
    const rep = eng.stepTurn();
    expect(rep.events.some((e) => e.type === "fill" && e.resource === "antimatter")).toBe(false);
    expect(eng.galaxy.system("s0").stockpile.antimatter).toBe(50);
    // Fielding the gate tier lists the good for EVERYONE (public, deterministic).
    eng.corps[0]!.rangeTier = 4;
    expect(eng.listedResources()).toContain("antimatter");
  });
});
