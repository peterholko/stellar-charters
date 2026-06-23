import { useState } from "react";
import type { PlayerView } from "@engine";
import { useApp, store } from "../match/store";
import { formatCr } from "../match/format";
import { previewShareBuy, previewShareSell } from "../match/orderCost";
import { Panel, PanelTitle, Badge, Bar, Stat } from "../ui/primitives";
import { NumberInput } from "../ui/NumberInput";
import { Icon } from "../ui/icons";
import { CorpCrest } from "../theme/art";

/**
 * Order ticket (Section 17): opens from a row's Buy/Sell button. Side-specific, so the
 * limit can default sensibly — a buy starts at the cheapest ask, a sell at the best bid
 * — and the fill preview itemizes exactly which blocks trade at what price before the
 * order is staged (design rule #5: market price + effective price, itemized).
 */
function TradeTicket({ view, corpId, side, onClose }: { view: PlayerView; corpId: string; side: "buy" | "sell"; onClose: () => void }) {
  const target = view.corporations.find((c) => c.id === corpId);
  const own = corpId === view.me.id;
  const traded = (target?.sharePrice ?? 0) * (target?.sentiment ?? 1);
  const held = target?.shareRegister[view.me.id] ?? 0;
  const bid = target && target.npcHolders.length > 0
    ? Math.floor(traded * Math.max(...target.npcHolders.map((h) => h.bidDiscount)))
    : 0;
  const ask = previewShareBuy(view, corpId, 1, Number.POSITIVE_INFINITY).steps[0]?.price;
  const [qty, setQty] = useState(side === "sell" ? Math.max(1, Math.min(5, held)) : 5);
  const [limit, setLimit] = useState(side === "buy" ? Math.max(1, Math.ceil(ask ?? traded)) : Math.max(1, bid));
  if (!target) return null;

  const sellQty = Math.min(qty, held);
  const pv = side === "buy"
    ? previewShareBuy(view, corpId, qty, limit)
    : previewShareSell(view, corpId, sellQty, limit);
  const total = Math.round(pv.total);
  const affordable = side === "sell" || view.me.credits >= total;
  const title = own
    ? side === "buy" ? "Buy back your float" : "Raise cash — sell management shares"
    : `${side === "buy" ? "Buy" : "Sell"} ${target.name} shares`;
  const shortReason = side === "buy" && pv.wholeBlock
    ? `the management block sells only as one lot — ${pv.wholeBlock.shares} shares at ~${formatCr(Math.round(pv.wholeBlock.price))} each`
    : pv.stoppedAt
      ? side === "buy"
        ? "the remaining shares are asking more than your limit — raise it to fill more"
        : "the remaining bids are below your limit — lower it to sell more"
      : side === "buy"
        ? "no more shares are available"
        : held < qty
          ? `you hold only ${held}`
          : "the market absorbs only a few shares per turn";

  return (
    <div className="ticket">
      <div className="ticket__head">
        <strong>{title}</strong>
        <span className="ticket__quote">bid {formatCr(bid)} · ask {ask !== undefined ? formatCr(Math.round(ask)) : "—"}</span>
      </div>
      <div className="ticket__fields">
        <label className="stock-field">
          <span>shares</span>
          <NumberInput min={1} value={qty} onCommit={setQty} />
        </label>
        <label className="stock-field">
          <span>{side === "buy" ? "limit · max Cr/share" : "limit · min Cr/share"}</span>
          <NumberInput min={1} value={limit} onCommit={setLimit} />
        </label>
      </div>
      {pv.filled > 0 && (
        <div className="ticket__fills">
          {/* One anonymous summary — no per-block ladder that mirrors the cap table. */}
          <div className="ticket__fill">
            <span>{pv.filled} share{pv.filled === 1 ? "" : "s"} fill</span>
            <span>avg ~{formatCr(Math.round(pv.total / pv.filled))}/share</span>
          </div>
          <div className="ticket__fill ticket__fill--total">
            <span>{side === "buy" ? "Total cost" : own ? "Treasury receives" : "You receive"}</span>
            <strong>{formatCr(total)}</strong>
          </div>
        </div>
      )}
      {pv.filled < (side === "sell" ? sellQty : qty) || pv.filled === 0 ? (
        <div className="ticket__warn">
          {pv.filled === 0 ? "No fills at this limit" : `Only ${pv.filled}/${qty} fill`} — {shortReason}.
        </div>
      ) : null}
      {own && side === "sell" && pv.filled > 0 && (
        <div className="ticket__warn">Shrinks your management block — takeover exposure rises.</div>
      )}
      {!affordable && <div className="ticket__warn">Costs more cash than you hold.</div>}
      <div className="ticket__actions">
        <button type="button" className="ghost-btn" onClick={onClose}>Cancel</button>
        <button
          type="button"
          className="mini-btn"
          disabled={pv.filled <= 0 || !affordable}
          onClick={() => {
            store.stage(side === "buy"
              ? { kind: "buyShares", targetId: corpId, shares: qty, limitPrice: limit }
              : { kind: "sellShares", targetId: corpId, shares: sellQty, limitPrice: limit });
            onClose();
          }}
        >
          Place {side === "buy" ? "Buy" : "Sell"} Order
        </button>
      </div>
    </div>
  );
}

