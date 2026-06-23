import { useEffect, useState } from "react";
import { RESOURCES, quoteInstant, type Resource } from "@engine";
import { store, useApp } from "../match/store";
import { formatCr, resourceLabels } from "../match/format";
import { Panel, PanelTitle, Sparkline, Segmented, Badge, Bar } from "../ui/primitives";
import { NumberInput } from "../ui/NumberInput";
import { Icon } from "../ui/icons";
import { ResourceIcon } from "../theme/art";

export function Exchange() {
  const { view, priceHistory, listedResources, exchangeDraft } = useApp();
  const [side, setSide] = useState<"sell" | "buy">("sell");
  const [resource, setResource] = useState<Resource>("ice");
  const [systemId, setSystemId] = useState<string>("");
  const [quantity, setQuantity] = useState(20);
  const [limitPrice, setLimitPrice] = useState(0);
  const [strict, setStrict] = useState(false);
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  /** Success confirmation after an instant buy — without it, players double-click and
   *  double-buy (seen in the live instant log). */
  const [actionNote, setActionNote] = useState<string | null>(null);

  // A prepared import (build catalogue → "Import missing resources"): prefill the composer,
  // ready for the player to review and buy.
  useEffect(() => {
    if (!exchangeDraft) return;
    setSide("buy");
    setResource(exchangeDraft.resource);
    setSystemId(exchangeDraft.systemId);
    setQuantity(Math.max(1, exchangeDraft.quantity));
    if (view) setLimitPrice(Math.round(view.market.prices[exchangeDraft.resource]));
    store.consumeExchangeDraft();
  }, [exchangeDraft, view]);

  if (!view) return null;
  const galaxy = view.galaxy;
  const me = view.me;
  const mySystems = me.ownedSystemIds.map((id) => galaxy.system(id));
  const hubId = galaxy.hubId;
  const t = view.config.tuning;

  const price = view.market.prices[resource];
  // Buy destinations include the hub warehouse (instant, no convoy) — and it's the DEFAULT:
  // playtest showed buyers expect "buy at the Exchange" to land at the Exchange. Choosing a
  // system instead launches a freighter there. Sells originate at systems.
  const toWarehouse = side === "buy" && (systemId === "" || systemId === hubId);
  const system = mySystems.find((s) => s.id === systemId) ?? mySystems[0];

  // Warp path & shipping (Section 11 preview). Warehouse buys never leave the hub.
  const path = toWarehouse
    ? null
    : system
      ? side === "sell"
        ? galaxy.shortestWarpPath(system.id, hubId, me.rangeTier)
        : galaxy.shortestWarpPath(hubId, system.id, me.rangeTier)
      : null;
  const reachable = toWarehouse || !!path;
  const hops = path?.routes.length ?? 0;
  const shipPerUnit = toWarehouse ? 0 : t.shippingFeePerHop * hops;
  const pathLabel = toWarehouse
    ? "Wormhole Hub — straight into your warehouse"
    : path ? path.systems.map((id) => galaxy.system(id).name).join(" → ") : "No charted path";
  // Transit counts from the launch resolution (ruleset v8): total transit N ⇒ cargo lands during
  // the Nth processing after the order resolves, usable the turn after.
  const transitTurns = path ? path.routes.reduce((s, id) => s + galaxy.route(id).transitTime, 0) : 0;
  const available = system ? system.stockpile[resource] : 0;
  const shortStock = side === "sell" && available < quantity;

  // Instant trades walk the price curve and pay the spread (ruleset v10) — preview the real bill.
  const quote = quoteInstant(t, price, resource, side, Math.max(1, quantity));
  const buyCost = quote.total + shipPerUnit * quantity;
  const sealedEffective = price - shipPerUnit; // sealed sells clear at mid, minus shipping

  const stageSell = () => {
    if (!system) return;
    store.stage({
      kind: "market",
      side: "sell",
      resource,
      quantity,
      limitPrice: strict ? limitPrice || Math.round(sealedEffective) : 0,
      systemId: system.id,
      strict,
    });
  };

  // Instant buy (ruleset v10): executes at click time along the price curve; warehouse buys
  // land immediately, system buys put a freighter on the lane this processing.
  const buyNow = async () => {
    if (pending || (!toWarehouse && !system)) return;
    setPending(true);
    setActionError(null);
    setActionNote(null);
    const err = await store.instant({ kind: "buy", resource, quantity, systemId: toWarehouse ? hubId : system!.id });
    setPending(false);
    if (err) setActionError(err);
    else setActionNote(
      toWarehouse
        ? `✓ ${quantity} ${resourceLabels[resource]} purchased — in your warehouse now`
        : `✓ ${quantity} ${resourceLabels[resource]} purchased — freighter departing for ${system!.name} (track it on Convoys)`,
    );
  };

  // War aggressors pay a tariff on every Exchange trade until a ceasefire (Section 23).
  const atWarAsAggressor = view.wars.some((w) => w.aggressorId === me.id && w.endTurn > view.turn);
  const tariffPct = Math.round(t.war.aggressorTariff * 100);

  return (
    <div className="exchange">
      {atWarAsAggressor && (
        <Panel className="exchange__lockout">
          <p className="hint hint--war">⚔ Your charter is at war as the aggressor — a {tariffPct}% war tariff is skimmed off every Exchange trade until a ceasefire. Internal transfers between your own systems are untaxed.</p>
        </Panel>
      )}
      <div className="exchange__left">
        <Panel className="exchange__board">
          <PanelTitle icon="exchange" eyebrow="Galactic Exchange" title="Commodity Desk" />
          <div className="board">
            {/* Commodity staging (review Section 13): only listed goods trade; the rest arrive
                as range tiers are fielded, so the early board stays ~6 goods deep. */}
            {RESOURCES.filter((r) => listedResources.includes(r)).map((r) => {
              const hist = priceHistory[r];
              const prev = hist.length > 1 ? hist[hist.length - 2]! : hist[hist.length - 1]!;
              const cur = view.market.prices[r];
              const movePct = prev ? ((cur - prev) / prev) * 100 : 0;
              const atFloor = cur <= view.market.floor(r) + 0.01;
              return (
                <button
                  key={r}
                  type="button"
                  className={`board__row ${resource === r ? "is-active" : ""}`}
                  onClick={() => { setResource(r); setLimitPrice(Math.round(view.market.prices[r])); }}
                >
                  <ResourceIcon resource={r} size={26} className="board__icon" />
                  <span className="board__name">{resourceLabels[r]}</span>
                  <Sparkline data={hist.length > 1 ? hist : [cur, cur]} width={70} height={22} color="auto" fill={false} />
                  <span className="board__price">{cur.toFixed(1)}</span>
                  <span className={`board__move ${movePct >= 0 ? "is-up" : "is-down"}`}>{movePct >= 0 ? "+" : ""}{movePct.toFixed(1)}%</span>
                  {atFloor && <Badge tone="negative">Floor</Badge>}
                </button>
              );
            })}
          </div>
        </Panel>
        <WarehousePanel onError={setActionError} />
      </div>

      <Panel className="exchange__composer">
        <PanelTitle icon="send" eyebrow="Order Composer" title={`${resourceLabels[resource]} ${side === "sell" ? "Export" : "Import"}`} />
        {mySystems.length === 0 ? (
          <p className="hint">You hold no systems yet — claim one to trade through the Exchange.</p>
        ) : (
          <>
            <Segmented value={side} onChange={(v) => { setSide(v); if (v === "buy") setStrict(false); setActionError(null); setActionNote(null); }} options={[{ value: "sell", label: "Sell" }, { value: "buy", label: "Buy" }]} />
            <label className="field">
              <span>{side === "sell" ? "Origin system" : "Deliver to"}</span>
              <select value={toWarehouse ? hubId : system?.id ?? ""} onChange={(e) => setSystemId(e.target.value)}>
                {side === "buy" && <option value={hubId}>Hub warehouse (instant)</option>}
                {mySystems.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            {system && !toWarehouse && (
              <div className={`stockline ${shortStock ? "stockline--short" : ""}`}>
                <ResourceIcon resource={resource} size={24} />
                <div className="stockline__text">
                  <span className="stockline__label">{resourceLabels[resource]} in stock at {system.name}</span>
                  {shortStock && (
                    <span className="stockline__warn">
                      <Icon name="alert" size={12} /> Short {Math.ceil(quantity - available)} — only what's in stock will ship
                    </span>
                  )}
                </div>
                <strong className="stockline__qty">{Math.floor(available)}</strong>
                {side === "sell" && Math.floor(available) > 0 && Math.floor(available) !== quantity && (
                  <button type="button" className="stockline__max" title="Sell everything in local stock" onClick={() => setQuantity(Math.floor(available))}>
                    Max
                  </button>
                )}
              </div>
            )}
            <div className="field-row">
              <label className="field">
                <span>Quantity</span>
                <NumberInput min={1} value={quantity} onCommit={setQuantity} />
              </label>
              <label className="field">
                <span>{strict ? "Limit price" : "Market"}</span>
                <NumberInput min={0} value={limitPrice} disabled={!strict} onCommit={setLimitPrice} />
              </label>
            </div>
            {side === "sell" && (
              <label className="toggle">
                <input type="checkbox" checked={strict} onChange={(e) => setStrict(e.target.checked)} />
                <span>Strict limit (fail if price condition unmet)</span>
              </label>
            )}

            <div className="preview">
              <div className="preview__row"><span>Posted price</span><strong>{price.toFixed(1)} Cr/u</strong></div>
              {side === "buy" ? (
                <>
                  {/* Instant pricing (ruleset v10): the order walks the curve and pays the spread. */}
                  <div className="preview__row"><span>Avg after slippage + spread</span><strong>{quote.avgPrice.toFixed(1)} Cr/u</strong></div>
                  <div className="preview__row"><span>Shipping ({toWarehouse ? "none" : `${hops} hop${hops === 1 ? "" : "s"}`})</span><strong>{shipPerUnit.toFixed(1)} Cr/u</strong></div>
                  <div className="preview__row preview__row--accent"><span>Est. cost</span><strong>{formatCr(buyCost)}</strong></div>
                  <div className="preview__row"><span>Market moves to</span><strong>{quote.newPrice.toFixed(1)} Cr/u</strong></div>
                  <div className="preview__row">
                    <span>Delivered</span>
                    <strong>{toWarehouse ? "instantly — sell or dispatch any time" : transitTurns <= 1 ? "this turn — usable next turn" : `in ${transitTurns} turns`}</strong>
                  </div>
                </>
              ) : (
                <>
                  <div className="preview__row"><span>Shipping ({hops} hop{hops === 1 ? "" : "s"})</span><strong>{shipPerUnit.toFixed(1)} Cr/u</strong></div>
                  <div className="preview__row preview__row--accent"><span>Effective</span><strong>{sealedEffective.toFixed(1)} Cr/u</strong></div>
                  <div className="preview__row"><span>Est. proceeds</span><strong>{formatCr(Math.max(0, sealedEffective) * quantity)}</strong></div>
                  <div className="preview__row"><span>Paid</span><strong>{transitTurns <= 1 ? "this turn" : `in ${transitTurns} turns`}</strong></div>
                </>
              )}
              <div className="preview__path"><Icon name="map" size={13} /> {pathLabel}</div>
            </div>

            {!reachable && <p className="hint hint--warn"><Icon name="alert" size={13} /> No charted path within your fleet's warp range — survey or research Warp Drive.</p>}
            {actionError && <p className="hint hint--warn"><Icon name="alert" size={13} /> {actionError}</p>}
            {side === "buy" && actionNote && <p className="hint hint--ok">{actionNote}</p>}

            {side === "buy" ? (
              <>
                <button type="button" className="primary-btn" disabled={!reachable || pending} onClick={buyNow}>
                  <Icon name="exchange" size={15} /> {pending ? "Buying…" : `Buy now · ${formatCr(buyCost)}`}
                </button>
                <p className="hint">
                  {toWarehouse
                    ? "Charged and stored immediately — instant trades pay the spread and move the price as they fill."
                    : "Charged immediately — the freighter departs with this turn's processing."}
                </p>
              </>
            ) : (
              <button type="button" className="primary-btn" disabled={!reachable} onClick={stageSell}>
                <Icon name="plus" size={15} /> Queue export
              </button>
            )}
          </>
        )}
      </Panel>
    </div>
  );
}

/**
 * The corp's warehouse AT the Exchange (ruleset v10): capacity-limited hub storage. Goods here
 * sell instantly at the walked-down price minus the spread — the payoff for shipping ahead of a
 * spike — or dispatch home as a normal freighter run. Upgrades raise the cap (anti-hoarding).
 */
function WarehousePanel({ onError }: { onError: (e: string | null) => void }) {
  const { view, staged } = useApp();
  const [dest, setDest] = useState<string>("");
  const [busy, setBusy] = useState<string | null>(null);
  if (!view) return null;
  const me = view.me;
  const t = view.config.tuning;
  const capacity = t.warehouse.baseCapacity + t.warehouse.capacityPerLevel * me.warehouseLevel;
  const used = RESOURCES.reduce((s, r) => s + me.hubStockpile[r], 0);
  const rows = RESOURCES.filter((r) => Math.floor(me.hubStockpile[r]) > 0);
  const mySystems = me.ownedSystemIds.map((id) => view.galaxy.system(id));
  const destId = mySystems.some((s) => s.id === dest) ? dest : mySystems[0]?.id ?? "";
  const atCap = me.warehouseLevel >= t.warehouse.levelCap;
  const upgradeStaged = staged.some((s) => s.order.kind === "upgradeWarehouse");
  const nextLvl = me.warehouseLevel + 1;
  const upgradeBill = `${formatCr(t.warehouse.upgradeCreditCost * nextLvl)} + ${t.warehouse.upgradeMetalsCost * nextLvl} metals`;

  const run = async (key: string, req: Parameters<typeof store.instant>[0]) => {
    if (busy) return;
    setBusy(key);
    onError(null);
    const err = await store.instant(req);
    setBusy(null);
    if (err) onError(err);
  };

  return (
    <Panel className="warehouse">
      <PanelTitle
        icon="systems"
        eyebrow="Hub Storage"
        title="Your Warehouse"
        right={<Badge tone={used >= capacity ? "warn" : "neutral"}>{Math.floor(used)}/{capacity}</Badge>}
      />
      <Bar value={used} max={capacity} tone={used >= capacity ? "warn" : "positive"} />
      {rows.length === 0 ? (
        <p className="hint">Empty. Buy "to warehouse" here, or ship goods from the Convoys screen, then flip them instantly when the price suits you.</p>
      ) : (
        <div className="warehouse__rows">
          {rows.map((r) => {
            const qty = Math.floor(me.hubStockpile[r]);
            const sellQuote = quoteInstant(t, view.market.prices[r], r, "sell", qty);
            return (
              <div key={r} className="warehouse__row">
                <ResourceIcon resource={r} size={16} />
                <span className="warehouse__name">{resourceLabels[r]}</span>
                <strong className="warehouse__qty">{qty}</strong>
                <button
                  type="button"
                  className="warehouse__btn"
                  disabled={busy !== null}
                  title={`Sell all ${qty} instantly · ~${formatCr(sellQuote.total)} (avg ${sellQuote.avgPrice.toFixed(1)} after slippage + spread; market moves to ${sellQuote.newPrice.toFixed(1)})`}
                  onClick={() => void run(`sell-${r}`, { kind: "sell", resource: r, quantity: qty })}
                >
                  {busy === `sell-${r}` ? "…" : `Sell · ${formatCr(sellQuote.total)}`}
                </button>
                <button
                  type="button"
                  className="warehouse__btn"
                  disabled={busy !== null || !destId}
                  title={destId ? `Dispatch all ${qty} to ${view.galaxy.system(destId).name} — freighter departs this processing` : "No destination system"}
                  onClick={() => void run(`ship-${r}`, { kind: "dispatch", resource: r, quantity: qty, systemId: destId })}
                >
                  {busy === `ship-${r}` ? "…" : "Ship"}
                </button>
              </div>
            );
          })}
          {mySystems.length > 0 && (
            <label className="field">
              <span>Dispatch to</span>
              <select value={destId} onChange={(e) => setDest(e.target.value)}>
                {mySystems.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
          )}
        </div>
      )}
      <div className="action-row">
        <button
          type="button"
          className="warehouse__btn warehouse__btn--upgrade"
          disabled={atCap || upgradeStaged}
          title={atCap ? "Warehouse at maximum size" : upgradeStaged ? "Upgrade already queued this turn" : `Expand to L${nextLvl} (+${t.warehouse.capacityPerLevel} capacity) · ${upgradeBill} — resolves with the turn`}
          onClick={() => store.stage({ kind: "upgradeWarehouse" })}
        >
          {atCap ? "Max size" : upgradeStaged ? "Upgrade queued" : `Expand · +${t.warehouse.capacityPerLevel} cap`}
        </button>
      </div>
    </Panel>
  );
}
