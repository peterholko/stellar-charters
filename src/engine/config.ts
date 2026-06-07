/**
 * Game configuration and scenario loading.
 *
 * All tunable balance numbers live here (or in a scenario JSON), so tuning the
 * economy never requires touching engine logic. `loadScenario` takes an already
 * parsed object — file reading is the harness/CLI's job, keeping this module pure.
 */
import type {
  MegastructureKind,
  PopulationStage,
  RangeTier,
  Resource,
  Stockpile,
  SystemBodies,
  SystemPosition,
} from "./types.js";
import { emptyStockpile, RESOURCES } from "./types.js";

/**
 * A production-chain recipe run by a Processor module (Section 07b). Each turn a processor
 * consumes `inputs` from its system's local stockpile and produces `outputs` into it,
 * pro-rated by the limiting input (and throttled by power/unrest). `recipes` is iterated in
 * array order, which MUST be dependency order so a tier-1 output (e.g. alloys) is available
 * to a tier-2 recipe (e.g. components) in the same turn.
 */
export interface Recipe {
  id: string;
  /** Tier (1 = from raws, 2 = consumes a manufactured good). Documentation/ordering aid. */
  tier: number;
  inputs: Partial<Stockpile>;
  outputs: Partial<Stockpile>;
  /** Credits to build one processor for this recipe. */
  buildCost: number;
  /** Power drawn per processor module each turn (Section 07b power balance). */
  powerDraw: number;
}

