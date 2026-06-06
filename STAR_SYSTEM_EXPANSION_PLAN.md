# Star System Expansion — Implementation Plan

**Status:** Plan only — nothing implemented.
**Goal:** Give every star system a richer astrophysical identity — a **star type**, a
deterministic set of **planets** (with planet types), and **asteroid belts** — and surface
that data in the UI. The galaxy already lays out organic spiral arms with per-region resource
profiles; this expansion adds the *contents* of each system on top of that, without
destabilising the existing economy or breaking deterministic replay.

---

## 0. How systems work today (grounding)

A "system" today is a single abstract node. There is **no concept of a star, planets, or
asteroid belts** anywhere in the model. The relevant pipeline:

| Stage | File | What it carries about a system |
|---|---|---|
| Authored/generated input | [`ScenarioSystem`](src/engine/config.ts) | `id, name, yields, claimCost, upkeep, populationStage?, defense?, innerRing?, position?` |
| Procedural generation | [`generateProceduralScenario`](src/engine/procedural.ts) | builds `ScenarioSystem`s from region profiles + spiral layout |
| Committed maps | [`scenarios/*.json`](scenarios/) via [`genScenarios.ts`](scripts/genScenarios.ts) | legacy authored systems (no `position`, no bodies) |
| Runtime model | [`System`](src/engine/types.ts) | full mutable game state; built in the [`Galaxy`](src/engine/galaxy.ts) constructor |
| Fog-of-war snapshot | [`ClientSystem`](src/engine/clientState.ts) | what the server sends each poll |
| Client rebuild | [`scenarioFromState`](web/src/match/clientView.ts) | reconstructs a `Scenario` browser-side |
| Rendering | [`PixiGalaxyMap`](web/src/components/PixiGalaxyMap.tsx), [`Inspector`](web/src/components/Inspector.tsx), [`Systems`](web/src/screens/Systems.tsx) | glyph by `position.region` + `systemArchetype(yields)` |
| Visual identity | [`systemArchetype`](web/src/match/format.ts), [`PlanetArt`](web/src/theme/ArtSlot.tsx) | derives a single "archetype" from the **dominant yield** |

Three load-bearing facts that shape the whole plan:

1. **`SystemRegion`** (`hub | core | frontier | abyss`) and a per-system **`visualSeed`**
   already exist on [`SystemPosition`](src/engine/types.ts). Region drives both the resource
   profile and the map glyph. Star/planet generation should *layer onto* region, not replace it.
2. **The "archetype" is purely derived from yields** (`dominantResource`). Whatever bodies we
   generate must stay **consistent** with the existing yield/archetype, or the UI will show a
   "Garden world" with no habitable planet, etc.
3. **The whole game is deterministic and event-sourced.** The Worker persists only
   `(seed, players, per-seat orders)` and rebuilds the galaxy by re-running
   `generateProceduralScenario`. `tests/procedural.test.ts` and `tests/determinism.test.ts`
   assert byte-identical replay. **Any new randomness must not perturb the existing layout
   stream** (see Risk R1 — this is the single most important constraint).

---

## 1. Data model changes

**Scope: Small–Medium.** New types + one optional field threaded through five hops. No
behavioural logic.

### 1.1 New types in [`src/engine/types.ts`](src/engine/types.ts)

```ts
export type StarType =
  | "mainSequence"  // common, standard habitable zone
  | "redDwarf"      // small/cool, tight habitable zone, long-lived
  | "redGiant"      // bloated, habitable zone pushed outward; inner planets scorched
  | "blueGiant"     // hot/massive, wide but lethal zone, few habitables
  | "whiteDwarf"    // stellar remnant, mostly dead system, few/no habitables
  | "neutronStar";  // exotic remnant, no habitables, rare-isotope flavour

export type PlanetType =
  | "lava"      // inner, scorched
  | "rocky"     // inner/temperate barren rock
  | "desert"    // warm marginal
  | "ocean"     // habitable-zone water world (the "garden" candidate)
  | "gasGiant"  // outer, He-3 flavour
  | "iceGiant"  // outer cold giant
  | "barren";   // airless frozen rock (outermost / dead systems

export interface Planet {
  type: PlanetType;
  /** Orbital slot, 0 = innermost; strictly increasing across planets + belts. */
  orbit: number;
  /** Sits within this star's habitable zone (descriptive in Phase 1). */
  habitable: boolean;
  /** Deterministic per-body cosmetic variation for the renderer. */
  visualSeed: number;
}

export interface AsteroidBelt {
  /** Orbital slot; always between the inner rocky zone and the first gas giant. */
  orbit: number;
}

/** The astrophysical contents of a system. Optional everywhere for backward-compat. */
export interface SystemBodies {
  starType: StarType;
  planets: Planet[];
  asteroidBelts: AsteroidBelt[];
}
```

