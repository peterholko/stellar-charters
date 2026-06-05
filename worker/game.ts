/**
 * Server-authoritative game: create / resume / resolve a match in the Worker.
 *
 * Persistence is event-sourced — a game row (seed + scenario + turn) plus the log of the
 * human's orders per turn. The deterministic engine is reconstructed by replaying that
 * log, so a browser refresh resumes the exact state and rivals never leak (the client
 * only ever receives a redacted ClientState).
 */
import {
  Engine,
  HumanBot,
  buildClientState,
  defaultRegistry,
  gamePhase,
  loadScenario,
  type ClientState,
  type Order,
  type Scenario,
  type TurnReport,
} from "../src/engine/index.js";
import scenarioJson from "../scenarios/inner-ring-8p.json";
import { currentUser, json, readJson, type Env } from "./session.js";

const SCENARIO_ID = "inner-ring-8p";
const DEFAULT_PLAYERS = 4;
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

interface GameRow {
  id: string;
  user_id: string;
  seed: number;
  scenario: string;
  players: number;
  human_corp: string;
  turn: number;
  phase: string;
  status: string;
}

export async function handleGame(request: Request, env: Env, url: URL): Promise<Response> {
  const user = await currentUser(request, env);
  if (!user) return json({ error: "unauthenticated" }, 401);

  const p = url.pathname;
  if (p === "/api/game" && request.method === "POST") return ensure(env, user.id);
  if (p === "/api/game/new" && request.method === "POST") return startNew(env, user.id);
  const orderMatch = p.match(/^\/api\/game\/([^/]+)\/orders$/);
  if (orderMatch && request.method === "POST") return submit(request, env, user.id, orderMatch[1]!);
  return json({ error: "not_found" }, 404);
}

// ----- engine construction & replay -----

function buildEngine(seed: number, players: number): { engine: Engine; human: HumanBot; humanCorpId: string } {
  const base = scenarioJson as unknown as Scenario;
  const bots = [...(base.bots ?? ["balanced"])];
  bots[0] = "human";
  const scenario: Scenario = { ...base, players, bots };
  const config = loadScenario(scenario);
  const human = new HumanBot();
  const registry = defaultRegistry();
  registry.set("human", () => human);
  const engine = new Engine(config, seed, registry);
  engine.corps.forEach((c, i) => {
    c.name = CHARTER_NAMES[i] ?? c.name;
  });
  return { engine, human, humanCorpId: "corp-0" };
}

/** Replay the order log to reconstruct the authoritative engine at `game.turn`. */
function reconstruct(
  game: GameRow,
  orders: Map<number, string>,
): { engine: Engine; human: HumanBot; humanCorpId: string; reports: TurnReport[] } {
  const { engine, human, humanCorpId } = buildEngine(game.seed, game.players);
  const reports: TurnReport[] = [];
  for (let t = 1; t <= game.turn; t++) {
    const parsed = JSON.parse(orders.get(t) ?? "[]");
    human.pendingOrders = (Array.isArray(parsed) ? parsed : []) as Order[];
    reports.push(engine.stepTurn());
  }
  return { engine, human, humanCorpId, reports };
}

// ----- D1 helpers -----

async function activeGame(env: Env, userId: string): Promise<GameRow | null> {
  return env.DB.prepare(
    "SELECT * FROM games WHERE user_id = ? AND status = 'active' ORDER BY updated_ts DESC LIMIT 1",
  ).bind(userId).first<GameRow>();
}

async function gameForUser(env: Env, gameId: string, userId: string): Promise<GameRow | null> {
  return env.DB.prepare("SELECT * FROM games WHERE id = ? AND user_id = ?").bind(gameId, userId).first<GameRow>();
}

async function loadOrders(env: Env, gameId: string): Promise<Map<number, string>> {
  const rows = await env.DB.prepare("SELECT turn, orders_json FROM game_orders WHERE game_id = ?").bind(gameId).all<{
    turn: number;
    orders_json: string;
  }>();
  const map = new Map<number, string>();
  for (const r of rows.results ?? []) map.set(r.turn, r.orders_json);
  return map;
}

async function createGame(env: Env, userId: string): Promise<GameRow> {
  const now = Date.now();
  const row: GameRow = {
    id: crypto.randomUUID(),
    user_id: userId,
    seed: crypto.getRandomValues(new Uint32Array(1))[0]! & 0x7fffffff,
    scenario: SCENARIO_ID,
    players: DEFAULT_PLAYERS,
    human_corp: "corp-0",
    turn: 0,
    phase: "play",
    status: "active",
  };
  await env.DB.prepare(
    `INSERT INTO games (id, user_id, seed, scenario, players, human_corp, turn, phase, status, created_ts, updated_ts)
     VALUES (?, ?, ?, ?, ?, ?, 0, 'play', 'active', ?, ?)`,
  ).bind(row.id, row.user_id, row.seed, row.scenario, row.players, row.human_corp, now, now).run();
  return row;
}

// ----- route handlers -----

async function stateOf(env: Env, game: GameRow): Promise<ClientState> {
  const orders = await loadOrders(env, game.id);
  const { engine, humanCorpId, reports } = reconstruct(game, orders);
  return buildClientState(engine, humanCorpId, game.id, reports);
}

async function ensure(env: Env, userId: string): Promise<Response> {
  const game = (await activeGame(env, userId)) ?? (await createGame(env, userId));
  return json(await stateOf(env, game));
}

async function startNew(env: Env, userId: string): Promise<Response> {
  const existing = await activeGame(env, userId);
  if (existing) {
    await env.DB.prepare("UPDATE games SET status = 'ended', updated_ts = ? WHERE id = ?")
      .bind(Date.now(), existing.id).run();
  }
  const game = await createGame(env, userId);
  return json(await stateOf(env, game));
}

async function submit(request: Request, env: Env, userId: string, gameId: string): Promise<Response> {
  const game = await gameForUser(env, gameId, userId);
  if (!game) return json({ error: "not_found" }, 404);
  if (game.status === "ended" || game.phase === "over") {
    return json(await stateOf(env, game)); // nothing to resolve
  }

  const body = await readJson(request);
  const orders = await loadOrders(env, game.id);
  const { engine, human, humanCorpId, reports } = reconstruct(game, orders);

  const nextTurn = game.turn + 1;
  const list = (body?.orders as Order[]) ?? [];
  human.pendingOrders = list;
  const report = engine.stepTurn();
  const submittedJson = JSON.stringify(list);
  reports.push(report);

  const now = Date.now();
  const newTurn = engine.currentTurn;
  const newPhase = gamePhase(engine);
  const newStatus = engine.isOver ? "ended" : "active";

  // Guarded write: only one resolution per turn (idempotent against double-submit).
  const upd = await env.DB.prepare(
    "UPDATE games SET turn = ?, phase = ?, status = ?, updated_ts = ? WHERE id = ? AND turn = ?",
  ).bind(newTurn, newPhase, newStatus, now, game.id, game.turn).run();
  if (upd.meta.changes === 0) {
    // Someone already advanced this game; return the freshest state.
    const fresh = await gameForUser(env, gameId, userId);
    return json(fresh ? await stateOf(env, fresh) : await stateOf(env, game));
  }
  await env.DB.prepare(
    "INSERT OR REPLACE INTO game_orders (game_id, turn, orders_json) VALUES (?, ?, ?)",
  ).bind(game.id, nextTurn, submittedJson).run();

  return json(buildClientState(engine, humanCorpId, game.id, reports));
}
