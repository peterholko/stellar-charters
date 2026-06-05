/**
 * Aggregate per-game metrics into a balance summary that answers the Section 21
 * design risks, and render it as Markdown.
 */
import type { GameConfig } from "../engine/config.js";
import { coefficientOfVariation, gini, type GameMetrics } from "../engine/metrics.js";
import type { RaidOutcome } from "../engine/raiding.js";
import { RESOURCES, type Resource } from "../engine/types.js";

type RaidOutcomeKey = RaidOutcome;

export interface RiskFlag {
  name: string;
  triggered: boolean;
  detail: string;
}

export interface Aggregate {
  games: number;
  players: number;
  turns: number;
  priceFinalAvg: Record<Resource, number>;
  priceVolatilityAvg: Record<Resource, number>;
  priceFloorHitFrac: Record<Resource, number>;
  ordersPerPlayerPerTurn: number;
  pctCargoValueErased: number;
  pctGamesHeavyRaiding: number; // games where >25% cargo value erased
  convoyRaidRate: number; // raided convoys / launched convoys
  raidOutcomeDist: Record<RaidOutcomeKey, number>;
  routeTrafficGiniAvg: number;
  valuationGiniAvg: number;
  leaderToMedianRatio: number;
  avgSecondClaimTurn: number;
  avgRange2Turn: number;
  auctionRefundFracAvg: number;
  auctionFallbackUsageAvg: number;
  // Late-game layers (Sections 08, 12, 17, 18).
  acquisitionsPerGame: number;
  distressPerGame: number;
  freeOperatorsPerGame: number;
  depotsPerGame: number;
  shipsPerGame: number;
  taxPerTurnAvg: number;
  populatedBeyondOutboundFrac: number; // fraction of owned systems that grew past outpost
  topStageReached: string;
  flags: RiskFlag[];
}

const RAID_KEYS: RaidOutcomeKey[] = [
  "noContact",
  "shadowed",
  "harassed",
  "damaged",
  "plundered",
  "repelled",
  "ambushed",
];

