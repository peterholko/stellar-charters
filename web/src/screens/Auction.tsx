import { store, useApp, type BidPriority } from "../match/store";
import {
  archetypeLabel,
  formatCr,
  resourceColors,
  resourceLabels,
  systemArchetype,
} from "../match/format";
import { RESOURCES } from "@engine";
import { PlanetArt, ArtSlot } from "../theme/ArtSlot";
import { Icon } from "../ui/icons";
import { Badge } from "../ui/primitives";

export function Auction() {
  const { view, bid, resolving } = useApp();
  const inner = view.galaxy.innerRingSystems().sort((a, b) => a.claimCost - b.claimCost);
  const bidIds = new Set(bid.map((b) => b.systemId));

  const addBid = (systemId: string, claimCost: number) => {
    // Rivals bid up to ~85% of their capital on a top pick, so suggest a competitive
    // opening bid (the player can lower it to conserve cash and risk losing the seat).
    const suggested = Math.max(claimCost, Math.round(view.me.credits * 0.86));
    store.addBid(systemId, suggested);
  };
  const setAmount = (i: number, amount: number) => store.setBidAmount(i, amount);
  const remove = (i: number) => store.removeBidAt(i);
  const move = (i: number, dir: -1 | 1) => store.moveBid(i, dir);

  const topAmount = bid[0]?.amount ?? 0;

  return (
    <div className="auction">
      <div className="auction__hero">
        <ArtSlot slot="hero-wormhole-hub" className="auction__hero-art" />
        <div className="auction__hero-text">
          <p className="eyebrow">Wormhole Authority · Opening Mandate</p>
          <h1>Inner Ring Claim Auction</h1>
          <p>
            Submit sealed bids for one starting charter. List <strong>fallback priorities</strong> — you win at most
            one system, paying only your winning bid. Losing deposits are {Math.round(view.config.tuning.bidRefundFrac * 100)}% refunded.
          </p>
          <div className="auction__wallet">
            <Icon name="wallet" size={16} /> Capital <strong>{formatCr(view.me.credits)}</strong>
          </div>
        </div>
      </div>

      <div className="auction__grid">
        <div className="auction__systems">
          {inner.map((s) => {
            const arch = systemArchetype(s);
            const picked = bidIds.has(s.id);
            return (
              <article key={s.id} className={`bid-card ${picked ? "is-picked" : ""}`}>
                <PlanetArt archetype={arch} className="bid-card__planet" />
                <div className="bid-card__main">
                  <h3>{s.name}</h3>
                  <p className="bid-card__arch">{archetypeLabel[arch]}</p>
                  <div className="bid-card__yields">
                    {RESOURCES.filter((r) => s.yields[r] > 0).map((r) => (
                      <span key={r}><i style={{ background: resourceColors[r] }} />{resourceLabels[r]} +{s.yields[r]}</span>
                    ))}
                  </div>
                </div>
                <div className="bid-card__foot">
                  <span className="bid-card__cost">Base {formatCr(s.claimCost)}</span>
                  <button type="button" disabled={picked} onClick={() => addBid(s.id, s.claimCost)}>
                    <Icon name="plus" size={14} /> {picked ? "Listed" : "Bid"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>

        <aside className="auction__slip">
          <header>
            <p className="eyebrow">Sealed Bid</p>
            <h2>Priority Stack</h2>
          </header>
          {bid.length === 0 ? (
            <p className="hint">Add systems in fallback order. Your highest valid bid that nobody outbids wins.</p>
          ) : (
            <ol className="slip__list">
              {bid.map((b, i) => {
                const s = view.galaxy.system(b.systemId);
                return (
                  <li key={b.systemId}>
                    <div className="slip__rank">{i + 1}</div>
                    <div className="slip__sys">
                      <strong>{s.name}</strong>
                      <div className="slip__amount">
                        <input
                          type="number"
                          min={s.claimCost}
                          step={100}
                          value={b.amount}
                          onChange={(e) => setAmount(i, Number(e.target.value))}
                        />
                        <span>cr</span>
                      </div>
                    </div>
                    <div className="slip__ctrl">
                      <button type="button" onClick={() => move(i, -1)} disabled={i === 0} title="Up">▲</button>
                      <button type="button" onClick={() => move(i, 1)} disabled={i === bid.length - 1} title="Down">▼</button>
                      <button type="button" onClick={() => remove(i)} title="Remove"><Icon name="x" size={13} /></button>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
          <div className="slip__foot">
            <div className="slip__deposit">
              <span>Top deposit</span>
              <strong className={topAmount > view.me.credits ? "is-over" : ""}>{formatCr(topAmount)}</strong>
            </div>
            {topAmount > view.me.credits && <Badge tone="negative">Exceeds capital</Badge>}
            <button
              type="button"
              className="slip__submit"
              disabled={bid.length === 0 || resolving || topAmount > view.me.credits}
              onClick={() => store.submit()}
            >
              <Icon name="gavel" size={16} /> {resolving ? "Sealing…" : "Place Sealed Bids"}
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