Add `bodies?: SystemBodies` to the **`System`** interface (nested, optional). Nesting (rather
than flattening `starType`/`planets` onto `System`) keeps the optionality clean and the diff
small.

### 1.2 Thread `bodies?` through the pipeline

| File | Change |
|---|---|
| [`config.ts`](src/engine/config.ts) — `ScenarioSystem` | add `bodies?: SystemBodies` |
| [`galaxy.ts`](src/engine/galaxy.ts) — `Galaxy` ctor | copy `bodies: s.bodies` into the runtime `System` (pure pass-through, like `position`) |
| [`clientState.ts`](src/engine/clientState.ts) — `ClientSystem` + `buildClientState` | add `bodies?: SystemBodies`; copy it through (bodies are **public** — no fog-of-war redaction) |
| [`clientView.ts`](web/src/match/clientView.ts) — `scenarioFromState` | include `bodies: s.bodies` when rebuilding `ScenarioSystem` |
| [`index.ts`](src/engine/index.ts) | export the new types (`StarType`, `PlanetType`, `Planet`, `AsteroidBelt`, `SystemBodies`) from the barrel so the web client can import them |

No change to `Engine`/`engine.ts` in Phase 1 — bodies are descriptive and not consumed by
turn resolution.

> **Decision — descriptive vs economic.** Phase 1 makes bodies **purely descriptive**: yields
> stay exactly as the region profiles produce them, so the balance sweep is untouched. Bodies
> are *chosen to be consistent with* those yields (a He-3 system gets a gas giant, a food
> system gets an ocean world). Coupling bodies → yields is deferred to an optional Phase 2
> (§6). This keeps the change shippable and balance-neutral.

---

## 2. Generation logic

**Scope: Medium.** All new code lives in [`procedural.ts`](src/engine/procedural.ts); the
committed JSON maps get an optional fallback (§2.5).

### 2.1 RNG discipline (critical — read first)

`generateProceduralScenario` uses a single `rng` stream for positions, names, yields, and
routes. **Adding `rng.*` calls inline would shift every subsequent draw**, changing the layout
of every existing seed — and because live games are rebuilt from `seed` (§0.3), that silently
rewrites in-progress galaxies.

**Mitigation:** generate bodies from a **separate decorrelated sub-stream**, computed *after*
the existing scenario is fully built, so the existing position/name/yield/route draws are
byte-for-byte unchanged:

```ts
// after relax() + buildRoutes(), before returning the scenario:
const bodyRng = new Rng((seed ^ 0x5bd1e995) >>> 0); // distinct constant from layout's 0x9e3779b1
for (const p of placed) {
  if (p.region === "hub") continue;
  p.sys.bodies = generateBodies(bodyRng, p.region, p.sys.yields);
}
```

Because the layout stream is untouched, **existing procedural galaxies keep their identical
spatial/economic layout and simply gain `bodies`** — no replay migration needed, and
`tests/procedural.test.ts` determinism still holds (both runs regenerate identically).

### 2.2 Star type selection — weighted by region

Rarer/more exotic stars cluster outward. Weights (tune later):

| Region | mainSequence | redDwarf | redGiant | blueGiant | whiteDwarf | neutronStar |
|---|---|---|---|---|---|---|
| core | 0.45 | 0.30 | 0.12 | 0.05 | 0.08 | 0.00 |
| frontier | 0.30 | 0.25 | 0.18 | 0.12 | 0.10 | 0.05 |
| abyss | 0.15 | 0.15 | 0.15 | 0.20 | 0.15 | 0.20 |

Implement as a small weighted-pick helper over `bodyRng.next()`. (Optionally bias toward a star
type that matches the dominant yield — e.g. rare-isotope/antimatter systems lean
neutronStar/whiteDwarf — so the star reinforces the archetype.)

