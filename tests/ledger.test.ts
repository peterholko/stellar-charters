/**
 * The Ledger (design rule #1): every credit that enters or leaves a corp's account appears as
 * a ledger line with a cause — no exceptions, including automation. The invariant test here is
 * the load-bearing guard: any future code path that mutates `corp.credits` without going
 * through `Engine.credit()` makes Σ(ledger deltas) drift from Δcredits and fails this suite.
 */
import { describe, expect, it } from "vitest";
import { Engine } from "../src/engine/engine.js";
import { buildClientState } from "../src/engine/clientState.js";
import { loadScenario } from "../src/engine/config.js";
import { generateProceduralScenario } from "../src/engine/procedural.js";
import { defaultRegistry } from "../src/engine/bots/registry.js";
import { tinyScenario } from "./helpers.js";

describe("ledger invariant — Σ deltas == Δ credits, per corp, every turn", () => {
  it("holds across a full 8-player procedural bot game", () => {
    const config = loadScenario(generateProceduralScenario({ seed: 5, players: 8 }));
    const engine = new Engine(config, 5, defaultRegistry());
    let turns = 0;
    while (!engine.isOver && turns < config.turns) {
      const before = new Map(engine.corps.map((c) => [c.id, c.credits]));
      const report = engine.stepTurn();
      turns++;
      for (const corp of engine.corps) {
        const sum = report.ledger
          .filter((l) => l.corpId === corp.id)
          .reduce((s, l) => s + l.delta, 0);
        const actual = corp.credits - before.get(corp.id)!;
        expect(actual, `turn ${report.turn}, ${corp.id}`).toBeCloseTo(sum, 4);
      }
    }
    expect(turns).toBeGreaterThan(10); // the game genuinely ran
  });

  it("holds on the flat legacy scenario too", () => {
    const config = { ...tinyScenario(4, 6), turns: 12 };
    const engine = new Engine(config, 3, defaultRegistry());
    for (let t = 0; t < 12 && !engine.isOver; t++) {
      const before = new Map(engine.corps.map((c) => [c.id, c.credits]));
      const report = engine.stepTurn();
      for (const corp of engine.corps) {
        const sum = report.ledger.filter((l) => l.corpId === corp.id).reduce((s, l) => s + l.delta, 0);
        expect(corp.credits - before.get(corp.id)!, `turn ${report.turn}, ${corp.id}`).toBeCloseTo(sum, 4);
      }
    }
  });

  it("is deterministic — identical ledgers from the same seed", () => {
    const run = () => {
      const config = loadScenario(generateProceduralScenario({ seed: 11, players: 4 }));
      const engine = new Engine(config, 11, defaultRegistry());
      const ledgers = [];
      for (let t = 0; t < 15 && !engine.isOver; t++) ledgers.push(engine.stepTurn().ledger);
      return ledgers;
    };
    expect(run()).toEqual(run());
  });

  it("fog-of-war: each seat's ClientState carries only its OWN ledger lines", () => {
    const config = loadScenario(generateProceduralScenario({ seed: 7, players: 4 }));
    const engine = new Engine(config, 7, defaultRegistry());
    const reports = [];
    for (let t = 0; t < 10 && !engine.isOver; t++) reports.push(engine.stepTurn());
    const me = engine.corps[0]!.id;
    const rival = engine.corps[1]!.id;
    const cs = buildClientState(engine, me, "g", reports);
    const all = cs.reports.flatMap((r) => r.ledger);
    expect(all.length).toBeGreaterThan(0); // an active economy produced lines for this seat
    expect(all.every((l) => l.corpId === me)).toBe(true);
    expect(all.some((l) => l.corpId === rival)).toBe(false);
  });

  it("itemizes the remaining automatic flows: upkeep, tax, and fuel appear with causes", () => {
    const config = loadScenario(generateProceduralScenario({ seed: 5, players: 8 }));
    const engine = new Engine(config, 5, defaultRegistry());
    const causes = new Set<string>();
    for (let t = 0; t < 30 && !engine.isOver; t++) {
      for (const l of engine.stepTurn().ledger) causes.add(l.cause);
    }
    // The previously-silent flows are now on the statement. (marketBuy/emergencyImport etc. are
    // seed-dependent — only the structurally guaranteed causes are asserted. Build-material
    // procurement no longer exists at all: materials must be on hand or the build refuses.)
    for (const expected of ["upkeep", "tax", "fuelUpkeep", "convoyPayout"]) {
      expect(causes, `missing cause ${expected}`).toContain(expected);
    }
    expect(causes).not.toContain("procurement"); // the invisible hand is gone, not just billed
  });
});
