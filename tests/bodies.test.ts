/**
 * Body-driven resource model (Section 21): generation rules, extractor gating, depletion,
 * habitability, and the fog of war on deposits.
 */
import { describe, expect, it } from "vitest";
import {
  EXTRACTOR_CAP,
  agriFoodMult,
  canBuildOnBody,
  coloniesOf,
  effectiveYields,
  factoryCostMult,
  generateSystemBodies,
  getBodyBuildings,
  potentialYields,
  sitesFromBodies,
  sitesFromYields,
  systemHasHabitableBody,
} from "../src/engine/bodies.js";
import { Rng } from "../src/engine/rng.js";
import { Engine } from "../src/engine/engine.js";
import { loadScenario, type Scenario } from "../src/engine/config.js";
import { buildClientState } from "../src/engine/clientState.js";
import type { Bot, BotFactory, PlayerView } from "../src/engine/bots/bot.js";
import type { BidOrder, Order, System } from "../src/engine/types.js";

function gen(seed: number, region: "core" | "frontier" | "abyss") {
  return generateSystemBodies(new Rng(seed), { region });
}

function depositResources(bodies: ReturnType<typeof gen>): Set<string> {
  const out = new Set<string>();
  for (const p of bodies.planets) for (const d of p.deposits) out.add(d.resource);
  for (const b of bodies.asteroidBelts) for (const d of b.deposits) out.add(d.resource);
  for (const d of bodies.starDeposits ?? []) out.add(d.resource);
  return out;
}

describe("body generation (Section 21)", () => {
  it("is deterministic for the same seed + region", () => {
    expect(JSON.stringify(gen(7, "core"))).toBe(JSON.stringify(gen(7, "core")));
  });

  it("honours the region resource geography", () => {
    for (let s = 0; s < 40; s++) {
      const core = depositResources(gen(s, "core"));
      expect(core.has("rareIsotopes")).toBe(false);
      expect(core.has("antimatter")).toBe(false);
      expect(depositResources(gen(s, "frontier")).has("rareIsotopes")).toBe(true);
      const abyss = depositResources(gen(s, "abyss"));
      expect(abyss.has("antimatter")).toBe(true);
    }
  });

  it("places asteroid belts beyond the inner rocky zone, before the outer giants", () => {
    for (let s = 0; s < 60; s++) {
      const b = gen(s, "core");
      for (const belt of b.asteroidBelts) {
        const inner = b.planets.filter(
          (p) => p.type === "rocky" || p.type === "ocean" || p.type === "desert" || p.type === "lava",
        );
        // The belt sits at or beyond every inner rocky/ocean world (the load-bearing rule).
        for (const p of inner) expect(belt.orbit).toBeGreaterThanOrEqual(p.orbit - 0.001);
        // When a giant sits outside the inner zone, the belt is between the two.
        const maxInner = inner.reduce((m, p) => Math.max(m, p.orbit), -1);
        const outerGiant = b.planets.find(
          (p) => (p.type === "gasGiant" || p.type === "iceGiant") && p.orbit > maxInner,
        );
        if (outerGiant) expect(belt.orbit).toBeLessThanOrEqual(outerGiant.orbit + 0.6);
      }
    }
  });
});

