/**
 * Reconstruct a read-only PlayerView from the server's redacted ClientState.
 *
 * The engine is browser-portable, so the client rebuilds a Galaxy/Market directly from the
 * server snapshot — the systems and routes (with their atlas positions) come down in the
 * state itself, so the display galaxy matches whatever the server generated without the
 * client needing the scenario id, seed, or any committed JSON. Authoritative (already
 * fog-of-war-redacted) dynamic state is then overlaid. Every existing screen keeps working
 * against a `PlayerView` while resolution happens only on the server.
 */
import {
  Galaxy,
  Market,
  RESOURCES,
  emptyStockpile,
  Rng,
  loadScenario,
  type ClientState,
  type Convoy,
  type Corporation,
  type GameConfig,
  type PlayerView,
  type Scenario,
  type ScenarioRoute,
  type ScenarioSystem,
} from "@engine";

/** Rebuild a Scenario skeleton from the server snapshot (static fields + atlas positions). */
function scenarioFromState(state: ClientState): Scenario {
  const systems: ScenarioSystem[] = state.systems.map((s) => ({
    id: s.id,
    name: s.name,
    yields: s.yields ?? {},
    claimCost: s.claimCost,
    upkeep: s.upkeep,
    populationStage: s.populationStage,
    defense: s.defense,
    innerRing: s.innerRing,
    position: s.position,
  }));
  // Routes come down in construction order, so `new Galaxy` reassigns the same route-N ids.
  const routes: ScenarioRoute[] = state.routes.map((r) => ({
    a: r.a,
    b: r.b,
    transitTime: r.transitTime,
    stability: r.stability,
    capacity: r.capacity,
    exposure: r.exposure,
    authorityPresence: r.authorityPresence,
    requiredRange: r.requiredRange,
    charted: r.charted,
  }));
  return {
    name: "live",
    id: state.scenarioId,
    hubId: "hub",
    players: state.corps.length,
    turns: state.totalTurns,
    systems,
    routes,
  };
}

export function reconstructView(state: ClientState): PlayerView {
  const scenario = scenarioFromState(state);
  const config: GameConfig = loadScenario(scenario);
  const galaxy = new Galaxy(config);

  for (const cs of state.systems) {
    const sys = galaxy.systems.get(cs.id);
    if (!sys) continue;
    sys.owner = cs.owner;
    sys.populationStage = cs.populationStage;
    sys.bodyBuildings = {};
    for (const [key, b] of Object.entries(cs.bodyBuildings)) {
      sys.bodyBuildings[key] = { ...b, processors: { ...b.processors } };
    }
    sys.queue = cs.queue.map((it) => ({ ...it }));
    sys.platforms = cs.platforms;
    sys.megastructures = [...cs.megastructures];
    sys.hasDepot = cs.hasDepot;
    sys.hasDisruptor = cs.hasDisruptor;
    sys.populationProgress = cs.populationProgress ?? 0;
    sys.unrest = cs.unrest ?? 0;
    if (cs.stockpile) sys.stockpile = cs.stockpile;
    // Owner-only production visibility (design rule #2): brown-out factor + limiting inputs.
    if (cs.production) sys.production = cs.production;
    // Overlay the server's (fogged) extraction sites + star (Section 21). The rebuilt galaxy
    // has no deposits of its own (bodies aren't shipped), so these are the source of truth.
    if (cs.starType || cs.planets.length) {
      sys.bodies = {
        starType: cs.starType ?? "mainSequence",
        planets: cs.planets.map((p) => ({ type: p.type, orbit: p.orbit, habitable: p.habitable, visualSeed: 0, deposits: [] })),
        asteroidBelts: cs.asteroidBelts.map((b) => ({ orbit: b.orbit, deposits: [] })),
      };
    }
    sys.sites = cs.sites.map((cse) => ({
      key: cse.key,
      bodyKind: cse.bodyKind,
      bodyType: cse.bodyType,
      bodyLabel: cse.bodyLabel,
      orbit: cse.orbit,
      habitable: cse.habitable,
      resource: cse.resource,
      richness: cse.richness ?? 0,
      reservesRemaining: cse.reservesRemaining,
      accessibility: cse.accessibility,
      extractorLevel: cse.extractorLevel,
      prospected: cse.prospected,
      disabledUntil: cse.disabledUntil,
    }));
  }

  for (const cr of state.routes) {
    const rt = galaxy.routes.get(cr.id);
    if (!rt) continue;
    rt.charted = cr.charted;
    rt.trafficHistory = cr.trafficHistory;
  }

  const market = new Market(config.tuning);
  for (const r of RESOURCES) market.prices[r] = state.prices[r];

  const corporations: Corporation[] = state.corps.map((c) => ({
    id: c.id,
    name: c.name,
    charter: c.charter,
    credits: c.credits ?? 0,
    debt: c.debt ?? 0,
    // Self-only under fog of war (rivals' hoards are hidden) — zeros for rivals.
    hubStockpile: c.hubStockpile ?? emptyStockpile(),
    warehouseLevel: c.warehouseLevel ?? 0,
    ownedSystemIds: c.ownedSystemIds,
    ships: c.ships ?? [],
    privateers: c.privateers ?? [],
    surveyedSystemIds: c.surveyedSystemIds ?? [],
    research: c.research ?? { completed: [], queue: [], invested: {}, banked: 0 },
    rangeTier: c.rangeTier,
    valuation: c.valuation,
    valuationParts: c.valuationParts,
    sharePrice: c.sharePrice,
    sharesOutstanding: c.sharesOutstanding,
    shareRegister: c.shareRegister,
    npcHolders: c.npcHolders,
    sentiment: c.sentiment,
    sentimentParts: c.sentimentParts,
    founderId: c.founderId,
    recentEarnings: c.recentEarnings ?? [],
    isFreeOperator: c.isFreeOperator,
    botId: "",
    hasCharter: c.hasCharter,
    alliancePledges: c.alliancePledges ?? [],
    grudges: {}, // AI retaliation intel — not surfaced to the client
  }));
  const me = corporations.find((c) => c.id === state.humanCorpId) ?? corporations[0]!;

  const convoys: Convoy[] = state.convoys.map((c) => ({
    id: c.id,
    owner: c.owner,
    kind: c.kind,
    // Rivals' cargo is redacted to null upstream (fog of war). The UI labels convoys by ship
    // name and only reads `resource` for convoys you own, so this placeholder is never shown.
    resource: c.resource ?? "ice",
    quantity: c.quantity,
    path: c.path,
    routeIds: c.routeIds,
    position: c.position,
    segmentTurnsLeft: c.segmentTurnsLeft,
    launchedTurn: c.launchedTurn,
    payout: c.payout,
    escort: c.escort,
    value: c.value,
  }));

  return {
    turn: state.turn,
    config,
    galaxy,
    market,
    me,
    corporations,
    convoys,
    wars: state.wars,
    rng: new Rng(0), // present for type-compatibility; views never draw randomness
  };
}
