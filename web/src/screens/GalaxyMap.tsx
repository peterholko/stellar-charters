import { useMemo, useState } from "react";
import { store, useApp } from "../match/store";
import { PixiGalaxyMap, type OverlayMode } from "../components/PixiGalaxyMap";
import { SystemSummaryCard } from "../components/SystemSummaryCard";
import { Inspector } from "../components/Inspector";
import { Icon } from "../ui/icons";

const OVERLAYS: { id: OverlayMode; label: string }[] = [
  { id: "none", label: "Plain" },
  { id: "territory", label: "Territory" },
  { id: "resource", label: "Resources" },
  { id: "threat", label: "Threats" },
];

/**
 * Full-bleed galaxy map (desktop redesign): the Pixi canvas fills the entire workspace and every
 * piece of chrome — search/jump, overlays, replay/raid toggles, legend, and the selection panel —
 * floats over it in the corners rather than stacking into rows above it. The map owns its own
 * floating selection panel, so it no longer reserves the shared inspector sidebar column.
 */
export function GalaxyMap() {
  const { view, selection, humanCorpId, movementLog, contacts, replayNonce, staged } = useApp();
  const [raidOverlay, setRaidOverlay] = useState(false);
  const [overlay, setOverlay] = useState<OverlayMode>("none");
  const [query, setQuery] = useState("");
  const [focusTarget, setFocusTarget] = useState<{ ids: string[]; nonce: number } | null>(null);
  // Stable reference unless the staged tray changes, so the map only redraws ghosts on real edits.
  const stagedOrders = useMemo(() => staged.map((s) => s.order), [staged]);
  if (!view) return null;
  const canReplay = movementLog.length > 0;
  const systems = view.galaxy.allSystems();
  const myIds = systems.filter((s) => s.owner === humanCorpId).map((s) => s.id);
  const jumpTo = (ids: string[]) => setFocusTarget((f) => ({ ids, nonce: (f?.nonce ?? 0) + 1 }));
  const runSearch = () => {
    const q = query.trim().toLowerCase();
    if (!q) return;
    const hit =
      systems.find((s) => s.name.toLowerCase() === q) ??
      systems.find((s) => s.name.toLowerCase().includes(q));
    if (hit) {
      store.select({ kind: "system", id: hit.id });
      jumpTo([hit.id]);
    }
  };
  // A fleet/survey selection puts the map in "tap a destination" mode (the move bar), so no panel.
  const moveMode = selection?.kind === "fleet" || selection?.kind === "survey";
  const showPanel = !!selection && !moveMode;

  return (
    <div className="mapscreen mapscreen--bleed">
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
          focusTarget={focusTarget ?? undefined}
          stagedOrders={stagedOrders}
        />
      </div>

      {/* Top-left: search + jump-to controls */}
      <div className="mapctl mapctl--tl">
        <form
          className="mapscreen__search"
          onSubmit={(e) => {
            e.preventDefault();
            runSearch();
          }}
        >
          <Icon name="search" size={13} />
          <input
            type="text"
            list="map-system-names"
            placeholder="Jump to system…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search systems"
          />
          <datalist id="map-system-names">
            {systems.map((s) => (
              <option key={s.id} value={s.name} />
            ))}
          </datalist>
        </form>
        <button
          type="button"
          className="mini-btn"
          disabled={myIds.length === 0}
          title={myIds.length ? "Frame all of your systems" : "You hold no systems yet"}
          onClick={() => jumpTo(myIds)}
        >
          Frame mine
        </button>
        <button type="button" className="mini-btn" title="Fit the whole galaxy" onClick={() => jumpTo([])}>
          Whole galaxy
        </button>
      </div>

      {/* Top-right: overlay modes + compact replay / raid-reach toggles */}
      <div className="mapctl mapctl--tr">
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
        <button
          type="button"
          className="iconbtn"
          disabled={!canReplay}
          title={canReplay ? "Replay last turn's freighter and fleet movements" : "Nothing moved last turn yet"}
          onClick={() => store.requestReplay()}
        >
          <span aria-hidden>▶</span>
          {canReplay && <span className="iconbtn__count">{movementLog.length}</span>}
        </button>
        <button
          type="button"
          className={`iconbtn${raidOverlay ? " is-on" : ""}`}
          title="Highlight warp lanes your raiders and privateers can interdict right now"
          aria-pressed={raidOverlay}
          onClick={() => setRaidOverlay((v) => !v)}
        >
          <Icon name="crosshair" size={14} />
        </button>
      </div>

      {/* Move-mode banner (fleet / survey selected) */}
      {moveMode && (
        <div className="mapscreen__movebar mapscreen__movebar--float">
          <span>
            <Icon name={selection!.kind === "survey" ? "radar" : "send"} size={14} />{" "}
            {selection!.kind === "survey"
              ? "Survey vessel selected — click a system to scout it."
              : "Moving fleet — click a destination system to send it there."}
          </span>
          <button type="button" className="mini-btn" onClick={() => store.select(null)}>Cancel</button>
        </div>
      )}

      {/* Legend chip */}
      <div className="maplegend">
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

      {/* Floating selection panel (the map's own inspector) */}
      {showPanel && (
        <div className="mapscreen__selpanel">
          <button
            type="button"
            className="mapscreen__selclose"
            title="Close"
            aria-label="Close selection"
            onClick={() => store.select(null)}
          >
            ×
          </button>
          {selection!.kind === "system" ? (
            <SystemSummaryCard view={view} humanCorpId={humanCorpId} systemId={selection!.id} />
          ) : (
            <Inspector view={view} humanCorpId={humanCorpId} selection={selection} />
          )}
        </div>
      )}
    </div>
  );
}
