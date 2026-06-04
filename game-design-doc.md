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

Keep the resource model small. The depth comes from scarcity, location, transit time, and price movement, not a giant crafting tree.

| Resource | Role | Strategic Notes |
| --- | --- | --- |
| ICE / WATER | Life support, fuel feedstock, basic frontier supply. | Common but constantly consumed. Close ice systems are safe income; distant ice systems support frontier clusters. |
| METALS | Construction, hulls, depots, claims, basic infrastructure. | Often overproduced early, making price crashes likely. |
| HELIUM-3 | Power, reactors, advanced industry, ship operation. | Strategic chokepoint. Energy producers can squeeze the market. |
| RARE ISOTOPES | High-end technology, advanced ships, components, late-game leverage. | Low-volume, high-value exports. Ideal raid target and monopoly resource. |
| FOOD | Feeds growing colonies and keeps populated systems stable. | Early food can be imported from humanity; midgame food production makes garden worlds and hydroponics strategically important. |
| CREDITS | Universal currency for claims, ships, debt, licenses, market buys, and privateers. | Cash timing matters because exports pay only after arrival. |

**Production location**Resources are stored locally in the system that produced them. The player does not own one global pile of Ice; they own local stockpiles distributed across systems.


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

### Prototype priority

Prototype the first 12 turns as a text or spreadsheet simulation with 4–8 players. Validate the opening auction, first exports, order fill UX, convoy visibility, warp-route traffic history, one-turn route interdiction, privateer economics, and Range 2 expansion before adding the full finance/takeover and Free Operator layers.

◆ END OF DOSSIER ◆

STELLAR CHARTERS · GAME DESIGN DOCUMENT v2.2  
WORMHOLE FRONTIER · STELLAR CHARTERS · GLOBAL EXCHANGE · WARP ROUTES · CONVOY WARFARE · POST-CHARTER PLAY · POPULATION & FOOD  
"The charter gives you rights. The market decides whether you survive them."