export function aggregate(config: GameConfig, games: GameMetrics[]): Aggregate {
  const players = games[0]?.players ?? config.players;
  const turns = games[0]?.turns ?? config.turns;

  const priceFinalAvg = zeroRes();
  const priceVolatilityAvg = zeroRes();
  const priceFloorHitFrac = zeroRes();

  let ordersTotal = 0;
  let orderObservations = 0;
  let shipped = 0;
  let lost = 0;
  let raided = 0;
  let launched = 0;
  let heavyRaidingGames = 0;
  const raidOutcomeDist: Record<RaidOutcomeKey, number> = Object.fromEntries(
    RAID_KEYS.map((k) => [k, 0]),
  ) as Record<RaidOutcomeKey, number>;
  let routeGiniSum = 0;
  let valuationGiniSum = 0;
  let leaderMedianSum = 0;
  let secondClaimSum = 0;
  let secondClaimCount = 0;
  let range2Sum = 0;
  let range2Count = 0;
  let refundSum = 0;
  let fallbackSum = 0;
  let acquisitionsSum = 0;
  let distressSum = 0;
  let freeOpsSum = 0;
  let depotsSum = 0;
  let shipsSum = 0;
  let taxSum = 0;
  let taxObs = 0;
  let grownSystems = 0;
  let ownedSystems = 0;
  const stageOrder = ["outpost", "settlement", "colony", "city", "metropolis"];
  let topStageIdx = 0;

  for (const g of games) {
    // Prices.
    for (const r of RESOURCES) {
      const series = g.snapshots.map((s) => s.prices[r]).filter((v) => v !== undefined) as number[];
      const final = series[series.length - 1] ?? 0;
      priceFinalAvg[r] += final;
      priceVolatilityAvg[r] += coefficientOfVariation(series);
      const floor = config.tuning.basePrices[r] * config.tuning.priceFloorFrac;
      if (series.some((p) => p <= floor + 1e-6)) priceFloorHitFrac[r] += 1;
    }

    // Orders, trade, raids.
    let gameShipped = 0;
    let gameLost = 0;
    const routeTotals = new Map<string, number>();
    for (const s of g.snapshots) {
      for (const v of Object.values(s.ordersPerCorp)) {
        ordersTotal += v;
        orderObservations += 1;
      }
      shipped += s.cargoValueShipped;
      lost += s.cargoValueLost;
      gameShipped += s.cargoValueShipped;
      gameLost += s.cargoValueLost;
      raided += s.convoysRaided;
      launched += s.convoysLaunched;
      for (const k of RAID_KEYS) raidOutcomeDist[k] += s.raidOutcomes[k];
      for (const [rid, n] of Object.entries(s.routeTraffic)) {
        routeTotals.set(rid, (routeTotals.get(rid) ?? 0) + n);
      }
    }
    if (gameShipped > 0 && gameLost / gameShipped > 0.25) heavyRaidingGames += 1;
    routeGiniSum += gini([...routeTotals.values()]);

    // Valuations / pacing.
    const vals = Object.values(g.finalValuation).sort((a, b) => b - a);
    valuationGiniSum += gini(vals.map((v) => Math.max(0, v)));
    const median = vals.length ? vals[Math.floor(vals.length / 2)]! : 0;
    leaderMedianSum += median > 0 ? (vals[0] ?? 0) / median : 0;

    for (const t of Object.values(g.secondClaimTurn)) {
      if (t >= 0) { secondClaimSum += t; secondClaimCount += 1; }
    }
    for (const t of Object.values(g.range2Turn)) {
      if (t >= 0) { range2Sum += t; range2Count += 1; }
    }
    refundSum += g.auctionRefundFrac;
    fallbackSum += g.auctionFallbackUsage;

    // Late-game layers.
    acquisitionsSum += g.acquisitionsTotal;
    distressSum += g.distressLiquidations;
    freeOpsSum += g.finalFreeOperators;
    depotsSum += g.depotsBuilt;
    shipsSum += g.shipsBuilt;
    for (const s of g.snapshots) {
      if (s.turn > 0) { taxSum += s.taxLevied; taxObs += 1; }
    }
    for (let i = 0; i < stageOrder.length; i++) {
      const count = g.finalStageCounts[stageOrder[i] as keyof typeof g.finalStageCounts];
      ownedSystems += count;
      if (i > 0) grownSystems += count;
      if (count > 0) topStageIdx = Math.max(topStageIdx, i);
    }
  }

  const n = Math.max(1, games.length);
  for (const r of RESOURCES) {
    priceFinalAvg[r] = round2(priceFinalAvg[r] / n);
    priceVolatilityAvg[r] = round2(priceVolatilityAvg[r] / n);
    priceFloorHitFrac[r] = round2(priceFloorHitFrac[r] / n);
  }
  const raidOutcomeTotal = RAID_KEYS.reduce((s, k) => s + raidOutcomeDist[k], 0) || 1;
  for (const k of RAID_KEYS) raidOutcomeDist[k] = round2(raidOutcomeDist[k] / raidOutcomeTotal);

  const agg: Aggregate = {
    games: games.length,
    players,
    turns,
    priceFinalAvg,
    priceVolatilityAvg,
    priceFloorHitFrac,
    ordersPerPlayerPerTurn: round2(orderObservations ? ordersTotal / orderObservations : 0),
    pctCargoValueErased: round2(shipped ? (lost / shipped) * 100 : 0),
    pctGamesHeavyRaiding: round2((heavyRaidingGames / n) * 100),
    convoyRaidRate: round2(launched ? raided / launched : 0),
    raidOutcomeDist,
    routeTrafficGiniAvg: round2(routeGiniSum / n),
    valuationGiniAvg: round2(valuationGiniSum / n),
    leaderToMedianRatio: round2(leaderMedianSum / n),
    avgSecondClaimTurn: round2(secondClaimCount ? secondClaimSum / secondClaimCount : -1),
    avgRange2Turn: round2(range2Count ? range2Sum / range2Count : -1),
    auctionRefundFracAvg: round2(refundSum / n),
    auctionFallbackUsageAvg: round2(fallbackSum / n),
    acquisitionsPerGame: round2(acquisitionsSum / n),
    distressPerGame: round2(distressSum / n),
    freeOperatorsPerGame: round2(freeOpsSum / n),
    depotsPerGame: round2(depotsSum / n),
    shipsPerGame: round2(shipsSum / n),
    taxPerTurnAvg: round2(taxObs ? taxSum / taxObs : 0),
    populatedBeyondOutboundFrac: round2(ownedSystems ? grownSystems / ownedSystems : 0),
    topStageReached: stageOrder[topStageIdx]!,
    flags: [],
  };
  agg.flags = computeFlags(agg);
  return agg;
}

