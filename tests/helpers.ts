/**
 * Small scenario builders for tests.
 */
import { loadScenario, type GameConfig, type Scenario } from "../src/engine/config.js";

/** A minimal hub + N inner systems, each on a 1-turn charted lane to the hub. */
export function tinyScenario(players: number, innerCount: number): GameConfig {
  const scenario: Scenario = {
    name: "test",
    hubId: "hub",
    players,
    turns: 6,
    bots: ["miner"],
    systems: [
      { id: "hub", name: "Hub", yields: {}, claimCost: 0, upkeep: 0, defense: 99 },
    ],
    routes: [],
  };
  for (let i = 0; i < innerCount; i++) {
    scenario.systems.push({
      id: `s${i}`,
      name: `S${i}`,
      yields: { ice: 10, metals: 4 },
      claimCost: 1000,
      upkeep: 0,
      defense: 2,
      innerRing: true,
    });
    scenario.routes.push({
      a: "hub",
      b: `s${i}`,
      transitTime: 1,
      stability: 0.9,
      capacity: 50,
      exposure: 0.4,
      authorityPresence: 0.7,
      requiredRange: 1,
      charted: true,
    });
  }
  return loadScenario(scenario);
}
