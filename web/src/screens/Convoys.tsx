import { useState } from "react";
import { RESOURCES, type Resource } from "@engine";
import { store, useApp } from "../match/store";
import { convoyName, corpColor, formatCr, resourceLabels, routeRisk, sizeBucket } from "../match/format";
import { Panel, PanelTitle, Segmented, Badge, EmptyState, Bar } from "../ui/primitives";
import { Icon } from "../ui/icons";
import { NumberInput } from "../ui/NumberInput";
import { CorpCrest, ResourceIcon } from "../theme/art";
import { StandingRoutes } from "./StandingRoutes";

export function Convoys() {
  const { view, humanCorpId } = useApp();
  if (!view) return null;
  const [tab, setTab] = useState<"mine" | "rivals">("mine");
  const galaxy = view.galaxy;
  const mineId = humanCorpId;
  const convoys = view.convoys.filter((c) => (tab === "mine" ? c.owner === mineId : c.owner !== mineId));

  return (
    <div className="convoys">
      <StandingRoutes />
      <Panel className="convoys__panel">
        <PanelTitle
          icon="convoys"
          eyebrow="Warp Traffic"
          title="Convoys in Transit"
          right={<Segmented value={tab} onChange={(v) => setTab(v)} options={[{ value: "mine", label: "Mine" }, { value: "rivals", label: "Rivals" }]} />}
        />
        {convoys.length === 0 ? (
          <EmptyState icon="convoys">{tab === "mine" ? "No active shipments. Sell from the Exchange, or ship goods to your warehouse here." : "No visible rival convoys this turn."}</EmptyState>
        ) : (
          <div className="convoy-list">
            {convoys.map((c) => {
              const mine = c.owner === mineId;
              const dest = galaxy.system(c.path[c.path.length - 1]!);
              const route = galaxy.routes.get(c.routeIds[c.position] ?? "");
              const risk = route ? routeRisk(route) : { label: "—", level: "guarded" as const };
              const owner = view.corporations.find((x) => x.id === c.owner);
              const kindLabel = c.kind === "buy" ? "import" : c.kind === "transfer" ? "transfer" : "export";
              return (
                <article key={c.id} className="convoy-card" onClick={() => store.select({ kind: "convoy", id: c.id })}>
                  <div className="convoy-card__icon">
                    <CorpCrest corpId={c.owner} size={26} />
                  </div>
                  <div className="convoy-card__main">
                    <div className="convoy-card__top">
                      <strong>{convoyName(c.id)}</strong>
                      <Badge tone={risk.level === "severe" ? "negative" : risk.level === "high" ? "warn" : "neutral"}>{risk.label}</Badge>
                    </div>
                    <div className="convoy-card__path">
                      {c.path.map((id) => galaxy.system(id).name).join(" → ")}
                    </div>
                    <div className="convoy-card__meta">
                      {mine ? <span>{Math.round(c.quantity)} {resourceLabels[c.resource]} {kindLabel}</span> : <span>{sizeBucket(c.value)} cargo</span>}
                      <span>ETA {Math.max(1, c.segmentTurnsLeft)}t</span>
                      {mine && c.kind === "sell" && <span>{formatCr(c.payout)}</span>}
                      {mine ? <span>Escort {c.escort.toFixed(0)}</span> : <span style={{ color: corpColor(c.owner) }}>{owner?.name}</span>}
                    </div>
                  </div>
                  <Icon name="chevron" size={16} />
                </article>
              );
            })}
          </div>
        )}
        <p className="convoys__hint">Select a rival convoy to target it (multi-turn lanes only), or interdict a lane from the Map.</p>
      </Panel>
      <ShipToWarehouse />
    </div>
  );
}

/**
 * Stage a freighter run from one of your systems to YOUR warehouse at the Exchange (ruleset
 * v10): a sealed transfer order — it flies the lanes like any convoy (raidable in flight) and
 * stores on arrival. From the warehouse the goods sell instantly, at your moment.
 */
