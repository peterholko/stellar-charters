/**
 * Body-driven resource model (Section 21).
 *
 * A system's economy is the sum of its worked extraction sites, not a flat `yields` vector.
 * This module owns:
 *  - deterministic generation of a system's astrophysical bodies (star + planets + belts) and
 *    the resource deposits on them, biased by region and star type;
 *  - lowering either generated `bodies` OR a legacy authored `yields` shortcut into the runtime
 *    `ExtractionSite[]` the engine mines each turn;
 *  - the read-model shim `effectiveYields()` plus per-site output, stellar dynamics, and
 *    habitability helpers every consumer (engine, bots, UI, valuation) reasons over.
 *
 * Everything here is pure and seeded (no Node APIs, no Math.random / Date.now) so the same
 * source runs in the simulator, the Worker, and the browser, and replays identically.
 */
import type { Rng } from "./rng.js";
import {
  emptyBodyBuildings,
  emptyStockpile,
  type AsteroidBelt,
  type BodyBuildings,
  type BodyKind,
  type Deposit,
  type ExtractionSite,
  type Planet,
  type PlanetType,
  type Resource,
  type StarType,
  type Stockpile,
  type System,
  type SystemBodies,
  type SystemRegion,
} from "./types.js";

// ---------------------------------------------------------------------------
// Extractor maturity + per-site output
// ---------------------------------------------------------------------------

/** Max extractor level per site, and the richness fraction realised at each level. */
export const EXTRACTOR_CAP = 3;
const EXTRACTOR_EFFICIENCY = [0, 0.5, 0.78, 1.0]; // indexed by level (0 = unworked)

/** Richness fraction a site of the given extractor level realises (0 when unworked). */
export function extractorEfficiency(level: number): number {
  if (level <= 0) return 0;
  return EXTRACTOR_EFFICIENCY[Math.min(level, EXTRACTOR_CAP)] ?? 1;
}

/** True if a site can still produce (worked, online, and not a depleted finite deposit). */
export function siteIsProducing(site: ExtractionSite, turn: number): boolean {
  if (site.extractorLevel <= 0) return false;
  if (site.disabledUntil > turn) return false;
  if (site.reservesRemaining !== null && site.reservesRemaining <= 0) return false;
  return true;
}

/**
 * Units/turn a site yields right now: richness × extractor efficiency × stellar modifier,
 * clamped to whatever finite reserves remain. Pure and deterministic (stellar is a function of
 * the system's seed + turn, so it is forecastable).
 */
export function siteOutput(
  site: ExtractionSite,
  starType: StarType | undefined,
  systemSeed: number,
  turn: number,
  totalTurns: number,
): number {
  if (!siteIsProducing(site, turn)) return 0;
  const base = site.richness * extractorEfficiency(site.extractorLevel);
  const mult = stellarOutputMult(starType, site, systemSeed, turn, totalTurns);
  let out = base * mult;
  if (site.reservesRemaining !== null) out = Math.min(out, site.reservesRemaining);
  return Math.max(0, out);
}

/**
 * A system's *potential* per-turn output if every deposit were fully worked (max extractor,
 * ignoring depletion/stellar). Used to value prospects (claim/expand/bid decisions), since a
 * freshly-claimed system's sites are unworked and would otherwise read as worthless.
 */
export function potentialYields(sys: System): Stockpile {
  const out = emptyStockpile();
  for (const site of sys.sites) out[site.resource] += site.richness;
  return out;
}

