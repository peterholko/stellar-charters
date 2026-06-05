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
  PROCEDURAL_SCENARIO_ID,
  buildClientState,
  defaultRegistry,
  gamePhase,
  generateProceduralScenario,
  loadScenario,
  type ClientPlayer,
  type ClientState,
  type Order,
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
}

export async function handleGame(request: Request, env: Env, url: URL): Promise<Response> {
  const user = await currentUser(request, env);
  if (!user) return json({ error: "unauthenticated" }, 401);
  const p = url.pathname;
  const m = request.method;
  if (p === "/api/game" && (m === "GET" || m === "POST")) return getState(env, user);
  if (p === "/api/game/submit" && m === "POST") return submit(request, env, user);
  if (p === "/api/game/new" && m === "POST") return startNew(env, user);
  return json({ error: "not_found" }, 404);
}

// ----- DB helpers -----

async function activeGame(env: Env): Promise<GameRow | null> {
  return env.DB.prepare("SELECT * FROM games WHERE status='active' ORDER BY created_ts DESC LIMIT 1").first<GameRow>();
}

async function members(env: Env, gameId: string): Promise<MemberRow[]> {
  const r = await env.DB.prepare(
    "SELECT corp_id, user_id, display_name FROM game_players WHERE game_id=? ORDER BY corp_id",
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

async function createGlobalGame(env: Env, creator: SessionUser): Promise<GameRow> {
  const now = Date.now();
  const row: GameRow = {
    id: crypto.randomUUID(),
    seed: crypto.getRandomValues(new Uint32Array(1))[0]! & 0x7fffffff,
    scenario: SCENARIO_ID,
    players: TOTAL_SEATS,
    turn: 0,
    phase: "play",
    status: "active",
  };
  await env.DB.prepare(
    `INSERT INTO games (id, user_id, seed, scenario, players, human_corp, turn, phase, status, host_user_id, created_ts, updated_ts)
     VALUES (?, ?, ?, ?, ?, 'corp-0', 0, 'play', 'active', ?, ?, ?)`,
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

function buildEngine(game: GameRow, mem: MemberRow[]): Engine {
  const base = resolveScenario(game);
  const baseBots = base.bots ?? ["balanced"];
  const bots: string[] = [];
  for (let i = 0; i < game.players; i++) bots[i] = baseBots[i % baseBots.length]!;
  const config = loadScenario({ ...base, id: game.scenario, players: game.players, bots });
  const engine = new Engine(config, game.seed, defaultRegistry());
  // Make seated corps human-controllable; name them after their player.
  const nameByCorp = new Map(mem.map((m) => [m.corp_id, m.display_name]));
  for (const m of mem) engine.makeHybrid(m.corp_id);
  engine.corps.forEach((c, i) => {
    c.name = nameByCorp.get(c.id) ?? CHARTER_NAMES[i] ?? c.name;
  });
  return engine;
}

function reconstruct(
  game: GameRow,
  mem: MemberRow[],
  orders: Map<number, Map<string, Order[]>>,
): { engine: Engine; reports: TurnReport[] } {
  const engine = buildEngine(game, mem);
  const reports: TurnReport[] = [];
  for (let t = 1; t <= game.turn; t++) {
    const to = orders.get(t);
    for (const m of mem) engine.setHumanOrders(m.corp_id, to?.get(m.corp_id) ?? null);
    reports.push(engine.stepTurn());
  }
  return { engine, reports };
}

// ----- state builders -----

function spectatorState(game: GameRow, mem: MemberRow[], user: SessionUser, turn: number, phase: "play" | "over"): ClientState {
  const players: ClientPlayer[] = mem.map((m) => ({
    corpId: m.corp_id,
    name: m.display_name,
    isYou: m.user_id === user.id,
    submitted: false,
  }));
  return {
    gameId: game.id,
    scenarioId: game.scenario,
    turn,
    phase,
    totalTurns: TOTAL_TURNS,
    humanCorpId: "corp-0",
    prices: { ...BASE_CONFIG.tuning.basePrices },
    systems: [],
    routes: [],
    corps: [],
    convoys: [],
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
  const { engine, reports } = reconstruct(game, mem, orders);
  const phase = gamePhase(engine);
  if (!mySeat) return spectatorState(game, mem, user, engine.currentTurn, phase);

  const upcoming = orders.get(game.turn + 1) ?? new Map<string, Order[]>();
  const players: ClientPlayer[] = mem.map((m) => ({
    corpId: m.corp_id,
    name: m.display_name,
    isYou: m.user_id === user.id,
    submitted: upcoming.has(m.corp_id),
  }));
  const base = buildClientState(engine, mySeat, game.id, reports);
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
    const over = reconstruct(game, mem, await loadOrders(env, game.id)).engine.isOver;
    if (!over) return json({ error: "in_progress" }, 409);
    await env.DB.prepare("UPDATE games SET status='ended', updated_ts=? WHERE id=?").bind(Date.now(), game.id).run();
  }
  const fresh = await createGlobalGame(env, user);
  return json(await stateFor(env, fresh, user, await members(env, fresh.id)));
}

async function submit(request: Request, env: Env, user: SessionUser): Promise<Response> {
  const game = await activeGame(env);
  if (!game) return json({ error: "no_game" }, 404);
  let mem = await members(env, game.id);
  const mine = mem.find((m) => m.user_id === user.id);
  if (!mine) return json({ error: "not_in_game" }, 403);
  if (reconstruct(game, mem, await loadOrders(env, game.id)).engine.isOver) {
    return json(await stateFor(env, game, user, mem));
  }

  const body = await readJson(request);
  const list = (body?.orders as Order[]) ?? [];
  const upcomingTurn = game.turn + 1;
  await env.DB.prepare(
    "INSERT OR REPLACE INTO game_orders (game_id, turn, corp_id, orders_json) VALUES (?, ?, ?, ?)",
  ).bind(game.id, upcomingTurn, mine.corp_id, JSON.stringify(list)).run();

  const orders = await loadOrders(env, game.id);
  const upcoming = orders.get(upcomingTurn) ?? new Map<string, Order[]>();
  if (!mem.every((m) => upcoming.has(m.corp_id))) {
    return json(await stateFor(env, game, user, mem)); // waiting for others
  }

  const { engine } = reconstruct(game, mem, orders);
  for (const m of mem) engine.setHumanOrders(m.corp_id, upcoming.get(m.corp_id) ?? null);
  engine.stepTurn();
  const newTurn = engine.currentTurn;
  const newStatus = engine.isOver ? "ended" : "active";

  const upd = await env.DB.prepare(
    "UPDATE games SET turn=?, status=?, updated_ts=? WHERE id=? AND turn=?",
  ).bind(newTurn, newStatus, Date.now(), game.id, game.turn).run();
  if (upd.meta.changes === 0) {
    const fresh = await activeGame(env);
    return json(fresh ? await stateFor(env, fresh, user, await members(env, fresh.id)) : await stateFor(env, game, user, mem));
  }
  return json(await stateFor(env, { ...game, turn: newTurn, status: newStatus }, user, mem));
}
