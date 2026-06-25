/**
 * Node-only CSV writers for the batch harness output.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { RESOURCES } from "../engine/types.js";
import type { GameMetrics } from "../engine/metrics.js";

function ensureDir(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}

function toCsv(rows: (string | number)[][]): string {
  return rows.map((r) => r.join(",")).join("\n") + "\n";
}

/** One row per (game, turn): prices, totals, raid stats. Each row records its seed. */
export function writePerTurnCsv(path: string, games: GameMetrics[]): void {
  ensureDir(path);
  const header = [
    "seed",
    "turn",
    ...RESOURCES.map((r) => `price_${r}`),
    "convoysLaunched",
    "convoysRaided",
    "cargoValueShipped",
    "cargoValueLost",
    "largestSingleRaidLoss",
    "escortOrders",
    "ordersTotal",
    "taxLevied",
    "acquisitions",
    "distress",
    "freeOperators",
  ];
  const rows: (string | number)[][] = [header];
  for (const g of games) {
    for (const s of g.snapshots) {
      const ordersTotal = Object.values(s.ordersPerCorp).reduce((a, b) => a + b, 0);
      rows.push([
        g.seed,
        s.turn,
        ...RESOURCES.map((r) => s.prices[r]),
        s.convoysLaunched,
        s.convoysRaided,
        Math.round(s.cargoValueShipped),
        Math.round(s.cargoValueLost),
        Math.round(s.largestSingleRaidLoss),
        s.escortOrders,
        ordersTotal,
        s.taxLevied,
        s.acquisitions,
        s.distress,
        s.freeOperators,
      ]);
    }
  }
  writeFileSync(path, toCsv(rows));
}

/**
 * One row per (game, turn): Phase 0 early-game engagement instrumentation. Consequential actions
 * (non-no-op orders summed across seats + mean per seat), idle-seat count, and per-resource
 * turn-over-turn price volatility. Used to read whether the opening turns give players real
 * decisions and whether prices actually move early.
 */
export function writeEarlyGameCsv(path: string, games: GameMetrics[]): void {
  ensureDir(path);
  const header = [
    "seed",
    "turn",
    "seats",
    "consequentialTotal",
    "consequentialMean",
    "idleSeats",
    "priceVolatilityMean",
    ...RESOURCES.map((r) => `pchg_${r}`),
  ];
  const rows: (string | number)[][] = [header];
  for (const g of games) {
    for (const s of g.snapshots) {
      const consequential = Object.values(s.consequentialPerCorp);
      const seats = consequential.length;
      const consequentialTotal = consequential.reduce((a, b) => a + b, 0);
      const volatilities = RESOURCES.map((r) => s.priceChangePct[r]);
      const volMean = volatilities.reduce((a, b) => a + b, 0) / RESOURCES.length;
      rows.push([
        g.seed,
        s.turn,
        seats,
        consequentialTotal,
        seats ? round2(consequentialTotal / seats) : 0,
        s.idleSeats,
        round4(volMean),
        ...volatilities.map(round4),
      ]);
    }
  }
  writeFileSync(path, toCsv(rows));
}

/** One row per game: final valuations, auction health, pacing milestones. */
export function writePerGameCsv(path: string, games: GameMetrics[]): void {
  ensureDir(path);
  const header = [
    "seed",
    "players",
    "leaderValuation",
    "lastValuation",
    "leaderLastRatio",
    "auctionRefundFrac",
    "auctionFallbackUsage",
    "avgSecondClaimTurn",
    "avgRange2Turn",
    "acquisitions",
    "distressLiquidations",
    "finalFreeOperators",
    "depotsBuilt",
    "disruptorsBuilt",
  ];
  const rows: (string | number)[][] = [header];
  for (const g of games) {
    const vals = Object.values(g.finalValuation).sort((a, b) => b - a);
    const leader = vals[0] ?? 0;
    const last = vals[vals.length - 1] ?? 0;
    rows.push([
      g.seed,
      g.players,
      leader,
      last,
      last !== 0 ? round2(leader / last) : 0,
      round2(g.auctionRefundFrac),
      round2(g.auctionFallbackUsage),
      round2(avgDefined(Object.values(g.secondClaimTurn))),
      round2(avgDefined(Object.values(g.range2Turn))),
      g.acquisitionsTotal,
      g.distressLiquidations,
      g.finalFreeOperators,
      g.depotsBuilt,
      g.disruptorsBuilt,
    ]);
  }
  writeFileSync(path, toCsv(rows));
}

function avgDefined(values: number[]): number {
  const valid = values.filter((v) => v >= 0);
  if (valid.length === 0) return -1;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}
