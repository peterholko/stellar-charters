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
  loadScenario,
  normaliseYields,
  type GameConfig,
  type Scenario,
  type ScenarioSystem,
  type ScenarioRoute,
  type Tuning,
} from "./config.js";
export { Galaxy } from "./galaxy.js";
export {
  generateProceduralScenario,
  PROCEDURAL_SCENARIO_ID,
  type ProceduralOptions,
} from "./procedural.js";
export { Market, type ClearableOrder, type MarketFill } from "./market.js";
export { resolveAuction, type AuctionResult } from "./auction.js";
export {
  canRaidRoute,
  raidStrength,
  resolveRaid,
  type RaidOutcome,
  type RaidResult,
} from "./raiding.js";
export { Engine, type EngineOptions } from "./engine.js";
export { type TurnEvent, type TurnReport } from "./report.js";
export { HumanBot } from "./bots/human.js";
export {
  buildClientState,
  gamePhase,
  type ClientState,
  type ClientSystem,
  type ClientRoute,
  type ClientCorp,
  type ClientConvoy,
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
