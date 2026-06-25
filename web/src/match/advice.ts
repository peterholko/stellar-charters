/**
 * Positive "what to do now" coaching — the counterpart to warnings.ts. Reads the player's own
 * (fog-cleared) view + staged state and surfaces a few concrete next actions for their credits,
 * resources, convoys, and ships, each with a one-click jump. Keeps a confused human moving.
 */
import type { PlayerView, Resource } from "@engine";
import type { AppState } from "./store";
import { store } from "./store";
import { formatCr, resourceLabels } from "./format";
import type { IconName } from "../ui/icons";

export interface Advice {
  id: string;
  icon: IconName;
  tone: "accent" | "positive" | "neutral";
  title: string;
  body: string;
  action?: { label: string; run: () => void };
}

export function buildAdvice(view: PlayerView, state: AppState): Advice[] {
  const me = view.me;
  const out: Advice[] = [];
  const submitted = state.players.find((p) => p.isYou)?.submitted ?? false;

  // 1) Resources sitting idle in an owned system → sell them (the most common "what now?").
  let bestStock: { sysId: string; resource: Resource; qty: number } | null = null;
  for (const sid of me.ownedSystemIds) {
    const sys = view.galaxy.systems.get(sid);
    if (!sys || !sys.stockpile) continue;
    for (const r of state.listedResources) {
      const q = Math.floor(sys.stockpile[r] ?? 0);
      const routed = state.standingRoutes.some((x) => x.originSystemId === sid && x.resource === r && x.enabled);
      if (q > 0 && !routed && (!bestStock || q > bestStock.qty)) bestStock = { sysId: sid, resource: r, qty: q };
    }
  }
  if (bestStock) {
    const bs = bestStock;
    const sysName = view.galaxy.systems.get(bs.sysId)?.name ?? bs.sysId;
    out.push({
      id: "sell", icon: "exchange", tone: "accent",
      title: `Sell your ${resourceLabels[bs.resource]}`,
      body: `${sysName} is holding ${bs.qty} ${resourceLabels[bs.resource]}. Ship it to the Exchange for credits — an export pays out when its convoy reaches the Hub.`,
      action: { label: "Open Exchange", run: () => { store.select({ kind: "system", id: bs.sysId }); store.setNav("exchange"); } },
    });
  }

  // 1b) Or automate it — a standing route ships it every turn without further orders.
  if (state.standingRouteSuggestion && !submitted) {
    const s = state.standingRouteSuggestion;
    const sysName = view.galaxy.systems.get(s.originSystemId)?.name ?? s.originSystemId;
    out.push({
      id: "automate", icon: "convoys", tone: "positive",
      title: "Automate a trade route",
      body: `Set up a standing route so ${sysName}'s ${resourceLabels[s.resource]} ships to the Exchange every turn — no more manual selling.`,
      action: { label: "Set it up", run: () => store.setNav("convoys") },
    });
  }

  // 2) Convoys in transit — reassure the player their shipments are working.
  const myConvoys = view.convoys.filter((c) => c.owner === me.id);
  if (myConvoys.length > 0) {
    out.push({
      id: "convoy", icon: "convoys", tone: "neutral",
      title: `${myConvoys.length} convoy${myConvoys.length > 1 ? "s" : ""} on the move`,
      body: "Your shipments cross one lane per turn and pay out (or deliver) on arrival. They're raid targets, so station a warship to escort the exposed ones.",
      action: { label: "View convoys", run: () => store.setNav("convoys") },
    });
  }

  // 3) Idle ships — surveyors scout, warships escort/raid.
  const idleScout = me.ships.filter((s) => s.surveyor && !s.transit && s.stationedAt);
  const idleWar = me.ships.filter((s) => s.combat > 0 && !s.transit && s.stationedAt);
  if (idleScout.length > 0) {
    out.push({
      id: "scout", icon: "radar", tone: "accent",
      title: "Scout with your survey vessel",
      body: "Dispatch your survey skiff to reveal a system's deposits (richness + reserves). Select it on the map, then click a target system.",
      action: { label: "Open map", run: () => store.setNav("map") },
    });
  } else if (idleWar.length > 0) {
    out.push({
      id: "fleet", icon: "fleet", tone: "neutral",
      title: "Your warships are idle",
      body: "Move a fleet to escort your trade, hold a chokepoint, or raid a rival. Select the fleet on the map, then click a destination.",
      action: { label: "Open map", run: () => store.setNav("map") },
    });
  }

  // 4) Spare credits — expand, build, or pressure a rival.
  if (me.credits >= 1200 && !submitted) {
    out.push({
      id: "credits", icon: "wallet", tone: "neutral",
      title: `${formatCr(me.credits)} to put to work`,
      body: "Claim an open system to grow production, build a ship in the shipyard, or buy shares in a rival to build takeover pressure.",
      action: { label: "Find a claim", run: () => store.setNav("map") },
    });
  }

  // 5) Nothing planned yet.
  if (state.staged.length === 0 && !submitted && out.length < 2) {
    out.push({
      id: "plan", icon: "send", tone: "neutral",
      title: "Plan your turn",
      body: "You haven't queued any orders. Pick an action above, then review and submit on the Turn screen.",
      action: { label: "Go to Turn", run: () => store.setNav("turn") },
    });
  }

  return out.slice(0, 4);
}
