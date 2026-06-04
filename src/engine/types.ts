/**
 * Core data model for the Stellar Charters simulation.
 *
 * Everything here is plain data (interfaces + unions) so the engine stays pure
 * and portable: the same types will be imported by the future web app.
 */

/** Six-resource economy (Section 07). Credits is tracked on the corporation, not in stockpiles. */
export type Resource = "ice" | "metals" | "helium3" | "rareIsotopes" | "food";

export const RESOURCES: readonly Resource[] = [
  "ice",
  "metals",
  "helium3",
  "rareIsotopes",
  "food",
];

/** A per-resource quantity map. */
export type Stockpile = Record<Resource, number>;

export function emptyStockpile(): Stockpile {
  return { ice: 0, metals: 0, helium3: 0, rareIsotopes: 0, food: 0 };
}

/** Population stages (Section 08). The 12-turn slice mostly lives at Outpost/Settlement. */
export type PopulationStage =
  | "outpost"
  | "settlement"
  | "colony"
  | "city"
  | "metropolis";

/** Ship range tiers (Section 04). The slice uses Range 1 and Range 2. */
export type RangeTier = 1 | 2 | 3 | 4;

export interface System {
  id: string;
  name: string;
  /** Per-turn extraction yields by resource. */
  yields: Stockpile;
  claimCost: number;
  upkeep: number;
  populationStage: PopulationStage;
  /** Progress (0..100) toward the next population stage (Section 08). */
  populationProgress: number;
  /** Social unrest (0..1) from starvation; lowers tax and production. */
  unrest: number;
  /** Number of hydroponic modules built (each adds food production). */
  hydroponics: number;
  /** True if a Trade Depot has been built here (Section 12). */
  hasDepot: boolean;
  /** Defensive strength against raids at this system's tunnel mouths. */
  defense: number;
  /** Ids of warp routes incident to this system. */
  routeIds: string[];
  /** Owner corporation id, or null if unclaimed. */
  owner: string | null;
  /** Locally stored goods (Section 07: stockpiles are local, not global). */
  stockpile: Stockpile;
  /** True for inner-ring systems offered in the opening auction. */
  innerRing: boolean;
}

export interface WarpRoute {
  id: string;
  a: string;
  b: string;
  transitTime: number;
  /** 0..1, higher is more stable (less delay/fuel/raid opportunity). */
  stability: number;
  /** Throughput before congestion penalties. */
  capacity: number;
  /** 0..1, how easy it is for raiders to intercept here. */
  exposure: number;
  /** 0..1, legal risk of raiding; high near the Hub, low on the frontier. */
  authorityPresence: number;
  /** Minimum range tier required to traverse this route. */
  requiredRange: RangeTier;
  /** Known at start (inner ring) vs. requiring survey. */
  charted: boolean;
  /** Count of convoys that traversed this route per recent turn (rolling). */
  trafficHistory: number[];
}

export type ConvoyKind = "buy" | "sell" | "transfer";

export interface Convoy {
  id: string;
  owner: string;
  kind: ConvoyKind;
  resource: Resource;
  quantity: number;
  /** Ordered system ids from origin to destination. */
  path: string[];
  /** Ordered route ids connecting consecutive systems in `path`. */
  routeIds: string[];
  /** Index of the system in `path` the convoy currently sits at. */
  position: number;
  /** Turns remaining on the current route segment. */
  segmentTurnsLeft: number;
  /** Turn on which this convoy launched (newly launched convoys do not advance same turn). */
  launchedTurn: number;
  /** Credits to be paid to the owner on arrival (sell orders). */
  payout: number;
  /** Escort strength accompanying the convoy (reduces raid success). */
  escort: number;
  /** Estimated cargo value, used by raiders to prioritise targets. */
  value: number;
}

export interface Ship {
  rangeTier: RangeTier;
  /** Raiding/escort combat strength; 0 for pure cargo/survey ships. */
  combat: number;
  /** True if this ship can perform interdiction/raids. */
  raider: boolean;
}

export interface Privateer {
  /** System id whose adjacent routes this privateer can reach. */
  basedAt: string;
  strength: number;
  /** Turns of contract remaining. */
  turnsLeft: number;
}

export interface Corporation {
  id: string;
  name: string;
  credits: number;
  debt: number;
  ownedSystemIds: string[];
  ships: Ship[];
  privateers: Privateer[];
  /** Best range tier the corporation can field (from research/licensing). */
  rangeTier: RangeTier;
  /** Latest computed valuation (Section 17). */
  valuation: number;
  /** Latest per-share price = valuation / sharesOutstanding. */
  sharePrice: number;
  /** Total shares issued by this corporation (constant). */
  sharesOutstanding: number;
  /** Who holds this corporation's shares: holderCorpId -> share count. */
  shareRegister: Record<string, number>;
  /** Original controlling player's id (the founder block holder). */
  founderId: string;
  /** Recent per-turn net earnings, for valuation momentum (Section 17). */
  recentEarnings: number[];
  /** True once the corporation has lost/sold its charter (Section 18). */
  isFreeOperator: boolean;
  /** Bot strategy id controlling this corporation. */
  botId: string;
  /** True once the corporation holds at least one charter claim. */
  hasCharter: boolean;
}

// ----- Orders (discriminated union) -----

export interface BidOrder {
  kind: "bid";
  /** Priority-ordered fallback bids; at most one wins (Section 05). */
  priorities: { systemId: string; amount: number }[];
}

export interface MarketOrder {
  kind: "market";
  side: "buy" | "sell";
  resource: Resource;
  quantity: number;
  /** Buy: max price willing to pay. Sell: min price willing to accept. */
  limitPrice: number;
  /** Owned system: destination for buys, origin for sells. */
  systemId: string;
  /** If true, fails when price condition is unmet; if false, fills at market. */
  strict: boolean;
}

export interface TransferOrder {
  kind: "transfer";
  resource: Resource;
  quantity: number;
  fromSystemId: string;
  toSystemId: string;
}

export interface ClaimOrder {
  kind: "claim";
  systemId: string;
  amount: number;
}

export interface SurveyOrder {
  kind: "survey";
  /** Route to chart so deeper systems become reachable. */
  routeId: string;
}

export interface BuildShipOrder {
  kind: "buildShip";
  rangeTier: RangeTier;
  raider: boolean;
}

export interface ResearchRangeOrder {
  kind: "researchRange";
  targetTier: RangeTier;
}

export interface HirePrivateerOrder {
  kind: "hirePrivateer";
  basedAt: string;
}

export interface InterdictOrder {
  kind: "interdict";
  routeId: string;
}

export interface TargetConvoyOrder {
  kind: "targetConvoy";
  convoyId: string;
}

export interface EscortOrder {
  kind: "escort";
  /** System whose outbound convoys this escort protects this turn. */
  systemId: string;
  strength: number;
}

export interface BuildDepotOrder {
  kind: "buildDepot";
  systemId: string;
}

export interface BuildHydroponicsOrder {
  kind: "buildHydroponics";
  systemId: string;
}

export interface BuySharesOrder {
  kind: "buyShares";
  targetId: string;
  shares: number;
}

export interface BorrowOrder {
  kind: "borrow";
  amount: number;
}

export type Order =
  | BidOrder
  | MarketOrder
  | TransferOrder
  | ClaimOrder
  | SurveyOrder
  | BuildShipOrder
  | ResearchRangeOrder
  | HirePrivateerOrder
  | InterdictOrder
  | TargetConvoyOrder
  | EscortOrder
  | BuildDepotOrder
  | BuildHydroponicsOrder
  | BuySharesOrder
  | BorrowOrder;
