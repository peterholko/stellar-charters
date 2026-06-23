/**
 * Metric collection (pure data structures).
 *
 * The engine writes a snapshot each turn; the harness aggregates these across many
 * games to answer the Section 21 design risks (price crashes, overpowered raiding,
 * chokepoint dominance, order/UX fatigue, run-away leaders).
 */
import type { RaidOutcome } from "./raiding.js";
import { RESOURCES, type PopulationStage, type Resource } from "./types.js";

export interface TurnSnapshot {
  turn: number;
  prices: Record<Resource, number>;
  /** Per-corporation credits and valuation, keyed by corp id. */
  credits: Record<string, number>;
  valuation: Record<string, number>;
  /** Orders submitted this turn per corporation (UX-load proxy). */
  ordersPerCorp: Record<string, number>;
  convoysLaunched: number;
  convoysRaided: number;
  cargoValueShipped: number;
  cargoValueLost: number;
  /** Value of the single biggest raid hit this turn (review Section 11: tune for tales — the
   *  fat tail of memorable catastrophes matters, not just the mean). */
  largestSingleRaidLoss: number;
  /** Escort orders placed this turn — a defender-behaviour-elasticity proxy vs raid pressure. */
  escortOrders: number;
  raidOutcomes: Record<RaidOutcome, number>;
  /** Convoys per route this turn, keyed by route id (chokepoint metric). */
  routeTraffic: Record<string, number>;
  /** Tax credited to charter holders this turn (population economy). */
  taxLevied: number;
  /** Acquisitions and distress liquidations resolved this turn (Sections 17–18). */
  acquisitions: number;
  distress: number;
  /** Free Operators active at end of this turn. */
  freeOperators: number;
}

export interface GameMetrics {
  seed: number;
  players: number;
  turns: number;
  snapshots: TurnSnapshot[];
  /** Turn on which each corp made its 2nd claim / reached Range 2 (-1 if never). */
  secondClaimTurn: Record<string, number>;
  range2Turn: Record<string, number>;
  /** Auction health. */
  auctionRefundFrac: number;
  auctionFallbackUsage: number;
  finalValuation: Record<string, number>;
  /** Late-game layers (Sections 12, 17, 18). */
  acquisitionsTotal: number;
  distressLiquidations: number;
  finalFreeOperators: number;
  depotsBuilt: number;
  shipsBuilt: number;
  platformsBuilt: number;
  disruptorsBuilt: number;
  finalStageCounts: Record<PopulationStage, number>;
}

export function emptyRaidOutcomes(): Record<RaidOutcome, number> {
  return {
    noContact: 0,
    shadowed: 0,
    harassed: 0,
    damaged: 0,
    plundered: 0,
    repelled: 0,
    ambushed: 0,
  };
}

/** Gini coefficient of a non-negative distribution (0 = even, 1 = fully concentrated). */
export function gini(values: number[]): number {
  const xs = values.filter((v) => v >= 0).sort((a, b) => a - b);
  const n = xs.length;
  if (n === 0) return 0;
  const total = xs.reduce((s, v) => s + v, 0);
  if (total === 0) return 0;
  let cum = 0;
  for (let i = 0; i < n; i++) cum += (i + 1) * xs[i]!;
  return (2 * cum) / (n * total) - (n + 1) / n;
}

/** Coefficient of variation (stdev / mean) of a series; volatility proxy. */
export function coefficientOfVariation(series: number[]): number {
  if (series.length === 0) return 0;
  const mean = series.reduce((s, v) => s + v, 0) / series.length;
  if (mean === 0) return 0;
  const variance =
    series.reduce((s, v) => s + (v - mean) ** 2, 0) / series.length;
  return Math.sqrt(variance) / mean;
}

/** Helper: list resources for callers that want a stable order. */
export const METRIC_RESOURCES = RESOURCES;
