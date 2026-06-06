import { canRaidRoute, raidStrength, type PlayerView } from "@engine";
import { store, type Selection } from "../match/store";
import {
  archetypeLabel,
  corpColor,
  formatCr,
  populationLabel,
  resourceLabels,
  routeRisk,
  sizeBucket,
  stockpileValue,
  sumYields,
  systemArchetype,
} from "../match/format";
import { RESOURCES } from "@engine";
import { Badge, Bar, Panel, PanelTitle, ActionButton } from "../ui/primitives";
import { PlanetArt, ArtSlot } from "../theme/ArtSlot";
import { ResourceIcon } from "../theme/art";

export function Inspector({
  view,
  humanCorpId,
  selection,
}: {
  view: PlayerView;
  humanCorpId: string;
  selection: Selection;
}) {
  if (!selection) return null;
  const galaxy = view.galaxy;

  if (selection.kind === "route") {
    const route = galaxy.routes.get(selection.id);
    if (!route) return null;
    const a = galaxy.system(route.a);
    const b = galaxy.system(route.b);
    const risk = routeRisk(route);
    const canRaid = !view.me.isFreeOperator || true;
    const eligible = canRaidRoute(galaxy, view.me, route);
    const traffic = galaxy.recentTraffic(route.id, view.turn);
    const reachable = route.requiredRange <= view.me.rangeTier;
    return (
      <Panel className="inspector">
        <div className="inspector__portrait">
          <ArtSlot slot={route.stability >= 0.6 ? "route-stable" : "route-unstable"} />
        </div>
        <PanelTitle
          icon="radar"
          eyebrow="Warp Route"
          title={`${a.name} ↔ ${b.name}`}
          right={!route.charted ? <ArtSlot slot="action-survey" className="cue-art" /> : (risk.level === "severe" || risk.level === "high") ? <ArtSlot slot="status-raid-risk" className="cue-art" /> : undefined}
        />
        <dl className="kv">
          <div><dt>Transit</dt><dd>{route.transitTime} turn{route.transitTime > 1 ? "s" : ""}</dd></div>
          <div><dt>Stability</dt><dd>{Math.round(route.stability * 100)}%</dd></div>
          <div><dt>Exposure</dt><dd><Badge tone={risk.level === "severe" ? "negative" : risk.level === "high" ? "warn" : "neutral"}>{risk.label}</Badge></dd></div>
          <div><dt>Authority</dt><dd>{Math.round(route.authorityPresence * 100)}%</dd></div>
          <div><dt>Traffic (5t)</dt><dd>{traffic} convoy{traffic === 1 ? "" : "s"}</dd></div>
          <div><dt>Min range</dt><dd>Tier {route.requiredRange}</dd></div>
        </dl>
        <div className="action-row">
          {!route.charted && (
            <ActionButton
              icon="radar"
              variant="primary"
              disabled={!reachable}
              title={reachable ? "Draft a survey order" : `Needs Range ${route.requiredRange}`}
              onClick={() => store.stage({ kind: "survey", routeId: route.id })}
            >
              Survey
            </ActionButton>
          )}
          <ActionButton
            icon="crosshair"
            variant="danger"
            disabled={!eligible || !canRaid}
            title={eligible ? "Set a route interdiction" : "No eligible raiders in range"}
            onClick={() => store.stage({ kind: "interdict", routeId: route.id })}
          >
            Interdict
          </ActionButton>
        </div>
        {!eligible && (
          <p className="hint">Need a raider ship or privateer based at an endpoint to interdict this lane.</p>
        )}
      </Panel>
    );
  }

  if (selection.kind === "convoy") {
    const c = view.convoys.find((x) => x.id === selection.id);
    if (!c) return null;
    const mine = c.owner === humanCorpId;
    const dest = galaxy.system(c.path[c.path.length - 1]!);
    const owner = view.corporations.find((x) => x.id === c.owner);
    const currentRoute = galaxy.routes.get(c.routeIds[c.position] ?? "");
    const eligible = currentRoute ? canRaidRoute(galaxy, view.me, currentRoute) : false;
    const targetable = c.routeIds.length >= 2 && c.launchedTurn < view.turn;
    return (
      <Panel className="inspector">
        <PanelTitle
          icon="convoys"
          eyebrow={mine ? "Your Convoy" : "Rival Convoy"}
          title={`${resourceLabels[c.resource]} ${c.kind === "buy" ? "import" : c.kind === "transfer" ? "transfer" : "export"}`}
          right={!mine ? <ArtSlot slot="action-interdict" className="cue-art" /> : undefined}
        />
        <dl className="kv">
          {mine ? (
            <div><dt>Cargo</dt><dd>{Math.round(c.quantity)} units</dd></div>
          ) : (
            <div><dt>Size</dt><dd>{sizeBucket(c.value)}</dd></div>
          )}
          <div><dt>To</dt><dd>{dest.name}</dd></div>
          <div><dt>ETA</dt><dd>{Math.max(1, c.segmentTurnsLeft)} turn{c.segmentTurnsLeft > 1 ? "s" : ""}</dd></div>
          {mine && c.kind === "sell" && <div><dt>Payout</dt><dd>{formatCr(c.payout)}</dd></div>}
          {mine ? (
            <div><dt>Escort</dt><dd>{c.escort.toFixed(0)}</dd></div>
          ) : (
            <div><dt>Owner</dt><dd><span style={{ color: corpColor(c.owner) }}>{owner?.name ?? c.owner}</span></dd></div>
          )}
        </dl>
        {!mine && (
          <>
            <div className="action-row">
              <ActionButton
                icon="crosshair"
                variant="danger"
                disabled={!eligible || !targetable}
                title={targetable ? (eligible ? "Target this shipment" : "No raiders in range") : "Protected 1-turn run"}
                onClick={() => store.stage({ kind: "targetConvoy", convoyId: c.id })}
              >
                Target convoy
              </ActionButton>
            </div>
            {!targetable && <p className="hint">One-turn hub runs can only be hit by a pre-placed route interdiction.</p>}
          </>
        )}
      </Panel>
    );
  }

  // system
  const sys = galaxy.systems.get(selection.id);
  if (!sys) return null;
  const isHub = sys.id === galaxy.hubId;
  const mine = sys.owner === humanCorpId;
  const open = sys.owner === null && !isHub;
  const owner = sys.owner ? view.corporations.find((c) => c.id === sys.owner) : undefined;
  const arch = systemArchetype(sys);
  const t = view.config.tuning;
  const affordClaim = view.me.credits >= sys.claimCost;

  return (
    <Panel className="inspector">
      <div className="inspector__portrait">
        {isHub ? <ArtSlot slot="hero-wormhole-hub" /> : <PlanetArt archetype={arch} />}
      </div>
      <PanelTitle
        icon={mine ? "systems" : open ? "gavel" : isHub ? "exchange" : "systems"}
        eyebrow={isHub ? "Neutral" : mine ? "Your Charter" : open ? "Open Claim" : "Rival Charter"}
        title={sys.name}
        right={owner ? <Badge tone="neutral" className="owner-chip"><span style={{ color: corpColor(owner.id) }}>●</span> {owner.name}</Badge> : open ? <ArtSlot slot="action-claim" className="cue-art" /> : undefined}
      />
      {isHub ? (
        <p className="hint">The Wormhole Hub hosts the Galactic Exchange. It is Authority-protected — it cannot be claimed or raided.</p>
      ) : (
        <>
          <p className="inspector__arch">{archetypeLabel[arch]}</p>
          <dl className="kv">
            <div><dt>Yield</dt><dd>{sumYields(sys.yields).toFixed(0)}/t</dd></div>
            <div><dt>Upkeep</dt><dd>{formatCr(sys.upkeep)}/t</dd></div>
            {!open && <div><dt>Population</dt><dd>{populationLabel[sys.populationStage]}</dd></div>}
            <div><dt>Defense</dt><dd>{(sys.defense + sys.platforms * t.platformDefense + (sys.hasDepot ? t.depotDefenseBonus : 0)).toFixed(0)}</dd></div>
            {open && <div><dt>Claim cost</dt><dd>{formatCr(sys.claimCost)}</dd></div>}
          </dl>

          <div className="yield-row">
            {RESOURCES.filter((r) => sys.yields[r] > 0).map((r) => (
              <span key={r} className="yield-pill">
                <ResourceIcon resource={r} size={16} /> {resourceLabels[r]} +{sys.yields[r]}
              </span>
            ))}
          </div>

          {mine && (
            <>
              <div className="pop-meter">
                <div className="colony-strip">
                  <ArtSlot slot={`colony-${sys.populationStage}`} className="colony-art" />
                  {sys.unrest > 0.01 && <ArtSlot slot="status-unrest" className="cue-art cue-art--corner" />}
                </div>
                <div className="pop-meter__head">
                  <span>{populationLabel[sys.populationStage]}</span>
                  {sys.unrest > 0.01 && <Badge tone="negative">Unrest {Math.round(sys.unrest * 100)}%</Badge>}
                </div>
                <Bar value={sys.populationProgress} max={t.growthThreshold} tone={sys.unrest > 0.01 ? "warn" : "positive"} />
              </div>
              <div className="stock-grid">
                {RESOURCES.map((r) => (
                  <div key={r} className="stock-cell">
                    <ResourceIcon resource={r} size={18} />
                    <span>{resourceLabels[r]}</span>
                    <strong>{Math.round(sys.stockpile[r])}</strong>
                  </div>
                ))}
              </div>
              {(sys.hasDepot || sys.hydroponics > 0 || sys.platforms > 0) && (
                <div className="infra-art">
                  {sys.hasDepot && <ArtSlot slot="infra-depot" className="infra-thumb" />}
                  {sys.hydroponics > 0 && <ArtSlot slot="infra-hydroponics" className="infra-thumb" />}
                  {sys.platforms > 0 && <ArtSlot slot="infra-platform" className="infra-thumb" />}
                </div>
              )}
              <div className="infra-row">
                <Badge tone={sys.hasDepot ? "accent" : "neutral"}>Depot {sys.hasDepot ? "✓" : "—"}</Badge>
                <Badge tone={sys.hydroponics ? "accent" : "neutral"}>Hydro ×{sys.hydroponics}</Badge>
                <Badge tone={sys.platforms ? "accent" : "neutral"}>Platform ×{sys.platforms}/{t.platformCap}</Badge>
              </div>
              <div className="action-row">
                <ActionButton icon="exchange" onClick={() => { store.select({ kind: "system", id: sys.id }); store.setNav("exchange"); }}>Trade</ActionButton>
                {!sys.hasDepot && <ActionButton icon="systems" onClick={() => store.stage({ kind: "buildDepot", systemId: sys.id })}>Depot</ActionButton>}
                <ActionButton icon="flask" onClick={() => store.stage({ kind: "buildHydroponics", systemId: sys.id })}>Hydro</ActionButton>
                {sys.platforms < t.platformCap && <ActionButton icon="shield" onClick={() => store.stage({ kind: "buildPlatform", systemId: sys.id })}>Platform</ActionButton>}
              </div>
            </>
          )}

          {open && (
            <div className="action-row">
              <ActionButton
                icon="gavel"
                variant="primary"
                disabled={!affordClaim || view.me.isFreeOperator}
                title={view.me.isFreeOperator ? "Free Operators cannot claim systems" : affordClaim ? "Register a charter claim" : "Not enough credits"}
                onClick={() => store.stage({ kind: "claim", systemId: sys.id, amount: sys.claimCost })}
              >
                Claim · {formatCr(sys.claimCost)}
              </ActionButton>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}
