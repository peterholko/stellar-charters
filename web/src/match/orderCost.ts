import { bodyTypeOfKey, factoryCostMult, previewFleetMove, primaryBodyKey, researchMods, type Order, type PlayerView, type RangeTier, type Resource } from "@engine";
import { extractorNames, hullName, megastructureLabel, resourceLabels } from "./format";

/** "8 alloys + 6 metals" — materials a build consumes besides credits (Section 27). */
function mats(costs: Record<string, number | undefined>): string {
  return Object.entries(costs)
    .filter(([, n]) => (n ?? 0) > 0)
    .map(([r, n]) => `${n} ${(resourceLabels[r as keyof typeof resourceLabels] ?? r).toLowerCase()}`)
    .join(" + ");
}

export type OrderTone = "build" | "trade" | "raid" | "finance" | "research" | "claim";

/** One block-by-block step of a share trade walking the cap table (Section 17). */
export interface ShareFillStep {
  label: string;
  shares: number;
  price: number;
}

export interface ShareTradePreview {
  steps: ShareFillStep[];
  /** Shares that fill within the limit (and absorption caps, for sells). */
  filled: number;
  /** Signed credits: positive = you pay (buy), positive = you receive (sell). */
  total: number;
  /** The block the limit stopped at, if the order can't fully fill. */
  stoppedAt?: string;
  /** Set when the management block gated the fill: it only sells as one whole lot. */
  wholeBlock?: { shares: number; price: number };
}

/**
 * Mirror of the engine's buy cascade (engine.ts resolveEquity): walk the target's cap
 * table cheapest-ask-first — NPC blocks at personality premiums, rival corp stakes and
 * the management block at holdout multiples, all × sentiment and the buyer's takeover
 * research discount — stopping at the limit. Affordability is the caller's problem.
 */
export function previewShareBuy(view: PlayerView, targetId: string, shares: number, limitPrice: number): ShareTradePreview {
  const target = view.corporations.find((c) => c.id === targetId);
  if (!target) return { steps: [], filled: 0, total: 0 };
  const eq = view.config.tuning.equity;
  const tradedBase = target.sharePrice * target.sentiment;
  const discount = view.me.research ? researchMods(view.me.research.completed).acquisitionCostMult : 1;
  const asks: { label: string; ask: number; available: number; wholeBlock?: boolean }[] = [];
  for (const npc of target.npcHolders) {
    const held = target.shareRegister[npc.id] ?? 0;
    if (held > 0) asks.push({ label: npc.name, ask: tradedBase * npc.askPremium, available: held });
  }
  for (const [holder, held] of Object.entries(target.shareRegister)) {
    if (holder.startsWith("npc:") || holder === view.me.id || held <= 0) continue;
    if (holder === target.founderId) {
      asks.push({ label: "management block", ask: tradedBase * eq.managementHoldoutMult, available: held, wholeBlock: true });
    } else {
      const seller = view.corporations.find((c) => c.id === holder);
      asks.push({ label: seller?.name ?? holder, ask: tradedBase * eq.corpHoldoutMult, available: held });
    }
  }
  asks.sort((a, b) => a.ask - b.ask || a.label.localeCompare(b.label));

  // Concentration premium (mirror of resolveEquity): the marginal share costs
  // 1 + positionImpact × (held/outstanding)² more as your stake grows. Buying back
  // your own charter is exempt. Each step's price is the AVERAGE across its block.
  const own = targetId === view.me.id;
  const q = view.config.tuning.equity.positionImpact;
  let held = own ? 0 : (target.shareRegister[view.me.id] ?? 0);
  const outstanding = Math.max(1, target.sharesOutstanding);

  const steps: ShareFillStep[] = [];
  let remaining = Math.max(0, Math.floor(shares));
  let total = 0;
  let stoppedAt: string | undefined;
  let wholeBlock: ShareTradePreview["wholeBlock"];
  for (const a of asks) {
    if (remaining <= 0) break;
    if (a.wholeBlock) {
      // Management sells only as one whole lot, at a single negotiated price. The
      // concentration premium does not apply — the holdout multiple IS its premium.
      const price = a.ask * discount;
      if (remaining < a.available || price > limitPrice) {
        wholeBlock = { shares: a.available, price };
        stoppedAt = a.label;
        break;
      }
      steps.push({ label: a.label, shares: a.available, price });
      total += a.available * price;
      held += a.available;
      remaining -= a.available;
      continue;
    }
    let blockLeft = a.available;
    let took = 0;
    let cost = 0;
    while (remaining > 0 && blockLeft > 0) {
      const mult = own ? 1 : 1 + q * (held / outstanding) ** 2;
      const price = a.ask * mult * discount;
      if (price > limitPrice) {
        stoppedAt = a.label;
        break;
      }
      took += 1;
      cost += price;
      held += 1;
      remaining -= 1;
      blockLeft -= 1;
    }
    if (took > 0) {
      steps.push({ label: a.label, shares: took, price: cost / took });
      total += cost;
    }
    if (stoppedAt) break;
  }
  return { steps, filled: Math.floor(shares) - remaining, total, stoppedAt, wholeBlock };
}

