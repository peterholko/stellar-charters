import { useState } from "react";
import { store, useApp } from "../match/store";
import { buildCombatLog, tallyCombat, type CombatEntry } from "../match/combat";
import { Panel, PanelTitle, Badge, Segmented, EmptyState } from "../ui/primitives";
import { Icon, type IconName } from "../ui/icons";

const LOG_PAGE = 60;

const kindIcon: Record<CombatEntry["kind"], IconName> = {
  raid: "skull",
  sabotage: "bolt",
  invasion: "crosshair",
  war: "alert",
  pact: "shield",
};

export function Combat() {
  const { view, humanCorpId, reports } = useApp();
  const [scope, setScope] = useState<"all" | "mine">("all");
  const [shown, setShown] = useState(LOG_PAGE);
  if (!view) return null;

  const corpName = (id: string) => view.corporations.find((c) => c.id === id)?.name ?? id;
  const log = buildCombatLog(reports, view, humanCorpId);
  const filtered = scope === "mine" ? log.filter((l) => l.involvesMe) : log;
  const tally = tallyCombat(reports, humanCorpId);
  const wars = view.wars.filter((w) => w.endTurn > view.turn);

  return (
    <div className="combat">
      {/* Galaxy-wide combat log */}
      <Panel className="combat__log">
        <PanelTitle
          icon="crosshair"
          eyebrow="Theater Report"
          title="Combat Log"
          right={<Badge tone="accent">{filtered.length} engagement{filtered.length === 1 ? "" : "s"}</Badge>}
        />
        <Segmented
          value={scope}
          onChange={(v) => { setScope(v); setShown(LOG_PAGE); }}
          options={[{ value: "all", label: "All galaxy" }, { value: "mine", label: "Involving you" }]}
        />
        {filtered.length === 0 ? (
          <EmptyState icon="shield">
            {scope === "mine"
              ? "No engagements involving your charter yet. Raids, sabotage, and invasions you take part in land here."
              : "The frontier is quiet — no raids, sabotage, or invasions reported anywhere yet."}
          </EmptyState>
        ) : (
          <div className="digest combat__feed">
            {filtered.slice(0, shown).map((l, i) => (
              <div key={i} className={`digest__row digest__row--${l.tone}`}>
                <span className="combat__turn">T{l.turn}</span>
                <Icon name={kindIcon[l.kind]} size={15} />
                <div>
                  <strong>{l.title}</strong>
                  <span>{l.body}</span>
                </div>
                {l.link && (
                  <button
                    type="button"
                    className="mini-btn"
                    onClick={() => { store.select(l.link!.kind === "route" ? { kind: "route", id: l.link!.id } : { kind: "system", id: l.link!.id }); store.setNav("map"); }}
                  >
                    Map
                  </button>
                )}
              </div>
            ))}
            {filtered.length > shown && (
              <button type="button" className="ghost-btn" onClick={() => setShown(shown + LOG_PAGE)}>
                Show {Math.min(LOG_PAGE, filtered.length - shown)} more · {filtered.length - shown} older engagement{filtered.length - shown === 1 ? "" : "s"}
              </button>
            )}
          </div>
        )}
      </Panel>

      <div className="combat__side">
        {/* Active wars */}
        <Panel>
          <PanelTitle icon="alert" eyebrow="Open Conflicts" title="Active Wars" right={wars.length > 0 ? <Badge tone="warn">{wars.length}</Badge> : undefined} />
          {wars.length === 0 ? (
            <p className="hint">No declared wars. Aggression short of invasion — raids, sabotage — stays below this line.</p>
          ) : (
            <div className="digest">
              {wars.map((w, i) => (
                <div key={i} className="digest__row digest__row--warn">
                  <Icon name="alert" size={15} />
                  <div>
                    <strong>{corpName(w.aggressorId)} → {corpName(w.defenderId)}</strong>
                    <span>
                      Declared T{w.startTurn} · ceasefire T{w.endTurn} unless aggression continues
                      {(w.aggressorId === humanCorpId || w.defenderId === humanCorpId) && " · you are a belligerent"}.
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        {/* Campaign tally */}
        <Panel>
          <PanelTitle icon="shield" eyebrow="This Match" title="Campaign Tally" />
          <div className="preview">
            <div className="preview__row"><span>Raids on your convoys</span><strong>{tally.raidsOnMe}</strong></div>
            <div className="preview__row"><span>Cargo lost to raids</span><strong>{Math.round(tally.cargoLostToRaids)} u</strong></div>
            <div className="preview__row"><span>Raids by your forces</span><strong>{tally.raidsByMe}</strong></div>
            <div className="preview__row"><span>Cargo plundered</span><strong>{Math.round(tally.cargoPlunderedByMe)} u</strong></div>
            <div className="preview__row"><span>Invasions (galaxy)</span><strong>{tally.invasions}</strong></div>
            <div className="preview__row"><span>Systems taken by force</span><strong>{tally.systemsCaptured}</strong></div>
          </div>
          <p className="hint">
            Combat results are public news across the galaxy. Attribution is not: a privateer
            strike only leaves an evidence trail — "suspected sponsor" is intel, not proof.
          </p>
        </Panel>
      </div>
    </div>
  );
}
