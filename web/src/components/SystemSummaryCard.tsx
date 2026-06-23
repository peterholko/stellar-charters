import { canHostPopulation, coloniesOf, potentialYields, RESOURCES, type PlayerView } from "@engine";
import { corpColor, planetTypeLabel, populationLabel, starTypeColor, starTypeLabel } from "../match/format";
import { Panel, Badge } from "../ui/primitives";
import { ResourceIcon, CorpCrest } from "../theme/art";
import { Icon } from "../ui/icons";
import { store } from "../match/store";

/**
 * Map-screen system card (deliberately shallow): owner, star, one planets line,
 * deposit icons, and defense/fleet — a glance, not a dossier. The Systems screen
 * keeps the full colony detail.
 */
export function SystemSummaryCard({ view, humanCorpId, systemId }: { view: PlayerView; humanCorpId: string; systemId: string }) {
  const sys = view.galaxy.systems.get(systemId);
  if (!sys) return null;
  const t = view.config.tuning;
  const owner = sys.owner ? view.corporations.find((c) => c.id === sys.owner) : null;
  const mine = sys.owner === humanCorpId;

  // Deposits: full-development potential per resource, icons only (no site detail).
  const pot = potentialYields(sys);
  const deposits = RESOURCES.filter((r) => pot[r] > 0.5).map((r) => ({ r, v: pot[r] }));

  // Planets: one line — count, habitability, and up to three world types.
  const colonies = coloniesOf(sys);
  const habitable = colonies.filter((c) => canHostPopulation(c)).length;
  const types = [...new Set(colonies.map((c) => planetTypeLabel[c.bodyType as keyof typeof planetTypeLabel] ?? c.bodyType))];
  const typeLine = types.slice(0, 3).join(", ") + (types.length > 3 ? "…" : "");

  // Defense & your fleet (rival fleets are fog-of-war).
  const defense = sys.defense + sys.platforms * t.platformDefense + (sys.hasDepot ? t.depotDefenseBonus : 0) + (sys.hasDisruptor ? t.disruptorDefenseBonus : 0);
  const fleet = view.me.ships.filter((s) => s.combat > 0 && !s.transit && s.stationedAt === sys.id);
  const fleetCombat = fleet.reduce((a, s) => a + s.combat, 0);

  return (
    <Panel className="syscard">
      <div className="syscard__head">
        <div>
          <strong>{sys.name}</strong>
          <span className="syscard__owner">
            {owner ? (
              <>
                <CorpCrest corpId={owner.id} size={14} />
                <i style={{ color: corpColor(owner.id) }}>{mine ? "Yours" : owner.name}</i>
              </>
            ) : (
              "Unclaimed"
            )}
            {" · "}
            {populationLabel[sys.populationStage]}
          </span>
        </div>
        {sys.bodies?.starType && (
          <span className="syscard__star" style={{ color: starTypeColor[sys.bodies.starType] }}>
            {starTypeLabel[sys.bodies.starType]}
          </span>
        )}
      </div>

      {colonies.length > 0 && (
        <p className="syscard__line">
          {colonies.length} world{colonies.length === 1 ? "" : "s"} · {habitable} habitable{typeLine ? ` · ${typeLine}` : ""}
        </p>
      )}

      {deposits.length > 0 ? (
        <div className="syscard__res">
          {deposits.map(({ r, v }) => (
            <span key={r} className="syscard__chip" title={`${r}: ~${v.toFixed(1)}/t at full development`}>
              <ResourceIcon resource={r} size={18} />
              {v.toFixed(0)}
            </span>
          ))}
        </div>
      ) : (
        <p className="syscard__line">No surveyed deposits.</p>
      )}

      <div className="syscard__foot">
        <Badge tone="neutral">Def {defense.toFixed(0)}</Badge>
        {sys.platforms > 0 && <Badge tone="accent">Platforms ×{sys.platforms}</Badge>}
        {sys.hasDepot && <Badge tone="accent">Depot</Badge>}
        {sys.hasDisruptor && <Badge tone="accent">Disruptor</Badge>}
        {fleet.length > 0 && <Badge tone="positive">Your fleet {fleet.length} · cbt {Math.round(fleetCombat)}</Badge>}
      </div>

      {mine && (
        <button type="button" className="ghost-btn syscard__more" onClick={() => store.setNav("systems")}>
          <Icon name="systems" size={13} /> Manage in Systems
        </button>
      )}
    </Panel>
  );
}
