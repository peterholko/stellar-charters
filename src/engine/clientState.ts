/**
 * Server-authoritative client state (fog of war, Section 11).
 *
 * `buildClientState` turns the live authoritative engine into a plain-JSON snapshot for
 * one player: full detail for the player's own corporation, public summaries for rivals,
 * and redacted convoys (rivals' exact cargo / escort / payout are hidden). The web client
 * reconstructs a read-only view from this — it never sees data the player shouldn't.
 */
import type { Engine } from "./engine.js";
import type { TurnReport } from "./report.js";
import {
  RESOURCES,
  type BodyBuildings,
  type BodyKind,
  type ColonyPopulation,
  type QueueItem,
  type MegastructureKind,
  type PlanetType,
  type War,
  type PopulationStage,
  type Privateer,
  type RangeTier,
  type Resource,
  type Ship,
  type StarType,
  type Stockpile,
  type SystemPosition,
} from "./types.js";
import { systemBuildings } from "./bodies.js";

export type GamePhase = "play" | "over";

/** Deep-copy a per-body building map so the client snapshot never aliases live engine state. */
function cloneBodyBuildings(bb: Record<string, BodyBuildings>): Record<string, BodyBuildings> {
  const out: Record<string, BodyBuildings> = {};
  for (const [key, b] of Object.entries(bb)) {
    out[key] = { ...b, processors: { ...b.processors } };
  }
  return out;
}

/** Deep-copy a per-body construction queue so the client snapshot never aliases live engine state. */
function cloneBuildQueues(q: Record<string, QueueItem[]>): Record<string, QueueItem[]> {
  const out: Record<string, QueueItem[]> = {};
  for (const [key, items] of Object.entries(q)) out[key] = items.map((it) => ({ ...it }));
  return out;
}

/** A human seat in a (possibly shared) game. */
export interface ClientPlayer {
  corpId: string;
  name: string;
  isYou: boolean;
  /** Whether this player has submitted orders for the upcoming turn. */
  submitted: boolean;
}

/**
 * One extraction site as seen by a client (Section 21 fog of war). Operational state (what is
 * being worked, what's offline) is public; `richness` is hidden until the deposit is surveyed
 * (prospected), and `reservesRemaining` (depletion intel) is owner-only.
 */
export interface ClientSite {
  key: string;
  bodyKind: BodyKind;
  bodyType: PlanetType | "belt" | "star";
  bodyLabel: string;
  orbit: number;
  habitable: boolean;
  resource: Resource;
  accessibility: number;
  extractorLevel: number;
  disabledUntil: number;
  prospected: boolean;
  /** Revealed only once surveyed; null = unsurveyed (richness unknown). */
  richness: number | null;
  /** Owner-only remaining reserves; null for rivals / renewable / unsurveyed. */
  reservesRemaining: number | null;
}

export interface ClientSystem {
  id: string;
  name: string;
  /** Legacy flat-yield shortcut — only present for authored maps; body-driven systems omit it
   *  (their economy is in `sites`), which keeps the per-poll payload compact. */
  yields?: Stockpile;
  /** The system's star (Section 21), for rendering + stellar forecasts. */
  starType?: StarType;
  /** The system's worlds in orbital order (Section 21) — public geology (type/orbit/habitability). */
  planets: { type: PlanetType; orbit: number; habitable: boolean }[];
  /** Asteroid belts, by orbital slot (Section 21). */
  asteroidBelts: { orbit: number }[];
  /** Fogged extraction sites — the system's resource economy (Section 21). */
  sites: ClientSite[];
  claimCost: number;
  upkeep: number;
  defense: number;
  innerRing: boolean;
  owner: string | null;
  populationStage: PopulationStage;
  /** Per-body building map (Section 24): bodyKey → counts. The colony screen renders from this. */
  bodyBuildings: Record<string, BodyBuildings>;
  /** Per-body construction queues (Section 24, Phase 4a): bodyKey → pending builds with progress. */
  buildQueues: Record<string, QueueItem[]>;
  /** Per-body population (Section 24, Phase 4b): bodyKey → stage/progress/unrest for populated worlds. */
  colonyPop: Record<string, ColonyPopulation>;
  /** System-wide aggregate of hydroponics across all bodies — convenience for compact UI badges. */
  hydroponics: number;
  platforms: number;
  /** Megastructures built here (Section 22). */
  megastructures: MegastructureKind[];
  hasDepot: boolean;
  routeIds: string[];
  /** Atlas coordinates / region for map rendering (procedural scenarios). */
  position?: SystemPosition;
  /** Owner-only: progress / unrest / local stockpile (null for systems you don't own). */
  populationProgress: number | null;
  unrest: number | null;
  stockpile: Stockpile | null;
}

