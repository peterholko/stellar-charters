# Research & Specialization — Design (Section 28)

**Status:** **Phases 1–2 implemented** (Section 28). P1: RP economy (Research Labs + population), the
tech tree with live `researchMods` effects, Research screen + queue, bot doctrines, conquest
tech-seizure (1–3 random). P2: Warp-Drive range ladder folded into Navigation (`grantsRangeTier`; old
`researchRange` removed), Terraforming (`terraform` order), Capital Shipyards (cheaper Range-5+ hulls),
Advanced Metallurgy (cheaper megastructures). P3: six galaxy-unique secret-project capstones (one per
division, race-to-claim), Industrial Espionage (steal a rival tech), and tech transfer on acquisition.
Tree now 28 techs; balance-swept (leader/median ≈13, capstones land ~1 per half of games). **The full
system is implemented.** Inspired by **Master of Orion 2** (field tree with
"pick-one" tier choices you can't un-pick; trade/steal what you skipped) and **Alpha Centauri** (research
as the spine of an asymmetric empire; one-time *secret projects*; tech feeds society / units / facilities).

## 1. Design goals

- **You must specialize.** Six research *Divisions*; the 42-turn game gives a focused charter enough
  Research Points (RP) to go deep in **~2 divisions and dabble in a third** — never the whole tree.
- **Cool, distinct branches** that change *how* you play (a Prospectus baron, a Fabrication
  powerhouse, a Navigation trade empire, a Colonial tax engine, a Security hegemon, an Acquisitions
  raider), not just +5% modifiers.
- **The tree you skip is still reachable — by force or guile.** The only way to hold another
  division's tech is to **acquire** a rival corp (you inherit its tech), **steal** it (espionage), or
  **conquer** the charter holding it. Research therefore feeds the *war* and *finance* layers, not a
  parallel silo.
- **Races, not parades.** Each division's capstone is a galaxy-unique **secret project** — only the
  first charter to finish it gets the prime benefit, so no two endgames look the same.

## 2. How research is powered (the RP economy)

Research is a charter-wide pool fed by your colonies — so it competes with the rest of the build
economy and *is itself* a specialization choice.

- **Research Lab** — a new per-body colony building (Section 24 build menu) alongside factory/reactor.
  Produces `labRpOutput` RP/turn, **draws power** (like a factory) and costs credits + **components**
  (electronics) to raise. Building labs means *not* building factories → the core tradeoff.
- **Population base** — each populated colony emits a little RP by stage (a metropolis R&D campus
  ≫ an outpost), so a Colonial tax empire also quietly funds science.
- **Pool & focus (MoO2-style).** Each turn the charter's RP flows into **one active project** (or an
  ordered queue); when accumulated RP meets the tech's cost it unlocks and RP rolls to the next.
- **Scarcity knob.** Sum of all tech costs ≈ **4–5×** what a focused lab economy makes in 42 turns →
  you complete ~20–25% of the tree per game. Tuned via `labRpOutput` + per-tech RP cost.

## 3. The flow

1. Build Research Labs (and grow population) → RP/turn rises.
2. Open the **Research** screen (new nav tab): the six divisions as a tree; pick your active project.
3. RP accumulates with a visible "~N turns to complete" (same idea as the construction queue).
4. Completing a tech applies its effect immediately (unlocks a building/recipe/hull, bumps a tunable,
   or fires a one-time secret project). Choice nodes **lock out the alternative** in that division.

## 4. The six Divisions (the meat)

Each Division is a short spine **T1 → T4**. Some tiers are a **CHOICE** (pick one, lock the other).
Each **T4 is a secret-project race** (first charter only). A few T4s have a **cross-division prereq**
to create real breadth-vs-depth tension.

### Prospectus Division — *Extraction sciences*
*Fantasy: the resource baron who owns the supply.*
- **T1 Improved Extractors** — extractor cap 3→4; +yield per level.
- **T2 Deep-Core Drilling** *(choice)* — finite deposits deplete ~30% slower (sustain late game).
- **T2 Hydrofracturing** *(choice)* — +richness on renewables (ice/gas/bio); never-dry income.
- **T3 Stellar Lifting** — harvest gas-giant / star-corona deposits at a premium; shrug off stellar dips.
- **T4 Antimatter Containment** *(secret project)* — unlock antimatter extraction **and** its use as a
  capital-hull / megastructure fuel; the galaxy's only exotic-fuel monopoly.

### Fabrication Division — *Industrial engineering*
*Fantasy: out-build everyone.*
- **T1 Assembly Lines** *(choice)* — factory output +20% **or** building credit cost −15%.
- **T2 Modular Construction** — construction points/turn **+50%** (everything builds faster — directly
  speeds the Section 24 queue).
- **T2 Lean Manufacturing** *(choice with Modular)* — building **materials** cost −30%.
- **T3 Advanced Metallurgy** — unlock a new tier-4 recipe (**superalloys**) + cheaper megastructures.
- **T4 Nanofabrication** *(secret project)* — a galaxy-unique **auto-foundry** megastructure that
  manufactures with no input bottleneck.

