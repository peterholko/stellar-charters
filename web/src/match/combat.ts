/**
 * Galaxy-wide combat log (Sections 13–16, 23).
 *
 * Flattens every turn report's military events — raids, sabotage, invasions, wars,
 * pacts — into one chronological feed. Combat events are public knowledge (the server
 * ships them to every seat); the fogged part is *attribution*: a deniable privateer
 * strike reads as "Suspected sponsor: X (60% evidence)", never certainty (Section 11).
 */
import type { PlayerView, RaidOutcome, TurnReport } from "@engine";
import { convoyName, resourceLabels } from "./format";

export type CombatTone = "good" | "bad" | "warn" | "info";

export interface CombatEntry {
  turn: number;
  kind: "raid" | "sabotage" | "invasion" | "war" | "pact";
  tone: CombatTone;
  title: string;
  body: string;
  /** The viewing charter is a party (attacker or defender). */
  involvesMe: boolean;
  /** Jump-to-map target. */
  link?: { kind: "route" | "system"; id: string };
}

/** Player-facing outcome phrasing (raiding.ts outcome bands). */
export const raidOutcomeLabel: Record<RaidOutcome, string> = {
  noContact: "found nothing",
  shadowed: "shadowed",
  harassed: "harassed — delayed a turn",
  damaged: "damaged",
  plundered: "plundered",
  destroyed: "DESTROYED",
  repelled: "repelled",
  ambushed: "ambushed",
};

