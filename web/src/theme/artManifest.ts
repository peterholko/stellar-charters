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
