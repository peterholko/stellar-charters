import { useMemo } from "react";
import type { PlayerView } from "@engine";
import { computeLayout } from "../match/layout";
import {
  corpColor,
  resourceColors,
  routeRisk,
  systemArchetype,
  dominantResource,
} from "../match/format";
import type { Selection } from "../match/store";

export function SystemMap({
  view,
  humanCorpId,
  selection,
  onSelect,
}: {
  view: PlayerView;
  humanCorpId: string;
  selection: Selection;
  onSelect: (sel: Selection) => void;
}) {
  const galaxy = view.galaxy;
  const layout = useMemo(() => computeLayout(galaxy), [galaxy]);
  const systems = galaxy.allSystems();
  const routes = [...galaxy.routes.values()];
  const pt = (id: string) => layout.get(id) ?? { x: 50, y: 50 };

  return (
    <svg className="galaxy" viewBox="0 0 100 100" role="img" aria-label="Galaxy map">
      <defs>
        <radialGradient id="hubGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--accent-2)" stopOpacity="0.5" />
          <stop offset="100%" stopColor="var(--accent-2)" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* routes */}
      {routes.map((r) => {
        const a = pt(r.a);
        const b = pt(r.b);
        const risk = routeRisk(r);
        const selected = selection?.kind === "route" && selection.id === r.id;
        const traffic = galaxy.recentTraffic(r.id, view.turn);
        const width = 0.25 + Math.min(1.1, traffic * 0.22);
        return (
          <g key={r.id} className="route" onClick={() => onSelect({ kind: "route", id: r.id })}>
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="route__hit" />
            <line
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              className={`route__line route__line--${risk.level} ${selected ? "is-selected" : ""}`}
              strokeWidth={width}
            />
          </g>
        );
      })}

      {/* convoys */}
      {view.convoys.map((c) => {
        const rid = c.routeIds[c.position];
        const route = rid ? galaxy.routes.get(rid) : undefined;
        if (!route) return null;
        const a = pt(route.a);
        const b = pt(route.b);
        const frac = c.launchedTurn >= view.turn ? 0.18 : 0.5;
        const x = a.x + (b.x - a.x) * frac;
        const y = a.y + (b.y - a.y) * frac;
        const mine = c.owner === humanCorpId;
        return (
          <g
            key={c.id}
            className={`convoy ${mine ? "convoy--mine" : "convoy--rival"} ${
              selection?.kind === "convoy" && selection.id === c.id ? "is-selected" : ""
            }`}
            onClick={(e) => {
              e.stopPropagation();
              onSelect({ kind: "convoy", id: c.id });
            }}
          >
            <circle cx={x} cy={y} r={1.5} className="convoy__halo" />
            <path d={`M${x} ${y - 1.3} L${x + 1.1} ${y} L${x} ${y + 1.3} L${x - 1.1} ${y} Z`} />
          </g>
        );
      })}

      {/* systems */}
      {systems.map((s) => {
        const p = pt(s.id);
        const isHub = s.id === galaxy.hubId;
        const mine = s.owner === humanCorpId;
        const open = s.owner === null && !isHub;
        const selected = selection?.kind === "system" && selection.id === s.id;
        const arch = systemArchetype(s);
        const fill = isHub
          ? "var(--accent)"
          : s.owner
          ? mine
            ? "var(--accent)"
            : corpColor(s.owner)
          : resourceColors[dominantResource(s.yields)];
        const r = isHub ? 2.9 : 1.9;
        return (
          <g
            key={s.id}
            className={`sys ${mine ? "sys--mine" : open ? "sys--open" : isHub ? "sys--hub" : "sys--rival"} ${
              selected ? "is-selected" : ""
            }`}
            onClick={() => onSelect({ kind: "system", id: s.id })}
          >
            {isHub && <circle cx={p.x} cy={p.y} r={6} fill="url(#hubGlow)" />}
            <circle className="sys__halo" cx={p.x} cy={p.y} r={r + 1.7} />
            <circle className="sys__core" cx={p.x} cy={p.y} r={r} style={{ fill }} fillOpacity={open ? 0.35 : 1} />
            {mine && <circle className="sys__ring" cx={p.x} cy={p.y} r={r + 2.6} />}
            <text className="sys__label" x={p.x} y={p.y + r + 3.4}>
              {s.name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
