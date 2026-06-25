# Stellar Charters — Turn-1 Opening + Standing Convoys: Implementation Plan

Build-ready engine-side implementation details for the Turn-1 Opening + Standing Convoy plan,
reconciled against the **actual current code**. Goal: make Turn 1 interactive and keep convoys
flowing without chores, so players come back for turns 2–5. No over-engineering.

## What the plan got wrong about the code (read this first)

The grounding pass verified the plan against the engine and found four assumptions that change the design:

1. **The opening auction is dead code.** `resolveAuction`/`bid()`/`stepAuction()` exist but are
   never called — `assignStartingSystems()` ([engine.ts:295](src/engine/engine.ts)) already seats
   every corp deterministically on the nearest-hub inner-ring system (seeded Fisher-Yates + stable
   hub-distance sort) **at construction**. So **"opening_auction" collapses into the existing
   constructor assignment** — no sealed-bid round, and the "guarantee exactly one home / fallback
   assignment" requirement is *already met*. We only add a tiny repair for homes with no tradable output.
2. **`GamePhase` today is `"play" | "over"`** ([clientState.ts:43](src/engine/clientState.ts)), and
   phase is a pure function of turn, not stored. The plan's 5-state enum collapses to **three**, all
   derived from `engine.currentTurn` — zero new persisted state.
3. **`opening_commands` is just the turn-1 submission window.** It fits the existing "a turn resolves
   when every seated human submits" model as **one submit bundle** — no two round-trips, no
   auction-results-then-commands split.
4. **Convoy names are client-only today** (`convoyName(id)`, [format.ts:298](web/src/match/format.ts)).
   The engine authors a real `name` *only* for first-export / standing / incident convoys; ordinary
   convoys keep the client-side hash. No flag-day.

Persistence stays exactly **`(seed, players, per-seat orders)`** — nothing in this feature is serialized.

---

## 1. Phase state machine

Phase is a pure function of `engine.currentTurn`, mapped onto the worker's submit-to-resolve clock:

```ts
// src/engine/clientState.ts:43 — single source of truth
export type GamePhase = "opening_commands" | "normal_orders" | "over";

export function gamePhase(engine: Engine): GamePhase {
  if (engine.outcome.over) return "over";
  return engine.currentTurn === 0 ? "opening_commands" : "normal_orders";
}
```

- `opening_commands` ≡ `currentTurn === 0` (turn 1 not yet resolved — the live planning window).
- `normal_orders` ≡ `currentTurn >= 1 && !over`.
- `TurnReport.phase` ([report.ts:175](src/engine/report.ts)) widens to `"auction" | "opening" | "normal"`
  (keep `"auction"` in the union — [Report.tsx:122](web/src/screens/Report.tsx) reads it, harmless).
  Turn 1's report carries `"opening"`; `buildReport(phase = "normal")` widens its param.
- `stepTurn()` ([engine.ts:516](src/engine/engine.ts)) branches:
  ```ts
  this.turn += 1;
  if (this.turn === 1) this.runOpeningTurn(ordersByCorp); else this.runNormalTurn(ordersByCorp);
  const report = this.buildReport(this.turn === 1 ? "opening" : "normal");
  ```
  `runOpeningTurn()` = collect orders once → `resolveOpeningCommands()` (surveys + first export) →
  then the full `runNormalTurn()` Section-20 turn. **Hoist order collection** (currently inline at
  engine.ts:688) into a `collectOrders()` helper so the *same* order map drives both.

**Phase legality is enforced by which order kinds resolve on turn 1**, not a separate state machine:
`openingSurvey`/`firstExport` are honored only when `this.turn === 1` (silently dropped otherwise —
the engine's no-op convention); standing-route orders are legal every turn.

---

## 2. Determinism / event-sourcing reconciliation (the load-bearing part)

**1. Startup stockpile** — seeded once in the constructor, end of `assignStartingSystems()`
([engine.ts:329](src/engine/engine.ts)), via a new pure `seedStartupInventory(corp, sys)`:
for each home site with `extractorLevel > 0`, `units = siteOutput(site, starType, systemSeed(sys), 1,
config.turns)` ([bodies.ts:64](src/engine/bodies.ts), pure, no Rng), **restricted to `listedResources()`,
excluding `food`**; `sys.stockpile[r] += Math.floor(2 * units)`. It's startup *inventory* (exists
before turn 1 resolves), so no-same-turn-chaining holds. Runs *after* the Fisher-Yates shuffle and
consumes **zero Rng**, so the only `determinism.test.ts` digest change is the intended stockpile delta.
*Home repair:* if a home's tradable one-turn output is all-zero, re-place the starter extractor on the
best tradable deposit, or push a synthetic small metals site (mirrors `ensureStartHabitable`). Pure.

