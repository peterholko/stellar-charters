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
import { emptyStockpile, RESOURCES, type QueueBuildingKind } from "./types.js";

/**
 * Construction points a colony building costs to complete (Section 24/27): the single source of
 * truth shared by the engine's build queue and the colony UI's "~N turns" estimate. A factory scales
 * with its recipe tier so a higher-tier plant takes proportionally longer to raise.
 */
export function constructionCpCost(tuning: Tuning, kind: QueueBuildingKind, recipeTier = 1): number {
  if (kind === "extractor") return 0; // instant once paid — extractors only queue to WAIT for materials
  const c = tuning.construction;
  const base =
    kind === "factory" ? c.factory
    : kind === "reactor" ? c.reactor
    : kind === "agridome" ? c.agridome
    : kind === "mining" ? c.mining
    : kind === "habitat" ? c.habitat
    : kind === "lab" ? c.lab
    : c.power;
  return kind === "factory" ? Math.round(base * (1 + (recipeTier - 1) * 0.5)) : base;
}

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
  /** Turns of a home's worked-deposit output seeded into its stockpile at game start, so Turn 1 has
   *  tradable goods to ship (production itself only arrives next turn). 0 disables the seed. */
  startupInventoryTurns: number;
  /** Free instant Authority probes each charter may run in the Turn-1 opening window (Section 05). */
  openingSurveySlots: number;
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
  /**
   * Bid/ask spread instant Exchange trades pay around the posted price (ruleset v10) — buys
   * pay posted×(1+s), sells receive posted×(1−s). Sealed orders clear at mid: patience earns
   * the better price, and round-tripping the market needs real movement > 2s to profit.
   */
  instantSpread: number;
  /** Per-corp warehouse at the Exchange (ruleset v10) — hub storage for instant trading.
   *  Capacity is total units across all resources; the cap counters hoarding until upgraded. */
  warehouse: {
    baseCapacity: number;
    capacityPerLevel: number;
    levelCap: number;
    /** Credit cost of an upgrade, × the level being reached. */
    upgradeCreditCost: number;
    /** Metals consumed by an upgrade, × the level being reached. */
    upgradeMetalsCost: number;
  };
  /**
   * Commodity staging (review Section 13): a resource lists on the Exchange once ANY charter
   * fields this range tier (deterministic, public). Early game trades ~6 goods; the deep-frontier
   * commodities arrive as the map opens, so market literacy grows with reach.
   */
  resourceTierGate: Record<Resource, RangeTier>;
  /** Refund fraction for losing auction bids (Section 05: 0.90–0.95). */
  bidRefundFrac: number;
  /** Costs. */
  surveyCost: number;
  shipCost: Record<RangeTier, number>;
  raiderShipExtraCost: number;
  /** Cost of an unarmed survey vessel (Section 25) — a cheap scout. */
  surveyShipCost: number;
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
  /**
   * Feature gates (review Section 13: defer what doesn't defend the identity). Gated systems
   * stay in the codebase but cannot be researched/ordered; flip per scenario to re-enable.
   */
  features: { terraforming: boolean; espionage: boolean };
  /**
   * Hegemon tariff (review Risk 5): a charter whose valuation exceeds `valuationMultiple` ×
   * the median pays a small Exchange tariff — the runaway leader funds everyone's catch-up.
   */
  hegemon: { valuationMultiple: number; tariff: number };
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
  /**
   * One population per SYSTEM (review Section 10): each habitable/domed world beyond the first
   * multiplies growth and tax, so multi-habitable systems stay richer prizes without per-world
   * feeding orders, unrest, or tax accounting.
   */
  habitableGrowthBonusPerWorld: number;
  habitableTaxBonusPerWorld: number;
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
  /**
   * Construction materials each colony building consumes besides credits (Section 27): drawn from
   * the charter's stockpiles, with any shortfall bought at the exchange. Ties the extraction economy
   * to development — you spend the metals/silicates/alloys you mine to raise structures.
   */
  buildResources: {
    factory: Partial<Record<Resource, number>>;
    reactor: Partial<Record<Resource, number>>;
    agridome: Partial<Record<Resource, number>>;
    lab: Partial<Record<Resource, number>>;
  };
  /** Extra components a Trade Depot consumes when built (advanced infrastructure). */
  depotComponentCost: number;
  /** Fuel each ship burns per turn to stay operational (Section 07b fleet sink). */
  fuelPerShipPerTurn: number;
  /**
   * Movement fuel (Section 04/07b). Moving anything costs fuel scaled by mass × distance, and
   * warp lanes are engineered to channel mass with far less fuel — so bulk freighters depend on
   * lanes while light combat hulls can afford to jump off-lane. Distances are atlas world units.
   */
  fuelPerMassDistance: number;
  /** Combat-hull mass by range tier (a freighter's mass is its cargo quantity). */
  hullMass: Record<RangeTier, number>;
  /** Max fraction of mass-fuel a perfect lane removes; scaled by lane quality (capacity/stability). */
  laneFuelEfficiency: number;
  /** Capacity that counts as a full-throughput lane when scoring lane quality. */
  laneCapacityRef: number;
  /** World-distance a ship covers per turn off-lane (also the off-lane route-time reference). */
  distancePerTurn: number;
  /** Max direct (off-lane) jump distance a hull of each range tier can make in one move. */
  maxOffLaneJumpDist: Record<RangeTier, number>;
  /**
   * Per-hull SPEED multiplier (Section 04): 1.0 = baseline, >1 faster (fewer turns), <1 slower. It
   * scales BOTH off-lane jump time and lane-segment transit time, so a light scout zips while a
   * capital hull crawls. A fleet travels at its slowest ship's speed. Keep tier 1 at 1.0 so the
   * baseline lane/off-lane timings are unchanged.
   */
  shipSpeed: Record<RangeTier, number>;
  /**
   * Per-hull SENSOR radius in atlas world units (Section 04). A ship — stationed or in transit —
   * projects this bubble around its current position; a rival fleet in transit inside any of your
   * ships' bubbles surfaces as a map contact. Picket your space to see incoming attacks.
   */
  shipSensorRange: Record<RangeTier, number>;
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
  /**
   * Per-colony build queue (Section 24, Phase 4a). A colony pours `pointsPerTurn` construction
   * points into the front of its queue each turn; each building kind costs the listed points, so a
   * factory takes ~`factory / pointsPerTurn` turns once it reaches the front. Credits + resources are
   * still charged up-front at queue time, so the economic sink is unchanged — only timing shifts.
   */
  construction: {
    pointsPerTurn: number;
    factory: number;
    reactor: number;
    agridome: number;
    mining: number;
    habitat: number;
    power: number;
    lab: number;
  };
  /** Stationary defense platform: build cost and raid-defense added per platform (Section 15). */
  platformCost: number;
  platformDefense: number;
  platformCap: number;
  /**
   * Research (Section 28). A Research Lab costs `labCost` credits to raise and yields `labRpOutput`
   * research points per turn; a populated colony adds `researchPopBase[stage]` RP on top. Points pool
   * charter-wide into the active research project.
   */
  labCost: number;
  labRpOutput: number;
  researchPopBase: Record<PopulationStage, number>;
  /** Credits to terraform a world habitable once the Terraforming research is unlocked (Section 28). */
  terraformCost: number;
  /** Industrial Espionage steals one rival tech every this-many turns (Section 28, Phase 3). */
  espionageInterval: number;
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
  /**
   * Warp Disruptor platform (Section 04): a defensive structure that holds any rival fleet whose
   * destination is this system for `disruptorDelay` extra turns on its final approach. One per
   * system (like a Trade Depot); built instantly on affordability.
   */
  disruptorCost: number;
  disruptorComponentCost: number; // components consumed per disruptor build
  disruptorDelay: number; // extra turns a rival arrival is held in the disruption field
  disruptorDefenseBonus: number; // added to local raid defense (kept small to avoid turtling)
  /** Logistics focus (Phase D): one-turn modifiers from the per-turn focus token. */
  logisticsFocus: {
    /** Flat escort strength added to this turn's outbound convoys when `escortNext` is chosen. */
    escortBonus: number;
  };
  /** Equity & acquisition (Section 17). */
  sharesOutstanding: number;
  acquisitionThreshold: number; // fraction of shares for control
  /** Max debt as a multiple of valuation. */
  maxDebtToValuation: number;
  /** Credits floor below which a charter falls into distress liquidation. */
  distressCreditFloor: number;
  /** Equity market structure (Section 17): the seeded cap table, holdout pricing, and
   *  the sentiment dials that move traded prices (never valuation). */
  equity: {
    /** Institutional blocks seeded onto every charter's cap table, in ask order slots.
     *  Shares not covered by these blocks form the founder's management block. */
    npcBlocks: { shares: number; askPremium: number; bidDiscount: number; absorbPerTurn: number }[];
    /** Ask multiple for prying shares from an unwilling rival corp's stake (holdouts). */
    corpHoldoutMult: number;
    /** Ask multiple on the management block itself — the last line of a hostile sweep. */
    managementHoldoutMult: number;
    /** Concentration premium (Section 17): the marginal share costs more as the buyer's
     *  stake grows — QUADRATIC in position — so creeping to control is priced like the
     *  takeover it is and early-game snipes are priced out (doc pacing: turns 12–15).
     *  Marginal multiplier = 1 + positionImpact × (held/outstanding)². Buying back your
     *  OWN charter is exempt: consolidation is not concentration. */
    positionImpact: number;
    sentiment: {
      min: number;
      max: number;
      /** Fraction of the gap to 1.0 closed per turn — shock windows heal on their own. */
      reversion: number;
      /** Half-width of the seeded per-turn jitter. */
      jitter: number;
      /** Multiplicative impulse per convoy raid suffered this turn. */
      raidImpulse: number;
      /** Impulse per system lost to invasion this turn. */
      systemLostImpulse: number;
      /** Impulse when a war is declared on the corp this turn. */
      warImpulse: number;
      /** Impulse while credits sit below half the distress floor. */
      nearDistressImpulse: number;
      /** Impulse by the sign of last turn's earnings. */
      earningsImpulse: number;
      /** Per-turn clamp on the summed event shock (positive or negative). */
      maxShockPerTurn: number;
    };
  };
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
  /** Victory scoring (Section 29). Final standing = valuation + these prestige bonuses, so
   *  non-economic strategies (conquest, tech, wonders) get a climax even when raw cash trails. */
  victory: {
    /** Prestige per controlled charter system (rewards the land rush + conquest beyond raw value). */
    systemPoints: number;
    /** Prestige per completed (non-secret) tech. */
    techPoints: number;
    /** Prestige per galaxy-unique secret project owned (rare, decisive). */
    secretPoints: number;
    /** Prestige per megastructure (on top of its valuation — a wonder is a standing). */
    megastructurePoints: number;
    /** Earliest turn a last-charter-standing monopoly ends the game decisively. */
    monopolyMinTurn: number;
  };
}