function computeFlags(a: Aggregate): RiskFlag[] {
  return [
    {
      name: "Metals price crash (overproduction)",
      triggered: a.priceFloorHitFrac.metals > 0.4,
      detail: `metals hit price floor in ${(a.priceFloorHitFrac.metals * 100).toFixed(0)}% of games`,
    },
    {
      name: "Overpowered raiding",
      triggered: a.pctCargoValueErased > 20 || a.pctGamesHeavyRaiding > 20,
      detail: `${a.pctCargoValueErased}% of shipped cargo value erased; ${a.pctGamesHeavyRaiding}% of games lost >25%`,
    },
    {
      name: "Trade UX fatigue",
      triggered: a.ordersPerPlayerPerTurn > 8,
      detail: `${a.ordersPerPlayerPerTurn} orders per player per turn`,
    },
    {
      name: "Warp chokepoint dominance",
      triggered: a.routeTrafficGiniAvg > 0.6,
      detail: `route-traffic Gini ${a.routeTrafficGiniAvg}`,
    },
    {
      name: "Run-away leader",
      triggered: a.valuationGiniAvg > 0.55 || a.leaderToMedianRatio > 4,
      detail: `valuation Gini ${a.valuationGiniAvg}, leader/median ${a.leaderToMedianRatio}`,
    },
    {
      name: "Takeover layer inert",
      triggered: a.acquisitionsPerGame < 0.1 && a.distressPerGame < 0.1,
      detail: `${a.acquisitionsPerGame} acquisitions + ${a.distressPerGame} liquidations per game`,
    },
    {
      name: "Food micromanagement burden",
      triggered: a.populatedBeyondOutboundFrac < 0.05,
      detail: `only ${(a.populatedBeyondOutboundFrac * 100).toFixed(0)}% of systems grew past Outpost (top ${a.topStageReached})`,
    },
  ];
}

export function renderMarkdown(aggs: Aggregate[]): string {
  const lines: string[] = [];
  lines.push("# Stellar Charters — Balance Summary\n");
  lines.push(
    "Headless all-bot simulation across swept seeds. Each block is a batch of games. " +
      "Flags map to the Section 21 design risks plus the late-game layers " +
      "(population/food, Trade Depots, debt/equity takeover, Free Operator).\n",
  );
  for (const a of aggs) {
    lines.push(`## ${a.players} players · ${a.games} games · ${a.turns} turns\n`);

    lines.push("### Risk flags");
    for (const f of a.flags) {
      lines.push(`- ${f.triggered ? "🔴 **FLAG**" : "🟢 ok"} — ${f.name}: ${f.detail}`);
    }
    lines.push("");

    lines.push("### Economy");
    lines.push("| Resource | Final price (avg) | Volatility (CoV) | Floor-hit games |");
    lines.push("| --- | ---: | ---: | ---: |");
    for (const r of RESOURCES) {
      lines.push(
        `| ${r} | ${a.priceFinalAvg[r]} | ${a.priceVolatilityAvg[r]} | ${(a.priceFloorHitFrac[r] * 100).toFixed(0)}% |`,
      );
    }
    lines.push("");

    lines.push("### Raiding balance");
    lines.push(`- Cargo value erased: **${a.pctCargoValueErased}%** of shipped value`);
    lines.push(`- Convoy raid rate: ${a.convoyRaidRate} (raided / launched)`);
    lines.push(`- Games with heavy raiding (>25% erased): ${a.pctGamesHeavyRaiding}%`);
    lines.push(
      `- Outcome mix: ` +
        RAID_KEYS.map((k) => `${k} ${(a.raidOutcomeDist[k] * 100).toFixed(0)}%`).join(", "),
    );
    lines.push("");

    lines.push("### Pacing & structure");
    lines.push(`- Orders per player per turn: ${a.ordersPerPlayerPerTurn}`);
    lines.push(`- Avg 2nd-claim turn: ${fmtTurn(a.avgSecondClaimTurn)}`);
    lines.push(`- Avg Range-2 turn: ${fmtTurn(a.avgRange2Turn)}`);
    lines.push(`- Route-traffic Gini: ${a.routeTrafficGiniAvg}`);
    lines.push(`- Valuation Gini: ${a.valuationGiniAvg}; leader/median ${a.leaderToMedianRatio}`);
    lines.push(`- Auction refund frac: ${a.auctionRefundFracAvg}; fallback usage ${a.auctionFallbackUsageAvg}`);
    lines.push("");

    lines.push("### Late game (population · depots · takeovers · free operators)");
    lines.push(`- Tax levied per turn (avg): ${a.taxPerTurnAvg}`);
    lines.push(
      `- Systems grown past Outpost: ${(a.populatedBeyondOutboundFrac * 100).toFixed(0)}% (top stage reached: ${a.topStageReached})`,
    );
    lines.push(`- Trade Depots built per game: ${a.depotsPerGame}; warships built per game: ${a.shipsPerGame}`);
    lines.push(`- Acquisitions per game: ${a.acquisitionsPerGame}; distress liquidations: ${a.distressPerGame}`);
    lines.push(`- Free Operators at game end (avg): ${a.freeOperatorsPerGame}`);
    lines.push("");
  }
  return lines.join("\n");
}

function fmtTurn(t: number): string {
  return t < 0 ? "never" : String(t);
}

function zeroRes(): Record<Resource, number> {
  return { ice: 0, metals: 0, helium3: 0, rareIsotopes: 0, food: 0 };
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
