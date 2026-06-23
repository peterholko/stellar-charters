/**
 * Warnings with horizons (review Section 12.5): computed client-side from the player's own
 * (fog-of-war-cleared) view. Every warning names its one-click remedy — a fix the player can
 * dispatch without hunting through screens.
 */
import { canHostPopulation, canRaidRoute, coloniesOf, type PlayerView } from "@engine";
import { store } from "./store";
import { resourceLabels } from "./format";

export interface Warning {
  tone: "warn" | "bad";
  title: string;
  body: string;
  /** The one-click remedy. */
  fix?: { label: string; run: () => void };
}

export function buildWarnings(view: PlayerView): Warning[] {
  const t = view.config.tuning;
  const me = view.me;
  const out: Warning[] = [];

  for (const sysId of me.ownedSystemIds) {
    const sys = view.galaxy.systems.get(sysId);
    if (!sys) continue;

    // Food / ice horizons: stockpile ÷ current population draw (approximate — local production
    // also tops it up, so phrase as "at current need"). One population per system (Section 10).
    const populated = coloniesOf(sys).some((c) => canHostPopulation(c));
    const foodNeed = populated ? t.foodNeed[sys.populationStage] : 0;
    const iceNeed = populated ? t.iceNeed[sys.populationStage] : 0;
    for (const [res, need] of [["food", foodNeed], ["ice", iceNeed]] as const) {
      if (need <= 0) continue;
      const horizon = sys.stockpile[res] / need;
      if (horizon < 4) {
        out.push({
          tone: horizon < 2 ? "bad" : "warn",
          title: `${sys.name} ${resourceLabels[res].toLowerCase()} covers ~${Math.max(0, Math.floor(horizon))} turn${Math.floor(horizon) === 1 ? "" : "s"}`,
          body: `Pop draws ${need.toFixed(1)}/turn; shortfalls auto-import at a premium and stall growth.`,
          fix: { label: `Import ${resourceLabels[res].toLowerCase()}`, run: () => { store.select({ kind: "system", id: sys.id }); store.setNav("exchange"); } },
        });
      }
    }

    // Brown-out: the throttle is a hard, loud state with its factor and its fix (design rule #2).
    const prod = sys.production;
    if (prod && prod.powerFactor < 1) {
      out.push({
        tone: prod.powerFactor < 0.6 ? "bad" : "warn",
        title: `${sys.name} browned out ×${prod.powerFactor.toFixed(2)}`,
        body: `Processors are power-throttled — every recipe runs at ${Math.round(prod.powerFactor * 100)}%.`,
        fix: { label: "Build reactor", run: () => store.stage({ kind: "buildReactor", systemId: sys.id }) },
      });
    }
    for (const lim of prod?.limited ?? []) {
      out.push({
        tone: "warn",
        title: `${sys.name} ${lim.recipeId} ran ×${lim.ratio.toFixed(2)}`,
        body: `Limited by ${resourceLabels[lim.input].toLowerCase()} — feed the chain or it idles.`,
        fix: { label: `Buy ${resourceLabels[lim.input].toLowerCase()}`, run: () => { store.select({ kind: "system", id: sys.id }); store.setNav("exchange"); } },
      });
    }
  }

  // Debt service vs income (Section 17).
  if (me.debt > 0) {
    const interest = me.debt * t.debtInterest;
    const income = me.recentEarnings.length
      ? me.recentEarnings.reduce((s, e) => s + e, 0) / me.recentEarnings.length
      : 0;
    if (interest > Math.max(0, income)) {
      out.push({
        tone: "bad",
        title: `Debt service exceeds income`,
        body: `Interest accrues ${Math.round(interest)}/turn against ~${Math.round(income)}/turn earnings.`,
        fix: { label: "Open Finance", run: () => store.setNav("finance") },
      });
    }
  }

  // Expired lane traps (Section 13): an interdiction covers one resolution only. The turn
  // after it fires, offer a one-click renewal — provided the lane is still in raid reach
  // and the trap hasn't already been re-staged.
  for (const routeId of store.expiredInterdicts()) {
    if (store.state.staged.some((s) => s.order.kind === "interdict" && s.order.routeId === routeId)) continue;
    const route = view.galaxy.routes.get(routeId);
    if (!route || !canRaidRoute(view.galaxy, me, route)) continue;
    const name = (id: string) => view.galaxy.systems.get(id)?.name ?? id;
    const traffic = view.galaxy.recentTraffic(routeId, view.turn);
    out.push({
      tone: "warn",
      title: `Lane trap expired: ${name(route.a)} ↔ ${name(route.b)}`,
      body: `Interdictions last one turn. ${traffic > 0 ? `${traffic} convoy${traffic === 1 ? "" : "s"} used this lane in the last 5 turns.` : "The lane is currently quiet."}`,
      fix: { label: "Renew interdiction", run: () => store.stage({ kind: "interdict", routeId }) },
    });
  }

  // Distress floor (Section 18): falling under it costs the charter.
  if (me.hasCharter && me.credits < t.distressCreditFloor * 2) {
    out.push({
      tone: me.credits < t.distressCreditFloor ? "bad" : "warn",
      title: `Credits near the distress floor`,
      body: `${Math.round(me.credits)} Cr on hand; below ${t.distressCreditFloor} Cr the charter is liquidated.`,
      fix: { label: "Open Finance", run: () => store.setNav("finance") },
    });
  }

  return out;
}
