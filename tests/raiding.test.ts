import { describe, expect, it } from "vitest";
import { Rng } from "../src/engine/rng.js";
import { canRaidRoute, resolveRaid } from "../src/engine/raiding.js";
import { Galaxy } from "../src/engine/galaxy.js";
import type { Convoy, Corporation, WarpRoute } from "../src/engine/types.js";
import { tinyScenario } from "./helpers.js";

function convoy(): Convoy {
  return {
    id: "cv",
    owner: "victim",
    kind: "sell",
    resource: "rareIsotopes",
    quantity: 10,
    path: ["s0", "hub"],
    routeIds: ["route-0"],
    position: 0,
    segmentTurnsLeft: 1,
    launchedTurn: 1,
    payout: 1000,
    escort: 0,
    value: 1200,
  };
}

function route(exposure: number, authority: number): WarpRoute {
  return {
    id: "route-0",
    a: "s0",
    b: "hub",
    transitTime: 1,
    stability: 0.7,
    capacity: 20,
    exposure,
    authorityPresence: authority,
    requiredRange: 1,
    charted: true,
    trafficHistory: [],
  };
}

function corp(over: Partial<Corporation>): Corporation {
  return {
    id: "atk",
    name: "atk",
    credits: 0,
    debt: 0,
    ownedSystemIds: [],
    ships: [],
    privateers: [],
    rangeTier: 1,
    valuation: 0,
    botId: "raider",
    hasCharter: false,
    ...over,
  };
}

describe("raid outcomes", () => {
  it("a strong raider against a weak, exposed convoy loots some of the time", () => {
    const rng = new Rng(1);
    const counts: Record<string, number> = {};
    for (let i = 0; i < 400; i++) {
      const r = resolveRaid(rng, convoy(), route(0.9, 0.0), "atk", 12, 0);
      counts[r.outcome] = (counts[r.outcome] ?? 0) + 1;
    }
    expect((counts.plundered ?? 0) + (counts.damaged ?? 0)).toBeGreaterThan(0);
  });

  it("a heavily defended convoy turns raids back", () => {
    const rng = new Rng(2);
    const counts: Record<string, number> = {};
    for (let i = 0; i < 400; i++) {
      const c = convoy();
      c.escort = 30;
      const r = resolveRaid(rng, c, route(0.5, 0.3), "atk", 3, 20);
      counts[r.outcome] = (counts[r.outcome] ?? 0) + 1;
    }
    expect((counts.repelled ?? 0) + (counts.ambushed ?? 0)).toBeGreaterThan(0);
  });

  it("never plunders more cargo than the convoy carries", () => {
    const rng = new Rng(3);
    for (let i = 0; i < 200; i++) {
      const c = convoy();
      const r = resolveRaid(rng, c, route(0.9, 0), "atk", 20, 0);
      expect(r.cargoPlundered + r.cargoDestroyed).toBeLessThanOrEqual(c.quantity);
    }
  });
});

describe("raid eligibility", () => {
  it("requires a raider force with access to the route's vulnerable mouth", () => {
    const galaxy = new Galaxy(tinyScenario(2, 3));
    galaxy.system("s0").owner = "atk";
    const hubRoute = galaxy.routeBetween("hub", "s0")!;

    expect(canRaidRoute(galaxy, corp({ ownedSystemIds: [] }), hubRoute)).toBe(false);
    expect(
      canRaidRoute(
        galaxy,
        corp({ ownedSystemIds: ["s0"], ships: [{ rangeTier: 1, combat: 3, raider: true }] }),
        hubRoute,
      ),
    ).toBe(true);
    expect(
      canRaidRoute(
        galaxy,
        corp({ privateers: [{ basedAt: "s0", strength: 3, turnsLeft: 2 }] }),
        hubRoute,
      ),
    ).toBe(true);
  });
});
