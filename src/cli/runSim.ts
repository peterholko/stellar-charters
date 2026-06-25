/**
 * CLI entrypoint for the Stellar Charters balance simulator.
 *
 *   npm run sim -- --games 200 --players 8 --turns 12          # batch → out/ + summary
 *   npm run sim -- --games 1 --players 8 --seed 0 --verbose    # single game, text log
 *
 * Seeding: the batch sweeps seeds startSeed..startSeed+games-1 (variety). A single
 * run with --seed replays that exact game; `--seed random` (or no seed on a single
 * run) picks and prints a time-based seed so an interesting game can be replayed.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadScenarioFile,
  proceduralConfig,
  runGames,
  runOneGame,
  runProceduralGames,
} from "../harness/runGames.js";
import { writeEarlyGameCsv, writePerGameCsv, writePerTurnCsv } from "../harness/csv.js";
import { aggregate, renderMarkdown, type Aggregate } from "../harness/report.js";
import type { GameConfig } from "../engine/config.js";
import type { GameMetrics } from "../engine/metrics.js";
import { RESOURCES } from "../engine/types.js";

interface Args {
  games: number;
  players?: number;
  turns?: number;
  seed?: number | "random";
  scenario?: string;
  /** Generate a fresh procedural galaxy per game (the body-driven live-game model). */
  procedural: boolean;
  /** Galaxy size multiplier for procedural sweeps (1 = historical; 2–3 = "large"). */
  galaxyScale?: number;
  verbose: boolean;
  outDir: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { games: 200, verbose: false, procedural: false, outDir: "out" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "--games": args.games = Number(next()); break;
      case "--players": args.players = Number(next()); break;
      case "--turns": args.turns = Number(next()); break;
      case "--seed": {
        const v = next();
        args.seed = v === "random" ? "random" : Number(v);
        break;
      }
      case "--scenario": args.scenario = next(); break;
      case "--procedural": args.procedural = true; break;
      case "--galaxy-scale": args.galaxyScale = Number(next()); break;
      case "--out": args.outDir = next()!; break;
      case "--verbose": args.verbose = true; break;
      default:
        if (a && a.startsWith("--")) console.error(`Unknown flag: ${a}`);
    }
  }
  return args;
}

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");

/** Galaxy-shape override for procedural sweeps, or undefined for the historical galaxy. */
function galaxyOverride(args: Args): { scale: number } | undefined {
  return args.galaxyScale && args.galaxyScale !== 1 ? { scale: args.galaxyScale } : undefined;
}

function scenarioPathFor(args: Args): string {
  if (args.scenario) return args.scenario;
  const players = args.players ?? 8;
  const file = players <= 4 ? "inner-ring-4p.json" : "inner-ring-8p.json";
  return join(repoRoot, "scenarios", file);
}

function runSingleVerbose(config: GameConfig, args: Args): void {
  let seed: number;
  if (typeof args.seed === "number") seed = args.seed;
  else seed = (Date.now() & 0x7fffffff) >>> 0; // random/auto
  console.log(`Single game — seed ${seed} (replay with --seed ${seed})`);
  // Procedural games generate their galaxy from the gameplay seed, so rebuild from it here.
  const cfg = args.procedural
    ? proceduralConfig(seed, args.players ?? config.players, args.turns ?? config.turns, galaxyOverride(args))
    : config;
  const metrics = runOneGame(cfg, seed, { log: (line) => console.log(line) });
  // Phase 0: write the early-game CSV and print the turns 1–6 engagement read for the baseline.
  const outDir = join(repoRoot, args.outDir);
  mkdirSync(outDir, { recursive: true });
  const tag = `${metrics.players}p-seed${seed}`;
  writeEarlyGameCsv(join(outDir, `early-game-${tag}.csv`), [metrics]);
  printEarlyGameTable(metrics);
  console.log(`\nWrote out/early-game-${tag}.csv`);
}

/** Print the turns 1–6 engagement read (consequential actions, idle seats, price volatility). */
function printEarlyGameTable(metrics: GameMetrics): void {
  console.log(`\n--- Early-game engagement (turns 1–6), seed ${metrics.seed} ---`);
  console.log("turn  conseq/seat  idleSeats  priceVol%");
  for (const s of metrics.snapshots.filter((s) => s.turn >= 1 && s.turn <= 6)) {
    const conseq = Object.values(s.consequentialPerCorp);
    const mean = conseq.length ? conseq.reduce((a, b) => a + b, 0) / conseq.length : 0;
    const volMean =
      RESOURCES.reduce((a, r) => a + s.priceChangePct[r], 0) / RESOURCES.length;
    console.log(
      `${String(s.turn).padStart(4)}  ${mean.toFixed(2).padStart(11)}  ${String(s.idleSeats).padStart(9)}  ${(volMean * 100).toFixed(2).padStart(8)}`,
    );
  }
}

function runBatch(config: GameConfig, args: Args): void {
  const startSeed = typeof args.seed === "number" ? args.seed : 1;
  const games = args.procedural
    ? runProceduralGames({ games: args.games, startSeed, players: args.players, turns: args.turns, galaxy: galaxyOverride(args) })
    : runGames(config, {
        games: args.games,
        startSeed,
        players: args.players,
        turns: args.turns,
      });
  const outDir = join(repoRoot, args.outDir);
  mkdirSync(outDir, { recursive: true });
  const tag = `${games[0]?.players ?? config.players}p`;
  writePerTurnCsv(join(outDir, `per-turn-${tag}.csv`), games);
  writePerGameCsv(join(outDir, `per-game-${tag}.csv`), games);
  writeEarlyGameCsv(join(outDir, `early-game-${tag}.csv`), games);

  const agg = aggregate(config, games);
  const md = renderMarkdown([agg]);
  writeFileSync(join(outDir, `summary-${tag}.md`), md);
  printSummaryToConsole(agg, outDir, tag);
}

function printSummaryToConsole(agg: Aggregate, outDir: string, tag: string): void {
  console.log(`\nBatch complete: ${agg.games} games, ${agg.players} players, ${agg.turns} turns`);
  console.log("Risk flags:");
  for (const f of agg.flags) {
    console.log(`  ${f.triggered ? "FLAG" : "ok  "}  ${f.name} — ${f.detail}`);
  }
  console.log(`\nWrote out/per-turn-${tag}.csv, out/per-game-${tag}.csv, out/summary-${tag}.md`);
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  // Procedural sweeps generate a galaxy per game; the committed flat-yield maps load from disk.
  // For aggregate metadata (player count / turns) a representative config is enough.
  const players = args.players ?? 8;
  const turns = args.turns ?? 42;
  const config = args.procedural
    ? proceduralConfig(typeof args.seed === "number" ? args.seed : 1, players, turns, galaxyOverride(args))
    : loadScenarioFile(scenarioPathFor(args));
  if (args.verbose && args.games <= 1) {
    runSingleVerbose(config, args);
  } else {
    runBatch(config, args);
  }
}

main();