/** A system's full per-turn extraction vector — the replacement for the old flat `yields`. */
export function effectiveYields(sys: System, turn: number, totalTurns: number): Stockpile {
  const out = emptyStockpile();
  const starType = sys.bodies?.starType;
  const seed = systemSeed(sys);
  for (const site of sys.sites) {
    out[site.resource] += siteOutput(site, starType, seed, turn, totalTurns);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Per-body buildings (Section 24) — buildings are owned by planets/belts; the
// system aggregates them (shared stockpile + pooled power).
// ---------------------------------------------------------------------------

/** The body key a site belongs to, e.g. "planet:2:metals" → "planet:2", "home:food" → "home". */
export function siteBodyKey(site: ExtractionSite): string {
  return site.key.split(":").slice(0, -1).join(":") || site.key;
}

/** The set of body keys a system can build on (planets/belts/star + any legacy site bodies). */
export function bodyKeysOf(sys: System): string[] {
  const keys = new Set<string>();
  if (sys.bodies) {
    sys.bodies.planets.forEach((_, i) => keys.add(`planet:${i}`));
    sys.bodies.asteroidBelts.forEach((_, i) => keys.add(`belt:${i}`));
    if (sys.bodies.starDeposits?.length) keys.add("star:0");
  }
  for (const s of sys.sites) keys.add(siteBodyKey(s)); // legacy / home-dome bodies
  return [...keys];
}

/** A deterministic default body for orders that don't name one (legacy replay / simple bots). */
export function primaryBodyKey(sys: System): string {
  const keys = bodyKeysOf(sys);
  // Prefer a habitable body, else the first by sorted key.
  const habitable = sys.sites.find((s) => s.habitable);
  if (habitable) return siteBodyKey(habitable);
  return keys.sort()[0] ?? "planet:0";
}

/** Get (creating if needed) the building record for one of a system's bodies. */
export function getBodyBuildings(sys: System, bodyKey: string): BodyBuildings {
  return (sys.bodyBuildings[bodyKey] ??= emptyBodyBuildings());
}

/** Aggregate every body's buildings into one record (the system totals). */
export function systemBuildings(sys: System): BodyBuildings {
  const out = emptyBodyBuildings();
  for (const b of Object.values(sys.bodyBuildings)) {
    out.reactors += b.reactors;
    out.hydroponics += b.hydroponics;
    out.miningRigs += b.miningRigs;
    out.habitats += b.habitats;
    out.powerGrid += b.powerGrid;
    for (const [id, n] of Object.entries(b.processors)) out.processors[id] = (out.processors[id] ?? 0) + n;
  }
  return out;
}

/** Total count of a building track across all of a system's bodies. */
export function buildingTotal(sys: System, track: "reactors" | "hydroponics" | "miningRigs" | "habitats" | "powerGrid"): number {
  let n = 0;
  for (const b of Object.values(sys.bodyBuildings)) n += b[track];
  return n;
}

/** A planet/belt/star as a first-class colony (Section 24): its metadata, deposits, and buildings.
 *  This is a pure read-model over `sys.bodies` + `sys.sites` + `sys.bodyBuildings` — the grouping the
 *  colony screen renders and the bots reason over. The system stays the container (shared stockpile). */
export interface ColonyInfo {
  key: string;
  kind: BodyKind;
  bodyType: ExtractionSite["bodyType"];
  bodyLabel: string;
  orbit: number;
  habitable: boolean;
  sites: ExtractionSite[];
  buildings: BodyBuildings;
}

/** Enumerate a system's colonies in orbital order. Bodies with no deposits still appear (you can
 *  develop a barren world's factories/habitats); legacy `yields` systems surface their synthetic
 *  bodies grouped by site key. */
export function coloniesOf(sys: System): ColonyInfo[] {
  const sitesByKey = new Map<string, ExtractionSite[]>();
  for (const s of sys.sites) {
    const k = siteBodyKey(s);
    (sitesByKey.get(k) ?? sitesByKey.set(k, []).get(k)!).push(s);
  }
  const colonies: ColonyInfo[] = [];
  const seen = new Set<string>();
  const add = (key: string, kind: BodyKind, bodyType: ExtractionSite["bodyType"], bodyLabel: string, orbit: number, habitable: boolean) => {
    if (seen.has(key)) return;
    seen.add(key);
    colonies.push({
      key, kind, bodyType, bodyLabel, orbit, habitable,
      sites: sitesByKey.get(key) ?? [],
      buildings: sys.bodyBuildings[key] ?? emptyBodyBuildings(),
    });
  };
  if (sys.bodies) {
    sys.bodies.planets.forEach((p, i) => add(`planet:${i}`, "planet", p.type, PLANET_LABEL[p.type], p.orbit, p.habitable));
    sys.bodies.asteroidBelts.forEach((b, i) => add(`belt:${i}`, "belt", "belt", "Asteroid belt", b.orbit, false));
    if (sys.bodies.starDeposits?.length) add("star:0", "star", "star", `${starLabel(sys.bodies.starType)} corona`, -1, false);
  }
  // Any body that only exists via its sites (legacy/home-dome) or that carries buildings but no
  // generated geology — fold it in from a representative site so nothing is lost.
  for (const [key, sites] of sitesByKey) {
    const s = sites[0];
    if (s) add(key, s.bodyKind, s.bodyType, s.bodyLabel, s.orbit, s.habitable);
  }
  for (const key of Object.keys(sys.bodyBuildings)) {
    if (!seen.has(key)) add(key, "planet", "rocky", "Colony", 0, false);
  }
  return colonies.sort((a, b) => a.orbit - b.orbit || a.key.localeCompare(b.key));
}

// ---------------------------------------------------------------------------
// Planet-type development affinities (Section 24) — a world's TYPE shapes what you build on it.
// These are the rules that make the colony screen a real decision: you farm ocean worlds, tool up
// rocky/lava industrial worlds, and run only orbital structures over the giants and belts.
// ---------------------------------------------------------------------------

/** The build menu a colony can offer (distinct from the underlying `BodyBuildings` storage). */
export type BuildingKind = "factory" | "reactor" | "agridome" | "habitat" | "mining" | "power";

type BodyType = ExtractionSite["bodyType"];

/** Whether a building can be constructed on this body type. Habitation/agriculture need a solid,
 *  temperate world (rocky/desert/ocean/barren); the giants and belts host only orbital industry;
 *  lava worlds are too hostile for domes/habitats; the star hosts nothing. */
export function canBuildOnBody(kind: BuildingKind, bodyType: BodyType): boolean {
  if (bodyType === "star") return false;
  const solidTemperate = bodyType === "rocky" || bodyType === "desert" || bodyType === "ocean" || bodyType === "barren";
  switch (kind) {
    case "agridome":
    case "habitat":
      return solidTemperate; // domes + population need a livable surface
    case "mining":
      // Fortified extraction: solid worlds + belts (you can't fortify a gas envelope).
      return bodyType !== "gasGiant" && bodyType !== "iceGiant";
    case "factory":
    case "reactor":
    case "power":
      return true; // industry runs anywhere with a foothold (orbital over the giants/belts)
    default:
      return false;
  }
}

/** Agri-dome food-output multiplier by world type — ocean worlds are the breadbaskets, barren
 *  worlds the worst arable land. Only meaningful where `canBuildOnBody("agridome", …)` is true. */
export function agriFoodMult(bodyType: BodyType): number {
  switch (bodyType) {
    case "ocean": return 1.5;
    case "rocky": return 1.0;
    case "desert": return 0.85;
    case "barren": return 0.65;
    default: return 1.0;
  }
}

/** Factory build-cost multiplier by world type — metal-rich rocky/lava worlds are cheap to tool up;
 *  oceans and the giants' orbital platforms cost a premium. Belts are convenient ore-side industry. */
export function factoryCostMult(bodyType: BodyType): number {
  switch (bodyType) {
    case "lava": return 0.8;
    case "rocky": return 0.85;
    case "belt": return 0.9;
    case "desert": return 1.0;
    case "barren": return 1.0;
    case "ocean": return 1.2;
    case "gasGiant":
    case "iceGiant": return 1.1;
    default: return 1.0;
  }
}

/** The body type of one of a system's bodies (for cost/affinity lookups in the engine + UI). */
export function bodyTypeOfKey(sys: System, bodyKey: string): BodyType {
  return coloniesOf(sys).find((c) => c.key === bodyKey)?.bodyType ?? "rocky";
}

/** Cheap, replayable per-system seed for stellar dynamics (independent of the gameplay Rng). */
export function systemSeed(sys: System): number {
  if (sys.position) return (sys.position.visualSeed ^ 0x2545f491) >>> 0;
  let h = 2166136261;
  for (let i = 0; i < sys.id.length; i++) {
    h ^= sys.id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ---------------------------------------------------------------------------
// Stellar dynamics (Section 21) — deterministic, forecastable per (system, turn)
// ---------------------------------------------------------------------------

const NEUTRON_PULSE_PERIOD = 4;
const NEUTRON_PULSE_MULT = 1.8;
const NEUTRON_TROUGH_MULT = 0.8;
const RED_GIANT_SCORCH_FRAC = 0.55; // ocean worlds start declining past this fraction of the match
const RED_DWARF_FLARE_CHANCE = 0.14; // chance an extractor browns out on a given turn

/** A small deterministic hash → [0,1), used for forecastable flare timing. */
function hash01(a: number, b: number): number {
  let t = (Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x165667b1, 0xc2b2ae35)) >>> 0;
  t ^= t >>> 15;
  t = Math.imul(t, 0x2c1b3c6d) >>> 0;
  t ^= t >>> 13;
  return (t >>> 0) / 4294967296;
}

/**
 * Time-varying output multiplier from the system's star (Section 21):
 *  - neutron star: periodic rare-isotope / antimatter pulses (spikes between lean turns);
 *  - red giant: habitable-zone drift slowly scorches ocean worlds (food declines mid-match);
 *  - red dwarf: flare star — extractors brown out on occasional, forecastable turns.
 * Returns 1 for steady stars.
 */
export function stellarOutputMult(
  starType: StarType | undefined,
  site: ExtractionSite,
  systemSeed: number,
  turn: number,
  totalTurns: number,
): number {
  if (!starType) return 1;
  switch (starType) {
    case "neutronStar": {
      if (site.resource !== "rareIsotopes" && site.resource !== "antimatter") return 1;
      return turn % NEUTRON_PULSE_PERIOD === 0 ? NEUTRON_PULSE_MULT : NEUTRON_TROUGH_MULT;
    }
    case "redGiant": {
      if (site.resource !== "food" || !site.habitable) return 1;
      const scorchAt = totalTurns * RED_GIANT_SCORCH_FRAC;
      if (turn <= scorchAt) return 1;
      const frac = Math.min(1, (turn - scorchAt) / Math.max(1, totalTurns - scorchAt));
      return Math.max(0.2, 1 - frac);
    }
    case "redDwarf": {
      return hash01(systemSeed, turn) < RED_DWARF_FLARE_CHANCE ? 0 : 1;
    }
    default:
      return 1;
  }
}

// ---------------------------------------------------------------------------
// Habitability (Section 21) — gates native population growth
// ---------------------------------------------------------------------------

/** True if the system has a body that can host a native population (an ocean/garden world). */
export function systemHasHabitableBody(sys: System): boolean {
  if (sys.bodies) return sys.bodies.planets.some((p) => p.habitable);
  // Legacy/authoring systems with no bodies: treat a food deposit as a garden world.
  return sys.sites.some((s) => s.resource === "food");
}

// ---------------------------------------------------------------------------
// Site construction (bodies / legacy yields → runtime ExtractionSite[])
// ---------------------------------------------------------------------------

const PLANET_LABEL: Record<PlanetType, string> = {
  lava: "Lava world",
  rocky: "Rocky world",
  desert: "Desert world",
  ocean: "Ocean world",
  gasGiant: "Gas giant",
  iceGiant: "Ice giant",
  barren: "Barren world",
};

export function planetLabel(type: PlanetType): string {
  return PLANET_LABEL[type];
}

/** Lower generated `bodies` into runtime extraction sites (all start unworked). */
export function sitesFromBodies(bodies: SystemBodies): ExtractionSite[] {
  const sites: ExtractionSite[] = [];
  const push = (
    kind: BodyKind,
    bodyType: ExtractionSite["bodyType"],
    bodyLabel: string,
    orbit: number,
    habitable: boolean,
    idx: number,
    deposits: Deposit[],
  ) => {
    for (const d of deposits) {
      sites.push({
        key: `${kind}:${idx}:${d.resource}`,
        bodyKind: kind,
        bodyType,
        bodyLabel,
        orbit,
        habitable,
        resource: d.resource,
        richness: d.richness,
        reservesRemaining: d.reserves,
        accessibility: d.accessibility,
        extractorLevel: 0,
        prospected: false,
        disabledUntil: 0,
      });
    }
  };
  bodies.planets.forEach((p, i) =>
    push("planet", p.type, PLANET_LABEL[p.type], p.orbit, p.habitable, i, p.deposits),
  );
  bodies.asteroidBelts.forEach((b, i) =>
    push("belt", "belt", "Asteroid belt", b.orbit, false, i, b.deposits),
  );
  if (bodies.starDeposits?.length) {
    push("star", "star", `${starLabel(bodies.starType)} corona`, -1, false, 0, bodies.starDeposits);
  }
  return sites;
}

/**
 * Lower a legacy authored `yields` vector into runtime sites: one always-on, infinite,
 * fully-accessible site per resource. This is the degenerate case that keeps every test map
 * and hand-authored scenario producing exactly its old output under the new engine.
 */
export function sitesFromYields(yields: Stockpile): ExtractionSite[] {
  const sites: ExtractionSite[] = [];
  for (const r of Object.keys(yields) as Resource[]) {
    const richness = yields[r];
    if (richness <= 0) continue;
    sites.push({
      key: `legacy:0:${r}`,
      bodyKind: "planet",
      bodyType: r === "food" ? "ocean" : "rocky",
      bodyLabel: r === "food" ? "Ocean world" : "Mining world",
      orbit: 0,
      habitable: r === "food",
      resource: r,
      richness,
      reservesRemaining: null,
      accessibility: 1,
      extractorLevel: EXTRACTOR_CAP, // fully developed → output equals the authored yield
      prospected: true,
      disabledUntil: 0,
    });
  }
  return sites;
}

const STAR_LABEL: Record<StarType, string> = {
  mainSequence: "Main-sequence star",
  redDwarf: "Red dwarf",
  redGiant: "Red giant",
  blueGiant: "Blue giant",
  whiteDwarf: "White dwarf",
  neutronStar: "Neutron star",
};

export function starLabel(type: StarType): string {
  return STAR_LABEL[type];
}

// ---------------------------------------------------------------------------
// Generation (Section 21) — bodies + deposits from a seeded Rng
// ---------------------------------------------------------------------------

interface StarSpec {
  /** Habitable-zone orbit window [inner, outer]; null = no habitable zone. */
  hz: [number, number] | null;
  countMin: number;
  countMax: number;
  /** Orbits strictly below this are scorched to lava (engulfed inner worlds). */
  scorchInner: number;
}

const STAR_SPECS: Record<StarType, StarSpec> = {
  mainSequence: { hz: [2, 3], countMin: 3, countMax: 6, scorchInner: 0 },
  redDwarf: { hz: [1, 1], countMin: 2, countMax: 4, scorchInner: 0 },
  redGiant: { hz: [3, 5], countMin: 3, countMax: 6, scorchInner: 2 },
  blueGiant: { hz: [4, 5], countMin: 4, countMax: 7, scorchInner: 1 },
  whiteDwarf: { hz: null, countMin: 1, countMax: 3, scorchInner: 0 },
  neutronStar: { hz: null, countMin: 0, countMax: 2, scorchInner: 0 },
};

/** Star-type weights per region (exotic remnants cluster outward). */
const STAR_WEIGHTS: Record<SystemRegion, Partial<Record<StarType, number>>> = {
  hub: { mainSequence: 1 },
  core: { mainSequence: 0.45, redDwarf: 0.3, redGiant: 0.12, blueGiant: 0.05, whiteDwarf: 0.08 },
  frontier: { mainSequence: 0.3, redDwarf: 0.25, redGiant: 0.18, blueGiant: 0.12, whiteDwarf: 0.1, neutronStar: 0.05 },
  abyss: { mainSequence: 0.12, redDwarf: 0.12, redGiant: 0.14, blueGiant: 0.2, whiteDwarf: 0.18, neutronStar: 0.24 },
};

function pickStarType(rng: Rng, region: SystemRegion): StarType {
  const weights = STAR_WEIGHTS[region];
  const entries = Object.entries(weights) as [StarType, number][];
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let roll = rng.float(0, total);
  for (const [type, w] of entries) {
    roll -= w;
    if (roll <= 0) return type;
  }
  return entries[0]![0];
}

/** Richness/reserve scale per region (deeper bands are richer but rarer/harder). */
const REGION_SCALE: Record<SystemRegion, number> = { hub: 0, core: 1, frontier: 1.15, abyss: 1.3 };

interface DepositSpec {
  resource: Resource;
  rich: [number, number];
  /** Finite reserves multiplier (× richness) or null for renewable. */
  reserveTurns: number | null;
  access: [number, number];
  chance: number;
}

/** What each planet type can carry. Renewable = bio/gas/ice; finite = ore/exotic. */
const PLANET_DEPOSITS: Record<PlanetType, DepositSpec[]> = {
  lava: [
    { resource: "metals", rich: [3, 6], reserveTurns: 30, access: [0.4, 0.7], chance: 0.55 },
    { resource: "rareIsotopes", rich: [1, 3], reserveTurns: 24, access: [0.2, 0.5], chance: 0.4 },
  ],
  rocky: [
    { resource: "metals", rich: [4, 8], reserveTurns: 36, access: [0.6, 0.95], chance: 0.9 },
    { resource: "silicates", rich: [3, 7], reserveTurns: 36, access: [0.6, 0.95], chance: 0.6 },
  ],
  desert: [
    { resource: "silicates", rich: [5, 10], reserveTurns: 36, access: [0.6, 0.95], chance: 0.9 },
    { resource: "metals", rich: [2, 4], reserveTurns: 32, access: [0.5, 0.85], chance: 0.35 },
  ],
  ocean: [
    { resource: "food", rich: [6, 11], reserveTurns: null, access: [0.7, 1], chance: 1 },
    { resource: "ice", rich: [3, 7], reserveTurns: null, access: [0.7, 1], chance: 0.7 },
  ],
  gasGiant: [
    { resource: "helium3", rich: [4, 8], reserveTurns: null, access: [0.4, 0.7], chance: 1 },
  ],
  iceGiant: [
    { resource: "ice", rich: [6, 12], reserveTurns: null, access: [0.5, 0.85], chance: 1 },
    { resource: "helium3", rich: [2, 4], reserveTurns: null, access: [0.4, 0.7], chance: 0.6 },
  ],
  barren: [
    { resource: "metals", rich: [2, 4], reserveTurns: 24, access: [0.5, 0.8], chance: 0.35 },
  ],
};

const BELT_DEPOSITS: DepositSpec[] = [
  { resource: "metals", rich: [4, 8], reserveTurns: 28, access: [0.5, 0.85], chance: 0.85 },
  { resource: "silicates", rich: [4, 9], reserveTurns: 28, access: [0.5, 0.85], chance: 0.7 },
  { resource: "rareIsotopes", rich: [2, 4], reserveTurns: 20, access: [0.25, 0.5], chance: 0.35 },
];

/** Star coronae you can harvest (Section 21 exotic prize). */
const STAR_DEPOSITS: Partial<Record<StarType, DepositSpec[]>> = {
  neutronStar: [
    { resource: "antimatter", rich: [2, 4], reserveTurns: 30, access: [0.1, 0.3], chance: 1 },
    { resource: "rareIsotopes", rich: [2, 5], reserveTurns: 30, access: [0.2, 0.4], chance: 0.8 },
  ],
  whiteDwarf: [
    { resource: "metals", rich: [4, 8], reserveTurns: 26, access: [0.3, 0.6], chance: 0.7 },
    { resource: "rareIsotopes", rich: [1, 3], reserveTurns: 22, access: [0.2, 0.45], chance: 0.5 },
  ],
};

function rollDeposits(rng: Rng, specs: DepositSpec[], scale: number): Deposit[] {
  const out: Deposit[] = [];
  for (const s of specs) {
    if (!rng.chance(s.chance)) continue;
    const richness = round1(rng.float(s.rich[0], s.rich[1]) * scale);
    if (richness <= 0) continue;
    out.push({
      resource: s.resource,
      richness,
      reserves: s.reserveTurns === null ? null : Math.round(richness * s.reserveTurns),
      accessibility: round2(rng.float(s.access[0], s.access[1])),
    });
  }
  return out;
}

export interface BodyGenOptions {
  region: SystemRegion;
  /** A raw the system should be guaranteed to carry (keeps core resource coverage). */
  primaryResource?: Resource;
  /** Force at least one habitable world (inner-ring starts must be viable). */
  requireHabitable?: boolean;
}

/** Generate a system's full astrophysical contents + deposits (deterministic via `rng`). */
export function generateSystemBodies(rng: Rng, opts: BodyGenOptions): SystemBodies {
  const { region } = opts;
  const scale = REGION_SCALE[region];
  let starType = pickStarType(rng, region);
  // The abyss is the antimatter frontier: guarantee an exotic remnant there.
  if (region === "abyss" && starType !== "neutronStar" && starType !== "whiteDwarf") {
    starType = rng.chance(0.6) ? "neutronStar" : "whiteDwarf";
  }
  const spec = STAR_SPECS[starType];
  const count = rng.int(spec.countMin, spec.countMax);

  const planets: Planet[] = [];
  for (let orbit = 0; orbit < count; orbit++) {
    const type = planetTypeFor(rng, spec, orbit, count);
    const habitable = spec.hz !== null && orbit >= spec.hz[0] && orbit <= spec.hz[1] && type === "ocean";
    planets.push({
      type,
      orbit,
      habitable,
      visualSeed: rng.int(0, 0x7fffffff),
      deposits: rollDeposits(rng, PLANET_DEPOSITS[type], scale),
    });
  }

  const bodies: SystemBodies = { starType, planets, asteroidBelts: [] };

  // Star corona harvest for remnants.
  if (STAR_DEPOSITS[starType]) {
    const sd = rollDeposits(rng, STAR_DEPOSITS[starType]!, scale);
    if (sd.length) bodies.starDeposits = sd;
  }

  // Asteroid belt(s): placed between the last inner rocky/ocean world and the first gas giant.
  placeBelts(rng, bodies, scale);

  // Region resource rules (Section 21): rare isotopes are a frontier+ prize and antimatter is
  // abyss-only, regardless of what the body tables rolled — this preserves the economic geography.
  pruneByRegion(bodies, region);

  // Region resource guarantees + start viability.
  if (opts.primaryResource) ensureDeposit(rng, bodies, opts.primaryResource, scale);
  if (region === "frontier" || region === "abyss") ensureDeposit(rng, bodies, "rareIsotopes", scale);
  if (region === "abyss") ensureDeposit(rng, bodies, "antimatter", scale);
  if (opts.requireHabitable) ensureHabitable(rng, bodies, scale);

  return bodies;
}

/** A resource a region is allowed to carry (Section 21 economic geography). */
function resourceAllowed(region: SystemRegion, r: Resource): boolean {
  if (r === "antimatter") return region === "abyss";
  if (r === "rareIsotopes") return region !== "core" && region !== "hub";
  return true;
}

/** Strip deposits a region is not allowed to carry. */
function pruneByRegion(bodies: SystemBodies, region: SystemRegion): void {
  const keep = (d: Deposit) => resourceAllowed(region, d.resource);
  for (const p of bodies.planets) p.deposits = p.deposits.filter(keep);
  for (const b of bodies.asteroidBelts) b.deposits = b.deposits.filter(keep);
  if (bodies.starDeposits) bodies.starDeposits = bodies.starDeposits.filter(keep);
}

/** Planet type from the star's habitable-zone geometry + orbital position. */
function planetTypeFor(rng: Rng, spec: StarSpec, orbit: number, count: number): PlanetType {
  if (orbit < spec.scorchInner) return "lava";
  if (spec.hz && orbit >= spec.hz[0] && orbit <= spec.hz[1]) {
    // Ocean (habitable) worlds are deliberately uncommon even inside the zone, so garden
    // worlds stay a scarce, contested prize rather than the default (Section 21).
    return rng.chance(0.4) ? "ocean" : rng.chance(0.5) ? "desert" : "rocky";
  }
  if (spec.hz && orbit < spec.hz[0]) {
    return rng.chance(0.55) ? "rocky" : rng.chance(0.5) ? "desert" : "lava";
  }
  // Outer system: giants then ice then barren.
  const outerFrac = count > 1 ? orbit / (count - 1) : 1;
  if (outerFrac > 0.8) return rng.chance(0.5) ? "iceGiant" : "barren";
  return rng.chance(0.6) ? "gasGiant" : rng.chance(0.5) ? "iceGiant" : "rocky";
}

/** Insert 0–2 asteroid belts at the inner/outer boundary (between rocky and gas-giant zones). */
function placeBelts(rng: Rng, bodies: SystemBodies, scale: number): void {
  const isInner = (t: PlanetType) => t === "rocky" || t === "ocean" || t === "desert" || t === "lava";
  const innerOrbits = bodies.planets.filter((p) => isInner(p.type)).map((p) => p.orbit);
  const maxInner = innerOrbits.length ? Math.max(...innerOrbits) : -1;
  // The first giant orbiting beyond the inner zone (so the belt always sits between the two).
  const outerGiants = bodies.planets
    .filter((p) => (p.type === "gasGiant" || p.type === "iceGiant") && p.orbit > maxInner)
    .map((p) => p.orbit);
  const firstGiant = outerGiants.length ? Math.min(...outerGiants) : -1;
  const beltOrbit =
    maxInner >= 0 && firstGiant >= 0
      ? (maxInner + firstGiant) / 2
      : maxInner >= 0
      ? maxInner + 0.5
      : firstGiant >= 0
      ? Math.max(0, firstGiant - 0.5) // giant-first system: belt sits inside it
      : 1.5;
  const beltCount = rng.chance(0.55) ? (rng.chance(0.3) ? 2 : 1) : 0;
  for (let i = 0; i < beltCount; i++) {
    const deposits = rollDeposits(rng, BELT_DEPOSITS, scale);
    if (deposits.length) bodies.asteroidBelts.push({ orbit: round1(beltOrbit + i * 0.3), deposits });
  }
}

/** Ensure the system carries at least one deposit of `resource` (region coverage guarantee). */
function ensureDeposit(rng: Rng, bodies: SystemBodies, resource: Resource, scale: number): void {
  const has =
    bodies.planets.some((p) => p.deposits.some((d) => d.resource === resource)) ||
    bodies.asteroidBelts.some((b) => b.deposits.some((d) => d.resource === resource)) ||
    (bodies.starDeposits?.some((d) => d.resource === resource) ?? false);
  if (has) return;
  const renewable = resource === "food" || resource === "ice" || resource === "helium3";
  const richness = round1(rng.float(4, 8) * scale);
  const dep: Deposit = {
    resource,
    richness,
    reserves: renewable ? null : Math.round(richness * 30),
    accessibility: round2(rng.float(0.55, 0.9)),
  };
  // Attach to a sensible host body, else add a barren rock to carry it.
  const host = bodies.planets[0];
  if (host) host.deposits.push(dep);
  else bodies.planets.push({ type: "barren", orbit: 0, habitable: false, visualSeed: rng.int(0, 0x7fffffff), deposits: [dep] });
}

/** Force a habitable ocean world so inner-ring starts can grow a population. */
function ensureHabitable(rng: Rng, bodies: SystemBodies, scale: number): void {
  if (bodies.planets.some((p) => p.habitable)) return;
  // Promote a mid-orbit planet to a habitable ocean world (or add one).
  const mid = bodies.planets.find((p) => p.type === "rocky" || p.type === "desert");
  const foodDep: Deposit = {
    resource: "food",
    richness: round1(rng.float(6, 10) * scale),
    reserves: null,
    accessibility: round2(rng.float(0.75, 1)),
  };
  if (mid) {
    mid.type = "ocean";
    mid.habitable = true;
    if (!mid.deposits.some((d) => d.resource === "food")) mid.deposits.push(foodDep);
  } else {
    bodies.planets.push({
      type: "ocean",
      orbit: bodies.planets.length,
      habitable: true,
      visualSeed: rng.int(0, 0x7fffffff),
      deposits: [foodDep],
    });
  }
}

// ----- small rounders (keep generated JSON compact + replay-stable) -----

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
