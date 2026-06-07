/**
 * Core data model for the Stellar Charters simulation.
 *
 * Everything here is plain data (interfaces + unions) so the engine stays pure
 * and portable: the same types will be imported by the future web app.
 */

/**
 * Resource economy (Section 07). Credits is tracked on the corporation, not in stockpiles.
 *
 * Commodities sit in three tiers (Section 07b — Processing & Production Chains):
 *  - Raw, extracted from system yields: ice, metals, silicates, helium3, rareIsotopes, antimatter.
 *  - Manufactured by Processor buildings: food, fuel, alloys, polymers, components.
 * The chains are short but tightly coupled (ice and helium3 each feed several products), so a
 * squeeze on one feedstock ripples across many markets. Antimatter is the premium deep-frontier
 * raw: ultra-high value, very low volume — the monopoly prize and the input to capital hulls.
 * Power is NOT a resource: it is a non-tradable per-system utility (see System.reactors).
 */
export type Resource =
  | "ice"
  | "metals"
  | "silicates"
  | "helium3"
  | "rareIsotopes"
  | "food"
  | "fuel"
  | "alloys"
  | "polymers"
  | "components"
  | "antimatter";

export const RESOURCES: readonly Resource[] = [
  "ice",
  "metals",
  "silicates",
  "helium3",
  "rareIsotopes",
  "food",
  "fuel",
  "alloys",
  "polymers",
  "components",
  "antimatter",
];

/** A per-resource quantity map. */
export type Stockpile = Record<Resource, number>;

export function emptyStockpile(): Stockpile {
  return {
    ice: 0,
    metals: 0,
    silicates: 0,
    helium3: 0,
    rareIsotopes: 0,
    food: 0,
    fuel: 0,
    alloys: 0,
    polymers: 0,
    components: 0,
    antimatter: 0,
  };
}

/** Population stages (Section 08). The 12-turn slice mostly lives at Outpost/Settlement. */
export type PopulationStage =
  | "outpost"
  | "settlement"
  | "colony"
  | "city"
  | "metropolis";

/**
 * Ship range tiers (Section 04). The ladder climbs from inner-ring skiffs (Range 1) to
 * deep-galaxy capital hulls (Range 8): higher tiers reach the longest, most exposed warp
 * tunnels and field progressively stronger ships.
 */
export type RangeTier = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/** The deepest range tier a corporation can research/field. */
export const MAX_RANGE_TIER: RangeTier = 8;

/** Spatial region a system belongs to, from the protected core out to the deep abyss. */
export type SystemRegion = "hub" | "core" | "frontier" | "abyss";

/**
 * A system's place on the galaxy atlas. Carried through to the client so the map renders
 * the same organic layout the generator produced (rather than recomputing a radial guess).
 * `x`/`y` are in an arbitrary world space centred on the hub; the renderer fits the camera.
 * `visualSeed` lets the renderer vary a system's glyph deterministically.
 */
export interface SystemPosition {
  x: number;
  y: number;
  region: SystemRegion;
  visualSeed: number;
}

/**
 * Stellar classification (Section 21 — Star System Resource Model). The star a system orbits
 * sets the habitable-zone geometry, biases which planets/deposits generate, and drives the
 * time-varying stellar dynamics in production (red giants scorch inner worlds, neutron stars
 * pulse, flare stars knock extractors offline).
 */
export type StarType =
  | "mainSequence"
  | "redDwarf"
  | "redGiant"
  | "blueGiant"
  | "whiteDwarf"
  | "neutronStar";

export const STAR_TYPES: readonly StarType[] = [
  "mainSequence",
  "redDwarf",
  "redGiant",
  "blueGiant",
  "whiteDwarf",
  "neutronStar",
];

/** Planet taxonomy (Section 21). Drives which deposits a body carries and whether it can host life. */
export type PlanetType =
  | "lava"
  | "rocky"
  | "desert"
  | "ocean"
  | "gasGiant"
  | "iceGiant"
  | "barren";

export const PLANET_TYPES: readonly PlanetType[] = [
  "lava",
  "rocky",
  "desert",
  "ocean",
  "gasGiant",
  "iceGiant",
  "barren",
];

/**
 * A single extractable resource concentration on one body (Section 21). The static, generated
 * shape: `richness` is units/turn a maxed extractor pulls, `reserves` is the finite total
 * (null = renewable and never depletes), `accessibility` (0..1) is how hard it is to work
 * (gates the extractor investment / value).
 */
