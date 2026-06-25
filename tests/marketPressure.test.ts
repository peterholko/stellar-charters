/**
 * Phase B — between-turns market visibility. The fogged pressure signal and the opt-in projected
 * clearing price are READ-ONLY projections: they must aggregate to a direction only (no per-rival
 * data, no raw quantities) and must never perturb the authoritative `Market.prices` or touch RNG.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_TUNING,
  Market,
  buildClientState,
  marketPressureFrom,
  projectClearingPrices,
  RESOURCES,
  type ClearableOrder,
  type MarketOrder,
  type Order,
} from "../src/engine/index.js";
import { Engine } from "../src/engine/engine.js";
import { loadScenario } from "../src/engine/config.js";
import { generateProceduralScenario } from "../src/engine/procedural.js";
import { defaultRegistry } from "../src/engine/bots/registry.js";

function sell(resource: MarketOrder["resource"], quantity: number): MarketOrder {
  return { kind: "market", side: "sell", resource, quantity, limitPrice: 0, systemId: "s0", strict: false };
}
function buy(resource: MarketOrder["resource"], quantity: number): MarketOrder {
  return { kind: "market", side: "buy", resource, quantity, limitPrice: 9999, systemId: "s0", strict: false };
}

describe("market pressure — fogged direction signal (Phase B)", () => {
  const listed = [...RESOURCES];

  it("buckets net (demand − supply) into the five bands, normalized by priceReferenceVolume", () => {
    const ref = DEFAULT_TUNING.priceReferenceVolume; // 40
    // Two rival seats both dumping metals → heavy net sell; a buyer nudges ice up; food untouched.
    const seats: Order[][] = [
      [sell("metals", ref), buy("ice", Math.ceil(ref * 0.3))],
      [sell("metals", ref)],
    ];
    const p = marketPressureFrom(DEFAULT_TUNING, listed, seats);
    expect(p.metals.direction).toBe("heavySell"); // net -2 refVol
    expect(p.ice.direction).toBe("buy"); // net +0.3 refVol
    expect(p.food.direction).toBe("balanced"); // no orders
  });

  it("treats a mild imbalance as sell/buy and a tiny one as balanced", () => {
    const ref = DEFAULT_TUNING.priceReferenceVolume;
    expect(marketPressureFrom(DEFAULT_TUNING, listed, [[sell("metals", Math.ceil(ref * 0.5))]]).metals.direction).toBe("sell");
    expect(marketPressureFrom(DEFAULT_TUNING, listed, [[sell("metals", 1)]]).metals.direction).toBe("balanced");
    expect(marketPressureFrom(DEFAULT_TUNING, listed, [[buy("metals", ref * 2)]]).metals.direction).toBe("heavyBuy");
  });

  it("FOG: cells carry a direction ONLY — no quantities, no seat identities", () => {
    const seats: Order[][] = [[sell("metals", 200)], [sell("metals", 137)]];
    const p = marketPressureFrom(DEFAULT_TUNING, listed, seats);
    // Every cell is exactly { direction } — nothing else leaks through.
    for (const r of RESOURCES) expect(Object.keys(p[r])).toEqual(["direction"]);
    // The serialized signal exposes no raw quantity and no owner id.
    const json = JSON.stringify(p);
    expect(json).not.toMatch(/200|137/);
    expect(json).not.toMatch(/corp|owner|seat|s0/);
  });

  it("FOG: unlisted resources read balanced even when orders exist for them", () => {
    // antimatter is deep-tier; if it isn't listed, no pressure leaks regardless of staged orders.
    const p = marketPressureFrom(DEFAULT_TUNING, ["metals"], [[sell("antimatter", 999), sell("metals", 999)]]);
    expect(p.antimatter.direction).toBe("balanced");
    expect(p.metals.direction).toBe("heavySell");
  });
});

describe("projected clearing price — pure read-only projection (Phase B)", () => {
  it("never mutates the committed Market.prices", () => {
    const market = new Market(DEFAULT_TUNING);
    const before = { ...market.prices };
    const orders: ClearableOrder[] = [
      { ownerId: "x", side: "sell", resource: "metals", quantity: 400, limitPrice: 0, strict: false, systemId: "s0" },
    ];
    const projected = projectClearingPrices(DEFAULT_TUNING, market.prices, orders);
    expect(projected.metals).toBeLessThan(before.metals); // it DID compute a lower price
    expect(market.prices).toEqual(before); // ...but committed prices are untouched
  });

  it("matches what clear() would commit, without committing it", () => {
    const preview = new Market(DEFAULT_TUNING);
    const committed = new Market(DEFAULT_TUNING);
    const orders: ClearableOrder[] = [
      { ownerId: "x", side: "sell", resource: "silicates", quantity: 120, limitPrice: 0, strict: false, systemId: "s0" },
    ];
    const projected = projectClearingPrices(DEFAULT_TUNING, preview.prices, orders);
    const { clearingPrices } = committed.clear(orders);
    expect(projected).toEqual(clearingPrices);
    expect(preview.prices.silicates).toBe(DEFAULT_TUNING.basePrices.silicates); // preview market never moved
  });

  it("buildClientState with projectPrices does not perturb the engine's authoritative prices", () => {
    const config = loadScenario(generateProceduralScenario({ seed: 4, players: 4 }));
    const engine = new Engine(config, 4, defaultRegistry());
    for (let t = 0; t < 6; t++) engine.stepTurn();
    const before = { ...engine.market.prices };
    const listed = engine.listedResources();
    const someListed = listed[0]!;
    const locked: Order[][] = [[{ kind: "market", side: "sell", resource: someListed, quantity: 500, limitPrice: 0, systemId: "s0", strict: false }]];
    const cs = buildClientState(engine, engine.corps[0]!.id, "g", [], { lockedOrders: locked, projectPrices: true });
    expect(cs.projectedPrices).toBeDefined();
    expect(engine.market.prices).toEqual(before); // the preview left the live market untouched
    // Default OFF: omitting the flag yields no projection.
    const off = buildClientState(engine, engine.corps[0]!.id, "g", [], { lockedOrders: locked });
    expect(off.projectedPrices).toBeUndefined();
  });
});
