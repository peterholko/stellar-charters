import { useState } from "react";
import { store, useApp } from "../match/store";
import { PixiGalaxyMap, type OverlayMode } from "../components/PixiGalaxyMap";
import { Icon } from "../ui/icons";

const OVERLAYS: { id: OverlayMode; label: string }[] = [
  { id: "none", label: "Plain" },
  { id: "territory", label: "Territory" },
  { id: "resource", label: "Resources" },
  { id: "threat", label: "Threats" },
];

export function GalaxyMap() {
  const { view, selection, humanCorpId, movementLog, contacts, replayNonce } = useApp();
  const [raidOverlay, setRaidOverlay] = useState(false);
  const [overlay, setOverlay] = useState<OverlayMode>("none");
  if (!view) return null;
  const canReplay = movementLog.length > 0;
  return (
    <div className="mapscreen">
      <div className="mapscreen__head">
        <div>
          <p className="eyebrow">Charted Frontier</p>
          <h2>Galaxy Map</h2>
        </div>
        <button
          type="button"
          className="ghost-btn mapscreen__replay"
          disabled={!canReplay}
          title={canReplay ? "Replay last turn's freighter and fleet movements" : "Nothing moved last turn — convoys and fleets appear here once they travel a leg"}
          onClick={() => store.requestReplay()}
        >
          ▶ Last turn movements{canReplay ? ` (${movementLog.length})` : ""}
        </button>
        <button
          type="button"
          className={`ghost-btn mapscreen__replay${raidOverlay ? " is-on" : ""}`}
          title="Highlight warp lanes your raiders and privateers can interdict right now — a raid needs a raider force based at (or one hop from) a lane's non-hub endpoint"
          onClick={() => setRaidOverlay((v) => !v)}
        >
          <Icon name="crosshair" size={13} /> Raid reach
        </button>
        <div className="mapscreen__overlays" role="group" aria-label="Map overlay">
          {OVERLAYS.map((o) => (
            <button
              key={o.id}
              type="button"
              className={`mini-btn${overlay === o.id ? " is-on" : ""}`}
              title={
                o.id === "none" ? "No strategic overlay"
                : o.id === "territory" ? "Shade the map by who controls each system"
                : o.id === "resource" ? "Tint each system by its dominant resource"
                : "Highlight systems your sensors show rival fleets advancing on"
              }
              onClick={() => setOverlay(o.id)}
            >
              {o.label}
            </button>
          ))}
        </div>
        <div className="mapscreen__legend">
          <span><i className="lg lg--mine" /> You</span>
          <span><i className="lg lg--rival" /> Rival</span>
          <span><i className="lg lg--open" /> Open</span>
          {raidOverlay ? (
            <span><i className="lg lg--raid" /> In raid reach</span>
          ) : (
            <>
              <span><i className="lg lg--route-high" /> High exposure</span>
              <span><i className="lg lg--route-uncharted" /> Uncharted</span>
            </>
          )}
        </div>
      </div>
      {(selection?.kind === "fleet" || selection?.kind === "survey") && (
        <div className="mapscreen__movebar">
          <span>
            <Icon name={selection.kind === "survey" ? "radar" : "send"} size={14} />{" "}
            {selection.kind === "survey"
              ? "Survey vessel selected — tap a system to scout it."
              : "Moving fleet — tap a destination system to send it there."}
          </span>
          <button type="button" className="mini-btn" onClick={() => store.select(null)}>Cancel</button>
        </div>
      )}
      <div className="mapscreen__canvas">
        <PixiGalaxyMap
          view={view}
          humanCorpId={humanCorpId}
          selection={selection}
          onSelect={(s) => store.select(s)}
          onFleetMove={(from, to) => store.stage({ kind: "moveFleet", fromSystemId: from, toSystemId: to })}
          onSurveyDispatch={(from, to) => store.stage({ kind: "surveySystem", fromSystemId: from, targetSystemId: to })}
          movementLog={movementLog}
          contacts={contacts}
          replaySignal={replayNonce}
          raidOverlay={raidOverlay}
          overlayMode={overlay}
        />
      </div>
      <p className="mapscreen__hint">Scroll to zoom, drag to pan, double-click to focus. Click a system, warp lane, or convoy to inspect — or select one of your fleets (▲) and click a destination to move it.</p>
    </div>
  );
}