export interface Deposit {
  resource: Resource;
  richness: number;
  reserves: number | null;
  accessibility: number;
}

/** A planet orbiting the star, in orbital order (0 = innermost). */
export interface Planet {
  type: PlanetType;
  /** Orbital slot, 0 = innermost; strictly increasing across a system's bodies + belts. */
  orbit: number;
  /** Sits within the star's habitable zone (gates native population growth, Section 21). */
  habitable: boolean;
  /** Deterministic per-body cosmetic variation for the renderer. */
  visualSeed: number;
  deposits: Deposit[];
}

/** A debris/ore belt; always placed between the inner rocky zone and the first gas giant. */
export interface AsteroidBelt {
  orbit: number;
  deposits: Deposit[];
}

/** The astrophysical contents of a system (Section 21). Generated deterministically per seed. */
export interface SystemBodies {
  starType: StarType;
  planets: Planet[];
  asteroidBelts: AsteroidBelt[];
  /** Exotic harvest from the star itself (neutron stars / white dwarfs only). */
  starDeposits?: Deposit[];
}

/** Which kind of body a site sits on (for labels, habitability, and extractor rules). */
export type BodyKind = "planet" | "belt" | "star";

/**
 * The mutable runtime form of a {@link Deposit}: a workable extraction site on a body
 * (Section 21). The Galaxy expands each generated deposit (or legacy yield shortcut) into a
 * site. `extractorLevel` 0 means unworked (no output); building extractors raises it.
 * `reservesRemaining` depletes as the site is mined (null = renewable). `disabledUntil` is the
 * first turn the site is online again after sabotage / a stellar outage. `prospected` is true
 * once the deposit is worked or its system surveyed (knows exact richness/reserves; otherwise only a coarse hint).
 */
export interface ExtractionSite {
  /** Stable key, e.g. "planet:2:metals", "belt:0:silicates", "star:antimatter". */
  key: string;
  bodyKind: BodyKind;
  bodyType: PlanetType | "belt" | "star";
  bodyLabel: string;
  orbit: number;
  /** True if this site sits on a habitable body. */
  habitable: boolean;
  resource: Resource;
  richness: number;
  reservesRemaining: number | null;
  accessibility: number;
  extractorLevel: number;
  prospected: boolean;
  /** Site is offline until this turn (sabotage / stellar event); 0 = online. */
  disabledUntil: number;
}

/**
 * Megastructures (Section 22 — Grand Construction). Enormous, metal-hungry constructs an
 * established charter sinks its overproduced metals/alloys into: an orbital station (defense +
 * prestige), a space elevator (cheaper logistics → faster growth), and the apex ringworld
 * (a vast artificial habitat). They are the demand floor that keeps the metals market off the
 * floor, and a late-game valuation race. At most one of each per system, gated by population.
 */
export type MegastructureKind = "orbitalStation" | "spaceElevator" | "ringworld";

export const MEGASTRUCTURE_KINDS: readonly MegastructureKind[] = [
  "orbitalStation",
  "spaceElevator",
  "ringworld",
];

/**
 * The buildings on a single planet/belt (Section 24). Re-homed from the system: factories run the
 * production chains, reactors + power grid supply power, agri-domes make food, and the raw-fed
 * upgrade tracks harden/grow the body. Construction is per-body; the system aggregates the totals.
 */
export interface BodyBuildings {
  /** Processor (factory) modules by recipe id (each runs one chain recipe per turn, Section 07b). */
  processors: Record<string, number>;
  /** Reactor modules (each adds power capacity, burns helium3). */
  reactors: number;
  /** Hydroponic (agri-dome) modules (each adds food production). */
  hydroponics: number;
  /** Mining-rig upgrade level (metals-fed): fortification / upkeep (Section 07c). */
  miningRigs: number;
  /** Habitat upgrade level (silicates-fed): population growth + tax (Section 07c). */
  habitats: number;
  /** Power-grid upgrade level (helium3-fed): local power capacity (Section 07c). */
  powerGrid: number;
  /** Research Lab modules (each produces research points per turn, Section 28). */
  labs: number;
}

