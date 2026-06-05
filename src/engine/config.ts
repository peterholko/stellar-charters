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
  /** Combat strength of a (non-raider escort) ship by tier; raiders get +raiderCombatBonus. */
  shipCombat: Record<RangeTier, number>;
  raiderCombatBonus: number;
  /** Rare isotopes consumed to build a ship of each tier (higher tiers need them). */
  shipIsotopeCost: Record<RangeTier, number>;
  /** Antimatter consumed to build a ship of each tier (only capital Range-4 hulls). */
  shipAntimatterCost: Record<RangeTier, number>;
  privateerCost: number;
  privateerStrength: number;
  privateerTurns: number;
  plunderFenceRate: number;
  rangeResearchCost: Record<RangeTier, number>;
  /** Debt interest applied per turn. */
  debtInterest: number;
  /** Population food consumption per stage, per turn. */
  foodNeed: Record<PopulationStage, number>;
  /** Population ice (life-support) consumption per stage, per turn (Section 07/08). */
  iceNeed: Record<PopulationStage, number>;
  /** Tax credits a fed population pays its charter holder per stage, per turn. */
  taxPerStage: Record<PopulationStage, number>;
  /** Population growth added per fed turn, per current stage. */
  growthRate: Record<PopulationStage, number>;
  /** Progress points required to advance to the next stage. */
  growthThreshold: number;
  /** Unrest added per starved turn; production multiplier = 1 - unrestProductionPenalty*unrest. */
  unrestPerStarvedTurn: number;
  unrestRecoveryPerFedTurn: number;
  unrestProductionPenalty: number;
  /** Premium multiplier on emergency humanity food/ice imports (Section 08). */
  emergencyImportPremium: number;
  /** Hydroponics: build cost, ice consumed per turn, food produced per turn (Section 08). */
  hydroponicsCost: number;
  hydroponicsIceUse: number;
  hydroponicsFoodOutput: number;
  /** Stationary defense platform: build cost and raid-defense added per platform (Section 15). */
  platformCost: number;
  platformDefense: number;
  platformCap: number;
  /** Trade Depot effects (Section 12). */
  depotCost: number;
  depotShippingDiscount: number; // fraction off shipping on incident routes
  depotTransitBonus: number; // turns shaved off incident routes (min 1)
  depotDefenseBonus: number; // added to local raid defense on incident routes
  /** Equity & acquisition (Section 17). */
  sharesOutstanding: number;
  acquisitionThreshold: number; // fraction of shares for control
  /** Max debt as a multiple of valuation. */
  maxDebtToValuation: number;
  /** Credits floor below which a charter falls into distress liquidation. */
  distressCreditFloor: number;
  /** Valuation weights (Section 17). */
  valuation: {
    perSystemYieldValue: number;
    populationValue: Record<PopulationStage, number>;
    shipValue: number;
    depotValue: number;
    stockpileFrac: number;
    earningsMomentumWeight: number;
  };
}

export const DEFAULT_TUNING: Tuning = {
  startingCredits: 6500,
  basePrices: { ice: 8, metals: 12, helium3: 22, rareIsotopes: 120, food: 16, antimatter: 420 },
  priceFloorFrac: 0.4,
  priceCeilFrac: 2.5,
  priceElasticity: 0.06,
  priceReferenceVolume: 40,
  shippingFeePerHop: 1.5,
  bidRefundFrac: 0.92,
  surveyCost: 300,
  shipCost: { 1: 600, 2: 1100, 3: 2100, 4: 4000 },
  raiderShipExtraCost: 400,
  shipCombat: { 1: 2, 2: 4, 3: 7, 4: 11 },
  raiderCombatBonus: 1,
  shipIsotopeCost: { 1: 0, 2: 2, 3: 6, 4: 14 },
  shipAntimatterCost: { 1: 0, 2: 0, 3: 0, 4: 3 },
  privateerCost: 500,
  privateerStrength: 5,
  privateerTurns: 3,
  /** Fraction of plundered cargo value a raider realises when fencing it (Section 13). */
  plunderFenceRate: 0.85,
  rangeResearchCost: { 1: 0, 2: 1100, 3: 2200, 4: 3800 },
  debtInterest: 0.05,
  foodNeed: { outpost: 0, settlement: 2, colony: 6, city: 14, metropolis: 30 },
  iceNeed: { outpost: 1, settlement: 1, colony: 2, city: 4, metropolis: 8 },
  taxPerStage: { outpost: 0, settlement: 55, colony: 180, city: 430, metropolis: 920 },
  growthRate: { outpost: 60, settlement: 30, colony: 18, city: 10, metropolis: 0 },
  growthThreshold: 100,
  unrestPerStarvedTurn: 0.25,
  unrestRecoveryPerFedTurn: 0.15,
  unrestProductionPenalty: 0.6,
  emergencyImportPremium: 1.25,
  hydroponicsCost: 600,
  hydroponicsIceUse: 2,
  hydroponicsFoodOutput: 6,
  platformCost: 350,
  platformDefense: 1,
  platformCap: 2,
  depotCost: 2000,
  depotShippingDiscount: 0.35,
  depotTransitBonus: 1,
  depotDefenseBonus: 3,
  sharesOutstanding: 100,
  acquisitionThreshold: 0.5,
  maxDebtToValuation: 1.0,
  distressCreditFloor: -2000,
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
    depotValue: 2000,
    stockpileFrac: 0.5,
    earningsMomentumWeight: 4,
  },
};

export interface GameConfig {
  scenario: Scenario;
  tuning: Tuning;
  turns: number;
  players: number;
}

function fullStockpile(partial: Partial<Stockpile> | undefined): Stockpile {
  const out = { ice: 0, metals: 0, helium3: 0, rareIsotopes: 0, food: 0, antimatter: 0 };
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
