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
| `ship-*` (fleet) | — | The whole fleet has its own block below — see **[Fleet — ship hulls](#fleet--ship-hulls)**. |
| `infra-depot` | 1:1 | *A trade-depot logistics ring with docking arms orbiting a system.* |
| `infra-hydroponics` | 1:1 | *A hydroponics module: glowing green grow-racks under a transparent dome.* |
| `infra-platform` | 1:1 | *A stationary orbital defense platform bristling with point-defense guns.* |
| `event-raid` | 16:9 | *A privateer raid on a cargo convoy inside a glowing warp tunnel, escort ships returning fire, cinematic motion, no gore.* |
| `event-acquisition` | 16:9 | *A corporate acquisition depicted as charter-hologram fleets converging over a star map, ominous boardroom-in-space mood.* |
| `bg-starfield` | 16:9 tileable | *A deep-space starfield with a faint nebula gradient and sparse stars, very low detail, suitable as a dim UI backdrop.* |

## Fleet — ship hulls

The fleet is generated as one cohesive **Used Future** lineup: every named hull class (Cutter →
Dreadnought) gets its own asset, plus the shared utility ships. **Paste the STYLE BLOCK once, then
generate each numbered subject as its own image, reusing the style block verbatim every time.** Save
each as `web/public/assets/<slot-id>.png`. 3:2 unless a subject says otherwise.

> **STYLE BLOCK —** UI art for **Stellar Charters**, a gritty corporate-frontier 4X set on a wormhole
> frontier where chartered corporations fight over star systems through trade, convoys and deniable
> violence. Art direction: **USED FUTURE** — lived-in industrial sci-fi. Worn painted metal with primer
> patches, rust streaks and scuffed stencil markings (registry numbers, hazard chevrons); practical
> greebled hardware — radiators, fuel lines, docking clamps, sensor masts; muted gunmetal-grey +
> burnt-orange (#E07A3A) + olive palette with a single charter-livery accent stripe; soft directional key
> light, slight grime. Reference Alien / The Expanse / Firefly — never sleek-glassy, never
> Star-Wars-clean.
>
> Rules for EVERY image: a single vessel in 3/4 broadside hero profile, nose pointing right, centered, on
> a plain transparent / dark-neutral background; NO text, labels, logos, UI frames, planets or starfield;
> identical camera distance and lighting so the ships form one coherent escalating lineup. **KEY
> PROGRESSION CUE** — each warship carries a stern warp-drive coil assembly whose SIZE scales with its
> range tier: tier 1 = one small coil; each tier up adds larger / more coil rings; the tier-8 hull has a
> towering multi-ring warp array. Higher tier = visibly more mass, more drives, heavier armor. Aspect
> ratio 3:2 (use 16:9 for the freighter and convoy). Render each numbered subject below as its own image,
> reusing this entire style block verbatim.

| # | Slot id | Subject |
|---|---|---|
| 1 | `ship-cutter` | CUTTER (Range-1 "Skiff"): cheapest charter warship, half civilian runabout. A small fast wedge/dart hull, one stubby fusion drive with a single small warp coil, a folding sensor boom, an exposed cockpit blister, light stencil livery. Nimble, disposable. |
| 2 | `ship-corvette` | CORVETTE (Range-2 "Picket"): light frontier escort and route scout. A lean arrowhead hull with a dorsal spine, twin drives behind a slightly larger twin-coil warp ring, one dorsal gun turret, a reinforced prow for ramming privateers. |
| 3 | `ship-frigate` | FRIGATE (Range-3 "Clipper"): the dependable frontier workhorse and first true deep-range hull. A boxy modular mid-section with swappable pods, a prominent triple-ring warp coil, a couple of gun mounts and a comms mast. A freighter's honest bones given teeth. |
| 4 | `ship-destroyer` | DESTROYER (Range-4 "Linebreaker"): heavy combat and logistics, the gateway to capital hulls. An armored slab prow, a broadside of gun batteries, quad drives behind a heavy stacked warp-coil array. Brutal, blunt — the biggest hull a mid-tier charter can field. |
| 5 | `ship-cruiser` | CRUISER (Range-5 capital): the first true capital warship and an enormous alloy investment. A long slab-armored hull with belt armor, hangar bays, multiple gun batteries and TWIN large warp arrays at the stern. A mobile corporate fortress. |
| 6 | `ship-battlecruiser` | BATTLECRUISER (Range-6 "Raider-of-the-line"): a fast capital — cruiser firepower on a longer, leaner hull with oversized drives and a long twin-array warp section, built to run down convoys across whole clusters and shatter blockades. |
| 7 | `ship-battleship` | BATTLESHIP (Range-7 "Broadside"): an apex line warship. A massive armored hull with tiered gun decks, a forest of turrets, sponsons and sensor towers, and a huge multi-ring warp array. Slow, ruinous, unmistakable. |
| 8 | `ship-dreadnought` | DREADNOUGHT (Range-8 "Charter-killer"): the apex war-monster only the richest charters field. A continent of layered armor, gun batteries at every angle, command towers, and several towering warp arrays. The single largest, heaviest hull in the lineup. |
| 9 | `ship-raider` | RAIDER / CORSAIR (deniable privateer): a blacked-out, scrubbed-registry attack ship with NO charter livery and NO stencil numbers — deliberately anonymous so no one can prove who sent it. A jury-rigged predatory frame with asymmetric bolted-on weapons and a darkened matte hull. Menacing, disreputable. |
| 10 | `ship-survey` | SURVEYOR / ASSAY SKIFF (unarmed scout): a fragile civilian white-and-orange survey vessel that is all sensors — folding dish arrays, antenna booms, a deployable scanning rig, a tiny pressurized hab, a modest single drive. No weapons whatsoever. The charter's eyes on the frontier. |
| 11 | `ship-cargo` | FREIGHTER / HAULER (**16:9**, lane-bound bulk carrier): a long structural spine strung with stacked modular cargo containers in mismatched livery, oversized fuel tanks and radiators, a small crew block up front. Big, slow, soft — the prize raiders hunt. |
| 12 | `ship-convoy` | CONVOY GROUP (**16:9**, fleet in transit): a laden Hauler flanked by a single escort warship, running together down a glowing warp tunnel, a sense of motion, cargo and vulnerability; the faint warp-tunnel glow is the only permitted background element. |

> Retired by this rehaul: the old bucketed `ship-escort` / `ship-clipper` / `ship-fleet` assets — delete
> those PNGs once the per-hull art above is in place.

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