**2. Standing-route auto-launch** — `Corporation.standingRoutes` is in-memory state rebuilt by
replaying create/toggle/remove orders (no migration, never serialized). **The launch is NOT an order** —
it's a pure function of `(route, stockpile, prices)` appended to `resolveMarketAndLaunch`, reusing the
existing sell path. Iteration over `this.corps` (array) then `corp.standingRoutes` (create order) — no
Map iteration, no Rng. `launchedTurn = this.turn` ⇒ flies next turn. Because input state is itself
deterministic per `(seed, orders)`, the full convoy stream regenerates bit-for-bit each replay. This is
the same "durable mechanism, ephemeral derivation" pattern the codebase already trusts for extractor levels.

**3. Instant opening surveys** — `openingSurvey` is an **order** (rides existing `game_orders`, *not*
the `game_instants` log). Resolution calls existing `surveyReveal(corp, sys)` ([engine.ts:2079](src/engine/engine.ts))
— a pure fog reveal, zero Rng. The 2-slot cap is deterministic first-wins iteration over the ordered
`Order[]` (the `resolveLogisticsFocus` pattern). Counter + markers rebuilt from the order log each replay.

**4. Rare-destroy named incident** — add `'destroyed'` to `RaidOutcome` ([raiding.ts:14](src/engine/raiding.ts)),
fired **reusing the single `roll = rng.next()` already drawn** (raiding.ts:126) — no extra draw, byte-identical
stream. `incidentId`/`incidentName` are pure FNV-1a hashes of `(seed, turn, convoy.id)` mirroring the
existing `evidenceHash` (engine.ts:152). The `diplomaticIncident` event + `incidentIds` trail are derived,
not stored. **Must** add `destroyed: 0` to `emptyRaidOutcomes()` (engine.ts:45) or the metrics Record fails typecheck.

---

## 3. Exact data model

### New / changed types

```ts
// src/engine/types.ts — new order kinds (add interfaces, then to the Order union at :941)
export interface OpeningSurveyOrder { kind: "openingSurvey"; targetSystemId: string; }            // Authority probe, no vessel
export interface FirstExportOrder   { kind: "firstExport"; resource: Resource; quantity: number; } // origin = home, dest = hub
export interface CreateStandingRouteOrder { kind: "createStandingRoute"; originSystemId: string; resource: Resource; batch: number; reserve: number; enabled?: boolean; }
export interface SetStandingRouteEnabledOrder { kind: "setStandingRouteEnabled"; routeId: string; enabled: boolean; }
export interface RemoveStandingRouteOrder { kind: "removeStandingRoute"; routeId: string; }

// src/engine/types.ts — Convoy (:429), add four OPTIONAL fields (zero churn to existing callers)
//   name?: string; firstExportForPlayer?: boolean; publicCargoClass?: string; incidentIds?: string[];

// src/engine/types.ts — Corporation (:584), add:
//   standingRoutes: StandingTradeRoute[];   // init [] at engine.ts:255 next to grudges:{}
export interface StandingTradeRoute {
  id: string;            // `sr-${standingRouteCounter++}` — pure counter, never Rng-seeded
  originSystemId: string;
  resource: Resource;
  batch: number;         // units per launch
  reserve: number;       // units kept, never shipped
  enabled: boolean;      // created DISABLED; never auto-enabled
}
// destination is ALWAYS the Wormhole Hub in v1 (no destSystemId — deferred)
```

### ClientState additions (all slot in beside the existing `marketPressure`)

