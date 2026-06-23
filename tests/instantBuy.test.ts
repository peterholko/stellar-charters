/**
 * Instant hub buys (ruleset v9): executed during the planning window at the posted price,
 * freighter spawned immediately (flies during the coming resolution, v8 transit), volume
 * pressed onto the next clearing so prices respond. Replays as a logged call sequence.
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
  return { eng, corp, sysId, sys: eng.galaxy.system(sysId) };
}

describe("instant hub buys (planning-window actions)", () => {
  it("charges the posted price now, spawns the freighter, and delivers on the v8 schedule", () => {
    const { eng, corp, sysId } = boot();
    const before = corp.credits;
    const err = eng.instantBuy("corp-0", "metals", 10, sysId);
    expect(err).toBeNull();
    expect(corp.credits).toBeLessThan(before); // charged immediately
    expect(eng.activeConvoys.some((c) => c.owner === "corp-0" && c.kind === "buy" && c.resource === "metals")).toBe(true);
    const path = eng.galaxy.shortestWarpPath(eng.galaxy.hubId, sysId, corp.rangeTier)!;
    const transit = path.routes.reduce((s, id) => s + eng.galaxy.route(id).transitTime, 0);
    eng.setHumanOrders("corp-0", []);
    const reports = [];
    for (let i = 0; i < transit; i++) reports.push(eng.stepTurn());
    // The planning-window purchase appears in the NEXT report (fill event + ledger line)...
    expect(reports[0]!.events.some((e) => e.type === "fill" && e.corpId === "corp-0" && e.side === "buy" && e.resource === "metals")).toBe(true);
    expect(reports[0]!.ledger.some((l) => l.corpId === "corp-0" && l.cause === "marketBuy" && l.delta < 0)).toBe(true);
    // ...and the cargo lands within the transit's processings.
    expect(reports[transit - 1]!.events.some((e) => e.type === "arrival" && e.corpId === "corp-0" && e.resource === "metals")).toBe(true);
  });

  it("rejects an unaffordable buy without changing any state", () => {
    const { eng, corp, sysId } = boot();
    corp.credits = 5;
    const convoysBefore = eng.activeConvoys.length;
    const err = eng.instantBuy("corp-0", "metals", 1000, sysId);
    expect(err).toMatch(/Cr on hand/);
    expect(corp.credits).toBe(5);
    expect(eng.activeConvoys.length).toBe(convoysBefore);
  });

  it("presses instant volume onto the next clearing so prices respond", () => {
    const { eng, sysId } = boot();
    const priceBefore = eng.market.prices.metals;
    expect(eng.instantBuy("corp-0", "metals", 500, sysId)).toBeNull(); // a big squeeze
    eng.setHumanOrders("corp-0", []);
    eng.stepTurn();
    expect(eng.market.prices.metals).toBeGreaterThan(priceBefore);
  });

  it("is deterministic: the same call sequence from the same seed converges", () => {
    const run = () => {
      const { eng, sysId } = boot(7);
      eng.instantBuy("corp-0", "metals", 12, sysId);
      eng.setHumanOrders("corp-0", []);
      eng.stepTurn();
      eng.instantBuy("corp-0", "fuel", 6, sysId);
      eng.stepTurn();
      return JSON.stringify({
        credits: Math.round(eng.corps[0]!.credits),
        prices: eng.market.prices,
        stock: eng.galaxy.system(sysId).stockpile,
      });
    };
    expect(run()).toBe(run());
  });
});
