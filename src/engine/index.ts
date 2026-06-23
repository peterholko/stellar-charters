/**
 * Public API of the pure simulation core.
 *
 * This barrel is the surface the future web app will import. Everything exported
 * here is platform-agnostic (no Node APIs); randomness flows through the seeded Rng.
 */
export { Rng } from "./rng.js";
export * from "./types.js";
export {
  DEFAULT_TUNING,
  RULESET_VERSION,
  constructionCpCost,
  loadScenario,
  normaliseYields,
  type GameConfig,
  type Scenario,
  type ScenarioSystem,
  type ScenarioRoute,
  type Tuning,
} from "./config.js";
export { CHARTER_SPECS, CHARTER_TYPES, type CharterSpec } from "./charters.js";
export { Galaxy } from "./galaxy.js";
export {
  fleetSpeed,
  planFleetMove,
  previewFleetMove,
  type FleetPlan,
  type MovePreview,
} from "./movement.js";
export {
  effectiveYields,
  potentialYields,
  siteOutput,
  siteIsProducing,
  extractorEfficiency,
  EXTRACTOR_CAP,
  systemHasHabitableBody,
  stellarOutputMult,
  systemSeed,
  sitesFromBodies,
  sitesFromYields,
  generateSystemBodies,
  starLabel,
  planetLabel,
  siteBodyKey,
  bodyKeysOf,
  primaryBodyKey,
  getBodyBuildings,
  systemBuildings,
  buildingTotal,
  coloniesOf,
  canHostPopulation,
  canBuildOnBody,
  agriFoodMult,
  factoryCostMult,
  bodyTypeOfKey,
  type ColonyInfo,
  type BuildingKind,
  type BodyGenOptions,
} from "./bodies.js";
export {
  generateProceduralScenario,
  PROCEDURAL_SCENARIO_ID,
  type ProceduralOptions,
} from "./procedural.js";
export {
  RESEARCH_TREE,
  RESEARCH_DIVISIONS,
  SECRET_TECH_IDS,
  researchMods,
  emptyResearchMods,
  techById,
  canResearch,
  lockedChoices,
  type ResearchTech,
  type ResearchDivision,
  type ResearchMods,
} from "./research.js";
export { Market, quoteInstant, type ClearableOrder, type InstantQuote, type MarketFill } from "./market.js";
export { resolveAuction, type AuctionResult } from "./auction.js";
export {
  canRaidRoute,
  raidStrength,
  resolveRaid,
  type RaidOutcome,
  type RaidResult,
} from "./raiding.js";
export { Engine, type EngineOptions } from "./engine.js";
export { type LedgerCause, type LedgerEntry, type TurnEvent, type TurnReport } from "./report.js";
export { computeOutcome, type GameOutcome, type Standing, type VictoryPath } from "./standings.js";
export { HumanBot } from "./bots/human.js";
export {
  buildClientState,
  gamePhase,
  type ClientState,
  type ClientSystem,
  type ClientSite,
  type ClientRoute,
  type ClientCorp,
  type ClientConvoy,
  type ClientContact,
  type ClientPlayer,
  type GamePhase,
} from "./clientState.js";
export {
  gini,
  coefficientOfVariation,
  emptyRaidOutcomes,
  type GameMetrics,
  type TurnSnapshot,
} from "./metrics.js";
export { type Bot, type BotFactory, type PlayerView } from "./bots/bot.js";
export { defaultRegistry } from "./bots/registry.js";
