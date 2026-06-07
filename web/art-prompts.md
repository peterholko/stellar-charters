# Stellar Charters — Art Generation Prompts

The UI ships with **procedural placeholders** so nothing is blocking. To replace a
placeholder with generated art, drop a PNG into **`web/public/assets/<slot-id>.png`** — the
`<ArtSlot>` component picks it up automatically (it tries `/assets/<slot-id>.png` first and
falls back to the labelled placeholder). Rebuild/redeploy and the real art appears.

> System portraits, resource icons and corp crests currently render as themed CSS
> (planet discs / colour dots). They're listed below too in case you want to commission
> them — wiring them to `<ArtSlot>` is a one-line swap per component.

Generate every image **without text, labels, logos, or UI chrome**, on a dark/transparent
background, centered. **Each final prompt = a SUBJECT + one STYLE SUFFIX** below. Generate a
subject once per suffix to compare the three art directions the UI themes match.

---

## Style suffixes (append one to any subject)

**Terminal** (theme `terminal`)
> `— rendered as a glowing holographic command-console asset, amber (#FFB000) and cyan (#56D4FF) key light on near-black, thin neon vector linework, faint scanlines and CRT bloom, high contrast, dark background, crisp, centered.`

**Used Future** (theme `used-future`)
> `— gritty lived-in industrial sci-fi, worn painted metal and rust, muted burnt-orange (#E07A3A) and olive palette, scuffed stencil markings, practical hardware feel (Alien / Firefly), soft directional light, slight grime, dark neutral background, centered.`

**Clean Sci-Fi** (theme `clean`)
> `— sleek modern hard sci-fi, glassy translucent surfaces, cool blue (#4F8DFF) and teal (#38D3C9) accents on deep navy, soft studio lighting, minimal flat-meets-volumetric icon, generous negative space, crisp edges (Elite Dangerous / Stellaris UI), centered.`

---

## Slots wired to `<ArtSlot>` (drop these in first)

| Slot id (`/assets/<id>.png`) | Aspect | Subject prompt |
|---|---|---|
| `hero-wormhole-hub` | 16:9 | *A vast neutral wormhole gate station: a luminous spiral wormhole ringed by a circular trade-authority habitat with docking spokes, freighters queued at the mouth, a sense of regulated commerce and scale.* |
| `ship-survey` | 16:9 | *A small nimble survey skiff with sensor booms and a single drive, Range-1 explorer.* |
| `ship-cargo` | 16:9 | *A blocky modular cargo freighter hauling stacked containers between systems.* |
| `ship-escort` | 16:9 | *An armed escort cutter/corvette with defensive turrets in charter livery.* |
| `ship-raider` | 16:9 | *A lean predatory raider corsair, dark hull, deniable privateer silhouette.* |
| `infra-depot` | 1:1 | *A trade-depot logistics ring with docking arms orbiting a system.* |
| `infra-hydroponics` | 1:1 | *A hydroponics module: glowing green grow-racks under a transparent dome.* |
| `infra-platform` | 1:1 | *A stationary orbital defense platform bristling with point-defense guns.* |
| `event-raid` | 16:9 | *A privateer raid on a cargo convoy inside a glowing warp tunnel, escort ships returning fire, cinematic motion, no gore.* |
| `event-acquisition` | 16:9 | *A corporate acquisition depicted as charter-hologram fleets converging over a star map, ominous boardroom-in-space mood.* |
| `bg-starfield` | 16:9 tileable | *A deep-space starfield with a faint nebula gradient and sparse stars, very low detail, suitable as a dim UI backdrop.* |

## Optional slots (currently procedural — commission if desired)

