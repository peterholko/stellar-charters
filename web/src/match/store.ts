import { useSyncExternalStore } from "react";
import {
  RESOURCES,
  type ClientContact,
  type ClientMovement,
  type ClientPlayer,
  type ClientStandingRoute,
  type ClientState,
  type GameOutcome,
  type GamePhase,
  type LogisticsFocus,
  type MarketPressureCell,
  type OpeningCommandState,
  type Order,
  type PlayerView,
  type Resource,
  type StandingRouteSuggestion,
  type TurnReport,
} from "@engine";
import { fetchState, instantAction as instantActionApi, newGame, pickCharter, submitOrders, type InstantActionRequest } from "../net/game";
import { reconstructView } from "./clientView";

export type ViewId =
  | "dashboard"
  | "map"
  | "systems"
  | "exchange"
  | "convoys"
  | "ships"
  | "combat"
  | "finance"
  | "research"
  | "turn"
  | "report"
  | "standings";

export type ThemeId = "terminal" | "used-future" | "clean";

export type Selection =
  | { kind: "system"; id: string }
  | { kind: "route"; id: string }
  | { kind: "convoy"; id: string }
  // A movable fleet = your idle combat ships stationed at this system (`id` = that system).
  | { kind: "fleet"; id: string }
  // A dispatchable survey vessel stationed at this system (`id` = that system).
  | { kind: "survey"; id: string }
  | null;

export interface StagedOrder {
  id: string;
  order: Order;
}

export interface AppState {
  status: "loading" | "ready" | "error";
  error: string | null;
  gameId: string;
  phase: GamePhase;
  turn: number;
  totalTurns: number;
  humanCorpId: string;
  view: PlayerView | null;
  /** Convoy/fleet legs from last turn, for the map's "Last turn movements" replay. */
  movementLog: ClientMovement[];
  /** Rival fleets your ships' sensors are currently detecting (Section 04). */
  contacts: ClientContact[];
  /** Bumped to trigger the map's movement replay (the report's "▶ watch" + the map button). */
  replayNonce: number;
  /** Goods currently tradable on the Exchange (commodity staging, review Section 13). */
  listedResources: Resource[];
  /** Fogged net market-pressure direction per resource (Phase B) — drives the Exchange ticker. */
  marketPressure: Record<Resource, MarketPressureCell>;
  staged: StagedOrder[];
  reports: TurnReport[];
  lastReport: TurnReport | null;
  priceHistory: Record<Resource, number[]>;
  valuationHistory: number[];
  nav: ViewId;
  selection: Selection;
  theme: ThemeId;
  resolving: boolean;
  /** A prepared Exchange import (set by "Import missing resources" in the build catalogue):
   *  the Exchange composer prefills from it, ready for the player to stage. */
  exchangeDraft: { resource: Resource; systemId: string; quantity: number } | null;
  /** Galaxy-unique secret projects already claimed (Section 28, Phase 3): techId → corp name. */
  claimedSecrets: Record<string, string>;
  /** Live victory standings + final outcome (Section 29). */
  outcome: GameOutcome | null;
  // ----- multiplayer / lobby -----
  mySeat: string | null;
  isHost: boolean;
  players: ClientPlayer[];
  totalSeats: number;
  submittedCount: number;
  /** Turn-1 opening window (Section 05): present only during the opening; drives the opening panel. */
  openingState: OpeningCommandState | null;
  /** Your standing trade routes (export automation). */
  standingRoutes: ClientStandingRoute[];
  /** A suggested standing route the UI offers for one-click approval. */
  standingRouteSuggestion: StandingRouteSuggestion | null;
}

const THEME_KEY = "sc.theme";

function loadTheme(): ThemeId {
  const t = (typeof localStorage !== "undefined" && localStorage.getItem(THEME_KEY)) as ThemeId | null;
  return t === "used-future" || t === "clean" || t === "terminal" ? t : "terminal";
}

let oid = 0;
const nextId = () => `o${oid++}`;

function emptyHistory(): Record<Resource, number[]> {
  const h = {} as Record<Resource, number[]>;
  for (const r of RESOURCES) h[r] = [];
  return h;
}

function balancedPressure(): Record<Resource, MarketPressureCell> {
  const p = {} as Record<Resource, MarketPressureCell>;
  for (const r of RESOURCES) p[r] = { direction: "balanced" };
  return p;
}

