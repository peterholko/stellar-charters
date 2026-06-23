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
  maybeAlliance,
  maybeDefendAlly,
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
  maybeResearch,
  RESEARCH_PLANS,
  maybeSurvey,
  maybeUpgradeInfrastructure,
  maintainMaterialReserves,
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
    orders.push(...maintainMaterialReserves(view)); // no auto-buy: stock build materials up front
    // Develop deposits first (Section 21): an undeveloped claim produces nothing.
    orders.push(...maybeBuildExtractor(view));
    orders.push(...maybeResearch(view, RESEARCH_PLANS.miner));
    // Grow the local economy, then keep climbing the range-tech ladder.
    orders.push(...maybeExpand(view));
    // Miners are the explorers: scout systems with survey vessels, then reach the frontier.
    orders.push(...maybeSurvey(view));
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
    // Peaceful miners take a defensive alliance for protection — and honour it: if attacked or an
    // ally is, they counter-attack the aggressor (Section 23).
    orders.push(...maybeAlliance(view));
    orders.push(...maybeDefendAlly(view, this.state));
    return orders;
  }
}
