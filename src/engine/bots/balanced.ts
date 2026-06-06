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
  financierOrders,
  freeOperatorOrders,
  maybeBuildDepot,
  maybeBuildExtractor,
  maybeBuildHydroponics,
  maybeBuildMegastructure,
  maybeBuildPlatforms,
  maybeBuildProcessor,
  maybeBuildReactor,
  maybeBuildWarships,
  maybeExpand,
  maybeFrontier,
  maybeResearchRange,
  maybeUpgradeInfrastructure,
  planRaid,
  sellSurplus,
  valueSystem,
  type BotState,
} from "./strategy.js";

export class BalancedBot implements Bot {
  readonly id = "balanced";
  private readonly state: BotState = {};

  bid(view: PlayerView): BidOrder {
    return { kind: "bid", priorities: bidList(view, (s) => valueSystem(view, s)) };
  }

  decide(view: PlayerView): Order[] {
    if (view.me.isFreeOperator) return freeOperatorOrders(view, this.state);
    const orders: Order[] = [];
    orders.push(...sellSurplus(view));
    orders.push(...maybeBuildExtractor(view));
    orders.push(...maybeExpand(view));
    orders.push(...maybeResearchRange(view));
    orders.push(...maybeBuildDepot(view));
    orders.push(...maybeFrontier(view));
    orders.push(...maybeBuildHydroponics(view));
    // Production chains (Section 07b): add power, then a processor that can be fed locally.
    orders.push(...maybeBuildReactor(view));
    orders.push(...maybeBuildProcessor(view));
    // Sink overproduced raws into system upgrades (Section 07c) and grand construction (Section 22).
    orders.push(...maybeUpgradeInfrastructure(view));
    orders.push(...maybeBuildMegastructure(view));
    orders.push(...maybeBuildPlatforms(view));
    orders.push(...maybeBuildWarships(view));

    // Once established, opportunistically harass a busy lane (later and more
    // cautiously than a dedicated raider).
    if (view.turn >= 14 && view.me.credits > view.config.tuning.privateerCost * 4) {
      orders.push(...planRaid(view, { minTraffic: 2, fundFactor: 4 }));
    }

    // Late game: pursue a hostile takeover of the weakest charter (Section 17).
    orders.push(...financierOrders(view, this.state, { sinceTurn: 24 }));

    return orders;
  }
}