export function Finance() {
  const { view } = useApp();
  if (!view) return null;
  const t = view.config.tuning;
  const me = view.me;
  const [borrow, setBorrow] = useState(1000);
  const [openCap, setOpenCap] = useState<string | null>(null);
  const [ticket, setTicket] = useState<{ corpId: string; side: "buy" | "sell" } | null>(null);
  const toggleTicket = (corpId: string, side: "buy" | "sell") =>
    setTicket((cur) => (cur && cur.corpId === corpId && cur.side === side ? null : { corpId, side }));

  // Click a charter to unfold who currently owns it (Section 17 cap table): purely
  // who holds what — prices belong to the trade ticket, where they're live quotes.
  const renderOwnership = (c: (typeof view.corporations)[number]) => {
    const rows = Object.entries(c.shareRegister)
      .filter(([, n]) => n > 0)
      .map(([holder, n]) => {
        const npc = c.npcHolders.find((h) => h.id === holder);
        if (npc) return { key: holder, name: npc.name, shares: n, you: false };
        if (holder === c.founderId) {
          return {
            key: holder,
            name: holder === me.id ? "Management block (you)" : "Management block",
            shares: n,
            you: holder === me.id,
          };
        }
        const corp = view.corporations.find((x) => x.id === holder);
        return {
          key: holder,
          name: corp ? `${corp.name}${corp.id === me.id ? " (you)" : ""}` : holder,
          shares: n,
          you: corp?.id === me.id,
        };
      })
      .sort((a, b) => b.shares - a.shares);
    return (
      <div className="captable">
        {rows.map((r) => (
          <div key={r.key} className={`captable__row${r.you ? " is-you" : ""}`}>
            <span className="captable__name">{r.name}</span>
            <span className="captable__shares">{r.shares}</span>
            <Bar value={r.shares} max={c.sharesOutstanding} tone={r.you ? "positive" : "accent"} />
          </div>
        ))}
      </div>
    );
  };

  const debtCeiling = Math.max(0, me.valuation * t.maxDebtToValuation);
  const shipsValue = me.ships.length * t.valuation.shipValue;
  const threshold = Math.round(t.sharesOutstanding * t.acquisitionThreshold);
  const rivals = view.corporations.filter((c) => c.id !== me.id);
  const ownBlock = view.me.shareRegister[me.id] ?? 0;

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
            <NumberInput min={0} step={500} value={borrow} onCommit={setBorrow} />
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

        {/* Your own cap table (Section 17): sell management shares to raise cash —
            at the price of takeover exposure — or buy the float back as defense. */}
        <div className="stock-row stock-row--own">
          <button type="button" className="stock-row__head" onClick={() => setOpenCap(openCap === me.id ? null : me.id)}>
            <CorpCrest corpId={me.id} size={26} className="stock-row__crest" />
            <div>
              <strong>Your charter</strong>
              <span>{formatCr(Math.round(me.sharePrice * me.sentiment))}/share</span>
            </div>
            <span className="stock-row__chev">{openCap === me.id ? "▾" : "▸"}</span>
          </button>
          <div className="stock-row__control">
            <div className="stock-row__meter">
              <span>management block {ownBlock}/{me.sharesOutstanding}</span>
              <Bar value={ownBlock} max={me.sharesOutstanding} tone={ownBlock > threshold ? "positive" : "warn"} />
            </div>
          </div>
          <div className="stock-row__buy">
            <button type="button" className="mini-btn" onClick={() => toggleTicket(me.id, "buy")}>
              Buy back
            </button>
            <button type="button" className="mini-btn" disabled={ownBlock <= 0} title={ownBlock <= 0 ? "No management shares left to sell" : undefined} onClick={() => toggleTicket(me.id, "sell")}>
              Raise
            </button>
          </div>
          {ticket?.corpId === me.id && (
            <TradeTicket key={`${me.id}:${ticket.side}`} view={view} corpId={me.id} side={ticket.side} onClose={() => setTicket(null)} />
          )}
          {openCap === me.id && renderOwnership(view.me)}
        </div>

        <div className="stock">
          {rivals.sort((a, b) => b.valuation - a.valuation).map((c) => {
            const held = c.shareRegister[me.id] ?? 0;
            const traded = c.sharePrice * c.sentiment;
            return (
              <div key={c.id} className="stock-row">
                <button type="button" className="stock-row__head" onClick={() => setOpenCap(openCap === c.id ? null : c.id)}>
                  <CorpCrest corpId={c.id} size={26} className="stock-row__crest" />
                  <div>
                    <strong>{c.name}</strong>
                    <span>
                      {c.isFreeOperator ? "Free Operator · " : ""}{formatCr(Math.round(traded))}/share
                    </span>
                  </div>
                  <span className="stock-row__chev">{openCap === c.id ? "▾" : "▸"}</span>
                </button>
                <div className="stock-row__control">
                  <div className="stock-row__meter">
                    <span>{held}/{threshold} to control</span>
                    <Bar value={held} max={threshold} tone={held >= threshold ? "positive" : "accent"} />
                  </div>
                </div>
                <div className="stock-row__buy">
                  <button type="button" className="mini-btn" onClick={() => toggleTicket(c.id, "buy")}>
                    Buy
                  </button>
                  <button type="button" className="mini-btn" disabled={held <= 0} title={held <= 0 ? "No shares held" : undefined} onClick={() => toggleTicket(c.id, "sell")}>
                    Sell
                  </button>
                </div>
                {ticket?.corpId === c.id && (
                  <TradeTicket key={`${c.id}:${ticket.side}`} view={view} corpId={c.id} side={ticket.side} onClose={() => setTicket(null)} />
                )}
                {openCap === c.id && renderOwnership(c)}
              </div>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}
