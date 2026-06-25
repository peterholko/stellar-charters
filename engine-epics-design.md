# Stellar Charters — Engine-Side Design for the Deferred v2.4 Epics

This is the **engine design** for the six deferred epics from the v2.4 map-first
reality-check (the items that change balance, fog, or the event-sourced replay model and
therefore need design sign-off before code). It is grounded in the current engine and was
adversarially reviewed against the real source; every blocker the review found is folded in
below as **"Corrections from review."**

Epics: **Lane Projects**, **Convoy Hedges** (insure/decoy/reroute/abort), **Free-Operator
Contracts**, **Blockades**, **Acquisition-Pressure**, **Named Incidents + Evidence Trails**.

No code has been written. This document is the plan.

---

## 0. Engine invariants every epic must respect

These are non-negotiable (from `CLAUDE.md` + the engine):

1. **Pure & deterministic.** `src/engine/` has no `node:*`, no `Date.now()`/`Math.random()`;
   all randomness flows through the seeded `Rng` (`rng.ts`). `tests/determinism.test.ts` guards it.
2. **Event-sourced.** The authoritative game is rebuilt by **replaying `(seed, players,
   per-seat orders)`** through the engine (`worker/game.ts` `reconstruct()`). So every new
   mechanic is **new Order kind(s) + deterministic resolution**; new "persistent" state lives
   in-memory and is rebuilt each replay (exactly like `this.wars`, `corp.grudges`,
   `this.convoys`) — never serialized to D1.
3. **Back-compat.** New order kinds are additive; the resolver `default: break` ignores them,
   so historical logs replay byte-identically. No old turn is ever made to *require* a new order.
4. **Section 20 order + no same-turn chaining.** Goods/effects that arrive during resolution are
   only available next turn. Every new step states where it sits.
5. **Ledger invariant.** Every credit move is a `LedgerEntry {corpId, signed delta, cause}`;
   `Σdelta == Δcredits` per corp per turn (`tests/ledger.test.ts`). Inter-corp transfers net to zero.
6. **Fog lives in `buildClientState`.** Per-seat redaction happens there, not in client display code.
7. **Balance-testable.** New tuning lives in `config.ts`; the headless all-bot sim must exercise
   it; bots must emit the new orders or the load-bearing `ledger`/`determinism` suites never touch
   the new code paths.

---

## 1. Shared foundation — build this first

The review's single most important finding: **the six epics share more plumbing than they
have unique code, and several share the *same* blockers.** Build these primitives once, as a
single reviewed PR, before any epic lands. (~40% of total risk is here.)

### F1. Per-seat **event redaction** in `buildClientState` — *gates 3 epics*
Today `clientState.ts:515` filters **only `ledger`** per seat; `reports[].events[]` ship
**unredacted** to every seat (the web digest merely declines to *render* third-party raids —
that is display filtering, not fog). Add `redactEventForSeat(event, seatId, witnessSet)` that:
- strips `attackerId`/`accepter`/`sponsorEvidence`/`incidentId`/`incidentName` from events the
  seat is not a party to or witness of, and
- drops events the seat cannot witness entirely.

This is a **prerequisite** for named-incidents (dossier fog), fo-contracts (strike deniability),
and convoy-hedges (decoy/insurance must stay hidden). Also redacting `sponsorEvidence` to
non-parties is what makes evidence-sale convey anything. **Risk:** this changes the payload every
client receives — gate behind `incidents.enabled` and verify `web/src/match/digest.ts` still
renders, or scope the redaction to the dossier-derivation copy only.

### F2. **LaneInfra** map + **effective-lane-stat accessors on `Galaxy`** — *gates lane-projects + blockades*
`WarpRoute.{stability,exposure,authority,capacity,transitTime}` become the immutable **baseline**
(grep confirms only `route.charted=true` is ever assigned). Live values are computed at read time:
`effective = clamp(baseline + projectBonuses − blockadeEffects)`.
- Hold derived per-lane state in **one** container `Map<routeId, LaneInfraState>` on the engine
  (lazily inserted; rebuilt empty each replay like `this.wars`). Both lane-projects
  (`operatorId/projects`) and blockades (`Blockade` records) attach here.
