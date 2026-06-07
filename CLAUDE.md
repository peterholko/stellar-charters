# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Stellar Charters** is an asynchronous 4X / economic-warfare game (wormhole frontier,
corporate market warfare, 4–12 players). [`game-design-doc.md`](./game-design-doc.md) is
the authoritative design spec (v2.2) — its numbered Sections are referenced throughout the
code (e.g. the engine's resolution order implements Section 20). Read it before changing
game logic.

The repo has two layers built on one shared core:

1. A **pure, deterministic simulation engine** (`src/engine/`) plus a **headless balance
   simulator** (`src/cli`, `src/harness`) that runs full 42-turn all-bot matches to test
   whether the economy is viable *before* committing to UI work.
2. A **Cloudflare Workers app**: a server-authoritative multiplayer backend (`worker/`,
   D1) and a React + PixiJS web client (`web/`) that both import the same engine.

## Commands

```bash
npm install

# Balance simulator (headless, all-bot). Batch sweep — writes CSVs + summary to out/:
npm run sim -- --games 200 --players 8 --turns 42
# Single deterministic game with full turn-by-turn log (the "is it fun?" read):
npm run sim -- --games 1 --players 8 --seed 0 --verbose
# Flags: --games N --players N --turns N --seed N|random --scenario PATH --out DIR --verbose
# --procedural: generate a fresh body-driven galaxy per game (Section 21) instead of a committed
#   flat-yield map — use this to balance-test the real extractor/depletion economy.

npm test                      # vitest unit tests (includes determinism + pathfinding)
npx vitest run tests/market.test.ts   # a single test file
npx vitest run -t "auction"           # tests matching a name
npm run typecheck             # tsc --noEmit over src/ + tests/

# Web client (Vite, port 5173 — proxies /api to the Worker on :8787 in dev):
npm run web:dev
npm run web:build             # tsc -p web/tsconfig.json && vite build
npm run web:preview           # serve the build on :4173
npm run web:deploy            # web:build && wrangler deploy

# Worker (Cloudflare, wrangler dev on :8787) + its D1 database:
npm run worker:dev
npm run worker:typecheck
npm run db:migrate:local      # apply migrations/ to the local D1
npm run db:migrate:remote     # apply migrations/ to the deployed D1

npx tsx scripts/genScenarios.ts   # regenerate scenarios/*.json
```

## Architecture

### The pure engine is the spine (`src/engine/`)

Everything runs on one engine core that is **platform-agnostic**: no Node APIs, and all
randomness flows through the seeded `Rng` (`rng.ts`). This is deliberate so the *same
source* is imported unchanged by the Node simulator, the Cloudflare Worker, and the browser
client. Keep it that way — do not import `node:*` or use `Date.now()`/`Math.random()` inside
`src/engine/`.

- `index.ts` is the public barrel — the surface every consumer imports.
- `engine.ts` runs the turn loop in the exact Section 20 order (administrative builds →
  production → market clearing → convoy launch → route interdiction → targeted raids →
  arrivals & settlements → upkeep/food/debt → valuation → report). The **"no same-turn
  chaining"** rule is load-bearing: goods that arrive during a resolution are only available
  the next turn.
- Supporting modules: `galaxy.ts` (warp-route pathfinding), `market.ts` (the single global
  exchange), `auction.ts` (opening claim auction), `raiding.ts`, `procedural.ts` (generate a
  galaxy from a seed), `config.ts` + `scenarios/*.json` (all tunable balance numbers),
  `metrics.ts`, `report.ts`, and `clientState.ts` (`buildClientState` produces the
  **per-seat fog-of-war view** the UI and API serve).
- `bots/` — heuristic AI corporations (`miner`, `raider`, `balanced`, `hybrid`, …) that also
  play the financier and Free-Operator roles; `HumanBot` represents a seat driven by
  submitted orders. Node-only I/O (CSV, aggregation) is isolated in `src/harness/`; the CLI
  entrypoint is `src/cli/runSim.ts`.

### Determinism: randomness explores, determinism replays

A batch maps game *i* → seed `startSeed + i`, so each game has a different galaxy and luck
(that spread is the balance signal), but every game is **exactly reproducible from its
seed**. Any flagged outlier can be replayed with `--seed <n> --verbose`. Anything that
breaks per-seed determinism (unseeded randomness, wall-clock, map iteration order) is a bug —
`tests/determinism.test.ts` guards this.

### The engine imports use NodeNext `.js`-points-at-`.ts`

`src/engine/` is authored NodeNext-style: internal imports write explicit `.js` specifiers
that actually resolve to `.ts` siblings. The Node sim and Worker handle this natively. For
the browser build, `web/vite.config.ts` includes a small `engineJsToTs` resolver that
rewrites those `.js` specifiers back to `.ts` — **only** for imports originating inside the
engine tree (it must never touch Vite's pre-bundled deps). The web client imports the engine
via the `@engine` alias. If you add engine files, keep the `.js` extension on relative
imports.

### Server-authoritative, event-sourced multiplayer (`worker/`)

`worker/index.ts` is the Worker entry: non-`/api` paths are served from the `ASSETS` binding
(the built SPA); `/api/auth/*` and `/api/game/*` are handled in code.

- `session.ts` — bindings (`Env`: `DB` D1 + `ASSETS`), PBKDF2-SHA256 passwords, and opaque
  cookie sessions (only the token's SHA-256 is stored). `index.ts` also implements Discord
  OAuth (gated on `DISCORD_CLIENT_ID` / the `DISCORD_CLIENT_SECRET` secret).
- `game.ts` runs **one always-on global game**. State is **event-sourced**: the
  authoritative game is reconstructed by replaying each turn's per-seat order log through the
  deterministic engine — so persistence is just `(seed, players, per-seat orders)`, not a
  serialized world. Empty seats are played by AI bots; a signed-in player auto-takes an open
  seat and the takeover is recorded by the log switching from AI to human orders on the first
  turn they submit. A turn resolves once **every seated human** has submitted. Each player is
  served their own fog-of-war `ClientState`.

Schema lives in `migrations/` (`users`/`sessions`, then event-sourced `games` /
`game_players` / per-seat `game_orders`); the D1 binding and custom domain are configured in
`wrangler.jsonc`.

### Web client (`web/`)

React 19 + PixiJS 8 SPA. `web/src/App.tsx` is the shell with a fixed set of screens
(Dashboard/Command, Map, Systems, Exchange, Convoys, Fleet, Finance, Report). A `store`
(`web/src/match/`) holds staged orders and view state; `web/src/net/game.ts` is the thin API
client that polls `/api/game` and POSTs orders. `web/src/auth/` gates the app behind sign-in.
The galaxy map is rendered with Pixi (`components/PixiGalaxyMap.tsx`). Because the client and
server share the engine's types and `buildClientState` view, the UI never recomputes game
logic — it renders the seat view the engine produced.
