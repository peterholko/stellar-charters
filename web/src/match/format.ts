import { RESOURCES, type Resource, type Stockpile, type System } from "@engine";

export const resourceLabels: Record<Resource, string> = {
  ice: "Ice",
  metals: "Metals",
  helium3: "Helium-3",
  rareIsotopes: "Rare Isotopes",
  food: "Food",
  antimatter: "Antimatter",
};

export const resourceShort: Record<Resource, string> = {
  ice: "Ice",
  metals: "Met",
  helium3: "He-3",
  rareIsotopes: "Iso",
  food: "Food",
  antimatter: "AM",
};

/** Per-resource accent colors (kept theme-neutral so they read on any background). */
export const resourceColors: Record<Resource, string> = {
  ice: "#7fd4f5",
  metals: "#c3bcae",
  helium3: "#f0c468",
  rareIsotopes: "#c79bff",
  food: "#86e0a0",
  antimatter: "#ff4fd8",
};

export type SystemArchetype =
  | "ice"
  | "metals"
  | "helium3"
  | "isotopes"
  | "garden"
  | "hub";

/** Eight distinct seat colors for charters (corp-0..corp-7). */
export const corpColors = [
  "#ffb000",
  "#56d4ff",
  "#ff6f9c",
  "#7ee787",
  "#c79bff",
  "#ff9d5c",
  "#5cc8ff",
  "#e0d066",
];

export function corpColor(corpId: string): string {
  const n = Number.parseInt(corpId.replace(/\D/g, ""), 10);
  return corpColors[Number.isFinite(n) ? n % corpColors.length : 0]!;
}

export function formatCredits(value: number): string {
  const v = Math.round(value);
  return `${v.toLocaleString("en-US")}`;
}

export function formatCr(value: number): string {
  return `${formatCredits(value)} cr`;
}

export function dominantResource(yields: Stockpile): Resource {
  return RESOURCES.reduce((best, r) => (yields[r] > yields[best] ? r : best));
}

export function systemArchetype(sys: { id: string; yields: Stockpile }): SystemArchetype {
  if (sys.id === "hub") return "hub";
  const d = dominantResource(sys.yields);
  if (d === "rareIsotopes") return "isotopes";
  if (d === "metals") return "metals";
  if (d === "helium3") return "helium3";
  if (d === "food") return "garden";
  return "ice";
}

export const archetypeLabel: Record<SystemArchetype, string> = {
  ice: "Ice / Water world",
  metals: "Metal-rich belt",
  helium3: "Helium-3 giant",
  isotopes: "Rare-isotope frontier",
  garden: "Garden world",
  hub: "Wormhole Hub",
};

export const populationLabel: Record<System["populationStage"], string> = {
  outpost: "Outpost",
  settlement: "Settlement",
  colony: "Colony",
  city: "City",
  metropolis: "Metropolis",
};

export const populationOrder: System["populationStage"][] = [
  "outpost",
  "settlement",
  "colony",
  "city",
  "metropolis",
];

/** Coarse raid-risk read from a route's exposure / charted state. */
export function routeRisk(route: { exposure: number; charted: boolean }): {
  label: string;
  level: "uncharted" | "guarded" | "high" | "severe";
} {
  if (!route.charted) return { label: "Uncharted", level: "uncharted" };
  if (route.exposure >= 0.8) return { label: "Severe", level: "severe" };
  if (route.exposure >= 0.55) return { label: "High", level: "high" };
  return { label: "Guarded", level: "guarded" };
}

export function stockpileValue(stockpile: Stockpile, prices: Record<Resource, number>): number {
  return RESOURCES.reduce((sum, r) => sum + stockpile[r] * prices[r], 0);
}

export function sumYields(yields: Stockpile): number {
  return RESOURCES.reduce((sum, r) => sum + yields[r], 0);
}

/** Approximate-size bucket for redacting rival convoy quantities (Section 11 fog of war). */
export function sizeBucket(value: number): string {
  if (value >= 600) return "Large";
  if (value >= 200) return "Medium";
  return "Small";
}
