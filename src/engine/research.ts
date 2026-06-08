/**
 * Research & specialization (Section 28).
 *
 * Six corporate Divisions, each a short tier spine with "pick-one" choice nodes. A charter pools
 * Research Points (from Research Labs + population), pours them into one active project at a time
 * (with a queue), and unlocks techs whose effects are read live via {@link researchMods}. The tree is
 * costed so a focused charter completes only ~2 divisions in the 42-turn game — you specialise, then
 * acquire / steal / conquer to get what you skipped. Phase 1: the economy, the tree, and the early
 * tunable-bump effects; marquee/cross-system techs (terraforming, wormhole lanes, secret projects,
 * espionage) land in later phases.
 *
 * Pure + deterministic (no Node APIs / Date.now / Math.random) like the rest of the engine core.
 */

export type ResearchDivision =
  | "prospectus"   // extraction sciences
  | "fabrication"  // industrial engineering
  | "navigation"   // warp dynamics & logistics
  | "colonial"     // xenobiology & statecraft
  | "security"     // naval doctrine
  | "acquisitions"; // market intelligence & espionage

export const RESEARCH_DIVISIONS: { id: ResearchDivision; name: string; blurb: string }[] = [
  { id: "prospectus", name: "Prospectus", blurb: "Extraction sciences — own the supply." },
  { id: "fabrication", name: "Fabrication", blurb: "Industrial engineering — out-build everyone." },
  { id: "navigation", name: "Navigation", blurb: "Warp dynamics & logistics — own the lanes." },
  { id: "colonial", name: "Colonial", blurb: "Xenobiology & statecraft — the tax superpower." },
  { id: "security", name: "Security", blurb: "Naval doctrine — the military hegemon." },
  { id: "acquisitions", name: "Acquisitions", blurb: "Market intelligence — the corporate raider." },
];

/** A single researchable technology (Section 28). */
export interface ResearchTech {
  id: string;
  division: ResearchDivision;
  tier: number;
  name: string;
  desc: string;
  /** Research points to complete. */
  rpCost: number;
  /** Tech ids that must be completed first. */
  prereqs: string[];
  /** Mutually-exclusive group within a division: completing one locks out its siblings. */
  choiceGroup?: string;
  /** Galaxy-unique: once any charter completes it, no other charter can (a race). Phase 3. */
  secret?: boolean;
  /** Navigation Warp-Drive techs raise the charter's range tier on completion (Section 28, Phase 2). */
  grantsRangeTier?: number;
}

// ---------------------------------------------------------------------------
// The tree (Phase 1: every tech has a live, wired effect)
// ---------------------------------------------------------------------------

