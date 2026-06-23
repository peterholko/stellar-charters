/**
 * Extractor builds through the deferred-payment queue (Section 21 + 24): instant when the
 * bill is on hand (covered by replay.test), otherwise the order WAITS as a zero-CP queue item —
 * cancelable by siteKey — and the deposit comes online the moment the materials arrive.
 */
import { describe, expect, it } from "vitest";
import { generateProceduralScenario } from "../src/engine/procedural.js";
import { loadScenario } from "../src/engine/config.js";
import { Engine } from "../src/engine/engine.js";
import { defaultRegistry } from "../src/engine/bots/registry.js";

/** A 2-player procedural game with corp-0 human-driven, its home system stripped of alloys. */
function boot() {
  const seed = 11;
  const eng = new Engine(loadScenario(generateProceduralScenario({ seed, players: 2, turns: 12 })), seed, defaultRegistry());
  eng.makeHybrid("corp-0");
  const corp = eng.corps[0]!;
  corp.credits = 100_000; // credits are never the constraint in these tests
  const sysId = corp.ownedSystemIds[0]!;
  const sys = eng.galaxy.system(sysId);
  for (const id of corp.ownedSystemIds) eng.galaxy.system(id).stockpile.alloys = 0; // bill draws corp-wide
  const target = sys.sites.find((s) => s.extractorLevel === 0)!;
  return { eng, corp, sysId, sys, target };
}

describe("extractor builds wait for materials (zero-CP queue items)", () => {
  it("queues unpaid when alloys are short, then comes online the turn they arrive", () => {
    const { eng, sysId, sys, target } = boot();
    eng.setHumanOrders("corp-0", [{ kind: "buildExtractor", systemId: sysId, siteKey: target.key }]);
    eng.stepTurn();
    const item = sys.queue.find((q) => q.kind === "extractor" && q.siteKey === target.key);
    expect(item).toBeDefined();
    expect(item!.paid).toBe(false); // waiting, not dropped
    expect(sys.sites.find((s) => s.key === target.key)!.extractorLevel).toBe(0);
    // The alloys land (an import arrives) — next resolution pays the bill and works the deposit.
    sys.stockpile.alloys = 10;
    eng.setHumanOrders("corp-0", []);
    eng.stepTurn();
    const site = sys.sites.find((s) => s.key === target.key)!;
    expect(site.extractorLevel).toBe(1);
    expect(site.prospected).toBe(true);
    expect(sys.queue.some((q) => q.kind === "extractor")).toBe(false); // completed, not lingering
  });

  it("cancelBuild with a siteKey removes the waiting extractor", () => {
    const { eng, sysId, sys, target } = boot();
    eng.setHumanOrders("corp-0", [{ kind: "buildExtractor", systemId: sysId, siteKey: target.key }]);
    eng.stepTurn();
    const item = sys.queue.find((q) => q.kind === "extractor" && q.siteKey === target.key)!;
    eng.setHumanOrders("corp-0", [{ kind: "cancelBuild", systemId: sysId, bodyKey: item.bodyKey, siteKey: target.key }]);
    eng.stepTurn();
    expect(sys.queue.some((q) => q.kind === "extractor")).toBe(false);
    expect(sys.sites.find((s) => s.key === target.key)!.extractorLevel).toBe(0); // never built
  });

  it("an import lands within its transit's processing and funds a build the next turn (v8)", () => {
    const { eng, corp, sysId, sys, target } = boot();
    // Total transit hub → home system (1 for an inner-ring world, but derive it for robustness).
    const path = eng.galaxy.shortestWarpPath(eng.galaxy.hubId, sysId, corp.rangeTier)!;
    const transit = path.routes.reduce((s, id) => s + eng.galaxy.route(id).transitTime, 0);
    // Turn 1 player actions: buy alloys for delivery home.
    eng.setHumanOrders("corp-0", [{ kind: "market", side: "buy", resource: "alloys", quantity: 10, limitPrice: 1e9, systemId: sysId, strict: false }]);
    eng.stepTurn(); // turn 1 processing: clears → launches → interdiction window → (transit 1: arrives)
    eng.setHumanOrders("corp-0", []);
    for (let i = 1; i < transit; i++) eng.stepTurn(); // extra hops, one processing each
    expect(sys.stockpile.alloys).toBeGreaterThan(0); // cargo landed
    // Next player actions: the build pays from the landed cargo and completes (extractors are instant).
    eng.setHumanOrders("corp-0", [{ kind: "buildExtractor", systemId: sysId, siteKey: target.key }]);
    eng.stepTurn();
    expect(sys.sites.find((s) => s.key === target.key)!.extractorLevel).toBe(1);
  });

  it("a waiting extractor does not occupy the body's one-building queue slot", () => {
    const { eng, sysId, sys, target } = boot();
    eng.setHumanOrders("corp-0", [{ kind: "buildExtractor", systemId: sysId, siteKey: target.key }]);
    eng.stepTurn();
    const item = sys.queue.find((q) => q.kind === "extractor" && q.siteKey === target.key)!;
    // A reactor on the SAME body must still be accepted (reactors build on any non-star body).
    eng.setHumanOrders("corp-0", [{ kind: "buildReactor", systemId: sysId, bodyKey: item.bodyKey }]);
    eng.stepTurn();
    expect(sys.queue.some((q) => q.kind === "reactor" && q.bodyKey === item.bodyKey)).toBe(true);
    expect(sys.queue.some((q) => q.kind === "extractor" && q.siteKey === target.key)).toBe(true); // both coexist
  });
});
