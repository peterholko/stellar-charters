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
  type PopulationStage,
  type Privateer,
  type RangeTier,
  type Resource,
  type Ship,
  type Stockpile,
} from "./types.js";

export type GamePhase = "play" | "over";

export interface ClientSystem {
  id: string;
  name: string;
  yields: Stockpile;
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
  turn: number;
  phase: GamePhase;
  totalTurns: number;
  humanCorpId: string;
  prices: Record<Resource, number>;
  systems: ClientSystem[];
  routes: ClientRoute[];
  corps: ClientCorp[];
  convoys: ClientConvoy[];
  reports: TurnReport[];
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
    return {
      id: s.id,
      name: s.name,
      yields: { ...s.yields },
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
  };
}