/** A megastructure's cost (the metal sink), gate, and payoff (Section 22). */
export interface MegastructureSpec {
  /** Enormous raw-metals cost — the demand sink that lifts the metals market off the floor. */
  metalsCost: number;
  /** Refined-alloys cost (pulls more metal through the processing chain). */
  alloyCost: number;
  creditCost: number;
  /** Minimum population stage the host system must have reached. */
  requiresStage: PopulationStage;
  /** Added to the system's standing raid defense. */
  defenseBonus: number;
  /** Multiplier added to local population growth (e.g. 0.5 = +50%). */
  growthBonus: number;
  /** Flat valuation credited for the structure (the prestige payoff). */
  valuation: number;
}

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
  /** Atlas coordinates (procedural scenarios). Absent for legacy authored maps. */
  position?: SystemPosition;
  /** Generated astrophysical contents + deposits (Section 21). Absent on legacy authored maps,
   *  which instead author the flat `yields` shortcut. */
  bodies?: SystemBodies;
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
  /** Stable id used to rebuild the scenario (e.g. "procedural-atlas-v1", "inner-ring-8p"). */
  id?: string;
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
  /** Antimatter consumed to build a ship of each tier (only capital Range 4+ hulls). */
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
  /** Production-chain recipes run by Processor modules (Section 07b). Dependency-ordered. */
  recipes: Recipe[];
  /** Alloys a ship hull of each tier consumes when built (the "steel bottleneck"). */
  shipAlloyCost: Record<RangeTier, number>;
  /** Components (electronics) a ship of each tier consumes when built. */
  shipComponentCost: Record<RangeTier, number>;
  /** Flat alloy cost to construct any building (depot, platform, processor, reactor). */
  buildAlloyCost: number;
  /** Extra components a Trade Depot consumes when built (advanced infrastructure). */
  depotComponentCost: number;
  /** Fuel each ship burns per turn to stay operational (Section 07b fleet sink). */
  fuelPerShipPerTurn: number;
  /** Reactor (Section 07b power): build cost, power capacity added, helium3 burned per turn. */
  reactorCost: number;
  reactorPowerOutput: number;
  reactorHelium3Use: number;
  /** Free baseline power every owned system has before any reactor. */
  basePowerPerSystem: number;
  /**
   * System infrastructure upgrades (Section 07c): raw-fed "upgrade the building" tracks that
   * give the overproduced raws (metals/silicates/helium3) a scaling demand sink. Each level's
   * cost scales with the level reached (level L→L+1 costs the base × (L+1)).
   */
  infrastructure: {
    /** Max level per track. */
    cap: number;
    /** Mining Rigs (metals): fortification — each level hardens raid defense and cuts upkeep.
     *  A pure sink: it consumes metals without adding raw supply or compounding wealth. */
    miningCreditCost: number;
    miningMetalsCost: number;
    miningDefenseBonusPerLevel: number;
    miningUpkeepReductionPerLevel: number;
    /** Habitats (silicates): each level raises population growth and tax. */
    habitatCreditCost: number;
    habitatSilicatesCost: number;
    habitatGrowthBonusPerLevel: number;
    habitatTaxBonusPerLevel: number;
    /** Power Grid (helium3): each level adds local power capacity (a soft reactor). */
    powerCreditCost: number;
    powerHelium3Cost: number;
    powerCapacityPerLevel: number;
  };
  /** Stationary defense platform: build cost and raid-defense added per platform (Section 15). */
  platformCost: number;
  platformDefense: number;
  platformCap: number;
  /**
   * Per-body extractor economy (Section 21). Building an extractor on a deposit raises its
   * level; the credit cost scales with the level reached and the deposit's accessibility (harder
   * deposits cost more). A free starter extractor is granted on claim so a fresh system produces.
   */
  extractor: {
    buildCost: number;
    /** Alloys consumed per extractor build. */
    alloyCost: number;
    /** Extra credit multiplier for the least-accessible deposits (× (1 + (1-access)*mult)). */
    accessibilityMult: number;
  };
  /** Credits to assay (reveal exact richness/reserves of) one of a system's deposits (Section 21). */
  assayCost: number;
  /** Extraction sabotage (Section 21): raid strength needed, and turns a hit site stays offline. */
  sabotage: { minStrength: number; disableTurns: number };
  /**
   * War & conquest (Section 23). An invasion captures the target system when the attacker's
   * reachable fleet strength exceeds the system's defense (plus allied reinforcement) by
   * `captureRatio`; otherwise it is repelled. Declaring war locks the aggressor out of the
   * Galactic Exchange until `durationTurns` after its last act of aggression (a ceasefire).
   */
  war: {
    /** Attacker:defender strength ratio needed to capture (else repelled). */
    captureRatio: number;
    /** Fraction of the attacker's committed combat lost on a repelled assault. */
    repelLossFrac: number;
    /** Fraction of the attacker's committed combat lost even on a successful capture. */
    captureLossFrac: number;
    /** Turns a war lasts after the latest act of aggression before a ceasefire. */
    durationTurns: number;
    /** War tariff (Section 23): fraction skimmed off an aggressor's Exchange trades while at war
     *  — a softer penalty than a full lockout (trade still flows, but at a cost). */
    aggressorTariff: number;
  };
  /**
   * Megastructures (Section 22): the enormous metals/alloys demand sink. Each is one-per-system,
   * gated by population stage, and pays back in defense, growth, and a big valuation bump — so
   * overproduced metal has somewhere to go and an end-game construction race emerges.
   */
  megastructures: Record<MegastructureKind, MegastructureSpec>;
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
    /** Valuation credited per Processor module built. */
    processorValue: number;
    /** Valuation credited per Reactor module built. */
    reactorValue: number;
    /** Valuation credited per system-infrastructure upgrade level (any track). */
    infraLevelValue: number;
    /** Valuation credited per extractor level built across a system's sites (Section 21). */
    extractorValue: number;
    stockpileFrac: number;
    earningsMomentumWeight: number;
  };
}

