/**
 * Registry mapping bot ids (as referenced in scenario JSON) to their factories.
 */
import type { BotFactory } from "./bot.js";
import { BalancedBot } from "./balanced.js";
import { MinerBot } from "./miner.js";
import { RaiderBot } from "./raider.js";

export function defaultRegistry(): Map<string, BotFactory> {
  return new Map<string, BotFactory>([
    ["miner", () => new MinerBot()],
    ["raider", () => new RaiderBot()],
    ["balanced", () => new BalancedBot()],
  ]);
}
