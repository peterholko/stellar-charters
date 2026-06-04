import { describe, expect, it } from "vitest";
import { DEFAULT_TUNING } from "../src/engine/config.js";
import { Market, type ClearableOrder } from "../src/engine/market.js";

function order(partial: Partial<ClearableOrder>): ClearableOrder {
  return {
    ownerId: "c",
    side: "buy",
    resource: "ice",
    quantity: 10,
    limitPrice: 999,
    strict: false,
    systemId: "s",
    ...partial,
  };
}

describe("galactic exchange", () => {
  it("raises price under net demand and lowers it under net supply", () => {
    const up = new Market(DEFAULT_TUNING);
    up.clear([order({ side: "buy", quantity: 200 })]);
    expect(up.prices.ice).toBeGreaterThan(DEFAULT_TUNING.basePrices.ice);

    const down = new Market(DEFAULT_TUNING);
    down.clear([order({ side: "sell", quantity: 200 })]);
    expect(down.prices.ice).toBeLessThan(DEFAULT_TUNING.basePrices.ice);
  });

  it("clamps price to the configured floor and ceiling", () => {
    const m = new Market(DEFAULT_TUNING);
    for (let i = 0; i < 50; i++) m.clear([order({ side: "sell", quantity: 5000 })]);
    expect(m.prices.ice).toBeGreaterThanOrEqual(m.floor("ice") - 1e-6);

    const m2 = new Market(DEFAULT_TUNING);
    for (let i = 0; i < 50; i++) m2.clear([order({ side: "buy", quantity: 5000 })]);
    expect(m2.prices.ice).toBeLessThanOrEqual(m2.ceil("ice") + 1e-6);
  });

  it("fills non-strict market orders but fails strict orders that miss their price", () => {
    const m = new Market(DEFAULT_TUNING);
    const strictBuy = order({ strict: true, side: "buy", limitPrice: 1 }); // far below price
    const marketBuy = order({ strict: false, side: "buy", limitPrice: 1 });
    const { fills } = m.clear([strictBuy, marketBuy]);
    const strictFill = fills.find((f) => f.order === strictBuy)!;
    const marketFill = fills.find((f) => f.order === marketBuy)!;
    expect(strictFill.filledQuantity).toBe(0);
    expect(marketFill.filledQuantity).toBe(marketBuy.quantity);
  });
});
