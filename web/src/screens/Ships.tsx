import { useState } from "react";
import { MAX_RANGE_TIER, canRaidRoute, raidStrength, type PlayerView, type RangeTier, type Ship } from "@engine";
import { store, useApp } from "../match/store";
import { convoyName, corpColor, formatCr, HULL_FLAVOR, hullArtSlot, hullEpithet, hullName, privateerBandName, resourceLabels, sizeBucket } from "../match/format";
import { shipBuildPreview } from "../match/orderCost";
import { Panel, PanelTitle, Badge, Segmented, EmptyState } from "../ui/primitives";
import { ArtSlot } from "../theme/ArtSlot";
import { ResourceIcon } from "../theme/art";
import { Icon } from "../ui/icons";

const TIERS = Array.from({ length: MAX_RANGE_TIER }, (_, i) => (i + 1) as RangeTier);
const RAID_LIST_MAX = 8;

/** Combat strength for display — raid losses leave fractional values. */
const cbt = (n: number) => Math.round(n * 10) / 10;

/** Turns until an in-transit ship reaches its destination (current segment + remaining lanes). */
function transitEta(view: PlayerView, ship: Ship): number {
  const tr = ship.transit;
  if (!tr) return 0;
  let eta = tr.segmentTurnsLeft;
  for (let i = tr.position + 1; i < tr.path.length - 1; i++) {
    eta += tr.segmentTimes?.[i] ?? view.galaxy.routes.get(tr.routeIds[i] ?? "")?.transitTime ?? 1;
  }
  return eta;
}

function ShipRow({ ship, sub, right, t }: { ship: Ship; sub: string; right?: React.ReactNode; t: PlayerView["config"]["tuning"] }) {
  const tier = ship.rangeTier;
  return (
    <div className="roster__row">
      <Icon name={ship.surveyor ? "radar" : ship.raider ? "skull" : "shield"} size={15} />
      <span title={ship.surveyor ? "Unarmed survey vessel — the charter's eyes on the frontier." : HULL_FLAVOR[tier].line}>
        {ship.surveyor ? "Survey vessel" : `${hullName(tier)} “${hullEpithet(tier)}”`}
      </span>
      <span className="roster__sub">{sub}</span>
      {/* Range (jump reach), speed (a faster hull crosses lanes/open space in fewer turns), and
          sensor radius are all set by the hull tier — surfaced here and in the build dropdown. */}
      <span
        className="roster__stats"
        title={`Jump range ${t.maxOffLaneJumpDist[tier]} · speed ×${t.shipSpeed[tier].toFixed(2)} · sensor range ${t.shipSensorRange[tier]}`}
      >
        spd ×{t.shipSpeed[tier].toFixed(2)} · sns {t.shipSensorRange[tier]}
      </span>
      <Badge tone="info">jump {t.maxOffLaneJumpDist[tier]}</Badge>
      {right}
    </div>
  );
}

/** Dispatch an idle survey vessel straight from the roster (Section 25): pick a reachable, unscouted
 *  system and send the scout to reveal its deposits — the same `surveySystem` order the Map Inspector
 *  stages, surfaced here so all ship management lives on one tab. */
