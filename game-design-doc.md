# Stellar Charters — Game Design Document v2.2

*Wormhole frontier · asynchronous 4X · corporate market warfare · 4–12 players*

WORMHOLE FRONTIER · ASYNCHRONOUS 4X · CORPORATE MARKET WARFARE · 4–12 PLAYERS

# Stellar*Charters*

A new wormhole has opened into a virgin galaxy. Humanity's states are too slow to govern it directly, so they sell **Stellar Charters** to private corporations: legal rights to survey, claim, exploit, and administer star systems beyond the gate. You do not conquer the frontier with flags. You win by controlling trade, starving rivals, raiding convoys, manipulating markets, and acquiring their charters.

**Genre:** Async 4X / Economic Warfare
**Core fantasy:** Chartered corporate imperialism beyond a wormhole
**Map:** Star systems connected by charted warp routes
**Session:** 28–40 daily turns baseline
**Win:** Charter hegemony through equity control and acquisitions


`SECTION 00`


## Vision & Pitch

Stellar Charters is a slow-burn strategy game about private corporations carving up a newly accessible galaxy. The map expands through charted warp routes. The economy is mediated through one global exchange. The war is fought through claims, population, logistics, price pressure, privateers, debt, and hostile takeovers.

Revised One-Sentence Hook

#### A wormhole gold rush where chartered corporations fight over star systems through markets, warp-route convoys, debt, and deniable violence.

Every player begins at the neutral Wormhole Hub with a Stellar Charter, limited capital, short-range ships, and access to the Galactic Exchange. The first phase is a legal land rush. The middle phase is a logistics and market war over warp tunnels. The endgame is corporate consolidation: acquire weakened rivals, absorb their chartered systems, or lose your charter and continue as a Free Operator.

The original single-star-system premise is replaced by a broader **frontier galaxy**. Players fight over star systems rather than individual worlds. Worlds, moons, belts, and stations still exist as system modifiers, but the strategic claim unit is the **star system**.

The frontier is connected by **charted warp routes**: quasi-permanent navigational tunnels between systems. Convoys, escorts, privateers, merchant ships, and corporate fleets all use these routes. The route is the object players click, patrol, improve, or interdict.


`SECTION 01`


## Design Pillars

The revised design keeps the market-war identity while giving convoy warfare a concrete geography.

PILLAR 01

#### Stellar Charters

Players are legal corporate powers. Claiming a system means registering and maintaining charter rights, not merely planting a flag.

PILLAR 02

#### One Global Market

All commerce flows through the Galactic Exchange. There are no direct trade deals in v1. Players fight through prices and logistics.

PILLAR 03

#### Global Price, Local Logistics

Prices are global, but goods are local. Buy/sell orders specify origins, destinations, warp routes, transit time, fees, and raid risk.

PILLAR 04

#### Warp Routes Are Terrain

Ships move through charted warp tunnels between systems. Routes show traffic history and become the targets for patrols, privateers, and interdiction.

PILLAR 05

#### Range Opens the Network

Early ships are slow and short-ranged. Research or Earthside licensing reveals, stabilizes, and reaches deeper warp routes.

PILLAR 06

#### Population Creates Value

Outposts extract resources; colonies create tax revenue, labor, demand, legitimacy, and valuation. Food determines whether populations grow or become liabilities.

PILLAR 07

#### Deniable Early Violence

Early aggression is privateer-style: hired raiders haunt warp tunnels while official corporate ships mostly defend, escort, and patrol.

PILLAR 08

#### No True Elimination

A player who sells or loses their charter can continue as a Free Operator with merchant ships, privateers, stock holdings, and a path back through acquisition.


`SECTION 02`


## Setting: The Wormhole Mandate

Humanity has found a stable wormhole into an untouched galaxy. The gate is too valuable, too distant, and too politically contested for any one state to own outright.

The compromise is the **Wormhole Authority**: an Earthside-backed institution that regulates access to the gate, runs the Galactic Exchange, recognizes charter claims, and sells technology licenses. It does not directly colonize the frontier. Instead, it grants **Stellar Charters** to private corporations.

Definition

**A Stellar Charter** is a legal instrument granting a corporation exclusive commercial, administrative, extraction, settlement, and security rights over unclaimed star systems it successfully surveys, registers, supplies, and maintains.

### What a charter grants

| Right | Gameplay Meaning |
| --- | --- |
| **Extraction Rights** | Harvest the system's primary and secondary resources. |
| **Settlement Rights** | Build depots, refineries, shipyards, labs, security stations, food infrastructure, and population centers. |
| **Trade Rights** | Export goods through the Galactic Exchange and import supplies from humanity. |
| **Security Rights** | Escort convoys, patrol approaches, defend claims, and eventually project corporate fleet power. |
| **Transfer Rights** | Claims can be transferred through sale, distress liquidation, or hostile acquisition. |


`SECTION 03`


## Asynchronous Turn Structure

Players submit orders during a daily window. Orders lock, then resolve simultaneously. No one waits for another player.

ORDER WINDOW

#### Read, plan, submit

Players review the resolved state, convoy history, prices, stock movement, route threats, and pending arrivals. Orders can be edited until the deadline.

LOCK

#### Orders seal

All claim bids, market orders, convoy security choices, privateer contracts, fleet moves, research, and finance orders are locked.

RESOLUTION

#### Batch simulation

Production, markets, convoy launches, route interdictions, arrivals, upkeep, debt service, share-price updates, and acquisition checks resolve in a fixed order.

REPORT

#### New state published

Players receive a digest of arrivals, filled orders, failed limits, raids, price movement, debt stress, stock changes, and new map intelligence.

**Important simplification**There are no minor ticks in v1. Whole-turn transit times are used. One-turn convoys can still be hit by route interdiction placed before the tick; multi-turn convoys can also be targeted after launch.


`SECTION 04`


## Galaxy Map & Warp Routes

The map is a network of star systems connected by charted warp routes. Warp routes are quasi-permanent tunnels that make convoy movement, defense, and raiding legible.

Every system has coordinates, resource profile, claim cost, upkeep, population potential, route connections, system slots, defense value, and infrastructure potential. Ships do not freely raid from anywhere to anywhere; they operate through the reachable warp-route network.

Core Map Rule

A warp route is the physical lane of commerce and conflict between two systems. Convoys travel along routes. Raiders interdict routes. Escorts patrol routes. Trade Depots improve routes. Poor-resource systems can be strategically valuable if they sit on important routes.

### Route quality

| Route Stat | Gameplay Meaning |
| --- | --- |
| **Transit Time** | How many major turns a convoy takes to cross the route or multi-route path. |
| **Stability** | Unstable tunnels increase delay risk, fuel cost, and privateer opportunity. |
| **Capacity** | Heavy traffic on low-capacity routes increases shipping costs and route visibility. |
| **Exposure** | How easy it is for raiders/privateers to enter the tunnel and force an interception. |
| **Authority Presence** | How risky it is legally to raid there; high near the Wormhole Hub, weak in the frontier. |
| **Traffic History** | Recent convoys on the route, visible to all players as a strategic signal. |

### Travel model

# route-network travel model
path = shortest\_or\_selected\_warp\_path(origin, destination)
can\_travel = every\_route\_on\_path within ship\_range\_or\_access
transit\_time = Σ(route\_time × stability\_modifier)
shipping\_cost = Σ(route\_cost × cargo\_mass) + fees

