import { useSyncExternalStore } from "react";
import {
  RESOURCES,
  type BidOrder,
  type Order,
  type PlayerView,
  type Resource,
  type TurnReport,
} from "@engine";
import { createMatch, type Match } from "./createMatch";

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

export interface BidPriority {
  systemId: string;
  amount: number;
}

export interface AppState {
  match: Match;
  phase: "auction" | "play" | "over";
  turn: number;
  totalTurns: number;
  view: PlayerView;
  staged: StagedOrder[];
  bid: BidPriority[];
  lastReport: TurnReport | null;
  reports: TurnReport[];
  priceHistory: Record<Resource, number[]>;
  valuationHistory: number[];
  nav: ViewId;
  selection: Selection;
  theme: ThemeId;
  resolving: boolean;
}

const THEME_KEY = "sc.theme";

function emptyPriceHistory(view: PlayerView): Record<Resource, number[]> {
  const h = {} as Record<Resource, number[]>;
  for (const r of RESOURCES) h[r] = [view.market.prices[r]];
  return h;
}

function loadTheme(): ThemeId {
  const t = (typeof localStorage !== "undefined" && localStorage.getItem(THEME_KEY)) as ThemeId | null;
  return t === "used-future" || t === "clean" || t === "terminal" ? t : "terminal";
}

let oid = 0;
const nextId = () => `o${oid++}`;

class Store {
  private listeners = new Set<() => void>();
  state: AppState;

  constructor() {
    const match = createMatch();
    const view = match.engine.playerView(match.humanCorpId);
    this.state = {
      match,
      phase: "auction",
      turn: 0,
      totalTurns: match.engine.config.turns,
      view,
      staged: [],
      bid: [],
      lastReport: null,
      reports: [],
      priceHistory: emptyPriceHistory(view),
      valuationHistory: [],
      nav: "dashboard",
      selection: { kind: "system", id: "hub" },
      theme: loadTheme(),
      resolving: false,
    };
  }

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  getSnapshot = (): AppState => this.state;

  private set(patch: Partial<AppState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  private refreshView(): PlayerView {
    return this.state.match.engine.playerView(this.state.match.humanCorpId);
  }

  // ----- navigation / selection / theme -----

  setNav(nav: ViewId): void {
    this.set({ nav });
  }

  select(selection: Selection): void {
    this.set({ selection });
  }

  setTheme(theme: ThemeId): void {
    if (typeof document !== "undefined") document.documentElement.setAttribute("data-theme", theme);
    if (typeof localStorage !== "undefined") localStorage.setItem(THEME_KEY, theme);
    this.set({ theme });
  }

  // ----- order staging -----

  stage(order: Order): void {
    this.set({ staged: [...this.state.staged, { id: nextId(), order }] });
  }

  unstage(id: string): void {
    this.set({ staged: this.state.staged.filter((s) => s.id !== id) });
  }

  clearStaged(): void {
    this.set({ staged: [] });
  }

  // ----- auction bid draft -----

  setBid(bid: BidPriority[]): void {
    this.set({ bid });
  }

  addBid(systemId: string, amount: number): void {
    if (this.state.bid.some((b) => b.systemId === systemId)) return;
    this.set({ bid: [...this.state.bid, { systemId, amount }] });
  }

  removeBidAt(i: number): void {
    this.set({ bid: this.state.bid.filter((_, j) => j !== i) });
  }

  setBidAmount(i: number, amount: number): void {
    this.set({ bid: this.state.bid.map((b, j) => (j === i ? { ...b, amount } : b)) });
  }

  moveBid(i: number, dir: -1 | 1): void {
    const j = i + dir;
    const next = [...this.state.bid];
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j]!, next[i]!];
    this.set({ bid: next });
  }

  // ----- turn resolution -----

  submit(): void {
    if (this.state.resolving) return;
    this.set({ resolving: true });
    // Brief cosmetic "resolving" reveal; the engine step itself is synchronous.
    window.setTimeout(() => this.resolveNow(), 620);
  }

  private resolveNow(): void {
    const { match, phase } = this.state;
    let report: TurnReport;
    if (phase === "auction") {
      const bidOrder: BidOrder = { kind: "bid", priorities: this.state.bid };
      match.human.pendingBid = bidOrder;
      report = match.engine.stepAuction();
    } else {
      match.human.pendingOrders = this.state.staged.map((s) => s.order);
      report = match.engine.stepTurn();
    }

    const view = this.refreshView();
    const priceHistory = { ...this.state.priceHistory };
    for (const r of RESOURCES) priceHistory[r] = [...priceHistory[r], report.prices[r]];
    const valuationHistory = [...this.state.valuationHistory, view.me.valuation];

    this.set({
      view,
      turn: match.engine.currentTurn,
      phase: match.engine.isOver ? "over" : "play",
      staged: [],
      bid: [],
      lastReport: report,
      reports: [...this.state.reports, report],
      priceHistory,
      valuationHistory,
      resolving: false,
      nav: "report",
    });
  }
}

export const store = new Store();

// Apply persisted theme to the document on load.
if (typeof document !== "undefined") {
  document.documentElement.setAttribute("data-theme", store.state.theme);
}

export function useApp(): AppState {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

// ----- convenience selectors -----

export function totalStagedCost(state: AppState, describe: (o: Order) => number): number {
  return state.staged.reduce((sum, s) => sum + describe(s.order), 0);
}
