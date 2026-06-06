/**
 * The Galactic Exchange (Sections 09–10).
 *
 * One global price per commodity. Each turn, market orders are cleared: buys add
 * demand, sells add supply, and the resulting net imbalance nudges the price,
 * clamped to humanity-provided floors and ceilings. The market always provides
 * liquidity, so routine market orders fill unless the player set a strict price cap.
 */
import type { Tuning } from "./config.js";
import { emptyStockpile, RESOURCES, type Resource } from "./types.js";

export interface MarketFill {
  order: ClearableOrder;
  filledQuantity: number;
  clearingPrice: number;
}

export interface ClearableOrder {
  ownerId: string;
  side: "buy" | "sell";
  resource: Resource;
  quantity: number;
  limitPrice: number;
  strict: boolean;
  systemId: string;
}

export class Market {
  readonly prices: Record<Resource, number>;
  private readonly tuning: Tuning;

  constructor(tuning: Tuning) {
    this.tuning = tuning;
    this.prices = { ...tuning.basePrices };
  }

  floor(resource: Resource): number {
    return this.tuning.basePrices[resource] * this.tuning.priceFloorFrac;
  }

  ceil(resource: Resource): number {
    return this.tuning.basePrices[resource] * this.tuning.priceCeilFrac;
  }

  /**
   * Clear a batch of orders for one turn. Price is computed first from net
   * imbalance (so all fills in a turn share a single clearing price per resource),
   * then each order fills against its strict/limit condition.
   */
  clear(orders: ClearableOrder[]): { fills: MarketFill[]; clearingPrices: Record<Resource, number> } {
    const demand: Record<Resource, number> = zero();
    const supply: Record<Resource, number> = zero();
    for (const o of orders) {
      if (o.side === "buy") demand[o.resource] += o.quantity;
      else supply[o.resource] += o.quantity;
    }

    const clearingPrices: Record<Resource, number> = { ...this.prices };
    for (const r of RESOURCES) {
      const imbalance = (demand[r] - supply[r]) / this.tuning.priceReferenceVolume;
      // Logistic-ish nudge: positive imbalance raises price, negative lowers it.
      const factor = 1 + this.tuning.priceElasticity * imbalance;
      const next = clamp(this.prices[r] * factor, this.floor(r), this.ceil(r));
      clearingPrices[r] = round2(next);
    }

    const fills: MarketFill[] = [];
    for (const o of orders) {
      const price = clearingPrices[o.resource];
      const ok =
        o.side === "buy" ? price <= o.limitPrice : price >= o.limitPrice;
      if (o.strict && !ok) {
        // Strict order whose price condition failed: no fill.
        fills.push({ order: o, filledQuantity: 0, clearingPrice: price });
        continue;
      }
      // Non-strict market orders fill fully at the clearing price (guaranteed liquidity).
      fills.push({ order: o, filledQuantity: o.quantity, clearingPrice: price });
    }

    // Commit the new prices for the next turn.
    for (const r of RESOURCES) this.prices[r] = clearingPrices[r];
    return { fills, clearingPrices };
  }
}

function zero(): Record<Resource, number> {
  return emptyStockpile();
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