export interface ClientRoute {
  id: string;
  a: string;
  b: string;
  transitTime: number;
  stability: number;
  capacity: number;
  exposure: number;
  authorityPresence: number;
  requiredRange: RangeTier;
  charted: boolean;
  trafficHistory: number[];
}

export interface ClientCorp {
  id: string;
  name: string;
  valuation: number;
  sharePrice: number;
  sharesOutstanding: number;
  rangeTier: RangeTier;
  ownedSystemIds: string[];
  shareRegister: Record<string, number>;
  isFreeOperator: boolean;
  hasCharter: boolean;
  founderId: string;
  /** Charters this corp has pledged to defend (Section 23). Allied iff mutual. */
  alliancePledges: string[];
  /** Self-only fields (undefined for rivals). */
  credits?: number;
  debt?: number;
  ships?: Ship[];
  privateers?: Privateer[];
  recentEarnings?: number[];
  /** Systems this charter has scouted with a survey vessel (Section 25); self-only. */
  surveyedSystemIds?: string[];
}

export interface ClientConvoy {
  id: string;
  owner: string;
  kind: "buy" | "sell" | "transfer";
  resource: Resource;
  path: string[];
  routeIds: string[];
  position: number;
  segmentTurnsLeft: number;
  launchedTurn: number;
  value: number;
  /** Owner-only (0 for rivals — redacted). */
  quantity: number;
  escort: number;
  payout: number;
}

export interface ClientState {
  gameId: string;
  /** Id of the scenario this game was built from (e.g. "procedural-atlas-v1"). */
  scenarioId: string;
  turn: number;
  phase: GamePhase;
  totalTurns: number;
  /** The corporation this client controls (its perspective for fog of war). */
  humanCorpId: string;
  prices: Record<Resource, number>;
  systems: ClientSystem[];
  routes: ClientRoute[];
  corps: ClientCorp[];
  convoys: ClientConvoy[];
  /** Active wars between charters (Section 23). */
  wars: War[];
  /** Exchange tariff you (the viewing charter) pay as a war aggressor; 0 if not at war. */
  warTariff: number;
  reports: TurnReport[];
  // ----- multiplayer / lobby (filled by the server) -----
  /** This client's seat, or null if it hasn't joined. */
  mySeat: string | null;
  /** True if this client can start the match (lobby host). */
  isHost: boolean;
  /** Human seats in the game. */
  players: ClientPlayer[];
  /** Total seats (humans + bots). */
  totalSeats: number;
  /** How many human seats have submitted for the upcoming turn. */
  submittedCount: number;
}

export function gamePhase(engine: Engine): GamePhase {
  return engine.isOver ? "over" : "play";
}

