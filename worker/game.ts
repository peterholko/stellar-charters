/**
 * One always-on global game. A persistent galaxy run by AI charters; signing in auto-takes
 * an open seat and you control that corporation from your first submitted turn onward.
 *
 * Persistence is event-sourced — the deterministic engine is reconstructed by replaying
 * each turn's per-seat order log. A seat uses the human's orders on turns they submitted
 * and the AI's otherwise, so the log itself records the takeover. Turns resolve once every
 * seated human has submitted. Each player sees a fog-of-war view from their own seat.
 */
import {
  Engine,
  CHARTER_TYPES,
  PROCEDURAL_SCENARIO_ID,
  RULESET_VERSION,
  buildClientState,
  marketPressureFrom,
  defaultRegistry,
  gamePhase,
  generateProceduralScenario,
  loadScenario,
  type BidOrder,
  type CharterType,
  type ClientPlayer,
  type ClientState,
  type GamePhase,
  type Order,
  type Resource,
  type Scenario,
  type TurnReport,
} from "../src/engine/index.js";
import scenarioJson8p from "../scenarios/inner-ring-8p.json";
import scenarioJson4p from "../scenarios/inner-ring-4p.json";
import { currentUser, json, readJson, type Env, type SessionUser } from "./session.js";

/** New games are grown procedurally from their seed; legacy ids still replay from JSON. */
const SCENARIO_ID = PROCEDURAL_SCENARIO_ID;
const TOTAL_SEATS = 4;
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

const BASE_CONFIG = loadScenario(generateProceduralScenario({ seed: 1, players: TOTAL_SEATS }));
const TOTAL_TURNS = BASE_CONFIG.turns;

interface GameRow {
  id: string;
  seed: number;
  scenario: string;
  players: number;
  turn: number;
  phase: string;
  status: string;
}

/**
 * Rebuild the base scenario a game was created from. Procedural games regrow from their
 * seed + player count; legacy rows keep replaying their committed authored JSON.
 */
function resolveScenario(game: GameRow): Scenario {
  switch (game.scenario) {
    case "inner-ring-8p":
      return scenarioJson8p as unknown as Scenario;
    case "inner-ring-4p":
      return scenarioJson4p as unknown as Scenario;
    case PROCEDURAL_SCENARIO_ID:
    default:
      return generateProceduralScenario({ seed: game.seed, players: game.players });
  }
}
interface MemberRow {
  corp_id: string;
  user_id: string;
  display_name: string;
  /** Charter type picked at join (review Section 5); null until picked. */
  charter: string | null;
  /** First turn the charter's effects apply (event-sourced replay anchor). */
  charter_turn: number | null;
}

export async function handleGame(request: Request, env: Env, url: URL): Promise<Response> {
  const user = await currentUser(request, env);
  if (!user) return json({ error: "unauthenticated" }, 401);
  const p = url.pathname;
  const m = request.method;
  if (p === "/api/game" && (m === "GET" || m === "POST")) return getState(env, user);
  if (p === "/api/game/submit" && m === "POST") return submit(request, env, user);
  if (p === "/api/game/new" && m === "POST") return startNew(env, user);
  if (p === "/api/game/charter" && m === "POST") return pickCharter(request, env, user);
  if (p === "/api/game/instant" && m === "POST") return instantAction(request, env, user);
  return json({ error: "not_found" }, 404);
}

// ----- DB helpers -----

async function activeGame(env: Env): Promise<GameRow | null> {
  return env.DB.prepare("SELECT * FROM games WHERE status='active' ORDER BY created_ts DESC LIMIT 1").first<GameRow>();
}

async function members(env: Env, gameId: string): Promise<MemberRow[]> {
  const r = await env.DB.prepare(
    "SELECT corp_id, user_id, display_name, charter, charter_turn FROM game_players WHERE game_id=? ORDER BY corp_id",
  ).bind(gameId).all<MemberRow>();
  return r.results ?? [];
}

async function loadOrders(env: Env, gameId: string): Promise<Map<number, Map<string, Order[]>>> {
  const r = await env.DB.prepare(
    "SELECT turn, corp_id, orders_json FROM game_orders WHERE game_id=?",
  ).bind(gameId).all<{ turn: number; corp_id: string; orders_json: string }>();
  const out = new Map<number, Map<string, Order[]>>();
  for (const row of r.results ?? []) {
    if (!out.has(row.turn)) out.set(row.turn, new Map());
    const parsed = JSON.parse(row.orders_json);
    out.get(row.turn)!.set(row.corp_id, Array.isArray(parsed) ? parsed : []);
  }
  return out;
}

