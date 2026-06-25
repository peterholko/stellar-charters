import { EXTRACTOR_CAP, MEGASTRUCTURE_KINDS, buildingTotal, canRaidRoute, raidStrength, stellarOutputMult, systemSeed, type MegastructureKind, type PlayerView, type System } from "@engine";
import { store, type Selection } from "../match/store";
import {
  archetypeLabel,
  convoyName,
  corpColor,
  formatCr,
  laneName,
  megastructureLabel,
  megastructureShort,
  planetTypeLabel,
  populationLabel,
  resourceLabels,
  routeRisk,
  sizeBucket,
  starTypeColor,
  starTypeLabel,
  stellarNote,
  sumPotential,
  systemArchetype,
} from "../match/format";
import { Badge, Bar, Panel, PanelTitle, ActionButton } from "../ui/primitives";
import { PlanetArt, ArtSlot, StarArt } from "../theme/ArtSlot";
import { ColonyPanel } from "./ColonyPanel";
import { ProductionReadout } from "./ProductionReadout";

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
          eyebrow="Warp Lane"
          title={laneName(route.id)}
          right={!route.charted ? <ArtSlot slot="action-survey" className="cue-art" /> : (risk.level === "severe" || risk.level === "high") ? <ArtSlot slot="status-raid-risk" className="cue-art" /> : undefined}
        />
        <p className="inspector__arch">{a.name} ↔ {b.name}</p>
        <dl className="kv">
          <div><dt>Transit</dt><dd>{route.transitTime} turn{route.transitTime > 1 ? "s" : ""}</dd></div>
          <div><dt>Stability</dt><dd>{Math.round(route.stability * 100)}%</dd></div>
          <div><dt>Exposure</dt><dd><Badge tone={risk.level === "severe" ? "negative" : risk.level === "high" ? "warn" : "neutral"}>{risk.label}</Badge></dd></div>
          <div><dt>Authority</dt><dd>{Math.round(route.authorityPresence * 100)}%</dd></div>
          <div><dt>Traffic (5t)</dt><dd>{traffic} convoy{traffic === 1 ? "" : "s"}</dd></div>
          <div><dt>Reach</dt><dd><Badge tone={reachable ? "neutral" : "warn"}>{reachable ? "In range" : "Beyond range"}</Badge></dd></div>
        </dl>
        <div className="action-row">
          {!route.charted && (
            <ActionButton
              icon="radar"
              variant="primary"
              disabled={!reachable}
              title={reachable ? "Draft a survey order" : "Beyond your fleet's warp range"}
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
          <p className="hint">Need raid access: a raider warship stationed at (or one hop from) the lane's non-hub mouth, a system you own nearby, or a privateer based there.</p>
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
          title={convoyName(c.id)}
          right={!mine ? <ArtSlot slot="action-interdict" className="cue-art" /> : undefined}
        />
        <dl className="kv">
          {mine ? (
            <>
              <div><dt>Cargo</dt><dd>{Math.round(c.quantity)} {resourceLabels[c.resource]}</dd></div>
              <div><dt>Type</dt><dd>{c.kind === "buy" ? "Import" : c.kind === "transfer" ? "Transfer" : "Export"}</dd></div>
            </>
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

  if (selection.kind === "fleet") {
    const sysId = selection.id;
    const fsys = galaxy.systems.get(sysId);
    const ships = view.me.ships.filter((s) => s.combat > 0 && !s.transit && s.stationedAt === sysId);
    if (!fsys || ships.length === 0) return null;
    const combat = ships.reduce((a, s) => a + s.combat, 0);
    const raiders = ships.filter((s) => s.raider).length;
    const jumpRange = ships.reduce((a, s) => Math.min(a, view.config.tuning.maxOffLaneJumpDist[s.rangeTier]), Infinity);
    return (
      <Panel className="inspector">
        <PanelTitle icon="fleet" eyebrow="Your Fleet" title={`Fleet at ${fsys.name}`} right={<Badge tone="accent">cbt {combat}</Badge>} />
        <dl className="kv">
          <div><dt>Ships</dt><dd>{ships.length}</dd></div>
          <div><dt>Combat</dt><dd>{combat}</dd></div>
          <div><dt>Raiders</dt><dd>{raiders}</dd></div>
          <div><dt>Jump range</dt><dd>{jumpRange}</dd></div>
        </dl>
        <p className="hint">Tap a destination system on the map to move this fleet. It marches on-lane within range; entering a rival system assaults it (declares war).</p>
        <div className="action-row">
          <ActionButton icon="systems" onClick={() => store.select({ kind: "system", id: sysId })}>View system</ActionButton>
        </div>
      </Panel>
    );
  }

  if (selection.kind === "survey") {
    const sysId = selection.id;
    const ssys = galaxy.systems.get(sysId);
    const scouts = view.me.ships.filter((s) => s.surveyor && !s.transit && s.stationedAt === sysId);
    if (!ssys || scouts.length === 0) return null;
    return (
      <Panel className="inspector">
        <PanelTitle icon="radar" eyebrow="Survey vessel" title={`Survey skiff at ${ssys.name}`} right={<Badge tone="accent">{scouts.length}</Badge>} />
        <p className="hint">Tap a system on the map to send a survey vessel there — it flies the cheapest charted lanes within range, reveals that system's deposits (richness + reserves), then returns home. Intel stays private to your charter.</p>
        <div className="action-row">
          <ActionButton icon="systems" onClick={() => store.select({ kind: "system", id: sysId })}>View system</ActionButton>
        </div>
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
  const hydroponics = buildingTotal(sys, "hydroponics");

  return (
    <Panel className="inspector">
      <div className="inspector__portrait">
        {isHub ? <ArtSlot slot="hero-wormhole-hub" /> : sys.bodies?.starType ? <StarArt starType={sys.bodies.starType} /> : <PlanetArt archetype={arch} />}
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
          <p className="inspector__arch">
            {archetypeLabel[arch]}
            {sys.bodies?.starType && (
              <>
                {" · "}
                <span style={{ color: starTypeColor[sys.bodies.starType] }}>
                  {starTypeLabel[sys.bodies.starType]}
                </span>
              </>
            )}
          </p>
          {sys.bodies?.starType && stellarNote(sys.bodies.starType) && (
            <p className="hint">{stellarNote(sys.bodies.starType)}</p>
          )}
          <dl className="kv">
            <div><dt>Potential</dt><dd>{sumPotential(sys).toFixed(0)}/t</dd></div>
            <div><dt>Upkeep</dt><dd>{formatCr(sys.upkeep)}/t</dd></div>
            {!open && <div><dt>Population</dt><dd>{populationLabel[sys.populationStage]}</dd></div>}
            <div><dt>Defense</dt><dd>{(sys.defense + sys.platforms * t.platformDefense + (sys.hasDepot ? t.depotDefenseBonus : 0) + (sys.hasDisruptor ? t.disruptorDefenseBonus : 0)).toFixed(0)}</dd></div>
            {open && <div><dt>Claim cost</dt><dd>{formatCr(sys.claimCost)}</dd></div>}
          </dl>

          {/* What this system actually produces, per resource (playtest feedback). */}
          <ProductionReadout sys={sys} view={view} mine={mine} />

          <ColonyPanel sys={sys} view={view} canBuild={mine && !view.me.isFreeOperator} />
          {mine && !isHub && <FleetControls view={view} sys={sys} />}
          {!mine && !isHub && <SurveyControls view={view} sys={sys} />}
          {!mine && sys.owner && (
            <>
              <RivalSabotage view={view} humanCorpId={humanCorpId} sys={sys} />
              <WarControls view={view} sys={sys} />
            </>
          )}

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
              {(sys.hasDepot || hydroponics > 0 || sys.platforms > 0) && (
                <div className="infra-art">
                  {sys.hasDepot && <ArtSlot slot="infra-depot" className="infra-thumb" />}
                  {hydroponics > 0 && <ArtSlot slot="infra-hydroponics" className="infra-thumb" />}
                  {sys.platforms > 0 && <ArtSlot slot="infra-platform" className="infra-thumb" />}
                </div>
              )}
              <div className="infra-row">
                <Badge tone={sys.hasDepot ? "accent" : "neutral"}>Depot {sys.hasDepot ? "✓" : "—"}</Badge>
                <Badge tone={hydroponics ? "accent" : "neutral"}>Hydro ×{hydroponics}</Badge>
                <Badge tone={sys.platforms ? "accent" : "neutral"}>Platform ×{sys.platforms}/{t.platformCap}</Badge>
                <Badge tone={sys.hasDisruptor ? "accent" : "neutral"}>Disruptor {sys.hasDisruptor ? "✓" : "—"}</Badge>
                {sys.megastructures.map((m) => (
                  <Badge key={m} tone="accent">{megastructureShort[m]}</Badge>
                ))}
              </div>
              <div className="action-row">
                <ActionButton icon="exchange" onClick={() => { store.select({ kind: "system", id: sys.id }); store.setNav("exchange"); }}>Trade</ActionButton>
                {!sys.hasDepot && <ActionButton icon="systems" onClick={() => store.stage({ kind: "buildDepot", systemId: sys.id })}>Depot</ActionButton>}
                <ActionButton icon="flask" onClick={() => store.stage({ kind: "buildHydroponics", systemId: sys.id })}>Hydro</ActionButton>
                {sys.platforms < t.platformCap && <ActionButton icon="shield" onClick={() => store.stage({ kind: "buildPlatform", systemId: sys.id })}>Platform</ActionButton>}
                {!sys.hasDisruptor && <ActionButton icon="bolt" title={`Build a Warp Disruptor · ${formatCr(t.disruptorCost)} — holds any rival fleet arriving here for +${t.disruptorDelay} turns`} onClick={() => store.stage({ kind: "buildDisruptor", systemId: sys.id })}>Disruptor</ActionButton>}
                <ReinforceButton view={view} sys={sys} />
              </div>
              <MegastructureBuilds sys={sys} view={view} />
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

/** Initiate a map move for an idle combat fleet stationed at your own system (Section 04/23).
 *  Selecting the fleet switches the inspector to its panel; you then click a destination on the
 *  map to stage the move. This is the discoverable entry point alongside tapping the map chevron. */
function FleetControls({ view, sys }: { view: PlayerView; sys: System }) {
  const fleet = view.me.ships.filter((s) => s.combat > 0 && !s.transit && s.stationedAt === sys.id);
  if (fleet.length === 0) return null;
  const combat = fleet.reduce((a, s) => a + s.combat, 0);
  return (
    <div className="action-row">
      <ActionButton
        icon="fleet"
        variant="primary"
        title="Select this fleet, then click a destination system on the map to move it (off-lane if needed)"
        onClick={() => store.select({ kind: "fleet", id: sys.id })}
      >
        Move fleet · {fleet.length} ship{fleet.length > 1 ? "s" : ""} · cbt {combat}
      </ActionButton>
    </div>
  );
}

/** Dispatch an idle survey vessel to scout this system (Section 25): it flies the cheapest charted
 *  path, reveals every deposit's richness + reserves on arrival (even in rival space), then returns. */
function SurveyControls({ view, sys }: { view: PlayerView; sys: System }) {
  const me = view.me;
  const scouted = me.ownedSystemIds.includes(sys.id) || me.surveyedSystemIds.includes(sys.id);
  const surveyStaged = store.state.staged.some((s) => s.order.kind === "surveySystem" && s.order.targetSystemId === sys.id);
  // Find an idle survey vessel that can reach this system on charted routes within its range.
  const scouts = me.ships.filter((s) => s.surveyor && !s.transit && s.stationedAt);
  let from: string | null = null;
  for (const ship of scouts) {
    const path = view.galaxy.shortestWarpPath(ship.stationedAt, sys.id, ship.rangeTier);
    if (path && path.routes.length > 0) { from = ship.stationedAt; break; }
  }
  return (
    <div className="survey-controls">
      {scouted ? (
        <Badge tone="positive">Surveyed — deposits revealed</Badge>
      ) : surveyStaged ? (
        <Badge tone="accent">Survey vessel dispatched</Badge>
      ) : (
        <ActionButton
          icon="radar"
          disabled={!from}
          title={
            from
              ? "Send a survey vessel to scout this system's deposits — it returns home after"
              : scouts.length > 0
                ? "No survey vessel within charted range of this system (chart a route or move a scout closer)"
                : "Build a survey vessel first, at one of your systems"
          }
          onClick={() => from && store.stage({ kind: "surveySystem", fromSystemId: from, targetSystemId: sys.id })}
        >
          Survey system
        </ActionButton>
      )}
    </div>
  );
}

/** Redeploy the strongest warship from another owned system to this one (Section 23 mobilisation) —
 *  mass force at a staging border for an invasion, or reinforce a threatened world. */
function ReinforceButton({ view, sys }: { view: PlayerView; sys: System }) {
  const source = view.me.ownedSystemIds
    .filter((id) => id !== sys.id)
    .map((id) => ({ id, force: view.me.ships.filter((s) => s.combat > 0 && s.stationedAt === id).reduce((s, sh) => s + sh.combat, 0) }))
    .filter((e) => e.force > 0)
    .sort((a, b) => b.force - a.force)[0];
  if (!source) return null;
  return (
    <ActionButton
      icon="convoys"
      title="Redeploy your strongest warship here to mass for an invasion or reinforce this system"
      onClick={() => store.stage({ kind: "redeployShip", fromSystemId: source.id, toSystemId: sys.id })}
    >
      Reinforce
    </ActionButton>
  );
}

const STAGE_ORDER = ["outpost", "settlement", "colony", "city", "metropolis"];

/** Megastructure build controls (Section 22) — the metal-hungry grand-construction ladder. */
function MegastructureBuilds({ sys, view }: { sys: System; view: PlayerView }) {
  if (view.me.isFreeOperator) return null;
  const specs = view.config.tuning.megastructures;
  const buildable = MEGASTRUCTURE_KINDS.filter(
    (k) =>
      !sys.megastructures.includes(k) &&
      STAGE_ORDER.indexOf(sys.populationStage) >= STAGE_ORDER.indexOf(specs[k].requiresStage),
  );
  if (buildable.length === 0) return null;
  // Local stock toward the metals/alloys bill (rough affordability hint).
  const localMetals = sys.stockpile?.metals ?? 0;
  return (
    <div className="mega-builds">
      <h4 className="composition__title">Grand construction</h4>
      <div className="action-row">
        {buildable.map((k) => {
          const spec = specs[k];
          const metalShort = Math.max(0, spec.metalsCost - localMetals);
          const afford = view.me.credits >= spec.creditCost;
          return (
            <ActionButton
              key={k}
              icon="systems"
              disabled={!afford}
              title={`${megastructureLabel[k]} · ${spec.metalsCost} metals${spec.alloyCost ? ` + ${spec.alloyCost} alloys` : ""} + ${formatCr(spec.creditCost)}${metalShort > 0 ? ` (need ${Math.round(metalShort)} more metals here)` : ""}`}
              onClick={() => store.stage({ kind: "buildMegastructure", systemId: sys.id, structure: k })}
            >
              {megastructureLabel[k]}
            </ActionButton>
          );
        })}
      </div>
    </div>
  );
}

/** Sabotage controls shown on a rival-held system (Section 21 economic warfare). */
function RivalSabotage({ view, humanCorpId, sys }: { view: PlayerView; humanCorpId: string; sys: System }) {
  if (sys.owner === null || sys.owner === humanCorpId) return null;
  const worked = sys.sites.filter((s) => s.extractorLevel > 0 && s.disabledUntil <= view.turn);
  if (worked.length === 0) return null;
  const hasForce = view.me.ships.some((s) => s.raider) || view.me.privateers.length > 0;
  const target = [...worked].sort((a, b) => b.richness - a.richness)[0]!;
  return (
    <div className="action-row">
      <ActionButton
        icon="crosshair"
        variant="danger"
        disabled={!hasForce}
        title={hasForce ? "Knock this system's top extractor offline" : "Need a raider or privateer in range"}
        onClick={() => store.stage({ kind: "sabotage", systemId: sys.id, siteKey: target.key })}
      >
        Sabotage {resourceLabels[target.resource]}
      </ActionButton>
    </div>
  );
}

/** War & diplomacy controls for a rival-held system (Section 23): invade, ally, war status. */
function WarControls({ view, sys }: { view: PlayerView; sys: System }) {
  const ownerId = sys.owner!;
  const me = view.me;
  if (ownerId === me.id || me.isFreeOperator) return null;
  const owner = view.corporations.find((c) => c.id === ownerId);
  const allied = !!owner && me.alliancePledges.includes(ownerId) && owner.alliancePledges.includes(me.id);
  const iPledged = me.alliancePledges.includes(ownerId);
  const atWar = view.wars.some(
    (w) => w.endTurn > view.turn && ((w.aggressorId === me.id && w.defenderId === ownerId) || (w.aggressorId === ownerId && w.defenderId === me.id)),
  );
  // The owned system with our largest idle fleet, and whether it can reach this target by a
  // charted path within range (mobile fleets march through neutral space — Section 23).
  let base: { id: string; combat: number } | undefined;
  for (const id of me.ownedSystemIds) {
    const combat = me.ships.filter((s) => s.combat > 0 && !s.transit && s.stationedAt === id).reduce((a, s) => a + s.combat, 0);
    if (combat > 0 && (!base || combat > base.combat)) base = { id, combat };
  }
  const canReach = !!base && !!view.galaxy.shortestWarpPath(base.id, sys.id, me.rangeTier);
  return (
    <div className="war-controls">
      {atWar && <p className="hint hint--war">⚔ At war with {owner?.name ?? ownerId}.</p>}
      {allied && <p className="hint">🤝 Defensive alliance with {owner?.name ?? ownerId}.</p>}
      <div className="action-row">
        {!allied && (
          <ActionButton
            icon="crosshair"
            variant="danger"
            disabled={!canReach}
            title={canReach ? "March your fleet here to assault it — entering declares war; win to capture, lose to fall back" : "Need a fleet that can reach this system by a charted route"}
            onClick={() => base && store.stage({ kind: "moveFleet", fromSystemId: base.id, toSystemId: sys.id })}
          >
            Assault
          </ActionButton>
        )}
        {allied ? (
          <ActionButton icon="systems" onClick={() => store.stage({ kind: "allianceBreak", targetId: ownerId })}>Break alliance</ActionButton>
        ) : !atWar ? (
          <ActionButton icon="systems" disabled={iPledged} title={iPledged ? "Pledge sent — awaiting their reciprocation" : "Pledge a mutual defensive alliance"} onClick={() => store.stage({ kind: "alliancePledge", targetId: ownerId })}>
            {iPledged ? "Pledge sent" : "Pledge alliance"}
          </ActionButton>
        ) : null}
      </div>
    </div>
  );
}