### 2.3 Planet count + composition rules

Each star type defines a **habitable-zone band** (an inner/outer orbit index window) and a
planet-count range. The requested rules map directly:

| Star type | Planet count | Habitable zone | Notable composition rules |
|---|---|---|---|
| mainSequence | 3–7 | mid orbits (e.g. orbit 2–3) | standard inner-rocky → habitable → belt → giants ladder |
| redDwarf | 2–5 | **tight, inner** (orbit 1) | habitable candidate is close-in; fewer outer giants |
| redGiant | 3–6 | **expanded + pushed outward** (orbit 3–5) | innermost 1–2 orbits **scorched → `lava`/engulfed (skipped)**; ocean worlds only appear in the outer expanded zone |
| blueGiant | 4–8 | wide but **few survive** | high `lava`/`barren` share; habitable rare even though zone is wide |
| whiteDwarf | **0–3** | **none** (no `ocean`/`habitable`) | dead system — mostly `barren`/`rocky`; never produces a garden world |
| neutronStar | **0–2** | **none** | stripped system — `barren` rock only, no giants |

**Asteroid-belt rule (as requested):** a belt is placed **between the inner rocky zone and the
first gas giant** — i.e. after the last inner rocky/desert/ocean planet and before the first
`gasGiant`. 0–2 belts per system; more likely in systems whose dominant yield is
`metals`/`silicates` (so the belt visually justifies a mining system). White dwarf / neutron
systems may still have a belt (debris disc) but no giants.

**Orbital ordering.** Planets are emitted in **orbital order** with strictly increasing `orbit`
indices, interleaving belts at their slot. Suggested generator outline:

```ts
function generateBodies(rng: Rng, region: SystemRegion, yields: Stockpile): SystemBodies {
  const starType = pickStarType(rng, region, yields);
  const spec = STAR_SPECS[starType];          // { countMin, countMax, hzInner, hzOuter, lavaInner, ... }
  const n = rng.int(spec.countMin, spec.countMax);
  const planets: Planet[] = [];
  let orbit = 0;
  for (let i = 0; i < n; i++, orbit++) {
    const type = pickPlanetType(rng, orbit, spec, yields); // honours hz window + scorch rules
    const habitable = spec.hasHZ && orbit >= spec.hzInner && orbit <= spec.hzOuter && isHabitable(type);
    planets.push({ type, orbit, habitable, visualSeed: rng.int(0, 0x7fffffff) });
  }
  const belts = placeBelts(rng, planets, yields); // between last inner rocky and first giant
  return { starType, planets, asteroidBelts: belts };
}
```

Keep `STAR_SPECS` and the planet/star weight tables as **module constants in
`procedural.ts`** (alongside `CORE_PROFILES`/`BANDS`), not in `Tuning` — they are generation
shape, not per-turn balance numbers. (If we later want scenario-level tuning of body rarity,
promote them to `Tuning` then.)

### 2.4 Consistency with existing yields

`pickPlanetType`/`pickStarType` should read the system's dominant yield so bodies reinforce the
archetype the UI already shows:

- `food` (garden) → guarantee at least one `ocean` habitable planet (and a non-dead star).
- `helium3` → guarantee ≥1 `gasGiant`.
- `metals`/`silicates` → bias toward an asteroid belt + rocky worlds.
- `rareIsotopes`/`antimatter` → bias star toward `neutronStar`/`whiteDwarf`, no habitables.

This guarantees the new data never contradicts `systemArchetype()`.

### 2.5 Legacy committed scenarios

`scenarios/inner-ring-*.json` have no `position` and no `bodies`. Two options:

- **(a) Regenerate** them via [`genScenarios.ts`](scripts/genScenarios.ts), adding a
  body-generation pass mirroring §2.1–2.4 (deterministic from a fixed seed) and re-committing
  the JSON. **Recommended** for the headless sim/test maps so they exercise the new fields.
- **(b) Runtime fallback:** add a tiny deterministic `deriveBodies(system)` helper (seeded from
  `system.id`/`visualSeed` + yields) that the UI calls when `bodies` is absent, so any legacy or
  hand-authored map still renders sensible bodies without a data migration.

