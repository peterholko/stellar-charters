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
  maybeAlliance,
  maybeBuildExtractor,
  maybeBuildPlatforms,
  maybeBuildWarships,
  maybeConquest,
  maybeDefendAlly,
  maybeSabotage,
  maybeResearch,
  RESEARCH_PLANS,
  maybeSurvey,
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
    orders.push(...maybeBuildExtractor(view));
    orders.push(...maybeResearch(view, RESEARCH_PLANS.raider));
    // Scout rival systems for raid/seizure targets with a survey vessel (Section 25).
    orders.push(...maybeSurvey(view));
    // Aggressively haunt the busiest export lane from turn 5 onward.
    if (view.turn >= 5) orders.push(...planRaid(view, { fundFactor: 1.2 }));
    // Sabotage a reachable rival's production as well as its convoys (Section 21).
    if (view.turn >= 8) orders.push(...maybeSabotage(view));
    // Diplomacy & conquest (Section 23): take an ally for cover, then mass a warfleet and seize
    // a rival's most valuable reachable system (accepting the Exchange lockout for the territory).
    orders.push(...maybeAlliance(view));
    orders.push(...maybeDefendAlly(view, this.state));
    orders.push(...maybeConquest(view, this.state));
    // Advance range tech, then defend its home system and convoys.
    orders.push(...maybeBuildPlatforms(view));
    orders.push(...maybeBuildWarships(view));
    // Having bled a rival via raids, move to seize it through equity (Section 17).
    orders.push(...financierOrders(view, this.state, { sinceTurn: 28 }));
    return orders;
  }
}
