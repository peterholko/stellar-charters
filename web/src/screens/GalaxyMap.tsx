import { store, useApp } from "../match/store";
import { SystemMap } from "../components/SystemMap";

export function GalaxyMap() {
  const { view, selection, humanCorpId } = useApp();
  if (!view) return null;
  return (
    <div className="mapscreen">
      <div className="mapscreen__head">
        <div>
          <p className="eyebrow">Charted Frontier</p>
          <h2>Galaxy Map</h2>
        </div>
        <div className="mapscreen__legend">
          <span><i className="lg lg--mine" /> You</span>
          <span><i className="lg lg--rival" /> Rival</span>
          <span><i className="lg lg--open" /> Open</span>
          <span><i className="lg lg--route-high" /> High exposure</span>
          <span><i className="lg lg--route-uncharted" /> Uncharted</span>
        </div>
      </div>
      <div className="mapscreen__canvas">
        <SystemMap view={view} humanCorpId={humanCorpId} selection={selection} onSelect={(s) => store.select(s)} />
      </div>
      <p className="mapscreen__hint">Click a system, warp lane, or convoy to inspect and act. Actions queue in the order tray.</p>
    </div>
  );
}