Recommend doing **both**: (a) for the canonical maps, (b) as a safety net so the renderer never
has to handle a missing `bodies`.

---

## 3. UI / rendering changes

**Scope: Medium.** The highest-value surface is the **Inspector** (a per-system body readout);
the map glyph and Systems cards are lighter touches.

### 3.1 Labels + colours — [`format.ts`](web/src/match/format.ts)

Add lookup tables (mirrors the existing `resourceLabels`/`resourceColors` pattern):

```ts
export const starTypeLabel: Record<StarType, string> = { mainSequence: "Main-sequence star", redGiant: "Red giant", whiteDwarf: "White dwarf", neutronStar: "Neutron star", redDwarf: "Red dwarf", blueGiant: "Blue giant" };
export const starTypeColor: Record<StarType, string> = { mainSequence: "#ffd66b", redGiant: "#ff7a4d", blueGiant: "#8fd0ff", whiteDwarf: "#eef3ff", neutronStar: "#c7d8ff", redDwarf: "#ff9d6c" };
export const planetTypeLabel: Record<PlanetType, string> = { /* … */ };
export const planetTypeColor: Record<PlanetType, string> = { /* … */ };
```

### 3.2 Inspector — system body readout ([`Inspector.tsx`](web/src/components/Inspector.tsx))

In the system branch (after the yield row), add a **"System composition"** block:

- A **star line**: `starTypeLabel[bodies.starType]` with a star-coloured dot.
- An **orbital list / mini orbit diagram**: one chip per body in orbital order — a coloured
  dot + `planetTypeLabel`, a 🪐 marker for gas/ice giants, a "Habitable" badge on habitable
  planets, and an "Asteroid belt" chip at its slot. Reuse the existing `Badge`/`yield-pill`
  styles.
- Optional: replace/augment the single `PlanetArt` portrait so it reflects the **primary
  body** (e.g. the habitable planet if present, else the dominant body), or render the star
  with `starTypeColor`.

### 3.3 Map glyph — [`PixiGalaxyMap.tsx`](web/src/components/PixiGalaxyMap.tsx)

Light touch, opt-in:

- Tint the system **core/halo by `starType`** (use `starTypeColor`) instead of, or blended
  with, the current dominant-resource fill — so white dwarfs read white, red giants red, etc.,
  at a glance. `drawGlyph` already branches on `region`/`arch`; add a star-colour parameter.
- Optionally draw small **orbit dots** or a belt ring around larger-zoom systems (the map
  already has a `rings` layer and zoom-based label gating via `showAll`). Keep this behind the
  zoom threshold to avoid clutter at galaxy scale.
- `bodies` reach the renderer via `view.galaxy` systems (already plumbed through §1.2), so no
  new data wiring is needed here.

### 3.4 Systems screen — [`Systems.tsx`](web/src/screens/Systems.tsx)

Add a small star-type badge and/or planet-count (`"5 planets · belt"`) to each `sys-card` and
`claim-row`. Small.

### 3.5 Art ([`ArtSlot.tsx`](web/src/theme/ArtSlot.tsx) / [`artManifest`](web/src/theme/artManifest.ts))

`PlanetArt` is keyed by the six `SystemArchetype`s today (only `metals`/`garden` have painted
PNGs; the rest fall back to CSS gradients). To show real planet/star variety:

- **Cheap path (recommended first):** add `planetTypeGradient`/`starTypeGradient` CSS gradient
  maps (like `archetypeGradient`) so every planet/star type renders distinctly with **no new
  image assets**.
- **Rich path (optional, Large):** commission `system-<starType>.png` / `planet-<type>.png`
  portraits and register slots in `artManifest`; `ArtSlot`/`PlanetArt` already degrade
  gracefully to gradients when a PNG is missing.

---

## 4. Tests

**Scope: Small.** Extend [`tests/procedural.test.ts`](tests/procedural.test.ts):

- Every non-hub generated system has `bodies` with a valid `starType`.
- **Determinism still byte-identical** for same `{seed, players}` (existing test already
  covers this once `bodies` is in the serialised scenario).
- **Rule invariants:** white dwarf & neutron systems have **no** `habitable` planet; red giant
  habitable planets sit in the **outer** zone (orbit ≥ its `hzInner`); every asteroid belt's
  `orbit` is **greater than every inner rocky/ocean planet and less than every gas giant**;
  `food`-dominant systems always have a habitable ocean planet.
