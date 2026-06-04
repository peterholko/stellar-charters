# Stellar Charters

Async 4X / economic-warfare game design. See [`game-design-doc.md`](./game-design-doc.md)
for the full design (v2.2).

This repo currently contains a **headless balance simulator** for the MVP slice the
design doc recommends prototyping first (Section 21): the **first ~12 turns** with
**4–8 all-bot corporations**, used to test whether the core loop is fun and the economy
is viable *before* building a UI. It exercises the opening auction, local production,
the Galactic Exchange, warp-route convoys, one-turn route interdiction, privateer
raiding, and Range-2 expansion. Finance/takeover, deep population/food, and Free Operator
mode are intentionally out of scope for now.

## Quick start

```bash
npm install

# Batch: run many seeds, write CSVs + a balance summary to out/
npm run sim -- --games 200 --players 8 --turns 12

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
  `raiding`, `engine` (Section 20 resolution order), `metrics`, and `bots/`
  (`miner`, `raider`, `balanced`).
- `src/harness/` — `runGames`, `csv`, `report` (aggregation + Section 21 risk flags).
- `src/cli/runSim.ts` — entrypoint.
- `scenarios/*.json` — data-driven maps + tunable balance numbers (regenerate with
  `npx tsx scripts/genScenarios.ts`).

### Seeding: randomness explores, determinism replays

A batch sweeps seeds (game *i* → seed `startSeed+i`), so every game has a different
galaxy, auction, and raid luck — that spread is how you see "how seeds affect play."
Each game is **deterministic per seed**, so any flagged outlier can be replayed exactly
with `--seed <n> --verbose`. Every game's seed is recorded in the CSV output.

## Reading the output

`out/summary-<players>p.md` reports metrics mapped to the Section 21 design risks, each
with a 🔴/🟢 flag:

| Risk (Section 21) | Metric |
| --- | --- |
| Metals overproduction / price crash | final price, volatility, floor-hit rate per resource |
| Overpowered raiding | % of shipped cargo value erased; raid-outcome mix |
| Trade UX fatigue | orders per player per turn |
| Warp chokepoint dominance | route-traffic Gini |
| Run-away leader | valuation Gini; leader/median ratio |

Plus pacing milestones (avg 2nd-claim turn, avg Range-2 turn) and auction health.
`out/per-turn-*.csv` and `out/per-game-*.csv` hold the raw series for deeper analysis.

## Status / known findings

The simulator runs the full 12-turn slice with simple heuristic bots. With the current
tuning the economy is stable (ice/metals prices decay toward their floors — the
overproduction dynamic the doc flags — without fully crashing), raids reliably fire and
stay in the "delay/damage/partial-loot" band rather than erasing shipments, and no forced
chokepoint emerges because each inner system has its own hub lane. Rare isotopes only
begin entering the market right at the edge of the 12-turn window, matching the doc's
"Turn 10: rare resources enter the market." These are starting points for balance tuning,
not final numbers.
