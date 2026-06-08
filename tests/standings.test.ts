/**
 * Victory standings + end-game outcome (Section 29). Pure ranking over engine state: score
 * (valuation + prestige), deterministic tie-breaks, the early-monopoly decisive win, and the
 * derivation of *how* the winner won (economic / conquest / technology / wonder).
 */
import { describe, expect, it } from "vitest";
import { computeOutcome } from "../src/engine/standings.js";
import { Galaxy } from "../src/engine/galaxy.js";
import { SECRET_TECH_IDS } from "../src/engine/research.js";
import { makeCorp, tinyScenario } from "./helpers.js";
import type { MegastructureKind } from "../src/engine/types.js";

const cfg = tinyScenario(2, 2);
const galaxy = new Galaxy(cfg);
const T = cfg.tuning;
const SECRET = SECRET_TECH_IDS[0]!;

describe("standings — ranking & tie-breaks", () => {
  it("ranks by score and breaks exact ties by valuation then corpId", () => {
    const a = makeCorp({ id: "a", valuation: 1000, hasCharter: true });
    const b = makeCorp({ id: "b", valuation: 1000, hasCharter: true });
    const out = computeOutcome([b, a], galaxy, T, 5, 42);
    expect(out.standings.map((s) => s.corpId)).toEqual(["a", "b"]); // equal score → corpId order
    expect(out.standings[0]!.rank).toBe(1);
    expect(out.standings[1]!.rank).toBe(2);
  });

  it("is fully deterministic (same inputs → identical outcome)", () => {
    const corps = [makeCorp({ id: "a", valuation: 5000, hasCharter: true }), makeCorp({ id: "b", valuation: 9000, hasCharter: true })];
    expect(computeOutcome(corps, galaxy, T, 5, 42)).toEqual(computeOutcome(corps, galaxy, T, 5, 42));
  });
});

describe("standings — prestige scoring & victory paths", () => {
  it("a galaxy-unique secret project can overturn a richer rival → Technological Ascendancy", () => {
    const rich = makeCorp({ id: "a", valuation: 50000, hasCharter: true });
    const techer = makeCorp({ id: "b", valuation: 40000, hasCharter: true, research: { completed: [SECRET], queue: [], invested: {}, banked: 0 } });
    const out = computeOutcome([rich, techer], galaxy, T, 42, 42);
    expect(out.over).toBe(true);
    expect(out.winnerId).toBe("b"); // 40000 + secretPoints(15000) beats 50000
    expect(out.victoryType).toBe("technology");
    expect(out.standings.find((s) => s.corpId === "b")!.secrets).toBe(1);
  });

  it("the most chartered systems (held by force) reads as Conquest", () => {
    const warlord = makeCorp({ id: "a", valuation: 10000, hasCharter: true, ownedSystemIds: ["x0", "x1", "x2"] });
    const trader = makeCorp({ id: "b", valuation: 10000, hasCharter: true, ownedSystemIds: ["y0"] });
    const out = computeOutcome([warlord, trader], galaxy, T, 42, 42);
    expect(out.winnerId).toBe("a");
    expect(out.victoryType).toBe("conquest");
  });

  it("the most megastructures reads as a Galactic Wonder", () => {
    const g = new Galaxy(cfg);
    g.system("s0").megastructures = ["orbitalStation", "ringworld"] as MegastructureKind[];
    const builder = makeCorp({ id: "a", valuation: 10000, hasCharter: true, ownedSystemIds: ["s0"] });
    const rival = makeCorp({ id: "b", valuation: 10000, hasCharter: true, ownedSystemIds: ["s1"] });
    const out = computeOutcome([builder, rival], g, T, 42, 42);
    expect(out.standings.find((s) => s.corpId === "a")!.megastructures).toBe(2);
    expect(out.winnerId).toBe("a");
    expect(out.victoryType).toBe("wonder");
  });

  it("a plain richest charter wins by Market Dominance (economic)", () => {
    const out = computeOutcome(
      [makeCorp({ id: "a", valuation: 80000, hasCharter: true }), makeCorp({ id: "b", valuation: 30000, hasCharter: true })],
      galaxy, T, 42, 42,
    );
    expect(out.winnerId).toBe("a");
    expect(out.victoryType).toBe("economic");
  });
});

describe("standings — game-over conditions", () => {
  it("is not over mid-game while multiple charters survive", () => {
    const out = computeOutcome(
      [makeCorp({ id: "a", valuation: 9000, hasCharter: true }), makeCorp({ id: "b", valuation: 1000, hasCharter: true })],
      galaxy, T, 10, 42,
    );
    expect(out.over).toBe(false);
    expect(out.winnerId).toBeNull();
    expect(out.victoryType).toBeNull();
  });

  it("ends decisively the moment one charter outlasts all rivals — even if it trails on score", () => {
    const survivor = makeCorp({ id: "a", valuation: 5000, hasCharter: true });
    const fallen = makeCorp({ id: "b", valuation: 99000, hasCharter: false, isFreeOperator: true }); // richer but charterless
    const out = computeOutcome([survivor, fallen], galaxy, T, 20, 42);
    expect(out.decisive).toBe(true);
    expect(out.over).toBe(true);
    expect(out.winnerId).toBe("a"); // last charter standing wins regardless of score
    expect(out.victoryType).toBe("monopoly");
  });

  it("does not call a monopoly before the minimum turn", () => {
    const out = computeOutcome(
      [makeCorp({ id: "a", valuation: 5000, hasCharter: true }), makeCorp({ id: "b", valuation: 1000, hasCharter: false })],
      galaxy, T, T.victory.monopolyMinTurn - 1, 42,
    );
    expect(out.decisive).toBe(false);
    expect(out.over).toBe(false);
  });
});