- **Put the live-stat computation on `Galaxy`**, not the Engine. Both the engine *and the web
  client* already build a `Galaxy` (`clientView.ts:64`), and the **pure** `movement.ts` functions
  take a `Galaxy`. This is the fix for the lane-projects blocker that `navBuoys`/`expandCapacity`
  touch transit/capacity which are read in **far more than 3 call sites**: `routeWeight`
  (`galaxy.ts:111`), `shortestWarpPath` (`galaxy.ts:178`), `effectiveSegmentTime`
  (`engine.ts:2875`), `laneFuelFactor` (`movement.ts:37`), `planFleetMove` (`movement.ts:75`),
  fleet transit (`engine.ts:1179/2051/2078`), and the client preview (`clientView.ts:114`).
  Routing live stats through `Galaxy` keeps `movement.ts` a pure function and preserves
  client/engine fuel parity.

### F3. **`localDefenseFor` refactor** — *gates lane-projects patrol + blockades*
`localDefenseFor` (`engine.ts:2941`) gates **all** defense on `sys.owner === convoy.owner`, so a
patrol/blockade owned by a non-convoy-owner contributes **zero** as written (both verifies caught
this). Refactor once to add a lane-attached term **outside** the owner branch:
`laneDefense = patrolDefense(routeId) + blockadeDefense(routeId, convoyOwner)`, applied at the raid
call sites (`engine.ts:1699/1729`), capped by a single shared `maxPatrolDefense`. Patrol hardens the
lane for its traffic; blockade hardens it only against *third-party* raiders (never the blockader).

### F4. **`transfer(fromCorp, toCorp, amount, cause, detail)`** helper
Emits the two paired ledger lines (`−amount`/`+amount`) in one call, skipping zero amounts. The
single chokepoint that makes the inter-corp net-to-zero invariant structural instead of
hand-written twice per epic. Used by lane tolls, blockade tariffs, contract finance, insurance
premium/claim (financier).

### F5. **Engine-held escrow primitive** — *fo-contracts*
`escrow: Map<contractId,{corpId,amount}>` + `escrowReserve/Release/Refund`, each a single signed
`credit()` line. Cross-turn pairs are individually correct (per-turn `Σ==Δ` holds). **The expiry
sweep must be exhaustive** — every contract terminal transition routes through exactly one
release-or-refund; assert `escrow` is empty at game end.

### F6. **`respliceConvoyPath(convoy, fromPosition, viaSystemId?, blockedSet?)`** — *convoy-hedges reroute + blockade divert*
Recomputes the path suffix via `shortestWarpPath`, splices `path/routeIds`, resets
`segmentTurnsLeft` to the new current segment's effective time, returns the fuel delta. Both
reroute and deny-divert do exactly this — build once.

### F7. **`pendingStockpile` next-turn staging buffer** — *convoy-hedges abort*
Returned/aborted cargo goes here, **not** straight to `sys.stockpile`, and is drained at the top of
next turn's production step. Fixes the verify blocker that step-8 upkeep `consumeOrImport` reads
`sys.stockpile` directly (`engine.ts:2407`) — writing aborted cargo straight in lets a recalled
food convoy feed the colony the *same* turn (no-same-turn-chaining violation + exploit).

### F8. **Incident-identity helpers** — *named-incidents core, reused by fo-contracts evidence*
`incidentHashId(seed,turn,anchorKey)` and `incidentName(seed,turn,anchorKey)` — pure FNV-1a like
the existing `evidenceHash` (`engine.ts:108`), zero Rng. Stamped on raid/sabotage/invasion events.

### F9. **PlayerView extensions for bots**
Add `laneInfra`/effective-stat access, `blockades`, `contracts`, and `corp.pressure` to
`PlayerView` (`viewFor`, `engine.ts:3044`). Without this, bots can't fund lanes, route around
tolls/blockades, accept contracts, or defend pressure — and the **all-bot** `ledger`/`determinism`
suites never exercise the new inter-corp paths.

---

## 2. Merged Section 20 resolution order

All new resolution, in combined order (existing steps in plain text, **new/changed in bold**):

