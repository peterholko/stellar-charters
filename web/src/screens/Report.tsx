import { useState } from "react";
import { RESOURCES, type LedgerCause, type LedgerEntry } from "@engine";
import { store, useApp } from "../match/store";
import { buildDigest } from "../match/digest";
import { buildWarnings } from "../match/warnings";
import { convoyName, formatCr, resourceColors, resourceLabels } from "../match/format";
import { Panel, PanelTitle, Badge, EmptyState } from "../ui/primitives";
import { Icon } from "../ui/icons";

/** Player-readable labels for ledger causes (design rule #1: a sentence, not a code). */
const causeLabels: Record<LedgerCause, string> = {
  claim: "Claims",
  auctionRefund: "Auction refunds",
  build: "Construction & ships",
  procurement: "Auto-procurement",
  marketBuy: "Exchange purchases",
  convoyPayout: "Export proceeds",
  upkeep: "Charter upkeep",
  tax: "Population tax",
  fuelUpkeep: "Fleet fuel (operations)",
  fuelMove: "Fleet fuel (movement)",
  fuelFreight: "Freighter fuel",
  emergencyImport: "Emergency imports",
  debtInterest: "Debt interest",
  borrow: "Borrowing",
  repay: "Repayments",
  shareTrade: "Share trades",
  plunderFence: "Fenced plunder",
  distress: "Distress",
  research: "Research",
  other: "Other",
};

/** Causes that are the game acting on the player's money — the automation digest (Section 12.6). */
const AUTOMATION: LedgerCause[] = ["procurement", "emergencyImport", "fuelUpkeep", "fuelMove", "fuelFreight"];

