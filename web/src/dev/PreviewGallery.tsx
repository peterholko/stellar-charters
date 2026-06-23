/**
 * DEV-ONLY visual harness (never bundled in production — gated by import.meta.env.DEV in main.tsx).
 * Boots a real deterministic mini-game, builds a fog-of-war PlayerView the same way the worker does,
 * and renders the actual Research screen + a colony build card so the generated art can be polished
 * in true in-screen context (correct sizes, real data) without the auth/worker stack. Visit /preview.
 */
import { artManifest } from "../theme/artManifest";
import { ArtSlot } from "../theme/ArtSlot";
import { store, useApp } from "../match/store";
import type { AppState } from "../match/store";
import {
  Engine, RESOURCES, loadScenario, generateProceduralScenario, buildClientState, defaultRegistry, canHostPopulation, coloniesOf,
  type PlayerView, type ColonyInfo, type System, type GameOutcome, type TurnReport,
} from "@engine";
import { reconstructView } from "../match/clientView";
import { Combat } from "../screens/Combat";
import { Exchange } from "../screens/Exchange";
import { GalaxyMap } from "../screens/GalaxyMap";
import { Finance } from "../screens/Finance";
import { Ships } from "../screens/Ships";
import { Report } from "../screens/Report";
import { Research } from "../screens/Research";
import { Standings } from "../screens/Standings";
import { ColonyCard, colonyNames } from "../components/ColonyPanel";
import { Inspector } from "../components/Inspector";
import { SystemSummaryCard } from "../components/SystemSummaryCard";

/** Boot a deterministic game and advance it so there are labs, research, and developed colonies. */
function boot(): { view: PlayerView; claimedSecrets: Record<string, string>; outcome: GameOutcome; reports: TurnReport[] } | null {
  try {
    const eng = new Engine(loadScenario(generateProceduralScenario({ seed: 3, players: 8 })), 3, defaultRegistry());
    // Collect per-turn reports exactly like the worker does — the Report/Combat screens read them.
    const turnReports: TurnReport[] = [];
    for (let i = 0; i < 26; i++) turnReports.push(eng.stepTurn());
    // Show the seat that has developed the most (richest Research + colony screens).
    const seat = [...eng.corps].sort((a, b) => b.ownedSystemIds.length - a.ownedSystemIds.length)[0]!;
    const cs = buildClientState(eng, seat.id, "preview", turnReports);
    const wire = JSON.parse(JSON.stringify(cs)); // mimic the network round-trip
    return { view: reconstructView(wire), claimedSecrets: wire.claimedSecrets ?? {}, outcome: wire.outcome, reports: wire.reports ?? [] };
  } catch (e) {
    console.error("[preview] engine boot failed", e);
    return null;
  }
}

const BOOT = boot();

const slotsWithPrefix = (p: string) => Object.keys(artManifest).filter((k) => k.startsWith(p));

/** Store-subscribed Inspector so staged orders (queue removals, build gating) re-render live,
 *  exactly as in the real app shell. */
function LiveInspector({ systemId }: { systemId: string }) {
  const { view, humanCorpId } = useApp();
  if (!view) return null;
  return <Inspector view={view} humanCorpId={humanCorpId} selection={{ kind: "system", id: systemId }} />;
}

