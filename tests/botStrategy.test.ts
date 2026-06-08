/**
 * Victory-aware bot behaviour (Section 29 standings driving strategy):
 *  - strategicPosture detects the real score leader as a coalition threat, waits out early-game
 *    noise, and flags a looming monopoly;
 *  - maybeResearch stops chasing a secret a rival already locked and retargets to a reachable one.
 */
import { describe, expect, it } from "vitest";
import { strategicPosture, maybeResearch } from "../src/engine/bots/strategy.js";
import { Galaxy } from "../src/engine/galaxy.js";
import type { PlayerView } from "../src/engine/bots/bot.js";
import type { Corporation } from "../src/engine/types.js";
import { makeCorp, tinyScenario } from "./helpers.js";

const cfg = tinyScenario(2, 2); // hub + s0 + s1
const galaxy = new Galaxy(cfg);

function view(me: Corporation, corps: Corporation[], turn: number): PlayerView {
  return { turn, config: cfg, galaxy, me, corporations: corps, market: {} as never, convoys: [], wars: [], rng: {} as never };
}

describe("strategicPosture — coalition threat detection", () => {
  it("flags a dominant rival as an urgent threat", () => {
    const me = makeCorp({ id: "corp-0", valuation: 10000, hasCharter: true });
    const r1 = makeCorp({ id: "corp-1", valuation: 70000, hasCharter: true });
    const r2 = makeCorp({ id: "corp-2", valuation: 12000, hasCharter: true });
    const p = strategicPosture(view(me, [me, r1, r2], 20));
    expect(p.threatId).toBe("corp-1");
    expect(p.threatUrgent).toBe(true);
    expect(p.amLeader).toBe(false);
  });

  it("names no threat in a close three-way race", () => {
    const me = makeCorp({ id: "corp-0", valuation: 50000, hasCharter: true });
    const r1 = makeCorp({ id: "corp-1", valuation: 52000, hasCharter: true });
    const r2 = makeCorp({ id: "corp-2", valuation: 48000, hasCharter: true });
    const p = strategicPosture(view(me, [me, r1, r2], 20));
    expect(p.threatId).toBeUndefined();
    expect(p.threatUrgent).toBe(false);
  });

  it("ignores early-game score noise (no hegemon before turn 8)", () => {
    const me = makeCorp({ id: "corp-0", valuation: 1000, hasCharter: true });
    const r1 = makeCorp({ id: "corp-1", valuation: 9000, hasCharter: true });
    const r2 = makeCorp({ id: "corp-2", valuation: 1200, hasCharter: true });
    expect(strategicPosture(view(me, [me, r1, r2], 4)).threatId).toBeUndefined();
  });

  it("treats a looming monopoly (only two charters left) as an urgent threat", () => {
    const me = makeCorp({ id: "corp-0", valuation: 30000, hasCharter: true });
    const r1 = makeCorp({ id: "corp-1", valuation: 40000, hasCharter: true });
    const fallen = makeCorp({ id: "corp-2", valuation: 5000, hasCharter: false, isFreeOperator: true });
    const p = strategicPosture(view(me, [me, r1, fallen], 25));
    expect(p.threatId).toBe("corp-1");
    expect(p.threatUrgent).toBe(true);
  });

  it("reports the bot itself as leader with no threat when it dominates", () => {
    const me = makeCorp({ id: "corp-0", valuation: 90000, hasCharter: true });
    const r1 = makeCorp({ id: "corp-1", valuation: 20000, hasCharter: true });
    const r2 = makeCorp({ id: "corp-2", valuation: 18000, hasCharter: true });
    const p = strategicPosture(view(me, [me, r1, r2], 30));
    expect(p.amLeader).toBe(true);
    expect(p.myRank).toBe(1);
    expect(p.threatId).toBeUndefined();
  });
});

describe("maybeResearch — adaptive secret race", () => {
  const researchOrder = (orders: ReturnType<typeof maybeResearch>) =>
    orders.find((o) => o.kind === "setResearch") as { kind: "setResearch"; queue: string[] } | undefined;

  it("drops a secret a rival has locked and retargets to a reachable open one", () => {
    const me = makeCorp({
      id: "corp-0", hasCharter: true, credits: 50000, ownedSystemIds: ["s0"],
      research: { completed: ["pro-extractors"], queue: [], invested: {}, banked: 0 },
    });
    galaxy.system("s0").owner = "corp-0";
    // A rival already owns Orbital Dominance — chasing it is a lost race.
    const rival = makeCorp({ id: "corp-1", hasCharter: true, research: { completed: ["sec-orbital"], queue: [], invested: {}, banked: 0 } });
    const orders = maybeResearch(view(me, [me, rival], 20), ["pro-extractors", "sec-orbital"]);
    const set = researchOrder(orders);
    expect(set, "a research queue was set").toBeTruthy();
    expect(set!.queue).not.toContain("sec-orbital");
    expect(set!.queue).toContain("pro-antimatter"); // reachable from pro-extractors, prospectus-aligned
  });

  it("keeps the doctrine secret when it is still open", () => {
    const me = makeCorp({
      id: "corp-0", hasCharter: true, credits: 50000, ownedSystemIds: ["s0"],
      research: { completed: ["pro-extractors"], queue: [], invested: {}, banked: 0 },
    });
    galaxy.system("s0").owner = "corp-0";
    const rival = makeCorp({ id: "corp-1", hasCharter: true });
    const orders = maybeResearch(view(me, [me, rival], 20), ["pro-extractors", "pro-antimatter"]);
    const set = researchOrder(orders);
    expect(set!.queue).toContain("pro-antimatter");
  });
});