export const RESEARCH_TREE: ResearchTech[] = [
  // — Prospectus —
  { id: "pro-extractors", division: "prospectus", tier: 1, name: "Improved Extractors", rpCost: 200, prereqs: [],
    desc: "Refined drilling raises every worked deposit's output by 15%." },
  { id: "pro-deepcore", division: "prospectus", tier: 2, name: "Deep-Core Drilling", rpCost: 320, prereqs: ["pro-extractors"], choiceGroup: "pro-2",
    desc: "Finite deposits deplete ~35% slower — sustain income deep into the game." },
  { id: "pro-hydrofrac", division: "prospectus", tier: 2, name: "Hydrofracturing", rpCost: 320, prereqs: ["pro-extractors"], choiceGroup: "pro-2",
    desc: "A further +12% extraction yield, leaning on renewable ice/gas/bio wells." },

  // — Fabrication —
  { id: "fab-assembly", division: "fabrication", tier: 1, name: "Assembly Lines", rpCost: 200, prereqs: [],
    desc: "Automated processors lift factory output by 20%." },
  { id: "fab-modular", division: "fabrication", tier: 2, name: "Modular Construction", rpCost: 320, prereqs: ["fab-assembly"], choiceGroup: "fab-2",
    desc: "Colonies pour +50% construction points per turn — everything builds faster." },
  { id: "fab-lean", division: "fabrication", tier: 2, name: "Lean Manufacturing", rpCost: 320, prereqs: ["fab-assembly"], choiceGroup: "fab-2",
    desc: "Building material bills cut by 40%." },
  { id: "fab-metallurgy", division: "fabrication", tier: 3, name: "Advanced Metallurgy", rpCost: 460, prereqs: ["fab-assembly"],
    desc: "Superalloy fabrication cuts megastructure construction cost by 30%." },

  // — Navigation — (the Warp-Drive range ladder now lives here, Section 28 Phase 2)
  { id: "nav-warp2", division: "navigation", tier: 1, name: "Warp Drive II", rpCost: 150, prereqs: [], grantsRangeTier: 2,
    desc: "Range 2 warp drives — reach the second ring of warp lanes." },
  { id: "nav-lanes", division: "navigation", tier: 1, name: "Lane Stabilization", rpCost: 180, prereqs: [],
    desc: "Charting frontier warp lanes costs half as much." },
  { id: "nav-warp3", division: "navigation", tier: 2, name: "Warp Drive III", rpCost: 260, prereqs: ["nav-warp2"], grantsRangeTier: 3,
    desc: "Range 3 warp drives — push into the rare-isotope frontier." },
  { id: "nav-logistics", division: "navigation", tier: 2, name: "Convoy Logistics", rpCost: 300, prereqs: ["nav-lanes"],
    desc: "Leaner fleet operations cut per-turn ship fuel burn by 40%." },
  { id: "nav-warp4", division: "navigation", tier: 3, name: "Warp Drive IV", rpCost: 380, prereqs: ["nav-warp3"], grantsRangeTier: 4,
    desc: "Range 4 warp drives — the deep abyssal lanes open up." },
  { id: "nav-warp5", division: "navigation", tier: 4, name: "Warp Drive V", rpCost: 520, prereqs: ["nav-warp4"], grantsRangeTier: 5,
    desc: "Range 5 warp drives — capital-class jump range across the galaxy." },

  // — Colonial —
  { id: "col-habitat", division: "colonial", tier: 1, name: "Habitat Engineering", rpCost: 200, prereqs: [],
    desc: "Every colony's population grows 30% faster." },
  { id: "col-charter", division: "colonial", tier: 2, name: "Charter Reform", rpCost: 320, prereqs: ["col-habitat"],
    desc: "Corporate restructuring cuts system upkeep by 40%." },
  { id: "col-terraform", division: "colonial", tier: 3, name: "Terraforming", rpCost: 500, prereqs: ["col-charter"],
    desc: "Unlocks terraforming: make a barren / lava / giant world habitable so it can grow a population." },

  // — Security —
  { id: "sec-plating", division: "security", tier: 1, name: "Hull Plating", rpCost: 200, prereqs: [],
    desc: "Hardened hulls raise system defense by 30%." },
  { id: "sec-firecontrol", division: "security", tier: 2, name: "Fire-Control", rpCost: 320, prereqs: ["sec-plating"], choiceGroup: "sec-2",
    desc: "Targeting suites raise warship combat by 25% (offense)." },
  { id: "sec-pointdef", division: "security", tier: 2, name: "Point-Defense", rpCost: 320, prereqs: ["sec-plating"], choiceGroup: "sec-2",
    desc: "Interceptor screens add a further +25% system defense (defense)." },
  { id: "sec-capital", division: "security", tier: 3, name: "Capital Shipyards", rpCost: 460, prereqs: ["sec-plating"],
    desc: "Dedicated yards build capital hulls (Range 5+) for 30% less." },

  // — Acquisitions —
  { id: "acq-algorithms", division: "acquisitions", tier: 1, name: "Market Algorithms", rpCost: 200, prereqs: [],
    desc: "Trading desks win 6% better fills on every exchange order." },
  { id: "acq-takeover", division: "acquisitions", tier: 2, name: "Hostile Takeover", rpCost: 320, prereqs: ["acq-algorithms"],
    desc: "Share raids and acquisitions cost 25% less." },
  { id: "acq-espionage", division: "acquisitions", tier: 3, name: "Industrial Espionage", rpCost: 460, prereqs: ["acq-takeover"],
    desc: "A spy network steals a random tech you lack from a rival every few turns." },

  // — Secret projects (Section 28, Phase 3): galaxy-unique T4 capstones — once any charter finishes
  //   one, no other charter can. A race for a one-of-a-kind edge.
  { id: "pro-antimatter", division: "prospectus", tier: 4, name: "Antimatter Containment", rpCost: 560, prereqs: ["pro-extractors"], secret: true,
    desc: "Galaxy-unique. An exotic-fuel monopoly: +30% extraction output across your empire." },
  { id: "fab-nanofab", division: "fabrication", tier: 4, name: "Nanofabrication", rpCost: 600, prereqs: ["fab-metallurgy"], secret: true,
    desc: "Galaxy-unique. Self-replicating foundries: factories +25% output and colonies build 2× faster." },
  { id: "nav-wormhole", division: "navigation", tier: 4, name: "Wormhole Engineering", rpCost: 620, prereqs: ["nav-warp4"], secret: true,
    desc: "Galaxy-unique. On completion, instantly charts every warp lane touching your systems; charting is then free." },
  { id: "col-arcology", division: "colonial", tier: 4, name: "Arcology", rpCost: 620, prereqs: ["col-terraform"], secret: true,
    desc: "Galaxy-unique. The first megacities: +50% population growth and +40% tax across your colonies." },
  { id: "sec-orbital", division: "security", tier: 4, name: "Orbital Dominance", rpCost: 600, prereqs: ["sec-capital"], secret: true,
    desc: "Galaxy-unique. Orbital bombardment: +40% warship combat and invasions land far more easily." },
  { id: "acq-insider", division: "acquisitions", tier: 4, name: "Insider Networks", rpCost: 560, prereqs: ["acq-takeover"], secret: true,
    desc: "Galaxy-unique. Total market capture: +10% fills and acquisitions cost 40% less." },
];

