import { bodyTypeOfKey, factoryCostMult, primaryBodyKey, type Order, type PlayerView } from "@engine";
import { resourceLabels } from "./format";

export type OrderTone = "build" | "trade" | "raid" | "finance" | "research" | "claim";

export interface OrderInfo {
  label: string;
  detail: string;
  /** Upfront credit commitment this turn (negative = credits gained, e.g. borrow). */
  cost: number;
  tone: OrderTone;
  /** Validity / affordability warning, if any. */
  warn?: string;
}

/**
 * Client-side preview of an order's cost + a human label, derived entirely from the
 * engine's tuning (`view.config.tuning`) so the Order Tray total matches what the engine
 * will actually charge. The engine remains the source of truth — this only previews.
 */
export function describeOrder(order: Order, view: PlayerView): OrderInfo {
  const t = view.config.tuning;
  const g = view.galaxy;
  const name = (id: string) => {
    try {
      return g.system(id).name;
    } catch {
      return id;
    }
  };

  switch (order.kind) {
    case "market": {
      const price = view.market.prices[order.resource];
      if (order.side === "buy") {
        const cost = Math.round(order.quantity * price);
        return {
          label: `Buy ${order.quantity} ${resourceLabels[order.resource]}`,
          detail: `to ${name(order.systemId)} · ~${price.toFixed(0)} cr/u${order.strict ? " · strict" : ""}`,
          cost,
          tone: "trade",
        };
      }
      const sys = g.systems.get(order.systemId);
      const have = sys ? sys.stockpile[order.resource] : 0;
      return {
        label: `Sell ${order.quantity} ${resourceLabels[order.resource]}`,
        detail: `from ${name(order.systemId)} · ~${price.toFixed(0)} cr/u · paid on arrival`,
        cost: 0,
        tone: "trade",
        warn: have < order.quantity ? `Only ${Math.floor(have)} in local stock` : undefined,
      };
    }
    case "transfer":
      return {
        label: `Transfer ${order.quantity} ${resourceLabels[order.resource]}`,
        detail: `${name(order.fromSystemId)} → ${name(order.toSystemId)}`,
        cost: 0,
        tone: "trade",
      };
    case "claim":
      return {
        label: `Claim ${name(order.systemId)}`,
        detail: `register charter rights`,
        cost: order.amount,
        tone: "claim",
      };
    case "survey":
      return {
        label: "Survey warp route",
        detail: "chart a frontier lane",
        cost: t.surveyCost,
        tone: "build",
      };
    case "buildShip": {
      const base = t.shipCost[order.rangeTier] + (order.raider ? t.raiderShipExtraCost : 0);
      const isoNeed = t.shipIsotopeCost[order.rangeTier];
      const isoBill = isoNeed * view.market.prices.rareIsotopes;
      return {
        label: `Build Range-${order.rangeTier} ${order.raider ? "raider" : "escort"}`,
        detail: `at ${name(order.systemId)}${isoNeed ? ` · ${isoNeed} isotopes` : ""}`,
        cost: Math.round(base + isoBill),
        tone: "build",
        warn: order.rangeTier > view.me.rangeTier ? `Needs Range ${order.rangeTier} tech` : undefined,
      };
    }
    case "researchRange":
      return {
        label: `Research Range ${order.targetTier}`,
        detail: "unlock deeper warp drives",
        cost: t.rangeResearchCost[order.targetTier],
        tone: "research",
      };
    case "hirePrivateer":
      return {
        label: "Hire privateer",
        detail: `based at ${name(order.basedAt)} · ${t.privateerTurns} turns`,
        cost: t.privateerCost,
        tone: "raid",
      };
    case "interdict":
      return { label: "Interdict warp route", detail: "set a trap for next-tick convoys", cost: 0, tone: "raid" };
    case "targetConvoy":
      return { label: "Target convoy", detail: "raid a visible shipment", cost: 0, tone: "raid" };
    case "escort":
      return { label: "Escort convoys", detail: `from ${name(order.systemId)} · +${order.strength}`, cost: 0, tone: "build" };
    case "buildDepot":
      return { label: "Build Trade Depot", detail: `at ${name(order.systemId)}`, cost: t.depotCost, tone: "build" };
    case "buildHydroponics":
      return { label: "Build agri-dome", detail: `at ${name(order.systemId)}`, cost: t.hydroponicsCost, tone: "build" };
    case "buildProcessor": {
      const recipe = t.recipes.find((r) => r.id === order.recipeId);
      const sys = g.systems.get(order.systemId);
      const mult = sys ? factoryCostMult(bodyTypeOfKey(sys, order.bodyKey ?? primaryBodyKey(sys))) : 1;
      return {
        label: `Build ${order.recipeId} factory`,
        detail: `at ${name(order.systemId)} · ${t.buildAlloyCost} alloys`,
        cost: Math.round((recipe?.buildCost ?? 0) * mult),
        tone: "build",
      };
    }
    case "buildReactor":
      return { label: "Build reactor", detail: `at ${name(order.systemId)} · ${t.buildAlloyCost} alloys`, cost: t.reactorCost, tone: "build" };
    case "upgradeInfrastructure": {
      const inf = t.infrastructure;
      const trackLabel = order.track === "mining" ? "Mining rig" : order.track === "habitat" ? "Habitat" : "Power grid";
      const creditBase = order.track === "mining" ? inf.miningCreditCost : order.track === "habitat" ? inf.habitatCreditCost : inf.powerCreditCost;
      const rawLabel = order.track === "mining" ? "metals" : order.track === "habitat" ? "silicates" : "helium-3";
      const rawBase = order.track === "mining" ? inf.miningMetalsCost : order.track === "habitat" ? inf.habitatSilicatesCost : inf.powerHelium3Cost;
      return {
        label: `Upgrade ${trackLabel}`,
        detail: `at ${name(order.systemId)} · ${rawBase}+ ${rawLabel}`,
        cost: creditBase,
        tone: "build",
      };
    }
    case "buildPlatform":
      return { label: "Build defense platform", detail: `at ${name(order.systemId)}`, cost: t.platformCost, tone: "build" };
    case "buildSurveyShip":
      return { label: "Build survey vessel", detail: `at ${name(order.systemId)} — an unarmed scout`, cost: t.surveyShipCost, tone: "build" };
    case "surveySystem":
      return {
        label: `Survey ${name(order.targetSystemId)}`,
        detail: `dispatch a survey vessel from ${name(order.fromSystemId)} — reveals its deposits`,
        cost: 0,
        tone: "build",
      };
    case "assay": {
      const site = g.systems.get(order.systemId)?.sites.find((s) => s.key === order.siteKey);
      const res = site ? resourceLabels[site.resource] : "deposit";
      return {
        label: `Assay ${res} deposit`,
        detail: `survey at ${name(order.systemId)} — reveals its richness & reserves`,
        cost: t.assayCost,
        tone: "build",
      };
    }
    case "buildExtractor": {
      const site = g.systems.get(order.systemId)?.sites.find((s) => s.key === order.siteKey);
      const res = site ? resourceLabels[site.resource] : "deposit";
      const lvl = site?.extractorLevel ?? 0;
      const factor = (lvl + 1) * (1 + (1 - (site?.accessibility ?? 1)) * t.extractor.accessibilityMult);
      return {
        label: lvl > 0 ? `Deepen ${res} extractor` : `Build ${res} extractor`,
        detail: `at ${name(order.systemId)} · Lv ${lvl}→${lvl + 1} · ${t.extractor.alloyCost} alloys`,
        cost: Math.round(t.extractor.buildCost * factor),
        tone: "build",
      };
    }
    case "buyShares": {
      const target = view.corporations.find((c) => c.id === order.targetId);
      const price = target?.sharePrice ?? 0;
      return {
        label: `Buy ${order.shares} shares`,
        detail: `${target?.name ?? order.targetId} · ~${Math.round(price)} cr/share`,
        cost: Math.round(order.shares * price),
        tone: "finance",
      };
    }
    case "borrow":
      return {
        label: "Borrow credits",
        detail: `+${order.amount.toLocaleString()} cr debt`,
        cost: -order.amount,
        tone: "finance",
      };
    case "bid":
      return { label: "Auction bid", detail: `${order.priorities.length} priorities`, cost: 0, tone: "claim" };
    default:
      return { label: "Order", detail: "", cost: 0, tone: "build" };
  }
}
