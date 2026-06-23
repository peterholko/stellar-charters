# Galaxy Map Expansion Plan

**Goal:** Make the galaxy map physically larger *and* the central place where Stellar
Charters is played — the primary surface for issuing orders, reading the strategic
situation, and resolving conflict — rather than a selection/inspection screen you drill
*out* of into Systems / Ships / Exchange.

This is the design + rollout plan. Implementation has begun on branch `galaxy-map-expansion`.

## Implementation status (branch `galaxy-map-expansion`)

- ✅ **Phase 0 — galaxy-size config.** `GalaxyShape` + `GALAXY_DEFAULTS` in
  [`procedural.ts`](src/engine/procedural.ts); a `scale` knob multiplies system counts and (by
  `√scale`, constant density) the radial bands. Threaded through `ProceduralOptions` →
  `proceduralConfig` → `runProceduralGames` and exposed as `npm run sim -- --procedural
  --galaxy-scale N`. Verified: scale 1 = 75 systems (byte-identical — determinism tests green),
  scale 2 = 149, scale 3 = 223. New tests in [`tests/procedural.test.ts`](tests/procedural.test.ts).
- ✅ **Phase 1 — rendering scalability.** (a) Pixi `CullerPlugin` viewport culling: data-layer
  leaves marked `cullable`, off-screen objects skipped per render, tracks the camera. (b)
  Spatial grid for `enforceGlyphSeparation` — O(N²)→O(N·neighbours), same converged layout. All
  in [`PixiGalaxyMap.tsx`](web/src/components/PixiGalaxyMap.tsx).
- ✅ **Phase 2 — navigation at scale.** Camera `frame(ids)` + `focusTarget` prop driving a
  header system-search/jump-to, "Frame mine", and "Whole galaxy"; plus a screen-space
  **minimap** (owner-coloured dots, live viewport rectangle, click-to-pan) sharing the camera's
  `points` space. ([`GalaxyMap.tsx`](web/src/screens/GalaxyMap.tsx), `PixiGalaxyMap.tsx`)
- ✅ **Phase 3 — map as command surface.** `MoveFleetOrder` already resolves to an invasion at a
  rival system, so the existing on-map fleet-move gesture *is* the attack verb. Added a
  **staged-order ghost layer**: planned moves/surveys/claims/invasions/sabotage/interdictions
  drawn over the live map (hostile moves in the danger colour), reading the staged tray.
- ✅ **Phase 4 — strategic overlays.** Toggleable territory / resource / threat washes painted
  under the lanes, all from data the seat already has (owner, fogged deposits, sensor contacts).
- ✅ **Phase 5 — level of detail (partial).** Zoom-based LOD drops soft-halos + traffic pulses at
  far zoom (hysteresis; redraw only on tier flip).
- ⬜ **Deferred.** Phase 1 far-zoom *sector clustering* and the Phase 5 *retained-rendering
  rewrite* + *instanced glyphs* — culling + LOD already meet the perf target at scale 2–3, so
  these remain future work (the largest, highest-risk items) rather than part of this PR.

> Each phase landed as its own commit and was verified in the dev preview (`/preview`):
> overlays, search/jump, minimap viewport tracking, ghost arrows/rings, and LOD declutter were
> all confirmed rendering correctly with no console errors. The only preview warnings are stale
> HMR dep-array notices from live-editing one `useEffect` across hot reloads — impossible in a
> production load (the dep array is a constant-length literal).

---

## 0. Current state (grounding)

Everything below is anchored in the code as it stands today.

### Generation (`src/engine/procedural.ts`)
- Galaxy is generated deterministically from a seed (Section 21, "body-driven galaxy").
  Counts scale with player count ([`procedural.ts:91-93`](src/engine/procedural.ts:91)):
  - `coreCount   = max(players * 6, 24)`   → ~48 for 8p
  - `frontierCount = max(round(players*2), 8) + 1` → ~17 for 8p
  - `abyssCount  = max(round(players*1.1), 6)` → ~9 for 8p
  - **~75 systems total for 8 players** (committed flat scenarios are smaller: 15–25).