/** An instant planning-window action (ruleset v10), executed at click time:
 *  buy (Exchange → warehouse or a system), sell (from the warehouse), or
 *  dispatch (warehouse → one of your systems). */
type InstantAction =
  | { kind: "buy"; resource: Resource; quantity: number; systemId: string }
  | { kind: "sell"; resource: Resource; quantity: number }
  | { kind: "dispatch"; resource: Resource; quantity: number; systemId: string };

type InstantLog = Map<number, { corpId: string; action: InstantAction }[]>;

/** Instant actions grouped by the turn whose planning window they belong to, in seq order. */
async function loadInstants(env: Env, gameId: string): Promise<InstantLog> {
  const r = await env.DB.prepare(
    "SELECT turn, seq, corp_id, action_json FROM game_instants WHERE game_id=? ORDER BY turn, seq",
  ).bind(gameId).all<{ turn: number; seq: number; corp_id: string; action_json: string }>();
  const out: InstantLog = new Map();
  for (const row of r.results ?? []) {
    if (!out.has(row.turn)) out.set(row.turn, []);
    out.get(row.turn)!.push({ corpId: row.corp_id, action: JSON.parse(row.action_json) as InstantAction });
  }
  return out;
}

/** Re-apply one planning window's instant actions; a call the engine rejects is a no-op
 *  (it was validated when recorded, so rejection here only means the replay context already
 *  consumed the credits — deterministic either way). */
function applyInstants(engine: Engine, entries: { corpId: string; action: InstantAction }[] | undefined): void {
  for (const e of entries ?? []) {
    const a = e.action;
    if (a.kind === "buy") engine.instantBuy(e.corpId, a.resource, a.quantity, a.systemId);
    else if (a.kind === "sell") engine.instantSell(e.corpId, a.resource, a.quantity);
    else if (a.kind === "dispatch") engine.instantDispatch(e.corpId, a.resource, a.quantity, a.systemId);
  }
}

/** Run one instant action against a live engine (validation at record time). */
function runInstant(engine: Engine, corpId: string, a: InstantAction): string | null {
  if (a.kind === "buy") return engine.instantBuy(corpId, a.resource, a.quantity, a.systemId);
  if (a.kind === "sell") return engine.instantSell(corpId, a.resource, a.quantity);
  return engine.instantDispatch(corpId, a.resource, a.quantity, a.systemId);
}

async function createGlobalGame(env: Env, creator: SessionUser): Promise<GameRow> {
  const now = Date.now();
  const row: GameRow = {
    id: crypto.randomUUID(),
    seed: crypto.getRandomValues(new Uint32Array(1))[0]! & 0x7fffffff,
    scenario: SCENARIO_ID,
    players: TOTAL_SEATS,
    turn: 0,
    phase: "auction",
    status: "active",
  };
  await env.DB.prepare(
    `INSERT INTO games (id, user_id, seed, scenario, players, human_corp, turn, phase, status, host_user_id, created_ts, updated_ts)
     VALUES (?, ?, ?, ?, ?, 'corp-0', 0, 'auction', 'active', ?, ?, ?)`,
  ).bind(row.id, creator.id, row.seed, SCENARIO_ID, row.players, creator.id, now, now).run();
  await env.DB.prepare(
    "INSERT INTO game_players (game_id, corp_id, user_id, display_name, joined_ts) VALUES (?, 'corp-0', ?, ?, ?)",
  ).bind(row.id, creator.id, creator.username, now).run();
  return row;
}

/** Seat the player into a free seat if they aren't already in the game. */
async function autoJoin(env: Env, game: GameRow, user: SessionUser, mem: MemberRow[]): Promise<MemberRow[]> {
  if (mem.some((m) => m.user_id === user.id)) return mem;
  const taken = new Set(mem.map((m) => m.corp_id));
  let seat: string | null = null;
  for (let i = 0; i < game.players; i++) {
    if (!taken.has(`corp-${i}`)) {
      seat = `corp-${i}`;
      break;
    }
  }
  if (!seat) return mem; // game full → spectator
  await env.DB.prepare(
    "INSERT INTO game_players (game_id, corp_id, user_id, display_name, joined_ts) VALUES (?, ?, ?, ?, ?)",
  ).bind(game.id, seat, user.id, user.username, Date.now()).run();
  return members(env, game.id);
}

// ----- engine reconstruction (AI + human takeover) -----

