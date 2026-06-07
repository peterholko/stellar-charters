/**
 * Single source of truth for the art slots. `ArtSlot` renders a real asset from
 * `web/public/assets/<slot>.png` when present, and otherwise a themed procedural
 * placeholder labelled with the slot id — so a missing asset never breaks layout,
 * it just announces what art belongs there. The generation prompts live in
 * `web/art-prompts.md`; source art lives in the repo-root `assets/` library.
 */
export interface ArtMeta {
  label: string;
  /** width / height aspect for panel-style slots. */
  ratio: number;
}

export const artManifest: Record<string, ArtMeta> = {
  // hero / environment
  "hero-wormhole-hub": { label: "Wormhole Hub", ratio: 16 / 9 },
  "bg-starfield": { label: "Starfield", ratio: 16 / 9 },

  // ships (Fleet shipyard / convoys)
  "ship-survey": { label: "Survey skiff", ratio: 1 },
  "ship-cargo": { label: "Cargo freighter", ratio: 3 / 2 },
  "ship-escort": { label: "Escort cutter", ratio: 3 / 2 },
  "ship-raider": { label: "Raider corsair", ratio: 3 / 2 },
  "ship-clipper": { label: "Deep-range clipper", ratio: 3 / 2 },
  "ship-fleet": { label: "Corporate fleet ship", ratio: 16 / 9 },
  "ship-convoy": { label: "Convoy group", ratio: 16 / 9 },

  // infrastructure
  "infra-depot": { label: "Trade Depot", ratio: 16 / 9 },
  "infra-hydroponics": { label: "Hydroponics", ratio: 1 },
  "infra-platform": { label: "Defense platform", ratio: 1 },

  // colony buildings (the planet build menu, Section 24/27)
  "building-factory": { label: "Factory", ratio: 1 },
  "building-reactor": { label: "Reactor", ratio: 1 },
  "building-agridome": { label: "Agri-dome", ratio: 1 },
  "building-miningrig": { label: "Mining rig", ratio: 1 },
  "building-habitat": { label: "Habitat", ratio: 1 },
  "building-powergrid": { label: "Power grid", ratio: 1 },
  "building-lab": { label: "Research lab", ratio: 1 },

  // research divisions (the Research screen, Section 28)
  "research-prospectus": { label: "Prospectus", ratio: 1 },
  "research-fabrication": { label: "Fabrication", ratio: 1 },
  "research-navigation": { label: "Navigation", ratio: 1 },
  "research-colonial": { label: "Colonial", ratio: 1 },
  "research-security": { label: "Security", ratio: 1 },
  "research-acquisitions": { label: "Acquisitions", ratio: 1 },

  // secret-project emblems (galaxy-unique capstones, Section 28 Phase 3)
  "secret-pro-antimatter": { label: "Antimatter Containment", ratio: 1 },
  "secret-fab-nanofab": { label: "Nanofabrication", ratio: 1 },
  "secret-nav-wormhole": { label: "Wormhole Engineering", ratio: 1 },
  "secret-col-arcology": { label: "Arcology", ratio: 1 },
  "secret-sec-orbital": { label: "Orbital Dominance", ratio: 1 },
  "secret-acq-insider": { label: "Insider Networks", ratio: 1 },

  // warp routes (route inspector)
  "route-stable": { label: "Stable warp lane", ratio: 16 / 9 },
  "route-unstable": { label: "Unstable warp lane", ratio: 16 / 9 },

  // colony growth stages
  "colony-outpost": { label: "Outpost", ratio: 16 / 9 },
  "colony-settlement": { label: "Settlement", ratio: 16 / 9 },
  "colony-colony": { label: "Colony", ratio: 16 / 9 },
  "colony-city": { label: "City", ratio: 16 / 9 },
  "colony-metropolis": { label: "Metropolis", ratio: 16 / 9 },

  // action glyphs (inspector action cues)
  "action-interdict": { label: "Interdict", ratio: 1 },
  "action-patrol": { label: "Patrol", ratio: 1 },
  "action-escort": { label: "Escort", ratio: 1 },
  "action-survey": { label: "Survey", ratio: 1 },
  "action-claim": { label: "Claim", ratio: 1 },

  // status indicators
  "status-raid-risk": { label: "Raid risk", ratio: 1 },
  "status-distress": { label: "Distress", ratio: 1 },
  "status-unrest": { label: "Unrest", ratio: 1 },
  "status-charter-lapse": { label: "Charter lapse", ratio: 1 },

  // event splashes (not yet placed)
  "event-raid": { label: "Convoy raid", ratio: 16 / 9 },
  "event-acquisition": { label: "Acquisition", ratio: 16 / 9 },
};
