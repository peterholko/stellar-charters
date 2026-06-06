# Star System Resource Model — Design Exploration

**Status:** ✅ **Implemented** (all phases A → B → C). Engine, bots, client/fog, and web UI
ship the body-driven economy; 55 tests pass (incl. determinism + the new `tests/bodies.test.ts`),
and engine/web/worker all typecheck. Remaining work is iterative balance tuning (see
*Balance notes* below). Companion to
[`STAR_SYSTEM_EXPANSION_PLAN.md`](./STAR_SYSTEM_EXPANSION_PLAN.md) (the "bodies" substrate);
this document **supersedes that plan's §6 (economic coupling)** and goes much further:
it proposes **completely replacing the flat `yields` stat** with a body-driven resource
economy, and explores several new game mechanics that ride on it.

The goal is to make a star system something you *read, prospect, and develop* — a little
puzzle of stars, planets, and belts — rather than a single number the engine multiplies once
per turn.

---

## 1. What `yields` is today, and why it's shallow

A system's entire economic identity is one field:

```ts
// types.ts
yields: Stockpile;   // a flat per-resource extraction vector, e.g. { metals: 14, ice: 2 }
```

It is consumed in exactly a few places — small blast radius, which is what makes a replacement
tractable:

| Consumer | Location | What it does with `yields` |
|---|---|---|
| **Production** | [`engine.ts:539`](src/engine/engine.ts) | `sys.stockpile[r] += sys.yields[r] * efficiency` — one multiply, every owned system, every turn |
| **Valuation** | [`engine.ts:1027`](src/engine/engine.ts) | `sumYields × perSystemYieldValue` |
| **Bot value/expansion** | [`strategy.ts`](src/engine/bots/strategy.ts) `valueSystem`, `grossYieldValue`, `maybeExpand` | price the yield vector to rank systems |
| **Bot chain placement** | `systemCanFeed` | `sys.yields[raw] > 0` gates where a Processor can sit |
| **Bot food/defense** | `maybeBuildHydroponics`, `maybeBuildPlatforms`, `maybeBuildWarships` | `yields.food`, `yields.rareIsotopes > 0` |
| **UI identity** | [`format.ts`](web/src/match/format.ts) `dominantResource` / `systemArchetype` / `sumYields` | the map glyph, archetype label, yield pills |
| **Generation** | [`procedural.ts`](src/engine/procedural.ts) `CORE_PROFILES`, frontier/abyss yields | hand-tuned vectors per region |

Weaknesses this creates:

1. **No spatial texture inside a system.** A "metals 14" world and the *idea* of an asteroid
   belt, a rocky inner planet, and a gas giant are completely disconnected — bodies (from the
   companion plan) would be pure cosmetics.
2. **Extraction is free and automatic.** Owning a system is the only decision; there's nothing
   to *develop*, optimise, or deplete. The mid-game has no "what do I build on this world" loop
   beyond processors/upgrades that are system-global, not body-specific.
3. **No frontier pressure from resources.** Deposits never run dry, so there's no economic
   reason to keep expanding outward except claiming more flat vectors.
4. **Star/planet types can't matter mechanically** without a substrate for them to feed.

> **Key enabler:** the repo ships a **headless balance simulator** (`npm run sim -- --games
> 200 --players 8`) that runs full 42-turn all-bot matches and writes CSV summaries. Any
> resource-model change can be swept for balance *before* it touches the UI. This is the safety
> net that makes a deep rewrite realistic — every option below is "tune against the sweep".

---

## 2. The core idea: **deposits on bodies**

Replace the flat vector with **extraction sites attached to bodies**. A system's per-turn
output becomes the sum of its *worked* deposits, not a constant.

```ts
/** A single extractable resource concentration on one body. */
export interface Deposit {
  resource: Resource;
  /** Units/turn at full extraction with a maxed extractor. */
  richness: number;
  /** Remaining reserves; null = renewable (never depletes). Finite deposits run dry. */
  reserves: number | null;
  /** 0..1 difficulty — gates the extractor tier/tech needed to work it (deep = harder). */
  accessibility: number;
}

// Deposits hang off the bodies introduced in STAR_SYSTEM_EXPANSION_PLAN.md:
export interface Planet      { /* type, orbit, habitable, visualSeed */ deposits: Deposit[]; }
export interface AsteroidBelt{ /* orbit */                              deposits: Deposit[]; }
export interface SystemBodies{ starType: StarType; planets: Planet[]; asteroidBelts: AsteroidBelt[];
  /** Exotic harvest from the star itself (neutron/white-dwarf only). */ starDeposits?: Deposit[]; }
```