### Ship and route progression

| Tier | Role | Strategic Effect |
| --- | --- | --- |
| **Range 1** | Survey skiffs, basic cargo, escort cutters | Use known inner routes. Short tunnels, low exposure, low upside. |
| **Range 2** | Extended freighters, frontier escorts, route scouts | Chart second-ring routes and reach first strategic resources. |
| **Range 3** | Deep-range clippers, raider corvettes | Reach rare systems, enter frontier tunnels, and threaten exposed routes. |
| **Range 4+** | Corporate fleet ships, heavy logistics, route stabilizers | Project power across clusters, build route infrastructure, and support acquisitions or blockades. |

**Exploration rule**Inner-ring routes are known at match start. Frontier routes are discovered by survey and may require technology, licensing, or infrastructure to stabilize for heavy trade.


`SECTION 05`


## Opening: Inner Ring Claim Auction

The match begins with a pre-surveyed ring of systems near the wormhole. Humanity's probes already identified the first commercial targets. Players bid for initial charter rights.

### Player-count scaling

| Players | Inner Ring Systems | Opening Feel |
| --- | --- | --- |
| 4 | 8–9 | Spacious, strategic buildup. |
| 8 | 15–18 | Default: choices, rivalry, fallback safety. |
| 12 | 22–26 | Crowded, political, aggressive. |

Each player begins with one **Initial Charter License**, so they can win at most one system in the opening auction. Bids are sealed and simultaneous. Players can set fallback bids so losing a premium system does not ruin the opening.

# opening bid example
Priority 1: Frosthaven, bid 4,600 credits
Priority 2: Vesta Minor, bid 3,600 credits
Priority 3: Pale Harbor, bid 3,200 credits
# resolution
highest valid bid wins each system
losing bids refunded 90–95%
one opening claim maximum per player

After the auction, the winning claims come online, production starts, and players begin exporting, surveying deeper systems, and planning their second claim. The inner-ring systems also begin with known safe warp routes to the Wormhole Hub, while deeper routes must be charted by survey ships.


`SECTION 06`


## System Claims

A claimed star system is a legal asset, production site, stockpile location, and logistics node.

### Claim lifecycle

1. **Survey.** Reveal system category, exact yield, hidden secondary resources, hazards, and infrastructure potential.
2. **Register.** File a charter claim with the Wormhole Authority by paying/bidding credits and consuming a claim license.
3. **Maintain.** Pay upkeep, supply the system, defend its approaches, and keep the charter from lapsing or entering distress.
4. **Monetize.** Export resources, refine locally, build depots, or use the system as a strategic base.

Claims become part of a corporation's valuation. If a corporation is acquired, its registered claims transfer to the acquirer along with stockpiles, ships, infrastructure, licenses, and debt.


`SECTION 07`


## Resources & Production

Keep the chains **short but tightly coupled**, not a sprawling crafting tree. The depth comes from scarcity, location, transit time, price movement, and the fact that a few raw feedstocks each feed several manufactured goods — so a squeeze on one raw ripples across many markets.

Commodities sit in three tiers. **Raw** commodities are extracted from a system's yields; **manufactured** commodities are produced by Processor buildings (see Section 07b). Antimatter remains the apex deep-frontier raw.

| Resource | Tier | Role | Strategic Notes |
| --- | --- | --- | --- |
| ICE / WATER | raw | Life support; feedstock for food and fuel. | Common but constantly consumed; the broadly-coupled "water" of the economy. |
| METALS | raw | Structural feedstock for alloys. | Often overproduced early, making price crashes likely. |
| SILICATES | raw | Semiconductor/optical feedstock for polymers and components. | The newest raw; gates the advanced manufacturing tier. |
| HELIUM-3 | raw | Energy feedstock: fuels reactors (power) and feeds fuel + alloys. | Double-duty energy backbone; energy producers can squeeze many markets at once. |
| RARE ISOTOPES | raw | High-tech catalyst for components and advanced hulls. | Low-volume, high-value. Ideal raid target and monopoly resource. |
| ANTIMATTER | raw | Premium input to capital (Range 4+) hulls. | Ultra-high value, abyss-only — the fattest raid target and monopoly prize. |
| FOOD | mfg | Feeds growing colonies (`ice → food`, hydroponics). | Garden worlds and hydroponics make local food strategically important. |
| FUEL | mfg | Burned by the fleet each turn; feeds polymers (`ice + helium3 → fuel`). | Recurring fleet demand keeps a live market. |
| ALLOYS | mfg | Required to construct every building and ship hull (`metals + helium3 → alloys`). | The "steel bottleneck": construction stalls without alloys (or the credits to buy them). |
| POLYMERS | mfg | Intermediate feeding components (`silicates + fuel → polymers`). | Couples the silicate and fuel chains into the advanced tier. |
| COMPONENTS | mfg | Required for ships and advanced infrastructure (`alloys + polymers + rareIsotopes → components`). | The top of the tree; the deepest, most logistically demanding chain. |
| CREDITS | — | Universal currency for claims, ships, debt, market buys, privateers. | Cash timing matters because exports pay only after arrival. |

**Production location.** Resources are stored locally in the system that produced them. The player does not own one global pile of Ice; they own local stockpiles distributed across systems.

`SECTION 07b`


## Processing & Production Chains

Extraction fills a system's stockpile with raws; **Processor** modules convert them into manufactured goods on the same system. A processor runs one **recipe** each turn — consuming inputs from the local stockpile and producing outputs into it — pro-rated by its limiting input (a half-fed processor makes half its output).

```
ice ──────┬──► food
          └──► fuel ──────────► polymers ──┐
helium3 ──┬──► fuel                        │
          └──► alloys ─────────────────────┼──► components
metals ───────► alloys                     │        ▲
silicates ────► polymers ──────────────────┘        │
rareIsotopes ───────────────────────────────────────┘
```

Recipes run in dependency order within a turn, so a tier-1 output (e.g. alloys) is available to a tier-2/3 recipe (e.g. components) the **same** turn — the same way hydroponics consumes ice extracted that turn. Because production resolves before market clearing (Section 20), processors always get first claim on a system's raws; only the leftover is sold.

**Power (a non-tradable utility).** Power is never stored, shipped, or traded. Each turn a system's power is recomputed as capacity vs. draw: every processor draws power, **Reactor** modules supply it (burning helium3 as fuel) on top of a small free baseline. If draw exceeds capacity the whole system **browns out** — every processor throttles by the same `capacity / draw` factor until more reactors are built. So materials and credits gate *building* a factory; power gates *running* it.

**Required inputs (demand sinks).** Manufactured goods are not optional exports — core actions consume them, drawn from the corp's stockpiles first with any shortfall **bought from the exchange at market price** (so production is never a hard wall, only a cost that rises with scarcity):

- **Construction** (every building and ship hull) consumes **alloys**.
- **Ships** consume **components** (and still rareIsotopes/antimatter for higher hulls).
- **Trade Depots** additionally consume **components**.
- **Fleet operation** burns **fuel** every turn.

