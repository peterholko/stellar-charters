/**
 * Node-only harness: load a scenario from disk and run many games across seeds.
 *
 * Variety comes from sweeping seeds (game i → seed startSeed+i); per-seed determinism
 * (the engine) lets any flagged game be replayed with the same seed.
 */
import { readFileSync } from "node:fs";
import { Engine, type EngineOptions } from "../engine/engine.js";
import { loadScenario, type GameConfig, type Scenario } from "../engine/config.js";
import { generateProceduralScenario, type GalaxyShape } from "../engine/procedural.js";
import { defaultRegistry } from "../engine/bots/registry.js";
import type { GameMetrics } from "../engine/metrics.js";

export function loadScenarioFile(path: string): GameConfig {
  const scenario = JSON.parse(readFileSync(path, "utf8")) as Scenario;
  return loadScenario(scenario);
}

/** A freshly-generated procedural galaxy (the live-game format / body-driven model). */
export function proceduralConfig(
  seed: number,
  players: number,
  turns: number,
  galaxy?: Partial<GalaxyShape>,
): GameConfig {
  return loadScenario(generateProceduralScenario({ seed, players, turns, galaxy }));
}

export interface RunOptions {
  games: number;
  startSeed?: number;
  /** Override scenario player count / turns if provided. */
  players?: number;
  turns?: number;
  /** Galaxy size/shape overrides (e.g. `{ scale: 2 }`) for procedural sweeps. */
  galaxy?: Partial<GalaxyShape>;
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

/**
 * Run a batch where each game generates its OWN procedural galaxy from its seed (the live-game
 * format), so the sweep exercises the full body-driven extractor/depletion economy rather than
 * a committed flat-yield map.
 */
export function runProceduralGames(options: RunOptions): GameMetrics[] {
  const startSeed = options.startSeed ?? 1;
  const players = options.players ?? 8;
  const turns = options.turns ?? 42;
  const results: GameMetrics[] = [];
  for (let i = 0; i < options.games; i++) {
    const seed = startSeed + i;
    results.push(runOneGame(proceduralConfig(seed, players, turns, options.galaxy), seed));
  }
  return results;
}
