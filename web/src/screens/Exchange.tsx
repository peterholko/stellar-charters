import { useState } from "react";
import { RESOURCES, type Resource } from "@engine";
import { store, useApp } from "../match/store";
import { formatCr, resourceLabels } from "../match/format";
import { Panel, PanelTitle, Sparkline, Segmented, Badge } from "../ui/primitives";
import { Icon } from "../ui/icons";
import { ResourceIcon } from "../theme/art";

export function Exchange() {
  const { view, priceHistory } = useApp();
  if (!view) return null;
  const galaxy = view.galaxy;
  const mySystems = view.me.ownedSystemIds.map((id) => galaxy.system(id));
  const [side, setSide] = useState<"sell" | "buy">("sell");
  const [resource, setResource] = useState<Resource>("ice");
  const [systemId, setSystemId] = useState<string>(mySystems[0]?.id ?? "");
  const [quantity, setQuantity] = useState(20);
  const [limitPrice, setLimitPrice] = useState(0);
  const [strict, setStrict] = useState(false);

  const price = view.market.prices[resource];
  const system = mySystems.find((s) => s.id === systemId) ?? mySystems[0];
  const t = view.config.tuning;

  // Warp path & effective price (Section 11 preview).
  const path = system
    ? side === "sell"
      ? galaxy.shortestWarpPath(system.id, galaxy.hubId, view.me.rangeTier)
      : galaxy.shortestWarpPath(galaxy.hubId, system.id, view.me.rangeTier)
    : null;
  const hops = path?.routes.length ?? 0;
  const shipPerUnit = t.shippingFeePerHop * hops;
  const effective = side === "sell" ? price - shipPerUnit : price + shipPerUnit;
  const pathLabel = path ? path.systems.map((id) => galaxy.system(id).name).join(" → ") : "No charted path";
  const available = system ? system.stockpile[resource] : 0;
  const shortStock = side === "sell" && available < quantity;

  const stage = () => {
    if (!system) return;
    store.stage({
      kind: "market",
      side,
      resource,
      quantity,
      limitPrice: strict ? limitPrice || Math.round(effective) : side === "buy" ? 1e9 : 0,
      systemId: system.id,
      strict,
    });
  };

  // War aggressors pay a tariff on every Exchange trade until a ceasefire (Section 23).
  const atWarAsAggressor = view.wars.some((w) => w.aggressorId === view.me.id && w.endTurn > view.turn);
  const tariffPct = Math.round(view.config.tuning.war.aggressorTariff * 100);

  return (
    <div className="exchange">
      {atWarAsAggressor && (
        <Panel className="exchange__lockout">
          <p className="hint hint--war">⚔ Your charter is at war as the aggressor — a {tariffPct}% war tariff is skimmed off every Exchange trade until a ceasefire. Internal transfers between your own systems are untaxed.</p>
        </Panel>
      )}
      <Panel className="exchange__board">
        <PanelTitle icon="exchange" eyebrow="Galactic Exchange" title="Commodity Desk" />
        <div className="board">
          {RESOURCES.map((r) => {
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

      <Panel className="exchange__composer">
        <PanelTitle icon="send" eyebrow="Order Composer" title={`${resourceLabels[resource]} ${side === "sell" ? "Export" : "Import"}`} />
        {mySystems.length === 0 ? (
          <p className="hint">You hold no systems yet — claim one to trade through the Exchange.</p>
        ) : (
          <>
            <Segmented value={side} onChange={(v) => setSide(v)} options={[{ value: "sell", label: "Sell" }, { value: "buy", label: "Buy" }]} />
            <label className="field">
              <span>{side === "sell" ? "Origin system" : "Deliver to"}</span>
              <select value={systemId} onChange={(e) => setSystemId(e.target.value)}>
                {mySystems.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <div className="field-row">
              <label className="field">
                <span>Quantity</span>
                <input type="number" min={1} value={quantity} onChange={(e) => setQuantity(Math.max(1, Number(e.target.value)))} />
              </label>
              <label className="field">
                <span>{strict ? "Limit price" : "Market"}</span>
                <input type="number" min={0} value={limitPrice} disabled={!strict} onChange={(e) => setLimitPrice(Number(e.target.value))} />
              </label>
            </div>
            <label className="toggle">
              <input type="checkbox" checked={strict} onChange={(e) => setStrict(e.target.checked)} />
              <span>Strict limit (fail if price condition unmet)</span>
            </label>

            <div className="preview">
              <div className="preview__row"><span>Market price</span><strong>{price.toFixed(1)} cr/u</strong></div>
              <div className="preview__row"><span>Shipping ({hops} hop{hops === 1 ? "" : "s"})</span><strong>{shipPerUnit.toFixed(1)} cr/u</strong></div>
              <div className="preview__row preview__row--accent"><span>Effective</span><strong>{effective.toFixed(1)} cr/u</strong></div>
              <div className="preview__row"><span>{side === "sell" ? "Est. proceeds" : "Est. cost"}</span><strong>{formatCr(Math.max(0, effective) * quantity)}</strong></div>
              <div className="preview__path"><Icon name="map" size={13} /> {pathLabel}</div>
            </div>

            {shortStock && <p className="hint hint--warn"><Icon name="alert" size={13} /> Only {Math.floor(available)} {resourceLabels[resource]} in local stock.</p>}
            {!path && <p className="hint hint--warn"><Icon name="alert" size={13} /> No charted path at Range {view.me.rangeTier} — survey or research range.</p>}

            <button type="button" className="primary-btn" disabled={!path} onClick={stage}>
              <Icon name="plus" size={15} /> Stage {side === "sell" ? "export" : "import"}
            </button>
          </>
        )}
      </Panel>
    </div>
  );
}
