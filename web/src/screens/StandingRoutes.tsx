import { useApp, store } from "../match/store";
import { resourceLabels } from "../match/format";
import { Panel, PanelTitle, Badge, ActionButton } from "../ui/primitives";

/**
 * Standing trade routes (export automation). While enabled, a route auto-launches one sell convoy to
 * the Hub each turn it has stock — no per-turn order, so turns 2-5 sustain themselves. Create/toggle/
 * remove are staged and submit with the turn.
 */
export function StandingRoutes() {
  const { standingRoutes, standingRouteSuggestion, view } = useApp();
  if (!view) return null;
  const sysName = (id: string) => view.galaxy.systems.get(id)?.name ?? id;

  return (
    <Panel className="sroutes">
      <PanelTitle icon="convoys" eyebrow="Automation" title="Standing Trade Routes" />
      <p className="hint">While enabled, each route ships one sell convoy to the Exchange every turn it has stock above its reserve — no per-turn order. Changes apply when you submit the turn.</p>
      {standingRoutes.length === 0 && !standingRouteSuggestion && <span className="hint">No routes yet — a suggestion appears once a home builds up tradable stock.</span>}
      {standingRoutes.map((r) => (
        <div key={r.id} className="sroute">
          <div className="sroute__main">
            <strong>{sysName(r.originSystemId)} → Hub</strong>
            <span>{resourceLabels[r.resource]} · batch {r.batch} · keep {r.reserve}</span>
          </div>
          <div className="sroute__ctrl">
            {r.enabled
              ? <Badge tone={r.readyToLaunch ? "positive" : "neutral"}>{r.readyToLaunch ? "launching" : "enabled"}</Badge>
              : <Badge tone="warn">paused</Badge>}
            <button type="button" className="mini-btn" onClick={() => store.setStandingRouteEnabled(r.id, !r.enabled)}>{r.enabled ? "Pause" : "Enable"}</button>
            <button type="button" className="mini-btn" onClick={() => store.removeStandingRoute(r.id)}>Remove</button>
          </div>
        </div>
      ))}
      {standingRouteSuggestion && (
        <div className="sroute sroute--suggest">
          <div className="sroute__main">
            <strong>Suggested: {sysName(standingRouteSuggestion.originSystemId)} → Hub</strong>
            <span>{resourceLabels[standingRouteSuggestion.resource]} · batch {standingRouteSuggestion.batch} · keep {standingRouteSuggestion.reserve}</span>
          </div>
          <ActionButton icon="convoys" variant="primary"
            onClick={() => store.createStandingRoute(standingRouteSuggestion.originSystemId, standingRouteSuggestion.resource, standingRouteSuggestion.batch, standingRouteSuggestion.reserve, true)}>
            Approve &amp; enable
          </ActionButton>
        </div>
      )}
    </Panel>
  );
}