/** Newest-first feed of every combat event across the whole match. */
export function buildCombatLog(reports: TurnReport[], view: PlayerView, me: string): CombatEntry[] {
  const corpName = (id: string) => view.corporations.find((c) => c.id === id)?.name ?? id;
  const sysName = (id: string) => view.galaxy.systems.get(id)?.name ?? id;
  const routeLabel = (rid: string) => {
    const r = view.galaxy.routes.get(rid);
    return r ? `${sysName(r.a)} ↔ ${sysName(r.b)}` : rid;
  };

  const out: CombatEntry[] = [];
  for (const report of reports) {
    for (const e of report.events) {
      switch (e.type) {
        case "raid": {
          // Attribution as intel (Section 11): open ship raids are certain; privateer
          // strikes carry an evidence level and stay suspicion.
          const attacker =
            e.sponsorEvidence >= 1
              ? corpName(e.attackerId)
              : e.attackerId === me
                ? `Your privateers (deniable — ${Math.round(e.sponsorEvidence * 100)}% evidence trail)`
                : `Suspected sponsor: ${corpName(e.attackerId)} (${Math.round(e.sponsorEvidence * 100)}% evidence)`;
          const math =
            `raid ${Math.round(e.attackStrength)} vs defense ${Math.round(e.defenseStrength)}` +
            (e.defenseStrength > 0 ? ` (escort ${Math.round(e.escort)} + local ${Math.round(e.localDefense)})` : "");
          const cargo =
            e.cargoPlundered || e.cargoDestroyed
              ? ` · ${e.cargoPlundered ? `${Math.round(e.cargoPlundered)} ${resourceLabels[e.resource]} taken` : ""}` +
                `${e.cargoPlundered && e.cargoDestroyed ? ", " : ""}` +
                `${e.cargoDestroyed ? `${Math.round(e.cargoDestroyed)} destroyed` : ""}`
              : "";
          const involvesMe = e.attackerId === me || e.defenderId === me;
          const raiderWon = e.outcome === "plundered" || e.outcome === "damaged" || e.outcome === "harassed";
          const tone: CombatTone = !involvesMe
            ? "info"
            : e.defenderId === me
              ? (raiderWon ? "bad" : "good")
              : (raiderWon ? "good" : e.outcome === "repelled" || e.outcome === "ambushed" ? "bad" : "info");
          out.push({
            turn: report.turn,
            kind: "raid",
            tone,
            involvesMe,
            title: `${convoyName(e.convoyId)} ${raidOutcomeLabel[e.outcome]}`,
            body: `${attacker} struck ${e.defenderId === me ? "your" : `${corpName(e.defenderId)}'s`} ${resourceLabels[e.resource]} convoy on ${routeLabel(e.routeId)} — ${math}${cargo}.`,
            link: { kind: "route", id: e.routeId },
          });
          break;
        }
        case "sabotage": {
          const involvesMe = e.attackerId === me || e.defenderId === me;
          out.push({
            turn: report.turn,
            kind: "sabotage",
            tone: !involvesMe ? "info" : (e.defenderId === me) === e.success ? "bad" : "good",
            involvesMe,
            title: e.success ? `Extractor sabotaged at ${sysName(e.systemId)}` : `Sabotage repelled at ${sysName(e.systemId)}`,
            body: `${e.attackerId === me ? "You" : corpName(e.attackerId)} ${e.success ? "knocked out" : "failed to reach"} ${e.defenderId === me ? "your" : `${corpName(e.defenderId)}'s`} ${resourceLabels[e.resource]} extractor${e.success ? " — offline for several turns" : ""}.`,
            link: { kind: "system", id: e.systemId },
          });
          break;
        }
        case "invasion": {
          const involvesMe = e.attackerId === me || e.defenderId === me;
          out.push({
            turn: report.turn,
            kind: "invasion",
            tone: !involvesMe ? "warn" : (e.attackerId === me) === e.captured ? "good" : "bad",
            involvesMe,
            title: e.captured ? `${sysName(e.systemId)} captured` : `Assault on ${sysName(e.systemId)} repelled`,
            body: `${e.attackerId === me ? "You" : corpName(e.attackerId)} ${e.captured ? "seized" : "failed to take"} ${sysName(e.systemId)} from ${e.defenderId === me ? "you" : corpName(e.defenderId)} — force ${Math.round(e.attackForce)} vs defense ${Math.round(e.defenseForce)}.`,
            link: { kind: "system", id: e.systemId },
          });
          break;
        }
        case "warDeclared":
          out.push({
            turn: report.turn,
            kind: "war",
            tone: e.aggressorId === me || e.defenderId === me ? "bad" : "warn",
            involvesMe: e.aggressorId === me || e.defenderId === me,
            title: "War declared",
            body: `${e.aggressorId === me ? "You" : corpName(e.aggressorId)} invaded ${e.defenderId === me ? "you" : corpName(e.defenderId)} — the aggressor is barred from the Exchange until ceasefire.`,
          });
          break;
        case "warEnded":
          out.push({
            turn: report.turn,
            kind: "war",
            tone: "info",
            involvesMe: e.aggressorId === me || e.defenderId === me,
            title: "Ceasefire",
            body: `The war between ${corpName(e.aggressorId)} and ${corpName(e.defenderId)} is over.`,
          });
          break;
        case "pactInvoked":
          out.push({
            turn: report.turn,
            kind: "pact",
            tone: e.aggressorId === me ? "bad" : "warn",
            involvesMe: e.protectorId === me || e.aggressorId === me || e.allyId === me,
            title: "Defensive pact invoked",
            body: `${e.protectorId === me ? "You" : corpName(e.protectorId)} join${e.protectorId === me ? "" : "s"} the war against ${e.aggressorId === me ? "you" : corpName(e.aggressorId)} to defend ${e.allyId === me ? "you" : corpName(e.allyId)}.`,
          });
          break;
      }
    }
  }
  return out.reverse(); // newest first
}

/** Headline totals for the campaign tally strip. */
export interface CombatTally {
  raidsOnMe: number;
  raidsByMe: number;
  cargoLostToRaids: number;
  cargoPlunderedByMe: number;
  invasions: number;
  systemsCaptured: number;
}

export function tallyCombat(reports: TurnReport[], me: string): CombatTally {
  const t: CombatTally = { raidsOnMe: 0, raidsByMe: 0, cargoLostToRaids: 0, cargoPlunderedByMe: 0, invasions: 0, systemsCaptured: 0 };
  for (const report of reports) {
    for (const e of report.events) {
      if (e.type === "raid") {
        if (e.defenderId === me) {
          t.raidsOnMe++;
          t.cargoLostToRaids += e.cargoLost;
        }
        if (e.attackerId === me) {
          t.raidsByMe++;
          t.cargoPlunderedByMe += e.cargoPlundered;
        }
      } else if (e.type === "invasion") {
        t.invasions++;
        if (e.captured) t.systemsCaptured++;
      }
    }
  }
  return t;
}