function ShipToWarehouse() {
  const { view, staged } = useApp();
  const [systemId, setSystemId] = useState("");
  const [resource, setResource] = useState<Resource>("ice");
  const [quantity, setQuantity] = useState(10);
  if (!view) return null;
  const me = view.me;
  const galaxy = view.galaxy;
  const hubId = galaxy.hubId;
  const t = view.config.tuning;
  const mySystems = me.ownedSystemIds.map((id) => galaxy.system(id));
  const system = mySystems.find((s) => s.id === systemId) ?? mySystems[0];

  const capacity = t.warehouse.baseCapacity + t.warehouse.capacityPerLevel * me.warehouseLevel;
  const used = RESOURCES.reduce((s, r) => s + me.hubStockpile[r], 0);
  const free = Math.max(0, Math.floor(capacity - used));

  if (mySystems.length === 0 || !system) {
    return (
      <Panel className="convoys__shipper">
        <PanelTitle icon="systems" eyebrow="Hub Storage" title="Ship to Warehouse" right={<Badge tone="neutral">{Math.floor(used)}/{capacity}</Badge>} />
        <p className="hint">Claim a system first — then ship its goods here to sell instantly from the hub.</p>
      </Panel>
    );
  }

  const available = Math.floor(system.stockpile[resource]);
  const path = galaxy.shortestWarpPath(system.id, hubId, me.rangeTier);
  const transitTurns = path ? path.routes.reduce((s, id) => s + galaxy.route(id).transitTime, 0) : 0;
  // Pending shipments this turn count toward the space the cargo will find on arrival.
  const stagedToHub = staged
    .filter((s) => s.order.kind === "transfer" && s.order.toSystemId === hubId)
    .reduce((s, o) => s + (o.order.kind === "transfer" ? o.order.quantity : 0), 0);
  const overflow = quantity + stagedToHub > free;

  return (
    <Panel className="convoys__shipper">
      <PanelTitle icon="systems" eyebrow="Hub Storage" title="Ship to Warehouse" right={<Badge tone={used >= capacity ? "warn" : "neutral"}>{Math.floor(used)}/{capacity}</Badge>} />
      <Bar value={used} max={capacity} tone={used >= capacity ? "warn" : "positive"} />
      <label className="field">
        <span>From system</span>
        <select value={system.id} onChange={(e) => setSystemId(e.target.value)}>
          {mySystems.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </label>
      <label className="field">
        <span>Resource</span>
        <select value={resource} onChange={(e) => setResource(e.target.value as Resource)}>
          {RESOURCES.filter((r) => Math.floor(system.stockpile[r]) > 0 || r === resource).map((r) => (
            <option key={r} value={r}>{resourceLabels[r]} ({Math.floor(system.stockpile[r])} in stock)</option>
          ))}
        </select>
      </label>
      <div className="field-row">
        <label className="field">
          <span>Quantity</span>
          <NumberInput min={1} value={quantity} onCommit={setQuantity} />
        </label>
        <div className="field convoys__shipper-stock">
          <span>In stock</span>
          <button type="button" className="stockline__max" title="Ship everything in local stock" onClick={() => setQuantity(Math.max(1, available))}>
            <ResourceIcon resource={resource} size={14} /> {available} · Max
          </button>
        </div>
      </div>
      <div className="preview">
        <div className="preview__row"><span>Stored at the hub</span><strong>{!path ? "—" : transitTurns <= 1 ? "end of this turn" : `in ${transitTurns} turns`}</strong></div>
        <div className="preview__row"><span>Warehouse space</span><strong>{free} free</strong></div>
        <div className="preview__path"><Icon name="map" size={13} /> {path ? path.systems.map((id) => galaxy.system(id).name).join(" → ") : "No charted path"}</div>
      </div>
      {!path && <p className="hint hint--warn"><Icon name="alert" size={13} /> No charted path to the Hub within your fleet's warp range.</p>}
      {overflow && <p className="hint hint--warn"><Icon name="alert" size={13} /> More than fits — overflow on arrival is auto-sold (consigned) at the instant price.</p>}
      <button
        type="button"
        className="primary-btn"
        disabled={!path || available <= 0}
        onClick={() => store.stage({ kind: "transfer", fromSystemId: system.id, toSystemId: hubId, resource, quantity: Math.min(quantity, available) })}
      >
        <Icon name="plus" size={15} /> Queue shipment · {Math.min(quantity, available)} {resourceLabels[resource]}
      </button>
    </Panel>
  );
}
