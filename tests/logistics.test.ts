/**
 * Phase D — the per-turn "logistics focus" standing decision. The focus draws on one renewable
 * token: exactly one mode applies per turn, modes are mutually exclusive (no stacking), and a focus
 * cannot be queued ahead (no carryover to later turns). We verify the token semantics directly via
 * `resolveLogisticsFocus`, and the one-turn modifier observably via `escortNext` on a live convoy.
 */
import { describe, expect, it } from "vitest";
import { Engine, resolveLogisticsFocus } from "../src/engine/engine.js";
import { defaultRegistry } from "../src/engine/bots/registry.js";
import { DEFAULT_TUNING } from "../src/engine/config.js";
import type { MarketOrder, Order } from "../src/engine/types.js";
import { tinyScenario } from "./helpers.js";

const BONUS = DEFAULT_TUNING.logisticsFocus.escortBonus;
const sell = (qty = 20): MarketOrder =>
  ({ kind: "market", side: "sell", resource: "metals", quantity: qty, limitPrice: 0, systemId: "s0", strict: false });

/** A seat that owns s0 with stock, on lanes long enough that its outbound convoy is still in transit
 *  after the launch turn (so we can read the escort the engine assigned it). */
function setup(seed = 1) {
  const engine = new Engine(tinyScenario(2, 4), seed, defaultRegistry());
  const corp = engine.corps[0]!;
  const sys = engine.galaxy.system("s0");
  sys.owner = corp.id;
  if (!corp.ownedSystemIds.includes("s0")) corp.ownedSystemIds.push("s0");
  sys.stockpile.metals = 500;
  for (const r of engine.galaxy.routes.values()) r.transitTime = 2; // keep convoys in flight one turn
  engine.makeHybrid(corp.id); // make the seat human-controllable
  return { engine, corp };
}

function escortOf(engine: Engine, corpId: string, launchedTurn: number): number | null {
  const cv = engine.activeConvoys.find((c) => c.owner === corpId && c.kind === "sell" && c.launchedTurn === launchedTurn);
  return cv ? cv.escort : null;
}

describe("resolveLogisticsFocus — one exclusive token", () => {
  it("returns null when no focus is staged", () => {
    expect(resolveLogisticsFocus([sell()])).toBeNull();
    expect(resolveLogisticsFocus([])).toBeNull();
  });

  it("takes exactly the first focus — exclusive, never two at once", () => {
    const orders: Order[] = [
      { kind: "logisticsFocus", focus: "escortNext" },
      { kind: "logisticsFocus", focus: "expediteBuild" },
      { kind: "logisticsFocus", focus: "surveyPush" },
    ];
    expect(resolveLogisticsFocus(orders)).toBe("escortNext");
    expect(resolveLogisticsFocus([sell(), { kind: "logisticsFocus", focus: "surveyPush" }])).toBe("surveyPush");
  });
});

describe("escortNext — applies once, never stacks, never carries over", () => {
  it("adds exactly the escort bonus to this turn's outbound convoys", () => {
    const { engine, corp } = setup();
    engine.setHumanOrders(corp.id, [{ kind: "logisticsFocus", focus: "escortNext" }, sell()]);
    engine.stepTurn();
    expect(escortOf(engine, corp.id, 1)).toBe(BONUS); // 0 stationed defence + 0 escort orders + bonus
  });

  it("cannot stack — two focus orders still apply the bonus once", () => {
    const { engine, corp } = setup();
    engine.setHumanOrders(corp.id, [
      { kind: "logisticsFocus", focus: "escortNext" },
      { kind: "logisticsFocus", focus: "escortNext" },
      sell(),
    ]);
    engine.stepTurn();
    expect(escortOf(engine, corp.id, 1)).toBe(BONUS); // not 2× bonus
  });

  it("a non-escort focus does not boost escort (exclusive choice)", () => {
    const { engine, corp } = setup();
    engine.setHumanOrders(corp.id, [{ kind: "logisticsFocus", focus: "surveyPush" }, sell()]);
    engine.stepTurn();
    expect(escortOf(engine, corp.id, 1)).toBe(0);
  });

  it("cannot be pre-queued — the focus does not carry to a later turn", () => {
    const { engine, corp } = setup();
    // Turn 1: focus chosen → boosted convoy.
    engine.setHumanOrders(corp.id, [{ kind: "logisticsFocus", focus: "escortNext" }, sell()]);
    engine.stepTurn();
    expect(escortOf(engine, corp.id, 1)).toBe(BONUS);
    // Turn 2: no focus staged → the new convoy gets no residual bonus.
    engine.setHumanOrders(corp.id, [sell()]);
    engine.stepTurn();
    expect(escortOf(engine, corp.id, 2)).toBe(0);
  });
});

describe("logistics focus — headless games stay stable", () => {
  it("a full game where a seat focuses every turn still completes 42 turns", () => {
    const engine = new Engine(tinyScenario(4, 8), 7, defaultRegistry());
    const corp = engine.corps[0]!;
    engine.makeHybrid(corp.id);
    const modes = ["escortNext", "expediteBuild", "surveyPush"] as const;
    for (let t = 0; t < 42 && !engine.isOver; t++) {
      engine.setHumanOrders(corp.id, [{ kind: "logisticsFocus", focus: modes[t % 3]! }]);
      expect(() => engine.stepTurn()).not.toThrow();
    }
  });
});
