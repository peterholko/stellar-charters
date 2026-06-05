/**
 * Raider / Privateer bot.
 *
 * Claims a cheap, route-strategic system, funds raiders/privateers, and interdicts
 * busy warp tunnels carrying rivals' exports (Sections 13–14). Still exports a little
 * to stay solvent.
 */
import type { BidOrder, Order } from "../types.js";
import type { Bot, PlayerView } from "./bot.js";
import {
  bidList,
  financierOrders,
  freeOperatorOrders,
  maybeBuildWarships,
  planRaid,
  routeExposureScore,
  sellSurplus,
  valueSystem,
  type BotState,
} from "./strategy.js";

export class RaiderBot implements Bot {
  readonly id = "raider";
  private readonly state: BotState = {};

  bid(view: PlayerView): BidOrder {
    // Prefer cheap systems sitting on exposed routes; mild weight on raw value.
    return {
      kind: "bid",
      priorities: bidList(
        view,
        (s) => routeExposureScore(view, s) * 1500 + valueSystem(view, s) * 0.4,
        0.6,
      ),
    };
  }

  decide(view: PlayerView): Order[] {
    if (view.me.isFreeOperator) return freeOperatorOrders(view, this.state);
    const orders: Order[] = [];
    // Raiders still export their own modest output to stay solvent.
    orders.push(...sellSurplus(view, 0));
    // Aggressively haunt the busiest export lane from turn 3 onward.
    if (view.turn >= 3) orders.push(...planRaid(view, { fundFactor: 1.2 }));
    // Defend its own home system and convoys.
    orders.push(...maybeBuildWarships(view));
    // Having bled a rival via raids, move to seize it through equity (Section 17).
    orders.push(...financierOrders(view, this.state, { sinceTurn: 16 }));
    return orders;
  }
}