export function emptyBodyBuildings(): BodyBuildings {
  return { processors: {}, reactors: 0, hydroponics: 0, miningRigs: 0, habitats: 0, powerGrid: 0, labs: 0 };
}

/** Per-colony population (Section 24, Phase 4b): each habitable / agri-domed body grows its own
 *  population, feeds from the shared system stockpile, and pays its own tax. */
export interface ColonyPopulation {
  stage: PopulationStage;
  /** Progress (0..growthThreshold) toward the next stage. */
  progress: number;
  /** Social unrest (0..1) from starvation on this body. */
  unrest: number;
}

export function emptyColonyPopulation(): ColonyPopulation {
  return { stage: "outpost", progress: 0, unrest: 0 };
}

/** The building kinds that run through a colony's construction queue (Section 24, Phase 4a). System
 *  structures (platforms, depot, megastructures) and per-site extractors stay instant-on-affordability. */
export type QueueBuildingKind = "factory" | "reactor" | "agridome" | "mining" | "habitat" | "power" | "lab";

/** One item in a colony's build queue. Credits + resources are charged when the item is *queued*;
 *  the building materialises once `cpDone` reaches `cpCost`, gated by the colony's construction rate. */
export interface QueueItem {
  kind: QueueBuildingKind;
  /** Recipe id for a factory (`kind === "factory"`). */
  recipeId?: string;
  /** Construction points required to finish (Section 24). */
  cpCost: number;
  /** Construction points accumulated so far. */
  cpDone: number;
}

