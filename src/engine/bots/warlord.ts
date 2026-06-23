/**
 * Warlord bot (Section 23).
 *
 * Plays to dominate by force: keeps an economy just large enough to fund a fleet, climbs the
 * range ladder toward capital hulls, and pours its cash into warships and conquest — massing a
 * warfleet to seize rivals' valuable systems, dogpiling the hegemon, and settling grudges.
 * Accepts the war tariff as the cost of empire.
 */
import type { BidOrder, Order } from "../types.js";
import type { Bot, PlayerView } from "./bot.js";
import {
  bidList,
  freeOperatorOrders,
  maybeAlliance,
  maybeBuildExtractor,
  maybeBuildPlatforms,
  maybeBuildWarships,
  maybeConquest,
  maybeDefendAlly,
  maybeFrontier,
  maybeSabotage,
  maybeResearch,
  RESEARCH_PLANS,
  maybeSurvey,
  planRaid,
  maintainMaterialReserves,
  sellSurplus,
  valueSystem,
  type BotState,
} from "./strategy.js";

export class WarlordBot implements Bot {
  readonly id = "warlord";
  private readonly state: BotState = {};

  bid(view: PlayerView): BidOrder {
    return { kind: "bid", priorities: bidList(view, (s) => valueSystem(view, s)) };
  }

  decide(view: PlayerView): Order[] {
    if (view.me.isFreeOperator) return freeOperatorOrders(view, this.state);
    const orders: Order[] = [];
    // Keep just enough economy running to bankroll the war machine.
    orders.push(...sellSurplus(view));
    orders.push(...maintainMaterialReserves(view)); // no auto-buy: stock build materials up front
    orders.push(...maybeBuildExtractor(view));
    orders.push(...maybeResearch(view, RESEARCH_PLANS.warlord));
    orders.push(...maybeSurvey(view)); // scout conquest targets (Section 25)
    orders.push(...maybeFrontier(view));
    // Military first: build a fleet, then mass it and conquer.
    orders.push(...maybeBuildWarships(view));
    orders.push(...maybeDefendAlly(view, this.state));
    orders.push(...maybeConquest(view, this.state));
    // Bleed rivals between campaigns.
    if (view.turn >= 6) orders.push(...planRaid(view, { fundFactor: 1.4 }));
    if (view.turn >= 8) orders.push(...maybeSabotage(view));
    orders.push(...maybeBuildPlatforms(view));
    orders.push(...maybeAlliance(view));
    return orders;
  }
}
