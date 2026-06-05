# Stellar Charters

Async 4X / economic-warfare game design. See [`game-design-doc.md`](./game-design-doc.md)
for the full design (v2.2).

This repo contains a **headless balance simulator** with **4–8 all-bot corporations**,
used to test whether the design is fun and the economy is viable *before* building a UI.
It now covers a **full 42-turn match** spanning the early, mid, and late game (42 turns ≈
a 3-week session at 2 turns/day):

- **Early/mid (Sections 04–16):** opening auction, local production, the Galactic
  Exchange, warp-route convoys, one-turn interdiction, privateer raiding, Range-2 and
  frontier (rare-isotope) expansion.
- **Fleets & defense (Sections 04, 13–16):** corps climb the **range-tech ladder**
  (1→2→3→4) and build **escort/defense warships** stationed at their systems — these harden
  the systems' tunnel mouths against raids and automatically escort the convoys carrying
  their trade goods. Higher-tier hulls consume **rare isotopes** (mined at the frontier or
  bought on the exchange), so controlling the frontier translates into stronger fleets.
  Cheap stationary **defense platforms** give a baseline guard distinct from mobile fleets.
- **Late game (Sections 08, 12, 17, 18):** deep **population/food** (five stages growing
  to metropolis, gated on local food, with tax, unrest, life-support imports, and
  hydroponics), **Trade Depots** (shipping/transit/defense), **debt & equity takeovers**
  (borrow, buy shares, hostile acquisition → charter hegemony), and **Free Operator**
  mode for ousted players (plunder income + a share-buying comeback path).

## Quick start

```bash
npm install

# Batch: run many seeds, write CSVs + a balance summary to out/
npm run sim -- --games 200 --players 8 --turns 42

# Single game, full turn-by-turn text log (the human "is it fun?" read)
npm run sim -- --games 1 --players 8 --seed 0 --verbose

npm test          # vitest unit tests (incl. determinism)
npm run typecheck # tsc --noEmit
```

CLI flags: `--games N`, `--players N`, `--turns N`, `--seed N|random`, `--scenario PATH`,
`--out DIR`, `--verbose`.

## How it's structured

The simulation **engine is a pure, browser-portable core** (`src/engine`, no Node APIs,
randomness only via a seeded PRNG) so the eventual web app can import it unchanged.
Node-only concerns live in `src/harness` (CSV/report I/O) and `src/cli`.

- `src/engine/` — `rng`, `types`, `config`, `galaxy` (pathfinding), `market`, `auction`,
  `raiding`, `engine` (Section 20 resolution order incl. population, depots, and the
  equity/acquisition step), `metrics`, and `bots/` (`miner`, `raider`, `balanced`, each
  of which also plays the financier and Free-Operator roles).
- `src/harness/` — `runGames`, `csv`, `report` (aggregation + risk flags).
- `src/cli/runSim.ts` — entrypoint.
- `scenarios/*.json` — data-driven maps + tunable balance numbers (regenerate with
  `npx tsx scripts/genScenarios.ts`).

### Seeding: randomness explores, determinism replays

A batch sweeps seeds (game *i* → seed `startSeed+i`), so every game has a different
galaxy, auction, and raid luck — that spread is how you see "how seeds affect play."
Each game is **deterministic per seed**, so any flagged outlier can be replayed exactly
with `--seed <n> --verbose`. Every game's seed is recorded in the CSV output.

## Reading the output

`out/summary-<players>p.md` reports metrics with a 🔴/🟢 flag, mapped to the Section 21
design risks plus the late-game layers:

| Risk / layer | Metric |
| --- | --- |
| Metals overproduction / price crash | final price, volatility, floor-hit rate per resource |
| Overpowered raiding | % of shipped cargo value erased; raid-outcome mix |
| Trade UX fatigue | orders per player per turn |
| Warp chokepoint dominance | route-traffic Gini |
| Run-away leader | valuation Gini; leader/median ratio |
| Takeover layer inert | acquisitions + distress liquidations per game |
| Food micromanagement burden | share of systems that grew past Outpost; top stage |

The Late-game section also reports tax/turn, Trade Depots and warships built, acquisitions,
and Free Operators. `out/per-turn-*.csv` and `out/per-game-*.csv` hold the raw series.

## Status / known findings

The simulator runs a full 42-turn match with simple heuristic bots, and all layers fire:
populations grow to metropolis where they are **locally fed** (importing food keeps a
colony alive but only local food/hydroponics fuels growth — the doc's Section 08 intent),
Trade Depots get built, corps **climb the full range-tech ladder** (Range 2 by ~turn 7,
Range 3/4 in the late game) and **build escort fleets and defense platforms** that station
at systems and defend convoys — across a typical batch the fleet mix runs ~60% Range-1 /
~30% Range-2 / ~9% Range-3 / ~2% Range-4, and raids split roughly 20% delay/damage/loot vs
15% repelled/ambushed (heavy fleets turn raiders back; light defense still lets raids
through), with only ~0.3% of cargo value lost. The frontier is reached and rare isotopes
flow into those **advanced hulls**, and the endgame **consolidates via hostile takeovers**
into a charter hegemon, turning ousted players into Free Operators.

Turn-indexed pacing constants (range-research earliest turns, build gates, takeover start)
are scaled to the 42-turn arc, so the phases breathe roughly as the doc describes
(logistics/raiding mid-game, consolidation from ~turn 25).

Two flags fire under the current tuning and are worth noting as *findings*, not bugs:
**metals fully crashes to its floor** (the designed overproduction resource — population
ice/food demand supports the other staples, but nothing sinks metals), and the
**run-away-leader** spread is high *at 8 players* (leader ≈ 25× median) because the longer
endgame lets the consolidation win-condition snowball — one corp absorbs ~5 of 8 rivals
into a hegemon (the others continue as Free Operators). At 4 players it is far milder
(≈6× median), so this is a genuine player-count/horizon balance lever, not a bug. All
balance numbers live in
`src/engine/config.ts` and `scenarios/*.json` and are starting points for tuning.