/** Mirror of the engine's sell cascade: NPC standing bids best-first, capped per block per turn. */
export function previewShareSell(view: PlayerView, targetId: string, shares: number, limitPrice: number): ShareTradePreview {
  const target = view.corporations.find((c) => c.id === targetId);
  if (!target) return { steps: [], filled: 0, total: 0 };
  const tradedBase = target.sharePrice * target.sentiment;
  const bids = target.npcHolders
    .map((npc) => ({ label: npc.name, bid: tradedBase * npc.bidDiscount, capacity: npc.absorbPerTurn }))
    .sort((a, b) => b.bid - a.bid || a.label.localeCompare(b.label));
  const held = target.shareRegister[view.me.id] ?? 0;
  const steps: ShareFillStep[] = [];
  let remaining = Math.min(Math.max(0, Math.floor(shares)), held);
  const wanted = remaining;
  let total = 0;
  let stoppedAt: string | undefined;
  for (const b of bids) {
    if (remaining <= 0) break;
    if (b.bid < limitPrice) {
      stoppedAt = b.label;
      break;
    }
    const sold = Math.min(remaining, b.capacity);
    if (sold <= 0) continue;
    steps.push({ label: b.label, shares: sold, price: b.bid });
    total += sold * b.bid;
    remaining -= sold;
  }
  return { steps, filled: wanted - remaining, total, stoppedAt };
}

/** One strategic-material line of a warship build (Section 07b). */
export interface ShipMatLine {
  resource: Resource;
  need: number;
  /** Units already in the corp's own stockpiles (across owned systems). */
  have: number;
  /** What importing the shortfall would cost at current prices — informational; the engine
   *  does NOT auto-buy (playtest decision): short materials mean the build will not resolve. */
  bill: number;
}

export interface ShipBuildPreview {
  /** Hull credits, with the Capital Shipyards discount applied for Range 5+ hulls. */
  hullCost: number;
  mats: ShipMatLine[];
  /** Exchange cost to import all material shortfalls first (informational). */
  matsBill: number;
  /** Credits the engine actually charges: the hull only (materials are consumed in kind). */
  total: number;
  /** True if any material is short — the build will NOT resolve until it's in stock. */
  short: boolean;
}

/**
 * Mirror of the engine's `buildShip` charge (engine.ts resolution): hull credits ×
 * capital-hull research discount. Materials (isotopes/antimatter/alloys/components) must be
 * ON HAND in the corp's stockpiles — there is no auto-buy; `short` flags a build that won't fire.
 */
