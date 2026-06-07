# Planet Economy — Implementation Plan

**Status:** Phases 1–3 implemented (Section 24). Phase 1 (re-home buildings to per-body, balance-neutral),
Phase 2 (the colony management UI — `web/src/components/ColonyPanel.tsx`), and Phase 3 (planet-type
gating + farmland/industry affinities) are done, tested, and balance-swept. Phase 4a (build queue)
and Phase 4b (per-planet population) remain optional/deferred. Companion to
[`STAR_SYSTEM_RESOURCE_MODEL_DESIGN.md`](./STAR_SYSTEM_RESOURCE_MODEL_DESIGN.md) (Section 21,
which made systems body-driven) and the war/fleet layer (Section 23). This plan inverts the
economic unit: today the **system** owns the economy and planets are cosmetic; the goal is for
**planets and asteroid belts to be the first-class economic units** and the **system to be a
container** for its bodies, its star, and the fleets stationed there — building toward a Master of
Orion 2 "colony screen" where you click a planet and manage what's built on it.

---

## 1. Where the code is today (the starting point)

The economy lives entirely on [`System`](src/engine/types.ts):

- **Bodies exist but are thin.** `System.bodies` (`SystemBodies = { starType, planets: Planet[],
  asteroidBelts: AsteroidBelt[], starDeposits? }`) is the static, generated shape;
  `Planet = { type, orbit, habitable, visualSeed, deposits: Deposit[] }`;
  `Deposit = { resource, richness, reserves, accessibility }`. So **resources are already tied to
  bodies in the static model.**
- **But the runtime economy is flattened onto the system.** `System.sites: ExtractionSite[]` is a
  flat list (each site *does* carry `bodyKind/bodyType/orbit/extractorLevel`, so it remembers its
  body — the data is body-aware), and every other economic field is a system-level scalar:
  `stockpile`, `populationStage/Progress/unrest`, `hydroponics`, `processors`, `reactors`,
  `miningRigs`, `habitats`, `powerGrid`, `platforms`, `megastructures`, `hasDepot`, `defense`,
  `owner`.
- [`engine.ts`](src/engine/engine.ts) `resolveProduction` sums all sites into the one
  `sys.stockpile`; processors/reactors/power, population/food, and infrastructure all resolve at
  the system level. Build orders (`buildProcessor`, `buildReactor`, `buildExtractor`, …) target a
  `systemId` only.
- Client already ships per-body geology: [`clientState.ts`](src/engine/clientState.ts) sends
  `planets` + `asteroidBelts` (type/orbit/habitability) and fogged `sites`; the Inspector
  ([`BodyRoster`](web/src/components/Inspector.tsx)) renders the worlds + a deposit list.
- **Invariants to protect:** determinism (seeded `Rng`, no `Date.now`/`Math.random` in
  `src/engine`), event-sourced replay (a live game is rebuilt from `seed + per-seat orders`),
  and the balance sweep (`npm run sim --procedural`). The legacy `yields` authoring shortcut and
  all existing tests must keep working.

**Key insight:** the hard part isn't the *data* (sites already know their body); it's that the
engine *aggregates* at the system level. So this is mostly a re-homing of where buildings live and
where production loops iterate — plus a new per-planet building layer on top.

---

## 2. Decisions (resolved, with rationale)

These were the open forks. Recommended resolutions:

### 2a. Stockpile stays at the **system** (the container) — NOT per-planet
Planets/belts **own deposits, extraction, and buildings**; they **produce into the system's single
shared `stockpile`** (the container's warehouse). Market sells, convoys ship, transfers move, and
strategic build-bills draw from that shared system stockpile — exactly as today.

*Why:* the convoy/market/transfer/strategic-bill machinery is the spine of the game and all of it
operates on a system stockpile. Per-planet stockpiles would force intra-system planet-to-planet
logistics and multiply every economic interaction for little gameplay gain. "System as container"
naturally holds the shared warehouse its planets fill and its fleets/depot ship from. **This keeps
Phase 1 a pure re-home with zero balance drift.**

### 2b. Population: system-level first, **per-planet is a later, opt-in phase**
Phase 1 keeps `populationStage`/food/tax at the system level. A later phase (4b, below) can make
each habitable planet its own colony with its own population/food/growth/tax — the full MoO2 model.

*Why:* per-planet population is the deepest, riskiest change (it rewrites
`resolvePopulationAndUpkeep`, tax, and growth) and isn't required for the user's stated goal
("manage building a few structures on the planet"). Re-home buildings first; add per-planet
colonies as a deliberate, separately-swept phase.

### 2c. Ownership/conquest stays at the **system** level
A fleet still captures a whole **system** (Section 23); owning the system means owning all its
planets/belts. You then *develop* each body via its build menu.

*Why:* fleets garrison a system, not a planet. Per-planet capture would force partial-system
ownership, split garrisons, and a rework of the war/defense/fleet layer just shipped. "Container"
ownership keeps the war layer intact and makes the planet layer purely about *development*.

### 2d. Building split — what's a **planet** building vs a **system** building

| Tier | Buildings |
|---|---|
| **Planet/belt** (the colony screen) | **Extractor** (per deposit, exists), **Refinery/Factory** (runs processor recipes), **Reactor** (powers *that body's* factories), **Agri-dome** (hydroponics/food), **Habitat** (pop/growth), and later **Research Lab** |
| **System** (the container) | **Defense Platform**, **Trade Depot**, **Megastructures** (Section 22), system-wide **defense** |

*Why:* anything that *processes resources* or *grows population* belongs to the colony that does the
work (and powers itself — a body's reactor powers its own factories, which is cleaner than a
shared system grid). Anything that defends or projects the *whole system* (platforms, depot,
megastructures) stays on the container. Mining Rigs/Habitats/Power Grid (the Section 07c upgrade
tracks) re-home to the planet they upgrade.

### 2e. Construction stays **instant-on-affordability** (no build queue yet)
Building is still "pay credits + resources, it appears next turn," per-body. A MoO2-style
**production-point build queue** is noted as an optional later phase — it's a big UX/engine change
and not needed to deliver per-planet buildings.

---

## 3. Target data model

Introduce a **runtime body** (a "colony") that owns the per-body economy. The static `SystemBodies`
(scenario JSON) is unchanged; the `Galaxy` constructor expands it into runtime colonies, just as it
already expands deposits into sites.

```ts
/** Per-body buildings (Section 24). Power is local: a body's reactor powers its own factories. */
interface BodyBuildings {
  processors: Record<string, number>; // recipe id → factory count (was System.processors)
  reactors: number;                    // powers THIS body's factories (was System.reactors)
  hydroponics: number;                 // agri-domes (was System.hydroponics)
  miningRigs: number; habitats: number; powerGrid: number; // 07c upgrade tracks, re-homed
}

/** A runtime planet/belt — the first-class economic unit (Section 24). */
interface Colony {
  key: string;                 // stable, e.g. "planet:2" / "belt:0" (matches site key prefixes)
  kind: "planet" | "belt";
  bodyType: PlanetType | "belt";
  orbit: number;
  habitable: boolean;
  sites: ExtractionSite[];     // MOVED off System — this body's deposits/extractors
  buildings: BodyBuildings;
  // (Phase 4b, optional) population: PopulationStage; populationProgress; unrest; food state…
}

interface System {
  // container-level only:
  colonies: Colony[];          // replaces System.sites + the re-homed building scalars
  stockpile: Stockpile;        // shared warehouse (unchanged)
  platforms: number; hasDepot: boolean; megastructures: MegastructureKind[]; defense: number;
  populationStage: …;          // stays system-level in Phase 1 (2b)
  owner, routeIds, position, claimCost, upkeep, bodies?, yields, innerRing  // unchanged
}
```

`effectiveYields`/`potentialYields`/`siteOutput` change from iterating `sys.sites` to iterating
`sys.colonies.flatMap(c => c.sites)` — the aggregate is identical, so the read-model shim that all
consumers use keeps the rest of the engine/bots/UI working.

Build orders gain a body selector: `buildProcessor/buildReactor/buildExtractor/…{ systemId,
colonyKey, … }`. The legacy `yields` shortcut lowers into a **single synthetic colony** holding the
always-on sites, so authored maps and tests are unchanged.

---

## 4. Phased plan (each phase ends with a balance checkpoint)

Run `npm run sim -- --games 200 --players 8 --procedural` after every phase; keep determinism +
existing tests green.

### Phase 1 — Re-home the economy onto colonies (balance-neutral) — **Medium**
- `types.ts`: add `Colony` + `BodyBuildings`; replace `System.sites` and the re-homed building
  scalars with `System.colonies`.
- `galaxy.ts`/`bodies.ts`: build one `Colony` per planet/belt (and a synthetic colony for legacy
  `yields`); move `sitesFromBodies`/`sitesFromYields` output onto colonies.
- `engine.ts`: `resolveProduction` loops colonies → each colony extracts (its sites) and runs its
  own factories on its own reactor power, all depositing into the shared `sys.stockpile`. Re-home
  the build-order handlers to a `(system, colony)` target. Valuation, sabotage (targets a site on a
  colony), and stellar all read through the same sites — just nested one level deeper.
- `effectiveYields`/`potentialYields` iterate `colonies.flatMap(sites)`.
- Client/fog: `ClientSystem` gains per-colony grouping (sites already carry the body; just group
  them); `clientView` rebuilds colonies.
- Bots ([`strategy.ts`](src/engine/bots/strategy.ts)): the build heuristics (`maybeBuildExtractor`,
  `maybeBuildProcessor`, `maybeBuildReactor`, `maybeUpgradeInfrastructure`) pick a *colony* to build
  on. `systemCanFeed` (processor-placement) becomes "can THIS colony feed the recipe" (its sites +
  its factories) — which is actually more correct than the current system-wide check.
- UI: `Inspector` groups the deposit list by world; build buttons target the chosen body.
- **Checkpoint: sweep shows ~zero drift vs. `main`** (same total extraction/factories, just
  re-homed). This is the safe foundation.

### Phase 2 — The colony screen (the MoO2 management UI) — **Medium**
- Turn the per-world `BodyRoster` chip into a clickable **colony view**: select a planet/belt →
  see its deposits, its buildings, and per-body build/queue controls (extractor, factory, reactor,
  agri-dome, habitat). Reuse `planet-<type>.png` art; show power balance and output per colony.
- No new engine mechanics — this is the UX that makes Phase 1's per-body economy legible and is the
  payoff the user asked for. **Checkpoint: live browser review.**

### Phase 3 — New planet building types + planet-type affinities — **Medium**
- Add buildings that make planet *type* matter for development, MoO2-style: e.g. a **Research Lab**
  (new research/score output), type-gated bonuses (factories cheaper on rocky/metal worlds, agri
  stronger on ocean worlds, gas giants host only skimmers + orbital structures, belts host mines +
  defense but no domes). Tie build availability to `bodyType`/`habitable`.
- **Checkpoint: sweep + retune; confirm planet variety drives real build decisions.**

### Phase 4a — Optional: build queue (production points) — **Medium**
- A MoO2 per-colony build queue funded by a per-turn "construction" output, instead of
  instant-on-affordability. Larger UX + engine change; only if the instant model feels too flat.

### Phase 4b — Optional/Large: per-planet population (full colony model)
- Move `populationStage`/food/growth/tax onto each habitable `Colony`; rewrite
  `resolvePopulationAndUpkeep` to iterate colonies; per-colony food (its agri-domes + transfers),
  per-colony tax, habitat/terraforming. This is the deepest change and gets its own design pass +
  balance sweep. Sequence it last so the rest is stable first.

---

## 5. Risks & dependencies

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | **Balance drift** when the economy re-homes. | High | Phase 1 is a pure re-home — same sites/factories, just nested; sweep must show ~zero drift before any new mechanics. |
| R2 | **Determinism / event-sourced replay** — the live game is rebuilt from orders; build orders now carry a `colonyKey`. | High | Keep colony keys stable + deterministic (`"planet:<idx>"`); generation already deterministic. Order schema is additive; old orders without a key target the synthetic/first colony. Re-run `tests/replay.test.ts`. |
| R3 | **Order/UI plumbing churn** — every build order + bot heuristic + build button gains a body target. | Medium | Mechanical but broad; do it once in Phase 1 with a shared `(systemId, colonyKey)` shape. |
| R4 | **Per-body power** changes the processor/reactor balance (each colony self-powers vs one system grid). | Medium | Tune reactor output/cost so a developed colony self-powers; sweep. (Net likely cleaner than the shared grid.) |
| R5 | **Per-planet population (4b)** rewrites the food/tax/growth core. | High (4b only) | Deferred, separately designed + swept; not required for the core ask. |
| R6 | **Convoy/market assume system stockpile.** | Low | Decision 2a keeps the stockpile at the system, so this layer is untouched. |
| R7 | **Save/scenario compatibility.** | Low | `SystemBodies` (scenario JSON) unchanged; colonies are runtime-built. Legacy `yields` → one synthetic colony. |

**Dependency:** builds directly on the Section 21 body model. No DB/schema change — persistence
stays `(seed, players, orders)` and colonies regenerate deterministically.

---

## 6. Scope summary

| Phase | What | Scope | Balance risk |
|---|---|---|---|
| 1 | Re-home economy onto `Colony` (system = container, stockpile stays shared) | **Medium** | None if tuned to match |
| 2 | Colony management UI (the MoO2 screen) | Medium | None (UI) |
| 3 | New planet buildings + type affinities | Medium | Medium |
| 4a | Build queue (production points) — optional | Medium | Medium |
| 4b | Per-planet population — optional, large | **Large** | High |

**Recommended first step:** ship **Phase 1 alone as one PR** — the balance-neutral re-home behind
the existing `effectiveYields` shim — then build the colony screen (Phase 2) on top. Everything
else is incremental.

## 7. Decisions still needing your sign-off

1. **Stockpile stays system-level** (planets produce into the shared warehouse) — confirm, or do
   you want per-planet stockpiles (much bigger logistics change)?
2. **Conquest stays system-level** (own the system → own its planets) — confirm, or do you want
   planet-by-planet capture (reworks the war layer)?
3. **Per-planet population** — in scope (Phase 4b) or out? It's the biggest piece and the most
   "MoO2," but also the riskiest.
4. **Build queue vs instant** — keep instant-on-affordability, or add MoO2 production-point queues?