export interface System {
  id: string;
  name: string;
  /**
   * Legacy/authoring shortcut: a flat per-turn extraction vector. When a scenario authors this
   * (tests, hand-made maps), the Galaxy lowers it into always-on, infinite, fully-accessible
   * extraction sites — so the flat model is the degenerate case of the body-driven economy
   * (Section 21). Procedural maps leave this empty and author `bodies` instead.
   */
  yields: Stockpile;
  /** Generated astrophysical contents (Section 21); absent on legacy authored maps. */
  bodies?: SystemBodies;
  /** Runtime extraction sites — the live, mutable resource economy of this system (Section 21). */
  sites: ExtractionSite[];
  claimCost: number;
  upkeep: number;
  /**
   * System-level population AGGREGATE (Section 24, Phase 4b): the highest stage / its progress /
   * peak unrest across the system's populated colonies (`colonyPop`). Kept for valuation,
   * megastructure gating, and the system pop-meter; the authoritative per-body state is `colonyPop`.
   */
  populationStage: PopulationStage;
  /** Progress (0..100) toward the next population stage of the leading colony (Section 08). */
  populationProgress: number;
  /** Peak social unrest across the system's colonies (0..1); lowers tax and production. */
  unrest: number;
  /**
   * Per-body population (Section 24, Phase 4b): bodyKey → its colony's stage/progress/unrest. Only
   * habitable bodies (or those with an agri-dome) appear here; pure-industrial worlds host no people.
   */
  colonyPop: Record<string, ColonyPopulation>;
  /**
   * Buildings, owned per-body (Section 24): each planet/belt keyed by its body key
   * ("planet:2", "belt:0", "star:0") holds its own factories/reactors/agri-domes/upgrades. The
   * system aggregates these (shared stockpile + pooled power), but construction is per-body.
   */
  bodyBuildings: Record<string, BodyBuildings>;
  /**
   * Per-body construction queues (Section 24, Phase 4a): each body key maps to its FIFO list of
   * pending builds. A colony pours `construction.pointsPerTurn` into the front item each turn; when
   * it finishes, the building lands in `bodyBuildings` and the leftover points roll to the next item.
   */
  buildQueues: Record<string, QueueItem[]>;
  /** Number of stationary defense platforms built here (each adds raid defense). */
  platforms: number;
  /** Megastructures built here (Section 22) — the metals/alloys demand sink + valuation race. */
  megastructures: MegastructureKind[];
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
  /** Atlas coordinates / region (procedural scenarios carry this; legacy JSON may omit it). */
  position?: SystemPosition;
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

/**
 * A warship in transit between systems (Section 23 — mobile fleets). Ships ordered to move travel
 * along charted routes over turns, exactly like a convoy. While in transit a ship's `stationedAt`
 * is "" so it neither defends nor escorts. On arriving at a non-allied rival system it gives
 * battle (an invasion); arriving anywhere else it simply re-bases.
 */
export interface ShipTransit {
  /** Ordered system ids from origin to destination. */
  path: string[];
  /** Route ids connecting consecutive systems in `path`. */
  routeIds: string[];
  /** Index in `path` of the last system reached. */
  position: number;
  /** Turns remaining on the current route segment. */
  segmentTurnsLeft: number;
  /** Turn the move was ordered (a fleet does not advance on its launch turn). */
  launchedTurn: number;
  /** Destination is a non-allied rival system → resolve a battle on arrival. */
  attack: boolean;
  /** Survey vessel only (Section 25): system to fly home to after surveying the destination. */
  surveyReturnTo?: string;
}

export interface Ship {
  rangeTier: RangeTier;
  /** Raiding/escort combat strength; 0 for pure cargo/survey ships. */
  combat: number;
  /** True if this ship can perform interdiction/raids. */
  raider: boolean;
  /** System this ship is based at (defends it and escorts its convoys); "" while in transit. */
  stationedAt: string;
  /** An unarmed survey vessel (Section 25): scouts a target system, then returns. Never fights. */
  surveyor?: boolean;
  /** Movement state when the ship is travelling between systems (Section 23). */
  transit?: ShipTransit;
}

/** A charter's research state (Section 28). RP flows into `queue[0]` each turn; finished techs move to
 *  `completed`; leftover RP banks when the queue is empty. */
export interface CorpResearch {
  /** Completed tech ids (their effects are live). */
  completed: string[];
  /** Ordered active+pending tech ids; `queue[0]` is the active project. */
  queue: string[];
  /** Research points invested so far into each in-progress tech. */
  invested: Record<string, number>;
  /** Unspent research points (rolls over when the queue is empty). */
  banked: number;
}

export function emptyCorpResearch(): CorpResearch {
  return { completed: [], queue: [], invested: {}, banked: 0 };
}

export interface Privateer {
  /** System id whose adjacent routes this privateer can reach. */
  basedAt: string;
  strength: number;
  /** Turns of contract remaining. */
  turnsLeft: number;
}

/**
 * An active war between charters (Section 23). Declared by the aggressor's first invasion of a
 * non-hostile rival; the aggressor is locked out of the Galactic Exchange until `endTurn`. Each
 * new act of aggression in the war pushes `endTurn` out; once it passes, a ceasefire ends the war.
 */
export interface War {
  aggressorId: string;
  defenderId: string;
  startTurn: number;
  /** First turn on which the war is over (a ceasefire) unless aggression refreshes it. */
  endTurn: number;
}

export interface Corporation {
  id: string;
  name: string;
  credits: number;
  debt: number;
  ownedSystemIds: string[];
  ships: Ship[];
  privateers: Privateer[];
  /** Systems this charter has scouted with a survey vessel (Section 25): grants full deposit intel
   *  (richness + reserves) on them, even in rival territory. Owned systems are always fully known. */
  surveyedSystemIds: string[];
  /** Research progress (Section 28): completed techs, the active+queued projects, and banked RP. */
  research: CorpResearch;
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
  /** Charters this corp has pledged to defend (Section 23). Allied iff the pledge is mutual. */
  alliancePledges: string[];
  /** Accumulated grievance per rival (Section 23) from being raided/sabotaged/invaded — biases
   *  this corp toward retaliating against those who wronged it. Decays over time. */
  grudges: Record<string, number>;
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
  /** Owned system to base the ship at. */
  systemId: string;
}

/** Terraform a non-habitable owned world so it can host a population (Section 28, Phase 2). Requires
 *  the Terraforming research. */
export interface TerraformOrder {
  kind: "terraform";
  systemId: string;
  bodyKey: string;
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
  /** Planet/belt to build on (Section 24); defaults to the system's primary body if omitted. */
  bodyKey?: string;
}

export interface BuildProcessorOrder {
  kind: "buildProcessor";
  systemId: string;
  /** Id of the recipe (Tuning.recipes) this processor runs. */
  recipeId: string;
  /** Planet/belt to build on (Section 24); defaults to the system's primary body if omitted. */
  bodyKey?: string;
}

export interface BuildReactorOrder {
  kind: "buildReactor";
  systemId: string;
  /** Planet/belt to build on (Section 24); defaults to the system's primary body if omitted. */
  bodyKey?: string;
}

export interface UpgradeInfrastructureOrder {
  kind: "upgradeInfrastructure";
  systemId: string;
  /** Which raw-fed upgrade track to advance one level (Section 07c). */
  track: "mining" | "habitat" | "power";
  /** Planet/belt to upgrade (Section 24); defaults to the system's primary body if omitted. */
  bodyKey?: string;
}

export interface BuildPlatformOrder {
  kind: "buildPlatform";
  systemId: string;
}

/** Build a Research Lab on a colony (Section 28): produces research points each turn. */
export interface BuildLabOrder {
  kind: "buildLab";
  systemId: string;
  /** Planet/belt to build on (Section 24); defaults to the system's primary body if omitted. */
  bodyKey?: string;
}

/** Set the charter's research queue (Section 28): the ordered list of tech ids to pursue, active first. */
export interface SetResearchOrder {
  kind: "setResearch";
  queue: string[];
}

/** Build a megastructure on an owned system (Section 22): a huge metals/alloys sink. */
export interface BuildMegastructureOrder {
  kind: "buildMegastructure";
  systemId: string;
  structure: MegastructureKind;
}

/** Build (or upgrade) the extractor working one of a system's deposits (Section 21). */
export interface BuildExtractorOrder {
  kind: "buildExtractor";
  systemId: string;
  /** ExtractionSite.key identifying the deposit to work. */
  siteKey: string;
}

/** Knock a rival system's extractor offline for several turns (Section 21 economic warfare). */
export interface SabotageOrder {
  kind: "sabotage";
  systemId: string;
  siteKey: string;
}

/** Invade a rival-owned system to capture it — declares war (Section 23). */
export interface InvadeOrder {
  kind: "invade";
  systemId: string;
}

/**
 * Mobilise a warfleet (Section 23): restation a combat ship from one owned system to another,
 * concentrating force for an invasion or reinforcing a threatened defense. Moves the strongest
 * combat ship at `fromSystemId`.
 */
export interface RedeployShipOrder {
  kind: "redeployShip";
  fromSystemId: string;
  toSystemId: string;
}

/**
 * Move a fleet across the galaxy (Section 23 — mobile fleets). Sends every combat ship currently
 * at `fromSystemId` travelling along the cheapest charted path to `toSystemId` (transit takes
 * turns). Passage through other charters' territory is peaceful; arriving at a non-allied rival's
 * system gives battle (an invasion), capturing it on a win or falling back on a loss.
 */
export interface MoveFleetOrder {
  kind: "moveFleet";
  fromSystemId: string;
  toSystemId: string;
}

/** Build a survey vessel — an unarmed scout — at an owned system (Section 25). */
export interface BuildSurveyShipOrder {
  kind: "buildSurveyShip";
  systemId: string;
}

/**
 * Dispatch an idle survey vessel from `fromSystemId` to scout `targetSystemId` (Section 25). It
 * travels the cheapest charted path, surveys the whole target system on arrival (revealing every
 * deposit's richness + reserves to this charter, even in rival territory), then returns home.
 */
export interface SurveySystemOrder {
  kind: "surveySystem";
  fromSystemId: string;
  targetSystemId: string;
}

/** Pledge a mutual defensive alliance with another charter (Section 23). Allied only once
 *  both charters have pledged each other. */
export interface AlliancePledgeOrder {
  kind: "alliancePledge";
  targetId: string;
}

/** Withdraw a defensive-alliance pledge (Section 23). */
export interface AllianceBreakOrder {
  kind: "allianceBreak";
  targetId: string;
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
  | TerraformOrder
  | HirePrivateerOrder
  | InterdictOrder
  | TargetConvoyOrder
  | EscortOrder
  | BuildDepotOrder
  | BuildHydroponicsOrder
  | BuildProcessorOrder
  | BuildReactorOrder
  | UpgradeInfrastructureOrder
  | BuildPlatformOrder
  | BuildLabOrder
  | SetResearchOrder
  | BuildMegastructureOrder
  | BuildExtractorOrder
  | SabotageOrder
  | InvadeOrder
  | RedeployShipOrder
  | MoveFleetOrder
  | BuildSurveyShipOrder
  | SurveySystemOrder
  | AlliancePledgeOrder
  | AllianceBreakOrder
  | BuySharesOrder
  | BorrowOrder;
