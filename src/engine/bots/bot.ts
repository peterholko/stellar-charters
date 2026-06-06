/**
 * Bot interface and the player view bots reason over.
 *
 * Bots are pure decision functions: given a legal view of the game, they return
 * orders. They receive the seeded Rng so any randomness in their choices stays
 * deterministic with the rest of the simulation.
 */
import type { GameConfig } from "../config.js";
import type { Galaxy } from "../galaxy.js";
import type { Market } from "../market.js";
import type { Rng } from "../rng.js";
import type { BidOrder, Convoy, Corporation, Order } from "../types.js";

export interface PlayerView {
  turn: number;
  config: GameConfig;
  galaxy: Galaxy;
  market: Market;
  /** The corporation this bot controls (full visibility). */
  me: Corporation;
  /** Public summaries of all corporations. */
  corporations: Corporation[];
  /** Convoys currently visible on the map (public fields). */
  convoys: Convoy[];
  rng: Rng;
}

export interface Bot {
  readonly id: string;
  /** Opening Inner Ring auction bid (Section 05). */
  bid(view: PlayerView): BidOrder;
  /** Orders for a normal turn. */
  decide(view: PlayerView): Order[];
}

export type BotFactory = () => Bot;
