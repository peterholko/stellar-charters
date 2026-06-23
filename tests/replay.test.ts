/**
 * Event-sourced replay determinism for the body-driven model (Section 21).
 *
 * The Worker persists only (seed, players, per-seat orders) and rebuilds the authoritative game
 * by replaying orders through the engine. These tests prove the new *mutable site state*
 * (extractor levels, remaining reserves, sabotage/stellar timers) is fully reconstructed by
 * replay — both for bot-driven games and for human-submitted `buildExtractor` orders.
 */
import { describe, expect, it } from "vitest";
import { generateProceduralScenario } from "../src/engine/procedural.js";
import { loadScenario } from "../src/engine/config.js";
import { Engine } from "../src/engine/engine.js";
import { defaultRegistry } from "../src/engine/bots/registry.js";
import { buildClientState } from "../src/engine/clientState.js";

/** A digest of every system's mutable site state after a full game. */
function siteDigest(seed: number, players = 6, turns = 42): string {
  const eng = new Engine(loadScenario(generateProceduralScenario({ seed, players, turns })), seed, defaultRegistry());
  eng.run();
  const parts: string[] = [];
  for (const sys of eng.galaxy.allSystems()) {
    for (const s of sys.sites) {
      parts.push(`${sys.id}:${s.key}:${s.extractorLevel}:${s.reservesRemaining}:${s.disabledUntil}:${Math.round(sys.stockpile[s.resource])}`);
    }
  }
  return parts.join("|");
}

describe("replay determinism — body-driven site state (Section 21)", () => {
  it("reconstructs identical extractor/reserve/sabotage state from the same seed", () => {
    expect(siteDigest(123)).toBe(siteDigest(123));
    expect(siteDigest(7, 8)).toBe(siteDigest(7, 8));
  });

  it("diverges across seeds (the body economy actually varies)", () => {
    expect(siteDigest(1)).not.toBe(siteDigest(2));
  });

  it("replays a human-submitted buildExtractor order identically", () => {
    const run = (seed: number): number => {
      const scen = generateProceduralScenario({ seed, players: 2, turns: 6 });
      const eng = new Engine(loadScenario(scen), seed, defaultRegistry());
      eng.makeHybrid("corp-0");
      const sysId = eng.corps[0]!.ownedSystemIds[0]!;
      eng.galaxy.system(sysId).stockpile.alloys = 10; // build materials must be ON HAND (no auto-buy)
      const target = eng.galaxy.system(sysId).sites.find((s) => s.extractorLevel === 0);
      // Turn 1: the human works a previously-unworked deposit.
      eng.setHumanOrders("corp-0", target ? [{ kind: "buildExtractor", systemId: sysId, siteKey: target.key }] : []);
      eng.stepTurn();
      eng.setHumanOrders("corp-0", null); // subsequent turns fall back to the AI
      for (let i = 0; i < 4; i++) eng.stepTurn();
      const site = eng.galaxy.system(sysId).sites.find((s) => s.key === target?.key);
      return site?.extractorLevel ?? -1;
    };
    expect(run(55)).toBe(run(55));
    expect(run(55)).toBeGreaterThan(0); // the order actually worked the deposit
  });
});

describe("client-state payload (Section 21 fog)", () => {
  it("stays compact even on a large procedural galaxy", () => {
    const scen = generateProceduralScenario({ seed: 9, players: 8, turns: 42 });
    const eng = new Engine(loadScenario(scen), 9, defaultRegistry());
    for (let i = 0; i < 10; i++) eng.stepTurn();
    const state = buildClientState(eng, "corp-0", "g", []);
    const bytesPerSystem = JSON.stringify(state.systems).length / state.systems.length;
    // A per-system snapshot carries its fogged deposit list; keep it bounded (sanity check that
    // we're not shipping anything pathological per poll — e.g. the old all-zero yields object).
    expect(bytesPerSystem).toBeLessThan(2500);
  });
});
