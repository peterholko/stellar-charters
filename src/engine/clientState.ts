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
  type ClientMovement,
  type ColonyPopulation,
  type CorpResearch,
  type QueueItem,
  type MegastructureKind,
  type NpcHolder,
  type PlanetType,
  type SentimentParts,
  type War,
  type PopulationStage,
  type Privateer,
  type RangeTier,
  type Resource,
  type Ship,
  type StarType,
  type CharterType,
  type Stockpile,
  type SystemPosition,
  type SystemProduction,
  type ValuationComponent,
  type Order,
  type PublicMarker,
} from "./types.js";
import { RULESET_VERSION, type Tuning } from "./config.js";
import { projectClearingPrices, type ClearableOrder } from "./market.js";
import { canHostPopulation, coloniesOf, systemBuildings } from "./bodies.js";
import { SECRET_TECH_IDS } from "./research.js";
import type { GameOutcome } from "./standings.js";

export type GamePhase = "auction" | "play" | "over";

/** Deep-copy a per-body building map so the client snapshot never aliases live engine state. */
function cloneBodyBuildings(bb: Record<string, BodyBuildings>): Record<string, BodyBuildings> {
  const out: Record<string, BodyBuildings> = {};
  for (const [key, b] of Object.entries(bb)) {
    out[key] = { ...b, processors: { ...b.processors } };
  }
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
  /** THE system's construction queue (review Section 10) — items record their landing body. */
  queue: QueueItem[];
  /** System-wide aggregate of hydroponics across all bodies — convenience for compact UI badges. */
  hydroponics: number;
  platforms: number;
  /** Megastructures built here (Section 22). */
  megastructures: MegastructureKind[];
  hasDepot: boolean;
  /** True if a Warp Disruptor stands here (Section 04) — holds rival fleet arrivals. Public, like
   *  platforms/depot: defensive structures are visible. */
  hasDisruptor: boolean;
  routeIds: string[];
  /** Atlas coordinates / region for map rendering (procedural scenarios). */
  position?: SystemPosition;
  /** Owner-only: progress / unrest / local stockpile (null for systems you don't own). */
  populationProgress: number | null;
  unrest: number | null;
  stockpile: Stockpile | null;
  /** Owner-only: last turn's brown-out factor + limiting inputs (design rule #2). */
  production: SystemProduction | null;
  /** Public map markers anchored here (survey pings, auction interest), else undefined. */
  markers?: PublicMarker[];
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
  /** Charter type (review Section 5) — public identity, undefined for bots/unpicked seats. */
  charter?: CharterType;
  valuation: number;
  sharePrice: number;
  sharesOutstanding: number;
  rangeTier: RangeTier;
  ownedSystemIds: string[];
  shareRegister: Record<string, number>;
  /** The seeded institutional blocks on this charter's cap table (Section 17) — public,
   *  like the register: who holds what, and at what ask/bid they'll trade. */
  npcHolders: NpcHolder[];
  /** Market mood on share trades (Section 17): tradedBase = sharePrice × sentiment. Public. */
  sentiment: number;
  /** This turn's sentiment move, decomposed (reversion/events/jitter) — no mystery numbers. */
  sentimentParts?: SentimentParts;
  isFreeOperator: boolean;
  hasCharter: boolean;
  founderId: string;
  /** Charters this corp has pledged to defend (Section 23). Allied iff mutual. */
  alliancePledges: string[];
  /** Self-only fields (undefined for rivals). */
  credits?: number;
  debt?: number;
  /** Goods in your Exchange warehouse (ruleset v10) — private; rivals never see your hoard. */
  hubStockpile?: Stockpile;
  warehouseLevel?: number;
  /** Total warehouse capacity at the current level (units across all resources). */
  warehouseCapacity?: number;
  /** Per-component valuation breakdown (Section 17) — decomposes the share price; self-only. */
  valuationParts?: Record<ValuationComponent, number>;
  ships?: Ship[];
  privateers?: Privateer[];
  recentEarnings?: number[];
  /** Systems this charter has scouted with a survey vessel (Section 25); self-only. */
  surveyedSystemIds?: string[];
  /** Research progress (Section 28); self-only. */
  research?: CorpResearch;
  /** Research points generated per turn from labs + population (Section 28); self-only. */
  rpPerTurn?: number;
}

