/**
 * Node-only harness: load a scenario from disk and run many games across seeds.
 *
 * Variety comes from sweeping seeds (game i → seed startSeed+i); per-seed determinism
 * (the engine) lets any flagged game be replayed with the same seed.
 */
import { readFileSync } from "node:fs";
import { Engine, type EngineOptions } from "../engine/engine.js";
import { loadScenario, type GameConfig, type Scenario } from "../engine/config.js";
import { defaultRegistry } from "../engine/bots/registry.js";
import type { GameMetrics } from "../engine/metrics.js";

export function loadScenarioFile(path: string): GameConfig {
  const scenario = JSON.parse(readFileSync(path, "utf8")) as Scenario;
  return loadScenario(scenario);
}

export interface RunOptions {
  games: number;
  startSeed?: number;
  /** Override scenario player count / turns if provided. */
  players?: number;
  turns?: number;
}

/** Run a single game with the given seed, optionally with a text logger. */
export function runOneGame(
  config: GameConfig,
  seed: number,
  engineOptions: EngineOptions = {},
): GameMetrics {
  const registry = defaultRegistry();
  const engine = new Engine(config, seed, registry, engineOptions);
  return engine.run();
}

/** Run a batch of games and return per-game metrics. */
export function runGames(config: GameConfig, options: RunOptions): GameMetrics[] {
  const startSeed = options.startSeed ?? 1;
  const cfg: GameConfig = {
    ...config,
    players: options.players ?? config.players,
    turns: options.turns ?? config.turns,
    scenario: {
      ...config.scenario,
      players: options.players ?? config.scenario.players,
      turns: options.turns ?? config.scenario.turns,
    },
  };
  const results: GameMetrics[] = [];
  for (let i = 0; i < options.games; i++) {
    results.push(runOneGame(cfg, startSeed + i));
  }
  return results;
}
