import { useApp, store } from "../match/store";
import type { Standing, VictoryPath } from "@engine";
import { Panel, PanelTitle, Badge } from "../ui/primitives";
import { CorpCrest } from "../theme/art";
import { Icon } from "../ui/icons";
import { formatCr } from "../match/format";

/** Display label + blurb for each victory path (Section 29). */
export const VICTORY: Record<VictoryPath, { title: string; blurb: string; tone: "accent" | "positive" | "negative" | "warn" }> = {
  economic: { title: "Market Dominance", blurb: "the richest charter in the galaxy", tone: "positive" },
  conquest: { title: "Conquest", blurb: "the most chartered systems held by force", tone: "negative" },
  technology: { title: "Technological Ascendancy", blurb: "the deepest research and secret projects", tone: "accent" },
  wonder: { title: "Galactic Wonder", blurb: "the grandest megastructures ever raised", tone: "warn" },
  monopoly: { title: "Monopoly", blurb: "the last charter left standing", tone: "negative" },
};

/**
 * Standings (Section 29): the live victory scoreboard, available all game so the race always has a
 * read. Score = valuation + prestige (systems, techs, secret projects, megastructures). When the
 * game is over it leads with the winner and how they won.
 */
export function Standings() {
  const { outcome, humanCorpId, turn, totalTurns } = useApp();
  if (!outcome || outcome.standings.length === 0) {
    return (
      <div className="standings">
        <Panel><PanelTitle icon="trending" eyebrow="Victory" title="Standings" /><p className="standings__empty">No standings yet — play a turn.</p></Panel>
      </div>
    );
  }
  const { standings, over, winnerId, victoryType, decisive } = outcome;
  const winner = standings.find((s) => s.corpId === winnerId);
  const youWon = over && winnerId === humanCorpId;
  const maxScore = Math.max(1, ...standings.map((s) => s.score));

  return (
    <div className="standings">
      {over && winner && victoryType ? (
        <Panel className={`standings__result standings__result--${youWon ? "win" : "loss"}`}>
          <p className="standings__eyebrow">{decisive ? `Decided on turn ${turn} — ${VICTORY[victoryType].title}` : "Charter Mandate Concluded"}</p>
          <h1 className="standings__winner">{youWon ? "Victory" : `${winner.name} wins`}</h1>
          <p className="standings__blurb">
            <Badge tone={VICTORY[victoryType].tone}>{VICTORY[victoryType].title}</Badge> — {VICTORY[victoryType].blurb}.
          </p>
          <button type="button" className="primary-btn" onClick={() => store.newMatch()}>
            <Icon name="bolt" size={15} /> New match
          </button>
        </Panel>
      ) : (
        <Panel className="standings__bar">
          <PanelTitle icon="trending" eyebrow="Victory race" title="Standings" />
          <span className="standings__turn">Turn {turn} / {totalTurns} · score = valuation + prestige</span>
        </Panel>
      )}

      <Panel className="standings__board">
        <div className="standings__head">
          <span>#</span><span>Charter</span><span>Score</span><span>Valuation</span><span>Sys</span><span>Tech</span><span>Secret</span><span>Wonder</span><span>Path</span>
        </div>
        {standings.map((s) => (
          <Row key={s.corpId} s={s} you={s.corpId === humanCorpId} winner={over && s.corpId === winnerId} pct={Math.round((s.score / maxScore) * 100)} />
        ))}
      </Panel>

      <Panel className="standings__legend">
        <PanelTitle icon="info" eyebrow="How to win" title="Victory paths" />
        <ul>
          <li><strong>{VICTORY.economic.title}</strong> — outvalue every rival. The default crown.</li>
          <li><strong>{VICTORY.conquest.title}</strong> — hold the most chartered systems; take them by war.</li>
          <li><strong>{VICTORY.technology.title}</strong> — research deepest and claim a galaxy-unique secret project.</li>
          <li><strong>{VICTORY.wonder.title}</strong> — raise the most megastructures.</li>
          <li><strong>{VICTORY.monopoly.title}</strong> — outlast every rival charter and the game ends on the spot.</li>
        </ul>
      </Panel>
    </div>
  );
}

function Row({ s, you, winner, pct }: { s: Standing; you: boolean; winner: boolean; pct: number }) {
  return (
    <div className={`standings__row${you ? " is-me" : ""}${winner ? " is-winner" : ""}${s.hasCharter ? "" : " is-fallen"}`}>
      <span className="standings__rank">{winner ? "★" : s.rank}</span>
      <span className="standings__name"><CorpCrest corpId={s.corpId} size={20} /> <strong>{s.name}{you ? " (you)" : ""}</strong>{!s.hasCharter && <Badge tone="neutral">Free Operator</Badge>}</span>
      <span className="standings__score">
        <em>{s.score.toLocaleString()}</em>
        <span className="standings__scorebar"><span style={{ width: `${pct}%` }} /></span>
      </span>
      <span>{formatCr(s.valuation)}</span>
      <span>{s.systems}</span>
      <span>{s.techs}</span>
      <span>{s.secrets > 0 ? <Badge tone="accent">{s.secrets}</Badge> : "—"}</span>
      <span>{s.megastructures > 0 ? s.megastructures : "—"}</span>
      <span><Badge tone={VICTORY[s.path].tone}>{VICTORY[s.path].title.split(" ")[0]}</Badge></span>
    </div>
  );
}