function buildEngine(game: GameRow, mem: MemberRow[], useAuction: boolean): Engine {
  const base = resolveScenario(game);
  const baseBots = base.bots ?? ["balanced"];
  const bots: string[] = [];
  for (let i = 0; i < game.players; i++) bots[i] = baseBots[i % baseBots.length]!;
  const config = loadScenario({ ...base, id: game.scenario, players: game.players, bots });
  const engine = new Engine(config, game.seed, defaultRegistry(), { openingAuction: useAuction });
  // Make seated corps human-controllable; name them after their player.
  const nameByCorp = new Map(mem.map((m) => [m.corp_id, m.display_name]));
  for (const m of mem) engine.makeHybrid(m.corp_id);
  // Charter identities (review Section 5): applied from their recorded pick turn, so the
  // event-sourced replay re-derives every earlier turn identically.
  for (const m of mem) {
    if (m.charter && CHARTER_TYPES.includes(m.charter as CharterType)) {
      engine.setCharter(m.corp_id, m.charter as CharterType, m.charter_turn ?? 0);
    }
  }
  engine.corps.forEach((c, i) => {
    c.name = nameByCorp.get(c.id) ?? CHARTER_NAMES[i] ?? c.name;
  });
  return engine;
}

function reconstruct(
  game: GameRow,
  mem: MemberRow[],
  orders: Map<number, Map<string, Order[]>>,
  instants: InstantLog,
): { engine: Engine; reports: TurnReport[] } {
  // An auction-era game has bids stored at turn 0 (or is mid-bidding in the "auction" phase).
  // Legacy games predate the auction and assign homes deterministically at construction.
  const useAuction = game.phase === "auction" || orders.has(0);
  const engine = buildEngine(game, mem, useAuction);
  const reports: TurnReport[] = [];
  // Opening Inner Ring auction (Section 05): once resolved (phase advanced past "auction"), replay
  // the sealed bids from turn 0 and assign homes BEFORE turn 1 (no turn-counter shift). While still
  // "auction", homes stay unassigned — buildClientState serves the pre-auction galaxy for the bid UI.
  if (useAuction && game.phase !== "auction") {
    const bids = orders.get(0);
    for (const m of mem) {
      const b = bids?.get(m.corp_id)?.find((o) => o.kind === "bid") as BidOrder | undefined;
      engine.setHumanBid(m.corp_id, b ?? null);
    }
    engine.stepAuction();
  }
  for (let t = 1; t <= game.turn; t++) {
    // Instant actions recorded during turn t's planning window precede turn t's resolution.
    applyInstants(engine, instants.get(t));
    const to = orders.get(t);
    for (const m of mem) engine.setHumanOrders(m.corp_id, to?.get(m.corp_id) ?? null);
    reports.push(engine.stepTurn());
  }
  // The live planning window's instants, so the served state (and the next stepTurn) sees them.
  applyInstants(engine, instants.get(game.turn + 1));
  return { engine, reports };
}

// ----- state builders -----

function spectatorState(game: GameRow, mem: MemberRow[], user: SessionUser, turn: number, phase: GamePhase): ClientState {
  const players: ClientPlayer[] = mem.map((m) => ({
    corpId: m.corp_id,
    name: m.display_name,
    isYou: m.user_id === user.id,
    submitted: false,
  }));
  return {
    gameId: game.id,
    scenarioId: game.scenario,
    rulesetVersion: RULESET_VERSION,
    turn,
    phase,
    totalTurns: TOTAL_TURNS,
    humanCorpId: "corp-0",
    prices: { ...BASE_CONFIG.tuning.basePrices },
    marketPressure: marketPressureFrom(BASE_CONFIG.tuning, [], []),
    listedResources: [],
    systems: [],
    routes: [],
    corps: [],
    convoys: [],
    movementLog: [],
    contacts: [],
    wars: [],
    claimedSecrets: {},
    warTariff: 0,
    outcome: { standings: [], over: phase === "over", decisive: false, winnerId: null, victoryType: null },
    reports: [],
    mySeat: null,
    isHost: false,
    players,
    totalSeats: game.players,
    submittedCount: 0,
  };
}