export const DEFAULT_TUNING: Tuning = {
  startingCredits: 6500,
  basePrices: {
    // Raw feedstocks.
    ice: 8,
    metals: 12,
    silicates: 14,
    helium3: 22,
    rareIsotopes: 120,
    antimatter: 420,
    // Manufactured goods (value-added over their inputs; seed values, tune via sweep).
    food: 16,
    fuel: 34,
    alloys: 40,
    polymers: 84,
    components: 300,
  },
  priceFloorFrac: 0.4,
  priceCeilFrac: 2.5,
  priceElasticity: 0.06,
  priceReferenceVolume: 40,
  shippingFeePerHop: 1.5,
  bidRefundFrac: 0.92,
  surveyCost: 300,
  shipCost: { 1: 380, 2: 720, 3: 1400, 4: 2800, 5: 4400, 6: 6500, 7: 9000, 8: 12000 },
  raiderShipExtraCost: 400,
  shipCombat: { 1: 2, 2: 4, 3: 7, 4: 11, 5: 16, 6: 22, 7: 29, 8: 38 },
  raiderCombatBonus: 1,
  shipIsotopeCost: { 1: 0, 2: 2, 3: 6, 4: 14, 5: 20, 6: 28, 7: 36, 8: 46 },
  shipAntimatterCost: { 1: 0, 2: 0, 3: 0, 4: 3, 5: 4, 6: 6, 7: 9, 8: 12 },
  privateerCost: 500,
  privateerStrength: 5,
  privateerTurns: 3,
  /** Fraction of plundered cargo value a raider realises when fencing it (Section 13). */
  plunderFenceRate: 0.85,
  rangeResearchCost: { 1: 0, 2: 1100, 3: 2200, 4: 3800, 5: 5000, 6: 6500, 7: 8200, 8: 10000 },
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
  // Production chains (Section 07b). Array order is dependency order: fuel/alloys (tier 1,
  // from raws) precede polymers/components (tier 2) so same-turn chaining works.
  recipes: [
    { id: "fuel", tier: 1, inputs: { ice: 2, helium3: 1 }, outputs: { fuel: 3 }, buildCost: 650, powerDraw: 1 },
    { id: "alloys", tier: 1, inputs: { metals: 2, helium3: 1 }, outputs: { alloys: 2 }, buildCost: 650, powerDraw: 2 },
    { id: "polymers", tier: 2, inputs: { silicates: 2, fuel: 1 }, outputs: { polymers: 2 }, buildCost: 800, powerDraw: 2 },
    { id: "components", tier: 3, inputs: { alloys: 1, polymers: 1, rareIsotopes: 1 }, outputs: { components: 1 }, buildCost: 950, powerDraw: 3 },
  ],
  // Capital hulls are enormous steel sinks (Section 22): tiers 5–8 demand vastly more alloys
  // than light hulls, so building a capital fleet drains metal through the alloy chain.
  shipAlloyCost: { 1: 2, 2: 4, 3: 8, 4: 18, 5: 38, 6: 64, 7: 95, 8: 140 },
  shipComponentCost: { 1: 0, 2: 1, 3: 2, 4: 4, 5: 6, 6: 9, 7: 12, 8: 16 },
  buildAlloyCost: 4,
  depotComponentCost: 3,
  fuelPerShipPerTurn: 0.5,
  reactorCost: 700,
  reactorPowerOutput: 6,
  reactorHelium3Use: 2,
  basePowerPerSystem: 2,
  // Raw-fed system upgrades (Section 07c). Raw costs are deliberately steep and scale with
  // level so the metals/silicates/helium3 spent dominates the extra yield — a net sink. Seeds.
  infrastructure: {
    cap: 4,
    miningCreditCost: 350,
    miningMetalsCost: 18,
    miningDefenseBonusPerLevel: 1,
    miningUpkeepReductionPerLevel: 0.1,
    habitatCreditCost: 450,
    habitatSilicatesCost: 16,
    habitatGrowthBonusPerLevel: 0.25,
    habitatTaxBonusPerLevel: 0.15,
    powerCreditCost: 400,
    powerHelium3Cost: 10,
    powerCapacityPerLevel: 4,
  },
  platformCost: 350,
  platformDefense: 1,
  platformCap: 2,
  extractor: {
    buildCost: 300,
    alloyCost: 2,
    accessibilityMult: 0.8,
  },
  assayCost: 120,
  sabotage: { minStrength: 4, disableTurns: 3 },
  war: { captureRatio: 1.1, repelLossFrac: 0.5, captureLossFrac: 0.2, durationTurns: 6, aggressorTariff: 0.35 },
  // Megastructures (Section 22): the metal-hungry demand sink. Costs escalate from a mid-game
  // station to the apex ringworld; metalsCost dwarfs anything else in the game so a metals-rich
  // empire finally has somewhere to pour its overproduction (and buys the shortfall at market,
  // lifting the price). Tune magnitudes against `npm run sim --procedural`.
  megastructures: {
    orbitalStation: { metalsCost: 400, alloyCost: 0, creditCost: 150, requiresStage: "settlement", defenseBonus: 8, growthBonus: 0, valuation: 6000 },
    spaceElevator: { metalsCost: 1100, alloyCost: 30, creditCost: 1500, requiresStage: "colony", defenseBonus: 4, growthBonus: 0.5, valuation: 15000 },
    ringworld: { metalsCost: 3000, alloyCost: 120, creditCost: 6000, requiresStage: "city", defenseBonus: 10, growthBonus: 1, valuation: 45000 },
  },
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
      colony: 1500,
      city: 3200,
      metropolis: 6500,
    },
    shipValue: 500,
    depotValue: 2000,
    processorValue: 300,
    reactorValue: 250,
    infraLevelValue: 90,
    extractorValue: 70,
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
  const out = emptyStockpile();
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