function SurveyDispatch({ view, ship }: { view: PlayerView; ship: Ship }) {
  const me = view.me;
  const [target, setTarget] = useState("");
  const staged = store.state.staged.some(
    (s) => s.order.kind === "surveySystem" && s.order.fromSystemId === ship.stationedAt,
  );
  if (staged) return <Badge tone="accent">dispatched</Badge>;
  // Candidates: systems you neither own nor have scouted, reachable on charted lanes within this
  // hull's range (the same reachability test the Inspector uses).
  const candidates = view.galaxy
    .allSystems()
    .filter(
      (sys) =>
        sys.id !== view.galaxy.hubId &&
        !me.ownedSystemIds.includes(sys.id) &&
        !me.surveyedSystemIds.includes(sys.id) &&
        (view.galaxy.shortestWarpPath(ship.stationedAt, sys.id, ship.rangeTier)?.routes.length ?? 0) > 0,
    )
    .sort((a, b) => a.name.localeCompare(b.name));
  if (candidates.length === 0) return <span className="roster__sub">no targets in range</span>;
  return (
    <span className="survey-dispatch">
      <select value={target} onChange={(e) => setTarget(e.target.value)} title="Choose a system to scout">
        <option value="">Survey…</option>
        {candidates.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      <button
        type="button"
        className="mini-btn"
        disabled={!target}
        title="Send this survey vessel to reveal the system's deposits"
        onClick={() => { store.stage({ kind: "surveySystem", fromSystemId: ship.stationedAt, targetSystemId: target }); setTarget(""); }}
      >
        <Icon name="radar" size={12} /> Go
      </button>
    </span>
  );
}

export function Ships() {
  const { view, humanCorpId, contacts } = useApp();
  if (!view) return null;
  const t = view.config.tuning;
  const me = view.me;
  const mySystems = me.ownedSystemIds.map((id) => view.galaxy.system(id));
  const [buildTier, setBuildTier] = useState<RangeTier>(1);
  const [buildType, setBuildType] = useState<"escort" | "raider" | "survey">("escort");
  const raider = buildType === "raider";
  const isSurvey = buildType === "survey";
  const [baseId, setBaseId] = useState(mySystems[0]?.id ?? "");

  const rivalConvoys = view.convoys.filter((c) => c.owner !== humanCorpId);

  // Roster grouped by station (the per-system combat total is the defense the engine uses).
  const stationed = new Map<string, Ship[]>();
  const transiting: Ship[] = [];
  for (const s of me.ships) {
    if (s.transit) transiting.push(s);
    else {
      const group = stationed.get(s.stationedAt);
      if (group) group.push(s);
      else stationed.set(s.stationedAt, [s]);
    }
  }
  // `stationedAt` can be "" (e.g. a ship whose station was lost) — look up defensively.
  const systemName = (id: string) => view.galaxy.systems.get(id)?.name;
  const stationGroups = [...stationed.entries()].sort((a, b) =>
    (systemName(a[0]) ?? "~").localeCompare(systemName(b[0]) ?? "~"),
  );

  const build = shipBuildPreview(view, buildTier, raider); // warship bill (ignored when building a survey ship)
  const total = isSurvey ? t.surveyShipCost : build.total;
  const afford = me.credits >= total;

  return (
    <div className="fleet">
      {/* Fleet roster — the lead panel: what you have and where it is. */}
      <Panel className="fleet__roster">
        <PanelTitle icon="fleet" eyebrow="Order of Battle" title="Your Ships" right={<Badge tone="accent">Raid str {cbt(raidStrength(me))}</Badge>} />
        <div className="roster">
          {me.ships.length === 0 && me.privateers.length === 0 ? (
            <EmptyState icon="ship">No ships built. The shipyard hardens lanes and enables raiding.</EmptyState>
          ) : (
            <>
              {stationGroups.map(([sysId, ships]) => {
                const stationName = systemName(sysId);
                const defense = ships.reduce((sum, s) => sum + s.combat, 0);
                const movable = stationName !== undefined && ships.some((s) => s.combat > 0);
                return (
                  <div key={sysId || "unstationed"} className="roster__group">
                    <div className="roster__group-head">
                      <strong>{stationName ?? "Unstationed"}</strong>
                      <Badge tone="accent">def {cbt(defense)}</Badge>
                      {stationName !== undefined && (
                        <span className="roster__group-actions">
                          <button
                            type="button"
                            className="mini-btn"
                            title="View this system on the map"
                            onClick={() => { store.setNav("map"); store.select({ kind: "system", id: sysId }); }}
                          >
                            <Icon name="map" size={12} /> Map
                          </button>
                          {movable && (
                            <button
                              type="button"
                              className="mini-btn"
                              title="Move this fleet — then pick a destination system on the map"
                              onClick={() => { store.setNav("map"); store.select({ kind: "fleet", id: sysId }); }}
                            >
                              <Icon name="send" size={12} /> Move
                            </button>
                          )}
                        </span>
                      )}
                    </div>
                    {ships.map((s, i) => (
                      <ShipRow
                        key={i}
                        ship={s}
                        t={t}
                        sub={s.surveyor ? "unarmed scout" : s.raider ? "raider" : "escort"}
                        right={s.surveyor ? <SurveyDispatch view={view} ship={s} /> : <Badge tone="neutral">cbt {cbt(s.combat)}</Badge>}
                      />
                    ))}
                  </div>
                );
              })}
              {transiting.length > 0 && (
                <div className="roster__group">
                  <div className="roster__group-head">
                    <strong>In transit</strong>
                    <Badge tone="warn">{transiting.length}</Badge>
                  </div>
                  {transiting.map((s, i) => {
                    const tr = s.transit!;
                    const dest = systemName(tr.path[tr.path.length - 1] ?? "") ?? "unknown";
                    return (
                      <ShipRow
                        key={i}
                        ship={s}
                        t={t}
                        sub={`→ ${dest}${tr.attack ? " (assault)" : ""}`}
                        right={<Badge tone="warn">ETA {transitEta(view, s)}t</Badge>}
                      />
                    );
                  })}
                </div>
              )}
              {me.privateers.length > 0 && (
                <div className="roster__group">
                  <div className="roster__group-head">
                    <strong>Privateer contracts</strong>
                    <Badge tone="warn">{me.privateers.length}</Badge>
                  </div>
                  {me.privateers.map((p, i) => (
                    <div key={`p${i}`} className="roster__row">
                      <Icon name="skull" size={15} />
                      <span>{privateerBandName(p.basedAt)}</span>
                      <span className="roster__sub">out of {systemName(p.basedAt) ?? "unknown"}</span>
                      <Badge tone="warn">{p.turnsLeft}t left</Badge>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </Panel>

      {/* Sensor contacts — rival fleets your ships are detecting (Section 04). Position + heading +
          a rough force band only; never exact composition. */}
      <Panel className="fleet__contacts">
        <PanelTitle icon="radar" eyebrow="Sensors" title="Detected Contacts" right={contacts.length > 0 ? <Badge tone="warn">{contacts.length}</Badge> : undefined} />
        {contacts.length === 0 ? (
          <EmptyState icon="radar">No rival fleets in sensor range. Station or move ships to picket your space — each hull detects nearby enemy fleets.</EmptyState>
        ) : (
          <div className="raid-list">
            {contacts.map((c, i) => {
              const owner = view.corporations.find((x) => x.id === c.owner);
              const inbound = me.ownedSystemIds.includes(c.headingSystemId);
              const forceTone = c.forceEstimate === "heavy" ? "negative" : c.forceEstimate === "medium" ? "warn" : "neutral";
              return (
                <div key={i} className="raid-row">
                  <span className="raid-row__dot" style={{ background: corpColor(c.owner) }} />
                  <div className="raid-row__info">
                    <strong>{owner?.name ?? "Unknown"} fleet</strong>
                    <span>{systemName(c.fromSystemId) ?? "?"} → {systemName(c.headingSystemId) ?? "unknown"}{c.offLane ? " · off-lane" : ""}</span>
                  </div>
                  <Badge tone={forceTone}>{c.forceEstimate}</Badge>
                  {inbound && <Badge tone="negative">inbound</Badge>}
                </div>
              );
            })}
            <p className="hint">Force is a rough sensor estimate, not an exact count.</p>
          </div>
        )}
      </Panel>

      {/* Build yard */}
      <Panel className="fleet__yard">
        <PanelTitle icon="ship" eyebrow="Shipyard" title="Order New Ship" />
        {mySystems.length === 0 ? (
          <p className="hint">Claim a system to base a fleet.</p>
        ) : (
          <>
            <ArtSlot slot={isSurvey ? "ship-survey" : hullArtSlot(buildTier, raider)} className="fleet__shipart" />
            <Segmented
              value={buildType}
              onChange={(v) => setBuildType(v as "escort" | "raider" | "survey")}
              options={[{ value: "escort", label: "Escort" }, { value: "raider", label: "Raider" }, { value: "survey", label: "Survey" }]}
            />
            {isSurvey ? (
              <p className="hint">Unarmed scout — flies charted lanes to a target system and reveals its deposits (richness + reserves), then returns home. Once built, dispatch it from the roster above (or click a system on the Map).</p>
            ) : (
              <label className="field">
                <span>Hull class</span>
                <select value={buildTier} onChange={(e) => setBuildTier(Number(e.target.value) as RangeTier)}>
                  {TIERS.map((tier) => {
                    const locked = tier > me.rangeTier;
                    return (
                      <option key={tier} value={tier} disabled={locked}>
                        {hullName(tier)} “{hullEpithet(tier)}” · jump {t.maxOffLaneJumpDist[tier]} · cbt {t.shipCombat[tier] + (raider ? t.raiderCombatBonus : 0)} · spd ×{t.shipSpeed[tier].toFixed(2)} · sensor {t.shipSensorRange[tier]}{locked ? " — locked: research Warp Drive" : ""}
                      </option>
                    );
                  })}
                </select>
              </label>
            )}
            <label className="field">
              <span>Base at</span>
              <select value={baseId} onChange={(e) => setBaseId(e.target.value)}>
                {mySystems.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            {/* Bill of materials (Section 07b): each chip is one strategic input — icon,
                units needed, and stock state. Green check = on hand; amber = short. */}
            {!isSurvey && build.mats.length > 0 && (
              <div className="matbill">
                {build.mats.map((m) => {
                  const short = m.have < m.need;
                  const missing = Math.ceil(m.need - m.have);
                  return (
                    <div
                      key={m.resource}
                      className={`matchip ${short ? "matchip--short" : "matchip--ok"}`}
                      title={`${resourceLabels[m.resource]} — need ${m.need}, in stock ${Math.floor(m.have)}${short ? ` · short ${missing}, ~${formatCr(Math.round(m.bill))} to import` : ""}`}
                    >
                      <ResourceIcon resource={m.resource} size={22} />
                      <strong>×{m.need}</strong>
                      <span className="matchip__state">{short ? `have ${Math.floor(m.have)}` : "✓"}</span>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="preview">
              {!isSurvey && <div className="preview__row"><span>Hull</span><strong>{formatCr(build.hullCost)}</strong></div>}
              <div className="preview__row"><span>Total</span><strong>{formatCr(total)}</strong></div>
              <div className="preview__row"><span>Role</span><strong>{isSurvey ? "Survey / sensors" : raider ? "Interdiction" : "Escort / defense"}</strong></div>
            </div>
            {!afford && (
              <p className="hint hint--warn"><Icon name="alert" size={13} /> Needs {formatCr(total)} — treasury holds {formatCr(Math.floor(me.credits))}.</p>
            )}
            {!isSurvey && build.short && (
              <p className="hint hint--warn"><Icon name="alert" size={13} /> Materials short — the yard won't lay the hull until they're in stock (no auto-buy). Import them on the Exchange.</p>
            )}
            <button type="button" className="primary-btn" disabled={!baseId || !afford || (!isSurvey && build.short)} onClick={() => isSurvey ? store.stage({ kind: "buildSurveyShip", systemId: baseId }) : store.stage({ kind: "buildShip", rangeTier: buildTier, raider, systemId: baseId })}>
              <Icon name="plus" size={15} /> Add to Build Queue
            </button>
            <button type="button" className="ghost-btn" disabled={!baseId} onClick={() => store.stage({ kind: "hirePrivateer", basedAt: baseId })}>
              <Icon name="skull" size={14} /> Hire privateer · {formatCr(t.privateerCost)}
            </button>
          </>
        )}
      </Panel>

      {/* Raid planner */}
      <Panel className="fleet__raids">
        <PanelTitle icon="crosshair" eyebrow="Interdiction" title="Raid Targets" />
        {rivalConvoys.length === 0 ? (
          <EmptyState icon="crosshair">No visible rival convoys. Interdict lanes from the Map to trap next-tick traffic.</EmptyState>
        ) : (
          <div className="raid-list">
            {rivalConvoys.slice(0, RAID_LIST_MAX).map((c) => {
              const route = view.galaxy.routes.get(c.routeIds[c.position] ?? "");
              const eligible = route ? canRaidRoute(view.galaxy, me, route) : false;
              const targetable = c.routeIds.length >= 2 && c.launchedTurn < view.turn;
              const owner = view.corporations.find((x) => x.id === c.owner);
              return (
                <div key={c.id} className="raid-row">
                  <span className="raid-row__dot" style={{ background: corpColor(c.owner) }} />
                  <div className="raid-row__info">
                    <strong>{convoyName(c.id)} · {sizeBucket(c.value)}</strong>
                    <span>{owner?.name}</span>
                  </div>
                  {targetable ? (
                    <button
                      type="button"
                      className="mini-btn mini-btn--danger"
                      disabled={!eligible}
                      title={eligible ? "Raid this convoy in transit" : "No raiders in range"}
                      onClick={() => store.stage({ kind: "targetConvoy", convoyId: c.id })}
                    >
                      <Icon name="crosshair" size={13} /> Target
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="mini-btn mini-btn--danger"
                      disabled={!eligible || !route}
                      title={eligible ? "Short run — trap its warp lane instead; interdiction strikes before arrival" : "No raiders in range of its lane"}
                      onClick={() => route && store.stage({ kind: "interdict", routeId: route.id })}
                    >
                      <Icon name="bolt" size={13} /> Trap lane
                    </button>
                  )}
                </div>
              );
            })}
            {rivalConvoys.length > RAID_LIST_MAX && (
              <p className="hint">+{rivalConvoys.length - RAID_LIST_MAX} more rival convoys in transit.</p>
            )}
            <p className="hint">1-turn runs can't be chased — trap the lane and the ambush resolves before the convoy arrives.</p>
          </div>
        )}
      </Panel>
    </div>
  );
}