export function shipBuildPreview(view: PlayerView, rangeTier: RangeTier, raider: boolean): ShipBuildPreview {
  const t = view.config.tuning;
  const me = view.me;
  const hullMult = rangeTier >= 5 ? researchMods(me.research.completed).capitalHullCostMult : 1;
  const hullCost = Math.round((t.shipCost[rangeTier] + (raider ? t.raiderShipExtraCost : 0)) * hullMult);
  const needs: Partial<Record<Resource, number>> = {
    alloys: t.shipAlloyCost[rangeTier],
    components: t.shipComponentCost[rangeTier],
    rareIsotopes: t.shipIsotopeCost[rangeTier],
    antimatter: t.shipAntimatterCost[rangeTier],
  };
  const mats: ShipMatLine[] = [];
  let matsBill = 0;
  for (const [r, need] of Object.entries(needs) as [Resource, number][]) {
    if (!need) continue;
    let have = 0;
    for (const id of me.ownedSystemIds) have += view.galaxy.system(id).stockpile[r];
    const bill = Math.max(0, need - have) * view.market.prices[r];
    mats.push({ resource: r, need, have, bill });
    matsBill += bill;
  }
  return { hullCost, mats, matsBill, total: hullCost, short: mats.some((m) => m.have < m.need) };
}

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
  // No auto-procurement (playtest decision): a build's materials must be in YOUR stockpiles or
  // the order will not resolve — so the preview warns about any shortfall up front.
  const stockOf = (r: Resource) =>
    view.me.ownedSystemIds.reduce((sum, id) => sum + (g.systems.get(id)?.stockpile[r] ?? 0), 0);
  const missingMats = (costs: Partial<Record<Resource, number>>): string[] =>
    (Object.entries(costs) as [Resource, number | undefined][])
      .filter(([r, n]) => (n ?? 0) > 0 && stockOf(r) < (n ?? 0))
      .map(([r, n]) => `${Math.ceil((n ?? 0) - stockOf(r))} ${resourceLabels[r].toLowerCase()}`);
  const shortMats = (costs: Partial<Record<Resource, number>>): string | undefined => {
    const missing = missingMats(costs);
    return missing.length ? `Short ${missing.join(" + ")} — won't resolve (no auto-buy; import or produce them first)` : undefined;
  };
  // Queue builds are NOT dropped when short (Section 24): they wait unpaid in the system's
  // queue until the materials arrive (or the player removes them), so the warning is softer.
  const waitMats = (costs: Partial<Record<Resource, number>>): string | undefined => {
    const missing = missingMats(costs);
    return missing.length ? `Short ${missing.join(" + ")} — will wait in the queue and start once the materials arrive` : undefined;
  };

  switch (order.kind) {
    case "market": {
      const price = view.market.prices[order.resource];
      if (order.side === "buy") {
        const cost = Math.round(order.quantity * price);
        return {
          label: `Buy ${order.quantity} ${resourceLabels[order.resource]}`,
          detail: `to ${name(order.systemId)} · ~${price.toFixed(0)} Cr/u${order.strict ? " · strict" : ""}`,
          cost,
          tone: "trade",
        };
      }
      const sys = g.systems.get(order.systemId);
      const have = sys ? sys.stockpile[order.resource] : 0;
      return {
        label: `Sell ${order.quantity} ${resourceLabels[order.resource]}`,
        detail: `from ${name(order.systemId)} · ~${price.toFixed(0)} Cr/u · paid on arrival`,
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
        label: "Survey warp lane",
        detail: "chart a frontier lane",
        cost: t.surveyCost,
        tone: "build",
      };
    case "buildShip": {
      const p = shipBuildPreview(view, order.rangeTier, order.raider);
      const matsNote = mats(Object.fromEntries(p.mats.map((m) => [m.resource, m.need])));
      return {
        label: `Build ${hullName(order.rangeTier)} ${order.raider ? "raider" : "escort"}`,
        detail: `at ${name(order.systemId)}${matsNote ? ` · ${matsNote}` : ""}`,
        cost: p.total,
        tone: "build",
        warn:
          order.rangeTier > view.me.rangeTier
            ? `Hull not yet unlocked — research Warp Drive`
            : p.short
              ? `Short materials — won't resolve (no auto-buy; import or produce them first)`
              : undefined,
      };
    }
    case "terraform":
      return {
        label: "Terraform world",
        detail: `make a world at ${name(order.systemId)} habitable`,
        cost: t.terraformCost,
        tone: "research",
        warn: shortMats(t.buildResources.agridome),
      };
    case "hirePrivateer":
      return {
        label: "Hire privateer",
        detail: `based at ${name(order.basedAt)} · ${t.privateerTurns} turns`,
        cost: t.privateerCost,
        tone: "raid",
      };
    case "interdict":
      return { label: "Interdict warp lane", detail: "set a trap for next-tick convoys", cost: 0, tone: "raid" };
    case "targetConvoy":
      return { label: "Target convoy", detail: "raid a visible shipment", cost: 0, tone: "raid" };
    case "escort":
      return { label: "Escort convoys", detail: `from ${name(order.systemId)} · +${order.strength}`, cost: 0, tone: "build" };
    case "buildDepot":
      return { label: "Build Trade Depot", detail: `at ${name(order.systemId)}`, cost: t.depotCost, tone: "build", warn: shortMats({ alloys: t.buildAlloyCost, components: t.depotComponentCost }) };
    case "buildDisruptor":
      return { label: "Build Warp Disruptor", detail: `at ${name(order.systemId)} · holds rival arrivals +${t.disruptorDelay}t`, cost: t.disruptorCost, tone: "build", warn: shortMats({ alloys: t.buildAlloyCost, components: t.disruptorComponentCost }) };
    case "buildHydroponics":
      return { label: "Build agri-dome", detail: `at ${name(order.systemId)} · ${mats(t.buildResources.agridome)}`, cost: t.hydroponicsCost, tone: "build", warn: waitMats(t.buildResources.agridome) };
    case "buildProcessor": {
      const recipe = t.recipes.find((r) => r.id === order.recipeId);
      const sys = g.systems.get(order.systemId);
      const mult = sys ? factoryCostMult(bodyTypeOfKey(sys, order.bodyKey ?? primaryBodyKey(sys))) : 1;
      return {
        label: `Build ${order.recipeId} factory`,
        detail: `at ${name(order.systemId)} · ${mats(t.buildResources.factory)}`,
        cost: Math.round((recipe?.buildCost ?? 0) * mult),
        tone: "build",
        warn: waitMats(t.buildResources.factory),
      };
    }
    case "buildReactor":
      return { label: "Build reactor", detail: `at ${name(order.systemId)} · ${mats(t.buildResources.reactor)}`, cost: t.reactorCost, tone: "build", warn: waitMats(t.buildResources.reactor) };
    case "buildLab":
      return { label: "Build research lab", detail: `at ${name(order.systemId)} · ${mats(t.buildResources.lab)}`, cost: t.labCost, tone: "research", warn: waitMats(t.buildResources.lab) };
    case "cancelBuild": {
      // Buildings are identified by bodyKey (one per body), waiting extractors by siteKey.
      const item = g.systems.get(order.systemId)?.queue.find((q) =>
        order.siteKey ? q.kind === "extractor" && q.siteKey === order.siteKey : q.kind !== "extractor" && q.bodyKey === order.bodyKey,
      );
      const what = item
        ? item.kind === "factory" ? `${item.recipeId ?? "factory"} factory`
          : item.kind === "extractor" ? `${item.resource ? extractorNames[item.resource].toLowerCase() : "extractor"}`
          : item.kind
        : "build";
      return {
        label: `Remove queued ${what}`,
        detail: `at ${name(order.systemId)}${item?.paid ? ` · refunds ${item.creditCost} Cr${mats(item.mats) ? ` + ${mats(item.mats)}` : ""}` : " · nothing was charged"}`,
        cost: item?.paid ? -item.creditCost : 0,
        tone: "build",
      };
    }
    case "upgradeWarehouse": {
      const w = t.warehouse;
      const lvl = (view.me.warehouseLevel ?? 0) + 1;
      return {
        label: `Expand Exchange warehouse to L${lvl}`,
        detail: `+${w.capacityPerLevel} hub storage · ${w.upgradeMetalsCost * lvl} metals`,
        cost: w.upgradeCreditCost * lvl,
        tone: "build",
        warn: shortMats({ metals: w.upgradeMetalsCost * lvl }),
      };
    }
    case "setResearch":
      return { label: "Set research queue", detail: `${order.queue.length} project${order.queue.length === 1 ? "" : "s"} queued`, cost: 0, tone: "research" };
    case "upgradeInfrastructure": {
      const inf = t.infrastructure;
      const trackLabel = order.track === "mining" ? "Mining rig" : order.track === "habitat" ? "Habitat" : "Power grid";
      const creditBase = order.track === "mining" ? inf.miningCreditCost : order.track === "habitat" ? inf.habitatCreditCost : inf.powerCreditCost;
      const rawLabel = order.track === "mining" ? "metals" : order.track === "habitat" ? "silicates" : "helium-3";
      const rawBase = order.track === "mining" ? inf.miningMetalsCost : order.track === "habitat" ? inf.habitatSilicatesCost : inf.powerHelium3Cost;
      const rawRes: Resource = order.track === "mining" ? "metals" : order.track === "habitat" ? "silicates" : "helium3";
      return {
        label: `Upgrade ${trackLabel}`,
        detail: `at ${name(order.systemId)} · ${rawBase}+ ${rawLabel}`,
        cost: creditBase,
        tone: "build",
        warn: waitMats({ [rawRes]: rawBase }),
      };
    }
    case "buildPlatform":
      return { label: "Build defense platform", detail: `at ${name(order.systemId)}`, cost: t.platformCost, tone: "build", warn: shortMats({ alloys: t.buildAlloyCost }) };
    case "buildSurveyShip":
      return { label: "Build survey vessel", detail: `at ${name(order.systemId)} — an unarmed scout`, cost: t.surveyShipCost, tone: "build" };
    case "surveySystem":
      return {
        label: `Survey ${name(order.targetSystemId)}`,
        detail: `dispatch a survey vessel from ${name(order.fromSystemId)} — reveals its deposits`,
        cost: 0,
        tone: "build",
      };
    case "buildExtractor": {
      const site = g.systems.get(order.systemId)?.sites.find((s) => s.key === order.siteKey);
      const mine = site ? extractorNames[site.resource] : "extractor";
      const lvl = site?.extractorLevel ?? 0;
      const factor = (lvl + 1) * (1 + (1 - (site?.accessibility ?? 1)) * t.extractor.accessibilityMult);
      return {
        label: lvl > 0 ? `Upgrade ${mine} to L${lvl + 1}` : `Build ${mine}`,
        detail: `at ${name(order.systemId)} · ${t.extractor.alloyCost} alloys`,
        cost: Math.round(t.extractor.buildCost * factor),
        tone: "build",
        warn: waitMats({ alloys: t.extractor.alloyCost }),
      };
    }
    case "buyShares": {
      const target = view.corporations.find((c) => c.id === order.targetId);
      const pv = previewShareBuy(view, order.targetId, order.shares, order.limitPrice);
      const own = order.targetId === view.me.id;
      const avg = pv.filled > 0 ? Math.round(pv.total / pv.filled) : 0;
      return {
        label: own ? `Buy back ${order.shares} shares` : `Buy ${order.shares} shares`,
        detail: pv.filled > 0
          ? `${target?.name ?? order.targetId} · ${pv.filled}/${order.shares} fill ≤ limit · avg ~${avg} Cr`
          : `${target?.name ?? order.targetId} · limit ${Math.round(order.limitPrice)} Cr/share`,
        cost: Math.round(pv.total),
        tone: "finance",
        warn: pv.filled < order.shares
          ? pv.stoppedAt
            ? "the remaining shares ask more than your limit — raise it to keep sweeping"
            : "not enough shares on the cap table"
          : undefined,
      };
    }
    case "sellShares": {
      const target = view.corporations.find((c) => c.id === order.targetId);
      const pv = previewShareSell(view, order.targetId, order.shares, order.limitPrice);
      const own = order.targetId === view.me.id;
      const avg = pv.filled > 0 ? Math.round(pv.total / pv.filled) : 0;
      return {
        label: own ? `Sell ${order.shares} own shares` : `Sell ${order.shares} shares`,
        detail: pv.filled > 0
          ? `${target?.name ?? order.targetId} · ${pv.filled}/${order.shares} fill ≥ limit · avg ~${avg} Cr${own ? " → treasury" : ""}`
          : `${target?.name ?? order.targetId} · limit ${Math.round(order.limitPrice)} Cr/share`,
        cost: -Math.round(pv.total),
        tone: "finance",
        warn: own && pv.filled > 0
          ? "shrinks your management block — takeover exposure rises"
          : pv.filled < order.shares
            ? pv.stoppedAt
              ? "the remaining bids are below your limit — lower it to sell more"
              : "the market's absorption for this turn is used up"
            : undefined,
      };
    }
    case "borrow":
      return {
        label: "Borrow credits",
        detail: `+${order.amount.toLocaleString()} Cr debt`,
        cost: -order.amount,
        tone: "finance",
      };
    case "bid":
      return { label: "Auction bid", detail: `${order.priorities.length} priorities`, cost: 0, tone: "claim" };
    case "invade":
      return { label: `Invade ${name(order.systemId)}`, detail: "commit your fleet to seize this system", cost: 0, tone: "raid" };
    case "moveFleet": {
      // Show only the bottom line — fuel required + ETA — never the underlying mass×distance math.
      const pv = previewFleetMove(g, t, order.fromSystemId, order.toSystemId, view.me.ships);
      const detail = pv.ok
        ? `${name(order.fromSystemId)} → ${name(order.toSystemId)} · fuel ${Math.ceil(pv.fuel)} · ${pv.eta}t${pv.offLane ? " · off-lane" : ""}`
        : `${name(order.fromSystemId)} → ${name(order.toSystemId)}`;
      return { label: "Move fleet", detail, cost: 0, tone: "raid", warn: pv.ok ? undefined : "Out of range — no lane and too far to jump" };
    }
    case "redeployShip":
      return { label: `Reinforce ${name(order.toSystemId)}`, detail: `redeploy your strongest warship from ${name(order.fromSystemId)}`, cost: 0, tone: "raid" };
    case "sabotage":
      return { label: `Sabotage ${name(order.systemId)}`, detail: "knock a rival extractor offline", cost: 0, tone: "raid" };
    case "buildMegastructure": {
      const spec = t.megastructures[order.structure];
      return {
        label: `Build ${megastructureLabel[order.structure]}`,
        detail: `at ${name(order.systemId)} · ${spec.metalsCost} metals${spec.alloyCost ? ` + ${spec.alloyCost} alloys` : ""}`,
        warn: shortMats({ metals: spec.metalsCost, alloys: spec.alloyCost }),
        cost: spec.creditCost,
        tone: "build",
      };
    }
    case "alliancePledge": {
      const ally = view.corporations.find((c) => c.id === order.targetId);
      return { label: "Pledge alliance", detail: `defensive pact with ${ally?.name ?? order.targetId}`, cost: 0, tone: "finance" };
    }
    case "allianceBreak": {
      const ally = view.corporations.find((c) => c.id === order.targetId);
      return { label: "Break alliance", detail: `withdraw the pact with ${ally?.name ?? order.targetId}`, cost: 0, tone: "finance" };
    }
    default:
      return { label: "Order", detail: "", cost: 0, tone: "build" };
  }
}