**Generation derives deposits from star + planet type** — this is what makes the bodies *be*
the economy. Replaces `CORE_PROFILES` and the frontier/abyss yield literals:

| Body | Typical deposits |
|---|---|
| rocky / barren planet | `metals`, `silicates` (finite ore) |
| lava planet | `metals`, `rareIsotopes` (volcanic, finite) |
| ocean / garden world | `food` (renewable), `ice` |
| ice giant | `ice`, `helium3` (large, renewable-ish) |
| gas giant | `helium3` (renewable skim) |
| asteroid belt | `metals`, `silicates`, sometimes `rareIsotopes` (rich, finite) |
| neutron star (`starDeposits`) | `rareIsotopes`, `antimatter` — exotic, capital-tech gated |
| white dwarf (`starDeposits`) | dense `metals` / `rareIsotopes` |

The dominant resource of a system *emerges* from its bodies, so `systemArchetype()` keeps
working (now justified by real geology), and richer systems naturally have more, deeper
deposits.

### The compatibility linchpin — flat yields become a degenerate deposit

The single most important design move for feasibility: **keep `yields` as an authoring
shortcut that lowers into deposits**, so nothing downstream has to change at once.

```ts
// In loadScenario / Galaxy construction: a ScenarioSystem that still authors `yields: {metals:14}`
// becomes one always-on, renewable, fully-accessible deposit per resource.
// Every existing test map, legacy JSON, and the simple authored scenarios keep working verbatim.

// And a single read-model shim that ALL current consumers switch to:
export function effectiveYields(sys: System): Stockpile;   // sum of worked deposits this turn
```

- `engine.ts:539` production calls `effectiveYields(sys)` instead of `sys.yields`.
- Valuation, the four bot helpers, and `sumYields`/`dominantResource` call the shim.
- **Result:** in the degenerate case (all deposits always-on, infinite reserves) the game is
  *byte-for-byte the current game*. Depth is added by generation choosing richer deposit sets
  and by Phase 2+ mechanics gating extraction. This lets us land the substrate with the balance
  sweep showing **zero drift**, then turn on depth incrementally.

---

## 3. Three ambition levels (the options you asked me to explore)

### Option A — **Bodies set the yield, extraction stays automatic** *(small–medium, low risk)*

Generation emits deposits from body composition; `effectiveYields` sums *all* of them
automatically (no per-body building, no depletion). This is the minimal replacement of
`CORE_PROFILES`: the map gains geological justification and richer/varied output, but the
"own it → it produces" loop is unchanged.

- **Pros:** small blast radius, balance-neutral if richness is tuned to match today's vectors,
  immediately unlocks the bodies UI from the companion plan.
- **Cons:** no new *decisions* yet — it's a data-model upgrade, not a mechanic.
- **Verdict:** ship this first as the substrate. It's the safe floor.

### Option B — **Extractors: you develop each body** *(large — the recommended target)*

Output comes only from **deposits you've built an extractor on**. Claiming a system grants
*potential*; you invest per-body to realise it.

- New order `buildExtractor { systemId, bodyKey, resource }`; runtime `ExtractionSite` carries
  `extractorLevel` (0 = unworked) and mutable `reservesRemaining`.
- `effectiveYields` sums `richness × f(extractorLevel) × accessibilityFactor` over worked sites.
- **Reframes today's system modules as extractor types** rather than bolting on a parallel
  system: Mining Rigs → ore extractor on rocky/belt bodies; Hydroponics → food extractor (and
  the *only* food source on non-garden worlds); gas skimmer → helium3 on giants. The
  Processor/Reactor chain ([engine.ts:560](src/engine/engine.ts)) sits unchanged on top,
  consuming the raws the extractors now produce.
- **Emergent depth:** a rich system is a multi-turn build-out; "tall" development of one
  resource-dense world competes with "wide" claiming; each extractor is **capital that can be
  raided/sabotaged** (a natural new raid surface — see §4).
- **Pros:** turns every owned system into an optimisation puzzle; gives mid-game its missing
  build loop; star/planet variety finally drives strategy.