*Balance status:* recipe ratios, prices, power, and bill sizes are tuned via the headless simulator and treated as seeds. A known follow-up is routing required-input purchases through the order book so manufactured-good prices respond to that demand directly (today the bills buy at the current price without moving it), and giving bots the logistics to build the tier-3 components chain rather than market-sourcing it.

`SECTION 07c`


## System Infrastructure Upgrades

The raw feedstocks — metals, silicates, helium3 — are extracted in bulk and tend to overproduce. Beyond feeding processors, each owned system can sink them into **upgrade tracks** (raw drawn from the corp's stockpiles first, market shortfall bought). Each track caps at a few levels; the cost scales with the level reached (level L→L+1 costs the base × (L+1)).

| Track | Raw consumed | Effect per level |
| --- | --- | --- |
| **Mining Rigs** | metals | fortification: +raid defense and lower system upkeep |
| **Habitats** | silicates | faster population growth + higher tax |
| **Power Grid** | helium3 | +power capacity (a cheaper, permanent alternative to reactors) |

All three are **pure sinks**: they consume a raw without adding raw supply. (An earlier design boosted extraction yields with Mining Rigs, but the sim showed that *increased* supply — working against the very raw-overproduction it was meant to absorb — and amplified the run-away leader, so the metals track was switched to fortification.)

This gives the overproduced raws a use and a per-system progression layer.

*Balance status:* upgrade costs/effects are seeds tuned via the headless simulator. The upgrades are a strong mid-game sink while systems have headroom; durably lifting the raw *market floor* across the whole game is a separate extraction-rate question.


`SECTION 08`


## Population & Food Production

Population adds a second-layer economy: extraction systems make resources, but populated systems create tax revenue, labor, demand, legitimacy, research potential, and long-term charter value. Food determines whether that population grows or becomes a liability.

Design Principle

#### Resources make money. Population makes systems valuable. Food keeps population growing.

Food and population should enrich the midgame without overwhelming the first turns. Small outposts rely on basic life-support upkeep; mature colonies consume Food each turn and become major strategic assets.

### Population stages

| Stage | Food Need | Benefits | Design Role |
| --- | --- | --- | --- |
| **Outpost** | None / minimal life support | Enables extraction, storage, and claim maintenance. | Default early-game claim; does not create food micromanagement. |
| **Settlement** | Low | Small tax and labor bonus; unlocks basic local demand. | First step beyond pure extraction. |
| **Colony** | Medium | Meaningful taxes, labor, system valuation, and market demand. | Midgame population base that needs reliable food supply. |
| **City** | High | Strong valuation, research/admin output, and local market demand. | High-value acquisition target and political asset. |
| **Metropolis** | Very high | Huge tax base, legitimacy, and corporate valuation. | Late-game core holding; powerful but food-dependent. |

### Food sources

| Source | Strength | Weakness |
| --- | --- | --- |
| **Garden Worlds** | Cheap, high-output natural food production. | Rare, politically valuable, and obvious strategic targets. |
| **Hydroponic Modules** | Can be built on most systems. | Consumes Ice/Water, power, infrastructure slots, and upkeep. |
| **Agri-Stations** | Scales food production across a cluster. | Expensive infrastructure; attractive sabotage target. |
| **Humanity Imports** | Reliable emergency source through the Galactic Exchange. | Expensive for distant colonies and vulnerable to inbound convoy disruption. |
| **Synthetic Food** | Late tech path that reduces dependence on garden worlds. | Requires energy, chemicals, and technology investment. |

### Food and population loop

Food balance = local food production + food imports - population consumption
If Food balance is positive:
population grows, tax revenue rises, labor improves, system value increases
If Food balance is negative:
growth stops, unrest rises, production efficiency falls, stock valuation suffers

### Trade and convoy implications

Food is traded through the Galactic Exchange like any other commodity. A player can buy emergency Food delivered from the Wormhole Hub, sell surplus Food from a garden world, or transfer Food internally to support mining colonies and deep frontier cities.

#### Food Convoys

Food imports and exports create visible convoys. Raiding a food convoy can trigger shortages and unrest, but if exposed, the sponsor suffers higher Authority scrutiny and reputation damage.

#### Garden Worlds

A garden world can be valuable even if it has weak minerals. It feeds colonies, supports population growth, raises company valuation, and can become a diplomatic or takeover prize.

### Valuation effect

Population should increase a company's valuation because populated systems represent taxpayers, workers, consumers, infrastructure, and political legitimacy. Unrest and starvation reduce that value quickly.

system\_value = resource\_value + infrastructure\_value + population\_value + trade\_access\_value - unrest\_penalty

**Pacing rule**Food exists from the start as a market good, but it should become strategically important once systems develop from Outposts into Settlements and Colonies. The first 6–8 turns should not become food accounting.


`SECTION 09`


## The Galactic Exchange

All commerce flows through a single global market located at the Wormhole Hub. There are no direct negotiated player trade deals in v1.

The Galactic Exchange represents humanity behind the wormhole, brokers, insurers, importers, exporters, and frontier participants. Humanity provides baseline liquidity, price floors/ceilings, and delivery services. Players provide volatility.

### Core rule

Market Principle

#### The price is global. The logistics are local.

Every commodity has one market price. But each buy or sell order has a physical location, effective cost, transit time, shipping fee, cargo requirement, and raid risk.

### Order types

| Order | Fill Behavior | Use |
| --- | --- | --- |
| **Market Order** | Guaranteed fill at next tick, unless capped by a safety price. | Routine economy, emergency supplies, selling surplus. |
| **Limit Order** | Fills only if price condition is met. | Speculation, discipline, price traps. |
| **Standing Order** | Repeats until cancelled, with thresholds and fallbacks. | Async convenience: maintain stockpiles, sell surplus, export rare goods. |


`SECTION 10`


## Buy / Sell Order Mechanics

Market trades settle through the Wormhole Exchange, but convoys move through the warp-route network. Buys create inbound convoys from the wormhole. Sells create outbound convoys to the wormhole.

| Action | Route | Uses Player Cargo? | Payment / Delivery |
| --- | --- | --- | --- |
| **Buy from Market** | Wormhole → chosen owned system via warp path | No in v1; exchange-contracted delivery | Pay when filled; goods arrive after transit. |
| **Sell to Market** | Origin system → Wormhole via warp path | Yes | Goods leave immediately; payment arrives when convoy reaches wormhole. |
| **Internal Transfer** | Owned system → owned system via warp path | Yes | No money changes hands; goods arrive after transit. |

### Example: buy 50 Fuel

BUY ORDER
Good: Fuel
Quantity: 50
Max price: 26 credits/unit
Delivery: Vesta Minor
Source: Wormhole Exchange
Warp path: Wormhole Hub → Vesta Minor
Transit time: 1 turn
Delivery fee: +2 credits/unit
Uses player cargo: No
# if Fuel clears at 24
Fuel cost: 50 × 24 = 1,200
Delivery: 50 × 2 = 100
Total: 1,300 credits
Inbound convoy enters the Wormhole–Vesta Minor warp tunnel
Arrival: next turn

### Example: sell 8 Rare Isotopes

SELL ORDER
Good: Rare Isotopes
Quantity: 8
Origin: Deepwell
Destination: Wormhole Exchange
Warp path: Deepwell → Greywake → Wormhole Hub
Transit time: 2 turns
Shipping cost: high
Uses player cargo: 8
Payment: on arrival
# strategic implication
The convoy appears on the Deepwell–Greywake route, then the Greywake–Wormhole route.
Raiders may target the visible convoy or interdict those warp tunnels.

**Anti-annoyance rule**Routine market orders should be guaranteed by default. Limit orders are allowed to fail because the player deliberately chose price certainty over execution certainty. Standing orders can include emergency fallback prices.


`SECTION 11`


## Convoy UX & Warp Routes

Convoys make the market physical. Warp routes make convoys readable: the player sees traffic on tunnels rather than abstract open-space paths.

### Visible convoy information

| Visible to Everyone | Hidden unless Intel Reveals |
| --- | --- |
| Owner, origin, destination, convoy type, ETA, approximate size/value, current warp route, next route segment. | Exact cargo, exact quantity, escort strength, insurance, decoy status, security posture. |

Past convoy traffic remains visible as route history on each warp tunnel. This lets players identify repeated exports and click those route lines for interdiction orders.

UX Principle

Every order preview should show **market price**, **effective price**, and **warp path**. The effective price includes shipping, fees, insurance, security, transit delay, route stability, and raid risk.

### Convoy card example

OUTBOUND EXPORT
Cargo: 8 Rare Isotopes
Path: Deepwell → Greywake → Wormhole Hub
Current route: Deepwell–Greywake Warp Tunnel
ETA: 2 turns
Expected payout: 1,080 credits
Raid risk: High
Player cargo used: 8
Security: 1 Escort Cutter
Status: In transit

### Route panel example

WARP ROUTE: DEEPWELL ↔ GREYWAKE
Traffic: 3 convoys in last 5 turns
Typical cargo estimate: Rare Isotopes / Fuel
Transit: 1 turn
Stability: Poor
Exposure: High
Authority presence: Low
Actions: [Interdict Route] [Patrol Route] [Escort Convoy]


`SECTION 12`


## Trade Depots & Route Infrastructure

Trade Depots improve market access without creating regional prices. In the warp-route model, they also act as endpoint infrastructure for consolidation, security, and tunnel stabilization.

A Trade Depot is built in a claimed system. It does not create a second exchange; it improves how nearby systems use the global exchange through safer, cheaper, more predictable routes.

| Depot Effect | Gameplay Result |
| --- | --- |
| Shipping discount | Nearby systems pay lower shipping penalties on market buys/sells. |
| Transit improvement | Selected routes connected to the depot may reduce transit time by 1 turn, minimum 1. |
| Route security | Depot patrols reduce privateer success on connected warp tunnels. |
| Route stabilization | Unstable frontier tunnels become more reliable and support heavier traffic. |
| Strategic target | Sabotaging or capturing the depot harms a whole cluster's market access and route defense. |

**Rule**Trade Depots reduce effective logistics costs and improve route quality. They never create separate commodity prices in v1.


`SECTION 13`


## Warp-Route Convoy Raiding

Raiding is a geographic pressure system. Players cannot raid from across the map. They need ships, privateers, access, or bases near the warp tunnel they want to attack.

### Two core raid actions

| Action | Target | Use Case |
| --- | --- | --- |
| **Target Convoy** | A visible in-transit convoy on a warp route. | Reactive attack against multi-turn shipments already on the map. |
| **Interdict Warp Route** | A known warp tunnel with traffic history. | Predictive attack against convoys that may launch or pass through next tick, including 1-turn routes. |

### Route access requirement

To raid a convoy or interdict a warp route, the attacker must have eligible raiders able to enter that tunnel. Access can come from a controlled endpoint, a fleet stationed at an endpoint, a nearby privateer contract, or later technology that allows deeper route insertion.

# eligibility check
can\_raid = exists(available\_raider\_force)
with access\_to(warp\_route)
and operational\_range\_to(exposed\_segment)
before convoy reaches protected space

### Raid outcomes

| Outcome | Effect |
| --- | --- |
| No Contact | No convoy used the interdicted tunnel, or raiders failed to find it. |
| Shadowed | Convoy details partially revealed, no damage. |
| Harassed | Arrival delayed or shipping cost increased. |
| Damaged | Some cargo destroyed. |
| Plundered | Some cargo stolen and delivered to raider's nearest eligible base. |
| Repelled | Defenses stop raid; attackers may take damage. |
| Ambushed | Defender anticipated the attack; raiders take heavier losses. |

Balance Rule

Raids should usually delay, damage, or partially loot. Total destruction should require a valuable, exposed, poorly defended convoy and a strong committed raid.


`SECTION 14`


## Privateers & Corporate Fleets

Early offense is deniable. Player-owned ships still matter from the start, but their early role is survey, logistics, escort, patrol, and defense.

### Early-game split

| Force | Early Role | Tradeoff |
| --- | --- | --- |
| **Player-owned ships** | Survey, cargo, escort, patrol, anti-privateer defense. | Reliable and legal when defensive; politically risky when openly aggressive. |
| **Privateers** | Deniable warp-route interdiction, harassment, opportunistic cargo theft. | Cheaper and deniable, but less reliable, less precise, and may expose sponsor. |

Privateers support early conflict without turning the first 10 turns into open corporate war. They haunt warp tunnels, especially frontier routes with weak Authority presence. They can delay or damage convoys, but they rarely destroy entire shipments unless the target is greedy, exposed, and undefended.

HIRE PRIVATEERS
Target: Frosthaven–Wormhole warp route
Objective: Harass exports
Cost: 600 credits
Deniability: Medium
Likely result: delay, small cargo loss, or no contact
Exposure risk: captured privateers may reveal sponsor

### Escalation curve

TURNS 1–8

#### Frontier security

Official ships defend. Privateers harass safe inner routes only at meaningful legal risk.

TURNS 8–15

#### Security wars

Escorts, patrols, warp-route interdiction, anti-privateer sweeps, and route fortification.

TURNS 15+

#### Corporate fleet power

Open interdiction, tunnel blockades, boarding, system seizures, acquisition support.


`SECTION 15`


## Wormhole Hub Protection

The Wormhole Hub is the neutral economic and legal center. It cannot become the obvious raiding chokepoint even though most market trades ultimately settle there.

Degenerate Strategy Prevented

Players may not interdict the Wormhole Hub itself or the Hub's secured tunnel mouth. Private violence inside the secured zone is prohibited by the Wormhole Authority. Raids occur on exposed warp-route sections, system approaches, and frontier tunnels outside protected exchange space.

### One-turn inner routes

One-turn convoys between an inner-ring system and the Wormhole Hub cannot be reactively targeted after launch. They can be caught only by a warp-route interdiction order placed before the tick. Because the Wormhole side is protected, the raid happens near the player-system tunnel mouth, and local defenses apply.

Frosthaven ↔ Wormhole Warp Route
Transit: 1 turn
Targetable after launch: No
Interdictable before launch: Yes
Protected section: Wormhole tunnel mouth
Vulnerable section: Frosthaven tunnel mouth
Defenses applied: Frosthaven patrols, platforms, escorts, sensors


`SECTION 16`


## Raiding UX

The player should click what they understand: visible convoys, warp routes, or system approaches. The UI handles eligibility, route access, and range.

### What the raider clicks

| Clicked Object | Available Action | Meaning |
| --- | --- | --- |
| Visible convoy | Target Convoy | Attack a specific shipment already in transit. |
| Warp route / traffic line | Interdict Warp Route | Set a trap for matching convoys launched or passing through next tick. |
| System approach | Harass / Patrol Approach | Broader lower-precision pressure around a system's tunnel mouths. |

### Route click example

WARP ROUTE: FROSTHAVEN ↔ WORMHOLE HUB
Recent traffic: 4 exports in last 5 turns
Typical cargo estimate: Ice / Fuel
Transit: 1 turn
Targetable after launch: No
Interdictable: Yes
Protected side: Wormhole Hub
Vulnerable side: Frosthaven tunnel mouth
Local defenses: Medium
Your eligible raiders:
- 2 Corsairs at Greywake: Eligible
- 1 Cutter at Caldera: Out of range
Action: [Interdict Warp Route]


`SECTION 17`


## Debt, Equity & Acquisition

The financial warfare layer remains central, but should become dominant after players have real assets, debt, exposed warp routes, and strategic systems to attack.

Every corporation is publicly traded. Systems, depots, ships, warp-route access, stockpiles, licenses, cash, debt, production, population, and market momentum all influence valuation. A rival can be weakened through convoy disruption, commodity price pressure, privateers, sabotage, debt stress, and then acquired through stock control.

equity\_value = system\_assets + population\_value + route\_access\_value + ship\_assets + infrastructure + stockpiles + cash + earnings\_momentum - debt
share\_price = equity\_value / shares\_outstanding

**Onboarding pacing**Takeovers should be visible from turn 1 but not practically dominant until roughly turn 12–15, once players have multiple systems, debt, exposed exports, route dependencies, and strategic resources.


`SECTION 18`


## Post-Charter Play: Free Operators

A player who sells or loses their Stellar Charter is not eliminated. They can continue as a Free Operator: a merchant house, privateer flotilla, mercenary escort company, financier, smuggler, or stock raider.

Design Goal

#### Losing your corporation should become a second role, not a quit screen.

A failed charter CEO can liquidate, retain credits or ships, haunt warp routes as a privateer, haul goods as a merchant, sell escort services, speculate in corporate stock, and eventually buy majority control of an existing charter to re-enter the main game.

### How a player becomes a Free Operator

- **Voluntary sale.** A distressed player accepts a buyout from another corporation. The buyer receives the chartered systems, debts, infrastructure, and legal claims. The seller receives liquid credits and exits charter status.
- **Hostile acquisition.** A rival gains controlling equity. The target's corporation is absorbed, but the player may continue with remaining personal assets as a Free Operator.
- **Distress liquidation.** A collapsed charter is auctioned or broken apart; the player continues with whatever personal funds, ships, or stock holdings survive.

### What Free Operators can do

| Role | Actions | Comeback Path |
| --- | --- | --- |
| **Merchant House** | Own merchant ships, haul goods, arbitrage the Galactic Exchange, sell cargo capacity. | Build credits through logistics and market timing. |
| **Privateer Flotilla** | Interdict warp routes, capture cargo, accept deniable contracts. | Profit from plunder and pressure enemies. |
| **Mercenary Escort** | Protect convoys, patrol tunnels, hunt privateers for paying corporations. | Earn steady income and alliances. |
| **Financier** | Buy shares, short weak charters, hold blocking stakes, fund acquisitions. | Acquire majority control of a distressed corporation. |

### Limitations

Free Operators cannot directly claim new star systems or build major colonial infrastructure. They lack tax income, charter protections, and direct access to some Earthside licenses. They need friendly ports, neutral docks, merchant contracts, or hidden bases to operate.

COMEBACK CONDITION
If a Free Operator acquires majority control of a chartered corporation,
they become that corporation's controlling player and re-enter charter play.

**Mid/late-game mechanic**Free Operator mode should not be taught in the first 10 turns. It exists to prevent long-game elimination and to turn failed CEOs into privateer lords, merchant princes, or revenge financiers.


`SECTION 19`


## First 10 Turns Example

The opening should teach the game in layers: claim, produce, export, survey, expand, research, supply, raid risk. Food is visible early as a market good, while population becomes more important as outposts develop into settlements.

TURN 0

#### Inner ring revealed

Players review pre-surveyed systems near the Wormhole Hub.

TURN 1

#### Opening auction

Players submit sealed bids with fallbacks and win one starting charter claim.

TURN 2

#### First production

The starting system comes online. Players launch first exports and survey deeper.

TURN 3

#### First payout

One-turn exports settle. Players learn that selling pays after arrival.

TURN 4

#### Prices move

Ice, fuel, metals, helium, and food prices start reacting to player behavior. Food is mostly imported from humanity at this stage.

TURN 5

#### Second claim

Players expand locally or save for range tech.

TURN 6

#### Two-system economy

Local stockpiles and internal transfers matter.

TURN 7

#### First privateer pressure

Warp-route traffic histories appear. Players can hire privateers or invest in escorts and patrols.

TURN 8

#### Range 2 opens

Aggressive players research or license better drives, chart second-ring warp routes, and reach frontier systems.

TURN 9

#### Frontier supply strain

Distant claims need imports before they produce. Cash timing, food reserves, and convoy exposure become real.

TURN 10

#### Strategic resources and settlements online

Rare resources enter the market. Some outposts begin upgrading toward settlements, introducing food demand, population value, raids, debt, and stock pressure.


`SECTION 20`


## Resolution Order

The resolution order must make timing legible and avoid same-turn chaining exploits.

1. **Orders lock.** All submitted actions become final.
2. **Production.** Systems produce into local stockpiles.
3. **Market clearing.** Buy/sell orders fill or fail based on market/limit rules.
4. **Convoy launch.** Filled buys, exports, and transfers create convoys on selected warp paths.
5. **Warp-route interdiction.** Privateers/raiders assigned to warp tunnels may intercept matching new convoys.
6. **Targeted raids.** Raids against visible in-transit convoys resolve.
7. **Arrivals and settlements.** Convoys reaching destinations deliver goods or pay export proceeds.
8. **Upkeep, food, and debt service.** Systems consume supplies/credits; populated systems consume Food; debt payments trigger stress if missed.
9. **Valuation and stock update.** Share prices, credit risk, and control stakes recompute.
10. **Reports published.** Players receive digest, map changes, warp-route history, and warnings.

**No same-turn chaining**Goods arriving during resolution are available in the next order window, not earlier in the same resolution sequence.


`SECTION 21`


## Open Questions & Design Risks

The revised design is cleaner, but the following issues must be prototyped early.

#### Risk — Trade UX Fatigue

If players must manually place too many routine orders, the game becomes accounting. Standing orders and templates are mandatory.

#### Risk — Overpowered Raiding

If privateers are too efficient, players stop trading. Raids should usually delay or partially damage, not erase shipments.

#### Risk — Warp Chokepoint Dominance

If too many valuable systems depend on one tunnel, route camping becomes obvious. Maps need alternate paths, route stabilization, and costly interdiction.

#### Risk — Wormhole Camping

The Wormhole Hub and secured tunnel mouth must remain protected. Raiding must happen on exposed warp routes, not the hub itself.

#### Risk — Food Micromanagement

Population should add strategic value, not routine chores. Keep food light early and rely on standing orders, warnings, and emergency imports.

#### Risk — Free Operator Griefing

Post-charter players need comeback tools, but not unlimited nuisance power. Port access, reputation, Authority enforcement, and operating costs should constrain them.

`SECTION 21`


## Star System Resource Model

A star system is not a single number. Each system is a **star** orbited by **planets** and
**asteroid belts**, and the resources a charter can pull come from the **deposits** on those
bodies. Owning a system grants *potential*; the per-turn output is the sum of the deposits the
owner has actually **worked** by building extractors. This replaces the earlier flat per-system
yield: that flat vector is now just the degenerate case of a fully-developed system.

### Bodies & deposits

- **Star type** sets the system's character and habitable-zone geometry: *main-sequence*
  (standard, life-friendly), *red dwarf* (tight zone, flare-prone), *red giant* (expanded zone
  pushed outward, scorches its inner worlds), *blue giant* (hot, harsh, few habitables),
  *white dwarf* (dead remnant, no habitable zone), *neutron star* (exotic remnant — the
  antimatter / rare-isotope prize, no habitable zone). Exotic stars cluster toward the frontier
  and abyss.
- **Planet type** sets which deposits a world carries: *lava* (metals + volcanic rare isotopes),
  *rocky* (metals + silicates), *desert* (silicates), *ocean* (**habitable** — food + ice),
  *gas giant* (helium-3), *ice giant* (ice + helium-3), *barren* (sparse metals, dead rock).
- **Asteroid belts** sit between the inner rocky zone and the outer giants and are rich mining
  grounds (metals, silicates, sometimes rare isotopes).
- Each **deposit** has a *richness* (units/turn when fully worked), *reserves* (finite for
  ore/exotic, **renewable** for bio/gas/ice), and an *accessibility* (how costly it is to work).
- Resource geography is preserved: rare isotopes are a frontier-and-deeper prize, antimatter is
  abyss-only, the core carries only basics.

### Extractors & depletion

A deposit produces nothing until its owner builds an **extractor** on it; deepening the extractor
raises output toward the deposit's richness. A fresh charter is granted a free starter extractor
on its best deposit so a claimed system produces immediately. **Finite deposits deplete** as they
are mined and eventually run dry, so the richest worlds are boom-and-bust and the frontier keeps
pulling expansion outward; renewable deposits (ocean food, gas skimming, ice) sustain indefinitely.

### Habitability

A population can only take root where there is a **habitable world** (an ocean/garden world) or an
artificial habitat (hydroponics). Dead stars and giant-only systems are pure **industrial**
outposts — they extract and pay no population tax unless terraformed. Garden worlds are therefore
a scarce, contested prize. Each charter's **home** system is guaranteed a habitat dome at founding
so no one starts stranded; later expansion claims get no such guarantee.

### Prospecting (fog of war)

A deposit's true richness is hidden until it is **assayed** (surveyed) or worked; rivals never see
a system's remaining reserves. Claiming a promising-looking system is therefore a speculation, and
scouting/assay is an information-warfare lever.

### Stellar dynamics & sabotage

Star type drives deterministic, forecastable per-turn effects: neutron-star **pulses** spike
rare-isotope/antimatter output, an aging **red giant** slowly scorches its ocean worlds (food
declines late in a match), and **red-dwarf flares** brown out extractors on occasional turns.
Economic warfare reaches the surface: a raider in range of a rival system can **sabotage** an
extractor, knocking it offline for several turns.

### Resolution placement

Extractor and assay builds resolve in the administrative step; extraction (with depletion and
stellar modifiers) is the Production step (2); sabotage resolves with raids (6); the habitability
gate applies during population/upkeep (8) — all within the Section 20 order, with no same-turn
chaining.


`SECTION 22`


## Grand Construction (Megastructures)

Metal is the most abundant raw in the galaxy — rocky worlds, belts, and lava worlds all yield it —
so without an equally enormous demand it collapses to the price floor. **Megastructures** are that
demand floor: titanic constructs that swallow metal (and the refined alloys and capital hulls that
metal feeds) on a scale nothing else in the game approaches, while turning a maturing charter into
an end-game construction race.

### The ladder

Each is one-per-system, gated by the host's population stage, and consumes an enormous **metals**
bill (drawn from the system's own stockpile first; any shortfall is bought at market, which lifts
the price). The payoff is defense, faster growth, and a large valuation bump.

- **Orbital Station** (Settlement+) — hardens the system's tunnel mouths and anchors prestige.
- **Space Elevator** (Colony+) — cheap surface-to-orbit logistics accelerate population growth.
- **Ringworld** (City+) — the apex artificial habitat: a vast growth and valuation engine, and the
  single largest metal sink in the game.

### Capital hulls

Capital warships (the deepest range tiers) are themselves enormous steel sinks: their alloy demand
dwarfs light hulls, so fielding a capital fleet pulls metal through the alloy-processing chain.
Together with megastructures, this gives a metals-rich empire two huge places to pour its output —
the market stays healthy, and "what do I build with all this metal?" becomes a real strategic
question rather than a glut.


`SECTION 23`


## War & Conquest

Up to now charters fought obliquely — raiding convoys, sabotaging extractors, buying each other
out through equity. **War** adds the direct option: take a rival's *territory* by force. It is a
high-stakes, costly act, deliberately hard and heavily penalised, so it stays a deliberate
strategic choice rather than a constant state.

### Invasion

Fleets are **real objects on the galaxy map**. A charter orders a fleet to **move** from one system
to another; it travels along charted warp routes over several turns (like a convoy), so a navy on
campaign is a visible, intercept-able thing, and a fleet sent to the front leaves its home
undefended. Passage through other charters' territory is **peaceful** — borders don't stop a fleet
passing through — but **entering a non-allied rival's system is an act of war**: the arriving fleet
gives battle. If its combat beats the system's defense (incl. allied reinforcement) by the capture
ratio, it **captures and occupies** the world; otherwise it is repelled, takes heavy losses, and
**falls back** to a neighbouring friendly/neutral system. A charter that loses its last system
collapses into a Free Operator. The Wormhole Hub itself is Authority-protected and cannot be taken.

Because fleets march, **reach is no longer limited to your neighbours** — you can project power
(or come to a distant ally's aid) anywhere a charted path leads. A real conquest fleet is built
from capital hulls, whose huge alloy cost (Section 22) makes a war fleet a serious investment only
a strong charter can field. The defender's strength is the system's full standing defense — base,
defense platforms, Mining-Rig fortification, megastructures, a Trade Depot's patrols, and any
warships stationed there — **plus allied reinforcement** (below). If the attacker exceeds the
defense by the capture ratio, the system is **captured** and its ownership transfers (a charter
that loses its last system collapses into a Free Operator). Otherwise the assault is **repelled**
and the attacker loses a large fraction of the force it committed. Either way, blood is spilled and
war is declared. The Wormhole Hub itself remains Authority-protected and cannot be invaded.

### Declared war & the aggressor tariff

The first invasion of a non-hostile rival **declares war** between the two charters. The
**aggressor pays a war tariff** on every Galactic Exchange trade — a fraction skimmed off each
buy and sell at the hub — until the war ends. Trade still flows (internal transfers between the
aggressor's own systems are untaxed entirely), but at a cost, so conquest must pay for itself in
territory. A war lasts a fixed span after the latest act of aggression; once that passes, a
**ceasefire** ends it and the tariff lifts. A defender striking back inside an existing war is
acting defensively — it is *not* treated as a new aggressor and pays no tariff. The tariff is
light enough that a committed **warlord can press several fronts at once**.

### Grudges & coalitions

War feeds on itself. Being **raided, sabotaged, or invaded** stokes a **grudge** against the
attacker (grudges fade over time), and a wronged charter is biased toward retaliating — turning
isolated raids into escalating feuds. And when one charter grows into a **hegemon** that towers
over the field, the others stop trusting it and start **ganging up** — declining to ally with it
and steering their conquests at *its* systems. Conquest is thus both a path to dominance and the
galaxy's check on it: get too big and you become everyone's target.

### Defensive alliances

Charters may form **mutual defensive alliances** (both sides must pledge), and a pact is a real
obligation, not a gesture. When an ally's system is invaded:

- the ally's warships in range **reinforce the defense**, often turning a winnable assault into a
  bloody repulse; and
- **every ally is drawn into the war against the aggressor** — they become belligerents (paying no
  tariff, since they are defenders) and their fleets **counter-attack the aggressor's territory**.
  An attacker who overcommits its fleet to an invasion can find its own undefended worlds seized in
  return. Even an otherwise-peaceful charter honours the pact and takes up arms in a defensive war.

Allies cannot invade one another. An alliance is therefore genuine collective security: striking one
member means going to war with the whole bloc — cheap insurance for smaller charters, and the
galaxy's mechanism for ganging up on an over-mighty aggressor.

### Resolution placement

Alliance pledges resolve in the administrative step; invasions resolve in the combat phase (after
raids, step ~6.7); war declaration, the Exchange lockout, and ceasefires all key off the Section 20
turn order with no same-turn chaining.

### Prototype priority

Prototype the first 12 turns as a text or spreadsheet simulation with 4–8 players. Validate the opening auction, first exports, order fill UX, convoy visibility, warp-route traffic history, one-turn route interdiction, privateer economics, and Range 2 expansion before adding the full finance/takeover and Free Operator layers.

## Planets as Colonies

**Section 24.** Building on the Section 21 body-driven economy, planets and asteroid belts become
first-class **colonies** you develop, and the system becomes a **container** for its bodies, its
star, and the fleets stationed there — a Master-of-Orion-style colony layer. Buildings are owned by
a body, not the system: each `System.bodyBuildings` maps a `bodyKey` (`planet:<i>` / `belt:<i>` /
`star:0`, matching the Section 21 site-key prefixes) to that body's factory/reactor/agri-dome/
habitat/mining-rig/power-grid counts. The system still holds the **single shared stockpile** its
colonies fill and its convoys/depot ship from, and population/food/tax/conquest stay system-level —
so this re-home is balance-neutral by construction (`coloniesOf` is a pure read-model; the engine's
production, valuation, defense, and upkeep read the same totals via `systemBuildings` /
`buildingTotal`, just nested one level deeper). Build orders carry an optional `bodyKey`; an order
without one targets the system's primary body, so older replay logs resolve unchanged.

### Planet-type affinities

A world's **type** now shapes what you build on it, making the colony screen a real decision:

- **Gating** — agri-domes and habitats need a livable surface (rocky / desert / ocean / barren);
  lava worlds are too hostile; gas/ice giants and belts host only orbital industry (factories,
  reactors, power grid) and, for belts and solid worlds, mining-rig fortification; the star hosts
  nothing. (`canBuildOnBody`.)
- **Farmland** — agri-dome food output scales with the host world: ocean ×1.5, rocky ×1.0,
  desert ×0.85, barren ×0.65 (`agriFoodMult`), so ocean worlds are the breadbaskets.
- **Industry** — factory build cost scales with the world: lava ×0.8 and rocky ×0.85 are the cheap
  metal-rich workshops, belts ×0.9, oceans ×1.2 and orbital-over-giants ×1.1 a premium
  (`factoryCostMult`).

Bots pick the best valid body per build (domes to the richest farmland, factories to the cheapest
industrial world). A 100-game / 8-player sweep shows the affinity layer leaves the macro balance
unchanged (leader/median ≈ 16.9, metals price-floor 0%, food-growth 90%) while making planet variety
drive build decisions. The colony screen (web `ColonyPanel`) is the management UI: pick a body, work
its deposits, and build its structures, with a system-wide power meter since reactors/power pool at
the container.

### Construction queue (Phase 4a)

Colony buildings (factory / reactor / agri-dome / mining-rig / habitat / power-grid) no longer appear
instantly: ordering one charges its credits + resources up front and appends it to the host body's
**construction queue** (`System.buildQueues`). Each turn a colony pours `construction.pointsPerTurn`
(100) into the front item; when its `cpCost` is met the building lands and leftover points roll to
the next item, so a colony serialises a batch of builds (a factory is ~2 turns, an agri-dome ~1).
System structures (platforms, depot, megastructures) and per-site extractors stay instant. Charging
at queue time keeps the economic sink unchanged — only *timing* shifts — and the queue advances
before new orders each turn, so nothing chains the turn it's ordered. Bots won't re-pay for a build
that's still in flight. Slowing development slightly **compresses the leader's snowball**: a 100-game
sweep moves leader/median from ≈16.9 to ≈14.8 with every other risk flag still green.

### Per-planet population (Phase 4b)

Population is now **per colony**, not per system. Each habitable world — or any world given an
agri-dome — grows its own population (`System.colonyPop`: bodyKey → stage / progress / unrest),
feeds from the **shared** system warehouse (decision 2a), and **pays its own tax** scaled by its own
habitat upgrades. Pure-industrial worlds (gas/ice giants, belts, dead rock with no dome) host no
people. The home system is seeded with exactly one population colony — its habitable world (or, on a
bodyless legacy map, a synthetic habitat dome). Colonies are fed in orbital order, so a system that
out-runs its local food sees its outer colonies fall back to emergency imports (which keep them alive
but not growing). The legacy system-level `populationStage` / `populationProgress` / `unrest` are kept
as an **aggregate** (highest colony / its progress / peak unrest) so valuation, megastructure gating,
and the system pop-meter keep working; valuation sums each colony's population value, so **a system
with several habitable worlds is a genuinely richer prize** than one with a single capital — the
intended payoff. The colony screen shows each populated world's stage + a growth bar.

This is the deepest change and was swept hardest: a 100-game / 8-player run holds leader/median ≈14.2
with every risk flag green (metals floor 0%, food-growth 91%, raiding/takeover healthy), so rewarding
multi-habitable systems did not destabilise the economy.

## Survey Vessels

**Section 25.** Prospecting moves from per-deposit busywork to a **system-level scouting loop**. A
charter builds an unarmed **survey vessel** (`surveyShipCost`, `Ship.surveyor`) at one of its systems
and dispatches it to scout any reachable system (`surveySystem` order). The vessel travels the
cheapest charted path turn-by-turn — reusing the Section 23 mobile-fleet machinery — surveys the
**whole** target system on arrival (revealing every deposit's richness AND remaining reserves), then
flies home. A scout never fights, so it can slip into a **rival's** territory for intelligence ahead
of expansion or invasion; if it can't reach home it bases in the nearest own/neutral system rather
than stranding in enemy space.

Knowledge is **per-charter fog of war**: a survey records the system in `Corporation.surveyedSystemIds`
and `buildClientState` reveals that charter's intel only to it — surveying does **not** flip a
deposit's global "publicly worked" flag, so the intel stays private (unlike a worked deposit, whose
richness is public to all). A charter always has full intel on systems it **owns**, so the survey
vessel is purely about scouting *other* systems — frontier worlds you're weighing for a claim, or a
rival's economy before you move on it. The old per-deposit **assay** action is **removed** entirely:
owners see their own deposits automatically, and everyone else uses survey vessels. **Bots fly them
too** — every archetype keeps one scout in its fleet and repeatedly dispatches it to the nearest
unsurveyed reachable system (`maybeSurvey`); a 42-turn game sees ~130 survey runs across eight
charters, with scouts criss-crossing into rival space and returning home.

## Construction Materials

**Section 27.** Colony buildings cost **materials as well as credits**, tying the extraction economy to
development — you spend the metals/silicates/alloys you mine to raise structures. Each colony building
draws a per-kind bill (`Tuning.buildResources`) from the charter's stockpiles, buying any shortfall at
the exchange like every other build (so it's a soft requirement, not a hard gate): a **factory** is
heavy industry (alloys + metals), a **reactor** an alloy shell with silicate shielding (alloys +
silicates), an **agri-dome** a silicate-and-metal pressure dome (previously it cost credits only).
Mining-rig / habitat / power-grid upgrades already consumed their scaling raw (metals / silicates /
helium-3). The colony build menu and order tray show each building's materials alongside its credit
cost. A 30-game / 8-player sweep stays green (leader/median ≈12, metals price-floor 0%, food-growth
91%) — the added demand sink mildly compresses the runaway leader.

The colony build menu is **descriptive** (Civ-style): every option spells out what the building does,
its credit + materials cost, and **how long it takes to raise** — a clear per-kind spread of
construction turns (agri-dome fast, power-grid / mining-rig quick, habitat moderate, reactor slow,
factory slowest), with a **factory scaling by its recipe tier** (`constructionCpCost` — a tier-3
components plant takes twice the turns of a tier-1 refinery). Build time and the queue both read from
the same `Tuning.construction` points so the UI's "~N turns" matches what the engine resolves.

## Research & Specialization

**Section 28.** Six corporate research **Divisions** (Prospectus / Fabrication / Navigation / Colonial
/ Security / Acquisitions), each a short tier spine with **pick-one choice nodes**. A charter pools
**Research Points** from **Research Labs** (a new per-colony building) + populated colonies, and pours
them into one **active project at a time** with a queue (`setResearch` order). Completed techs' effects
are read live via `researchMods` (extraction yield/depletion, factory output, construction speed,
build-material cost, population growth, upkeep, defense, ship combat, fleet fuel, market edge,
acquisition cost, survey cost — see `research.ts`). The tree is costed so a focused charter finishes
only **~2 divisions (~5–6 of 15 techs)** in the 42-turn game — you **specialise**, then take what you
skipped: **conquering a charter seizes 1–3 random techs it held** (and acquisition/espionage routes
come in later phases). Bots run per-archetype research doctrines so the sim exercises the whole tree.
A 30-game / 8-player sweep stays green (leader/median ≈14, every flag healthy); per-game completions
spread ~3–6 per charter, so nobody nears the full tree.

**Phase 2** wires branches into the rest of the game: the **Warp-Drive range ladder is now a
Navigation research chain** (`grantsRangeTier` — the old credit-bought `researchRange` is gone; range
competes for RP like everything else, and conquest can even seize a rival's warp tech), **Terraforming**
(Colonial — a `terraform` order makes a non-habitable owned world habitable so it can grow a
population), **Capital Shipyards** (Security — Range-5+ hulls 30% cheaper), and **Advanced Metallurgy**
(Fabrication — megastructures 30% cheaper). Bots open every doctrine with Warp II/III so they still
reach the frontier; the 30-game sweep stays green (leader/median ≈12, metals floor 0%, food 92%).
**Phase 3** adds the endgame layer: each division has a galaxy-unique **secret-project** T4 capstone
(`secret: true`, `SECRET_TECH_IDS`) — once any charter finishes one, no other can (the engine drops a
lost-race tech and refunds its RP). The six: **Antimatter Containment** (+30% yield), **Nanofabrication**
(×2 construction, +25% factory), **Wormhole Engineering** (instantly charts every lane touching your
systems, free charting after), **Arcology** (+50% growth, +40% tax), **Orbital Dominance** (+40% combat,
easier captures), **Insider Networks** (+10% fills, −40% acquisitions). Plus **Industrial Espionage**
(steals a random rival tech every few turns) and **tech transfer on acquisition** (absorbing a charter
inherits 1–3 of its techs, like conquest; secrets never transfer). The Research screen flags secrets and
shows which rival has claimed each. Capstones are reachable but rare — a focused specialist lands ~1 in
roughly half of games; the 30-game sweep holds with capstone effects live (leader/median ≈13, all flags
green).

## Victory & End-Game

**Section 29.** A match needs a climax. Valuation (Section 17) already measures economic strength, but
a pure-cash crown gives conquest, tech-rush, and wonder strategies no moment of their own — so the
**final standing is `valuation + prestige`**, where prestige rewards the achievements valuation
under-counts: charter **systems** held (×`victory.systemPoints`), **techs** unlocked (×`techPoints`),
galaxy-unique **secret projects** owned (×`secretPoints`, much larger — they are rare and decisive),
and **megastructures** raised (×`megastructurePoints`, on top of their valuation). `computeOutcome`
(`standings.ts`) is a pure, deterministic read-model over engine state — identical on simulator,
worker, and browser — so a finished game's result is reproducible from its seed like everything else.
Ranking breaks exact ties by valuation, then corpId.

**How you win.** The category that carries the winner's lead *names* the victory:

- **Market Dominance** (`economic`) — the default crown: outvalue every rival.
- **Conquest** — hold the most chartered systems (sole leader, by a clear margin); take them by war.
- **Technological Ascendancy** — research deepest and claim a galaxy-unique secret project.
- **Galactic Wonder** — raise the most megastructures.
- **Monopoly** — a *decisive early win*: the moment exactly one charter outlasts all rivals (the rest
  collapsed to Free Operators) on or after `victory.monopolyMinTurn`, the game ends on the spot and
  that charter wins regardless of score.

The game is **over** at the turn limit *or* on a decisive monopoly (`outcome.over` — the worker ends
the DB game on either, not just the turn count). The client serves the live `GameOutcome`
(`ClientState.outcome`) every turn, so the **Standings** screen is a running scoreboard all game, and
on the final turn it leads with the winner and how they won (the `OverModal` echoes it). Scoring is a
read-model only — it changes no resolution, so the balance sweep is unaffected.

◆ END OF DOSSIER ◆

STELLAR CHARTERS · GAME DESIGN DOCUMENT v2.2  
WORMHOLE FRONTIER · STELLAR CHARTERS · GLOBAL EXCHANGE · WARP ROUTES · CONVOY WARFARE · POST-CHARTER PLAY · POPULATION & FOOD  
"The charter gives you rights. The market decides whether you survive them."