export interface ClientConvoy {
  id: string;
  owner: string;
  kind: "buy" | "sell" | "transfer";
  /** Cargo type — owner-only. `null` for rivals: a convoy's contents are known only to its exporter. */
  resource: Resource | null;
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
  /** Folklore name (maiden voyages / standing-route convoys), else undefined. Public flavor. */
  name?: string;
  /** True for a charter's named first export (Section 05 opening). Public badge. */
  firstExportForPlayer?: boolean;
}

/** Turn-1 opening window (Section 05): the free Authority probes + maiden-voyage affordances. Self-only. */
export interface OpeningCommandState {
  homeSystemId: string;
  surveysRemaining: number;
  /** Unowned systems within warp range your home may run a free probe against. */
  eligibleSurveyTargets: string[];
}

/** A player-owned standing trade route (export automation), self-only. */
export interface ClientStandingRoute {
  id: string;
  originSystemId: string;
  resource: Resource;
  batch: number;
  reserve: number;
  enabled: boolean;
  /** True if the origin stockpile currently covers reserve + batch (it will launch next resolution). */
  readyToLaunch: boolean;
}

/** A suggested standing route the UI offers for one-click approval. */
export interface StandingRouteSuggestion {
  originSystemId: string;
  resource: Resource;
  batch: number;
  reserve: number;
}

/**
 * A detected rival fleet in transit (Section 04 — ship-mounted sensors). Surfaced only when the
 * contact sits inside one of the viewer's ships' sensor bubbles. Fog of war: only its current
 * segment, final heading, and a ROUGH force band leak — never the exact ship list, cargo, or path
 * interior, and stationed rival garrisons never blip.
 */
export interface ClientContact {
  owner: string;
  /** The leg the contact is crossing right now. */
  fromSystemId: string;
  toSystemId: string;
  /** True if the contact is on a direct off-lane hop (no lane to interdict). */
  offLane: boolean;
  /** Where the contact is ultimately headed (last system in its path). */
  headingSystemId: string;
  /** Rough strength estimate, never an exact count. */
  forceEstimate: "light" | "medium" | "heavy";
}

/**
 * Fogged market-pressure signal (Phase B — between-turns visibility). For each listed resource we
 * surface the DIRECTION of the net imbalance across all seats' locked market orders — never raw
 * quantities, never per-rival data. It lets a player read the glut forming this turn (e.g. "heavy
 * sell pressure on Silicates") instead of committing blind and waiting for the resolution.
 */
export type MarketPressureDirection = "heavySell" | "sell" | "balanced" | "buy" | "heavyBuy";

export interface MarketPressureCell {
  direction: MarketPressureDirection;
}

/**
 * Pure aggregation (no mutation, no RNG): bucket each listed resource's net (demand − supply) across
 * every seat's locked market orders into one of five bands, normalized by `priceReferenceVolume`.
 * Unlisted resources can't trade, so they read `balanced`. Identities and quantities are discarded —
 * only the global direction survives, so this leaks nothing a rival's individual orders would.
 */
export function marketPressureFrom(
  tuning: Tuning,
  listed: Resource[],
  lockedOrders: Iterable<Order[]>,
): Record<Resource, MarketPressureCell> {
  const listedSet = new Set(listed);
  const net = {} as Record<Resource, number>;
  for (const r of RESOURCES) net[r] = 0;
  for (const orders of lockedOrders) {
    for (const o of orders) {
      if (o.kind !== "market" || o.quantity <= 0 || !listedSet.has(o.resource)) continue;
      net[o.resource] += o.side === "buy" ? o.quantity : -o.quantity;
    }
  }
  const out = {} as Record<Resource, MarketPressureCell>;
  for (const r of RESOURCES) {
    out[r] = { direction: bandFor(listedSet.has(r) ? net[r] / tuning.priceReferenceVolume : 0) };
  }
  return out;
}

