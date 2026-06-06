import type { PlayerView, TurnReport, TurnEvent } from "@engine";
import { resourceLabels } from "./format";

export type DigestTone = "good" | "bad" | "warn" | "info";

export interface DigestLine {
  tone: DigestTone;
  title: string;
  body: string;
  scope: "me" | "world";
}

const raidTone: Record<string, DigestTone> = {
  noContact: "info",
  shadowed: "info",
  harassed: "warn",
  damaged: "bad",
  plundered: "bad",
  repelled: "good",
  ambushed: "good",
};

/** Turn report → human-readable digest lines, from the human player's perspective. */
export function buildDigest(report: TurnReport, view: PlayerView, me: string): DigestLine[] {
  const g = view.galaxy;
  const sysName = (id: string) => {
    try {
      return g.system(id).name;
    } catch {
      return id;
    }
  };
  const corpName = (id: string) => view.corporations.find((c) => c.id === id)?.name ?? id;

  const lines: DigestLine[] = [];
  const mineCount = { arrival: 0, fill: 0 };

  for (const e of report.events as TurnEvent[]) {
    switch (e.type) {
      case "auctionAward":
        if (e.corpId === me)
          lines.push({ tone: "good", scope: "me", title: `Won ${sysName(e.systemId)}`, body: `Charter secured for ${e.amount.toLocaleString()} cr.` });
        break;
      case "arrival":
        if (e.corpId === me) {
          mineCount.arrival++;
          if (e.kind === "sell")
            lines.push({ tone: "good", scope: "me", title: `Export paid`, body: `${Math.round(e.quantity)} ${resourceLabels[e.resource]} delivered → +${Math.round(e.payout)} cr.` });
          else
            lines.push({ tone: "info", scope: "me", title: `${e.kind === "buy" ? "Import" : "Transfer"} arrived`, body: `${Math.round(e.quantity)} ${resourceLabels[e.resource]} at ${sysName(e.destSystemId)}.` });
        }
        break;
      case "fill":
        if (e.corpId === me) {
          mineCount.fill++;
          lines.push({ tone: "info", scope: "me", title: `${e.side === "sell" ? "Sell" : "Buy"} order filled`, body: `${e.quantity} ${resourceLabels[e.resource]} at ${e.price.toFixed(0)} cr from ${sysName(e.systemId)}.` });
        }
        break;
      case "raid":
        if (e.defenderId === me)
          lines.push({ tone: raidTone[e.outcome] === "good" ? "good" : "bad", scope: "me", title: `Convoy ${e.outcome}`, body: `${corpName(e.attackerId)} hit your ${resourceLabels[e.resource]} lane${e.cargoLost ? ` · −${e.cargoLost} cargo` : ""}.` });
        else if (e.attackerId === me)
          lines.push({ tone: e.cargoLost ? "good" : "info", scope: "me", title: `Raid: ${e.outcome}`, body: `Against ${corpName(e.defenderId)}${e.cargoLost ? ` · +${e.cargoLost} ${resourceLabels[e.resource]}` : ""}.` });
        break;
      case "build":
        if (e.corpId === me)
          lines.push({ tone: "info", scope: "me", title: e.what, body: e.systemId ? `at ${sysName(e.systemId)}.` : "Order resolved." });
        break;
      case "growth":
        if (e.corpId === me)
          lines.push({ tone: "good", scope: "me", title: `${sysName(e.systemId)} grew`, body: `Population advanced to ${e.newStage}.` });
        break;
      case "starved":
        if (e.corpId === me)
          lines.push({ tone: "warn", scope: "me", title: `${sysName(e.systemId)} is starving`, body: `Unmet food/ice — unrest is rising. Ship supply or build hydroponics.` });
        break;
      case "acquisition":
        if (e.acquirerId === me) lines.push({ tone: "good", scope: "me", title: `Acquisition`, body: `You absorbed ${corpName(e.targetId)}'s charter.` });
        else if (e.targetId === me) lines.push({ tone: "bad", scope: "me", title: `You were acquired`, body: `${corpName(e.acquirerId)} took control of your charter.` });
        else lines.push({ tone: "info", scope: "world", title: `Acquisition`, body: `${corpName(e.acquirerId)} absorbed ${corpName(e.targetId)}.` });
        break;
      case "distress":
        lines.push({ tone: e.corpId === me ? "bad" : "info", scope: e.corpId === me ? "me" : "world", title: `${e.corpId === me ? "You" : corpName(e.corpId)} collapsed`, body: `Charter lost to distress — now a Free Operator.` });
        break;
    }
  }

  // Collapse noisy duplicate fill lines if there are arrivals already.
  return lines;
}
