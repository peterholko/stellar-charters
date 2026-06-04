/**
 * Opening Inner Ring Claim Auction (Section 05).
 *
 * Sealed, simultaneous bids. Each player submits a priority-ordered list of
 * fallback bids and can win at most one inner-ring system. Highest valid bid wins
 * each system; losing bids are refunded at `bidRefundFrac` (0.90–0.95).
 */
import type { GameConfig } from "./config.js";
import type { BidOrder, Corporation } from "./types.js";

export interface AuctionResult {
  /** systemId -> winning corporation id. */
  winners: Map<string, string>;
  /** corporation id -> systemId it won (if any). */
  awarded: Map<string, string>;
  /** corporation id -> credits spent (winning bid). */
  spent: Map<string, number>;
  /** corporation id -> credits refunded for losing bids. */
  refunded: Map<string, number>;
  /** Per-system spread between top and second valid bid (auction-health metric). */
  bidSpread: Map<string, number>;
}

/**
 * Resolve the auction.
 *
 * Greedy by descending bid amount: walk every (player, priority) bid from highest
 * to lowest. Award a system to the first bid whose player has not yet won and whose
 * system is still free. This honours "highest valid bid wins each system" while
 * enforcing one claim per player and respecting fallbacks.
 */
export function resolveAuction(
  config: GameConfig,
  corps: Corporation[],
  bids: Map<string, BidOrder>,
): AuctionResult {
  interface FlatBid {
    corpId: string;
    systemId: string;
    amount: number;
    priority: number;
  }
  const flat: FlatBid[] = [];
  for (const corp of corps) {
    const order = bids.get(corp.id);
    if (!order) continue;
    order.priorities.forEach((p, i) => {
      flat.push({ corpId: corp.id, systemId: p.systemId, amount: p.amount, priority: i });
    });
  }
  // Sort by amount desc; deterministic tie-break by corpId then priority.
  flat.sort(
    (x, y) =>
      y.amount - x.amount ||
      x.corpId.localeCompare(y.corpId) ||
      x.priority - y.priority,
  );

  const winners = new Map<string, string>();
  const awarded = new Map<string, string>();
  const spent = new Map<string, number>();
  const refunded = new Map<string, number>();
  const bidSpread = new Map<string, number>();

  // Track top two valid amounts per system for the spread metric.
  const topAmounts = new Map<string, number[]>();
  for (const b of flat) {
    const arr = topAmounts.get(b.systemId) ?? [];
    arr.push(b.amount);
    topAmounts.set(b.systemId, arr);
  }
  for (const [systemId, amounts] of topAmounts) {
    amounts.sort((a, c) => c - a);
    bidSpread.set(systemId, (amounts[0] ?? 0) - (amounts[1] ?? 0));
  }

  for (const b of flat) {
    if (awarded.has(b.corpId)) continue; // player already won a system
    if (winners.has(b.systemId)) continue; // system already taken
    winners.set(b.systemId, b.corpId);
    awarded.set(b.corpId, b.systemId);
    spent.set(b.corpId, b.amount);
  }

  // Refund every non-winning bid each player submitted.
  const refundFrac = config.tuning.bidRefundFrac;
  for (const corp of corps) {
    const order = bids.get(corp.id);
    if (!order) continue;
    const wonSystem = awarded.get(corp.id);
    let refund = 0;
    for (const p of order.priorities) {
      if (p.systemId === wonSystem) continue; // winning bid is "spent", not refunded
      refund += p.amount * refundFrac;
    }
    refunded.set(corp.id, Math.round(refund));
  }

  return { winners, awarded, spent, refunded, bidSpread };
}
