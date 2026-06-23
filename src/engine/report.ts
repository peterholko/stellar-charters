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
      /** The arriving convoy — lets the client headline it by name (folklore, design rule #13). */
      convoyId: string;
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
      /** The struck convoy — lets the client headline it by name. */
      convoyId: string;
      outcome: RaidOutcome;
      resource: Resource;
      cargoLost: number;
      /** Erased vs stolen, separated (stolen cargo is fenced by the raider). */
      cargoDestroyed: number;
      cargoPlundered: number;
      /** Shown math (design rule #8): the named forces behind the outcome. */
      attackStrength: number;
      defenseStrength: number;
      escort: number;
      localDefense: number;
      /**
       * Attribution as an intel system (review Section 11): 1 = openly attributed (ship raid);
       * < 1 = a deniable privateer strike that left this much evidence ("Suspected sponsor: X (60%)").
       */
      sponsorEvidence: number;
    }
  | {
      type: "build";
      corpId: string;
      what: string;
      systemId?: string;
    }
  | {
      type: "research";
      corpId: string;
      techId: string;
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
      type: "invasion";
      attackerId: string;
      defenderId: string;
      systemId: string;
      captured: boolean;
      /** Shown math (design rule #8): attacking force vs the system's full standing defense. */
      attackForce: number;
      defenseForce: number;
    }
  | {
      type: "warDeclared";
      aggressorId: string;
      defenderId: string;
    }
  | {
      type: "warEnded";
      aggressorId: string;
      defenderId: string;
    }
  | {
      type: "alliance";
      aId: string;
      bId: string;
    }
  | {
      type: "pactInvoked";
      /** The ally drawn into the war to defend `allyId`. */
      protectorId: string;
      aggressorId: string;
      allyId: string;
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

/**
 * Why a credit moved (design rule #1: every credit that leaves the player's account appears
 * as a ledger line with a cause — no exceptions, including automation).
 */
export type LedgerCause =
  | "claim" // claim cost / auction award
  | "auctionRefund"
  | "build" // credit cost of a building/ship/structure order
  | "procurement" // auto-bought input shortfall at market price (the invisible hand, itemized)
  | "marketBuy" // exchange purchase incl. shipping
  | "convoyPayout" // export proceeds on arrival
  | "upkeep" // per-system charter upkeep
  | "tax" // population tax income
  | "fuelUpkeep" // per-ship operating fuel bought at market (shortfall portion)
  | "fuelMove" // fleet movement fuel bought at market (shortfall portion)
  | "fuelFreight" // freighter mass-fuel bought at market (shortfall portion)
  | "emergencyImport" // premium humanity food/ice imports
  | "debtInterest"
  | "borrow"
  | "repay"
  | "shareTrade" // share purchases/sales
  | "plunderFence" // fenced raid loot proceeds
  | "distress" // distress liquidation write-down/proceeds
  | "research" // banked RP conversions or research spend, if any
  | "other";

/** One credit movement, with its cause — the turn report's Ledger section renders these. */
export interface LedgerEntry {
  corpId: string;
  /** Signed credits: positive = income, negative = spend. */
  delta: number;
  cause: LedgerCause;
  /** Short human detail, e.g. "bought 12 alloys @ 31 — local stockpile short". */
  detail?: string;
  systemId?: string;
}

export interface TurnReport {
  turn: number;
  phase: "auction" | "normal";
  events: TurnEvent[];
  /** Every credit movement this turn, per corp (fog-of-war: each seat receives only its own). */
  ledger: LedgerEntry[];
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