/** Bucket a normalized net imbalance (net / priceReferenceVolume) into the 5 pressure bands. */
function bandFor(normalized: number): MarketPressureDirection {
  if (normalized <= -1) return "heavySell";
  if (normalized <= -0.25) return "sell";
  if (normalized < 0.25) return "balanced";
  if (normalized < 1) return "buy";
  return "heavyBuy";
}

/** Options for shaping a client view that depend on data the engine alone doesn't hold (the live
 *  game's locked orders live in the worker, not the engine). */
export interface BuildClientStateOptions {
  /** All seats' locked orders for the upcoming turn — drives the fogged market-pressure signal. */
  lockedOrders?: Iterable<Order[]>;
  /** Opt-in (default OFF): include a pure projected clearing price per resource from locked orders. */
  projectPrices?: boolean;
}

export interface ClientState {
  gameId: string;
  /** Id of the scenario this game was built from (e.g. "procedural-atlas-v1"). */
  scenarioId: string;
  /** Movement/fuel ruleset epoch the game runs under (Section 04) — see RULESET_VERSION. */
  rulesetVersion: number;
  turn: number;
  phase: GamePhase;
  totalTurns: number;
  /** The corporation this client controls (its perspective for fog of war). */
  humanCorpId: string;
  prices: Record<Resource, number>;
  /** Fogged net market-pressure direction per resource (Phase B) — see `marketPressureFrom`. */
  marketPressure: Record<Resource, MarketPressureCell>;
  /** Opt-in pure projected clearing price per resource (Phase B, default OFF) — undefined unless
   *  the caller requested the preview. Read-only: never perturbs the authoritative prices. */
  projectedPrices?: Record<Resource, number>;
  /** Goods currently tradable on the Exchange (commodity staging, review Section 13). */
  listedResources: Resource[];
  systems: ClientSystem[];
  routes: ClientRoute[];
  corps: ClientCorp[];
  convoys: ClientConvoy[];
  /**
   * Convoy/fleet legs traversed last turn, for the map's "Last turn movements" replay (Section 04).
   * Fog-of-war: convoy legs are public (convoy positions already are); fleet legs only for your own.
   */
  movementLog: ClientMovement[];
  /** Rival fleets currently detected by your ships' sensors (Section 04 — ship-mounted sensors). */
  contacts: ClientContact[];
  /** Active wars between charters (Section 23). */
  wars: War[];
  /** Galaxy-unique secret projects already claimed (Section 28, Phase 3): techId → corp name. */
  claimedSecrets: Record<string, string>;
  /** Exchange tariff you (the viewing charter) pay as a war aggressor; 0 if not at war. */
  warTariff: number;
  /** Live victory standings + final outcome (Section 29): ranked scoreboard, winner once over. */
  outcome: GameOutcome;
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
  /** Turn-1 opening window (Section 05): present only during the opening; drives the opening panel. Self-only. */
  openingState?: OpeningCommandState;
  /** Your standing trade routes (export automation). Self-only. */
  standingRoutes?: ClientStandingRoute[];
  /** A suggested standing route the UI offers for one-click approval. Self-only. */
  standingRouteSuggestion?: StandingRouteSuggestion;
}

export function gamePhase(engine: Engine): GamePhase {
  // "over" at the turn limit *or* on a decisive monopoly (Section 29).
  if (engine.outcome.over) return "over";
  // "auction" while the opening Inner Ring claim auction (Section 05) is open and unresolved.
  if (engine.auctionPending) return "auction";
  return "play";
}

