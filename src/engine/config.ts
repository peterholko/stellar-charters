/**
 * Game configuration and scenario loading.
 *
 * All tunable balance numbers live here (or in a scenario JSON), so tuning the
 * economy never requires touching engine logic. `loadScenario` takes an already
 * parsed object — file reading is the harness/CLI's job, keeping this module pure.
 */
import type {
  PopulationStage,
  RangeTier,
  Resource,
  Stockpile,
} from "./types.js";
import { RESOURCES } from "./types.js";

/** Raw system entry as authored in a scenario JSON. */
export interface ScenarioSystem {
  id: string;
  name: string;
  yields: Partial<Stockpile>;
  claimCost: number;
  upkeep: number;
  populationStage?: PopulationStage;
  defense?: number;
  innerRing?: boolean;
}

/** Raw route entry as authored in a scenario JSON. */
export interface ScenarioRoute {
  a: string;
  b: string;
  transitTime: number;
  stability: number;
  capacity: number;
  exposure: number;
  authorityPresence: number;
  requiredRange?: RangeTier;
  charted?: boolean;
}

export interface Scenario {
  name: string;
  hubId: string;
  players: number;
  turns: number;
  systems: ScenarioSystem[];
  routes: ScenarioRoute[];
  /** Optional overrides merged onto DEFAULT_TUNING. */
  tuning?: Partial<Tuning>;
  /** Bot ids assigned round-robin to players if provided. */
  bots?: string[];
}

/** Economy/combat constants the engine reads each turn. */
export interface Tuning {
  startingCredits: number;
  /** Base global market price per resource. */
  basePrices: Record<Resource, number>;
  /** Price floor/ceiling as a fraction of base price (humanity liquidity). */
  priceFloorFrac: number;
  priceCeilFrac: number;
  /** How strongly net supply/demand moves price per unit of imbalance. */
  priceElasticity: number;
  /** Reference volume that defines "one unit" of imbalance for elasticity. */
  priceReferenceVolume: number;
  /** Per-unit shipping fee multiplier applied along a path. */
  shippingFeePerHop: number;
  /** Refund fraction for losing auction bids (Section 05: 0.90–0.95). */
  bidRefundFrac: number;
  /** Costs. */
  surveyCost: number;
  shipCost: Record<RangeTier, number>;
  raiderShipExtraCost: number;
  privateerCost: number;
  privateerStrength: number;
  privateerTurns: number;
  rangeResearchCost: Record<RangeTier, number>;
  /** Debt interest applied per turn. */
  debtInterest: number;
  /** Population food consumption per stage, per turn. */
  foodNeed: Record<PopulationStage, number>;
  /** Valuation weights (Section 17 light formula). */
  valuation: {
    perSystemYieldValue: number;
    populationValue: Record<PopulationStage, number>;
    shipValue: number;
    stockpileFrac: number;
  };
}

export const DEFAULT_TUNING: Tuning = {
  startingCredits: 6500,
  basePrices: { ice: 8, metals: 12, helium3: 22, rareIsotopes: 120, food: 16 },
  priceFloorFrac: 0.4,
  priceCeilFrac: 2.5,
  priceElasticity: 0.06,
  priceReferenceVolume: 40,
  shippingFeePerHop: 1.5,
  bidRefundFrac: 0.92,
  surveyCost: 300,
  shipCost: { 1: 600, 2: 1400, 3: 3200, 4: 7000 },
  raiderShipExtraCost: 400,
  privateerCost: 500,
  privateerStrength: 3,
  privateerTurns: 3,
  rangeResearchCost: { 1: 0, 2: 1500, 3: 4500, 4: 9000 },
  debtInterest: 0.05,
  foodNeed: { outpost: 0, settlement: 2, colony: 6, city: 14, metropolis: 30 },
  valuation: {
    perSystemYieldValue: 40,
    populationValue: {
      outpost: 200,
      settlement: 600,
      colony: 1600,
      city: 4000,
      metropolis: 10000,
    },
    shipValue: 500,
    stockpileFrac: 0.5,
  },
};

export interface GameConfig {
  scenario: Scenario;
  tuning: Tuning;
  turns: number;
  players: number;
}

function fullStockpile(partial: Partial<Stockpile> | undefined): Stockpile {
  const out = { ice: 0, metals: 0, helium3: 0, rareIsotopes: 0, food: 0 };
  if (partial) {
    for (const r of RESOURCES) {
      if (partial[r] !== undefined) out[r] = partial[r]!;
    }
  }
  return out;
}

/** Normalise a parsed scenario object into a GameConfig with full tuning. */
export function loadScenario(scenario: Scenario): GameConfig {
  const tuning: Tuning = {
    ...DEFAULT_TUNING,
    ...scenario.tuning,
    basePrices: { ...DEFAULT_TUNING.basePrices, ...scenario.tuning?.basePrices },
  };
  return {
    scenario,
    tuning,
    turns: scenario.turns,
    players: scenario.players,
  };
}

/** Helper used by galaxy construction to expand authored yields. */
export function normaliseYields(yields: Partial<Stockpile>): Stockpile {
  return fullStockpile(yields);
}