```ts
// ClientConvoy (:189): name?, firstExportForPlayer? — PUBLIC (cargo stays owner-redacted as today)
// ClientSystem (:87): markers?: PublicMarker[]
export interface PublicMarker { kind: "survey_ping" | "auction_interest"; turn: number; corpId?: string; count?: number; }
// ClientState (:283), self-only:
export interface OpeningCommandState { homeSystemId: string; surveysRemaining: number; eligibleSurveyTargets: string[]; startupStockpile: Stockpile; canFirstExport: boolean; }
export interface ClientStandingRoute { id: string; originSystemId: string; resource: Resource; batch: number; reserve: number; enabled: boolean; readyToLaunch: boolean; }
export interface StandingRouteSuggestion { originSystemId: string; resource: Resource; batch: number; reserve: number; }
//   openingState?: OpeningCommandState;        // only while phase === "opening_commands"
//   standingRoutes?: ClientStandingRoute[];    // self-only
//   standingRouteSuggestion?: StandingRouteSuggestion;
```

---

## 4. Resolution placement (Section 20)

| Order / effect | Where | Determinism |
|---|---|---|
| Startup stockpile | constructor, end of `assignStartingSystems()` | pure `siteOutput`, no Rng |
| `openingSurvey` / `firstExport` | new `resolveOpeningCommands()` inside `runOpeningTurn`, **before** `runNormalTurn` | first-wins cap (2 / 1), `surveyReveal` reuse, no Rng |
| `create/set/remove` standing route | `resolveStandingRouteOrders()` right after `resolveAdministrative` (step 1.5), before production | array-order, no Rng |
| Standing auto-launch | appended to `resolveMarketAndLaunch` (step 3–4), after transfers, before its return | reuses `makeConvoy`/`recordRoutes`/`shippingMultiplier`/`warTariffFor`, no Rng |
| `'destroyed'` outcome + incident | `resolveRaid`/`applyResult` (step 5–6), reuse existing `rng.next()` | pure FNV hash for id/name |

`isNoOpOrder` (engine.ts:102): `firstExport` no-op when `quantity<=0`; `createStandingRoute` no-op when
`batch<=0`; `openingSurvey` never a no-op. **Do not** add any to `IDLE_BUILD_KINDS` — these are real decisions.

---

## 5. Fog, worker, bots, UI

- **Fog** (all in `buildClientState`): `openingState`/`standingRoutes`/`standingRouteSuggestion` are
  **self-only**. `openingSurvey`'s private reveal rides the existing `surveyedSystemIds` fog — no new
  code. `survey_ping` is **public + attributed** (the probe is a public act; the *intel* it revealed
  stays in the prober's fog). `auction_interest` is **aggregate-only** (`count` of distinct bidders,
  no identities — mirrors the `marketPressure` pattern). `automation` events are redacted to the owning seat.
- **Worker** ([game.ts](worker/game.ts)) — minimal: widen `stateFor`/`spectatorState` phase types to
  `GamePhase`; pass `gamePhase(engine)` (already computed). **No new tables, no new instant types, no
  submit-gate/race-guard/reconstruct change** — opening orders and standing-route orders ride existing
  `game_orders` and replay unchanged. `games.phase` stays advisory.
- **Bots** — v1 minimal: bots emit no opening surveys (human-facing) but **may** emit one `firstExport`
  of their top startup resource so the all-bot sim keeps liquidity; `standingRoutes` stays `[]` for bots
  (a human convenience). **Decision: do NOT branch `run()`'s turn 1** — the only balance-relevant opening
  effect (startup stockpile) is constructor-seeded, so it applies to both `run()` and `stepTurn()` paths;
  the interactive effects are human-order-driven and correctly absent from all-bot sims.
- **Web UI** (accounts for the existing map-first store): a phase-conditional **Opening panel** (2
  surveys + first-export from startup stock); **Pixi markers** for `survey_ping`/`auction_interest`;
  a **Standing Routes panel** (approve suggestion / toggle / remove + `readyToLaunch`); an **Automation
  digest** in the report (filter `reports[last].events` for `type === "automation"`). `format.ts:298`
  prefers `convoy.name` when present.

---

## 6. Build sequence (each increment independently shippable)

