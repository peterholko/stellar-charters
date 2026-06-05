import { useState } from "react";
import { store, useApp } from "../match/store";
import { corpColor, formatCr, resourceLabels, routeRisk, sizeBucket } from "../match/format";
import { Panel, PanelTitle, Segmented, Badge, EmptyState } from "../ui/primitives";
import { Icon } from "../ui/icons";

export function Convoys() {
  const { view, match } = useApp();
  const [tab, setTab] = useState<"mine" | "rivals">("mine");
  const galaxy = view.galaxy;
  const mineId = match.humanCorpId;
  const convoys = view.convoys.filter((c) => (tab === "mine" ? c.owner === mineId : c.owner !== mineId));

  return (
    <div className="convoys">
      <Panel className="convoys__panel">
        <PanelTitle
          icon="convoys"
          eyebrow="Warp Traffic"
          title="Convoys in Transit"
          right={<Segmented value={tab} onChange={(v) => setTab(v)} options={[{ value: "mine", label: "Mine" }, { value: "rivals", label: "Rivals" }]} />}
        />
        {convoys.length === 0 ? (
          <EmptyState icon="convoys">{tab === "mine" ? "No active shipments. Sell or transfer from the Exchange." : "No visible rival convoys this turn."}</EmptyState>
        ) : (
          <div className="convoy-list">
            {convoys.map((c) => {
              const mine = c.owner === mineId;
              const dest = galaxy.system(c.path[c.path.length - 1]!);
              const route = galaxy.routes.get(c.routeIds[c.position] ?? "");
              const risk = route ? routeRisk(route) : { label: "—", level: "guarded" as const };
              const owner = view.corporations.find((x) => x.id === c.owner);
              return (
                <article key={c.id} className="convoy-card" onClick={() => store.select({ kind: "convoy", id: c.id })}>
                  <div className="convoy-card__icon" style={{ color: corpColor(c.owner) }}>
                    <Icon name="convoys" size={18} />
                  </div>
                  <div className="convoy-card__main">
                    <div className="convoy-card__top">
                      <strong>{resourceLabels[c.resource]} {c.kind === "buy" ? "import" : c.kind === "transfer" ? "transfer" : "export"}</strong>
                      <Badge tone={risk.level === "severe" ? "negative" : risk.level === "high" ? "warn" : "neutral"}>{risk.label}</Badge>
                    </div>
                    <div className="convoy-card__path">
                      {c.path.map((id) => galaxy.system(id).name).join(" → ")}
                    </div>
                    <div className="convoy-card__meta">
                      {mine ? <span>{Math.round(c.quantity)} units</span> : <span>{sizeBucket(c.value)} cargo</span>}
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
    </div>
  );
}