- Coordinate space is hub-centered world units. Radial bands
  ([`procedural.ts:65-69`](src/engine/procedural.ts:65)): core `240–820`,
  frontier `920–1340`, abyss `1460–2000` → **~4000-unit diameter**.
- Systems placed on 3–5 spiral arms (`SPIRAL_K = 0.0042`) with jitter, then a 48-iteration
  relaxation pass to `MIN_SEPARATION = 104` ([`procedural.ts:71-73`](src/engine/procedural.ts:71)).
- `DIST_PER_TURN = 600` world units = 1 turn of transit ([`procedural.ts:74`](src/engine/procedural.ts:74)).
- Warp routes: a charted Range-1 spanning tree across the core + hub spokes, with uncharted
  deep spurs into frontier/abyss. Tunnels-per-system capped (`HARD_MAX_TUNNELS = 5`; soft
  caps core 2–5, frontier ≤3, abyss ≤2, hub 3–5).
- Pathfinding: Dijkstra over stability-weighted `transitTime`, respecting `charted` +
  `requiredRange` ([`galaxy.ts` `shortestWarpPath`](src/engine/galaxy.ts)).

### Rendering (`web/src/components/PixiGalaxyMap.tsx`)
- Pixi.js 8 WebGL, single `Application`, **9-layer scene graph** (nebula, starfield, lanes,
  traffic, convoys, fleets, systems, rings, replay) + a screen-space `labelLayer`.
- Camera is `{x, y, zoom}`; `world` container is scaled/translated each frame
  ([`PixiGalaxyMap.tsx:209-234`](web/src/components/PixiGalaxyMap.tsx:209)). Zoom clamps to
  `fitZoom × [0.4, 16]` ([`:267-271`](web/src/components/PixiGalaxyMap.tsx:267)).
- **`draw()` clears and rebuilds every dynamic layer on every update** — full scene rebuild
  on each `view`/`selection`/`contacts`/`raidOverlay` change. **No spatial culling** of map
  objects; only *labels* are viewport-culled ([`:238-243`](web/src/components/PixiGalaxyMap.tsx:238)).
- Layout: `layoutPoints()` reconstructs positions from `PlayerView.galaxy`, applies a
  `LAYOUT_SPREAD = 0.62` radial remap, then `enforceGlyphSeparation()` relaxes glyphs so
  they never touch on screen.
- ~200–300 Graphics/Sprite objects per frame today; smooth at 40–75 systems.

### Interactions & gameplay centrality
- The map is **selection-driven**. Selecting a system/route/convoy/fleet populates the
  Inspector sidebar, which surfaces actions.
- **Only two orders are issued *directly* on the map**: `moveFleet` (select fleet → tap
  destination) and `surveySystem` (select survey vessel → tap target)
  ([`GalaxyMap.tsx:66-67`](web/src/screens/GalaxyMap.tsx:66)).
- Everything else is either an Inspector button (`survey`, `interdict`, `targetConvoy`,
  `claim`, quick-builds) or lives on another screen entirely (`invade`, `sabotage`,
  `redeployShip`, `buildExtractor`, `hirePrivateer`, colony queues, trading, research).
- The store (`web/src/match/store.ts`) is already wired so the map can `store.stage(order)`
  for **any** order type — there is no architectural barrier to issuing more from the map.
- The engine exposes 32 order types ([`types.ts:926-961`](src/engine/types.ts:926)); ~13 are
  strongly spatial (`moveFleet`, `redeployShip`, `surveySystem`, `survey`, `interdict`,
  `targetConvoy`, `claim`, `invade`, `sabotage`, `escort`, `hirePrivateer`, `buildPlatform/
  Depot/Disruptor`, `transfer`).

**The takeaway:** the data and the store already support a map-centric game. The two gaps are
(a) the map isn't *big* enough to feel like the world, and (b) most spatial orders haven't
been *brought onto* the map. This plan closes both.

---

## 1. Map scale — making the galaxy physically larger

The generator already scales with player count and uses a generous coordinate space, so
"larger" means **more systems, deeper space, and longer/more meaningful supply lines** —
while keeping balance (the sim) and rendering honest.

