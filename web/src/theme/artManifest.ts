/**
 * Single source of truth for the placeholder art slots. `ArtSlot` renders a themed
 * procedural placeholder labelled with the slot id until a real asset is dropped into
 * `web/public/assets/<id>.png`. The generation prompts live in `web/art-prompts.md`.
 */
export interface ArtMeta {
  label: string;
  /** width / height aspect for panel-style slots. */
  ratio: number;
}

export const artManifest: Record<string, ArtMeta> = {
  "hero-wormhole-hub": { label: "Wormhole Hub", ratio: 16 / 9 },
  "bg-starfield": { label: "Starfield", ratio: 16 / 9 },
  "ship-survey": { label: "Survey skiff", ratio: 16 / 9 },
  "ship-cargo": { label: "Cargo freighter", ratio: 16 / 9 },
  "ship-escort": { label: "Escort cutter", ratio: 16 / 9 },
  "ship-raider": { label: "Raider corsair", ratio: 16 / 9 },
  "infra-depot": { label: "Trade Depot", ratio: 1 },
  "infra-hydroponics": { label: "Hydroponics", ratio: 1 },
  "infra-platform": { label: "Defense platform", ratio: 1 },
  "event-raid": { label: "Convoy raid", ratio: 16 / 9 },
  "event-acquisition": { label: "Acquisition", ratio: 16 / 9 },
};
