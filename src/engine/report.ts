/**
 * Structured per-turn report (Section 20, step 10: "Reports published").
 *
 * The headless simulator only ever needed the aggregate `TurnSnapshot` in metrics.
 * The interactive web client needs a human-readable digest of what actually happened
 * each turn — arrivals, fills, raids, builds, growth, takeovers — so `stepAuction()`
 * and `stepTurn()` return a `TurnReport`. The engine collects these as plain
 * observations (no randomness, no logic change), so determinism is preserved.
 */
import type { PopulationStage, Resource, ConvoyKind } from "./types.js";
import type { RaidOutcome } from "./raiding.js";

export type TurnEvent =
  | {
      type: "auctionAward";
      corpId: string;
      systemId: string;
      amount: number;
    }
  | {
      type: "arrival";
      corpId: string;
      kind: ConvoyKind;
      resource: Resource;
      quantity: number;
      payout: number;
      destSystemId: string;
    }
  | {
      type: "fill";
      corpId: string;
      side: "buy" | "sell";
      resource: Resource;
      quantity: number;
      price: number;
      systemId: string;
    }
  | {
      type: "raid";
      attackerId: string;
      defenderId: string;
      routeId: string;
      outcome: RaidOutcome;
      resource: Resource;
      cargoLost: number;
    }
  | {
      type: "build";
      corpId: string;
      what: string;
      systemId?: string;
    }
  | {
      type: "growth";
      corpId: string;
      systemId: string;
      newStage: PopulationStage;
    }
  | {
      type: "starved";
      corpId: string;
      systemId: string;
    }
  | {
      type: "sabotage";
      attackerId: string;
      defenderId: string;
      systemId: string;
      resource: Resource;
      success: boolean;
    }
  | {
      type: "acquisition";
      acquirerId: string;
      targetId: string;
    }
  | {
      type: "distress";
      corpId: string;
    };

export interface TurnReport {
  turn: number;
  phase: "auction" | "normal";
  events: TurnEvent[];
  /** Global commodity prices after this turn cleared. */
  prices: Record<Resource, number>;
  /** Per-corporation headline figures after resolution. */
  corps: {
    id: string;
    credits: number;
    valuation: number;
    sharePrice: number;
  }[];
  /** Total tax levied across all charters this turn. */
  taxLevied: number;
}