### 1a. Make galaxy size an explicit tunable (not hard-coded ratios)
Today the counts are hard-coded expressions in [`procedural.ts:91-93`](src/engine/procedural.ts:91).
Introduce a `galaxyScale` knob in `config.ts` (`DEFAULT_TUNING`) so size is balance-tested,
not edited in code:

```ts
// config.ts (DEFAULT_TUNING)
galaxy: {
  scale: 1,                 // 1 = current; 2–3 = "large"
  corePerPlayer: 6,         // was hard-coded
  frontierPerPlayer: 2,
  abyssPerPlayer: 1.1,
  minCore: 24,
  bands: { core: [240, 820], frontier: [920, 1340], abyss: [1460, 2000] },
  distPerTurn: 600,
}
```
- `procedural.ts` reads these instead of literals; `scale` multiplies counts **and** band
  radii together so density stays roughly constant (more systems spread over more space,
  not more crowding).
- Keep `MIN_SEPARATION` proportional to band span so relaxation still converges.
- **Scope: S.** Mechanical extraction of existing constants into config + multiply.

### 1b. Decouple distance from system count (deeper space)
A bigger map should mean **longer haul distances and higher range-tier gating**, not just
more dots. Because `DIST_PER_TURN = 600` is fixed, widening bands automatically makes deep
systems take more turns to reach and demand higher `requiredRange` tunnels — which is the
intended strategic payoff (frontier/abyss become genuinely "far"). Verify the range-tier
research curve (Section 28) still lets players reach the abyss by mid-game at `scale = 2–3`,
or the deep map becomes dead content.
- **Scope: S** (mostly balance verification via the sim, below).

### 1c. Add map "shape" variety / regions worth traveling to
At larger scale the spiral can read as uniform sprawl. Add structure that gives the bigger
space *meaning* (all in `procedural.ts`, deterministic per seed):
- **Multiple wormhole hubs / gateways** for very large maps (e.g. one secondary hub per
  ~40 systems) — turns one global exchange node into a hub network and creates natural
  fronts. *(Note: the market is a single global exchange today; secondary hubs would be
  navigational/strategic nodes, not new markets, unless market design changes.)*
- **Named clusters/constellations** — group systems into 4–8 sectors with a name and tint;
  this also feeds navigation (minimap regions, jump-to-sector) in §3.
- **Choke routes** — deliberately thin inter-cluster connectivity so the bigger map has
  defensible borders rather than a fully-meshed blob.
- **Scope: M.** New generation logic + a `sector`/`clusterId` field on `SystemPosition`.

### 1d. Coordinate math & layout at scale
- `SystemPosition.{x,y}` are already arbitrary world units — no fixed bound to raise. The
  only place that assumes a span is the **client** layout (`layoutPoints` /
  `enforceGlyphSeparation` / `unit = hypot(bounds) / 150`). These derive from actual bounds,
  so they scale automatically; but `enforceGlyphSeparation` is O(n²) and must move to a grid
  (see §4) at higher counts.
- Re-check `LAYOUT_SPREAD = 0.62`: at scale 2–3 the core is denser relative to the frontier;
  the spread remap may need to be scale-aware so the core doesn't clump.
- **Scope: S** (config) **+ folded into §4** (the O(n²) fix).

### 1e. Validate balance at scale *before* shipping (this is what the sim is for)
The headless simulator exists precisely to answer "is the economy viable at this size?"
Run sweeps at each candidate scale:
```bash
npm run sim -- --games 200 --players 8 --turns 42 --procedural   # baseline
# then with galaxyScale=2, =3 via scenario/config override
```
Watch: claim coverage (are deep systems ever claimed?), range-tier timing, convoy transit
times, raid reach, end-game valuation spread. **Gate the rollout of scale on the sim**, not
on how it looks. **Scope: M** (running + reading sweeps, tuning).

---

## 2. Gameplay centrality — make the map where decisions happen

The store already lets the map stage any order. The work is **surfacing spatial orders on
the map** with good gesture UX, plus richer at-a-glance situational read. Ordered by impact.

### 2a. Bring the remaining spatial orders onto the map
Each of these is a `store.stage(order)` call wired to a map gesture (the pattern already
exists for `moveFleet`/`surveySystem`):

