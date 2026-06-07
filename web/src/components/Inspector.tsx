import { EXTRACTOR_CAP, MEGASTRUCTURE_KINDS, canRaidRoute, raidStrength, stellarOutputMult, systemSeed, type MegastructureKind, type PlayerView, type System } from "@engine";
import { store, type Selection } from "../match/store";
import {
  archetypeLabel,
  corpColor,
  formatCr,
  megastructureLabel,
  megastructureShort,
  populationLabel,
  resourceLabels,
  routeRisk,
  sizeBucket,
  starTypeColor,
  starTypeLabel,
  stellarNote,
  stockpileValue,
  sumPotential,
  systemArchetype,
} from "../match/format";
import { RESOURCES } from "@engine";
import { Badge, Bar, Panel, PanelTitle, ActionButton } from "../ui/primitives";
import { PlanetArt, ArtSlot, StarArt } from "../theme/ArtSlot";
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
            <div><dt>Defense</dt><dd>{(sys.defense + sys.platforms * t.platformDefense + (sys.hasDepot ? t.depotDefenseBonus : 0)).toFixed(0)}</dd></div>
            {open && <div><dt>Claim cost</dt><dd>{formatCr(sys.claimCost)}</dd></div>}
          </dl>

          <SystemComposition sys={sys} canBuild={mine && !view.me.isFreeOperator} turn={view.turn} totalTurns={view.config.turns} assayCost={t.assayCost} />
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
                {sys.megastructures.map((m) => (
                  <Badge key={m} tone="accent">{megastructureShort[m]}</Badge>
                ))}
              </div>
              <div className="action-row">
                <ActionButton icon="exchange" onClick={() => { store.select({ kind: "system", id: sys.id }); store.setNav("exchange"); }}>Trade</ActionButton>
                {!sys.hasDepot && <ActionButton icon="systems" onClick={() => store.stage({ kind: "buildDepot", systemId: sys.id })}>Depot</ActionButton>}
                <ActionButton icon="flask" onClick={() => store.stage({ kind: "buildHydroponics", systemId: sys.id })}>Hydro</ActionButton>
                {sys.platforms < t.platformCap && <ActionButton icon="shield" onClick={() => store.stage({ kind: "buildPlatform", systemId: sys.id })}>Platform</ActionButton>}
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

/** Per-body deposit list (Section 21): what the system carries, what's worked, and the
 *  extractor/assay actions to develop it. */
function SystemComposition({ sys, canBuild, turn, totalTurns, assayCost }: { sys: System; canBuild: boolean; turn: number; totalTurns: number; assayCost: number }) {
  if (sys.sites.length === 0) return null;
  const sites = [...sys.sites].sort((a, b) => a.orbit - b.orbit || a.resource.localeCompare(b.resource));
  const star = sys.bodies?.starType;
  // Is a stellar event acting on output THIS turn? (a flare brownout or a pulse surge)
  const stellar = star
    ? sys.sites.reduce(
        (acc, s) => {
          const m = stellarOutputMult(star, s, systemSeed(sys), turn, totalTurns);
          return { min: Math.min(acc.min, m), max: Math.max(acc.max, m) };
        },
        { min: 1, max: 1 },
      )
    : { min: 1, max: 1 };
  const stellarBadge =
    stellar.min <= 0 ? { tone: "negative" as const, label: "Flare — extractors offline" }
    : stellar.max > 1.05 ? { tone: "accent" as const, label: "Output surge this turn" }
    : stellar.min < 0.95 ? { tone: "warn" as const, label: "Output dampened" }
    : null;
  return (
    <div className="composition">
      <div className="composition__head">
        {star && <StarArt starType={star} className="composition__star" />}
        <h4 className="composition__title">System composition</h4>
        {stellarBadge && <Badge tone={stellarBadge.tone}>{stellarBadge.label}</Badge>}
      </div>
      <div className="composition__list">
        {sites.map((site) => {
          const offline = site.disabledUntil > turn;
          const dry = site.reservesRemaining !== null && site.reservesRemaining <= 0;
          const worked = site.extractorLevel > 0;
          // Reserves are fogged to null until surveyed, so only call a deposit "renewable" once
          // it's actually been prospected — otherwise its reserves are simply unknown.
          const reserveStr = !site.prospected
            ? "reserves ?"
            : site.reservesRemaining === null
            ? "renewable"
            : `${Math.round(site.reservesRemaining)} left`;
          return (
            <div key={site.key} className={`site-row${offline ? " site-row--offline" : ""}`}>
              <div className="site-row__body">
                <ResourceIcon resource={site.resource} size={16} />
                <div className="site-row__text">
                  <strong>{resourceLabels[site.resource]}</strong>
                  <span className="site-row__sub">
                    {site.bodyLabel} · {site.prospected ? `rich ${site.richness}` : "unsurveyed"} · {reserveStr}
                  </span>
                </div>
                <span className="site-row__ext">
                  {offline ? <Badge tone="negative">Offline</Badge>
                    : dry ? <Badge tone="neutral">Depleted</Badge>
                    : worked ? <Badge tone="accent">Lv {site.extractorLevel}/{EXTRACTOR_CAP}</Badge>
                    : <Badge tone="neutral">Unworked</Badge>}
                </span>
              </div>
              {canBuild && (
                <div className="site-row__actions">
                  {site.extractorLevel < EXTRACTOR_CAP && !dry && (
                    <ActionButton
                      icon="systems"
                      onClick={() => store.stage({ kind: "buildExtractor", systemId: sys.id, siteKey: site.key })}
                    >
                      {worked ? "Deepen" : "Work"}
                    </ActionButton>
                  )}
                  {!site.prospected && (
                    <ActionButton
                      icon="radar"
                      title={`Assay · ${formatCr(assayCost)}`}
                      onClick={() => store.stage({ kind: "assay", systemId: sys.id, siteKey: site.key })}
                    >
                      Assay
                    </ActionButton>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
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
  // Can a combat ship reach this system to invade?
  const canReach = me.ships.some((sh) => {
    if (sh.combat <= 0 || !sh.stationedAt) return false;
    const r = view.galaxy.routeBetween(sh.stationedAt, sys.id);
    return !!r && r.charted && r.requiredRange <= sh.rangeTier;
  });
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
            title={canReach ? "Invade this system — declares war and bars you from the Exchange until a ceasefire" : "Need a warship stationed on an adjacent lane"}
            onClick={() => store.stage({ kind: "invade", systemId: sys.id })}
          >
            Invade
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
