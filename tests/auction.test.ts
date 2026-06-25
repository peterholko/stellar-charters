import { describe, expect, it } from "vitest";
import { resolveAuction } from "../src/engine/auction.js";
import { Engine } from "../src/engine/engine.js";
import { loadScenario } from "../src/engine/config.js";
import { generateProceduralScenario } from "../src/engine/procedural.js";
import { defaultRegistry } from "../src/engine/bots/registry.js";
import type { BidOrder } from "../src/engine/types.js";
import { makeCorp, tinyScenario } from "./helpers.js";

const corp = (id: string) => makeCorp({ id });

describe("opening auction", () => {
  it("awards each contested system to the highest bidder, one per player", () => {
    const config = tinyScenario(2, 2);
    const corps = [corp("a"), corp("b")];
    const bids = new Map<string, BidOrder>([
      ["a", { kind: "bid", priorities: [{ systemId: "s0", amount: 5000 }, { systemId: "s1", amount: 1000 }] }],
      ["b", { kind: "bid", priorities: [{ systemId: "s0", amount: 4000 }, { systemId: "s1", amount: 900 }] }],
    ]);
    const result = resolveAuction(config, corps, bids);
    expect(result.winners.get("s0")).toBe("a"); // higher bid wins the premium system
    expect(result.awarded.get("a")).toBe("s0");
    expect(result.awarded.get("b")).toBe("s1"); // fallback secures the runner-up a claim
  });

  it("never awards a single player two systems", () => {
    const config = tinyScenario(2, 2);
    const corps = [corp("a"), corp("b")];
    const bids = new Map<string, BidOrder>([
      ["a", { kind: "bid", priorities: [{ systemId: "s0", amount: 5000 }, { systemId: "s1", amount: 5000 }] }],
      ["b", { kind: "bid", priorities: [{ systemId: "s0", amount: 100 }, { systemId: "s1", amount: 100 }] }],
    ]);
    const result = resolveAuction(config, corps, bids);
    expect(result.awarded.get("a")).toBe("s0");
    expect(result.winners.get("s1")).toBe("b"); // a is capped at one, so b takes s1
  });
});

describe("opening auction — engine integration (Section 05)", () => {
  const build = (seed: number, players: number) =>
    new Engine(
      loadScenario(generateProceduralScenario({ seed, players, turns: 12 })),
      seed,
      defaultRegistry(),
      { openingAuction: true },
    );

  it("seats every charter on exactly one distinct home (guaranteed, with fallback)", () => {
    const eng = build(7, 6);
    eng.stepAuction();
    const homes = new Set<string>();
    for (const corp of eng.corps) {
      expect(corp.hasCharter).toBe(true);
      expect(corp.ownedSystemIds.length).toBe(1); // exactly one home — no one left without a charter
      homes.add(corp.ownedSystemIds[0]!);
    }
    expect(homes.size).toBe(eng.corps.length); // distinct homes, no overlap
  });

  it("charges bidders — credits leave the players (winning bids + lost-bid forfeits)", () => {
    const eng = build(3, 4);
    const before = eng.corps.reduce((s, c) => s + c.credits, 0);
    eng.stepAuction();
    const after = eng.corps.reduce((s, c) => s + c.credits, 0);
    expect(after).toBeLessThan(before);
  });

  it("is deterministic — same seed yields identical homes and credits", () => {
    const a = build(11, 6); a.stepAuction();
    const b = build(11, 6); b.stepAuction();
    expect(a.corps.map((c) => [c.id, c.ownedSystemIds[0], c.credits])).toEqual(
      b.corps.map((c) => [c.id, c.ownedSystemIds[0], c.credits]),
    );
  });

  it("plays a full game with the auction enabled without throwing", () => {
    const metrics = build(5, 8).run();
    expect(Object.keys(metrics.finalValuation).length).toBe(8);
    expect(metrics.auctionFallbackUsage).toBeGreaterThanOrEqual(0);
    expect(metrics.auctionFallbackUsage).toBeLessThanOrEqual(1);
  });
});
