import { useApp } from "../match/store";
import { buildAdvice } from "../match/advice";
import { Panel, PanelTitle } from "../ui/primitives";
import { Icon } from "../ui/icons";

/** "What to do now" — a few concrete, one-click next actions for the player's credits, resources,
 *  convoys, and ships. Shown on the Command dashboard and (compact) on the map. */
export function Advisor({ compact }: { compact?: boolean }) {
  const state = useApp();
  if (!state.view) return null;
  const advice = buildAdvice(state.view, state);
  if (advice.length === 0) return null;
  return (
    <Panel className={`advisor${compact ? " advisor--compact" : ""}`}>
      <PanelTitle icon="info" eyebrow="Advisor" title="What to do now" />
      <div className="advisor__list">
        {advice.map((a) => (
          <div key={a.id} className={`advisor__item advisor__item--${a.tone}`}>
            <Icon name={a.icon} size={17} />
            <div className="advisor__text">
              <strong>{a.title}</strong>
              <p>{a.body}</p>
            </div>
            {a.action && (
              <button type="button" className="mini-btn advisor__go" onClick={a.action.run}>{a.action.label}</button>
            )}
          </div>
        ))}
      </div>
    </Panel>
  );
}