export function buildClientState(
  engine: Engine,
  humanCorpId: string,
  gameId: string,
  reports: TurnReport[],
): ClientState {
  const g = engine.galaxy;
  const me = engine.corps.find((c) => c.id === humanCorpId);
  const owned = new Set(me?.ownedSystemIds ?? []);
  const surveyed = new Set(me?.surveyedSystemIds ?? []);

  const systems: ClientSystem[] = g.allSystems().map((s) => {
    const mine = s.owner === humanCorpId || owned.has(s.id);
    // A survey vessel (Section 25) grants full deposit intel on a system — richness AND reserves —
    // even in rival territory. Owning it, or its deposits being publicly worked, also reveals.
    const scouted = mine || surveyed.has(s.id);
    const sites: ClientSite[] = s.sites.map((site) => ({
      key: site.key,
      bodyKind: site.bodyKind,
      bodyType: site.bodyType,
      bodyLabel: site.bodyLabel,
      orbit: site.orbit,
      habitable: site.habitable,
      resource: site.resource,
      accessibility: site.accessibility,
      extractorLevel: site.extractorLevel,
      disabledUntil: site.disabledUntil,
      prospected: site.prospected || scouted,
      // Fog of war: richness is public once a deposit is worked/assayed, or known if you own/scouted
      // the system; reserves (depletion intel) stay private — only the owner or a surveyor sees them.
      richness: site.prospected || scouted ? site.richness : null,
      reservesRemaining: scouted ? site.reservesRemaining : null,
    }));
    // Only ship the flat yields for legacy/authored systems; body-driven systems render from
    // `sites` and would otherwise waste an all-zero 11-key object per system, every poll.
    const hasFlatYields = RESOURCES.some((r) => s.yields[r] !== 0);
    return {
      id: s.id,
      name: s.name,
      yields: hasFlatYields ? { ...s.yields } : undefined,
      starType: s.bodies?.starType,
      planets: s.bodies?.planets.map((p) => ({ type: p.type, orbit: p.orbit, habitable: p.habitable })) ?? [],
      asteroidBelts: s.bodies?.asteroidBelts.map((b) => ({ orbit: b.orbit })) ?? [],
      sites,
      claimCost: s.claimCost,
      upkeep: s.upkeep,
      defense: s.defense,
      innerRing: s.innerRing,
      owner: s.owner,
      populationStage: s.populationStage,
      bodyBuildings: cloneBodyBuildings(s.bodyBuildings),
      buildQueues: cloneBuildQueues(s.buildQueues),
      colonyPop: Object.fromEntries(Object.entries(s.colonyPop).map(([k, p]) => [k, { ...p }])),
      hydroponics: systemBuildings(s).hydroponics,
      platforms: s.platforms,
      megastructures: [...s.megastructures],
      hasDepot: s.hasDepot,
      routeIds: [...s.routeIds],
      position: s.position,
      populationProgress: mine ? s.populationProgress : null,
      unrest: mine ? s.unrest : null,
      stockpile: mine ? { ...s.stockpile } : null,
    };
  });

  const routes: ClientRoute[] = [...g.routes.values()].map((r) => ({
    id: r.id,
    a: r.a,
    b: r.b,
    transitTime: r.transitTime,
    stability: r.stability,
    capacity: r.capacity,
    exposure: r.exposure,
    authorityPresence: r.authorityPresence,
    requiredRange: r.requiredRange,
    charted: r.charted,
    trafficHistory: [...r.trafficHistory],
  }));

  const corps: ClientCorp[] = engine.corps.map((c) => {
    const mine = c.id === humanCorpId;
    const base: ClientCorp = {
      id: c.id,
      name: c.name,
      valuation: c.valuation,
      sharePrice: c.sharePrice,
      sharesOutstanding: c.sharesOutstanding,
      rangeTier: c.rangeTier,
      ownedSystemIds: [...c.ownedSystemIds],
      shareRegister: { ...c.shareRegister },
      isFreeOperator: c.isFreeOperator,
      hasCharter: c.hasCharter,
      founderId: c.founderId,
      alliancePledges: [...c.alliancePledges],
    };
    if (mine) {
      base.credits = c.credits;
      base.debt = c.debt;
      base.ships = c.ships.map((s) => ({ ...s }));
      base.privateers = c.privateers.map((p) => ({ ...p }));
      base.recentEarnings = [...c.recentEarnings];
      base.surveyedSystemIds = [...c.surveyedSystemIds];
    }
    return base;
  });

  const convoys: ClientConvoy[] = engine.activeConvoys.map((c) => {
    const mine = c.owner === humanCorpId;
    return {
      id: c.id,
      owner: c.owner,
      kind: c.kind,
      resource: c.resource,
      path: [...c.path],
      routeIds: [...c.routeIds],
      position: c.position,
      segmentTurnsLeft: c.segmentTurnsLeft,
      launchedTurn: c.launchedTurn,
      value: c.value,
      quantity: mine ? c.quantity : 0,
      escort: mine ? c.escort : 0,
      payout: mine ? c.payout : 0,
    };
  });

  const prices = {} as Record<Resource, number>;
  for (const r of RESOURCES) prices[r] = engine.market.prices[r];

  return {
    gameId,
    scenarioId: engine.config.scenario.id ?? "legacy",
    turn: engine.currentTurn,
    phase: gamePhase(engine),
    totalTurns: engine.config.turns,
    humanCorpId,
    prices,
    systems,
    routes,
    corps,
    convoys,
    wars: engine.activeWars.map((w) => ({ ...w })),
    warTariff: engine.warTariffFor(humanCorpId),
    reports,
    // Multiplayer fields default here; the server overrides them with DB membership.
    mySeat: humanCorpId,
    isHost: false,
    players: [],
    totalSeats: engine.corps.length,
    submittedCount: 0,
  };
}