**Star-system portraits** (square, swap into `PlanetArt`)
- `system-ice` — *An ice/water world, pale blue-white, cracked frozen surface, extraction outpost.*
- `system-metals` — *A rocky asteroid-belt mining world, grey-brown, ore rigs and slag.*
- `system-helium3` — *A banded gas giant with helium-3 skimming platforms in its upper atmosphere.*
- `system-isotopes` — *A frontier world rich in rare isotopes, eerie violet glow, exotic mineral veins, remote.*
- `system-garden` — *A rare garden world, green and blue, agricultural domes, lush and prized.*

**Resource icons** (256², transparent) — `resource-ice / metals / helium3 / isotopes / food / credits`
- *A single iconic emblem per resource: ice crystal · stacked metal ingots · helium-3 canister · glowing isotope vial · sealed ration · credit chit.*

**Corporate identity**
- `title-logo` (transparent) — *Wordmark glyph for "Stellar Charters": a wormhole spiral fused with a corporate charter seal.*
- `corp-crest` ×8 (256², transparent) — *Eight distinct chartered-corporation crests, geometric heraldic-corporate, one per seat colour.*
- `avatar-ceo` (square) — *A neutral silhouette CEO/operator avatar placeholder.*

---

## Star-system bodies (Section 21 — body-driven resource model)

These are NEW slots for the per-body composition: a **star type** portrait, a **planet type**
portrait, an asteroid belt, and small site-state status glyphs. Square 1:1 unless noted. Slot ids
match the engine's `StarType` / `PlanetType` enum values exactly, so wiring is a direct
`/assets/star-${starType}.png` / `planet-${planetType}.png` lookup (graceful gradient fallback).
The set must be mutually distinct and instantly readable at ~48–96px.

**Stars** (`star-<type>.png`) — a small luminous orb portrait of the star:
- `star-mainSequence` — *A steady yellow-white main-sequence star, calm even glow; reads as normal, life-friendly.*
- `star-redDwarf` — *A small dim deep-red dwarf with visible flare arcs off its edge; tiny and flare-prone.*
- `star-redGiant` — *A huge bloated swollen orange-red giant, soft puffy surface; old, expanding, scorching.*
- `star-blueGiant` — *A fierce blue-white giant, intense hot glow and radiant spikes; harsh and lethal.*
- `star-whiteDwarf` — *A tiny dense brilliant blue-white stellar remnant, faint halo; burnt-out husk.*
- `star-neutronStar` — *A minuscule super-dense remnant with twin polar jets and a blue-violet magnetic aura; exotic, the antimatter/rare-isotope prize.*

**Planets** (`planet-<type>.png`) — a single world as a disc:
- `planet-lava` — *A scorched molten lava world, cracked black crust with glowing magma rivers.*
- `planet-rocky` — *A cratered grey-brown rocky terrestrial world, barren but mineral-rich.*
- `planet-desert` — *A dry tan/ochre desert world, windswept dunes.*
- `planet-ocean` — *A lush blue-and-green habitable ocean/garden world with white clouds; the prized living world.*
- `planet-gasGiant` — *A banded gas giant (Jupiter-like) with helium-3 skimming haze.*
- `planet-iceGiant` — *A pale cyan/teal ice giant (Neptune-like), cold methane haze.*
- `planet-barren` — *A dead airless grey rock, heavily cratered, lifeless.*

**Other bodies & site states:**
- `body-asteroidBelt` — *A dense ring/field of tumbling asteroids with a few mining rigs; a mining belt.*
- `site-extractor` — *A compact mining/extraction rig clamped to a surface; "deposit being worked."*
- `site-offline` — *The same rig dark, sparking/damaged with a warning glow; "sabotaged / offline."*
- `site-depleted` — *An exhausted mine over a hollowed spent deposit; "dry."*
- `site-unsurveyed` — *A deposit obscured by a scanner/question haze and faint survey grid; "richness unknown until assayed."*
- `infra-extractor` (matches `infra-depot` style) — *A standalone extraction/refinery module building for build menus.*
- `status-stellar-event` — *A flaring star inside a hazard ring; flags a system whose output is spiking or browning out this turn.*