- **Cons:** largest engine + bot + UI change; needs a fresh balance pass; new order plumbing
  through client/server.
- **Verdict:** the destination. Build it on Option A's substrate.

### Option C — **Full lifecycle: prospect → develop → deplete → move on** *(large+, phased)*

Option B plus the time dimension: **depletion**, **prospecting fog**, **accessibility/tech
gates**, and optional **stellar dynamics**. This is where the "completely new game mechanic"
lives — see the menu in §4. Delivered as independent increments on top of B.

**Recommended path:** **A → B → C**, each gated on a green balance sweep. A is a refactor with
no balance risk; B is the headline mechanic; C is a menu you draw from.

---

## 4. New-mechanics menu (pick a subset for Option C)

Each is independent and rides on the deposit/extractor substrate. Listed with what it adds and
rough scope.

1. **Depletion & deposit lifecycle (boom/bust)** — *Medium.* Finite deposits (`reserves`)
   draw down as mined; richness can follow a ramp→plateau→decline curve as an extractor matures.
   Renewable deposits (gas skim, ocean food) sustain. **Effect:** ore/exotic worlds are
   boom-bust income; bio/gas worlds are annuities; the galaxy *pushes you outward* as the inner
   ring exhausts — the 4X expansion engine the economy currently lacks. Deterministic and
   replay-safe (state lives on the runtime `System`, reconstructed by event replay).

2. **Prospecting / assay (information warfare)** — *Medium.* A claimed body shows only a coarse
   hint (`"metals: rich?"`) until you spend an `assay` order; true `richness`/`reserves` stay
   hidden, and rivals see even less under fog of war. **Effect:** scouting, speculation on
   unprospected systems, bluffing, and a reason to claim before you fully know — strong fit for
   the corporate-intrigue theme. Reuses the mental model of the existing route `survey`.

3. **Accessibility & extraction tech gates** — *Medium.* `accessibility` gates which extractor
   tier a deposit needs; the richest/deepest deposits (abyss antimatter, deep belts) demand a
   new **extraction-tech ladder** (parallel to the existing Range ladder). **Effect:** another
   tech investment axis; controlling deep deposits is a capital commitment, reinforcing the
   antimatter-monopoly design.

4. **Habitability → population coupling** — *Medium.* Population can only grow where there's a
   habitable body (ocean/garden) or imported life-support; white-dwarf/neutron systems become
   pure **industrial** worlds (no native pop/tax, pure extraction). **Effect:** star/planet type
   finally drives the *population/tax* economy ([engine.ts:917](src/engine/engine.ts)), not just
   raws — garden worlds become tax engines, dead stars become mines. Hydroponics becomes the way
   to force population onto a hostile world.

5. **Stellar & orbital dynamics (time-varying output)** — *Medium, flashy.* Seed-driven,
   deterministic per-turn events: a red giant's habitable zone drifts outward over the match
   (ocean worlds eventually scorch → food declines); neutron stars pulse (periodic rareIsotope
   spikes); flare stars periodically knock extractors offline. **Effect:** systems have a
   trajectory, not a constant; rewards reading the star.

6. **Extraction sabotage raids** — *Medium.* Extends raiding ([engine.ts:755](src/engine/engine.ts))
   from convoys to **extractors**: a raid can knock a body's extractor offline for N turns.
   **Effect:** economic warfare reaches the planet surface, not just the warp lanes; defended
   systems matter more.

**Recommended Option-C subset for the first deep pass:** **(1) depletion + (4)
habitability coupling + (2) prospecting.** Together they convert the static map into a living
frontier (deplete → expand), make star/planet types matter on *both* the raw and population
economies, and add information depth — without the extra tech-ladder and combat surfaces of
(3)/(6), which can follow.

---

## 5. Ripple effects & required changes (for Option B, the target)

