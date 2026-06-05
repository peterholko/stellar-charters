import { useSyncExternalStore } from "react";
import {
  RESOURCES,
  type ClientPlayer,
  type ClientState,
  type GamePhase,
  type Order,
  type PlayerView,
  type Resource,
  type TurnReport,
} from "@engine";
import { fetchState, newGame, submitOrders } from "../net/game";
import { reconstructView } from "./clientView";

export type ViewId =
  | "dashboard"
  | "map"
  | "systems"
  | "exchange"
  | "convoys"
  | "fleet"
  | "finance"
  | "report";

export type ThemeId = "terminal" | "used-future" | "clean";

export type Selection =
  | { kind: "system"; id: string }
  | { kind: "route"; id: string }
  | { kind: "convoy"; id: string }
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
  staged: StagedOrder[];
  reports: TurnReport[];
  lastReport: TurnReport | null;
  priceHistory: Record<Resource, number[]>;
  valuationHistory: number[];
  nav: ViewId;
  selection: Selection;
  theme: ThemeId;
  resolving: boolean;
  // ----- multiplayer / lobby -----
  mySeat: string | null;
  isHost: boolean;
  players: ClientPlayer[];
  totalSeats: number;
  submittedCount: number;
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
    staged: [],
    reports: [],
    lastReport: null,
    priceHistory: emptyHistory(),
    valuationHistory: [],
    nav: "dashboard",
    selection: { kind: "system", id: "hub" },
    theme: loadTheme(),
    resolving: false,
    mySeat: null,
    isHost: false,
    players: [],
    totalSeats: 4,
    submittedCount: 0,
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

  private applyState(cs: ClientState, opts?: { nav?: ViewId }): void {
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
      reports: cs.reports,
      lastReport: cs.reports.length ? cs.reports[cs.reports.length - 1]! : null,
      priceHistory,
      valuationHistory,
      staged: [],
      resolving: false,
      mySeat: cs.mySeat,
      isHost: cs.isHost,
      players: cs.players,
      totalSeats: cs.totalSeats,
      submittedCount: cs.submittedCount,
      ...(opts?.nav ? { nav: opts.nav } : advanced ? { nav: "report" as ViewId } : {}),
    });
    this.maybePoll();
  }

  // ----- polling (lobby sync + waiting-for-players) -----
  private shouldPoll(): boolean {
    const s = this.state;
    if (s.status !== "ready") return false;
    if (s.mySeat === null) return true; // spectating (game full) — watch for an opening
    const me = s.players.find((p) => p.isYou);
    return s.phase === "play" && !!me?.submitted && s.submittedCount < s.players.length;
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
  select(selection: Selection): void { this.set({ selection }); }
  setTheme(theme: ThemeId): void {
    if (typeof document !== "undefined") document.documentElement.setAttribute("data-theme", theme);
    if (typeof localStorage !== "undefined") localStorage.setItem(THEME_KEY, theme);
    this.set({ theme });
  }

  // ----- order staging -----
  stage(order: Order): void {
    // Orders are locked once submitted for the turn; ignore staging while waiting to resolve.
    if (this.state.players.find((p) => p.isYou)?.submitted) return;
    this.set({ staged: [...this.state.staged, { id: nextId(), order }] });
  }
  unstage(id: string): void { this.set({ staged: this.state.staged.filter((s) => s.id !== id) }); }
  clearStaged(): void { this.set({ staged: [] }); }

  // ----- turn resolution -----
  submit(): void {
    if (this.state.resolving || this.state.status !== "ready") return;
    this.set({ resolving: true });
    void submitOrders(this.state.staged.map((s) => s.order) as Order[])
      .then((cs) => this.applyState(cs))
      .catch((e) => this.set({ resolving: false, error: String(e) }));
  }

  newMatch(): void {
    this.set({ status: "loading", resolving: false });
    void newGame().then((cs) => this.applyState(cs, { nav: "dashboard" })).catch((e) => this.set({ status: "error", error: String(e) }));
  }
}

export const store = new Store();

export function useApp(): AppState {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
