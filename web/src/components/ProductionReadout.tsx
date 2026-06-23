/**
 * Per-resource stockpile + production readout for a system (playtest feedback: clicking a
 * system must show what it actually PRODUCES and what's IN STOCK). The stockpile is
 * system-wide — every body in the system draws from one shared pool — so one combined table
 * covers both. Owners see the stockpile alongside real output — `effectiveYields` (worked
 * sites, net of depletion + stellar), the same numbers the engine resolves — plus the
 * fully-developed potential so unworked upside is visible. Non-owners see (fogged) potential
 * only; rival stockpiles are hidden.
 */
import { RESOURCES, effectiveYields, potentialYields, type PlayerView, type System } from "@engine";
import { resourceLabels } from "../match/format";
import { ResourceIcon } from "../theme/art";

export function ProductionReadout({ sys, view, mine }: { sys: System; view: PlayerView; mine: boolean }) {
  const now = mine ? effectiveYields(sys, view.turn, view.config.turns) : null;
  const pot = potentialYields(sys);
  const rows = RESOURCES
    .map((r) => ({ r, now: now ? now[r] : 0, pot: pot[r], stock: mine ? sys.stockpile[r] : 0 }))
    .filter((x) => x.now > 0.05 || x.pot > 0.05 || x.stock >= 1);
  if (rows.length === 0) return null;

  if (!mine) {
    return (
      <div className="prodgrid">
        <span className="prodgrid__title">Potential / turn (if fully worked)</span>
        {rows.map(({ r, pot: p }) => (
          <div key={r} className="prodgrid__row">
            <ResourceIcon resource={r} size={15} />
            <span className="prodgrid__name">{resourceLabels[r]}</span>
            <strong className="prodgrid__now">~{p.toFixed(1)}/t</strong>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="prodgrid prodgrid--stocked">
      <div className="prodgrid__head">
        <span className="prodgrid__title">Stockpile &amp; production</span>
        <span className="prodgrid__col">Stock</span>
        <span className="prodgrid__col">Per turn</span>
      </div>
      {rows.map(({ r, now: n, pot: p, stock: s }) => (
        <div key={r} className="prodgrid__row">
          <ResourceIcon resource={r} size={15} />
          <span className="prodgrid__name">{resourceLabels[r]}</span>
          <strong className="prodgrid__stock" title="System-wide stockpile — every colony in this system draws from one shared pool">{Math.floor(s)}</strong>
          <span className="prodgrid__rate">
            {n > 0.05 ? <strong className="prodgrid__now">+{n.toFixed(1)}</strong> : <span className="prodgrid__none">—</span>}
            {p > n + 0.05 && <span className="prodgrid__pot" title="Output if every deposit were worked to max level">▲ {p.toFixed(1)}</span>}
          </span>
        </div>
      ))}
    </div>
  );
}
