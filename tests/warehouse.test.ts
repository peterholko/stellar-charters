/**
 * Hub warehouse + walk-the-curve instant trades (ruleset v10). THE RULE: trades execute
 * instantly at the Exchange when the goods are at the hub — the Exchange supplies buys,
 * sells need your stock in the hub warehouse. Instant trades pay a spread and move the price
 * as they fill (no free round trips); warehouse capacity counters hoarding until upgraded.
 */
import { describe, expect, it } from "vitest";
import { generateProceduralScenario } from "../src/engine/procedural.js";
import { loadScenario } from "../src/engine/config.js";
import { Engine } from "../src/engine/engine.js";
import { defaultRegistry } from "../src/engine/bots/registry.js";

function boot(seed = 11) {
  const eng = new Engine(loadScenario(generateProceduralScenario({ seed, players: 2, turns: 12 })), seed, defaultRegistry());
  eng.makeHybrid("corp-0");
  const corp = eng.corps[0]!;
  corp.credits = 100_000;
  const sysId = corp.ownedSystemIds[0]!;
  return { eng, corp, sysId, sys: eng.galaxy.system(sysId), hub: eng.galaxy.hubId };
}

describe("hub warehouse (ruleset v10)", () => {
  it("instant warehouse buys store goods at the hub, walk the price up, and need no freighter", () => {
    const { eng, corp, hub } = boot();
    const p0 = eng.market.prices.metals;
    const convoys = eng.activeConvoys.length;
    expect(eng.instantBuy("corp-0", "metals", 20, hub)).toBeNull();
    expect(corp.hubStockpile.metals).toBe(20);
    expect(eng.market.prices.metals).toBeGreaterThan(p0); // impact at execution, not next clearing
    expect(eng.activeConvoys.length).toBe(convoys); // goods are AT the Exchange — nothing flies
  });

  it("enforces warehouse capacity, and the upgrade order raises it", () => {
    const { eng, corp, sysId, hub } = boot();
    const cap = eng.warehouseCapacity(corp);
    expect(eng.instantBuy("corp-0", "metals", cap + 1, hub)).toMatch(/warehouse full/);
    expect(eng.instantBuy("corp-0", "metals", cap, hub)).toBeNull();
    expect(eng.warehouseUsed(corp)).toBe(cap);
    // Expand it (sealed order; the metals bill must be on hand at a system).
    eng.galaxy.system(sysId).stockpile.metals = 100;
    eng.setHumanOrders("corp-0", [{ kind: "upgradeWarehouse" }]);
    eng.stepTurn();
    expect(corp.warehouseLevel).toBe(1);
    expect(eng.warehouseCapacity(corp)).toBe(cap + eng.config.tuning.warehouse.capacityPerLevel);
  });

  it("instant sells draw only from the warehouse and walk the price down", () => {
    const { eng, corp, hub } = boot();
    expect(eng.instantSell("corp-0", "metals", 5)).toMatch(/no metals in your hub warehouse/);
    expect(eng.instantBuy("corp-0", "metals", 20, hub)).toBeNull();
    const credits = corp.credits;
    const p1 = eng.market.prices.metals;
    expect(eng.instantSell("corp-0", "metals", 20)).toBeNull();
    expect(corp.hubStockpile.metals).toBe(0);
    expect(corp.credits).toBeGreaterThan(credits);
    expect(eng.market.prices.metals).toBeLessThan(p1);
  });

  it("round-tripping the market through the spread is a guaranteed loss (no money pump)", () => {
    const { eng, corp, hub } = boot();
    const start = corp.credits;
    expect(eng.instantBuy("corp-0", "metals", 30, hub)).toBeNull();
    expect(eng.instantSell("corp-0", "metals", 30)).toBeNull();
    expect(corp.credits).toBeLessThan(start);
  });

  it("dispatch ships warehouse goods home as a normal freighter run", () => {
    const { eng, corp, sysId, sys, hub } = boot();
    expect(eng.instantBuy("corp-0", "metals", 20, hub)).toBeNull();
    expect(eng.instantDispatch("corp-0", "metals", 20, sysId)).toBeNull();
    expect(corp.hubStockpile.metals).toBe(0);
    expect(eng.activeConvoys.some((c) => c.owner === "corp-0" && c.kind === "transfer" && c.resource === "metals")).toBe(true);
    const path = eng.galaxy.shortestWarpPath(hub, sysId, corp.rangeTier)!;
    const transit = path.routes.reduce((s, id) => s + eng.galaxy.route(id).transitTime, 0);
    const before = sys.stockpile.metals;
    eng.setHumanOrders("corp-0", []);
    for (let i = 0; i < transit; i++) eng.stepTurn();
    expect(sys.stockpile.metals).toBeGreaterThan(before); // cargo landed at the colony
  });

  it("transfer-to-hub stores on arrival; overflow is consigned for credits, never lost", () => {
    const { eng, corp, sysId, sys, hub } = boot();
    // Fill 40 of the 50-unit warehouse so only 10 slots remain for the inbound 30 metals.
    expect(eng.instantBuy("corp-0", "fuel", 40, hub)).toBeNull();
    sys.stockpile.metals = 30;
    const path = eng.galaxy.shortestWarpPath(sysId, hub, corp.rangeTier)!;
    const transit = path.routes.reduce((s, id) => s + eng.galaxy.route(id).transitTime, 0);
    eng.setHumanOrders("corp-0", [{ kind: "transfer", fromSystemId: sysId, toSystemId: hub, resource: "metals", quantity: 30 }]);
    const reports = [eng.stepTurn()];
    eng.setHumanOrders("corp-0", []);
    for (let i = 1; i < transit; i++) reports.push(eng.stepTurn());
    expect(corp.hubStockpile.metals).toBeCloseTo(10, 6); // capacity-clamped
    const consigned = reports.flatMap((r) => r.ledger).find((l) => l.corpId === "corp-0" && /overflow — consigned/.test(l.detail ?? ""));
    expect(consigned).toBeDefined();
    expect(consigned!.delta).toBeGreaterThan(0); // the 20 overflow sold, not vanished
  });

  it("is deterministic across a mixed instant-action sequence", () => {
    const run = () => {
      const { eng, sysId, hub } = boot(7);
      eng.instantBuy("corp-0", "metals", 15, hub);
      eng.setHumanOrders("corp-0", []);
      eng.stepTurn();
      eng.instantSell("corp-0", "metals", 5);
      eng.instantDispatch("corp-0", "metals", 10, sysId);
      eng.stepTurn();
      return JSON.stringify({
        credits: Math.round(eng.corps[0]!.credits),
        prices: eng.market.prices,
        warehouse: eng.corps[0]!.hubStockpile,
        stock: eng.galaxy.system(sysId).stockpile,
      });
    };
    expect(run()).toBe(run());
  });
});