async function stateFor(env: Env, game: GameRow, user: SessionUser, mem: MemberRow[]): Promise<ClientState> {
  const mySeat = mem.find((m) => m.user_id === user.id)?.corp_id ?? null;
  const orders = await loadOrders(env, game.id);
  const { engine, reports } = reconstruct(game, mem, orders, await loadInstants(env, game.id));
  const phase = gamePhase(engine);
  if (!mySeat) return spectatorState(game, mem, user, engine.currentTurn, phase);

  // During the opening auction the submission window is the sealed-bid round (stored at turn 0);
  // otherwise it's the upcoming turn's orders.
  const upcoming = orders.get(phase === "auction" ? 0 : game.turn + 1) ?? new Map<string, Order[]>();
  const players: ClientPlayer[] = mem.map((m) => ({
    corpId: m.corp_id,
    name: m.display_name,
    isYou: m.user_id === user.id,
    submitted: upcoming.has(m.corp_id),
  }));
  // Phase B: feed every seat's locked orders for the upcoming turn so the client can show the
  // fogged market-pressure signal (aggregate direction only — never per-rival data). No market
  // signal during the auction (those submissions are bids, not market orders).
  const base = buildClientState(engine, mySeat, game.id, reports, {
    lockedOrders: (phase === "auction" ? new Map<string, Order[]>() : upcoming).values(),
  });
  return {
    ...base,
    phase,
    mySeat,
    isHost: false,
    players,
    totalSeats: game.players,
    submittedCount: players.filter((p) => p.submitted).length,
  };
}

// ----- route handlers -----

async function getState(env: Env, user: SessionUser): Promise<Response> {
  let game = await activeGame(env);
  if (!game) game = await createGlobalGame(env, user);
  let mem = await members(env, game.id);
  if (game.phase !== "over") mem = await autoJoin(env, game, user, mem);
  return json(await stateFor(env, game, user, mem));
}

async function startNew(env: Env, user: SessionUser): Promise<Response> {
  const game = await activeGame(env);
  // A fresh global game may be started once the current one has ended.
  if (game) {
    const mem = await members(env, game.id);
    const over = reconstruct(game, mem, await loadOrders(env, game.id), await loadInstants(env, game.id)).engine.isOver;
    if (!over) return json({ error: "in_progress" }, 409);
    await env.DB.prepare("UPDATE games SET status='ended', updated_ts=? WHERE id=?").bind(Date.now(), game.id).run();
  }
  const fresh = await createGlobalGame(env, user);
  return json(await stateFor(env, fresh, user, await members(env, fresh.id)));
}

/** One-time charter-type pick (review Section 5). Takes effect from the NEXT resolved turn. */
async function pickCharter(request: Request, env: Env, user: SessionUser): Promise<Response> {
  const game = await activeGame(env);
  if (!game) return json({ error: "no_game" }, 404);
  let mem = await members(env, game.id);
  const mine = mem.find((m) => m.user_id === user.id);
  if (!mine) return json({ error: "not_in_game" }, 403);
  const body = await readJson(request);
  const charter = body?.charter as string | undefined;
  if (!charter || !CHARTER_TYPES.includes(charter as CharterType)) return json({ error: "bad_charter" }, 400);
  if (!mine.charter) {
    await env.DB.prepare(
      "UPDATE game_players SET charter=?, charter_turn=? WHERE game_id=? AND corp_id=? AND charter IS NULL",
    ).bind(charter, game.turn + 1, game.id, mine.corp_id).run();
    mem = await members(env, game.id);
  }
  return json(await stateFor(env, game, user, mem));
}

/**
 * Instant Exchange action (ruleset v10): validate against the CURRENT reconstructed state
 * (including earlier instants this window), then append it to the instant log — replay
 * re-derives it. Returns fresh state on success, or { error: "rejected", reason }.
 */
async function instantAction(request: Request, env: Env, user: SessionUser): Promise<Response> {
  const game = await activeGame(env);
  if (!game) return json({ error: "no_game" }, 404);
  const mem = await members(env, game.id);
  const mine = mem.find((m) => m.user_id === user.id);
  if (!mine) return json({ error: "not_in_game" }, 403);

  const body = await readJson(request);
  const kind = body?.kind as InstantAction["kind"];
  const resource = body?.resource as Resource;
  const quantity = Math.floor(Number(body?.quantity));
  const systemId = String(body?.systemId ?? "");
  if (!["buy", "sell", "dispatch"].includes(kind) || typeof resource !== "string" || !Number.isFinite(quantity) || quantity <= 0) {
    return json({ error: "bad_request" }, 400);
  }
  if (kind !== "sell" && !systemId) return json({ error: "bad_request" }, 400);
  const action: InstantAction = kind === "sell" ? { kind, resource, quantity } : { kind, resource, quantity, systemId };

  const { engine } = reconstruct(game, mem, await loadOrders(env, game.id), await loadInstants(env, game.id));
  if (engine.isOver) return json({ error: "rejected", reason: "the match is over" }, 400);
  const reason = runInstant(engine, mine.corp_id, action);
  if (reason) return json({ error: "rejected", reason }, 400);

  const window = game.turn + 1;
  await env.DB.prepare(
    `INSERT INTO game_instants (game_id, turn, seq, corp_id, action_json)
     VALUES (?, ?, COALESCE((SELECT MAX(seq) FROM game_instants WHERE game_id=? AND turn=?), 0) + 1, ?, ?)`,
  ).bind(game.id, window, game.id, window, mine.corp_id, JSON.stringify(action)).run();

  // Race guard: if another player's submit resolved the turn between validation and insert,
  // this action would retroactively precede an already-reported resolution — withdraw it.
  const now = await env.DB.prepare("SELECT turn FROM games WHERE id=?").bind(game.id).first<{ turn: number }>();
  if (!now || now.turn !== game.turn) {
    await env.DB.prepare("DELETE FROM game_instants WHERE game_id=? AND turn=? AND corp_id=? AND action_json=?")
      .bind(game.id, window, mine.corp_id, JSON.stringify(action)).run();
    return json({ error: "rejected", reason: "the turn just resolved — try again" }, 409);
  }

  return json(await stateFor(env, game, user, mem));
}