### Navigation Division — *Warp dynamics & logistics*
*Fantasy: the trade/logistics empire that owns the lanes.* **Folds in today's Range research.**
- **T1–T3 Warp Drive** — the existing Range ladder (2→8) lives here as the spine.
- **Convoy Logistics** *(choice)* — bigger/faster convoys (more cargo value per run).
- **Lane Stabilization** *(choice)* — charting is cheaper, routes more stable (less raid exposure).
- **T4 Wormhole Engineering** *(secret project)* — **open a brand-new warp lane** between two distant
  systems you own, re-shaping the map (a true SMAC-style game-changer).

### Colonial Division — *Xenobiology & statecraft*
*Fantasy: the population/tax superpower.*
- **T1 Habitat Engineering** — faster population growth; higher habitat cap.
- **T2 Terraforming** *(choice)* — make a **non-habitable** world habitable (open population on barren/
  desert/ice worlds — a marquee unlock).
- **T2 Hydroponic Mastery** *(choice)* — agri-domes feed far more; grow huge colonies *without*
  terraforming.
- **T3 Charter Reform** — lower system upkeep, +1 claim allowance, faster claims.
- **T4 Arcology** *(secret project)* — a population stage beyond Metropolis (**Ecumenopolis**) with
  enormous tax — the first megacity in the galaxy.

### Security Division — *Naval doctrine*
*Fantasy: the military hegemon.*
- **T1 Hull Plating** — ship + system defense up.
- **T2 Fire-Control** *(choice)* — ship combat up (offense).
- **T2 Point-Defense** *(choice)* — convoy/raid resistance (defense).
- **T3 Capital Shipyards** — capital hulls (Range 5–8) cheaper / unlocked; war fleets stronger.
- **T4 Orbital Dominance** *(secret project)* — lower capture ratio (invasions land more easily) +
  orbital bombardment; the galaxy's pre-eminent navy.

### Acquisitions Division — *Market intelligence & espionage*
*Fantasy: the corporate raider / financier.*
- **T1 Market Algorithms** — better fill prices, lower market friction, deeper order-book view.
- **T2 Industrial Espionage** *(choice)* — **steal a random rival tech** every N turns; free survey of
  rival systems.
- **T2 Counter-Intelligence** *(choice)* — immune to sabotage/espionage; your tech can't be stolen.
- **T3 Hostile Takeover** — acquisitions cheaper; share-warfare stronger.
- **T4 Insider Networks** *(secret project)* — read rivals' staged orders + nudge exchange prices.

## 5. Getting what you skipped (the MoO2/SMAC loop)

You **can't** research a second domain fast — so the design routes you to take it:

- **Acquire a rival corp** (existing finance layer) → you **inherit its researched techs**. Tech becomes
  a reason to buy out a specialist.
- **Industrial Espionage** (Acquisitions T2) → steal a random tech you lack.
- **Conquer** the charter (war layer) → its tech transfers with the systems (or is lost — a decision).
- Optional later: **tech trade** between allies (pacts already exist).

This makes research the connective tissue: a Security hegemon conquers a Prospectus baron *for the
antimatter*; an Acquisitions raider buys out a Fabrication powerhouse *for the auto-foundry*.

## 6. Bots & balance

- Each bot archetype gets a **research doctrine** matching its play (miner→Prospectus, warlord→Security,
  raider→Acquisitions, balanced→Fabrication/Colonial), so the sim exercises every branch and the AI
  specializes too.
- The all-bot balance sweep gets a new flag: **"tech parity"** (is one division strictly dominant?) and
  a check that no bot completes >~30% of the tree.
- Determinism/replay safe: RP, the chosen project, and unlocks are engine state rebuilt from orders
  (the new `setResearch` order), exactly like everything else.

## 7. Open decisions (need your call before building)

1. **Fold the existing Range research into Navigation** (cleaner, one system) vs. keep Range separate?
   *Recommend: fold in.*
2. **One active project** at a time (MoO2) vs. a **split/queue**? *Recommend: single active + a queue.*
3. On **conquest**, does captured tech **transfer to the conqueror**, or is it just denied to the
   loser? *Recommend: transfer (makes war pay off, very MoO2).*
4. **Secret projects**: hard galaxy-unique (only one ever) vs. first-mover bonus + others get a weaker
   version? *Recommend: galaxy-unique for the headline T4s.*

## 8. Phased implementation plan

- **P1 — RP economy + tree data + Research screen.** Research Lab building + population RP; the tech
  tree as config data; a Research nav screen to pick/queue projects; `setResearch` order; unlocks that
  are pure tunable bumps (Prospectus/Fabrication/Colonial spines). Balance sweep.
- **P2 — Branch effects that touch other systems.** Fold Range into Navigation; new recipe/hull/
  megastructure unlocks; terraforming; capital-shipyard gating.
- **P3 — The cross-layer loop.** Tech via acquisition/espionage/conquest; choice-node lockouts;
  secret-project races (incl. Wormhole Engineering opening a lane). Bot doctrines + tech-parity flag.
- **P4 — Polish.** Research screen art/UX, "~N turns" estimates, per-division progress, design-doc
  Section 28.

Each phase ends green (tests + typecheck + sweep), committed, never deployed half-built (event-sourced
replay risk), exactly like the planet-economy rollout.
