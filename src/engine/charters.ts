/**
 * Charter types (review Section 5 — asymmetric identity at setup): players start the game as
 * DIFFERENT kinds of corporation, not identical charters diverging slowly. Each type carries one
 * strong bonus and one real penalty, expressed entirely through the existing `ResearchMods`
 * surface so the engine applies them exactly where research effects already apply.
 *
 * Event-sourcing note: a charter is picked at join time and recorded with the turn it takes
 * effect (`Corporation.charterFrom`); `Engine.mods()` only applies it from that turn, so the
 * order-log replay re-derives history identically. Bots keep their behavioural archetypes and
 * pick no charter.
 */
import type { ResearchMods } from "./research.js";
import type { CharterType } from "./types.js";

export interface CharterSpec {
  name: string;
  /** One-line fiction + mechanical summary shown at pick time. */
  blurb: string;
  bonus: string;
  penalty: string;
  /** Multiplies the charter's effects onto the corp's live modifier set. */
  apply: (m: ResearchMods) => void;
}

export const CHARTER_TYPES: CharterType[] = ["extraction", "shipping", "security", "bank"];

export const CHARTER_SPECS: Record<CharterType, CharterSpec> = {
  extraction: {
    name: "Extraction Combine",
    blurb: "Born in the ore belts: refining chains run hotter, but company towns resent the ledger.",
    bonus: "+15% processor output",
    penalty: "−10% population tax",
    apply: (m) => {
      m.factoryOutputMult *= 1.15;
      m.taxMult *= 0.9;
    },
  },
  shipping: {
    name: "Shipping House",
    blurb: "Logistics is the family trade: every hull burns leaner, but none are built for a fight.",
    bonus: "−25% fleet fuel burn",
    penalty: "−10% warship combat",
    apply: (m) => {
      m.shipFuelMult *= 0.75;
      m.shipCombatMult *= 0.9;
    },
  },
  security: {
    name: "Security Contractor",
    blurb: "Escorts, marines, and letters of marque — force projection at a payroll premium.",
    bonus: "+20% warship combat",
    penalty: "+15% system upkeep",
    apply: (m) => {
      m.shipCombatMult *= 1.2;
      m.upkeepMult *= 1.15;
    },
  },
  bank: {
    name: "Merchant Bank",
    blurb: "The desk sees the order flow first; the colonies see their landlords never.",
    bonus: "+3% better Exchange fills",
    penalty: "−15% population growth",
    apply: (m) => {
      m.marketEdge += 0.03;
      m.growthMult *= 0.85;
    },
  },
};
