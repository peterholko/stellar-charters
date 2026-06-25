/**
 * Small scenario builders for tests.
 */
import { loadScenario, type GameConfig, type Scenario } from "../src/engine/config.js";
import { emptyStockpile, type Corporation } from "../src/engine/types.js";

/** A fully-formed Corporation for unit tests, with sensible equity defaults. */
export function makeCorp(over: Partial<Corporation> = {}): Corporation {
  const id = over.id ?? "c";
  return {
    id,
    name: id,
    credits: 10000,
    debt: 0,
    hubStockpile: emptyStockpile(),
    warehouseLevel: 0,
    ownedSystemIds: [],
    ships: [],
    privateers: [],
    surveyedSystemIds: [],
    research: { completed: [], queue: [], invested: {}, banked: 0 },
    rangeTier: 1,
    valuation: 0,
    sharePrice: 0,
    sharesOutstanding: 100,
    shareRegister: { [id]: 100 },
    npcHolders: [],
    sentiment: 1,
    founderId: id,
    recentEarnings: [],
    isFreeOperator: false,
    botId: "miner",
    hasCharter: false,
    alliancePledges: [],
    grudges: {},
    standingRoutes: [],
    ...over,
  };
}

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
