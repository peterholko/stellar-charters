/**
 * Generates the scenario JSON files under scenarios/.
 *
 * Run with: npx tsx scripts/genScenarios.ts
 * The output JSON is committed and is the actual input to the simulator; this
 * script just makes the maps reproducible and easy to retune.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Scenario, ScenarioRoute, ScenarioSystem } from "../src/engine/config.js";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "scenarios");

type Profile = {
  tag: string;
  yields: ScenarioSystem["yields"];
  claimCost: number;
  upkeep: number;
};

const PROFILES: Profile[] = [
  { tag: "Ice", yields: { ice: 12, metals: 2 }, claimCost: 1200, upkeep: 40 },
  { tag: "Metal", yields: { metals: 14, ice: 2 }, claimCost: 1100, upkeep: 40 },
  { tag: "Helium", yields: { helium3: 8, ice: 2 }, claimCost: 1800, upkeep: 55 },
  { tag: "Garden", yields: { food: 10, ice: 3 }, claimCost: 1500, upkeep: 50 },
  { tag: "Mixed", yields: { ice: 4, metals: 4, helium3: 2 }, claimCost: 1400, upkeep: 45 },
];

const NAMES = [
  "Frosthaven", "Vesta Minor", "Pale Harbor", "Caldera", "Greywake", "Deepwell",
  "Tycho Reach", "Cinder", "Halcyon", "Brightfall", "Karst", "Meridian",
  "Onyx Spur", "Saltmarsh", "Verge", "Lowtide", "Ashford", "Petra",
  "Quillon", "Roan", "Sable", "Thornwell", "Umbra", "Wyhaven",
];

function buildScenario(
  name: string,
  players: number,
  innerCount: number,
  frontierCount: number,
  bots: string[],
): Scenario {
  const systems: ScenarioSystem[] = [];
  const routes: ScenarioRoute[] = [];

  systems.push({
    id: "hub",
    name: "Wormhole Hub",
    yields: {},
    claimCost: 0,
    upkeep: 0,
    defense: 99,
    innerRing: false,
  });

  // Inner ring.
  for (let i = 0; i < innerCount; i++) {
    const profile = PROFILES[i % PROFILES.length]!;
    const id = `s${i}`;
    systems.push({
      id,
      name: NAMES[i % NAMES.length]!,
      yields: profile.yields,
      claimCost: profile.claimCost,
      upkeep: profile.upkeep,
      defense: 2,
      innerRing: true,
    });
    // Charted 1-turn lane to the hub: high Authority presence, protected mouth.
    routes.push({
      a: "hub",
      b: id,
      transitTime: 1,
      stability: 0.9,
      capacity: 50,
      exposure: 0.3,
      authorityPresence: 0.8,
      requiredRange: 1,
      charted: true,
    });
  }

  // Ring adjacency between consecutive inner systems: lower Authority, more exposed.
  for (let i = 0; i < innerCount; i++) {
    const a = `s${i}`;
    const b = `s${(i + 1) % innerCount}`;
    routes.push({
      a,
      b,
      transitTime: 1,
      stability: 0.7,
      capacity: 30,
      exposure: 0.6,
      authorityPresence: 0.3,
      requiredRange: 1,
      charted: true,
    });
  }

  // Frontier systems: rare isotopes, reachable only via Range-2 uncharted routes.
  // Anchors are spread across the ring so most corps can reach a deep tunnel.
  for (let f = 0; f < frontierCount; f++) {
    const id = `f${f}`;
    systems.push({
      id,
      name: `${NAMES[(innerCount + f) % NAMES.length]!} Deep`,
      yields: { rareIsotopes: 5, metals: 3 },
      claimCost: 1500,
      upkeep: 70,
      defense: 1,
      innerRing: false,
    });
    // Hang each frontier system off a distinct inner system via an exposed deep tunnel.
    const anchor = `s${Math.floor((f * innerCount) / frontierCount) % innerCount}`;
    routes.push({
      a: anchor,
      b: id,
      transitTime: 2,
      stability: 0.5,
      capacity: 20,
      exposure: 0.85,
      authorityPresence: 0.1,
      requiredRange: 2,
      charted: false,
    });
  }

  return { name, hubId: "hub", players, turns: 24, systems, routes, bots };
}

const eightP = buildScenario(
  "Inner Ring — 8 players",
  8,
  16,
  5,
  ["miner", "raider", "balanced", "miner", "balanced", "raider", "miner", "balanced"],
);
const fourP = buildScenario(
  "Inner Ring — 4 players",
  4,
  9,
  3,
  ["miner", "raider", "balanced", "miner"],
);

writeFileSync(join(outDir, "inner-ring-8p.json"), JSON.stringify(eightP, null, 2) + "\n");
writeFileSync(join(outDir, "inner-ring-4p.json"), JSON.stringify(fourP, null, 2) + "\n");
console.log("Wrote scenarios/inner-ring-8p.json and scenarios/inner-ring-4p.json");
