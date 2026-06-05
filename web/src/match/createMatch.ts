import {
  Engine,
  HumanBot,
  defaultRegistry,
  loadScenario,
  type GameConfig,
  type Scenario,
} from "@engine";
import rawScenario from "../../../scenarios/inner-ring-8p.json";

export const HUMAN_CORP_ID = "corp-0";
/** Spacious default: 4 charters on the 16-system inner ring (design's relaxed opening). */
export const DEFAULT_PLAYERS = 4;
export const DEFAULT_SEED = 7;

/** Flavour names for the charters (corp-0 is the human). */
const CHARTER_NAMES = [
  "Astra Meridian Charter",
  "Kestrel Resource Trust",
  "Vesper Helium Combine",
  "Sable Frontier Holdings",
  "Orion Freight Guild",
  "Halcyon Mining Co.",
  "Tycho Industrial",
  "Brightfall Ventures",
];

export interface Match {
  engine: Engine;
  /** The shared human seat: the UI writes staged orders here before each step. */
  human: HumanBot;
  humanCorpId: string;
}

/**
 * Build an interactive match with the human in seat `corp-0` and bots in the rest.
 * The human seat is wired through a custom registry so the headless `defaultRegistry`
 * (used by the simulator/tests) stays pure.
 */
export function createMatch(opts: { players?: number; seed?: number } = {}): Match {
  const players = opts.players ?? DEFAULT_PLAYERS;
  const seed = opts.seed ?? DEFAULT_SEED;

  const base = rawScenario as Scenario;
  const bots = [...(base.bots ?? ["balanced"])];
  bots[0] = "human";
  const scenario: Scenario = { ...base, players, bots };
  const config: GameConfig = loadScenario(scenario);

  const human = new HumanBot();
  const registry = defaultRegistry();
  registry.set("human", () => human);

  const engine = new Engine(config, seed, registry);
  engine.corps.forEach((c, i) => {
    c.name = CHARTER_NAMES[i] ?? c.name;
  });
  return { engine, human, humanCorpId: HUMAN_CORP_ID };
}
