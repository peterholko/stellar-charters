import { describe, expect, it } from "vitest";
import { Galaxy } from "../src/engine/galaxy.js";
import { loadScenario, type Scenario } from "../src/engine/config.js";

function buildGalaxy(): Galaxy {
  const scenario: Scenario = {
    name: "path",
    hubId: "hub",
    players: 1,
    turns: 1,
    systems: [
      { id: "hub", name: "Hub", yields: {}, claimCost: 0, upkeep: 0 },
      { id: "a", name: "A", yields: {}, claimCost: 0, upkeep: 0, innerRing: true },
      { id: "b", name: "B", yields: {}, claimCost: 0, upkeep: 0, innerRing: true },
      { id: "deep", name: "Deep", yields: {}, claimCost: 0, upkeep: 0 },
    ],
    routes: [
      { a: "hub", b: "a", transitTime: 1, stability: 1, capacity: 10, exposure: 0.2, authorityPresence: 0.8, charted: true },
      { a: "a", b: "b", transitTime: 1, stability: 1, capacity: 10, exposure: 0.5, authorityPresence: 0.3, charted: true },
      { a: "hub", b: "b", transitTime: 5, stability: 1, capacity: 10, exposure: 0.5, authorityPresence: 0.3, charted: true },
      { a: "b", b: "deep", transitTime: 2, stability: 0.5, capacity: 10, exposure: 0.9, authorityPresence: 0.1, requiredRange: 2, charted: false },
    ],
  };
  return new Galaxy(loadScenario(scenario));
}

describe("warp pathfinding", () => {
  it("chooses the cheaper multi-hop path over a slow direct route", () => {
    const g = buildGalaxy();
    const path = g.shortestWarpPath("hub", "b", 1);
    expect(path).not.toBeNull();
    expect(path!.systems).toEqual(["hub", "a", "b"]);
    expect(path!.transitTime).toBe(2);
  });

  it("excludes uncharted routes", () => {
    const g = buildGalaxy();
    expect(g.shortestWarpPath("b", "deep", 2)).toBeNull();
  });

  it("respects ship range tier once a deep route is charted", () => {
    const g = buildGalaxy();
    g.route("route-3").charted = true; // b<->deep
    expect(g.shortestWarpPath("b", "deep", 1)).toBeNull(); // range too low
    const ok = g.shortestWarpPath("b", "deep", 2);
    expect(ok!.systems).toEqual(["b", "deep"]);
  });

  it("returns a trivial path for identical endpoints", () => {
    const g = buildGalaxy();
    const path = g.shortestWarpPath("a", "a", 1);
    expect(path).toEqual({ systems: ["a"], routes: [], transitTime: 0 });
  });
});
