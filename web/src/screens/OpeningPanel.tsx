import { useApp, store } from "../match/store";
import { resourceLabels } from "../match/format";
import { Panel, PanelTitle, Badge, ActionButton } from "../ui/primitives";

/**
 * Turn-1 opening commands (Section 05): two free Authority probes and an optional named maiden voyage
 * from the home's startup stockpile. Shown only during the opening window (driven by `openingState`).
 * Both stage normal orders that submit with the turn.
 */
export function OpeningPanel() {
  const state = useApp();
  const { openingState, view, listedResources } = state;
  if (!openingState || !view) return null;

  const sysName = (id: string) => view.galaxy.systems.get(id)?.name ?? id;
  const home = view.galaxy.systems.get(openingState.homeSystemId);
  const stagedSurveys = store.stagedOpeningSurveys();
  const remaining = openingState.surveysRemaining - stagedSurveys.length;
  const fx = store.firstExport;
  const stock = home?.stockpile ?? null;
  const tradable = listedResources.filter((r) => Math.floor(stock?.[r] ?? 0) > 0);
  const submitted = state.players.find((p) => p.isYou)?.submitted ?? false;

  return (
    <Panel className="opening">
      <PanelTitle icon="gavel" eyebrow="Section 05 · Turn 1 Opening" title={`Open your charter — ${home?.name ?? ""}`} />
      <p className="hint">Two free Authority probes and an optional first shipment from your startup stockpile. Both submit with your turn.</p>

      <div className="opening__block">
        <h4>Free Authority probes <Badge tone="accent">{Math.max(0, remaining)} left</Badge></h4>
        <div className="opening__chips">
          {openingState.eligibleSurveyTargets.length === 0 && <span className="hint">No nearby unowned systems in range.</span>}
          {openingState.eligibleSurveyTargets.slice(0, 30).map((id) => {
            const on = stagedSurveys.includes(id);
            return (
              <button key={id} type="button" className={`chip${on ? " is-on" : ""}`}
                disabled={submitted || (!on && remaining <= 0)} onClick={() => store.toggleOpeningSurvey(id)}>
                {sysName(id)}
              </button>
            );
          })}
        </div>
      </div>

      <div className="opening__block">
        <h4>Maiden voyage <span className="hint">— ship startup stock to the Exchange</span></h4>
        {tradable.length === 0 ? (
          <span className="hint">No tradable startup stock.</span>
        ) : (
          <div className="opening__chips">
            {tradable.map((r) => {
              const have = Math.floor(stock?.[r] ?? 0);
              const on = fx?.resource === r;
              return (
                <button key={r} type="button" className={`chip${on ? " is-on" : ""}`}
                  disabled={submitted} onClick={() => store.setFirstExport(r, on ? 0 : have)}>
                  {resourceLabels[r]} · {have}
                </button>
              );
            })}
          </div>
        )}
        {fx && <p className="hint">Staged: <strong>First Shipment</strong> — {fx.quantity} {resourceLabels[fx.resource]} → Wormhole Hub.</p>}
      </div>

      <div className="action-row">
        <ActionButton icon="send" variant="primary" disabled={submitted} onClick={() => store.setNav("turn")}>
          {submitted ? "Submitted — waiting for rivals" : "Review & submit turn"}
        </ActionButton>
      </div>
    </Panel>
  );
}
