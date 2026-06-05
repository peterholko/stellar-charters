import { useState } from "react";
import { useApp, store } from "../match/store";
import { corpColor, formatCr } from "../match/format";
import { Panel, PanelTitle, Badge, Bar, Stat } from "../ui/primitives";
import { Icon } from "../ui/icons";

export function Finance() {
  const { view, match } = useApp();
  const t = view.config.tuning;
  const me = view.me;
  const [borrow, setBorrow] = useState(1000);
  const [shareQty, setShareQty] = useState<Record<string, number>>({});

  const debtCeiling = Math.max(0, me.valuation * t.maxDebtToValuation);
  const shipsValue = me.ships.length * t.valuation.shipValue;
  const threshold = Math.round(t.sharesOutstanding * t.acquisitionThreshold);
  const rivals = view.corporations.filter((c) => c.id !== me.id);

  return (
    <div className="finance">
      <Panel className="finance__overview">
        <PanelTitle icon="finance" eyebrow="Charter Ledger" title="Valuation & Debt" />
        <div className="finance__stats">
          <Stat label="Valuation" value={formatCr(me.valuation)} icon="trending" />
          <Stat label="Cash" value={formatCr(me.credits)} icon="wallet" />
          <Stat label="Debt" value={formatCr(me.debt)} icon="finance" tone={me.debt > 0 ? "warn" : undefined} />
          <Stat label="Share price" value={`${formatCr(me.sharePrice)}`} icon="trending" />
          <Stat label="Ships" value={formatCr(shipsValue)} icon="ship" />
          <Stat label="Systems" value={me.ownedSystemIds.length} icon="systems" />
        </div>

        <div className="borrow">
          <div className="borrow__head">
            <span>Debt {formatCr(me.debt)} / ceiling {formatCr(debtCeiling)}</span>
            <Badge tone="neutral">{Math.round(t.debtInterest * 100)}% / turn</Badge>
          </div>
          <Bar value={me.debt} max={Math.max(1, debtCeiling)} tone="warn" />
          <div className="borrow__ctrl">
            <input type="number" min={0} step={500} value={borrow} onChange={(e) => setBorrow(Math.max(0, Number(e.target.value)))} />
            <button type="button" className="ghost-btn" disabled={me.isFreeOperator} onClick={() => store.stage({ kind: "borrow", amount: borrow })}>
              <Icon name="wallet" size={14} /> Borrow
            </button>
          </div>
        </div>
      </Panel>

      <Panel className="finance__market">
        <PanelTitle icon="trending" eyebrow="Equity" title="Stock Market & Takeovers" />
        {me.isFreeOperator && (
          <div className="coach">
            <Icon name="info" size={16} />
            <p>As a Free Operator you can still buy shares — reach {threshold}% control of a charter to re-enter as its controlling player.</p>
          </div>
        )}
        <div className="stock">
          {rivals.sort((a, b) => b.valuation - a.valuation).map((c) => {
            const held = c.shareRegister[me.id] ?? 0;
            const qty = shareQty[c.id] ?? 5;
            const cost = Math.round(qty * c.sharePrice);
            return (
              <div key={c.id} className="stock-row">
                <div className="stock-row__id">
                  <span className="stock-row__dot" style={{ background: corpColor(c.id) }} />
                  <div>
                    <strong>{c.name}</strong>
                    <span>{c.isFreeOperator ? "Free Operator" : "Chartered"} · {formatCr(c.sharePrice)}/share</span>
                  </div>
                </div>
                <div className="stock-row__control">
                  <div className="stock-row__meter">
                    <span>{held}/{threshold} to control</span>
                    <Bar value={held} max={threshold} tone={held >= threshold ? "positive" : "accent"} />
                  </div>
                </div>
                <div className="stock-row__buy">
                  <input
                    type="number"
                    min={1}
                    value={qty}
                    onChange={(e) => setShareQty({ ...shareQty, [c.id]: Math.max(1, Number(e.target.value)) })}
                  />
                  <button type="button" className="mini-btn" disabled={me.credits < cost} title={`~${formatCr(cost)}`} onClick={() => store.stage({ kind: "buyShares", targetId: c.id, shares: qty })}>
                    Buy · {formatCr(cost)}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}
