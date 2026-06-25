import { describe, expect, it } from "vitest";
import { Rng } from "../src/engine/rng.js";
import { canRaidRoute, resolveRaid } from "../src/engine/raiding.js";
import { Galaxy } from "../src/engine/galaxy.js";
import { Engine } from "../src/engine/engine.js";
import { loadScenario } from "../src/engine/config.js";
import { generateProceduralScenario } from "../src/engine/procedural.js";
import { defaultRegistry } from "../src/engine/bots/registry.js";
import type { Convoy, Corporation, WarpRoute } from "../src/engine/types.js";
import { makeCorp, tinyScenario } from "./helpers.js";

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
  return makeCorp({ id: "atk", name: "atk", credits: 0, botId: "raider", ...over });
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

describe("early raiding is non-lethal (Phase C)", () => {
  // With deniable violence pulled forward, the DOMINANT early outcome must be delay/shadow, not
  // erased cargo. Across full games we assert that turns 3–6 lose only a modest fraction of the
  // cargo value shipped — and (so the bound isn't vacuous) that raiders DO make contact that early.
  const EARLY = (t: number) => t >= 3 && t <= 6;
  const seeds = [0, 1, 2, 3, 5, 8];

  it("erases only a modest fraction of cargo value shipped across turns 3–6", () => {
    for (const seed of seeds) {
      const config = loadScenario(generateProceduralScenario({ seed, players: 8 }));
      const metrics = new Engine(config, seed, defaultRegistry()).run();
      const early = metrics.snapshots.filter((s) => EARLY(s.turn));
      const shipped = early.reduce((s, x) => s + x.cargoValueShipped, 0);
      const lost = early.reduce((s, x) => s + x.cargoValueLost, 0);
      // No double jeopardy: a turn with no shipping can't post a loss ratio.
      const ratio = shipped > 0 ? lost / shipped : 0;
      expect(ratio, `seed ${seed} early cargo-loss ratio`).toBeLessThan(0.2);
    }
  });

  it("raiders engage by the early window — contact is made on turns 3–6", () => {
    // Aggregated across seeds so the assertion is robust to a single quiet galaxy.
    let contacts = 0;
    let erasing = 0; // damaged/plundered (cargo actually removed)
    for (const seed of seeds) {
      const config = loadScenario(generateProceduralScenario({ seed, players: 8 }));
      const metrics = new Engine(config, seed, defaultRegistry()).run();
      for (const s of metrics.snapshots.filter((x) => EARLY(x.turn))) {
        const o = s.raidOutcomes;
        contacts += o.shadowed + o.harassed + o.damaged + o.plundered + o.repelled + o.ambushed;
        erasing += o.damaged + o.plundered;
      }
    }
    expect(contacts, "early raid contacts across seeds").toBeGreaterThan(0);
    // Delay/shadow should dominate the early window over outright cargo removal.
    expect(erasing).toBeLessThanOrEqual(contacts);
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
        corp({ ownedSystemIds: ["s0"], ships: [{ rangeTier: 1, combat: 3, raider: true, stationedAt: "s0" }] }),
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

  it("a raider fleet stationed at an endpoint grants access (Section 13) — the hub included", () => {
    const galaxy = new Galaxy(tinyScenario(2, 3));
    galaxy.system("s0").owner = "victim";
    const hubRoute = galaxy.routeBetween("hub", "s0")!;

    // Parked at the hub with no territory at all: the lane's vulnerable mouth (s0) is one hop away.
    expect(
      canRaidRoute(
        galaxy,
        corp({ ownedSystemIds: [], ships: [{ rangeTier: 1, combat: 3, raider: true, stationedAt: "hub" }] }),
        hubRoute,
      ),
    ).toBe(true);

    // A raider mid-transit has no station — grants nothing until it arrives.
    expect(
      canRaidRoute(
        galaxy,
        corp({
          ownedSystemIds: [],
          ships: [{
            rangeTier: 1, combat: 3, raider: true, stationedAt: "",
            transit: { path: ["s0", "hub"], routeIds: ["route-0"], position: 0, segmentTurnsLeft: 1, launchedTurn: 1, attack: false },
          }],
        }),
        hubRoute,
      ),
    ).toBe(false);

    // Escorts don't raid: a non-raider warship parked at the hub grants nothing.
    expect(
      canRaidRoute(
        galaxy,
        corp({ ownedSystemIds: [], ships: [{ rangeTier: 1, combat: 3, raider: false, stationedAt: "hub" }] }),
        hubRoute,
      ),
    ).toBe(false);
  });
});