async function submit(request: Request, env: Env, user: SessionUser): Promise<Response> {
  const game = await activeGame(env);
  if (!game) return json({ error: "no_game" }, 404);
  let mem = await members(env, game.id);
  const mine = mem.find((m) => m.user_id === user.id);
  if (!mine) return json({ error: "not_in_game" }, 403);
  if (reconstruct(game, mem, await loadOrders(env, game.id), await loadInstants(env, game.id)).engine.isOver) {
    return json(await stateFor(env, game, user, mem));
  }

  const body = await readJson(request);
  const list = (body?.orders as Order[]) ?? [];

  // Opening Inner Ring auction (Section 05): the first submission window collects sealed bids,
  // stored at turn 0. The auction resolves — homes assigned — once every seated human has bid; this
  // does NOT advance the turn counter (turn 1 stays the first playable turn).
  if (game.phase === "auction") {
    await env.DB.prepare(
      "INSERT OR REPLACE INTO game_orders (game_id, turn, corp_id, orders_json) VALUES (?, 0, ?, ?)",
    ).bind(game.id, mine.corp_id, JSON.stringify(list)).run();
    const bids = (await loadOrders(env, game.id)).get(0) ?? new Map<string, Order[]>();
    if (!mem.every((m) => bids.has(m.corp_id))) {
      return json(await stateFor(env, game, user, mem)); // waiting for other bidders
    }
    // All seated humans have bid → resolve. The phase guard makes the flip idempotent under
    // concurrent submits; reconstruct() then replays the bids and seats every charter.
    await env.DB.prepare(
      "UPDATE games SET phase='play', updated_ts=? WHERE id=? AND phase='auction'",
    ).bind(Date.now(), game.id).run();
    return json(await stateFor(env, { ...game, phase: "play" }, user, mem));
  }

  const upcomingTurn = game.turn + 1;
  await env.DB.prepare(
    "INSERT OR REPLACE INTO game_orders (game_id, turn, corp_id, orders_json) VALUES (?, ?, ?, ?)",
  ).bind(game.id, upcomingTurn, mine.corp_id, JSON.stringify(list)).run();

  const orders = await loadOrders(env, game.id);
  const upcoming = orders.get(upcomingTurn) ?? new Map<string, Order[]>();
  if (!mem.every((m) => upcoming.has(m.corp_id))) {
    return json(await stateFor(env, game, user, mem)); // waiting for others
  }

  // reconstruct() has already applied the live window's instant buys, so they precede this step.
  const { engine } = reconstruct(game, mem, orders, await loadInstants(env, game.id));
  for (const m of mem) engine.setHumanOrders(m.corp_id, upcoming.get(m.corp_id) ?? null);
  engine.stepTurn();
  const newTurn = engine.currentTurn;
  // The game ends at the turn limit or on a decisive monopoly — one charter outlasting all rivals (Section 29).
  const newStatus = engine.outcome.over ? "ended" : "active";

  const upd = await env.DB.prepare(
    "UPDATE games SET turn=?, status=?, updated_ts=? WHERE id=? AND turn=?",
  ).bind(newTurn, newStatus, Date.now(), game.id, game.turn).run();
  if (upd.meta.changes === 0) {
    const fresh = await activeGame(env);
    return json(fresh ? await stateFor(env, fresh, user, await members(env, fresh.id)) : await stateFor(env, game, user, mem));
  }
  return json(await stateFor(env, { ...game, turn: newTurn, status: newStatus }, user, mem));
}