| Order | Current home | Map gesture |
|---|---|---|
| `invade` | Ships / Inspector | Select own fleet → tap **rival** system → confirm invade |
| `redeployShip` | Ships | Select fleet → tap own system (vs. enemy = invade) |
| `targetConvoy` | Convoys list | Tap rival convoy on a lane → "Raid" (exists in Inspector; promote to one-tap) |
| `interdict` | Inspector | Tap an in-reach route → "Interdict" toggle drawn on the lane |
| `sabotage` | Systems (deep drill) | Tap rival system → deposit picker → sabotage |
| `hirePrivateer` | Systems | System card action on the map Inspector |
| `claim` | Inspector | Already on map; make open systems visually obvious (pulsing) |
| `buildPlatform/Depot/Disruptor` | Inspector quick-builds | Keep; add an icon ring showing what's built |

- **Gesture model:** select-then-target (already used for fleet move). When a fleet is
  selected, every system becomes a valid target whose *meaning* depends on ownership
  (own = redeploy/reinforce, rival = invade, neutral = move). Show a ghosted path
  (`shortestWarpPath` already returns the route list) + ETA + range-gate warning before
  confirm.
- Keep deep colony economy (build queues, processors, reactors, extractor *upgrades*,
  research) on the Systems/Research screens — those are tabular, not spatial. The map should
  *link* to them (it already has "view system" / "trade" jump buttons), not absorb them.
- **Scope: M per cluster** — (i) fleet verbs (invade/redeploy), (ii) raid verbs
  (interdict/targetConvoy), (iii) economic-spatial (sabotage/privateer/claim polish).

### 2b. Overlays — read the strategic situation without selecting
The renderer already has the data (`PlayerView`, `contacts`, `movementLog`) and a layer
system. Add toggleable overlays (a small control cluster, like the existing "Raid reach"
toggle at [`GalaxyMap.tsx:31`](web/src/screens/GalaxyMap.tsx:31)):
- **Territory / ownership** — tint each system's region by owner; optional Voronoi-style
  influence shading so you can see fronts. (Owner is already on each `System`.)
- **Resource overlay** — color systems by primary resource / richness (data is in
  `bodies`/`sites`, fog-gated to surveyed systems). Makes "where do I expand" a map decision.
- **Raid reach** (exists) + **threat overlay** — highlight lanes/systems reachable by *known
  rival* fleets (`contacts`), the inverse of raid reach.
- **Supply/traffic** — lane thickness by `trafficHistory` (partly drawn already); promote to
  a first-class overlay showing your logistics network.
- **Conflict indicators** — battle/raid markers at systems/lanes where combat resolved last
  turn (data exists in the report/`movementLog`); a pulsing clash glyph so war is visible on
  the map, not buried in the Combat screen.
- **Scope: M** (overlay framework + 2–3 overlays) **then S per additional overlay.**

### 2c. Fog of war as a *visible* map state
`buildClientState` already fogs the view (rival queues hidden, unsurveyed richness hidden,
rival convoy cargo bucketed). Today the map just omits what you can't see. Make fog explicit:
- Dim/haze unsurveyed systems and uncharted routes; render rival contacts as fogged ghosts
  (already partly done via `contacts`).
- Show a "last seen N turns ago" decay on rival fleet ghosts.
- This makes **survey/scout decisions** (already map-native) feel consequential — you're
  lifting fog you can see.
- **Scope: S–M.**

### 2d. On-map order review / command queue
Staged orders currently live in the Turn screen's OrderTray. Mirror them on the map: draw
staged `moveFleet`/`invade` as ghost arrows, staged builds as pending icons, so the map
shows *your plan for next turn*, not just the present. Unstaging = tap the ghost.
- **Scope: M.** Reads `store.staged`, renders a "planned" layer.

---

## 3. Navigation & UX at scale

At ~150–225 systems (scale 2–3) the current fit-to-view + pan/zoom is not enough.

### 3a. Minimap
A small always-visible inset showing the whole galaxy, the current viewport rectangle, owner
tints, and conflict pings. Click/drag to jump the camera. Reuses `layoutPoints` at a fixed
tiny scale; cheap to draw (one Graphics, redraw on camera move).
- **Scope: M.**