class Store {
  private listeners = new Set<() => void>();
  private initStarted = false;
  private lastUserKey = "";
  private polling = false;

  state: AppState = {
    status: "loading",
    error: null,
    gameId: "",
    phase: "play",
    turn: 0,
    totalTurns: 42,
    humanCorpId: "corp-0",
    view: null,
    movementLog: [],
    contacts: [],
    replayNonce: 0,
    listedResources: [...RESOURCES],
    marketPressure: balancedPressure(),
    staged: [],
    reports: [],
    lastReport: null,
    priceHistory: emptyHistory(),
    valuationHistory: [],
    nav: "map",
    selection: { kind: "system", id: "hub" },
    theme: loadTheme(),
    resolving: false,
    exchangeDraft: null,
    claimedSecrets: {},
    outcome: null,
    mySeat: null,
    isHost: false,
    players: [],
    totalSeats: 4,
    submittedCount: 0,
    openingState: null,
    standingRoutes: [],
    standingRouteSuggestion: null,
  };

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  getSnapshot = (): AppState => this.state;

  private set(patch: Partial<AppState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  /** Resumes / loads the shared game. Keyed on user id so account switches reload. */
  init(userKey: string): void {
    if (this.initStarted && this.lastUserKey === userKey) return;
    const switching = this.lastUserKey !== "" && this.lastUserKey !== userKey;
    this.initStarted = true;
    this.lastUserKey = userKey;
    if (typeof document !== "undefined") document.documentElement.setAttribute("data-theme", this.state.theme);
    if (switching) this.set({ status: "loading", view: null });
    void fetchState()
      .then((cs) => this.applyState(cs))
      .catch((e) => this.set({ status: "error", error: String(e) }));
  }

  private applyState(cs: ClientState, opts?: { nav?: ViewId; keepStaged?: boolean }): void {
    const advanced = cs.turn > this.state.turn;
    const view = cs.systems.length === 0 ? null : reconstructView(cs);
    const priceHistory = emptyHistory();
    for (const r of RESOURCES) {
      priceHistory[r] = cs.reports.length ? cs.reports.map((rep) => rep.prices[r]) : [cs.prices[r]];
    }
    const valuationHistory = cs.reports.map(
      (rep) => rep.corps.find((c) => c.id === (cs.mySeat ?? cs.humanCorpId))?.valuation ?? 0,
    );
    this.set({
      status: "ready",
      error: null,
      gameId: cs.gameId,
      phase: cs.phase,
      turn: cs.turn,
      totalTurns: cs.totalTurns,
      humanCorpId: cs.mySeat ?? cs.humanCorpId,
      view,
      movementLog: cs.movementLog ?? [],
      contacts: cs.contacts ?? [],
      listedResources: cs.listedResources ?? [...RESOURCES],
      marketPressure: cs.marketPressure ?? balancedPressure(),
      reports: cs.reports,
      lastReport: cs.reports.length ? cs.reports[cs.reports.length - 1]! : null,
      priceHistory,
      valuationHistory,
      staged: opts?.keepStaged && !advanced ? this.state.staged : [],
      resolving: false,
      claimedSecrets: cs.claimedSecrets ?? {},
      outcome: cs.outcome ?? null,
      mySeat: cs.mySeat,
      isHost: cs.isHost,
      players: cs.players,
      totalSeats: cs.totalSeats,
      submittedCount: cs.submittedCount,
      openingState: cs.openingState ?? null,
      standingRoutes: cs.standingRoutes ?? [],
      standingRouteSuggestion: cs.standingRouteSuggestion ?? null,
      // Map-first turn flow (Section 04, v2.4): when the game ends, jump to the results board;
      // otherwise land on the map and auto-play the "Last turn movements" replay so the player
      // reads the turn on the board first. The Report stays one click away on the navrail.
      ...(opts?.nav
        ? { nav: opts.nav }
        : advanced
          ? cs.phase === "over"
            ? { nav: "standings" as ViewId }
            : { nav: "map" as ViewId, replayNonce: this.state.replayNonce + 1 }
          : {}),
    });
    this.maybePoll();
  }

  // ----- polling (lobby sync + waiting-for-players) -----
  private shouldPoll(): boolean {
    const s = this.state;
    if (s.status !== "ready") return false;
    if (s.mySeat === null) return true; // spectating (game full) — watch for an opening
    const me = s.players.find((p) => p.isYou);
    // Poll while waiting for others — both the normal turn and the opening-auction bid round.
    return (s.phase === "play" || s.phase === "auction") && !!me?.submitted && s.submittedCount < s.players.length;
  }

  private maybePoll(): void {
    if (this.polling || !this.shouldPoll()) return;
    this.polling = true;
    const loop = () => {
      if (!this.shouldPoll()) {
        this.polling = false;
        return;
      }
      window.setTimeout(() => {
        void fetchState()
          .then((cs) => this.applyState(cs))
          .catch(() => {})
          .finally(loop);
      }, 2500);
    };
    loop();
  }

  // ----- navigation / selection / theme -----
  setNav(nav: ViewId): void { this.set({ nav }); }
  /** Jump to the Exchange with an import prepared (build catalogue → "Import missing resources"):
   *  the composer prefills the buy; the player reviews and stages it themselves. */
  draftImport(draft: { resource: Resource; systemId: string; quantity: number }): void {
    this.set({ exchangeDraft: draft, nav: "exchange" });
  }
  /** The Exchange consumed the prepared import into its composer fields. */
  consumeExchangeDraft(): void {
    if (this.state.exchangeDraft) this.set({ exchangeDraft: null });
  }
  select(selection: Selection): void { this.set({ selection }); }
  /** Jump to the map and play the "Last turn movements" replay (the report's "▶ watch"). */
  requestReplay(): void { this.set({ nav: "map", replayNonce: this.state.replayNonce + 1 }); }
  /** One-time charter-type pick at join (review Section 5); effects start next turn. */
  pickCharter(charter: string): void {
    void pickCharter(charter)
      .then((cs) => this.applyState(cs, { nav: this.state.nav }))
      .catch((e) => this.set({ error: String(e) }));
  }
  setTheme(theme: ThemeId): void {
    if (typeof document !== "undefined") document.documentElement.setAttribute("data-theme", theme);
    if (typeof localStorage !== "undefined") localStorage.setItem(THEME_KEY, theme);
    this.set({ theme });
  }

  /**
   * Instant Exchange action (ruleset v10): buy/sell/dispatch executed server-side at click
   * time, priced along the curve with the spread. Returns null on success (state refreshed,
   * staged tray preserved) or the rejection reason.
   */
  async instant(req: InstantActionRequest): Promise<string | null> {
    if (this.state.status !== "ready" || this.state.resolving) return "the game is still loading";
    if (this.state.players.find((p) => p.isYou)?.submitted) return "orders already submitted — wait for the turn to resolve";
    try {
      const cs = await instantActionApi(req);
      this.applyState(cs, { keepStaged: true });
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  }

  // ----- order staging -----
  stage(order: Order): void {
    // Orders are locked once submitted for the turn; ignore staging while waiting to resolve.
    if (this.state.players.find((p) => p.isYou)?.submitted) return;
    this.set({ staged: [...this.state.staged, { id: nextId(), order }] });
  }
  unstage(id: string): void { this.set({ staged: this.state.staged.filter((s) => s.id !== id) }); }
  clearStaged(): void { this.set({ staged: [] }); }

  // ----- Turn-1 opening commands (Section 05) -----
  /** Targets the player has staged an opening probe against this turn. */
  stagedOpeningSurveys(): string[] {
    return this.state.staged.flatMap((s) => (s.order.kind === "openingSurvey" ? [s.order.targetSystemId] : []));
  }
  /** Toggle a free opening Authority probe on a system (capped client-side by surveysRemaining). */
  toggleOpeningSurvey(systemId: string): void {
    if (this.state.players.find((p) => p.isYou)?.submitted) return;
    const existing = this.state.staged.find((s) => s.order.kind === "openingSurvey" && s.order.targetSystemId === systemId);
    if (existing) { this.unstage(existing.id); return; }
    const remaining = this.state.openingState?.surveysRemaining ?? 0;
    if (this.stagedOpeningSurveys().length >= remaining) return;
    this.stage({ kind: "openingSurvey", targetSystemId: systemId });
  }
  /** The currently-staged first export, or null. */
  get firstExport(): { resource: Resource; quantity: number } | null {
    const o = this.state.staged.find((s) => s.order.kind === "firstExport")?.order;
    return o && o.kind === "firstExport" ? { resource: o.resource, quantity: o.quantity } : null;
  }
  /** Stage (or replace) the optional named maiden voyage; pass quantity 0 to clear it. */
  setFirstExport(resource: Resource, quantity: number): void {
    if (this.state.players.find((p) => p.isYou)?.submitted) return;
    const staged = this.state.staged.filter((s) => s.order.kind !== "firstExport");
    if (quantity > 0) staged.push({ id: nextId(), order: { kind: "firstExport", resource, quantity } });
    this.set({ staged });
  }

  // ----- Standing trade routes -----
  createStandingRoute(originSystemId: string, resource: Resource, batch: number, reserve: number, enabled = true): void {
    this.stage({ kind: "createStandingRoute", originSystemId, resource, batch, reserve, enabled });
  }
  setStandingRouteEnabled(routeId: string, enabled: boolean): void {
    this.stage({ kind: "setStandingRouteEnabled", routeId, enabled });
  }
  removeStandingRoute(routeId: string): void {
    this.stage({ kind: "removeStandingRoute", routeId });
  }

  /** The single per-turn logistics focus (Phase D). Exclusive: setting one replaces any prior
   *  choice; pass null to clear it. Never stacks — at most one `logisticsFocus` order is staged. */
  setLogisticsFocus(focus: LogisticsFocus | null): void {
    if (this.state.players.find((p) => p.isYou)?.submitted) return;
    const staged = this.state.staged.filter((s) => s.order.kind !== "logisticsFocus");
    if (focus) staged.push({ id: nextId(), order: { kind: "logisticsFocus", focus } });
    this.set({ staged });
  }
  /** The currently-staged logistics focus, or null. */
  get logisticsFocus(): LogisticsFocus | null {
    const o = this.state.staged.find((s) => s.order.kind === "logisticsFocus")?.order;
    return o && o.kind === "logisticsFocus" ? o.focus : null;
  }

  // ----- turn resolution -----
  /** Lane interdictions in the most recently submitted turn (an interdiction covers ONE
   *  resolution — Section 13). Remembered so the turn after, the Report can offer a
   *  one-click "renew" for traps that just expired. In-memory only: a page reload forgets. */
  private lastInterdicts: { submittedAtTurn: number; routeIds: string[] } | null = null;

  /** Route ids whose interdiction expired in the resolution that just happened (else []). */
  expiredInterdicts(): string[] {
    const li = this.lastInterdicts;
    // Remind exactly once — on the first planning window after the trap fired.
    return li && this.state.turn === li.submittedAtTurn + 1 ? li.routeIds : [];
  }

  /** Submit a sealed opening-auction bid (Section 05): a priority-ordered list of inner-ring systems
   *  with amounts. Highest valid bid wins each system; you win at most one; losing bids are ~92%
   *  refunded; winning nothing still grants a fallback home. */
  submitBid(priorities: { systemId: string; amount: number }[]): void {
    if (this.state.resolving || this.state.status !== "ready") return;
    this.set({ resolving: true });
    void submitOrders([{ kind: "bid", priorities }] as Order[])
      .then((cs) => this.applyState(cs))
      .catch((e) => this.set({ resolving: false, error: String(e) }));
  }

  submit(): void {
    if (this.state.resolving || this.state.status !== "ready") return;
    const interdicts = this.state.staged
      .map((s) => s.order)
      .filter((o): o is Extract<Order, { kind: "interdict" }> => o.kind === "interdict");
    if (interdicts.length > 0) {
      this.lastInterdicts = { submittedAtTurn: this.state.turn, routeIds: interdicts.map((o) => o.routeId) };
    }
    this.set({ resolving: true });
    void submitOrders(this.state.staged.map((s) => s.order) as Order[])
      .then((cs) => this.applyState(cs))
      .catch((e) => this.set({ resolving: false, error: String(e) }));
  }

  newMatch(): void {
    this.set({ status: "loading", resolving: false });
    void newGame().then((cs) => this.applyState(cs, { nav: "map" })).catch((e) => this.set({ status: "error", error: String(e) }));
  }
}

export const store = new Store();

// Dev-only console handle (the /preview gallery + manual poking): not part of the app surface.
if (typeof import.meta !== "undefined" && import.meta.env?.DEV && typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__scStore = store;
}

export function useApp(): AppState {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