const TECH_BY_ID: Record<string, ResearchTech> = Object.fromEntries(RESEARCH_TREE.map((t) => [t.id, t]));

export function techById(id: string): ResearchTech | undefined {
  return TECH_BY_ID[id];
}

/** Tech ids locked out for a charter because a sibling in their choice group is already completed. */
export function lockedChoices(completed: string[]): Set<string> {
  const done = new Set(completed);
  const locked = new Set<string>();
  for (const t of RESEARCH_TREE) {
    if (!t.choiceGroup || done.has(t.id)) continue;
    const siblingDone = RESEARCH_TREE.some((s) => s.choiceGroup === t.choiceGroup && s.id !== t.id && done.has(s.id));
    if (siblingDone) locked.add(t.id);
  }
  return locked;
}

/** Whether `tech` can currently be queued by a charter that has completed `completed`. */
export function canResearch(tech: ResearchTech, completed: string[]): boolean {
  if (completed.includes(tech.id)) return false;
  if (lockedChoices(completed).has(tech.id)) return false;
  return tech.prereqs.every((p) => completed.includes(p));
}

// ---------------------------------------------------------------------------
// Effects — read live by the engine at point of use
// ---------------------------------------------------------------------------

/** Aggregate research modifiers a charter currently enjoys (Section 28). All multipliers default to
 *  neutral (1) and additive edges to 0, so an un-researched charter behaves exactly as before. */