### 3b. Search / jump-to
A text box: type a system name (data on every `System`) → camera flies to it and selects it.
Also jump-to-sector (from §1c clusters) and jump-to-own-systems cycling.
- **Scope: S.**

### 3c. Bookmarks & smart focus
- Let players pin systems (client-only state) for one-key jumps.
- "Next event" key: cycle the camera through systems with new conflict/arrivals this turn
  (data in `movementLog`/report).
- **Scope: S.**

### 3d. Zoom levels with LOD presentation
Define 3 zoom tiers and change *what* renders at each (ties into §4 LOD):
- **Galaxy (far):** clusters/sectors as single glyphs with aggregate owner/conflict; lanes
  thinned; labels only for sectors + owned + selected (label culling exists already).
- **Region (mid):** individual systems + charted lanes; fleet/convoy dots.
- **System (near):** full detail — fleet chevrons, survey diamonds, traffic pulses, build
  rings, deposit hints.
- **Scope: M** (clustering at far zoom is the real work; see §4c).

### 3e. Distant-system clustering
At far zoom, collapse dense sectors into one node (count + owner mix). Expand on zoom-in.
Requires the spatial index from §4 to compute clusters cheaply.
- **Scope: M**, depends on §4.

---

## 4. Rendering performance at scale

Two things break as system count rises: **full-rebuild `draw()`** and **no spatial culling**
(plus the O(n²) glyph relaxation). Targets below assume up to ~250 systems, ~400 routes,
~150 moving objects.

### 4a. Viewport culling (highest impact, do first)
Today every object draws every frame regardless of camera. Add frustum culling: compute the
visible world-rect from `camera`, and skip systems/lanes/fleets fully outside it (plus a
margin). Pairs with a spatial index (§4d) so culling is O(visible), not O(n).
- **Scope: M.** Biggest single win; unblocks everything else.

### 4b. Incremental / retained rendering instead of full rebuild
`draw()` clears and recreates all dynamic layers on every `view`/`selection`/`contacts`
change ([`:719-728`](web/src/components/PixiGalaxyMap.tsx:719)). At scale, recreating
hundreds of Graphics per redraw is wasteful and GCs hard.
- Separate **static** layers (systems, charted lanes — change only on turn resolution) from
  **dynamic** (selection ring, hover, staged ghosts, contacts — change often). Rebuild only
  the layer that changed; a selection change shouldn't rebuild every star.
- Retain per-system/per-lane display objects in a `Map` keyed by id; update properties in
  place instead of destroy+recreate.
- **Scope: L.** Architectural, but the right long-term shape.

### 4c. Level of detail (LOD)
Drive what's drawn off zoom tier (§3d): at far zoom draw cluster glyphs (one object per
sector) instead of N systems and skip traffic pulses/labels/fleet icons entirely; at near
zoom draw everything. Cuts object count by 5–10× when zoomed out.
- **Scope: M**, shares code with §3e clustering.

### 4d. Spatial index
Replace linear scans with a grid or quadtree built from `points`, used by: hit-testing
(`pickAt` is currently linear over all objects), viewport culling (§4a), glyph separation
(`enforceGlyphSeparation` is O(n²) today), and clustering (§3e/§4c). Rebuild the index when
the galaxy changes (turn resolution), not per frame.
- **Scope: M.** Enabler for 4a, 3e, and the layout relaxation fix.

### 4e. Instanced / batched glyphs (optional, if still needed)
Pixi 8 batches sprites well; if procedural `Graphics` glyphs dominate at scale, convert the
common star glyphs to textured `Sprite`s (or a `ParticleContainer`) so they batch into few
draw calls. Measure first — culling + LOD may make this unnecessary.
- **Scope: M**, only if profiling shows glyph draw calls are the bottleneck.

### 4f. Ticker animation cost
Per-frame pulses/halos/replay loop over animated handles. At scale, cap animated objects to
those in view (post-culling) and pause the ticker when nothing is animating.
- **Scope: S.**

**Recommended order within performance work:** §4d (index) → §4a (culling) → §4c (LOD) →
§4b (retained rendering) → §4e/§4f as profiling dictates.

---

## 5. Phased rollout

