/**
 * A seat that is normally AI-controlled but can be taken over by a human.
 *
 * Each turn it uses the human's submitted orders if any were staged (`pendingOrders` set
 * to an array — even an empty one means "the human chose to do nothing"), otherwise it
 * defers to the wrapped fallback bot. Because the order log records exactly which turns a
 * human submitted, replaying it reproduces "AI until taken over, human afterwards" without
 * any extra join bookkeeping — and keeps the seeded RNG stream identical.
 */
import type { Bot, PlayerView } from "./bot.js";
import type { BidOrder, Order } from "../types.js";

export class HybridBot implements Bot {
  readonly id = "hybrid";
  /** Human orders for the current turn, or null to defer to the fallback AI. */
  pendingOrders: Order[] | null = null;

  constructor(private readonly fallback: Bot) {}

  bid(view: PlayerView): BidOrder {
    return this.fallback.bid(view);
  }

  decide(view: PlayerView): Order[] {
    return this.pendingOrders !== null ? this.pendingOrders : this.fallback.decide(view);
  }
}