describe("extraction sites + effective yields (Section 21)", () => {
  it("body sites start unworked and produce nothing until an extractor is built", () => {
    const sites = sitesFromBodies(gen(3, "core"));
    expect(sites.every((s) => s.extractorLevel === 0)).toBe(true);
    const sys = { id: "x", sites, bodies: gen(3, "core") } as unknown as System;
    const ey = effectiveYields(sys, 1, 42);
    expect(Object.values(ey).every((v) => v === 0)).toBe(true);
    // Potential reflects full development even while unworked.
    expect(Object.values(potentialYields(sys)).some((v) => v > 0)).toBe(true);
  });

  it("legacy yields lower into fully-worked sites that reproduce the flat vector", () => {
    const sites = sitesFromYields({
      ice: 12, metals: 4, silicates: 0, helium3: 0, rareIsotopes: 0, food: 0,
      fuel: 0, alloys: 0, polymers: 0, components: 0, antimatter: 0,
    });
    expect(sites.every((s) => s.extractorLevel === EXTRACTOR_CAP)).toBe(true);
    const sys = { id: "x", sites } as unknown as System;
    const ey = effectiveYields(sys, 1, 42);
    expect(ey.ice).toBeCloseTo(12, 6);
    expect(ey.metals).toBeCloseTo(4, 6);
  });

  it("reports habitability from an ocean world", () => {
    const withOcean = {
      sites: [], bodies: { starType: "mainSequence", planets: [{ type: "ocean", orbit: 2, habitable: true, visualSeed: 1, deposits: [] }], asteroidBelts: [] },
    } as unknown as System;
    const withoutOcean = { sites: [], bodies: { starType: "whiteDwarf", planets: [], asteroidBelts: [] } } as unknown as System;
    expect(systemHasHabitableBody(withOcean)).toBe(true);
    expect(systemHasHabitableBody(withoutOcean)).toBe(false);
  });
});

describe("colony read-model (Section 24)", () => {
  it("groups deposits + buildings under each body in orbital order", () => {
    const bodies = gen(3, "core");
    const sites = sitesFromBodies(bodies);
    const sys = { id: "x", sites, bodies, bodyBuildings: {} } as unknown as System;
    const colonies = coloniesOf(sys);
    // One colony per planet + belt (+ a star-corona colony only when the star carries deposits).
    const expected = bodies.planets.length + bodies.asteroidBelts.length + (bodies.starDeposits?.length ? 1 : 0);
    expect(colonies.length).toBe(expected);
    // Returned in orbital order (corona at -1 sorts first).
    const orbits = colonies.map((c) => c.orbit);
    expect([...orbits].sort((a, b) => a - b)).toEqual(orbits);
    // Every site is attributed to exactly one colony; the union is the whole site list.
    expect(colonies.flatMap((c) => c.sites).length).toBe(sites.length);
    // A building placed on a specific body surfaces on that body's colony only.
    getBodyBuildings(sys, "planet:0").reactors = 2;
    const reread = coloniesOf(sys);
    expect(reread.find((c) => c.key === "planet:0")!.buildings.reactors).toBe(2);
    expect(reread.filter((c) => c.key !== "planet:0").every((c) => c.buildings.reactors === 0)).toBe(true);
  });

  it("gates buildings by planet type (Section 24 affinities)", () => {
    // Domes + habitats need a livable surface; giants/belts host only orbital industry.
    expect(canBuildOnBody("agridome", "ocean")).toBe(true);
    expect(canBuildOnBody("agridome", "rocky")).toBe(true);
    expect(canBuildOnBody("agridome", "gasGiant")).toBe(false);
    expect(canBuildOnBody("agridome", "belt")).toBe(false);
    expect(canBuildOnBody("agridome", "lava")).toBe(false);
    expect(canBuildOnBody("habitat", "iceGiant")).toBe(false);
    // Industry runs anywhere with a foothold; nothing builds on the star.
    expect(canBuildOnBody("factory", "gasGiant")).toBe(true);
    expect(canBuildOnBody("reactor", "belt")).toBe(true);
    expect(canBuildOnBody("factory", "star")).toBe(false);
    // Mining fortifies solid worlds + belts, never a gas envelope.
    expect(canBuildOnBody("mining", "belt")).toBe(true);
    expect(canBuildOnBody("mining", "gasGiant")).toBe(false);
  });

  it("ranks farmland + factory cost by world type", () => {
    // Ocean is the breadbasket, barren the worst arable land.
    expect(agriFoodMult("ocean")).toBeGreaterThan(agriFoodMult("rocky"));
    expect(agriFoodMult("rocky")).toBeGreaterThan(agriFoodMult("barren"));
    // Metal-rich rocky/lava worlds tool up cheaper than oceans or orbital-over-giants.
    expect(factoryCostMult("rocky")).toBeLessThan(1);
    expect(factoryCostMult("lava")).toBeLessThan(factoryCostMult("rocky"));
    expect(factoryCostMult("ocean")).toBeGreaterThan(1);
  });

  it("folds a legacy yields system into a single synthetic colony", () => {
    const sites = sitesFromYields({
      ice: 12, metals: 4, silicates: 0, helium3: 0, rareIsotopes: 0, food: 6,
      fuel: 0, alloys: 0, polymers: 0, components: 0, antimatter: 0,
    });
    const sys = { id: "y", sites, bodyBuildings: {} } as unknown as System;
    const colonies = coloniesOf(sys);
    expect(colonies.length).toBe(1); // all legacy sites share the "legacy:0" body
    expect(colonies[0]!.sites.length).toBe(sites.length);
  });
});

