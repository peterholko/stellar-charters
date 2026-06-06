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
  type BodyKind,
  type PlanetType,
  type PopulationStage,
  type Privateer,
  type RangeTier,
  type Resource,
  type Ship,
  type StarType,
  type Stockpile,
  type SystemPosition,
} from "./types.js";

export type GamePhase = "play" | "over";

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
  yields: Stockpile;
  /** The system's star (Section 21), for rendering + stellar forecasts. */
  starType?: StarType;
  /** Fogged extraction sites — the system's resource economy (Section 21). */
  sites: ClientSite[];
  claimCost: number;
  upkeep: number;
  defense: number;
  innerRing: boolean;
  owner: string | null;
  populationStage: PopulationStage;
  hydroponics: number;
  platforms: number;
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
  /** Self-only fields (undefined for rivals). */
  credits?: number;
  debt?: number;
  ships?: Ship[];
  privateers?: Privateer[];
  recentEarnings?: number[];
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
  const owned = new Set(
    engine.corps.find((c) => c.id === humanCorpId)?.ownedSystemIds ?? [],
  );

  const systems: ClientSystem[] = g.allSystems().map((s) => {
    const mine = s.owner === humanCorpId || owned.has(s.id);
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
      prospected: site.prospected,
      // Fog of war: richness known once surveyed; depletion intel is owner-only.
      richness: site.prospected ? site.richness : null,
      reservesRemaining: mine && site.prospected ? site.reservesRemaining : null,
    }));
    return {
      id: s.id,
      name: s.name,
      yields: { ...s.yields },
      starType: s.bodies?.starType,
      sites,
      claimCost: s.claimCost,
      upkeep: s.upkeep,
      defense: s.defense,
      innerRing: s.innerRing,
      owner: s.owner,
      populationStage: s.populationStage,
      hydroponics: s.hydroponics,
      platforms: s.platforms,
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
    };
    if (mine) {
      base.credits = c.credits;
      base.debt = c.debt;
      base.ships = c.ships.map((s) => ({ ...s }));
      base.privateers = c.privateers.map((p) => ({ ...p }));
      base.recentEarnings = [...c.recentEarnings];
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
    reports,
    // Multiplayer fields default here; the server overrides them with DB membership.
    mySeat: humanCorpId,
    isHost: false,
    players: [],
    totalSeats: engine.corps.length,
    submittedCount: 0,
  };
}