/** A compact contact strip of every slot in a category, at its real in-screen container size. */
function ArtStrip({ title, prefix, cls, wrap }: { title: string; prefix: string; cls: string; wrap?: (n: React.ReactNode, slot: string) => React.ReactNode }) {
  return (
    <section style={{ marginBottom: "1.2rem" }}>
      <h3 style={{ letterSpacing: "0.1em", textTransform: "uppercase", fontSize: "0.66rem", color: "var(--ink-dim)" }}>{title}</h3>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.8rem", alignItems: "flex-end" }}>
        {slotsWithPrefix(prefix).map((slot) => (
          <div key={slot} style={{ textAlign: "center" }}>
            {wrap ? wrap(<ArtSlot slot={slot} className={cls} />, slot) : <ArtSlot slot={slot} className={cls} />}
            <div style={{ fontSize: "0.58rem", color: "var(--ink-faint)", marginTop: 4 }}>{slot.replace(prefix, "")}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function PreviewGallery() {
  if (BOOT) {
    store.state = {
      ...store.state,
      status: "ready", phase: "play", turn: BOOT.view.turn, totalTurns: BOOT.view.config.turns,
      humanCorpId: BOOT.view.me.id, view: BOOT.view, outcome: BOOT.outcome,
      claimedSecrets: BOOT.claimedSecrets, staged: [], reports: BOOT.reports,
    } as AppState;
  }

  // A developed colony from the booted seat for the colony-card art-in-context.
  let colonyCard: React.ReactNode = null;
  if (BOOT) {
    const v = BOOT.view;
    for (const id of v.me.ownedSystemIds) {
      const sys: System = v.galaxy.system(id);
      const colonies = coloniesOf(sys);
      const populated = colonies.find((c: ColonyInfo) => canHostPopulation(c)) ?? colonies[0];
      if (populated) {
        const name = colonyNames(sys.name, colonies).get(populated.key) ?? sys.name;
        colonyCard = <ColonyCard colony={populated} name={name} sys={sys} view={v} canBuild />;
        break;
      }
    }
  }

  return (
    <div style={{ padding: "1.5rem", maxWidth: 1180, margin: "0 auto" }}>
      <h1 style={{ fontSize: "1.2rem", color: "var(--accent)" }}>Art in context <span style={{ fontSize: "0.68rem", color: "var(--ink-faint)" }}>· dev preview · /preview</span></h1>

      <ArtStrip title="Colony building art — build-menu size (.bopt__art)" prefix="building-" cls="bopt__art" />
      <ArtStrip title="Research division emblems (.division__icon)" prefix="research-" cls="division__icon" />
      <ArtStrip
        title="Secret-project medallions — tech-node size (.tech__emblem)"
        prefix="secret-"
        cls="tech__emblem"
        wrap={(n) => <span className="tech tech--secret" style={{ display: "inline-flex", padding: "0.4rem 0.6rem" }}><span className="tech__top">{n}<strong style={{ fontSize: "0.72rem" }}>Secret</strong></span></span>}
      />

      <hr style={{ border: 0, borderTop: "1px solid var(--line)", margin: "1.4rem 0" }} />
      {!BOOT && <p style={{ color: "var(--negative, #ff8a8a)" }}>Engine boot failed — see console.</p>}

      {colonyCard && (
        <>
          <h1 style={{ fontSize: "1.2rem", color: "var(--accent)" }}>Colony card (real game, real building art)</h1>
          <div style={{ maxWidth: 560 }}>{colonyCard}</div>
          <hr style={{ border: 0, borderTop: "1px solid var(--line)", margin: "1.4rem 0" }} />
        </>
      )}

      {BOOT && (
        <>
          {/* The owned system with the deepest stockpile — exercises the combined stock+production readout. */}
          <h1 style={{ fontSize: "1.2rem", color: "var(--accent)" }}>System inspector — owned system (real game)</h1>
          <div style={{ maxWidth: 360 }}>
            <LiveInspector
              systemId={[...BOOT.view.me.ownedSystemIds].sort((a, b) => {
                const stockSum = (id: string) => RESOURCES.reduce((t, r) => t + BOOT!.view.galaxy.system(id).stockpile[r], 0);
                return stockSum(b) - stockSum(a);
              })[0]!}
            />
          </div>
          <hr style={{ border: 0, borderTop: "1px solid var(--line)", margin: "1.4rem 0" }} />
          <h1 style={{ fontSize: "1.2rem", color: "var(--accent)" }}>Map summary card — owned system (real game)</h1>
          <div style={{ maxWidth: 360 }}>
            <SystemSummaryCard view={BOOT.view} humanCorpId={BOOT.view.me.id} systemId={BOOT.view.me.ownedSystemIds[0]!} />
          </div>
          <hr style={{ border: 0, borderTop: "1px solid var(--line)", margin: "1.4rem 0" }} />
          <h1 style={{ fontSize: "1.2rem", color: "var(--accent)" }}>Exchange screen (real game)</h1>
          <Exchange />
          <hr style={{ border: 0, borderTop: "1px solid var(--line)", margin: "1.4rem 0" }} />
          <h1 style={{ fontSize: "1.2rem", color: "var(--accent)" }}>Ships screen (real game)</h1>
          <Ships />
          <hr style={{ border: 0, borderTop: "1px solid var(--line)", margin: "1.4rem 0" }} />
          <h1 style={{ fontSize: "1.2rem", color: "var(--accent)" }}>Combat screen (real game)</h1>
          <Combat />
          <hr style={{ border: 0, borderTop: "1px solid var(--line)", margin: "1.4rem 0" }} />
          <h1 style={{ fontSize: "1.2rem", color: "var(--accent)" }}>Galaxy map (real game — try the Raid reach toggle)</h1>
          <div style={{ height: 520, display: "flex" }}><GalaxyMap /></div>
          <hr style={{ border: 0, borderTop: "1px solid var(--line)", margin: "1.4rem 0" }} />
          <h1 style={{ fontSize: "1.2rem", color: "var(--accent)" }}>Turn report (real game)</h1>
          <Report />
          <hr style={{ border: 0, borderTop: "1px solid var(--line)", margin: "1.4rem 0" }} />
          <h1 style={{ fontSize: "1.2rem", color: "var(--accent)" }}>Research screen (real game)</h1>
          <Research />
          <hr style={{ border: 0, borderTop: "1px solid var(--line)", margin: "1.4rem 0" }} />
          <h1 style={{ fontSize: "1.2rem", color: "var(--accent)" }}>Finance screen (real game)</h1>
          <Finance />
          <hr style={{ border: 0, borderTop: "1px solid var(--line)", margin: "1.4rem 0" }} />
        </>
      )}

      <h1 style={{ fontSize: "1.2rem", color: "var(--accent)" }}>Standings (live, real game)</h1>
      <Standings />
    </div>
  );
}
