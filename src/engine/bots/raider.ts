/**
 * Raider / Privateer bot.
 *
 * Claims a cheap, route-strategic system, funds raiders/privateers, and interdicts
 * busy warp tunnels carrying rivals' exports (Sections 13–14). Still exports a little
 * to stay solvent.
 */
import type { BidOrder, Order } from "../types.js";
import type { Bot, PlayerView } from "./bot.js";
import { bidList, planRaid, routeExposureScore, sellSurplus, valueSystem } from "./strategy.js";

export class RaiderBot implements Bot {
  readonly id = "raider";

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
    const orders: Order[] = [];
    // Raiders still export their own modest output to stay solvent.
    orders.push(...sellSurplus(view, 0));
    // Aggressively haunt the busiest export lane from turn 3 onward.
    if (view.turn >= 3) orders.push(...planRaid(view, { fundFactor: 1.2 }));
    return orders;
  }
}