| Step | Method | New work |
|------|--------|----------|
| 1.5 | `resolveAdministrative` (existing) | **+cases:** `laneProject`, `blockade`, `contractOffer/Accept/Cancel`, `investorBriefing`, `exposeDossier`. Lane projects fold in here (not a separate 1.45 step); contract escrow + finance net-zero transfer happen here. |
| 3–4 | `resolveMarketAndLaunch` (existing) | **Collect** `insuranceByLane`/`decoyByLane`/`financierOffers` before the fills loop (like `escortBySystem`); fold hired-escort-contract strength into the escort pool; **bind** insurance/decoy + charge premium/fee in `makeConvoy`. |
| 5–6 | `resolveRaids` (existing) | In `applyResult`, strict sub-order: **stamp incident id → existing `sponsorEvidence` → insurance payout → strike-contract fulfilment.** Decoy `priorityMult` applies to target **selection** before `resolveRaid`; `spoofContactMult` scales the `rng.chance` arg (no extra draw). Patrol/blockade defense via F3. |
| 6.5 | `resolveRaids` sabotage tail (existing) | **Stamp** incident id/name on sabotage event. |
| **6.55** | **`resolveBlockades` (NEW)** | Expire (`turnExpires<=turn`), recompute each blockade's strength from stationed force at the mouth, run strength contest (incumbent wins ties). Pure threshold math, **zero Rng.** |
| 6.6 | `resolveFleetMovement` (existing) | unchanged |
| 6.7 | `resolveInvasions` (existing) | **Stamp** incident id; **emit `capturedDepot` flag** on the invasion event for acquisition-pressure. |
| **6.8** | **`resolveConvoyOrders` + `resolveContracts` (NEW, merged)** | (1) reroute/abort in-flight convoys (returned cargo → F7 buffer); (2) escort fulfilment + finance repayment + **exhaustive expiry sweep** + evidence fulfilment. Must run **after** raids decide survival, **before** arrivals decrement `segmentTurnsLeft`. |
| 7 | `resolveArrivals` (existing) | **Before** the `segmentTurnsLeft -= 1` (`engine.ts:2121`): **blockade gate** (deny-divert/delay/tariff) **then** lane toll on completed legs. Both inter-corp via `transfer()`. haul/smuggle fulfilment detected in `deliverConvoy`. |
| 9 | `updateSentiment` (existing) | **`applyPressure(ordersByCorp)`** at the top (signature change — see correction); pressure drag multiplies `tradedBase` at `engine.ts:2559`. |
| 9.5 | `resolveEquity` (existing) | unchanged except the one `tradedBase` line gains the drag multiplier. |

Two genuinely new steps: **6.55 `resolveBlockades`** and **6.8 merged convoy/contract**. Lane
projects do **not** get a standalone 1.45 step (fold into 1.5).

---

## 3. New ledger causes (deduped namespace)