| Area | File(s) | Change | Scope |
|---|---|---|---|
| Data model | [`types.ts`](src/engine/types.ts) | `Deposit`, `ExtractionSite`; `System.bodies` (static) + runtime sites with `extractorLevel`/`reservesRemaining`; **keep `yields?` as optional authoring shortcut** | Medium |
| Loader/compat | [`config.ts`](src/engine/config.ts), [`galaxy.ts`](src/engine/galaxy.ts) | lower `ScenarioSystem.yields` → always-on deposits; expand `bodies` → runtime sites; add `effectiveYields(sys)` | Medium |
| Generation | [`procedural.ts`](src/engine/procedural.ts) | replace `CORE_PROFILES`/frontier/abyss literals with **deposit generation from star+planet type**; use the decorrelated body-RNG (companion plan §2.1) so existing layout is untouched | Medium–Large |
| Production | [`engine.ts:531`](src/engine/engine.ts) `resolveProduction` | sum worked sites via `effectiveYields`; (Phase C) deplete reserves, apply extractor maturity | Medium |
| Valuation | [`engine.ts:1012`](src/engine/engine.ts) | value by worked-deposit richness × remaining-reserve fraction + extractor capital, replacing `sumYields × perSystemYieldValue` | Small–Medium |
| New order | [`types.ts`](src/engine/types.ts) Orders, `resolveAdministrative` | `buildExtractor` (and Phase C `assay`); cost/alloy bill like other builds | Medium |
| Bots | [`strategy.ts`](src/engine/bots/strategy.ts) | `valueSystem`/`grossYieldValue`/`systemCanFeed`/hydro/platform/warship switch to `effectiveYields`; **add `maybeBuildExtractor`** (work the richest unworked deposit) | Medium |
| Client state | [`clientState.ts`](src/engine/clientState.ts) | carry per-body deposits + site state (fogged: rivals' richness/reserves redacted; unprospected = hint only) | Medium |
| Client rebuild | [`clientView.ts`](web/src/match/clientView.ts) | thread bodies/sites through `scenarioFromState` | Small |
| UI | [`Inspector.tsx`](web/src/components/Inspector.tsx), [`Systems.tsx`](web/src/screens/Systems.tsx), [`format.ts`](web/src/match/format.ts), [`PixiGalaxyMap.tsx`](web/src/components/PixiGalaxyMap.tsx) | per-body deposit list + extractor build buttons + reserve/depletion bars; archetype from deposits; map glyph by star type | Medium–Large |
| Tests | `tests/*.ts` | existing maps author `yields` → still valid via the shortcut; add deposit/extractor/depletion + determinism invariants; re-run `npm run sim` and retune `DEFAULT_TUNING` | Medium |

**Server/persistence:** no schema change. Persistence stays `(seed, players, orders)`; deposits
regenerate deterministically from seed, and depletion/extractor state is rebuilt by replaying
orders through the engine — the event-sourcing model already guarantees this.

---

## 6. Risks & dependencies

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | **Balance upheaval** — replacing the yield engine shifts the whole economy. | **High** | The headless sweep is built for exactly this. Land Option A as a *no-op* (deposits tuned to match current vectors; sweep shows zero drift), then turn on B/C increments one at a time, retuning `DEFAULT_TUNING` against the sweep each step. |
| R2 | **Bot regression** — heuristics read `sys.yields` in 6 spots; extractors add a decision they don't make. | High | `effectiveYields` shim keeps all 6 working unchanged; add one `maybeBuildExtractor` heuristic. Verify bots still build viable economies via `--games 1 --verbose`. |
| R3 | **Determinism / replay** — depletion & extractor state must replay identically; generation must not perturb layout. | High | All randomness via seeded `Rng`; generate deposits on the **decorrelated body-RNG** (companion plan §2.1) so positions/routes/names are untouched; mutable state lives on runtime `System` and is rebuilt by order replay. `tests/determinism.test.ts` guards. |
| R4 | **Test churn** — every test/legacy map authors `yields`. | Medium | The `yields → deposit` shortcut means **zero churn** for existing maps; new tests are additive. |
| R5 | **ClientState payload growth** — per-body deposit arrays in every poll. | Low–Medium | Deposits are static per seed; send `bodies` once / or send only IDs + reserve deltas. Fog-redact rivals. Revisit if poll size grows. |
| R6 | **Scope creep across A/B/C.** | Medium | Hard phase gates on the balance sweep; C is an explicit menu (§4), not a blob. |

**Dependency:** this builds directly on the **bodies substrate** in
[`STAR_SYSTEM_EXPANSION_PLAN.md`](./STAR_SYSTEM_EXPANSION_PLAN.md) — that plan should be
implemented first (or merged into this one), since deposits attach to its `Planet` /
`AsteroidBelt` / `starType` structures.

---

## 7. Scope summary

| Phase | Mechanic | Scope | Balance risk |
|---|---|---|---|
| Substrate | Bodies + star/planet/belt generation (companion plan) | Medium | None (cosmetic) |
| **A** | Deposits drive yields, extraction automatic; `effectiveYields` shim | **Small–Medium** | **None if tuned to match** |
| **B** | Per-body **extractors** (build to work a deposit); reframe Mining Rigs/Hydroponics as extractor types; `buildExtractor` order + bot heuristic | **Large** | High → sweep-gated |
| **C1** | Depletion / deposit lifecycle | Medium | Medium |
| **C2** | Habitability → population coupling | Medium | Medium |
| **C3** | Prospecting / assay (info warfare) | Medium | Low |
| **C4** | Extraction tech gates / sabotage raids / stellar dynamics | Medium each | Medium |

---

## 8. Decisions (locked)

| Fork | Decision |
|---|---|
| Target ambition | **A → B → C (full)** — deposits + per-body extractors + the depth menu |
| Extraction model | **Per-body extractors are a real decision** (Option B) |
| Depletion | **Yes — boom/bust** (finite ore/exotic; renewable bio/gas) |
| Depth mechanics | **All four:** prospecting/assay fog · habitability → population · extraction sabotage raids · stellar dynamics |

These drive the concrete roadmap in §9.

---

## 9. Concrete implementation roadmap

Eight sequenced phases. **Every phase ends with a balance checkpoint** — `npm run sim --
--games 200 --players 8 --turns 42` plus a `--games 1 --seed 0 --verbose` "is it fun" read —
and `DEFAULT_TUNING` is retuned before the next phase starts. Phases are independently
shippable; stop after any of them and the game is coherent.

### Phase 0 — Bodies substrate *(prerequisite)*

Implement [`STAR_SYSTEM_EXPANSION_PLAN.md`](./STAR_SYSTEM_EXPANSION_PLAN.md): `starType`,
`Planet[]`, `AsteroidBelt[]` generated on the **decorrelated body-RNG** so layout is untouched.
No economy change yet. *Checkpoint: determinism + web build green.*

### Phase A — Deposits drive yields (balance-neutral)

- **`types.ts`**: add `Deposit` (`resource, richness, reserves: number|null, accessibility`);
  attach `deposits: Deposit[]` to `Planet`/`AsteroidBelt` + optional `starDeposits`. Add the
  runtime `ExtractionSite` (`bodyKey, resource, richness, reserves, extractorLevel,
  prospected, disabledUntil`) on `System`; keep `yields?` as an **optional authoring shortcut**.
- **`config.ts` / `galaxy.ts`**: lower `ScenarioSystem.yields` → one always-on, infinite,
  fully-accessible deposit per resource; expand `bodies` → runtime `ExtractionSite[]`. Add
  **`effectiveYields(sys): Stockpile`** (sum of worked sites) — exported from `index.ts`.
- **`procedural.ts`**: replace `CORE_PROFILES` + frontier/abyss literals with a
  **deposit-from-body-type table** (§2). Preserve the existing per-region invariants
  (`tests/procedural.test.ts`): every basic raw still present somewhere in the core; frontier
  carries `rareIsotopes`, abyss `antimatter`; **inner-ring start systems guaranteed at least
  one workable raw**.
- **Switch all `sys.yields` readers to `effectiveYields`**: `engine.ts:539` (production),
  `engine.ts:1027` (valuation), and the six bot helpers in `strategy.ts`; `sumYields` /
  `dominantResource` in `format.ts`.
- **In Phase A, `extractorLevel` starts maxed and reserves are infinite**, so output equals
  today's vectors. *Checkpoint: sweep shows ~zero drift vs. current `main`.*

### Phase B — Extractors (the headline mechanic)

- **New order `buildExtractor { systemId, bodyKey, resource }`** in `types.ts`; handle it in
  `resolveAdministrative` (step 1.5) with a credit + alloy bill like other builds; raises that
  site's `extractorLevel` (0 = unworked).
- **`effectiveYields`** now sums only worked sites: `richness × maturity(extractorLevel)`.
  Unworked deposits produce nothing — claiming grants potential, not output.
- **Reframe existing modules as extractor types** rather than parallels: Mining Rigs → ore
  extractor (rocky/belt); Hydroponics → food extractor (and the only food source on non-garden
  worlds); add a gas skimmer (helium3 on giants). Migrate their build orders/costs into the
  extractor framework; the Processor/Reactor chain ([engine.ts:560](src/engine/engine.ts))
  rides unchanged on top.
- **Valuation**: value worked-deposit richness + extractor capital (replaces
  `sumYields × perSystemYieldValue`).
- **Bots**: add `maybeBuildExtractor` (work the highest-value unworked deposit affordable each
  turn); keep all other heuristics on `effectiveYields`.
- **Client/UI**: `ClientSystem` carries sites; `Inspector` gets a per-body deposit list with
  **build-extractor** buttons; `Systems` cards show worked/total deposits. *Checkpoint: bots
  build viable economies; retune extractor costs/curve.*

### Phase C1 — Depletion (boom/bust)

- Production decrements `reserves` by amount extracted; richness can follow a
  ramp→plateau→decline curve as a site matures. Renewable deposits (`reserves: null`) sustain.
- Valuation discounts by remaining-reserve fraction (a near-dry rich world is worth less).
- Bots: prefer fresh/renewable deposits; abandon dry ones. *Checkpoint: confirm the inner ring
  exhausts and expansion outward actually happens over 42 turns.*

### Phase C2 — Habitability → population

- Add `systemHabitability(sys)` (has an ocean/garden body, or hydroponics/life-support).
- In `resolvePopulationAndUpkeep` ([engine.ts:917](src/engine/engine.ts)): population grows
  only where habitable; white-dwarf/neutron systems become pure **industrial** (no native
  pop/tax) unless forced via hydroponics.
- **Generation guard:** inner-ring start systems must be habitable (or auto-seed a habitable
  body) so no corp starts stranded on a dead world. *Checkpoint: garden worlds read as tax
  engines, dead stars as mines; starts remain viable.*

### Phase C3 — Prospecting / assay fog

- **New order `assay { systemId, bodyKey }`** (cheap, owner-only); flips the site's
  `prospected` flag. Before assay the owner sees only a coarse hint; rivals always see hints.
- **Fog**: `buildClientState` redacts exact `richness`/`reserves` for unprospected sites and
  for all rival systems (hint band only).
- Bots: `maybeAssay` on freshly-claimed systems before committing extractor capital.
  *Checkpoint: claiming-before-knowing creates real speculation; bots don't over-invest blind.*

### Phase C4 — Extraction sabotage raids

- **New order `sabotage { systemId, bodyKey }`** resolved in the raids phase
  ([engine.ts:755](src/engine/engine.ts)); needs a raider/privateer in range of the system,
  reuses `canRaidRoute`-style eligibility against the system's tunnel mouths and is reduced by
  local defense (platforms/ships/depot). Success sets the site's `disabledUntil = turn + N`.
- Production skips disabled sites. Bots (raider/free-operator) add sabotage to `planRaid`;
  defenders already build platforms/warships. *Checkpoint: economic warfare reaches the surface
  without making owned systems un-defendable.*

### Phase C5 — Stellar dynamics

- A deterministic per-turn modifier per system derived from `(bodySeed, turn)` (replayable and
  **forecastable** to the player): red-giant habitable-zone drift slowly scorches ocean worlds
  (food declines mid-match); neutron-star pulses give periodic rareIsotope spikes; flare stars
  periodically knock extractors offline.
- Applied in production before extraction; surfaced in the Inspector as a forecast. *Checkpoint:
  systems have a trajectory; no single event is swingy enough to be un-counterable.*

### Cross-cutting

- **Determinism:** all new randomness via seeded `Rng`; deposits on the decorrelated body-RNG;
  mutable site state (reserves, extractorLevel, prospected, disabledUntil) lives on the runtime
  `System` and is rebuilt by **order replay** — no persistence/schema change
  (`(seed, players, orders)` still suffices).
- **New orders** (`buildExtractor`, `assay`, `sabotage`) must thread through the
  client→server order plumbing and `HumanBot`.
- **Tests:** per-phase invariants (deposit generation, extractor gating, depletion curve,
  habitability, fog redaction, sabotage eligibility, stellar determinism) + keep
  `tests/determinism.test.ts` and `tests/procedural.test.ts` green (update the region→yield
  assertions to region→deposit).

When you're ready to build, I'd start with **Phase 0 + Phase A as one PR** (substrate +
balance-neutral deposit refactor behind the `effectiveYields` shim) — it's the lowest-risk,
highest-leverage step and everything else builds on it.

---

## 10. Implementation notes (as built)

**Where it lives:**
- [`bodies.ts`](src/engine/bodies.ts) — new module: deposit/star/planet generation, site
  construction (`sitesFromBodies` / `sitesFromYields`), `effectiveYields` / `potentialYields`,
  stellar dynamics, habitability, labels.
- [`types.ts`](src/engine/types.ts) — `StarType` / `PlanetType` / `Deposit` / `Planet` /
  `AsteroidBelt` / `SystemBodies` / `ExtractionSite`; orders `buildExtractor` / `assay` / `sabotage`.
- [`engine.ts`](src/engine/engine.ts) — production by worked sites + depletion + stellar;
  valuation by extraction + extractor capital; `buildExtractor`/`assay` in admin, `sabotage` in
  raids; habitability gate in population; `ensureStartHabitable` + `grantStarterExtractor` on
  charter assignment/claim.
- [`procedural.ts`](src/engine/procedural.ts) — bodies generated on a decorrelated `bodyRng`
  after layout (positions/routes unchanged). Legacy `yields` maps keep working via the shortcut.
- Client: [`clientState.ts`](src/engine/clientState.ts) `ClientSite` + fog;
  [`clientView.ts`](web/src/match/clientView.ts) overlays server sites.
- Bots: [`strategy.ts`](src/engine/bots/strategy.ts) `maybeBuildExtractor` / `maybeSabotage`,
  all yield reads via `effectiveYields`/`potentialYields`.
- UI: [`Inspector.tsx`](web/src/components/Inspector.tsx) per-body composition + Work/Deepen/
  Assay/Sabotage; [`Systems.tsx`](web/src/screens/Systems.tsx) worked/total + star;
  [`format.ts`](web/src/match/format.ts) star/planet labels; map fill via `systemDominant`.

**Two load-bearing choices that kept it tractable:** (1) flat `yields` lower into fully-worked
sites (`extractorLevel = cap`), so legacy maps and every existing test reproduce their old output
exactly; (2) all mutable site state lives on the runtime `System` and rebuilds by order replay —
no DB/schema change.

## 11. Balance notes (open tuning, not correctness)

The legacy committed scenarios (`scenarios/inner-ring-*.json`) exercise the **degenerate path**
(fully-worked sites) and sweep ~identically to before — confirming Phase A neutrality. The
**body/extractor model** (procedural maps, the live-game format) was swept separately and is
viable end-to-end (extractors build, deposits deplete, sabotage/assay/stellar fire, all systems
function). Two risk flags remain, both **pre-existing in the legacy baseline** and amplified by
the richer/larger procedural map — they are demand-/consolidation-side tuning, not model bugs:

- **Metals overproduction** (price floor in ~100% of games): *demand-bound* — trimming metals
  supply 40% didn't move it. Fix is demand-side (alloys recipe economics / price floor / a metals
  sink), independent of the body model.
