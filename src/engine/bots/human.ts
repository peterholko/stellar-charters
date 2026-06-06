/**
 * The human seat.
 *
 * Unlike the AI bots, the HumanBot does not reason over the view. The web UI stages
 * the player's choices into `pendingBid` / `pendingOrders`, and the engine pulls them
 * when it resolves a turn (the same `bid()` / `decide()` surface every bot exposes).
 * The app holds a reference to one shared instance and sets these fields before each
 * `stepAuction()` / `stepTurn()` call.
 */
import type { Bot, PlayerView } from "./bot.js";
import type { BidOrder, Order } from "../types.js";

export class HumanBot implements Bot {
  readonly id = "human";
  /** Opening-auction bid the UI staged for turn 1. */
  pendingBid: BidOrder = { kind: "bid", priorities: [] };
  /** Orders the UI staged for the next normal turn. */
  pendingOrders: Order[] = [];

  bid(_view: PlayerView): BidOrder {
    return this.pendingBid;
  }

  decide(_view: PlayerView): Order[] {
    const orders = this.pendingOrders;
    this.pendingOrders = []; // consume: staged orders apply once, not every turn
    return orders;
  }
}
