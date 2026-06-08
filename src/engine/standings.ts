/**
 * Victory & end-game standings (Section 29).
 *
 * Every match needs a climax. Valuation (Section 17) already measures economic strength, but a
 * pure-cash crown gives conquest, tech-rush, and wonder strategies no moment of their own. So the
 * final standing is `valuation + prestige`, where prestige rewards the achievements valuation
 * under-counts: charter systems held, techs unlocked, galaxy-unique secret projects owned, and
 * megastructures raised. The category that carries the winner's lead names the victory.
 *
 * This is a pure, deterministic read-model over engine state — no randomness, no mutation, no
 * wall-clock — so it is identical on the simulator, the worker, and the browser, and a finished
 * game's outcome is reproducible from its seed like everything else.
 */
import type { Corporation } from "./types.js";
import type { Galaxy } from "./galaxy.js";
import type { Tuning } from "./config.js";
import { SECRET_TECH_IDS } from "./research.js";

/** How a game was (or is being) won. `economic` is the default cash/valuation crown. */
export type VictoryPath = "economic" | "conquest" | "technology" | "wonder" | "monopoly";

export interface Standing {
  corpId: string;
  name: string;
  /** 1-based rank by score (1 = leader). */
  rank: number;
  /** Final/live victory score = valuation + prestige bonuses. */
  score: number;
  valuation: number;
  /** Prestige points (score minus valuation), broken out below. */
  prestige: number;
  systems: number;
  techs: number;
  /** Galaxy-unique secret projects owned. */
  secrets: number;
  megastructures: number;
  /** Still holds a charter (vs. collapsed to Free Operator). */
  hasCharter: boolean;
  /** The category this corp leads / is strongest in — flavour for the scoreboard. */
  path: VictoryPath;
}

export interface GameOutcome {
  /** All corps ranked by score (live during play, final once over). */
  standings: Standing[];
  /** True once a winner is decided — either the turn limit or a decisive monopoly. */
  over: boolean;
  /** True when the game ended *early* because one charter outlasted all rivals. */
  decisive: boolean;
  /** The leading corp once `over`, else null. */
  winnerId: string | null;
  /** How the winner won once `over`, else null. */
  victoryType: VictoryPath | null;
}

function secretCount(corp: Corporation): number {
  let n = 0;
  for (const id of corp.research.completed) if (SECRET_TECH_IDS.includes(id)) n++;
  return n;
}

function megastructureCount(corp: Corporation, galaxy: Galaxy): number {
  let n = 0;
  for (const sysId of corp.ownedSystemIds) {
    const sys = galaxy.systems.get(sysId);
    if (sys) n += sys.megastructures.length;
  }
  return n;
}

/** Whichever prestige category this corp leads the field in (ties broken economic→conquest→…). */
function pathOf(corp: Corporation, rows: ReadonlyArray<{ corpId: string; secrets: number; systems: number; megastructures: number; techs: number }>): VictoryPath {
  const me = rows.find((r) => r.corpId === corp.id)!;
  const soleMax = (pick: (r: { secrets: number; systems: number; megastructures: number; techs: number }) => number, min: number): boolean => {
    const v = pick(me);
    if (v < min) return false;
    return rows.every((r) => r.corpId === corp.id || pick(r) < v);
  };
  // Priority: the rarer, more decisive the achievement, the more it defines the win.
  if (soleMax((r) => r.secrets, 1)) return "technology";
  if (soleMax((r) => r.megastructures, 1)) return "wonder";
  if (soleMax((r) => r.systems, 2)) return "conquest";
  if (soleMax((r) => r.techs, 1)) return "technology";
  return "economic";
}

/**
 * Rank every corporation and, if the game has ended, name the winner and how they won.
 * `turn`/`totalTurns` drive the end check: the natural turn limit, or a decisive monopoly
 * (exactly one charter left standing) no earlier than `victory.monopolyMinTurn`.
 */
export function computeOutcome(
  corps: ReadonlyArray<Corporation>,
  galaxy: Galaxy,
  tuning: Tuning,
  turn: number,
  totalTurns: number,
): GameOutcome {
  const v = tuning.victory;
  const raw = corps.map((c) => {
    const systems = c.ownedSystemIds.length;
    const secrets = secretCount(c);
    const techs = c.research.completed.length;
    const megastructures = megastructureCount(c, galaxy);
    const prestige =
      systems * v.systemPoints +
      // Non-secret techs score at the base rate; secrets get the (much larger) secret rate on top.
      (techs - secrets) * v.techPoints +
      secrets * v.secretPoints +
      megastructures * v.megastructurePoints;
    return { corpId: c.id, name: c.name, valuation: c.valuation, hasCharter: c.hasCharter, prestige, systems, secrets, techs, megastructures, score: Math.round(c.valuation + prestige) };
  });

  // Rank by score; ties break by valuation then corpId so ordering is fully deterministic.
  const ordered = [...raw].sort((a, b) => b.score - a.score || b.valuation - a.valuation || (a.corpId < b.corpId ? -1 : 1));
  const standings: Standing[] = ordered.map((r, i) => ({
    corpId: r.corpId,
    name: r.name,
    rank: i + 1,
    score: r.score,
    valuation: r.valuation,
    prestige: Math.round(r.prestige),
    systems: r.systems,
    techs: r.techs,
    secrets: r.secrets,
    megastructures: r.megastructures,
    hasCharter: r.hasCharter,
    path: pathOf(corps.find((c) => c.id === r.corpId)!, raw),
  }));

  // A monopoly ends the game early: exactly one charter remains among corps that ever held one.
  const charterHolders = standings.filter((s) => s.hasCharter);
  const everHadCharter = corps.length; // every seat begins with a charter (Section 1)
  const decisive = turn >= v.monopolyMinTurn && everHadCharter > 1 && charterHolders.length === 1;
  const over = turn >= totalTurns || decisive;

  let winnerId: string | null = null;
  let victoryType: VictoryPath | null = null;
  if (over && standings.length > 0) {
    const winner = decisive ? charterHolders[0]! : standings[0]!;
    winnerId = winner.corpId;
    victoryType = decisive ? "monopoly" : winner.path;
  }

  return { standings, over, decisive, winnerId, victoryType };
}
