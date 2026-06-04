/**
 * Balanced bot.
 *
 * Trades and expands like a miner, but opportunistically hires a privateer and
 * interdicts a busy route when it can afford to. A middle-of-the-road opponent.
 */
import type { BidOrder, Order } from "../types.js";
import type { Bot, PlayerView } from "./bot.js";
import {
  bidList,
  maybeEscort,
  maybeExpand,
  maybeFrontier,
  maybeResearchRange2,
  planRaid,
  sellSurplus,
  valueSystem,
} from "./strategy.js";

export class BalancedBot implements Bot {
  readonly id = "balanced";

  bid(view: PlayerView): BidOrder {
    return { kind: "bid", priorities: bidList(view, (s) => valueSystem(view, s)) };
  }

  decide(view: PlayerView): Order[] {
    const orders: Order[] = [];
    orders.push(...sellSurplus(view));
    orders.push(...maybeExpand(view));
    orders.push(...maybeResearchRange2(view));
    orders.push(...maybeFrontier(view));
    orders.push(...maybeEscort(view));

    // Once established, opportunistically harass a busy lane (later and more
    // cautiously than a dedicated raider).
    if (view.turn >= 8 && view.me.credits > view.config.tuning.privateerCost * 4) {
      orders.push(...planRaid(view, { minTraffic: 2, fundFactor: 4 }));
    }

    return orders;
  }
}