export function buildClientState(
  engine: Engine,
  humanCorpId: string,
  gameId: string,
  reports: TurnReport[],
  opts: BuildClientStateOptions = {},
): ClientState {
  const g = engine.galaxy;
  const me = engine.corps.find((c) => c.id === humanCorpId);
  const owned = new Set(me?.ownedSystemIds ?? []);
  const surveyed = new Set(me?.surveyedSystemIds ?? []);

  // Public map markers (survey pings, auction interest) grouped by the system they anchor to.
  const markersBySystem = new Map<string, PublicMarker[]>();
  for (const m of engine.markersFor()) {
    const arr = markersBySystem.get(m.systemId) ?? [];
    arr.push({ ...m });
    markersBySystem.set(m.systemId, arr);
  }

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
      queue: s.queue.map((it) => ({ ...it, mats: { ...it.mats } })),
      hydroponics: systemBuildings(s).hydroponics,
      platforms: s.platforms,
      megastructures: [...s.megastructures],
      hasDepot: s.hasDepot,
      hasDisruptor: s.hasDisruptor,
      routeIds: [...s.routeIds],
      position: s.position,
      populationProgress: mine ? s.populationProgress : null,
      unrest: mine ? s.unrest : null,
      stockpile: mine ? { ...s.stockpile } : null,
      production: mine && s.production
        ? { powerFactor: s.production.powerFactor, limited: s.production.limited.map((l) => ({ ...l })) }
        : null,
      markers: markersBySystem.get(s.id),
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
      charter: c.charter,
      valuation: c.valuation,
      sharePrice: c.sharePrice,
      sharesOutstanding: c.sharesOutstanding,
      rangeTier: c.rangeTier,
      ownedSystemIds: [...c.ownedSystemIds],
      shareRegister: { ...c.shareRegister },
      npcHolders: c.npcHolders.map((h) => ({ ...h })),
      sentiment: c.sentiment,
      sentimentParts: c.sentimentParts ? { ...c.sentimentParts } : undefined,
      isFreeOperator: c.isFreeOperator,
      hasCharter: c.hasCharter,
      founderId: c.founderId,
      alliancePledges: [...c.alliancePledges],
    };
    if (mine) {
      base.credits = c.credits;
      base.debt = c.debt;
      base.hubStockpile = { ...c.hubStockpile };
      base.warehouseLevel = c.warehouseLevel;
      base.warehouseCapacity = engine.warehouseCapacity(c);
      if (c.valuationParts) base.valuationParts = { ...c.valuationParts };
      base.ships = c.ships.map((s) => ({ ...s }));
      base.privateers = c.privateers.map((p) => ({ ...p }));
      base.recentEarnings = [...c.recentEarnings];
      base.surveyedSystemIds = [...c.surveyedSystemIds];
      base.research = {
        completed: [...c.research.completed], queue: [...c.research.queue],
        invested: { ...c.research.invested }, banked: c.research.banked,
      };
      const tune = engine.config.tuning;
      let rp = 0;
      for (const sid of c.ownedSystemIds) {
        const s = g.systems.get(sid);
        if (!s) continue;
        rp += systemBuildings(s).labs * tune.labRpOutput;
        // One population per system (review Section 10) — matches resolveResearch exactly.
        if (coloniesOf(s).some((col) => canHostPopulation(col))) rp += tune.researchPopBase[s.populationStage];
      }
      base.rpPerTurn = rp;
    }
    return base;
  });

  const convoys: ClientConvoy[] = engine.activeConvoys.map((c) => {
    const mine = c.owner === humanCorpId;
    return {
      id: c.id,
      owner: c.owner,
      kind: c.kind,
      resource: mine ? c.resource : null,
      path: [...c.path],
      routeIds: [...c.routeIds],
      position: c.position,
      segmentTurnsLeft: c.segmentTurnsLeft,
      launchedTurn: c.launchedTurn,
      value: c.value,
      quantity: mine ? c.quantity : 0,
      escort: mine ? c.escort : 0,
      payout: mine ? c.payout : 0,
      ...(c.name ? { name: c.name } : {}),
      ...(c.firstExportForPlayer ? { firstExportForPlayer: true } : {}),
    };
  });

  // Turn-1 opening window + standing-route automation (self-only surfaces).
  const opening: OpeningCommandState | undefined =
    me && me.ownedSystemIds[0] && engine.currentTurn === 0 && !engine.auctionPending
      ? {
          homeSystemId: me.ownedSystemIds[0],
          surveysRemaining: engine.openingSurveysRemaining(me.id),
          eligibleSurveyTargets: engine.openingSurveyTargets(me),
        }
      : undefined;
  const standingRoutes: ClientStandingRoute[] | undefined = me
    ? me.standingRoutes.map((r) => ({
        id: r.id, originSystemId: r.originSystemId, resource: r.resource, batch: r.batch, reserve: r.reserve,
        enabled: r.enabled,
        readyToLaunch: (g.systems.get(r.originSystemId)?.stockpile[r.resource] ?? 0) >= r.reserve + r.batch,
      }))
    : undefined;

  // ----- Ship-mounted sensors → rival fleet contacts (Section 04) -----
  // Each of the viewer's ships projects a sensor bubble around its current atlas position; a rival
  // fleet IN TRANSIT inside any bubble surfaces as a contact. Pure + deterministic: no Rng, and the
  // banding/grouping is integer-and-threshold math over the existing array iteration order.
  const tuning = engine.config.tuning;
  const shipPos = (ship: Ship): { x: number; y: number } | null => {
    const tr = ship.transit;
    if (!tr) {
      const p = g.systems.get(ship.stationedAt)?.position;
      return p ? { x: p.x, y: p.y } : null;
    }
    const a = g.systems.get(tr.path[tr.position]!)?.position;
    const b = g.systems.get(tr.path[tr.position + 1]!)?.position;
    if (!a || !b) return null; // position-less map → sensors disabled (mirrors off-lane gating)
    const rid = tr.routeIds[tr.position];
    const segTime = tr.segmentTimes?.[tr.position] ?? (rid ? g.routes.get(rid)?.transitTime : undefined) ?? 1;
    const frac = Math.max(0, Math.min(1, 1 - tr.segmentTurnsLeft / Math.max(1, segTime)));
    return { x: a.x + (b.x - a.x) * frac, y: a.y + (b.y - a.y) * frac };
  };
  const isAllied = (otherId: string): boolean => {
    if (!me || otherId === me.id) return false;
    const other = engine.corps.find((c) => c.id === otherId);
    return !!other && me.alliancePledges.includes(otherId) && other.alliancePledges.includes(me.id);
  };
  const bubbles = (me?.ships ?? [])
    .map((s) => ({ pos: shipPos(s), r: tuning.shipSensorRange[s.rangeTier] }))
    .filter((b): b is { pos: { x: number; y: number }; r: number } => b.pos !== null);
  const contactGroups = new Map<string, { owner: string; from: string; to: string; offLane: boolean; heading: string; combat: number }>();
  if (me && bubbles.length > 0) {
    for (const c of engine.corps) {
      if (c.id === me.id || isAllied(c.id)) continue;
      for (const ship of c.ships) {
        const tr = ship.transit;
        if (!tr) continue; // only moving rivals blip; stationed garrisons stay fogged
        const pos = shipPos(ship);
        if (!pos) continue;
        if (!bubbles.some((b) => Math.hypot(pos.x - b.pos.x, pos.y - b.pos.y) <= b.r)) continue;
        const from = tr.path[tr.position]!;
        const to = tr.path[tr.position + 1]!;
        const key = `${c.id}|${from}>${to}|${tr.launchedTurn}`;
        const grp = contactGroups.get(key) ?? {
          owner: c.id, from, to, offLane: tr.routeIds[tr.position] === "",
          heading: tr.path[tr.path.length - 1]!, combat: 0,
        };
        grp.combat += ship.combat;
        contactGroups.set(key, grp);
      }
    }
  }
  const contacts: ClientContact[] = [...contactGroups.values()].map((grp) => ({
    owner: grp.owner,
    fromSystemId: grp.from,
    toSystemId: grp.to,
    offLane: grp.offLane,
    headingSystemId: grp.heading,
    forceEstimate: grp.combat < 8 ? "light" : grp.combat < 20 ? "medium" : "heavy",
  }));

  const prices = {} as Record<Resource, number>;
  for (const r of RESOURCES) prices[r] = engine.market.prices[r];

  // Phase B — between-turns market visibility. Aggregate every seat's locked orders into a fogged
  // pressure direction per resource (no quantities, no identities). The projected-price preview is
  // opt-in and pure: it runs the clearing math without committing, so the authoritative price is
  // never perturbed. Headless/tests pass no locked orders → everything reads `balanced`.
  const listed = engine.listedResources();
  const lockedOrders = opts.lockedOrders ?? [];
  const marketPressure = marketPressureFrom(tuning, listed, lockedOrders);
  let projectedPrices: Record<Resource, number> | undefined;
  if (opts.projectPrices) {
    const listedSet = new Set(listed);
    const clearable: ClearableOrder[] = [];
    for (const orders of lockedOrders) {
      for (const o of orders) {
        if (o.kind !== "market" || o.quantity <= 0 || !listedSet.has(o.resource)) continue;
        clearable.push({
          ownerId: "", side: o.side, resource: o.resource, quantity: o.quantity,
          limitPrice: o.limitPrice, strict: o.strict, systemId: o.systemId,
        });
      }
    }
    projectedPrices = projectClearingPrices(tuning, engine.market.prices, clearable);
  }

  // Which galaxy-unique secret projects are already claimed, and by whom (Section 28, Phase 3).
  const claimedSecrets: Record<string, string> = {};
  for (const c of engine.corps) for (const id of c.research.completed) if (SECRET_TECH_IDS.includes(id)) claimedSecrets[id] = c.name;

  // Suggest one standing route → the hub: prefer a PRODUCED tradable raw (a worked, listed, non-food
  // deposit) so the route actually restocks; else the richest listed stock. Skip if already routed.
  let standingRouteSuggestion: StandingRouteSuggestion | undefined;
  if (me) {
    const listedSet = new Set(listed);
    for (const sid of me.ownedSystemIds) {
      const s = g.systems.get(sid);
      if (!s) continue;
      let best: Resource | null =
        s.sites.find((site) => site.extractorLevel > 0 && site.resource !== "food" && listedSet.has(site.resource))?.resource ?? null;
      if (!best) {
        let bestQty = 0;
        for (const r of listed) { const q = s.stockpile[r] ?? 0; if (q > bestQty) { best = r; bestQty = q; } }
        if (!best || bestQty <= 0) continue;
      }
      if (!me.standingRoutes.some((x) => x.originSystemId === sid && x.resource === best)) {
        const have = s.stockpile[best] ?? 0;
        standingRouteSuggestion = { originSystemId: sid, resource: best, batch: Math.max(2, Math.floor(have / 2)), reserve: Math.floor(have / 4) };
        break;
      }
    }
  }

  return {
    gameId,
    scenarioId: engine.config.scenario.id ?? "legacy",
    rulesetVersion: RULESET_VERSION,
    listedResources: engine.listedResources(),
    turn: engine.currentTurn,
    phase: gamePhase(engine),
    totalTurns: engine.config.turns,
    humanCorpId,
    prices,
    marketPressure,
    projectedPrices,
    systems,
    routes,
    corps,
    convoys,
    // Convoy legs are already-visible public info; fleet legs are redacted to the viewer's own
    // ships (rivals' fleets are fogged) so the replay never reveals hidden military movement.
    movementLog: engine.lastMovements.filter((m) => m.kind === "convoy" || m.owner === humanCorpId),
    contacts,
    wars: engine.activeWars.map((w) => ({ ...w })),
    claimedSecrets,
    warTariff: engine.warTariffFor(humanCorpId),
    outcome: engine.outcome,
    // Fog-of-war on money (Section 11): each seat sees only its OWN ledger lines; the shared
    // event stream stays as-is (the client digest already scope-filters it per viewer).
    reports: reports.map((r) => ({ ...r, ledger: (r.ledger ?? []).filter((l) => l.corpId === humanCorpId) })),
    // Multiplayer fields default here; the server overrides them with DB membership.
    mySeat: humanCorpId,
    isHost: false,
    players: [],
    totalSeats: engine.corps.length,
    submittedCount: 0,
    openingState: opening,
    standingRoutes,
    standingRouteSuggestion,
  };
}
