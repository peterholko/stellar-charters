import {
  HULL_CLASS_NAMES,
  RESOURCES,
  potentialYields,
  type MegastructureKind,
  type PlanetType,
  type RangeTier,
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

/**
 * Named extraction structures (playtest feedback): a worked deposit IS a leveled building —
 * "Metal Mine L2" — not a bare geology row with a cryptic "Deepen" verb. The engine's
 * `extractorLevel` (1..EXTRACTOR_CAP) is the level; these are its player-facing names.
 */
export const extractorNames: Record<Resource, string> = {
  metals: "Metal Mine",
  ice: "Ice Harvester",
  silicates: "Silicate Quarry",
  helium3: "Helium-3 Skimmer",
  rareIsotopes: "Isotope Refinery",
  food: "Agri Combine",
  antimatter: "Antimatter Trap",
  // Manufactured goods never occur as deposits; present for Record totality.
  fuel: "Fuel Plant",
  alloys: "Alloy Works",
  polymers: "Polymer Plant",
  components: "Component Fab",
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

/** "Frigate" — the named warship hull class for a range tier (the tier stays the range stat). */
export function hullName(tier: RangeTier): string {
  return HULL_CLASS_NAMES[tier];
}

/**
 * Sci-fi flavour per hull class (Section 04 "name things, folklore is a feature"). UI-only —
 * the engine's reports keep the bare class name. `epithet` is a short nickname surfaced next to
 * the hull name; `line` is a one-sentence identity shown as a tooltip / subtitle.
 */
export const HULL_FLAVOR: Record<RangeTier, { epithet: string; line: string }> = {
  1: { epithet: "Skiff", line: "Cheapest charter hull — half civilian runabout." },
  2: { epithet: "Picket", line: "Light frontier escort and route scout." },
  3: { epithet: "Clipper", line: "Dependable frontier workhorse; first true deep-range hull." },
  4: { epithet: "Linebreaker", line: "Heavy combat and logistics — the gateway to capital hulls." },
  5: { epithet: "Capital line", line: "First true capital — a mobile corporate fortress." },
  6: { epithet: "Raider-of-the-line", line: "Fast capital, built to run down convoys and break blockades." },
  7: { epithet: "Broadside", line: "Apex line warship — slow, ruinous, unmistakable." },
  8: { epithet: "Charter-killer", line: "The apex war-monster only the richest charters can field." },
};

/** "Skiff" — the hull class's flavour nickname. */
export function hullEpithet(tier: RangeTier): string {
  return HULL_FLAVOR[tier].epithet;
}

/** Shipyard art for a hull class — one asset per named hull; raiders share the deniable corsair. */
export function hullArtSlot(tier: RangeTier, raider: boolean): string {
  if (raider) return "ship-raider"; // privateers run anonymous, look-alike hulls by design
  return `ship-${hullName(tier).toLowerCase()}`; // ship-cutter … ship-dreadnought
}

export function formatCredits(value: number): string {
  const v = Math.round(value);
  return `${v.toLocaleString("en-US")}`;
}

export function formatCr(value: number): string {
  // Suffix code, financial-convention style ("2,450 Cr" — like "100 USD" or EVE's ISK).
  return `${formatCredits(value)} Cr`;
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

export const megastructureLabel: Record<MegastructureKind, string> = {
  orbitalStation: "Orbital Station",
  spaceElevator: "Space Elevator",
  ringworld: "Ringworld",
};

/** Compact label for badges. */
export const megastructureShort: Record<MegastructureKind, string> = {
  orbitalStation: "Station",
  spaceElevator: "Elevator",
  ringworld: "Ringworld",
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

/** Deterministic FNV-1a hash → unsigned 32-bit, for stable cosmetic derivations from ids. */
function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const SHIP_PREFIXES = ["SS", "MV", "CSV", "ISV", "SCV", "MSV", "TLV", "GSV"];
const SHIP_NAMES = [
  "Meridian", "Calypso", "Halcyon", "Aurelia", "Perdita", "Stalwart", "Wayfarer", "Tempest",
  "Lodestar", "Vesper", "Sojourner", "Equinox", "Marauder", "Solstice", "Peregrine", "Nomad",
  "Zephyr", "Corsair", "Andromeda", "Persephone", "Icarus", "Daedalus", "Orpheus", "Aegis",
  "Valkyrie", "Nautilus", "Leviathan", "Seraphim", "Onyx", "Cinder", "Ember", "Quasar",
  "Pulsar", "Nebula", "Cassiopeia", "Borealis", "Drifter", "Vanguard", "Sentinel", "Harbinger",
  "Odyssey", "Mistral", "Sirocco", "Albatross", "Kestrel", "Osprey", "Falcon", "Tycho",
];

/** A stable, ship-like name for a convoy, derived from its id (so cargo stays hidden — the
 *  contents are known only to the exporter). The same convoy always reads the same name. */
export function convoyName(id: string): string {
  const h = hashId(id);
  const prefix = SHIP_PREFIXES[h % SHIP_PREFIXES.length]!;
  const name = SHIP_NAMES[(h >>> 8) % SHIP_NAMES.length]!;
  return `${prefix} ${name}`;
}