| Cause | Epic | Shape |
|-------|------|-------|
| `laneToll` | lane-projects | inter-corp, net-zero via `transfer()` (collapse the design's `laneToll`/`laneTollIncome` into one cause, opposite signs) |
| `laneUpkeep` | lane-projects | one-sided sink |
| `blockadeTariff` | blockades | inter-corp, net-zero — **charge as a clean transfer at the gate; do NOT also reduce `convoy.payout`** (double-charge fix) |
| `contractEscrow` / `contractPayout` / `contractRefund` | fo-contracts | one-sided against the escrow Map; cross-turn pair nets to zero |
| `contractFinance` | fo-contracts | inter-corp, both legs same turn, net-zero (write-down still nets) |
| `insurancePremium` / `insuranceClaim` | convoy-hedges | inter-corp net-zero with a financier; one-sided sink/source with Authority |
| `decoyFee` | convoy-hedges | one-sided sink |
| `convoyAbort` | convoy-hedges | one-sided source (fuel refund) |
| `investorBriefing` | acquisition-pressure | one-sided sink |
| `intelExpose` | named-incidents (only if `exposeDossier` adopted) | one-sided sink |

**Reuse, don't add:** lane-project level costs reuse existing `build`; blockade station fuel reuses
existing `fuelMove`. **Capital-flow fix (shared):** `investorBriefing`, `contractEscrow/Payout`, and
`insurance*` are capital/risk flows — add them to the `recentEarnings` netting at `engine.ts:690`
alongside `shareTrade`, or they pollute the `momentum` valuation part and suppress next turn's
`earningsImpulse`.

---

## 4. The six epics

Each is **effort L** except named-incidents (**M**). All passed determinism/replay review; the
listed corrections close the implementability gaps.

### 4.1 Lane Projects
**Goal (P1-5).** Fund a `laneProject` to mutate a lane's live stats: Stabilize, Navigation Buoys,
Sensor Net, Patrol Station, Expand Capacity, Secured Corridor (capstone), Toll Charter (operator
taxes others' traffic). First builder becomes the lane `operatorId`.

- **Order:** `LaneProjectOrder { routeId; project }` — one order advances one level (chunky; caps
  2–4). Eligibility: own/adjacent an endpoint of a charted lane; FOs excluded (colonial infra, like
  depots); Toll Charter operator-only + requires `minPriorProjects`.
- **State/types:** `LaneInfraState` in the F2 container (not on `WarpRoute`). Stats are a pure
  projection `f(baseline, projects)` — replay-safe.
- **Resolution:** 1.5 admin (enqueue + pay via `build`); per-level effect applied with a one-turn
  `appliedTurn < this.turn` delay (gameplay no-same-turn protection — *not* a determinism
  requirement: `resolveRaid` draws are input-independent). Toll charged in `resolveArrivals` on
  completed non-owner legs; upkeep + decay in step 8.
- **Fog:** live stats + `operatorId` + `tollRate` **public** for charted lanes (physically
  observable); `tollAccrued`/toll income stay in the operator's own seat ledger.
- **Config:** `tuning.laneProjects` block with per-project `{cap, perLevel, creditCost, upkeep,
  mats}`, plus `minExposure:0.1` (raid contact never reaches 0), `maxPatrolDefense:4`,
  `valuation.laneProjectValue:120`/level.
- **Corrections from review:** ① **toll must use live `quantity × basePrice`, not `convoy.value`**
  (which is set at launch and never reduced by raids — taxing it over-charges plundered convoys).
  ② Value lane projects in a **separate pass keyed by `operatorId`**, outside the per-system
  valuation loop (route projects belong to no owned system). ③ Patrol defense term goes outside
  the owner-gate (F3). ④ Live-stat reads wired into **all** call sites + `clientView.ts` (F2) or
  client fuel previews diverge from server bills.
- **Open Qs:** restrict Toll Charter to lanes the operator owns an endpoint of (anti-grief)? Fold
  toll into `routeWeight` so convoys deterministically dodge gouging? Who besides the operator may
  build — allies only?

### 4.2 Convoy Hedges (insure / decoy / reroute / abort)
**Goal (Rule 7, P1-6/8).** The hedges the design doc promises but never built.

- **Orders:** `insureConvoy` + `decoyPosture` are **per-lane policies** keyed `(origin, resource)`
  like `escortBySystem` (convoys have no id at lock — they're created during resolution);
  `reroute`/`abortConvoy` target an in-flight convoy by id; `offerUnderwriting` lets a
  Free-Operator be the rival-side insurer.
- **Resolution:** premium/decoy-fee charged at launch (pure arithmetic over first-hop `exposure`);
  decoy `priorityMult` de-prioritizes a masked convoy in the raid target sort and `spoofContactMult`
  scales the existing `rng.chance` arg (no new draw); insurance payout in `applyResult` after
  `cargoValueLost`; reroute/abort in step 6.8.
- **Fog:** rivals **always** see `insured=false`, `decoy=null` (Section 11 hides insurance/posture);
  `value` stays public, so the mask works purely by engine de-prioritization — a fogged convoy is
  indistinguishable from a thin one (the intended bluff).
- **Config:** `tuning.hedges` — `insurance.maxCoverage:0.8` (**never 100% — no free risk removal**),
  `baseRate:0.06 × exposure`; `decoy {priorityMult:0.45, spoofContactMult:0.6}`; `financier.defaultRate:1.1`.
- **Corrections from review:** ① **`makeConvoy` has 5 callers, not 3** — `instantBuy`/
  `instantDispatch` run in the planning window *before* policies are collected; **exclude instants
  from insurance/decoy** (document it). ② **Aborted cargo must land in the F7 staging buffer**, not
  `sys.stockpile`, or step-8 upkeep consumes it the same turn (exploit). ③ **Fuel refund** must
  recompute per-segment fuel and refund only what was actually charged (`chargeFuel` skips
  unaffordable bills — naive refund mints credits). ④ Financier capacity binds in the **fills
  iteration order** (the natural order), not "by corp id."
- **Open Qs:** can any charter underwrite, or Free-Operators only? Should `spoof` be a research
  unlock? Should reroute/abort carry an explicit penalty beyond opportunity cost?

### 4.3 Free-Operator Contracts
**Goal (P2-13).** Inter-corp service jobs: escort-for-hire, deniable strike, haul, smuggle, finance,
evidence-sale — the missing FO income layer.

- **Orders:** `contractOffer` / `contractAccept` / `contractCancel` (no `fulfil` order — fulfilment
  is an engine-side deterministic **check**, so it can never desync). Gated `availableFromTurn:11`
  (Section 18 mid-game; matches the bot FO gate at `strategy.ts:641`).
- **Resolution:** accept escrows the reward (F5); fulfilment checks per type — escort pays iff the
  protected convoy survives; strike pays on a confirmed `damaged`/`plundered` outcome the accepter
  caused; haul/smuggle on delivery match; finance is a same-turn net-zero transfer with a scheduled
  repayment obligation. First-accept-wins via `this.corps` order + per-corp order order.
- **Corrections from review:** ① **Fog is the blocker** — `contractAccepted.accepter` would ship to
  every seat via the unredacted event stream (F1 fixes this); strike deniability fails without it.
  ② **Evidence-sale is a no-op until `sponsorEvidence` is per-seat redacted** (it's currently
  public) — depends on F1. ③ **Pin strike fulfilment to one site** (`resolveContracts` at 6.8, with
  a `status==='active'` guard) — `applyResult` can fire multiple times per interdict (multi-hit) and
  double-pay. ④ **Exhaustive expiry sweep** or escrow leaks and breaks net-to-zero (F5). ⑤ Escort
  strength augments the **offeror's** convoy from the **accepter's** commitment — needs new keying,
  can't reuse `escortBySystem`. ⑥ Export `evidenceHash`.
- **Open Qs:** escort payout lump-sum vs per-surviving-turn? Does hiring a strike make the **sponsor**
  attributable (diplomatic cost) or stay fully deniable? Evidence-sale: single raid vs standing
  subscription?

### 4.4 Blockades
**Goal (P2-14 minor → full).** A **posture** (not a one-turn strike, not invasion): commit a
stationed raider fleet to a lane/mouth and control traffic — `deny` (Dijkstra-divert around it, or
hold), `delay` (+N transit), or `tariff` (per-unit toll). Persists with `turnExpires`, contested by
counter-stationing force.

- **Order:** `BlockadeOrder { routeId; posture; fromSystemId }`; anchored at a non-hub endpoint the
  blockader has stationed raider force at. Hub mouths are unblockadeable (Authority-protected).
- **Resolution:** establish in 1.5; **6.55 `resolveBlockades`** expires + recomputes strength +
  runs the contest (pure threshold, **zero Rng** — a draw here would shift every downstream raid);
  the deny/delay/tariff gate in step 7. `shortestWarpPath` gains an optional `blockedRouteIds` set
  for real diverts.
- **Fog:** blockade existence/owner/posture/turns-left **public** (a visible fleet; convoys route
  around it); exact **strength banded** for non-owners (same thresholds as `ClientContact.forceEstimate`).
- **Corrections from review:** ① **deny gate fires at the segment boundary** (when
  `segmentTurnsLeft` hits 0 and `position` is about to advance onto a blocked next segment), not
  "can't enter the current segment" — the convoy is already mid-crossing when the gate runs.
  ② **New `blockadeForceAt(mouth, corp)` helper** — `stationedDefense` excludes raiders (`!s.raider`)
  and `raidStrength` is corp-global; neither gives per-mouth raider strength. ③ **Tariff is a clean
  `transfer()`, never a `convoy.payout` reduction** (double-charge fix). ④ Lane-hardening goes
  outside the `localDefenseFor` owner-gate (F3). ⑤ **Re-charge detour fuel** on divert (else free
  distance). ⑥ Feature-gate via `tuning.features.blockade` to dodge the shallow-merge footgun.
- **Open Qs:** does a deny/tariff blockade **declare war** (recommended) or only add a grudge?
  Hub-protection: literal hub mouths only, or all high-`authorityPresence` lanes? FOs allowed to blockade (recommended yes)?

### 4.5 Acquisition-Pressure
**Goal (P1-9).** Thread map-economic stress (lost depot, blockaded/failed convoy, repeated delays,
starvation, brown-out, missed debt service, exposed exports) into takeover pressure, and expose a
**decomposed `acquisitionVulnerability`** read. Today only raid/invasion/war/near-distress feed
sentiment.

- **Model:** a per-corp `pressure` stock that decays toward 0 and multiplies **`tradedBase` only**
  (`engine.ts:2559`) — **book valuation, debt ceiling, and the 0.5×shares control threshold stay on
  pure book value.** That separation is the structural anti-spiral guarantee. `maxDrag:0.30` vs
  sentiment's `[0.5,1.6]` keeps pressure subordinate; `decay:0.18` heals over ~5 calm turns.
- **Only new agency:** `investorBriefing { spend }` — a defensive PR spend that buys down the
  submitter's *own* pressure (no targeted-pressure order ⇒ no griefing vector).
- **Fog:** `pressure`/`pressureParts`/`acquisitionVulnerability` **public** (computed from
  already-public events + convoy `value`), matching public sentiment/valuation. `causes` is
  `pressureParts` flattened for the Finance UI to trace each contributor.
- **Corrections from review:** ① **`updateSentiment` takes no orders today** — thread
  `ordersByCorp` in (or consume the briefing at the start of `resolveEquity` before `tradedBase`).
  ② **Net `investorBriefing` out of `recentEarnings`** (`engine.ts:690`) or the PR spend depresses
  the corp's own momentum + suppresses its `earningsImpulse` (self-defeating double-count).
  ③ Guard the brown-out scan with `sys.production?.powerFactor` (it's `undefined` for
  processor-less systems). ④ Recompute `interest = debt × debtInterest` (the `debtInterest` ledger
  line carries `delta:0`). ⑤ Bump `RULESET_VERSION` 12→13 (resolution-rule change; abandons the
  in-progress live game — coordinate with the user). ⑥ Watch the **equity-financing channel**: the
  same `tradedBase` discounts a stressed corp's own-share sale, a spiral path the "book untouched"
  argument doesn't cover — verify in the sweep.
- **Open Qs:** is `acquisitionVulnerability.score` fully public (hands attackers a targeting read) or
  is the decomposed `causes` self-only? Is `investorBriefing` the right (and only) agency?

### 4.6 Named Incidents + Evidence Trails — *effort M, lightest*
**Goal (P1-10).** A **derived** (zero-new-persistence) named-incident + cross-incident evidence
dossier layer. Stamp a deterministic `incidentId`/`incidentName` (F8) on raid/sabotage/invasion
events; aggregate `sponsorEvidence` per `(suspect, victim)` into a per-seat dossier derived in
`buildClientState`.

- **Anchor keys:** `r:routeId|c:convoyId` (raids), `s:systemId|siteKey` (sabotage), `s:systemId|inv`
  (invasions) — so same-convoy strikes in a turn coalesce, distinct lanes don't.
- **Fog:** an incident is visible iff you're a party or a witness (own the anchor system, own a
  system adjacent to the anchor route, or had a sensor contact). Confidence graded (deniable raids
  0.25–0.90) vs binary (1.0 for open ship raids); sabotage/invasion are always fully attributed.
- **Corrections from review:** ① **Fog is NOT "reuse" — it's net-new** (F1). Without it the dossier
  derived from `reports` reads the *global* incident stream and leaks rivals' suspects. ② **Drop the
  optional `exposeDossier` order** for v1: its eligibility check ("you already have a witnessed
  deniable incident vs target") is unimplementable — the engine clears `this.events` every
  `stepTurn` (`engine.ts:481`) and keeps no report history; `resolveAdministrative` can't scan prior
  incidents. Ship the pure read-model first; if `exposeDossier` returns later, gate it on
  `me.grudges[target]` (the only retained attribution signal) + the current turn's events.
- **Open Qs:** dossier aggregation linear-capped sum vs probabilistic `1−Π(1−eᵢ)` (recommended)?
  Witness scope: route-adjacency (fun) vs sensor-only (stricter)?

---

## 5. Cross-epic conflicts (and resolutions)

1. **Three route-defense sources** (lane-projects patrol, blockade `defenseContrib`, interdiction)
   all hit the owner-gated `localDefenseFor`. → **F3** refactor once; single shared `maxPatrolDefense` cap.
2. **Toll + tariff on one leg** (a lane that's both toll-chartered and blockade-tariffed). → Legit
   (two actors), but **cap the combined skim at ~35% of live cargo value**; apply tariff first
   (fleet present), then toll on the remainder. *(User decision — see open questions.)*
3. **Reroute (6.8) vs deny-divert (7)** both re-path a convoy. → Player reroute runs first, sets a
   `pathTouchedThisTurn` flag; the blockade gate skips a *second* reroute (still applies delay/tariff).
   Both use **F6**.
4. **Pressure `convoyLoss/Delay` vs sentiment `raidImpulse`** on the same raid. → Intended (mood vs
   accumulating stock), but bound the combined `tradedBase` floor (`0.5 × (1−0.30) ≈ 0.35`); keep
   pressure reading **only events** and sentiment **only its impulses** — no feedback loop.
5. **`investorBriefing`/contract/insurance flows polluting `recentEarnings`.** → Net all capital/risk
   causes out at `engine.ts:690` (shared one-line fix).
6. **Three epics assume event redaction that doesn't exist.** → **F1**, built first; named-incidents
   owns the witness-set, fo-contracts adds accepter-stripping, convoy-hedges relies on it.
7. **Lane-stat threading vs `movement.ts` purity.** → **F2**: live stats live on `Galaxy`, which both
   engine and client construct, preserving the pure-function client/engine parity contract.

---

## 6. Recommended build order

1. **Foundation A** — F1 event-redaction + witness-set (highest-risk fog change; gates 3 epics).
2. **Foundation B** — F2 LaneInfra + Galaxy effective-stats, F3 `localDefenseFor` refactor, F4
   `transfer()`, F5 escrow, F6 `respliceConvoyPath`, F7 staging buffer, F8 incident identity, F9
   PlayerView. *Single reviewed PR — ~40% of total risk.*
3. **named-incidents** (M) — pure read-model; proves the fog layer end-to-end before heavier epics.
4. **lane-projects** (L) — exercises the effective-stat plumbing across all call sites first.
5. **blockades** (L) — reuses LaneInfra + lane-defense + `respliceConvoyPath` + new per-mouth helper.
6. **convoy-hedges** (L) — reuses `respliceConvoyPath` + staging buffer + redaction.
7. **fo-contracts** (L) — consumes the most foundations (escrow, redaction, incident identity).
8. **acquisition-pressure** (L) — **last**: reads the outputs of every other epic's events, so its
   impulse tuning calibrates against the full event stream and isn't re-tuned.

Each epic's PR ends with: `npm run typecheck`, `npx vitest run` (extend `ledger`/`determinism`
suites), and `npm run sim -- --games 200 --players 8 --turns 42 --procedural` with the epic's new
metrics + a back-compat replay assertion (pre-feature order log → byte-identical metrics).

---

## 7. Decisions needed from you (before build)

These are genuinely yours — they change feel/balance, not just implementation:

1. **`RULESET_VERSION` bump (acquisition-pressure).** It changes share-trade execution, so it
   abandons the in-progress always-on live game. OK to reset, or stage behind a flag?
2. **Combined toll+tariff cap** (~35% of live cargo value) — accept, or allow a leg to be taxed by
   both a charter and a blockade without a shared cap?
3. **Does an aggressive blockade declare war** (feeds the aggressor-tariff loop) or only add a grudge?
4. **`acquisitionVulnerability` fully public**, or score-public / causes-self-only?
5. **Insurance underwriters:** Free-Operators only, or any charter?
6. **Strike-for-hire attribution:** stay fully deniable, or does hiring it make the *sponsor*
   attributable at high evidence (a diplomatic cost)?
7. **Ship `exposeDossier`** later, or keep named-incidents purely read-only?

I can turn any one epic (plus the foundation it needs) into an implementation PR on request — the
foundation PR (F1–F9) is the right first build.
