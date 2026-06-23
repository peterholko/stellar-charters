import { techById, type PlayerView, type TurnReport, type TurnEvent } from "@engine";
import { convoyName, resourceLabels } from "./format";

export type DigestTone = "good" | "bad" | "warn" | "info";

export interface DigestLine {
  tone: DigestTone;
  title: string;
  body: string;
  scope: "me" | "world";
  /** Optional art slot (e.g. "event-raid") shown as a splash thumbnail on the line. */
  art?: string;
  /** Headline salience (review Section 12.1): higher = more newsworthy. Default 1. */
  weight?: number;
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
          lines.push({ tone: "good", scope: "me", title: `Won ${sysName(e.systemId)}`, body: `Charter secured for ${e.amount.toLocaleString()} Cr.` });
        break;
      case "arrival":
        if (e.corpId === me) {
          mineCount.arrival++;
          if (e.kind === "sell")
            lines.push({ tone: "good", scope: "me", title: `Export paid`, body: `${Math.round(e.quantity)} ${resourceLabels[e.resource]} delivered → +${Math.round(e.payout)} Cr.` });
          else
            lines.push({ tone: "info", scope: "me", title: `${e.kind === "buy" ? "Import" : "Transfer"} arrived`, body: `${Math.round(e.quantity)} ${resourceLabels[e.resource]} at ${sysName(e.destSystemId)}.` });
        }
        break;
      case "fill":
        if (e.corpId === me) {
          mineCount.fill++;
          lines.push({ tone: "info", scope: "me", title: `${e.side === "sell" ? "Sell" : "Buy"} order filled`, body: `${e.quantity} ${resourceLabels[e.resource]} at ${e.price.toFixed(0)} Cr from ${sysName(e.systemId)}.` });
        }
        break;
      case "raid": {
        // Shown math (design rule #8): the named forces behind the outcome, not a bare verdict.
        const math = `raid ${Math.round(e.attackStrength)} vs defense ${Math.round(e.defenseStrength)}` +
          (e.defenseStrength > 0 ? ` (escort ${Math.round(e.escort)} + local ${Math.round(e.localDefense)})` : "");
        const cargo = e.cargoPlundered || e.cargoDestroyed
          ? ` · ${e.cargoPlundered ? `${Math.round(e.cargoPlundered)} ${resourceLabels[e.resource]} taken` : ""}${e.cargoPlundered && e.cargoDestroyed ? ", " : ""}${e.cargoDestroyed ? `${Math.round(e.cargoDestroyed)} destroyed` : ""}`
          : "";
        const weight = e.outcome === "plundered" || e.outcome === "ambushed" ? 10 : e.outcome === "damaged" ? 8 : e.outcome === "repelled" ? 7 : e.outcome === "harassed" ? 5 : 2;
        // Attribution as intel (review Section 11): deniable privateer strikes read as suspicion
        // with an evidence level, not certainty — "Suspected sponsor: Helios (60%)".
        const attacker = e.sponsorEvidence >= 1
          ? corpName(e.attackerId)
          : `Suspected sponsor: ${corpName(e.attackerId)} (${Math.round(e.sponsorEvidence * 100)}% evidence)`;
        if (e.defenderId === me)
          lines.push({ tone: raidTone[e.outcome] === "good" ? "good" : "bad", scope: "me", art: "event-raid", weight, title: `Convoy ${convoyName(e.convoyId)} ${e.outcome}`, body: `${attacker} — hit your ${resourceLabels[e.resource]} lane; ${math}${cargo}.` });
        else if (e.attackerId === me)
          lines.push({ tone: e.cargoLost ? "good" : "info", scope: "me", art: "event-raid", weight, title: `Raid: ${convoyName(e.convoyId)} ${e.outcome}`, body: `Against ${corpName(e.defenderId)} — ${math}${cargo}.` });
        break;
      }
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
          lines.push({ tone: "warn", scope: "me", weight: 6, title: `${sysName(e.systemId)} is starving`, body: `Unmet food/ice — unrest is rising. Ship supply or build hydroponics.` });
        break;
      case "sabotage":
        if (e.defenderId === me)
          lines.push({ tone: e.success ? "bad" : "good", scope: "me", art: "event-raid", title: e.success ? `Extractor sabotaged` : `Sabotage repelled`, body: `${corpName(e.attackerId)} struck your ${resourceLabels[e.resource]} extractor at ${sysName(e.systemId)}${e.success ? " — offline for several turns" : " — defenses held"}.` });
        else if (e.attackerId === me)
          lines.push({ tone: e.success ? "good" : "info", scope: "me", art: "event-raid", title: e.success ? `Sabotage landed` : `Sabotage repelled`, body: `${e.success ? "Knocked out" : "Failed to reach"} ${corpName(e.defenderId)}'s ${resourceLabels[e.resource]} extractor at ${sysName(e.systemId)}.` });
        break;
      case "invasion": {
        const sys = sysName(e.systemId);
        const forces = `force ${e.attackForce} vs defense ${e.defenseForce}`;
        if (e.attackerId === me)
          lines.push({ tone: e.captured ? "good" : "warn", scope: "me", art: "event-raid", weight: 10, title: e.captured ? `Captured ${sys}` : `Invasion repelled`, body: e.captured ? `Your forces seized ${sys} from ${corpName(e.defenderId)} — ${forces}.` : `${corpName(e.defenderId)} held ${sys} — ${forces}; your fleet took losses.` });
        else if (e.defenderId === me)
          lines.push({ tone: e.captured ? "bad" : "good", scope: "me", art: "event-raid", weight: 10, title: e.captured ? `${sys} fell` : `Held ${sys}`, body: e.captured ? `${corpName(e.attackerId)} captured ${sys} from you — ${forces}.` : `You repelled ${corpName(e.attackerId)}'s assault on ${sys} — ${forces}.` });
        else
          lines.push({ tone: "info", scope: "world", weight: 6, title: `Invasion`, body: `${corpName(e.attackerId)} ${e.captured ? "captured" : "assaulted"} ${sys} (${corpName(e.defenderId)}).` });
        break;
      }
      case "warDeclared":
        if (e.aggressorId === me) lines.push({ tone: "warn", scope: "me", weight: 9, title: `War declared`, body: `You invaded ${corpName(e.defenderId)} — barred from the Exchange until the ceasefire.` });
        else if (e.defenderId === me) lines.push({ tone: "bad", scope: "me", weight: 9, title: `Under attack`, body: `${corpName(e.aggressorId)} has declared war on your charter.` });
        else lines.push({ tone: "info", scope: "world", title: `War declared`, body: `${corpName(e.aggressorId)} invaded ${corpName(e.defenderId)}.` });
        break;
      case "warEnded":
        if (e.aggressorId === me) lines.push({ tone: "good", scope: "me", title: `Ceasefire`, body: `Your war with ${corpName(e.defenderId)} is over — Exchange access restored.` });
        else if (e.defenderId === me) lines.push({ tone: "info", scope: "me", title: `Ceasefire`, body: `The war with ${corpName(e.aggressorId)} has ended.` });
        break;
      case "alliance":
        if (e.aId === me || e.bId === me) lines.push({ tone: "good", scope: "me", title: `Alliance formed`, body: `Defensive pact with ${corpName(e.aId === me ? e.bId : e.aId)}.` });
        else lines.push({ tone: "info", scope: "world", title: `Alliance`, body: `${corpName(e.aId)} and ${corpName(e.bId)} formed a defensive alliance.` });
        break;
      case "pactInvoked":
        if (e.protectorId === me) lines.push({ tone: "warn", scope: "me", title: `Pact invoked`, body: `${corpName(e.allyId)} was invaded — you join the war against ${corpName(e.aggressorId)}.` });
        else if (e.aggressorId === me) lines.push({ tone: "warn", scope: "me", title: `Pact triggered`, body: `${corpName(e.protectorId)} joins the war to defend ${corpName(e.allyId)}.` });
        else if (e.allyId === me) lines.push({ tone: "good", scope: "me", title: `Ally answers the call`, body: `${corpName(e.protectorId)} joins the war on your side against ${corpName(e.aggressorId)}.` });
        break;
      case "acquisition":
        if (e.acquirerId === me) lines.push({ tone: "good", scope: "me", art: "event-acquisition", weight: 10, title: `Acquisition`, body: `You absorbed ${corpName(e.targetId)}'s charter.` });
        else if (e.targetId === me) lines.push({ tone: "bad", scope: "me", art: "event-acquisition", weight: 10, title: `You were acquired`, body: `${corpName(e.acquirerId)} took control of your charter.` });
        else lines.push({ tone: "info", scope: "world", art: "event-acquisition", title: `Acquisition`, body: `${corpName(e.acquirerId)} absorbed ${corpName(e.targetId)}.` });
        break;
      case "distress":
        lines.push({ tone: e.corpId === me ? "bad" : "info", scope: e.corpId === me ? "me" : "world", art: "status-distress", weight: 10, title: `${e.corpId === me ? "You" : corpName(e.corpId)} collapsed`, body: `Charter lost to distress — now a Free Operator.` });
        break;
      case "research":
        if (e.corpId === me) {
          const tech = techById(e.techId);
          lines.push({ tone: "good", scope: "me", weight: 4, title: tech?.secret ? "Secret project complete!" : "Research unlocked", body: `${tech?.name ?? e.techId}${tech?.secret ? " — a galaxy-unique edge no rival can now build." : "."}` });
        }
        break;
    }
  }

  // Collapse noisy duplicate fill lines if there are arrivals already.
  return lines;
}
