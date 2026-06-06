import {
  RESOURCES,
  potentialYields,
  type PlanetType,
  type Resource,
  type StarType,
  type Stockpile,
  type System,
} from "@engine";

export const resourceLabels: Record<Resource, string> = {
  ice: "Ice",
  metals: "Metals",
  silicates: "Silicates",
  helium3: "Helium-3",
  rareIsotopes: "Rare Isotopes",
  food: "Food",
  fuel: "Fuel",
  alloys: "Alloys",
  polymers: "Polymers",
  components: "Components",
  antimatter: "Antimatter",
};

export const resourceShort: Record<Resource, string> = {
  ice: "Ice",
  metals: "Met",
  silicates: "Sil",
  helium3: "He-3",
  rareIsotopes: "Iso",
  food: "Food",
  fuel: "Fuel",
  alloys: "Aly",
  polymers: "Ply",
  components: "Cmp",
  antimatter: "AM",
};

/** Per-resource accent colors (kept theme-neutral so they read on any background). */
export const resourceColors: Record<Resource, string> = {
  // raws
  ice: "#7fd4f5",
  metals: "#c3bcae",
  silicates: "#d8b27a",
  helium3: "#f0c468",
  rareIsotopes: "#c79bff",
  food: "#86e0a0",
  // manufactured (Section 07b production chain)
  fuel: "#f0884a",
  alloys: "#9aa7b5",
  polymers: "#5fb0a0",
  components: "#5b8def",
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

/** A system's dominant resource derived from its deposits' full potential (Section 21). */
export function systemDominant(sys: System): Resource {
  return dominantResource(potentialYields(sys));
}

export function systemArchetype(sys: System): SystemArchetype {
  if (sys.id === "hub") return "hub";
  const d = systemDominant(sys);
  if (d === "rareIsotopes" || d === "antimatter") return "isotopes";
  if (d === "metals") return "metals";
  if (d === "helium3") return "helium3";
  if (d === "food") return "garden";
  return "ice";
}

// ----- Star & planet taxonomy (Section 21) -----

export const starTypeLabel: Record<StarType, string> = {
  mainSequence: "Main-sequence star",
  redDwarf: "Red dwarf",
  redGiant: "Red giant",
  blueGiant: "Blue giant",
  whiteDwarf: "White dwarf",
  neutronStar: "Neutron star",
};

/** Theme-neutral accent per star type (reads on any background). */
export const starTypeColor: Record<StarType, string> = {
  mainSequence: "#ffd66b",
  redDwarf: "#ff9d6c",
  redGiant: "#ff7a4d",
  blueGiant: "#8fd0ff",
  whiteDwarf: "#eef3ff",
  neutronStar: "#c7d8ff",
};

export const planetTypeLabel: Record<PlanetType, string> = {
  lava: "Lava world",
  rocky: "Rocky world",
  desert: "Desert world",
  ocean: "Ocean world",
  gasGiant: "Gas giant",
  iceGiant: "Ice giant",
  barren: "Barren world",
};

/** A short, forecastable description of a star's effect on output (Section 21 stellar dynamics). */
export function stellarNote(star: StarType): string | null {
  switch (star) {
    case "neutronStar":
      return "Pulses periodically spike rare-isotope / antimatter yield.";
    case "redGiant":
      return "Expanding star slowly scorches its ocean worlds (food declines late).";
    case "redDwarf":
      return "Flare star — extractors brown out on occasional turns.";
    default:
      return null;
  }
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

/** A system's full-development yield potential (sum of all deposit richness, Section 21). */
export function sumPotential(sys: System): number {
  const p = potentialYields(sys);
  return RESOURCES.reduce((sum, r) => sum + p[r], 0);
}

/** Approximate-size bucket for redacting rival convoy quantities (Section 11 fog of war). */
export function sizeBucket(value: number): string {
  if (value >= 600) return "Large";
  if (value >= 200) return "Medium";
  return "Small";
}