Ordered by impact and dependency. Each phase is independently shippable and sim-validated
where it touches balance. Sizes: **S** ≈ ½–1 day, **M** ≈ 2–4 days, **L** ≈ ~1 week+.

### Phase 0 — Config-ize galaxy size & validate (foundation)  ·  **S–M**
- Extract hard-coded counts/bands into `config.ts` `galaxy` block (§1a).
- Run sim sweeps at scale 1 / 2 / 3; pick a target scale the economy survives (§1e).
- *Deliverable:* a `galaxyScale` knob + a balance verdict. No UI change yet.
- *Why first:* everything else assumes a chosen target size; cheap; de-risks the whole effort.

### Phase 1 — Rendering scalability (unblocks a bigger map)  ·  **L**
- Spatial index (§4d) → viewport culling (§4a) → LOD tiers + far-zoom clustering (§4c) →
  move glyph separation off O(n²) (§1d/§4d).
- *Deliverable:* the map renders 150–250 systems at 60fps. Ship the larger galaxy here.
- *Depends on:* Phase 0 target scale.

### Phase 2 — Navigation at scale  ·  **M**
- Minimap (§3a), search/jump-to (§3b), zoom-tier presentation (§3d), bookmarks/next-event
  (§3c).
- *Deliverable:* the big map is actually navigable.
- *Depends on:* Phase 1 (clustering/LOD share code).

### Phase 3 — Map as command surface  ·  **M (×3 clusters)**
- 3a fleet verbs on map: `invade`, `redeployShip`, ghost-path + ETA preview.
- 3b raid verbs on map: one-tap `targetConvoy`, lane `interdict` toggle.
- 3c economic-spatial: `sabotage`, `hirePrivateer`, claim polish.
- Staged-order ghost layer (§2d).
- *Deliverable:* the map issues the spatial half of the order set; you rarely leave it for
  warfare/logistics.
- *Depends on:* nothing hard (store is ready); best after Phase 1 so it performs.

### Phase 4 — Strategic overlays & fog  ·  **M, then S each**
- Overlay framework + territory, resource, threat overlays (§2b); explicit fog-of-war
  rendering (§2c); conflict indicators.
- *Deliverable:* the map reads the whole strategic situation at a glance.
- *Depends on:* Phase 1 (overlays add per-object draw cost; want culling first).

### Phase 5 — Retained rendering & polish  ·  **L**
- Incremental layer updates (§4b), instanced glyphs if needed (§4e), ticker gating (§4f),
  map shape variety / multi-hub / sectors (§1c).
- *Deliverable:* headroom for scale 3+ and richer generation; smoothest feel.
- *Depends on:* Phases 1–4 (do the architectural rewrite once the feature set is known).

### Dependency summary
```
Phase 0 (size + balance)
      │
      ▼
Phase 1 (render scale) ──► Phase 2 (navigation)
      │                         │
      ├──────────► Phase 4 (overlays/fog)
      ▼
Phase 3 (map commands) ──► Phase 5 (retained render + generation polish)
```

### Recommended first slice
Phase 0 + the **culling** portion of Phase 1 (§4d+§4a) + the **fleet verbs** of Phase 3
(§3a). That trio delivers a visibly larger, still-smooth map you can *fight on* directly —
the core of "larger and more central" — without committing to the full retained-render
rewrite.

---

## Risks & cross-cutting notes
- **Determinism is sacred.** All generation changes stay inside the seeded `Rng` and the
  engine's no-`Date.now()`/no-`Math.random()` rule; `tests/determinism.test.ts` must stay
  green. Larger galaxies must remain exactly replayable from `(seed, players)`.
- **Engine stays platform-agnostic.** Size/shape changes live in `src/engine/`; all
  rendering/nav/overlay work lives in `web/`. Don't leak Pixi concerns into the engine.
- **Fog of war is authoritative server-side.** The map can only render what
  `buildClientState` exposes — overlays/clustering must respect the fogged `PlayerView`,
  never reconstruct hidden state.
- **Balance gates scale.** A bigger map that the sim shows nobody can supply or defend is a
  regression. Phase 0's sweep is a hard gate, not a formality.
- **Don't absorb the tabular screens.** Colony build queues, research, and the Exchange are
  better as tables; the map should link to them, not reimplement them.
