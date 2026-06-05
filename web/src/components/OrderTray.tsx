import type { ClientPlayer, PlayerView } from "@engine";
import { store, type StagedOrder } from "../match/store";
import { describeOrder } from "../match/orderCost";
import { formatCr } from "../match/format";
import { Icon } from "../ui/icons";
import { EmptyState } from "../ui/primitives";

export function OrderTray({
  view,
  staged,
  resolving,
  turn,
  totalTurns,
  submitted,
  players,
  submittedCount,
}: {
  view: PlayerView;
  staged: StagedOrder[];
  resolving: boolean;
  turn: number;
  totalTurns: number;
  submitted: boolean;
  players: ClientPlayer[];
  submittedCount: number;
}) {
  // Already submitted this turn → show a non-blocking "waiting for players" panel so the
  // rest of the console stays fully usable for reviewing your charter.
  if (submitted) {
    const remaining = players.length - submittedCount;
    return (
      <section className="tray">
        <header className="tray__head">
          <div>
            <p className="eyebrow">Turn {Math.min(turn + 1, totalTurns)}</p>
            <h2>Orders Locked In</h2>
          </div>
          <span className="tray__count">{submittedCount}/{players.length}</span>
        </header>
        <div className="tray__waiting">
          <span className="tray__waiting-mark"><Icon name="check" size={20} /></span>
          <p className="tray__waiting-title">Orders submitted</p>
          <p className="tray__waiting-sub">
            {remaining > 0
              ? `Waiting for ${remaining} more ${remaining === 1 ? "player" : "players"}. Review your charter while the turn processes.`
              : "Resolving the turn…"}
          </p>
          <div className="waiting-list">
            {players.map((p) => (
              <span key={p.corpId} className={p.submitted ? "is-in" : ""}>
                <Icon name={p.submitted ? "check" : "clock"} size={12} /> {p.name}{p.isYou ? " (you)" : ""}
              </span>
            ))}
          </div>
        </div>
      </section>
    );
  }

  const infos = staged.map((s) => ({ s, info: describeOrder(s.order, view) }));
  const totalCost = infos.reduce((sum, { info }) => sum + info.cost, 0);
  const remaining = view.me.credits - totalCost;
  const over = totalCost > view.me.credits;

  return (
    <section className="tray">
      <header className="tray__head">
        <div>
          <p className="eyebrow">Turn Orders</p>
          <h2>Order Queue</h2>
        </div>
        <span className="tray__count">{staged.length}</span>
      </header>

      <div className="tray__list">
        {staged.length === 0 ? (
          <EmptyState icon="report">No orders staged. Act from the map, systems, exchange, or fleet.</EmptyState>
        ) : (
          infos.map(({ s, info }) => (
            <article key={s.id} className={`order order--${info.tone}`}>
              <span className="order__bar" />
              <div className="order__body">
                <div className="order__top">
                  <h3>{info.label}</h3>
                  {info.cost !== 0 && (
                    <span className={`order__cost ${info.cost < 0 ? "is-gain" : ""}`}>
                      {info.cost < 0 ? "+" : ""}
                      {formatCr(Math.abs(info.cost))}
                    </span>
                  )}
                </div>
                <p>{info.detail}</p>
                {info.warn && (
                  <span className="order__warn">
                    <Icon name="alert" size={12} /> {info.warn}
                  </span>
                )}
              </div>
              <button type="button" className="order__remove" onClick={() => store.unstage(s.id)} title="Remove">
                <Icon name="x" size={14} />
              </button>
            </article>
          ))
        )}
      </div>

      <div className="tray__foot">
        <div className="tray__totals">
          <span>Commitment</span>
          <strong className={over ? "is-over" : ""}>{formatCr(totalCost)}</strong>
        </div>
        <div className="tray__totals tray__totals--sub">
          <span>After resolve</span>
          <strong className={remaining < 0 ? "is-over" : ""}>{formatCr(remaining)}</strong>
        </div>
        {over && <p className="tray__overmsg">Total exceeds credits — some orders may not fill.</p>}
        <button
          type="button"
          className="tray__submit"
          disabled={resolving || turn >= totalTurns}
          onClick={() => store.submit()}
        >
          <Icon name="send" size={16} />
          {resolving ? "Submitting…" : "Submit Turn"}
        </button>
      </div>
    </section>
  );
}
