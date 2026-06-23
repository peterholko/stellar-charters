import { useApp, store } from "../match/store";
import {
  RESEARCH_TREE,
  RESEARCH_DIVISIONS,
  canHostPopulation,
  canResearch,
  coloniesOf,
  lockedChoices,
  techById,
  systemBuildings,
  type ResearchTech,
  type PlayerView,
} from "@engine";
import { Panel, PanelTitle, Badge } from "../ui/primitives";
import { ArtSlot } from "../theme/ArtSlot";

/**
 * Research screen (Section 28): the six Divisions as a tree. Pick projects into a single ordered
 * queue (active first); RP from Research Labs + population pours into the active tech each turn. The
 * tree is costed so a focused charter finishes only ~2 divisions in the game — specialise, then
 * acquire / steal / conquer the rest.
 */
export function Research() {
  const { view, claimedSecrets } = useApp();
  if (!view) return null;
  const me = view.me;
  const completed = me.research.completed;
  const locked = lockedChoices(completed);

  // The working queue = a staged setResearch order if present, else the charter's committed queue.
  const stagedSet = store.state.staged.find((s) => s.order.kind === "setResearch");
  const queue: string[] = stagedSet && stagedSet.order.kind === "setResearch" ? stagedSet.order.queue : me.research.queue;

  const rpPerTurn = researchPerTurn(view);
  const activeId = queue[0];
  const active = activeId ? techById(activeId) : undefined;
  const invested = me.research.invested[activeId ?? ""] ?? 0;

  const setQueue = (next: string[]) => {
    for (const s of store.state.staged.filter((x) => x.order.kind === "setResearch")) store.unstage(s.id);
    store.stage({ kind: "setResearch", queue: next });
  };
  const toggle = (id: string) => {
    if (queue.includes(id)) setQueue(validate(queue.filter((q) => q !== id), completed));
    else setQueue(validate([...queue, id], completed));
  };

  return (
    <div className="research">
      <Panel className="research__bar">
        <PanelTitle icon="flask" eyebrow="R&D" title="Research" />
        <div className="research__status">
          <Badge tone="accent">{rpPerTurn} RP / turn</Badge>
          {active ? (
            <span className="research__active">
              Researching <strong>{active.name}</strong> — {Math.floor(invested)}/{active.rpCost} RP
              {rpPerTurn > 0 && <> · ~{Math.max(1, Math.ceil((active.rpCost - invested) / rpPerTurn))} turns</>}
            </span>
          ) : (
            <span className="research__active research__active--idle">No active project — pick techs below to queue them.</span>
          )}
          {rpPerTurn === 0 && <span className="research__hint">Build Research Labs on your colonies to generate RP.</span>}
        </div>
      </Panel>

      <div className="research__grid">
        {RESEARCH_DIVISIONS.map((div) => (
          <Panel key={div.id} className="division">
            <div className="division__head">
              <ArtSlot slot={`research-${div.id}`} className="division__icon" />
              <div className="division__headtext">
                <h3>{div.name}</h3>
                <span className="division__blurb">{div.blurb}</span>
              </div>
            </div>
            <div className="division__techs">
              {RESEARCH_TREE.filter((tk) => tk.division === div.id)
                // Feature-gated techs (review Section 13) are deferred from v1 — hidden, not teased.
                .filter((tk) => !(tk.id === "col-terraform" && !view.config.tuning.features.terraforming))
                .filter((tk) => !(tk.id === "acq-espionage" && !view.config.tuning.features.espionage))
                .sort((a, b) => a.tier - b.tier)
                .map((tk) => {
                  const qi = queue.indexOf(tk.id);
                  const claimedBy = tk.secret ? claimedSecrets[tk.id] : undefined;
                  const mineSecret = claimedBy && completed.includes(tk.id);
                  const state = completed.includes(tk.id) ? "done"
                    : claimedBy && !mineSecret ? "rivalsecret"
                    : qi === 0 ? "active"
                    : qi > 0 ? "queued"
                    : locked.has(tk.id) ? "locked"
                    : canResearch(tk, completed) ? "open"
                    : "blocked";
                  const clickable = state === "open" || state === "queued" || state === "active";
                  return <TechNode key={tk.id} tech={tk} state={state} queuePos={qi} claimedBy={claimedBy} onClick={() => (clickable ? toggle(tk.id) : undefined)} />;
                })}
            </div>
          </Panel>
        ))}
      </div>
    </div>
  );
}

function TechNode({ tech, state, queuePos, claimedBy, onClick }: { tech: ResearchTech; state: string; queuePos: number; claimedBy?: string; onClick: () => void }) {
  const tag =
    state === "done" ? <Badge tone="positive">Researched</Badge>
    : state === "rivalsecret" ? <Badge tone="negative">Claimed: {claimedBy}</Badge>
    : state === "active" ? <Badge tone="accent">Active</Badge>
    : state === "queued" ? <Badge tone="accent">#{queuePos + 1}</Badge>
    : state === "locked" ? <Badge tone="neutral">Locked — chose other</Badge>
    : state === "blocked" ? <Badge tone="neutral">Needs prereq</Badge>
    : <Badge tone="neutral">{tech.rpCost} RP</Badge>;
  const clickable = state === "open" || state === "queued" || state === "active";
  return (
    <button type="button" className={`tech tech--${state}${tech.secret ? " tech--secret" : ""}`} disabled={!clickable} onClick={onClick}>
      <div className="tech__top">
        {tech.secret && <ArtSlot slot={`secret-${tech.id}`} className="tech__emblem" />}
        <strong>{tech.name}</strong>{tag}
      </div>
      <p className="tech__desc">{tech.desc}</p>
      {tech.secret ? <span className="tech__secret">★ Secret project — galaxy-unique race</span>
        : tech.choiceGroup ? <span className="tech__choice">choose one in this branch</span> : null}
    </button>
  );
}

/** Keep only prereq-reachable, de-duped tech ids, treating earlier queued techs as "will complete". */
function validate(queue: string[], completed: string[]): string[] {
  const out: string[] = [];
  const willHave = [...completed];
  for (const id of queue) {
    const tk = techById(id);
    if (!tk || out.includes(id) || completed.includes(id)) continue;
    if (!tk.prereqs.every((p) => willHave.includes(p))) continue;
    out.push(id);
    willHave.push(id);
  }
  return out;
}

/** RP a charter makes per turn (labs + populated colonies) — mirrors the engine's resolveResearch. */
function researchPerTurn(view: PlayerView): number {
  const t = view.config.tuning;
  let rp = 0;
  for (const id of view.me.ownedSystemIds) {
    const s = view.galaxy.system(id);
    rp += systemBuildings(s).labs * t.labRpOutput;
    // One population per system (review Section 10): its stage drives the populace RP.
    if (coloniesOf(s).some((c) => canHostPopulation(c))) rp += t.researchPopBase[s.populationStage];
  }
  return rp;
}
