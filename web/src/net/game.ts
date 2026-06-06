import type { ClientState, Order } from "@engine";

async function req(path: string, method: "GET" | "POST", body?: unknown): Promise<ClientState> {
  const res = await fetch(path, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return (await res.json()) as ClientState;
}

/** Fetch the global game's state for this player (auto-joins an open seat; used for polling). */
export const fetchState = (): Promise<ClientState> => req("/api/game", "GET");

/** Submit this turn's orders. Resolves once every seated human has submitted. */
export const submitOrders = (orders: Order[]): Promise<ClientState> =>
  req("/api/game/submit", "POST", { orders });

/** Start a fresh global game (only once the current one has ended). */
export const newGame = (): Promise<ClientState> => req("/api/game/new", "POST");
