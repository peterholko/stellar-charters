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
    // Develop deposits first (Section 21): an undeveloped claim produces nothing.
    orders.push(...maybeBuildExtractor(view));
    // Grow the local economy, then keep climbing the range-tech ladder.
    orders.push(...maybeExpand(view));
    orders.push(...maybeResearchRange(view));
    // Miners are the explorers: reach the rare-isotope frontier before other builds.
    orders.push(...maybeFrontier(view));
    orders.push(...maybeBuildDepot(view));
    orders.push(...maybeBuildHydroponics(view));
    // Refine raw output into manufactured goods (Section 07b): power first, then a processor.
    orders.push(...maybeBuildReactor(view));
    orders.push(...maybeBuildProcessor(view));
    // Sink overproduced raws into system upgrades (Section 07c) and grand construction (Section 22).
    orders.push(...maybeUpgradeInfrastructure(view));
    orders.push(...maybeBuildMegastructure(view));
    // Cheap stationary platforms first, then mobile escort fleets.
    orders.push(...maybeBuildPlatforms(view));
    orders.push(...maybeBuildWarships(view));
    return orders;
  }
}
