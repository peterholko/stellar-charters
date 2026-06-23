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
export const pickCharter = (charter: string): Promise<ClientState> =>
  req("/api/game/charter", "POST", { charter });

export const newGame = (): Promise<ClientState> => req("/api/game/new", "POST");

/** An instant Exchange action (ruleset v10): buy (to warehouse or a system), sell (from the
 *  warehouse), or dispatch (warehouse → one of your systems). */
export type InstantActionRequest =
  | { kind: "buy"; resource: string; quantity: number; systemId: string }
  | { kind: "sell"; resource: string; quantity: number }
  | { kind: "dispatch"; resource: string; quantity: number; systemId: string };

/** Execute an instant Exchange action at click time. Throws an Error whose message is the
 *  human-readable rejection reason when the server refuses it. */
export async function instantAction(body: InstantActionRequest): Promise<ClientState> {
  const res = await fetch("/api/game/instant", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let reason = `instant action failed (${res.status})`;
    try {
      const j = (await res.json()) as { reason?: string };
      if (j.reason) reason = j.reason;
    } catch { /* non-JSON error body — keep the status message */ }
    throw new Error(reason);
  }
  return (await res.json()) as ClientState;
}