/**
 * Movement/fuel ruleset epoch. Bumped when resolution rules change (e.g. off-lane fleet
 * movement + mass×distance fuel) so an in-progress event-sourced game — which replays its whole
 * order log through the current engine — can be abandoned for a fresh seed rather than silently
 * re-deriving its history under new rules. Surfaced in ClientState for visibility.
 */
export const RULESET_VERSION = 14; // v14 (Phase D): a per-turn "logistics focus" order (escortNext/expediteBuild/surveyPush) applies one non-stacking, non-queueable modifier at its resolution step — a new numbered resolution hook that changes outcomes
// v13 (Phase A): inner-ring resource seeding is weighted toward Metals/Silicates (~60% overlap) for a contested opening — different per-system yields change resolution outcomes from committed scenarios

export const DEFAULT_TUNING: Tuning = {
  startingCredits: 6500,
  startupInventoryTurns: 2,
  openingSurveySlots: 2,
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
  instantSpread: 0.025,
  warehouse: { baseCapacity: 50, capacityPerLevel: 50, levelCap: 3, upgradeCreditCost: 400, upgradeMetalsCost: 10 },
  shippingFeePerHop: 1.5,
  // Commodity staging (review Section 13): the early game lives on ~6 goods; the rest list as
  // range tiers are fielded (silicates/polymers mid, components/isotopes deep, antimatter last).
  resourceTierGate: {
    ice: 1, metals: 1, helium3: 1, food: 1, fuel: 1, alloys: 1,
    silicates: 2, polymers: 2,
    components: 3, rareIsotopes: 3,
    antimatter: 4,
  },
  bidRefundFrac: 0.92,
  surveyCost: 300,
  shipCost: { 1: 380, 2: 720, 3: 1400, 4: 2800, 5: 4400, 6: 6500, 7: 9000, 8: 12000 },
  raiderShipExtraCost: 400,
  surveyShipCost: 250,
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
  features: { terraforming: false, espionage: false }, // deferred from v1 (review Section 13)
  hegemon: { valuationMultiple: 3, tariff: 0.1 },
  foodNeed: { outpost: 0, settlement: 2, colony: 6, city: 14, metropolis: 30 },
  iceNeed: { outpost: 1, settlement: 1, colony: 2, city: 4, metropolis: 8 },
  taxPerStage: { outpost: 0, settlement: 55, colony: 180, city: 430, metropolis: 920 },
  growthRate: { outpost: 60, settlement: 30, colony: 18, city: 10, metropolis: 0 },
  growthThreshold: 100,
  // Per-system population (review Section 10): extra habitable/domed worlds multiply growth/tax.
  habitableGrowthBonusPerWorld: 0.35,
  habitableTaxBonusPerWorld: 0.3,
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
  // Each colony building draws real materials besides credits (Section 27): a factory is heavy
  // industry (alloys + metals), a reactor needs an alloy shell + silicate shielding, an agri-dome a
  // silicate-and-metal pressure dome. Shortfalls are bought at the exchange like every other bill.
  buildResources: {
    factory: { alloys: 8, metals: 6 },
    reactor: { alloys: 8, silicates: 5 },
    agridome: { silicates: 8, metals: 5 },
    lab: { components: 4, silicates: 6 },
  },
  depotComponentCost: 3,
  fuelPerShipPerTurn: 0.5,
  // Movement fuel (Section 04/07b). Placeholder values — balance is out of scope; these only
  // need to keep the sim running and make lanes meaningfully cheaper for massive freighters.
  fuelPerMassDistance: 0.0008,
  hullMass: { 1: 3, 2: 5, 3: 8, 4: 14, 5: 22, 6: 32, 7: 44, 8: 60 },
  laneFuelEfficiency: 0.75,
  laneCapacityRef: 40,
  distancePerTurn: 600,
  maxOffLaneJumpDist: { 1: 400, 2: 650, 3: 900, 4: 1200, 5: 1500, 6: 1900, 7: 2300, 8: 3000 },
  // Speed taper: light hulls fast, capitals ~1.67× slower. Tier 1 is exactly 1.0 so existing
  // baseline timings are unchanged. Tune against `npm run sim --procedural`.
  shipSpeed: { 1: 1.0, 2: 0.95, 3: 0.9, 4: 0.85, 5: 0.8, 6: 0.72, 7: 0.66, 8: 0.6 },
  // Sensor radius grows with hull tier — a single picket covers a corridor, not a whole region,
  // so off-lane raiders keep a fog advantage in open space.
  shipSensorRange: { 1: 500, 2: 650, 3: 800, 4: 1000, 5: 1200, 6: 1500, 7: 1850, 8: 2200 },
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
  // Build queue (Section 24, Phase 4a). 100 points/turn with these costs makes an agri-dome a
  // 1-turn job, a reactor/upgrade ~1.5 turns, and a factory ~2 turns — so a batch of builds on one
  // colony serialises into a visible queue while a single build still lands fast.
  construction: {
    pointsPerTurn: 100,
    // A clear Civ-style spread (turns at 100 pts/turn): a dome goes up fast, a power grid / mining
    // rig quick, a habitat moderate, a reactor slow, a factory slowest — and a factory scales with
    // its recipe TIER (tier-1 ×1, tier-2 ×1.5, tier-3 ×2 via constructionCpCost), so a components
    // plant takes far longer than a fuel refinery.
    factory: 200,
    reactor: 220,
    agridome: 90,
    mining: 120,
    habitat: 160,
    power: 120,
    lab: 180,
  },
  platformCost: 350,
  platformDefense: 1,
  platformCap: 2,
  // Research (Section 28): a lab costs 320 cr (+ materials) and makes 16 RP/turn; a developed
  // population adds a research base on top. Tuned so a focused charter finishes ~2 divisions in 42
  // turns — never the whole ~15-tech tree.
  labCost: 320,
  labRpOutput: 24,
  researchPopBase: { outpost: 0, settlement: 3, colony: 6, city: 11, metropolis: 18 },
  terraformCost: 1400,
  espionageInterval: 4,
  extractor: {
    buildCost: 300,
    alloyCost: 2,
    accessibilityMult: 0.8,
  },
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
  disruptorCost: 2500,
  disruptorComponentCost: 4,
  disruptorDelay: 2,
  disruptorDefenseBonus: 2,
  logisticsFocus: { escortBonus: 6 },
  sharesOutstanding: 100,
  acquisitionThreshold: 0.5,
  maxDebtToValuation: 1.0,
  distressCreditFloor: -2000,
  equity: {
    // Float totals 45: control (>50) ALWAYS requires prying ≥6 management shares at the
    // holdout multiple — a real tender premium that also pays the victim's treasury (the
    // comeback fund). Selling management shares (equity financing) widens the sweepable
    // float — cash now, takeover exposure later.
    npcBlocks: [
      // Institutional trust: the willing seller — modest premium, decent bid, deep absorption.
      { shares: 20, askPremium: 1.05, bidDiscount: 0.95, absorbPerTurn: 5 },
      // Pension fund: the holdout — sells dear, bids low, absorbs little.
      { shares: 15, askPremium: 1.3, bidDiscount: 0.85, absorbPerTurn: 2 },
      // Retail float: sells near spot, fair bid, modest absorption.
      { shares: 10, askPremium: 1.0, bidDiscount: 0.92, absorbPerTurn: 3 },
    ],
    corpHoldoutMult: 1.75,
    managementHoldoutMult: 2.5,
    // ≈ ×1.5 ask at a 25% stake, ×3 at 50%: control costs ~1.2× the target's whole
    // market cap, unaffordable from a turn-3 bankroll but routine for a late war chest.
    positionImpact: 8,
    sentiment: {
      min: 0.5,
      max: 1.6,
      // Raiding is endemic in this economy, so shocks must heal faster than they land
      // for a calm corp — sentiment should be a WINDOW after a bad stretch, not a
      // permanent discount (sweeps tune these: median sentiment should sit near 1.0).
      reversion: 0.1,
      jitter: 0.03,
      raidImpulse: -0.05,
      systemLostImpulse: -0.1,
      warImpulse: -0.12,
      nearDistressImpulse: -0.2,
      earningsImpulse: 0.04,
      /** Total event shock per turn is clamped to ±this (a triple-raid turn is a bad
       *  day, not a death spiral). */
      maxShockPerTurn: 0.25,
    },
  },
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
  victory: {
    systemPoints: 3000,
    techPoints: 800,
    secretPoints: 15000,
    megastructurePoints: 5000,
    monopolyMinTurn: 12,
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

/** Institutional name pools per cap-table slot (Section 17; named per design rule #13).
 *  Index matches equity.npcBlocks order: trust, pension, retail. */
export const NPC_HOLDER_NAMES: readonly (readonly string[])[] = [
  ["Meridian Trust", "Halcyon Mutual", "Aldebaran Capital", "Cygnus Holdings", "Vega Continuity Fund", "Procyon & Sons"],
  ["Outremer Pension Group", "Earthside Annuity Board", "Coreward Provident", "Mandate Workers' Trust", "Lagrange Assurance", "Heliopause Retirement Fund"],
  ["Frontier smallholders", "Dockside retail float", "Colonial scrip holders", "Spacer credit unions"],
];

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
