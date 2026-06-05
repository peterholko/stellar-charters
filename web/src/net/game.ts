import type { ClientState, Order } from "@engine";

async function postJson(path: string, body: unknown): Promise<ClientState> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return (await res.json()) as ClientState;
}

/** Resume the active game, creating one if the player has none. */
export const ensureGame = (): Promise<ClientState> => postJson("/api/game", {});

/** End the active game and start a fresh one. */
export const newGame = (): Promise<ClientState> => postJson("/api/game/new", {});

export const submitOrders = (gameId: string, orders: Order[]): Promise<ClientState> =>
  postJson(`/api/game/${gameId}/orders`, { orders });