- **Run-away leader** (leader/median ~50× on the big procedural map vs ~20× on the small legacy
  one): driven by the acquisition/consolidation layer on a rich shared galaxy. Levers to explore:
  scarcer high-value deposits, faster depletion of the richest sites, softer population valuation,
  or pacing the financier/acquisition layer.

Tuning already applied: trimmed metals deposit prevalence/richness; `extractorValue` 120→70;
habitability made naturally scarce (ocean spawn 0.4 in-zone) with a guaranteed **home** habitat
dome for fairness; top-end population valuation compressed (city 4000→3200, metropolis
10000→6500), which cut the *legacy* runaway from ~20× to ~16×.

**Sweep the real model:** `npm run sim -- --games 30 --players 8 --procedural` now generates a
fresh body-driven galaxy per game (vs. the committed flat-yield maps), so balance regressions in
the extractor/depletion economy are measurable directly.

**On the runaway flag:** investigation shows it is largely a *metric artifact* of the
consolidation design — with ~4.7 acquisitions/game across 8 corps, most rivals end as absorbed
Free Operators near zero valuation, so the **median** is a hollowed-out corp and leader/median
inflates. The valuation Gini (~0.68) is high but expected for a winner-take-all acquisition game.
Meaningfully lowering it means re-pacing the Section 17–18 takeover layer — a separate initiative,
deliberately not done here so the intended end-game consolidation drama is preserved.