- **Backward-compat:** a scenario without `bodies` still loads and renders (exercises the §2.5b
  fallback).
- Add a focused `tests/bodies.test.ts` for `generateBodies`/`placeBelts` rule coverage.

`npm run typecheck` + `npm run web:build` must stay green (new optional field, new barrel
exports).

---

## 5. Risks & dependencies

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| **R1** | **Replay drift** — adding RNG draws inline reshuffles the layout stream, silently rewriting every existing seed's galaxy (and live event-sourced games). | **High** | Generate bodies from a **separate decorrelated `Rng`** *after* layout is built (§2.1). Layout draws stay byte-identical; no data migration. |
| R2 | **Balance disturbance** if bodies feed yields. | High (Phase 2 only) | Phase 1 is descriptive-only; yields unchanged. Defer coupling to Phase 2 and re-run `npm run sim` sweeps before/after. |
| R3 | **UI contradiction** — bodies disagree with the yield-derived `systemArchetype` (e.g. garden world, no ocean). | Medium | Generation honours dominant yield (§2.4); add a test invariant. |
| R4 | **Legacy maps** (`scenarios/*.json`, hand-authored) lack `bodies`. | Medium | Optional field everywhere + deterministic `deriveBodies` fallback (§2.5b); regenerate committed maps (§2.5a). |
| R5 | **ClientState payload growth** — `bodies` (planet arrays) are serialised into every fog-of-war snapshot, polled by every client each turn. | Low–Medium | Bodies are static per system → send once is ideal, but simplest is to include them (≈ a few hundred bytes/system). If payload matters, send only `starType` + counts and have the client expand planets deterministically from `visualSeed`. Recommend full-bodies for Phase 1; revisit if poll size grows. |
| R6 | **Determinism guardrails** — engine purity (no `Math.random`/`Date.now`/`node:*`). | Low | All generation already uses `Rng`; follow the existing pattern. |
| R7 | **Art cost** if commissioning per-type portraits. | Low | Gradient fallbacks first (§3.5 cheap path); PNGs optional later. |

**Dependencies / ordering:** §1 (model) → §2 (generation) → §3 (UI) is the natural sequence;
§4 tests land alongside §2. No external services, schema migrations, or Worker DB changes are
needed — persistence is `(seed, players, orders)` and bodies regenerate deterministically.

---

## 6. Optional Phase 2 — economic coupling (not in scope now)

If bodies should *matter* mechanically rather than decorate:

- **Yields from bodies:** gas giants → He-3, belts → metals/silicates, ocean worlds → food
  capacity, neutron/abyss → rare isotopes/antimatter. Replace region profiles with a
  body-driven yield computation.
- **Habitability gates growth:** `populationStage` ceiling / `growthRate` modified by whether
  the system has a habitable planet; hydroponics required on dead (white dwarf/neutron) systems.
- **Belts as mining targets / claim cost modifiers.**

Each of these touches [`engine.ts`](src/engine/engine.ts) resolution and **must be re-validated
with the headless balance sweep** (`npm run sim -- --games 200 --players 8`). Treat as a
separate, larger initiative once the descriptive layer ships.

---

## 7. Scope summary

| Area | Scope | Notes |
|---|---|---|
| Data model + pipeline threading (§1) | **Small–Medium** | New types + one optional field through 5 hops + barrel exports |
| Generation logic (§2) | **Medium** | Star/planet/belt rules + decorrelated RNG; the bulk of the new code |
| Committed-map regen + fallback (§2.5) | **Small** | `genScenarios.ts` pass + `deriveBodies` safety net |
| UI: Inspector body readout (§3.2) | **Medium** | Highest-value surface |
| UI: map glyph + Systems cards + format labels (§3.1, 3.3–3.4) | **Small–Medium** | Mostly additive, opt-in at zoom |
| Art (§3.5) | **Small** (gradients) / **Large** (commissioned PNGs) | Gradient fallbacks first |
| Tests (§4) | **Small** | Determinism + rule invariants |
| **Phase 1 total** | **Medium** | Descriptive, balance-neutral, no migration |
| Phase 2 economic coupling (§6) | **Large** | Separate initiative; requires balance re-sweep |