export function Report() {
  const { reports, view, humanCorpId, movementLog } = useApp();
  const [sel, setSel] = useState<number | null>(null);
  if (!view) return null;
  if (reports.length === 0) {
    return (
      <div className="reportscreen">
        <Panel>
          <PanelTitle icon="report" eyebrow="Turn Report" title="No turns resolved yet" />
          <EmptyState icon="report">Submit your first turn to see the report here.</EmptyState>
        </Panel>
      </div>
    );
  }
  const idx = sel == null ? reports.length - 1 : sel;
  const latest = idx === reports.length - 1;
  const report = reports[idx]!;
  const prev = idx > 0 ? reports[idx - 1] : null;
  const lines = buildDigest(report, view, humanCorpId);
  const mine = lines.filter((l) => l.scope === "me");
  const world = lines.filter((l) => l.scope === "world");

  // 1. Headlines: the 3–5 most newsworthy items, salience-ranked (review Section 12.1).
  const headlines = [...mine, ...world]
    .filter((l) => (l.weight ?? 1) >= 4)
    .sort((a, b) => (b.weight ?? 1) - (a.weight ?? 1))
    .slice(0, 5);
  const rest = mine.filter((l) => !headlines.includes(l));

  // 2. Ledger: grouped by cause with subtotals (already redacted to this seat server-side).
  const ledger = report.ledger ?? [];
  const byCause = new Map<LedgerCause, { total: number; entries: LedgerEntry[] }>();
  for (const l of ledger) {
    const g = byCause.get(l.cause) ?? { total: 0, entries: [] };
    g.total += l.delta;
    g.entries.push(l);
    byCause.set(l.cause, g);
  }
  const groups = [...byCause.entries()].sort((a, b) => Math.abs(b[1].total) - Math.abs(a[1].total));
  const net = ledger.reduce((s, l) => s + l.delta, 0);

  // 3. My convoys (live state — only meaningful when viewing the latest turn).
  const myConvoys = latest ? view.convoys.filter((c) => c.owner === humanCorpId) : [];
  const etaOf = (c: (typeof myConvoys)[number]) =>
    c.segmentTurnsLeft +
    c.routeIds.slice(c.position + 1).reduce((s, rid) => s + (view.galaxy.routes.get(rid)?.transitTime ?? 1), 0);

  // 4. Intel: price moves vs last turn + traffic on lanes touching your systems.
  const priceMoves = RESOURCES.map((r) => ({
    r,
    now: report.prices[r],
    delta: prev ? report.prices[r] - prev.prices[r] : 0,
  }))
    .filter((p) => Math.abs(p.delta) >= 0.5)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 6);
  const myRouteTraffic = latest
    ? view.me.ownedSystemIds
        .flatMap((id) => view.galaxy.systems.get(id)?.routeIds ?? [])
        .filter((rid, i, a) => a.indexOf(rid) === i)
        .map((rid) => ({ rid, traffic: view.galaxy.recentTraffic(rid, view.turn) }))
        .filter((x) => x.traffic > 0)
        .sort((a, b) => b.traffic - a.traffic)
        .slice(0, 5)
    : [];
  const routeLabel = (rid: string) => {
    const r = view.galaxy.routes.get(rid);
    if (!r) return rid;
    const n = (id: string) => { try { return view.galaxy.system(id).name; } catch { return id; } };
    return `${n(r.a)} ↔ ${n(r.b)}`;
  };

  // 5. Warnings with horizons + one-click remedies (latest turn only — they describe NOW).
  const warnings = latest ? buildWarnings(view) : [];

  // 6. Automation digest: what the game did with your money (the invisible hands, restated).
  const automation = ledger.filter((l) => AUTOMATION.includes(l.cause));

  return (
    <div className="reportscreen">
      <Panel className="reportscreen__history">
        <PanelTitle icon="clock" eyebrow="Match Log" title="Turn History" />
        <div className="report-history">
          {reports.map((r, i) => (
            <button key={i} type="button" className={`report-history__row ${i === idx ? "is-active" : ""}`} onClick={() => setSel(i)}>
              <span>{r.phase === "auction" ? "Auction" : `Turn ${r.turn}`}</span>
              <span className="report-history__count">{r.events.length} events</span>
            </button>
          ))}
        </div>
      </Panel>

      <Panel className="reportscreen__detail">
        <PanelTitle
          icon="report"
          eyebrow="Turn Report"
          title={report.phase === "auction" ? "Opening Auction" : `Turn ${report.turn} Report`}
          right={<Badge tone={net >= 0 ? "accent" : "negative"}>{net >= 0 ? "+" : ""}{formatCr(Math.round(net))} net</Badge>}
        />

        {/* 1 ── Headlines */}
        <h3 className="report-sub">Headlines</h3>
        <div className="digest">
          {headlines.length === 0 ? <EmptyState icon="check">A quiet turn on the frontier.</EmptyState> : headlines.map((l, i) => (
            <div key={i} className={`digest__row digest__row--${l.tone}`}>
              <Icon name={l.tone === "good" ? "check" : l.tone === "bad" || l.tone === "warn" ? "alert" : "info"} size={15} />
              <div><strong>{l.title}</strong><span>{l.body}</span></div>
            </div>
          ))}
        </div>

        {/* 5 ── Warnings (high on the page: they need acting on) */}
        {warnings.length > 0 && (
          <>
            <h3 className="report-sub">Warnings</h3>
            <div className="digest">
              {warnings.map((w, i) => (
                <div key={i} className={`digest__row digest__row--${w.tone}`}>
                  <Icon name="alert" size={15} />
                  <div><strong>{w.title}</strong><span>{w.body}</span></div>
                  {w.fix && (
                    <button type="button" className="mini-btn" onClick={w.fix.run}>{w.fix.label}</button>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        {/* 2 ── Ledger */}
        <h3 className="report-sub">Ledger</h3>
        {ledger.length === 0 ? (
          <p className="hint">No credit movements this turn.</p>
        ) : (
          <div className="ledger">
            {groups.map(([cause, g]) => (
              <details key={cause} className="ledger__group">
                <summary className="preview__row">
                  <span>{causeLabels[cause]} · {g.entries.length}</span>
                  <strong className={g.total > 0 ? "pos" : g.total < 0 ? "neg" : ""}>
                    {g.total > 0 ? "+" : ""}{formatCr(Math.round(g.total))}
                  </strong>
                </summary>
                {g.entries.map((l, i) => (
                  <div key={i} className="preview__row ledger__line">
                    <span>{l.detail ?? causeLabels[l.cause]}</span>
                    <strong>{l.delta > 0 ? "+" : ""}{l.delta === 0 ? "—" : formatCr(Math.round(l.delta))}</strong>
                  </div>
                ))}
              </details>
            ))}
            <div className="preview__row ledger__net"><span>Net</span><strong>{net >= 0 ? "+" : ""}{formatCr(Math.round(net))}</strong></div>
          </div>
        )}

        {/* 3 ── My convoys */}
        {latest && (
          <>
            <h3 className="report-sub">
              My Convoys
              {movementLog.length > 0 && (
                <button type="button" className="mini-btn" style={{ marginLeft: 10 }} onClick={() => store.requestReplay()}>
                  ▶ Watch last turn
                </button>
              )}
            </h3>
            {myConvoys.length === 0 ? (
              <p className="hint">No convoys in transit.</p>
            ) : (
              <div className="digest">
                {myConvoys.map((c) => (
                  <div key={c.id} className="digest__row digest__row--info">
                    <Icon name="convoys" size={15} />
                    <div>
                      <strong>{convoyName(c.id)} · {Math.round(c.quantity)} {resourceLabels[c.resource]}</strong>
                      <span>
                        → {(() => { try { return view.galaxy.system(c.path[c.path.length - 1]!).name; } catch { return "?"; } })()} · ETA {etaOf(c)}t
                      </span>
                    </div>
                    <button type="button" className="mini-btn" onClick={() => { store.select({ kind: "convoy", id: c.id }); store.setNav("map"); }}>Map</button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* 4 ── Intel */}
        <h3 className="report-sub">Intel</h3>
        <div className="report-market">
          {RESOURCES.map((r) => (
            <div key={r} className="report-market__cell">
              <i style={{ background: resourceColors[r] }} />
              <span>{resourceLabels[r]}</span>
              <strong>{report.prices[r].toFixed(1)}</strong>
            </div>
          ))}
        </div>
        {(priceMoves.length > 0 || myRouteTraffic.length > 0 || world.length > 0) && (
          <div className="digest">
            {priceMoves.map((p) => (
              <div key={p.r} className={`digest__row digest__row--${p.delta > 0 ? "good" : "warn"}`}>
                <Icon name="exchange" size={15} />
                <div>
                  <strong>{resourceLabels[p.r]} {p.delta > 0 ? "+" : ""}{p.delta.toFixed(1)}</strong>
                  <span>now {p.now.toFixed(1)} Cr.</span>
                </div>
              </div>
            ))}
            {myRouteTraffic.map((x) => (
              <div key={x.rid} className="digest__row digest__row--info">
                <Icon name="radar" size={15} />
                <div>
                  <strong>{routeLabel(x.rid)}</strong>
                  <span>{x.traffic} convoy{x.traffic === 1 ? "" : "s"} in the last 5 turns — visible to every raider.</span>
                </div>
                <button type="button" className="mini-btn" onClick={() => { store.select({ kind: "route", id: x.rid }); store.setNav("map"); }}>Map</button>
              </div>
            ))}
            {world.map((l, i) => (
              <div key={`w${i}`} className={`digest__row digest__row--${l.tone}`}>
                <Icon name="info" size={15} />
                <div><strong>{l.title}</strong><span>{l.body}</span></div>
              </div>
            ))}
          </div>
        )}

        {/* 6 ── Automation digest */}
        {automation.length > 0 && (
          <>
            <h3 className="report-sub">Automation — what the game did with your money</h3>
            <div className="ledger">
              {automation.map((l, i) => (
                <div key={i} className="preview__row ledger__line">
                  <span>{causeLabels[l.cause]}: {l.detail ?? ""}</span>
                  <strong>{l.delta > 0 ? "+" : ""}{formatCr(Math.round(l.delta))}</strong>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Everything else from your charter's turn */}
        {rest.length > 0 && (
          <>
            <h3 className="report-sub">Also This Turn</h3>
            <div className="digest">
              {rest.map((l, i) => (
                <div key={i} className={`digest__row digest__row--${l.tone}`}>
                  <Icon name={l.tone === "good" ? "check" : l.tone === "bad" || l.tone === "warn" ? "alert" : "info"} size={15} />
                  <div><strong>{l.title}</strong><span>{l.body}</span></div>
                </div>
              ))}
            </div>
          </>
        )}
      </Panel>
    </div>
  );
}