export interface ResearchMods {
  yieldMult: number;            // extraction output
  depletionMult: number;        // reserve drain per unit extracted (<1 = slower)
  factoryOutputMult: number;    // processor output
  constructionRateMult: number; // build points / turn
  buildMaterialsMult: number;   // colony building material bills
  growthMult: number;           // population growth
  upkeepMult: number;           // system upkeep
  defenseMult: number;          // system raid/invasion defense
  shipCombatMult: number;       // warship combat strength
  shipFuelMult: number;         // per-turn fleet fuel burn
  marketEdge: number;           // fraction of a better fill on exchange orders (0..1)
  acquisitionCostMult: number;  // share-buy / acquisition cost
  surveyCostMult: number;       // route-charting cost
  capitalHullCostMult: number;  // capital warship (Range 5+) build cost
  megastructureCostMult: number;// megastructure build cost
  canTerraform: boolean;        // Terraforming unlocked (Section 28, Phase 2)
  taxMult: number;              // population tax yield (Section 28, Phase 3)
  captureRatioMult: number;     // invasion capture threshold (<1 = easier to capture)
  stealsTech: boolean;          // Industrial Espionage: steal a rival tech periodically
}

export function emptyResearchMods(): ResearchMods {
  return {
    yieldMult: 1, depletionMult: 1, factoryOutputMult: 1, constructionRateMult: 1, buildMaterialsMult: 1,
    growthMult: 1, upkeepMult: 1, defenseMult: 1, shipCombatMult: 1, shipFuelMult: 1,
    marketEdge: 0, acquisitionCostMult: 1, surveyCostMult: 1,
    capitalHullCostMult: 1, megastructureCostMult: 1, canTerraform: false,
    taxMult: 1, captureRatioMult: 1, stealsTech: false,
  };
}

/** Compute the live modifiers from a charter's completed tech list (Section 28). */
export function researchMods(completed: string[]): ResearchMods {
  const m = emptyResearchMods();
  const has = (id: string) => completed.includes(id);
  if (has("pro-extractors")) m.yieldMult *= 1.15;
  if (has("pro-hydrofrac")) m.yieldMult *= 1.12;
  if (has("pro-deepcore")) m.depletionMult *= 0.65;
  if (has("fab-assembly")) m.factoryOutputMult *= 1.2;
  if (has("fab-modular")) m.constructionRateMult *= 1.5;
  if (has("fab-lean")) m.buildMaterialsMult *= 0.6;
  if (has("nav-lanes")) m.surveyCostMult *= 0.5;
  if (has("nav-logistics")) m.shipFuelMult *= 0.6;
  if (has("col-habitat")) m.growthMult *= 1.3;
  if (has("col-charter")) m.upkeepMult *= 0.6;
  if (has("sec-plating")) m.defenseMult *= 1.3;
  if (has("sec-pointdef")) m.defenseMult *= 1.25;
  if (has("sec-firecontrol")) m.shipCombatMult *= 1.25;
  if (has("acq-algorithms")) m.marketEdge += 0.06;
  if (has("acq-takeover")) m.acquisitionCostMult *= 0.75;
  if (has("fab-metallurgy")) m.megastructureCostMult *= 0.7;
  if (has("sec-capital")) m.capitalHullCostMult *= 0.7;
  if (has("col-terraform")) m.canTerraform = true;
  if (has("acq-espionage")) m.stealsTech = true;
  // Secret-project capstones (Phase 3).
  if (has("pro-antimatter")) m.yieldMult *= 1.3;
  if (has("fab-nanofab")) { m.factoryOutputMult *= 1.25; m.constructionRateMult *= 2; }
  if (has("nav-wormhole")) m.surveyCostMult = 0;
  if (has("col-arcology")) { m.growthMult *= 1.5; m.taxMult *= 1.4; }
  if (has("sec-orbital")) { m.shipCombatMult *= 1.4; m.captureRatioMult *= 0.7; }
  if (has("acq-insider")) { m.marketEdge += 0.1; m.acquisitionCostMult *= 0.6; }
  return m;
}

/** The secret-project tech ids — galaxy-unique capstones (Section 28, Phase 3). */
export const SECRET_TECH_IDS: string[] = RESEARCH_TREE.filter((t) => t.secret).map((t) => t.id);
