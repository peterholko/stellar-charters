import { describe, expect, it } from "vitest";
import { resolveAuction } from "../src/engine/auction.js";
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
