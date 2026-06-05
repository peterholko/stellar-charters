import type { PlayerView } from "@engine";
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
}: {
  view: PlayerView;
  staged: StagedOrder[];
  resolving: boolean;
  turn: number;
  totalTurns: number;
}) {
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
          {resolving ? "Resolving…" : "Submit & Resolve Turn"}
        </button>
      </div>
    </section>
  );
}
