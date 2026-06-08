/**
 * DEV-ONLY visual harness (never bundled in production — gated by import.meta.env.DEV in main.tsx).
 * Renders the art-slot glyph fallbacks and the real Standings screen with mock data so visual
 * polish is verifiable without the auth/worker stack. Visit /preview on the dev server.
 */
import { artManifest } from "../theme/artManifest";
import { ArtSlot } from "../theme/ArtSlot";
import { store } from "../match/store";
import type { AppState } from "../match/store";
import type { GameOutcome, Standing } from "@engine";
import { Standings } from "../screens/Standings";

const slotsWithPrefix = (p: string) => Object.keys(artManifest).filter((k) => k.startsWith(p));

function GlyphRow({ title, prefix, cls }: { title: string; prefix: string; cls: string }) {
  return (
    <section style={{ marginBottom: "1.4rem" }}>
      <h3 style={{ font: "var(--font-display)", letterSpacing: "0.1em", textTransform: "uppercase", fontSize: "0.7rem", color: "var(--ink-dim)" }}>{title}</h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: "0.7rem" }}>
        {slotsWithPrefix(prefix).map((slot) => (
          <div key={slot} style={{ textAlign: "center" }}>
            <ArtSlot slot={slot} className={cls} />
            <div style={{ fontSize: "0.62rem", color: "var(--ink-faint)", marginTop: 4 }}>{slot}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function mockStanding(i: number, over: Partial<Standing>): Standing {
  return {
    corpId: `corp-${i}`, name: `Corporation ${i}`, rank: i + 1, score: 0, valuation: 0, prestige: 0,
    systems: 0, techs: 0, secrets: 0, megastructures: 0, hasCharter: true, path: "economic", ...over,
  };
}

const MOCK_OUTCOME: GameOutcome = {
  over: true,
  decisive: false,
  winnerId: "corp-2",
  victoryType: "technology",
  standings: [
    mockStanding(2, { rank: 1, name: "Helix Combine", score: 92140, valuation: 61140, prestige: 31000, systems: 6, techs: 11, secrets: 1, megastructures: 1, path: "technology" }),
    mockStanding(0, { rank: 2, name: "Vanguard Charter", score: 78320, valuation: 55320, prestige: 23000, systems: 7, techs: 6, secrets: 0, megastructures: 2, path: "wonder" }),
    mockStanding(5, { rank: 3, name: "Ironreach Syndicate", score: 64900, valuation: 31900, prestige: 33000, systems: 9, techs: 5, secrets: 0, megastructures: 0, path: "conquest" }),
    mockStanding(1, { rank: 4, name: "Meridian Trust", score: 52210, valuation: 47210, prestige: 5000, systems: 1, techs: 6, secrets: 0, megastructures: 0, path: "economic" }),
    mockStanding(7, { rank: 5, name: "Pale Star Ltd", score: 18400, valuation: 12400, prestige: 6000, systems: 2, techs: 4, secrets: 0, megastructures: 0, hasCharter: false, path: "economic" }),
  ],
};

export function PreviewGallery() {
  // Seed the store so the real Standings component reads mock data (no fetch / no auth).
  store.state = {
    ...store.state,
    status: "ready", phase: "over", turn: 42, totalTurns: 42, humanCorpId: "corp-0", outcome: MOCK_OUTCOME,
  } as AppState;

  return (
    <div style={{ padding: "1.5rem", maxWidth: 1100, margin: "0 auto" }}>
      <h1 style={{ fontSize: "1.3rem", color: "var(--accent)" }}>Art-slot glyph gallery <span style={{ fontSize: "0.7rem", color: "var(--ink-faint)" }}>· dev preview · /preview</span></h1>
      <p style={{ fontSize: "0.75rem", color: "var(--ink-dim)" }}>Procedural fallbacks shown because the PNGs aren't generated yet — a real <code>/assets/&lt;slot&gt;.png</code> overrides each.</p>
      <GlyphRow title="Colony buildings" prefix="building-" cls="colony-art" />
      <GlyphRow title="Research divisions" prefix="research-" cls="division__icon" />
      <GlyphRow title="Secret projects" prefix="secret-" cls="tech__emblem" />
      <hr style={{ border: 0, borderTop: "1px solid var(--line)", margin: "1.6rem 0" }} />
      <h1 style={{ fontSize: "1.3rem", color: "var(--accent)" }}>Standings screen (end-game, mock)</h1>
      <Standings />
    </div>
  );
}
