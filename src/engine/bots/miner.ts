/**
 * Miner / Exporter bot.
 *
 * Claims a resource-rich system, exports surplus every turn, expands to a second
 * claim, and researches Range 2 to reach deeper systems. Defensive, not aggressive.
 */
import type { BidOrder, Order } from "../types.js";
import type { Bot, PlayerView } from "./bot.js";
import {
  bidList,
  freeOperatorOrders,
  maybeBuildDepot,
  maybeBuildHydroponics,
  maybeBuildWarships,
  maybeExpand,
  maybeFrontier,
  maybeResearchRange2,
  sellSurplus,
  valueSystem,
  type BotState,
} from "./strategy.js";

export class MinerBot implements Bot {
  readonly id = "miner";
  private readonly state: BotState = {};

  bid(view: PlayerView): BidOrder {
    return { kind: "bid", priorities: bidList(view, (s) => valueSystem(view, s)) };
  }

  decide(view: PlayerView): Order[] {
    if (view.me.isFreeOperator) return freeOperatorOrders(view, this.state);
    const orders: Order[] = [];
    orders.push(...sellSurplus(view));
    // Grow the local economy before reaching for range tech.
    orders.push(...maybeExpand(view));
    orders.push(...maybeResearchRange2(view));
    // Miners are the explorers: reach the rare-isotope frontier before other builds.
    orders.push(...maybeFrontier(view));
    orders.push(...maybeBuildDepot(view));
    orders.push(...maybeBuildHydroponics(view));
    orders.push(...maybeBuildWarships(view));
    return orders;
  }
}