1. **Phase enum + lifecycle.** `GamePhase` collapse, `gamePhase()` rewrite, `TurnReport.phase += "opening"`,
   `stepTurn`→`runOpeningTurn` (initially just `= runNormalTurn`), widen worker phase types, **fix the
   3 `store.ts` gates**. *Payoff:* turn 1 is labeled; nothing breaks.
2. **Startup stockpile + home repair.** `seedStartupInventory` in the constructor; `startupInventoryTurns:2`
   tuning. *Payoff:* turn 1 is non-empty; the sim immediately shows more turn-1 convoy liquidity.
3. **First export (maiden voyage).** `FirstExportOrder` + named convoy + Opening card. *Payoff:* the most
   satisfying turn-1 action — a named first shipment on the map.
4. **Opening surveys.** `OpeningSurveyOrder` (2-slot cap, `surveyReveal` reuse) + `survey_ping`/`auction_interest`
   markers + Pixi layer. *Payoff:* free intel; see who's scouting where.
5. **Standing trade routes.** 3 order kinds + `standingRoutes` + auto-launch + `automation` event + UI panel +
   digest. *Payoff:* convoys flow turns 2–5 with no busywork — **the retention hook**.
6. **Rare-destroy named incident.** `'destroyed'` outcome (tune the rarity gate against `tests/raiding.test.ts`)
   + FNV hashes + `diplomaticIncident` headline + grudge weight 3 + `incidentIds`. *Payoff:* a rare, named,
   attributed catastrophe that creates a story and a grudge.

---

## 7. V1 scope cut

**Build (fun core for turns 2–5):** increments 1–5. Increment 6 is high-fun and cheap (one outcome
branch + two hash helpers + one event) — include if time allows; it's the only conflict-touching piece.

**Defer (do not over-engineer):**
- Real sealed-bid auction round / rival bid economy (homes stay constructor-assigned; `auction_interest`
  is a static aggregate ping at most).
- Branching `run()`'s turn 1; any new DB table/column for phase (derive it).
- **Named-Incidents epic F1** (per-seat incident redaction) and F8 dossiers — v1 leaves rare-destroy
  attribution **public** (acceptable: full-destroy is rare and grave). Auto-war-on-destroy.
- `patrol_presence`/`evidence` markers, route editor beyond enable/disable, multi-route/non-Hub/buy/transfer
  routes, market-depth coupling for standing sells, `publicCargoClass`, neutral convoys.

---

## 8. Risks & decisions for you

**Risks:**
- **`store.ts` phase gates (most likely breakage):** the enum rename touches 3 sites — `s.phase === "play"`
  (line 235, the submit-enabled gate) must become `!== "over"` or **the submit button silently breaks on
  turn 1**. Typecheck catches the literal mismatch; the logic mistake it won't — verify the opening submit manually.
- **Determinism:** `seedStartupInventory` must run after the Fisher-Yates shuffle and consume zero Rng —
  pin per-seed stockpile values in a test; any digest change beyond the stockpile delta is a bug.
- **Standing sells bypass `market.clear`** (sell at posted price, no slippage). Fine for turns 1–5 with
  few routes; monitor via sim for price suppression.
- **Rare-destroy tuning:** don't merge increment 6 on an unverified rarity constant — sweep `raidOutcomes.destroyed`.

**Decisions needed:**
1. **Public rare-destroy attribution** without F1 (a rival sees the attacker on every full destroy) — accept
   for v1, or pull F1 forward (significant scope)?
2. **First-export fuel:** `makeConvoy` auto-buys fuel at market; a turn-1 corp may pay for it. Accept
   (same as any export, show net payout in the card), or grant a fee-free maiden-voyage charter perk?
3. **Standing route same-turn launch:** a route approved this turn launches this same resolution if stock
   qualifies (more responsive) — confirm that feel vs. launch-next-turn-only.
4. **Homes with no tradable production:** keep them (empty trade seed, no first-export affordance), or re-roll?

I can start on **increments 1–3** (the interactive turn-1 core: phase + startup stock + named first export)
and validate with `npm run sim` before/after — that's the smallest slice that makes Turn 1 feel alive.
