import { useState } from "react";
import { RESOURCES } from "@engine";
import { useApp } from "../match/store";
import { buildDigest } from "../match/digest";
import { formatCr, resourceColors, resourceLabels } from "../match/format";
import { Panel, PanelTitle, Badge, EmptyState } from "../ui/primitives";
import { Icon } from "../ui/icons";

export function Report() {
  const { reports, view, humanCorpId } = useApp();
  if (!view) return null;
  const [sel, setSel] = useState<number | null>(null);
  if (reports.length === 0) {
    return (
      <div className="reportscreen">
        <Panel>
          <PanelTitle icon="report" eyebrow="Resolution Digest" title="No turns resolved yet" />
          <EmptyState icon="report">Submit your first turn to see the resolution digest here.</EmptyState>
        </Panel>
      </div>
    );
  }
  const idx = sel == null ? reports.length - 1 : sel;
  const report = reports[idx]!;
  const lines = buildDigest(report, view, humanCorpId);
  const mine = lines.filter((l) => l.scope === "me");
  const world = lines.filter((l) => l.scope === "world");

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
        <PanelTitle icon="report" eyebrow="Resolution Digest" title={report.phase === "auction" ? "Opening Auction" : `Turn ${report.turn} Report`} right={<Badge tone="info">{formatCr(report.taxLevied)} tax</Badge>} />

        <div className="report-market">
          {RESOURCES.map((r) => (
            <div key={r} className="report-market__cell">
              <i style={{ background: resourceColors[r] }} />
              <span>{resourceLabels[r]}</span>
              <strong>{report.prices[r].toFixed(1)}</strong>
            </div>
          ))}
        </div>

        <h3 className="report-sub">Your Charter</h3>
        <div className="digest">
          {mine.length === 0 ? <EmptyState icon="check">Quiet turn for your charter.</EmptyState> : mine.map((l, i) => (
            <div key={i} className={`digest__row digest__row--${l.tone}`}>
              <Icon name={l.tone === "good" ? "check" : l.tone === "bad" || l.tone === "warn" ? "alert" : "info"} size={15} />
              <div><strong>{l.title}</strong><span>{l.body}</span></div>
            </div>
          ))}
        </div>

        {world.length > 0 && (
          <>
            <h3 className="report-sub">Across the Frontier</h3>
            <div className="digest">
              {world.map((l, i) => (
                <div key={i} className={`digest__row digest__row--${l.tone}`}>
                  <Icon name="info" size={15} />
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
