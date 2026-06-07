import { useApp } from "../match/store";
import { OrderTray } from "../components/OrderTray";

/**
 * The Turn screen: a dedicated workspace for everything queued this turn — the order summary,
 * total commitment, and the Submit Turn button. Lifted out of the inspector sidebar so the
 * systems/planet views stay focused on planets.
 */
export function Turn() {
  const { view, staged, resolving, turn, totalTurns, players, submittedCount } = useApp();
  if (!view) return null;
  const iSubmitted = players.find((p) => p.isYou)?.submitted ?? false;
  return (
    <div className="turnscreen">
      <OrderTray
        view={view}
        staged={staged}
        resolving={resolving}
        turn={turn}
        totalTurns={totalTurns}
        submitted={iSubmitted}
        players={players}
        submittedCount={submittedCount}
      />
    </div>
  );
}