/** A bot that builds an extractor on a named site, then idles. */
class ExtractorBot implements Bot {
  readonly id = "noop";
  constructor(private readonly siteKey: () => { systemId: string; siteKey: string } | null) {}
  bid(): BidOrder {
    return { kind: "bid", priorities: [] };
  }
  decide(): Order[] {
    const t = this.siteKey();
    return t ? [{ kind: "buildExtractor", systemId: t.systemId, siteKey: t.siteKey }] : [];
  }
}

function oneBodySystem(): Scenario {
  // A home system with one finite metals deposit (richness 6, small reserves to force depletion).
  return {
    name: "depl", hubId: "hub", players: 1, turns: 30, bots: ["noop"],
    systems: [
      { id: "hub", name: "Hub", yields: {}, claimCost: 0, upkeep: 0, defense: 99 },
      {
        id: "s0", name: "S0", yields: {}, claimCost: 1000, upkeep: 0, defense: 2, innerRing: true,
        bodies: {
          starType: "mainSequence",
          planets: [{ type: "rocky", orbit: 1, habitable: false, visualSeed: 1, deposits: [{ resource: "metals", richness: 6, reserves: 24, accessibility: 1 }] }],
          asteroidBelts: [],
        },
      },
    ],
    routes: [{ a: "hub", b: "s0", transitTime: 1, stability: 0.9, capacity: 50, exposure: 0.3, authorityPresence: 0.8, charted: true }],
  };
}

describe("extractors, depletion & fog (Section 21)", () => {
  it("a finite deposit depletes and stops producing once its reserves run out", () => {
    const reg = new Map<string, BotFactory>([["noop", () => new ExtractorBot(() => ({ systemId: "s0", siteKey: "planet:0:metals" }))]]);
    const eng = new Engine(loadScenario(oneBodySystem()), 1, reg);
    eng.galaxy.system("s0").stockpile.alloys = 100; // builds need materials ON HAND (no auto-buy)
    const site = () => eng.galaxy.system("s0").sites.find((s) => s.resource === "metals")!;
    eng.stepTurn(); // builds extractor levels + extracts
    const earlyMetals = eng.galaxy.system("s0").stockpile.metals;
    expect(earlyMetals).toBeGreaterThan(0);
    for (let i = 0; i < 25; i++) eng.stepTurn();
    expect(site().reservesRemaining).toBe(0); // depleted
  });

  it("redacts unsurveyed richness and rivals' reserves in the client state (fog)", () => {
    const reg = new Map<string, BotFactory>([["noop", () => new ExtractorBot(() => null)]]);
    const eng = new Engine(loadScenario(oneBodySystem()), 1, reg);
    eng.stepTurn();
    // The owner's starter-extracted site is prospected → richness visible to the owner.
    const mine = buildClientState(eng, "corp-0", "g", []).systems.find((s) => s.id === "s0")!;
    const worked = mine.sites.find((s) => s.extractorLevel > 0)!;
    expect(worked.richness).not.toBeNull();
    // A different (rival) perspective sees the system's reserves redacted.
    const theirs = buildClientState(eng, "corp-1", "g", []).systems.find((s) => s.id === "s0")!;
    const same = theirs.sites.find((s) => s.key === worked.key)!;
    expect(same.reservesRemaining).toBeNull();
  });
});
