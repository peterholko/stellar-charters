/**
 * Cinematic galaxy map rendered with PixiJS (WebGL).
 *
 * React owns the screen chrome, legend, selection state and inspector; this component owns
 * the rendered atlas — starfield, nebula, warp lanes, traffic, convoys, system glyphs,
 * labels — plus pan/zoom and hit testing. The Pixi `Application` is created once and torn
 * down on unmount; data/selection changes only redraw the scene layers. Hit testing routes
 * clicks back through the same `store.select(...)` the SVG map used, so the Inspector and the
 * rest of the UI stay unchanged.
 */
import { useEffect, useRef } from "react";
import { Application, Assets, Container, CullerPlugin, extensions, Graphics, Sprite, Text, Texture } from "pixi.js";

// Viewport culling (Galaxy Map Expansion, Phase 1): the CullerPlugin skips rendering display
// objects whose world bounds fall outside the screen, so a large galaxy (scale 2–3 = 150–225
// systems) only pays for what's on screen. Culling runs per render against `renderer.screen`,
// using each object's *world* bounds — so it tracks the camera automatically as you pan/zoom,
// and objects reappear when scrolled back into view. Only data-layer leaves are marked cullable
// (see `markCullable` in draw); the full-viewport nebula/starfield backdrop is left alone.
// `extensions.add` is idempotent-guarded so HMR re-imports don't double-register.
let cullerRegistered = false;
function ensureCuller(): void {
  if (cullerRegistered) return;
  cullerRegistered = true;
  extensions.add(CullerPlugin);
}
import { canRaidRoute } from "@engine";
import type { ClientContact, ClientMovement, PlayerView, PopulationStage } from "@engine";
import { computeLayout } from "../match/layout";
import {
  corpColor,
  resourceColors,
  routeRisk,
  systemArchetype,
  systemDominant,
} from "../match/format";
import type { Selection } from "../match/store";

interface Props {
  view: PlayerView;
  humanCorpId: string;
  selection: Selection;
  onSelect: (sel: Selection) => void;
  /** Issue a fleet move: called when a fleet is selected and a destination system is tapped. */
  onFleetMove?: (fromSystemId: string, toSystemId: string) => void;
  /** Dispatch a survey vessel: called when a survey ship is selected and a target system is tapped. */
  onSurveyDispatch?: (fromSystemId: string, toSystemId: string) => void;
  /** Last turn's convoy/fleet legs, animated by the "Last turn movements" replay. */
  movementLog?: ClientMovement[];
  /** Rival fleets your ships' sensors are currently detecting (Section 04) — drawn as contact blips. */
  contacts?: ClientContact[];
  /** Increment to trigger a one-shot replay of `movementLog` (a play-button click). */
  replaySignal?: number;
  /** Highlight warp lanes the player's raiders/privateers can currently interdict (Section 13). */
  raidOverlay?: boolean;
  /** Strategic overlay wash painted under the lanes (Phase 4): owner territory, resource geography,
   *  or detected-threat highlighting. "none" leaves the plain map. */
  overlayMode?: OverlayMode;
  /** Phase 2 navigation: when `nonce` changes, pan/zoom to frame `ids` (search / jump-to / frame-
   *  my-systems). Empty `ids` re-fits the whole galaxy. */
  focusTarget?: { ids: string[]; nonce: number };
}

/** Strategic map overlays (Galaxy Map Expansion, Phase 4). */
export type OverlayMode = "none" | "territory" | "resource" | "threat";

type SceneProps = Props;

/** The three kinds of own fleet the map distinguishes: line warships, raider strikes, survey skiffs. */
type FleetKind = "war" | "raid" | "survey";
interface TransitFleet {
  x: number;
  y: number;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  angle: number;
  ships: number;
  offLane: boolean;
  kind: FleetKind;
  /** Largest hull tier in the group — picks the warship icon (escort→capital). */
  maxTier: number;
}

interface Scene {
  draw: () => void;
  playReplay: () => void;
  /** Pan/zoom the camera to frame a set of systems (Phase 2 navigation: search, jump-to). */
  frame: (systemIds: string[]) => void;
  destroy: () => void;
}

export function PixiGalaxyMap({ view, humanCorpId, selection, onSelect, onFleetMove, onSurveyDispatch, movementLog, contacts, replaySignal, raidOverlay, overlayMode, focusTarget }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<Scene | null>(null);
  const propsRef = useRef<SceneProps>({ view, humanCorpId, selection, onSelect, onFleetMove, onSurveyDispatch, movementLog, contacts, replaySignal, raidOverlay, overlayMode });
  // Keep the latest props reachable from Pixi event handlers / the ticker without
  // re-creating the scene. Assigned on every render so the callbacks are never stale.
  propsRef.current = { view, humanCorpId, selection, onSelect, onFleetMove, onSurveyDispatch, movementLog, contacts, replaySignal, raidOverlay, overlayMode };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let scene: Scene | null = null;
    void createScene(host, () => propsRef.current).then((s) => {
      if (cancelled || !s) {
        s?.destroy();
        return;
      }
      scene = s;
      sceneRef.current = s;
      s.draw();
    });
    return () => {
      cancelled = true;
      sceneRef.current = null;
      scene?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Redraw when the authoritative view or the selection changes (turn resolution, picks).
  useEffect(() => {
    sceneRef.current?.draw();
  }, [view, selection, humanCorpId, raidOverlay, contacts, overlayMode]);

  // Play the "Last turn movements" replay when the signal increments (a button click).
  useEffect(() => {
    if (replaySignal && replaySignal > 0) sceneRef.current?.playReplay();
  }, [replaySignal]);

  // Frame a set of systems when a jump is requested (search box / "frame my systems").
  useEffect(() => {
    if (focusTarget) sceneRef.current?.frame(focusTarget.ids);
  }, [focusTarget?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={hostRef} className="pixigalaxy" />;
}

// ---------------------------------------------------------------------------
// Scene construction (imperative Pixi; no React inside)
// ---------------------------------------------------------------------------

interface Camera {
  x: number;
  y: number;
  zoom: number;
}

async function createScene(host: HTMLElement, getProps: () => SceneProps): Promise<Scene | null> {
  ensureCuller();
  const app = new Application();
  const palette0 = readPalette(host);
  await app.init({
    width: Math.max(1, host.clientWidth),
    height: Math.max(1, host.clientHeight),
    background: palette0.bg,
    backgroundAlpha: 1,
    antialias: true,
    autoDensity: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    // Recompute world transforms each cull so culling tracks the camera with no one-frame lag.
    culler: { updateTransform: true },
  });
  if (!host.isConnected) {
    app.destroy(true);
    return null;
  }
  host.appendChild(app.canvas);
  app.canvas.style.width = "100%";
  app.canvas.style.height = "100%";
  app.canvas.style.display = "block";

  // Full-viewport deep-space background (purely visual; pan is handled via DOM events).
  const bg = new Graphics();
  bg.eventMode = "none";
  app.stage.addChild(bg);

  const world = new Container();
  app.stage.addChild(world);
  const layers = {
    nebula: new Container(),
    starfield: new Container(),
    // Strategic overlays (Phase 4): territory/resource washes painted behind the lanes so they
    // read as a background tint, never obscuring glyphs. Threat markers go in `rings` (on top).
    overlay: new Container(),
    lanes: new Container(),
    traffic: new Container(),
    convoys: new Container(),
    fleets: new Container(),
    systems: new Container(),
    rings: new Container(),
    replay: new Container(),
  };
  layers.nebula.blendMode = "add";
  layers.starfield.blendMode = "add";
  layers.overlay.blendMode = "add";
  layers.traffic.blendMode = "add";
  layers.replay.blendMode = "add";
  world.addChild(
    layers.nebula,
    layers.starfield,
    layers.overlay,
    layers.lanes,
    layers.traffic,
    layers.convoys,
    layers.fleets,
    layers.systems,
    layers.rings,
    layers.replay,
  );

  // Labels live in screen space (constant pixel size) and are reprojected on camera moves.
  const labelLayer = new Container();
  app.stage.addChild(labelLayer);

  // Preload the galaxy-map fleet-icon sprites (Section 04) once — tiny side-profile pixel ships,
  // one per fleet kind / size band. A missing texture just falls back to the procedural glyph, so
  // an ungenerated asset never breaks the map.
  const iconTex = new Map<string, Texture>();
  await Promise.all(
    FLEET_ICON_SLOTS.map(async (slot) => {
      try {
        const tex = (await Assets.load(`/assets/${slot}.png`)) as Texture;
        if (tex) iconTex.set(slot, tex);
      } catch {
        /* asset not generated yet → glyph fallback */
      }
    }),
  );

  /** A fleet-icon sprite scaled to fit a `box`-px square, optionally flipped to face travel / tinted. */
  function fleetSprite(slot: string, box: number, opts?: { tint?: number; alpha?: number; flip?: boolean }): Sprite | null {
    const tex = iconTex.get(slot);
    if (!tex) return null;
    const sp = new Sprite(tex);
    sp.anchor.set(0.5);
    const k = box / Math.max(tex.width, tex.height);
    sp.scale.set(opts?.flip ? -k : k, k); // icons face right; flip X to face the other way (never upside-down)
    if (opts?.tint !== undefined) sp.tint = opts.tint;
    if (opts?.alpha !== undefined) sp.alpha = opts.alpha;
    return sp;
  }

  const camera: Camera = { x: 0, y: 0, zoom: 1 };
  let userAdjusted = false; // set once the user pans/zooms, so resizes stop auto-refitting
  let fitZoom = 1;
  let points = new Map<string, { x: number; y: number }>();
  let bounds = { minX: -1, minY: -1, w: 2, h: 2 };
  let unit = 1; // size base derived from galaxy span (keeps glyph proportions stable)
  let signature = "";

  // Animated handles, refreshed each draw.
  let pulses: { g: Graphics; ax: number; ay: number; bx: number; by: number; phase: number; speed: number }[] = [];
  let halos: { g: Graphics; base: number }[] = [];
  let selRing: { g: Graphics; base: number } | null = null;
  let hubGlow: Graphics | null = null;
  // "Last turn movements" replay: comets gliding along each visible leg, animated by the ticker.
  let replay: { elapsed: number; duration: number; loopsLeft: number; dots: { g: Graphics; ax: number; ay: number; bx: number; by: number }[] } | null = null;

  // Screen-space label handles for projection.
  let labels: { t: Text; wx: number; wy: number; priority: boolean }[] = [];

  function project(wx: number, wy: number): { x: number; y: number } {
    return { x: camera.x + wx * camera.zoom, y: camera.y + wy * camera.zoom };
  }

  function applyCamera(): void {
    world.scale.set(camera.zoom);
    world.position.set(camera.x, camera.y);
    const W = app.screen.width;
    const H = app.screen.height;
    const showAll = camera.zoom >= fitZoom * 1.25;
    for (const l of labels) {
      const p = project(l.wx, l.wy);
      const visible = (l.priority || showAll) && p.x > -40 && p.x < W + 40 && p.y > -20 && p.y < H + 20;
      l.t.visible = visible;
      if (visible) l.t.position.set(p.x, p.y);
    }
  }

  // Mark the per-object data layers cullable so the CullerPlugin skips off-screen lanes, fleets,
  // convoys, systems, traffic, rings and replay traces (Phase 1). The nebula/starfield backdrop
  // and screen-space labels are intentionally excluded — the backdrop fills the view and labels
  // are already viewport-culled in applyCamera. Re-run after every layer rebuild (draw/replay).
  function markCullable(): void {
    for (const layer of [
      layers.overlay,
      layers.lanes,
      layers.traffic,
      layers.convoys,
      layers.fleets,
      layers.systems,
      layers.rings,
      layers.replay,
    ]) {
      for (const child of layer.children) child.cullable = true;
    }
  }

  function resizeBg(): void {
    const W = app.screen.width;
    const H = app.screen.height;
    const pal = readPalette(host);
    bg.clear();
    bg.rect(0, 0, W, H).fill({ color: pal.bg, alpha: 1 });
  }

  function fitCamera(): void {
    const W = app.screen.width;
    const H = app.screen.height;
    const pad = 1.22;
    const z = Math.min(W / (bounds.w * pad), H / (bounds.h * pad));
    fitZoom = z;
    camera.zoom = z;
    const cx = bounds.minX + bounds.w / 2;
    const cy = bounds.minY + bounds.h / 2;
    camera.x = W / 2 - cx * z;
    camera.y = H / 2 - cy * z;
  }

  function clampZoom(z: number): number {
    // Allow zooming much closer than the fit (player feedback: needed to pick fleets out from the
    // systems) — up to 16× the whole-galaxy fit.
    return Math.min(fitZoom * 16, Math.max(fitZoom * 0.4, z));
  }

  // Pan/zoom to frame a set of systems (Phase 2 navigation). Empty/unknown ids re-fit the whole
  // galaxy; a single system zooms in to a readable close-up; several systems fit their bounding box.
  // Counts as a manual adjustment so a later resize won't snap back to the whole-galaxy fit.
  function frame(systemIds: string[]): void {
    const pts = systemIds.map((id) => points.get(id)).filter((p): p is { x: number; y: number } => !!p);
    if (pts.length === 0) {
      userAdjusted = false;
      fitCamera();
      applyCamera();
      return;
    }
    userAdjusted = true;
    const W = app.screen.width;
    const H = app.screen.height;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
    }
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    // A single system has zero span — frame a comfortable close-up; otherwise fit the box with pad.
    const spanX = Math.max(maxX - minX, unit * 40);
    const spanY = Math.max(maxY - minY, unit * 24);
    const z = clampZoom(Math.min(W / (spanX * 1.4), H / (spanY * 1.4)));
    camera.zoom = z;
    camera.x = W / 2 - cx * z;
    camera.y = H / 2 - cy * z;
    applyCamera();
  }

  // ----- interaction -----
  // All input runs through DOM pointer events tracked per-pointer, so the same code handles
  // mouse, trackpad and touch (incl. iOS): one pointer pans, two pinch-zoom around their
  // midpoint, a tap selects (see `pickAt`), and a double-tap zooms in. `touch-action: none`
  // on the canvas stops iOS from hijacking the gesture. We do our own hit testing rather than
  // rely on Pixi's object events, whose touch `pointertap` is unreliable on iOS Safari.
  app.canvas.style.touchAction = "none";

  // A press that stays within TAP_SLOP px counts as a tap (select), not a drag (pan). Touch
  // taps always jitter a few px between down and up, so this must be well above zero.
  const TAP_SLOP = 10;
  const pointers = new Map<number, { x: number; y: number }>();
  let panStart = { mx: 0, my: 0, cx: 0, cy: 0 };
  let pinchPrev: { dist: number; mx: number; my: number } | null = null;
  let gestureMoved = false;
  let lastTapTime = 0;
  let lastTapPos = { x: 0, y: 0 };

  const localPoint = (ev: PointerEvent) => {
    const rect = app.canvas.getBoundingClientRect();
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  };
  const beginPan = () => {
    const p = pointers.values().next().value!;
    panStart = { mx: p.x, my: p.y, cx: camera.x, cy: camera.y };
  };

  const onPointerDown = (ev: PointerEvent) => {
    if (ev.pointerType === "mouse" && ev.button !== 0) return;
    pointers.set(ev.pointerId, localPoint(ev));
    gestureMoved = false;
    pinchPrev = null;
    if (pointers.size === 1) beginPan();
  };
  const onPointerMove = (ev: PointerEvent) => {
    if (!pointers.has(ev.pointerId)) return;
    pointers.set(ev.pointerId, localPoint(ev));
    const pts = [...pointers.values()];
    if (pts.length >= 2) {
      const a = pts[0]!;
      const b = pts[1]!;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      if (pinchPrev && pinchPrev.dist > 0) {
        // Keep the world point under the previous midpoint pinned under the new one,
        // while scaling — gives natural two-finger pinch-zoom + pan together.
        const worldX = (pinchPrev.mx - camera.x) / camera.zoom;
        const worldY = (pinchPrev.my - camera.y) / camera.zoom;
        const z = clampZoom(camera.zoom * (dist / pinchPrev.dist));
        camera.x = mx - worldX * z;
        camera.y = my - worldY * z;
        camera.zoom = z;
        applyCamera();
      }
      pinchPrev = { dist, mx, my };
      gestureMoved = true;
      userAdjusted = true;
    } else {
      const p = pts[0]!;
      // Only treat it as a pan once the finger leaves the tap-slop radius; until then a tiny
      // jitter leaves the camera untouched so the gesture can still resolve to a tap-select.
      if (!gestureMoved && Math.hypot(p.x - panStart.mx, p.y - panStart.my) > TAP_SLOP) {
        gestureMoved = true;
        userAdjusted = true;
      }
      if (gestureMoved) {
        camera.x = panStart.cx + (p.x - panStart.mx);
        camera.y = panStart.cy + (p.y - panStart.my);
        applyCamera();
      }
    }
  };
  const onPointerUp = (ev: PointerEvent) => {
    if (!pointers.has(ev.pointerId)) return;
    const released = pointers.get(ev.pointerId)!;
    pointers.delete(ev.pointerId);
    pinchPrev = null;
    if (pointers.size === 1) {
      beginPan(); // resume single-pointer pan with the remaining touch
    } else if (pointers.size === 0 && !gestureMoved) {
      // A tap selects whatever is under the pointer — handled here so it works identically
      // for mouse and touch (Pixi's own touch `pointertap` is unreliable on iOS).
      const sel = pickAt(released.x, released.y);
      const props = getProps();
      const cur = props.selection;
      // Fleet-move mode: with a fleet selected, tapping a different system orders it there. We then
      // DESELECT (not select the destination) so move-mode ends cleanly without popping that
      // system's inspector/drawer over the map — the order lands in the tray as the confirmation.
      if (cur?.kind === "fleet" && sel?.kind === "system" && sel.id !== cur.id) {
        props.onFleetMove?.(cur.id, sel.id);
        props.onSelect(null);
        lastTapTime = 0; // a move order is not a double-tap zoom
      } else if (cur?.kind === "survey" && sel?.kind === "system" && sel.id !== cur.id) {
        // Survey vessel selected + a target tapped → dispatch it to scout that system, then deselect.
        props.onSurveyDispatch?.(cur.id, sel.id);
        props.onSelect(null);
        lastTapTime = 0;
      } else {
        if (sel) props.onSelect(sel);
        // A second quick tap in the same place also zooms in (touch has no wheel).
        const now = performance.now();
        if (now - lastTapTime < 300 && Math.hypot(released.x - lastTapPos.x, released.y - lastTapPos.y) < 30) {
          zoomAt(released.x, released.y, 1.9);
          lastTapTime = 0;
        } else {
          lastTapTime = now;
          lastTapPos = released;
        }
      }
    }
  };

  // Your idle combat ships, grouped by the system they're stationed at — a "fleet". Drawn as a
  // chevron offset up-right from the node (so the system glyph stays clickable) and used for hit
  // testing. Only your own ships are known (rivals are fogged), so only your fleets appear.
  function myStationedFleets(): { systemId: string; x: number; y: number; ships: number; combat: number; raiders: number; maxTier: number }[] {
    const { view } = getProps();
    const byStation = new Map<string, { ships: number; combat: number; raiders: number; maxTier: number }>();
    for (const s of view.me.ships) {
      if (s.combat <= 0 || s.transit || !s.stationedAt) continue;
      const e = byStation.get(s.stationedAt) ?? { ships: 0, combat: 0, raiders: 0, maxTier: 1 };
      e.ships += 1;
      e.combat += s.combat;
      if (s.raider) e.raiders += 1;
      e.maxTier = Math.max(e.maxTier, s.rangeTier);
      byStation.set(s.stationedAt, e);
    }
    const out: { systemId: string; x: number; y: number; ships: number; combat: number; raiders: number; maxTier: number }[] = [];
    for (const [systemId, e] of byStation) {
      const p = points.get(systemId);
      if (!p) continue;
      out.push({ systemId, x: p.x + unit * 3.0, y: p.y - unit * 3.0, ships: e.ships, combat: e.combat, raiders: e.raiders, maxTier: e.maxTier });
    }
    return out;
  }

  // Your idle survey vessels, grouped by station — offset up-LEFT of the node (mirroring the combat
  // fleet's up-right marker) so a system that hosts both shows them side by side. Selectable so the
  // ship can be sent to scout from the map (combat-0, so never part of myStationedFleets).
  function myStationedSurveyors(): { systemId: string; x: number; y: number; count: number }[] {
    const { view } = getProps();
    const byStation = new Map<string, number>();
    for (const s of view.me.ships) {
      if (!s.surveyor || s.transit || !s.stationedAt) continue;
      byStation.set(s.stationedAt, (byStation.get(s.stationedAt) ?? 0) + 1);
    }
    const out: { systemId: string; x: number; y: number; count: number }[] = [];
    for (const [systemId, count] of byStation) {
      const p = points.get(systemId);
      if (!p) continue;
      out.push({ systemId, x: p.x - unit * 3.0, y: p.y - unit * 3.0, count });
    }
    return out;
  }

  // Your fleets currently in transit, grouped by shared leg AND fleet kind so the map can show a
  // distinct icon per type: a war fleet (line warships), a raider strike (interdiction), and an
  // unarmed survey skiff. Interpolated along the current segment like convoys. When two kinds run
  // the same leg they're nudged apart perpendicular to travel so the icons don't stack.
  function myTransitFleets(): TransitFleet[] {
    const { view } = getProps();
    const turn = view.turn;
    const groups = new Map<string, { ships: number; fromId: string; toId: string; launchedTurn: number; offLane: boolean; kind: FleetKind; legKey: string; maxTier: number }>();
    for (const s of view.me.ships) {
      const tr = s.transit;
      if (!tr) continue;
      const fromId = tr.path[tr.position];
      const toId = tr.path[tr.position + 1];
      if (!fromId || !toId) continue;
      const kind: FleetKind = s.surveyor ? "survey" : s.raider ? "raid" : "war";
      const legKey = `${fromId}>${toId}|${tr.launchedTurn}`;
      const key = `${legKey}|${kind}`;
      const e = groups.get(key) ?? { ships: 0, fromId, toId, launchedTurn: tr.launchedTurn, offLane: tr.routeIds[tr.position] === "", kind, legKey, maxTier: 1 };
      e.ships += 1;
      e.maxTier = Math.max(e.maxTier, s.rangeTier);
      groups.set(key, e);
    }
    // Count how many distinct kinds share each leg so we can fan them out symmetrically.
    const perLeg = new Map<string, { total: number; seen: number }>();
    for (const g of groups.values()) {
      const e = perLeg.get(g.legKey) ?? { total: 0, seen: 0 };
      e.total += 1;
      perLeg.set(g.legKey, e);
    }
    const out: TransitFleet[] = [];
    for (const g of groups.values()) {
      const from = points.get(g.fromId);
      const to = points.get(g.toId);
      if (!from || !to) continue;
      const frac = g.launchedTurn >= turn ? 0.18 : 0.5;
      const angle = Math.atan2(to.y - from.y, to.x - from.x);
      const leg = perLeg.get(g.legKey)!;
      const idx = leg.seen++;
      const spread = (idx - (leg.total - 1) / 2) * unit * 1.5; // perpendicular nudge
      const ox = -Math.sin(angle) * spread;
      const oy = Math.cos(angle) * spread;
      out.push({
        x: from.x + (to.x - from.x) * frac + ox,
        y: from.y + (to.y - from.y) * frac + oy,
        ax: from.x, ay: from.y, bx: to.x, by: to.y,
        angle,
        ships: g.ships,
        offLane: g.offLane,
        kind: g.kind,
        maxTier: g.maxTier,
      });
    }
    return out;
  }

  // Unified pick: returns the Selection under a canvas-local point, testing fleets, then convoys,
  // then systems, then lanes (matching the visual stacking order). Pure world-space geometry, so
  // it is independent of Pixi's event system and behaves the same for mouse and touch.
  function pickAt(lx: number, ly: number): Selection {
    const { view } = getProps();
    const galaxy = view.galaxy;
    const wx = (lx - camera.x) / camera.zoom;
    const wy = (ly - camera.y) / camera.zoom;

    for (const f of myStationedFleets()) {
      if (Math.hypot(wx - f.x, wy - f.y) <= unit * 2.6) return { kind: "fleet", id: f.systemId };
    }
    for (const f of myStationedSurveyors()) {
      if (Math.hypot(wx - f.x, wy - f.y) <= unit * 2.6) return { kind: "survey", id: f.systemId };
    }
    for (const c of view.convoys) {
      const route = galaxy.routes.get(c.routeIds[c.position] ?? "");
      const a = route && points.get(route.a);
      const b = route && points.get(route.b);
      if (!a || !b) continue;
      const frac = c.launchedTurn >= view.turn ? 0.18 : 0.5;
      const cx = a.x + (b.x - a.x) * frac;
      const cy = a.y + (b.y - a.y) * frac;
      if (Math.hypot(wx - cx, wy - cy) <= unit * 2.4) return { kind: "convoy", id: c.id };
    }
    for (const s of galaxy.allSystems()) {
      const p = points.get(s.id);
      if (!p) continue;
      const region = s.position?.region ?? (s.id === galaxy.hubId ? "hub" : "core");
      if (Math.hypot(wx - p.x, wy - p.y) <= nodeRadius(region, unit) * 2.2) {
        return { kind: "system", id: s.id };
      }
    }
    let best: Selection = null;
    let bestDist = unit * 3.5;
    for (const route of galaxy.routes.values()) {
      const a = points.get(route.a);
      const b = points.get(route.b);
      if (!a || !b) continue;
      const d = distToSegment(wx, wy, a.x, a.y, b.x, b.y);
      if (d < bestDist) {
        bestDist = d;
        best = { kind: "route", id: route.id };
      }
    }
    return best;
  }
  app.canvas.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);

  const onWheel = (ev: WheelEvent) => {
    ev.preventDefault();
    const rect = app.canvas.getBoundingClientRect();
    zoomAt(ev.clientX - rect.left, ev.clientY - rect.top, Math.exp(-ev.deltaY * 0.0015));
  };
  app.canvas.addEventListener("wheel", onWheel, { passive: false });

  function zoomAt(mx: number, my: number, factor: number): void {
    userAdjusted = true;
    const worldX = (mx - camera.x) / camera.zoom;
    const worldY = (my - camera.y) / camera.zoom;
    const z = clampZoom(camera.zoom * factor);
    camera.x = mx - worldX * z;
    camera.y = my - worldY * z;
    camera.zoom = z;
    applyCamera();
  }

  const ro = new ResizeObserver(() => {
    const W = Math.max(1, host.clientWidth);
    const H = Math.max(1, host.clientHeight);
    app.renderer.resize(W, H);
    resizeBg();
    // Keep the galaxy framed across viewport changes until the user takes manual control.
    if (!userAdjusted) fitCamera();
    applyCamera();
  });
  ro.observe(host);

  // Re-read the theme palette and repaint when the active theme changes (preserves camera).
  const themeObserver = new MutationObserver(() => {
    resizeBg();
    rebuildBackground(readPalette(host));
    draw();
  });
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });

  // Build and start the "Last turn movements" replay from the latest movement log.
  function playReplay(): void {
    layers.replay.removeChildren().forEach((c) => c.destroy());
    replay = null;
    const { movementLog, humanCorpId } = getProps();
    if (!movementLog || movementLog.length === 0) return;
    const pal = readPalette(host);
    const dots: { g: Graphics; ax: number; ay: number; bx: number; by: number }[] = [];
    for (const m of movementLog) {
      const a = points.get(m.fromSystemId);
      const b = points.get(m.toSystemId);
      if (!a || !b) continue;
      const color = m.owner === humanCorpId ? pal.accent : pal.rival;
      // A bright trace of the leg (dashed if off-lane) stays lit for the whole replay, with a
      // travelling comet sweeping along it so the movement reads clearly.
      const line = new Graphics();
      if (m.offLane) {
        drawDashed(line, a, b, unit * 1.4, unit * 1.0, unit * 0.45, color, 0.6);
      } else {
        line.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: unit * 0.45, color, alpha: 0.55, cap: "round" });
      }
      layers.replay.addChild(line);
      const dot = new Graphics();
      dot.circle(0, 0, unit * 1.4).fill({ color, alpha: 1 });
      dot.circle(0, 0, unit * 2.4).fill({ color, alpha: 0.25 }); // soft glow halo
      layers.replay.addChild(dot);
      dots.push({ g: dot, ax: a.x, ay: a.y, bx: b.x, by: b.y });
    }
    if (dots.length === 0) return;
    markCullable(); // replay traces were rebuilt after draw — make them cullable too
    replay = { elapsed: 0, duration: 2.2, loopsLeft: 1, dots }; // plays through twice
  }

  // ----- animation -----
  let elapsed = 0;
  const tick = (ticker: { deltaMS: number }) => {
    const dt = ticker.deltaMS / 1000;
    elapsed += dt;
    if (replay) {
      replay.elapsed += dt;
      const t = Math.min(1, replay.elapsed / replay.duration);
      const a = 0.3 + 0.7 * Math.sin(t * Math.PI); // fade in then out across the leg
      for (const d of replay.dots) {
        d.g.position.set(d.ax + (d.bx - d.ax) * t, d.ay + (d.by - d.ay) * t);
        d.g.alpha = a;
      }
      if (t >= 1) {
        if (replay.loopsLeft > 0) {
          replay.loopsLeft -= 1;
          replay.elapsed = 0; // play the sweep again so it's hard to miss
        } else {
          layers.replay.removeChildren().forEach((c) => c.destroy());
          replay = null;
        }
      }
    }
    for (const p of pulses) {
      const t = (elapsed * p.speed + p.phase) % 1;
      p.g.position.set(p.ax + (p.bx - p.ax) * t, p.ay + (p.by - p.ay) * t);
      p.g.alpha = 0.35 + 0.4 * Math.sin(t * Math.PI);
    }
    for (const h of halos) {
      h.g.alpha = 0.16 + 0.12 * (0.5 + 0.5 * Math.sin(elapsed * 3));
    }
    if (selRing) {
      const s = 1 + 0.08 * Math.sin(elapsed * 3.5);
      selRing.g.scale.set(s);
      selRing.g.alpha = 0.7 + 0.3 * Math.sin(elapsed * 3.5);
    }
    if (hubGlow) {
      hubGlow.scale.set(1 + 0.05 * Math.sin(elapsed * 1.6));
      hubGlow.rotation = elapsed * 0.06;
    }
  };
  app.ticker.add(tick);

  // ----- drawing -----
  function rebuildBackground(pal: Palette): void {
    layers.nebula.removeChildren().forEach((c) => c.destroy());
    layers.starfield.removeChildren().forEach((c) => c.destroy());

    const rng = mulberry32(hashSignature(signature));
    // Nebula: a few soft additive blobs, layered concentric fills (no filters needed).
    const blobColors = [pal.accent, pal.accent2, 0x7a4bd0, pal.accent2];
    const blobs = 4 + Math.floor(rng() * 3);
    for (let i = 0; i < blobs; i++) {
      const bx = bounds.minX + rng() * bounds.w;
      const by = bounds.minY + rng() * bounds.h;
      const r = unit * (16 + rng() * 22);
      const color = blobColors[i % blobColors.length]!;
      const blob = new Graphics();
      const rings = 7;
      for (let k = rings; k >= 1; k--) {
        blob.circle(bx, by, (r * k) / rings).fill({ color, alpha: 0.018 });
      }
      layers.nebula.addChild(blob);
    }

    // Starfield: many small additive stars scattered across (and beyond) the galaxy bounds.
    const star = new Graphics();
    const pad = Math.max(bounds.w, bounds.h) * 0.25;
    const area = (bounds.w + pad * 2) * (bounds.h + pad * 2);
    const count = Math.min(900, Math.max(220, Math.floor(area / (unit * unit * 26))));
    for (let i = 0; i < count; i++) {
      const x = bounds.minX - pad + rng() * (bounds.w + pad * 2);
      const y = bounds.minY - pad + rng() * (bounds.h + pad * 2);
      const b = rng();
      const r = unit * (0.06 + b * 0.16);
      star.circle(x, y, r).fill({ color: 0xffffff, alpha: 0.15 + b * 0.55 });
    }
    layers.starfield.addChild(star);
  }

  function draw(): void {
    const { view, humanCorpId, selection, raidOverlay, overlayMode } = getProps();
    const galaxy = view.galaxy;
    const pal = readPalette(host);

    // (Re)compute geometry only when the system set / layout changes (new game, etc.).
    const sys = galaxy.allSystems();
    const sig = sys.map((s) => `${s.id}:${s.position ? `${s.position.x},${s.position.y}` : "?"}`).join("|");
    if (sig !== signature) {
      signature = sig;
      points = layoutPoints(galaxy);
      bounds = computeBounds(points);
      unit = Math.max(1, Math.hypot(bounds.w, bounds.h) / 150);
      // Hard guarantee: no two system glyphs may render touching. Generation enforces a
      // minimum spacing in world coords, but the display-only LAYOUT_SPREAD remap above is
      // non-linear and doesn't preserve it (the rim gets compressed). Push any overlapping
      // glyphs apart in *render* space — using their on-screen radii — so a visible gap always
      // remains at any zoom (camera scales points and glyphs together). `unit` is left at the
      // pre-relax value so glyph sizes stay fixed; only the camera bounds are recomputed.
      enforceGlyphSeparation(points, sys, galaxy.hubId, unit);
      bounds = computeBounds(points);
      resizeBg();
      rebuildBackground(pal);
      fitCamera();
    }

    const turn = view.turn;
    const pt = (id: string) => points.get(id) ?? { x: 0, y: 0 };

    // Reset dynamic layers. A redraw (turn resolution / new selection) also cancels any in-flight
    // replay, whose dots reference the previous frame's geometry.
    for (const c of [layers.overlay, layers.lanes, layers.traffic, layers.convoys, layers.fleets, layers.systems, layers.rings, layers.replay]) {
      c.removeChildren().forEach((ch) => ch.destroy());
    }
    labelLayer.removeChildren().forEach((ch) => ch.destroy());
    pulses = [];
    halos = [];
    selRing = null;
    hubGlow = null;
    replay = null;
    labels = [];

    // ----- strategic overlays (Phase 4) -----
    // A background wash under the lanes that re-reads the map by a chosen strategic dimension.
    // All three lean on data the seat already has (owner, fogged deposits, sensor contacts), so
    // nothing here leaks hidden state. Threat markers are drawn into `rings` (on top) further down.
    const mode = overlayMode ?? "none";
    if (mode === "territory") {
      // Owner influence blooms: a soft, owner-coloured disc behind every claimed world (incl. the
      // hub), so fronts and spheres of control read at a glance without clicking each system.
      for (const s of sys) {
        const isHub = s.id === galaxy.hubId;
        if (!s.owner && !isHub) continue;
        const p = pt(s.id);
        const col = isHub ? pal.accent2 : s.owner === humanCorpId ? pal.accent : cssNum(corpColor(s.owner!));
        const region = s.position?.region ?? (isHub ? "hub" : "core");
        const bloom = new Graphics();
        const rad = nodeRadius(region, unit) * 4.2;
        for (let k = 3; k >= 1; k--) bloom.circle(0, 0, (rad * k) / 3).fill({ color: col, alpha: 0.05 });
        bloom.position.set(p.x, p.y);
        layers.overlay.addChild(bloom);
      }
    } else if (mode === "resource") {
      // Resource geography: a disc tinted to each world's dominant deposit (fogged worlds report
      // muted/zero potential, so unsurveyed space naturally stays dim). Answers "where do I expand?".
      for (const s of sys) {
        if (s.id === galaxy.hubId) continue;
        const p = pt(s.id);
        const col = cssNum(resourceColors[systemDominant(s)]);
        const region = s.position?.region ?? "core";
        const disc = new Graphics();
        const rad = nodeRadius(region, unit) * 2.8;
        disc.circle(0, 0, rad).fill({ color: col, alpha: 0.16 });
        disc.position.set(p.x, p.y);
        layers.overlay.addChild(disc);
      }
    } else if (mode === "threat") {
      // Detected-threat highlighting: bloom the destination of every rival fleet your sensors are
      // tracking, so an incoming assault is a glance, not a hunt through the contact list.
      for (const c of getProps().contacts ?? []) {
        const to = points.get(c.toSystemId);
        if (!to) continue;
        const col = pal.negative;
        const scale = c.forceEstimate === "heavy" ? 1.5 : c.forceEstimate === "medium" ? 1.2 : 1.0;
        const bloom = new Graphics();
        const rad = unit * 6 * scale;
        for (let k = 3; k >= 1; k--) bloom.circle(0, 0, (rad * k) / 3).fill({ color: col, alpha: 0.06 });
        bloom.position.set(to.x, to.y);
        layers.overlay.addChild(bloom);
        // A bright ring on top so the threatened world reads at any zoom (sits above the systems).
        const ring = new Graphics();
        ring.circle(0, 0, unit * 3 * scale).stroke({ width: unit * 0.4, color: col, alpha: 0.85 });
        ring.position.set(to.x, to.y);
        layers.rings.addChild(ring);
      }
    }

    // ----- warp lanes -----
    for (const r of galaxy.routes.values()) {
      const a = pt(r.a);
      const b = pt(r.b);
      const risk = routeRisk(r);
      const selected = selection?.kind === "route" && selection.id === r.id;
      const traffic = galaxy.recentTraffic(r.id, turn);
      const g = new Graphics();

      if (!r.charted) {
        drawDashed(g, a, b, unit * 1.4, unit * 1.4, unit * 0.3, pal.faint, 0.38);
      } else {
        // Raid-reach overlay (Section 13): lanes the player can interdict right now burn hot;
        // everything out of reach recedes, so "where can I hunt?" is one glance, not N clicks.
        const inReach = raidOverlay ? canRaidRoute(galaxy, view.me, r) : false;
        const color = raidOverlay
          ? (inReach ? pal.negative : pal.faint)
          : risk.level === "severe" ? pal.negative : risk.level === "high" ? pal.warn : pal.accent2;
        // Warp lanes are now the fuel-efficient *option*, not the skeleton of the galaxy: draw them
        // thinner and dimmer so systems and fleets read first (selection/traffic still emphasise).
        const baseAlpha = raidOverlay ? (inReach ? 0.85 : 0.1) : risk.level === "guarded" ? 0.22 : 0.32;
        const width = unit * (0.16 + Math.min(0.6, traffic * 0.12)) * (inReach ? 1.8 : 1);
        if (selected) {
          g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: width + unit * 1.6, color: pal.accent, alpha: 0.3, cap: "round" });
        }
        g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width, color, alpha: selected ? 0.95 : baseAlpha, cap: "round" });
      }

      layers.lanes.addChild(g);

      // Recent traffic → animated pulses (charted lanes only).
      if (r.charted && traffic > 0) {
        const dots = Math.min(3, Math.ceil(traffic / 2));
        const color = risk.level === "high" || risk.level === "severe" ? pal.warn : pal.accent2;
        for (let i = 0; i < dots; i++) {
          const dot = new Graphics();
          dot.circle(0, 0, unit * 0.7).fill({ color, alpha: 0.8 });
          layers.traffic.addChild(dot);
          pulses.push({ g: dot, ax: a.x, ay: a.y, bx: b.x, by: b.y, phase: i / dots, speed: 0.35 });
        }
      }
    }

    // ----- convoys -----
    for (const c of view.convoys) {
      const rid = c.routeIds[c.position];
      const route = rid ? galaxy.routes.get(rid) : undefined;
      if (!route) continue;
      const a = pt(route.a);
      const b = pt(route.b);
      const frac = c.launchedTurn >= turn ? 0.18 : 0.5;
      const x = a.x + (b.x - a.x) * frac;
      const y = a.y + (b.y - a.y) * frac;
      const mine = c.owner === humanCorpId;
      const selected = selection?.kind === "convoy" && selection.id === c.id;
      const color = mine ? pal.accent : pal.rival;
      const angle = Math.atan2(b.y - a.y, b.x - a.x);

      const cont = new Container();
      cont.position.set(x, y);
      const halo = new Graphics();
      halo.circle(0, 0, unit * 1.9).fill({ color, alpha: 0.22 });
      halo.blendMode = "add";
      cont.addChild(halo);
      halos.push({ g: halo, base: unit * 1.9 });

      // Trade ship sprite (light trader vs bulk freighter by value). Own convoys keep their natural
      // colour; rival convoys are tinted to the rival hue. The selection ring is drawn below.
      const sprite = fleetSprite(convoyIconSlot(c.value), unit * 6, { flip: b.x < a.x, tint: mine ? undefined : color, alpha: mine ? 1 : 0.95 });
      if (sprite) {
        cont.addChild(sprite);
      } else {
        cont.rotation = angle;
        const body = new Graphics();
        const s = unit * 1.15;
        body.poly([s, 0, -s * 0.8, s * 0.8, -s * 0.3, 0, -s * 0.8, -s * 0.8]).fill({ color, alpha: 1 });
        if (selected) body.stroke({ width: unit * 0.35, color: pal.ink, alpha: 0.9 });
        cont.addChild(body);
      }
      layers.convoys.addChild(cont);
    }

    // ----- fleets (your own; rivals are fogged) -----
    // A parked garrison reads as an upward chevron; a raider-heavy garrison burns amber so a
    // standing strike force is distinct from a defensive escort wing.
    for (const f of myStationedFleets()) {
      const selected = selection?.kind === "fleet" && selection.id === f.systemId;
      const raiderHeavy = f.raiders * 2 >= f.ships;
      // A raider-heavy garrison shows the corsair; otherwise the warship icon for its biggest hull.
      const slot = raiderHeavy ? "fleeticon-raider" : warIconSlot(f.maxTier);
      const cont = new Container();
      cont.position.set(f.x, f.y);
      const halo = new Graphics();
      halo.circle(0, 0, unit * 1.9).fill({ color: pal.accent, alpha: 0.16 });
      halo.blendMode = "add";
      cont.addChild(halo);
      halos.push({ g: halo, base: unit * 1.9 });
      if (selected) {
        const ring = new Graphics();
        ring.circle(0, 0, unit * 3).stroke({ width: unit * 0.5, color: pal.accent, alpha: 1 });
        cont.addChild(ring);
        selRing = { g: ring, base: unit * 3 };
      }
      const sprite = fleetSprite(slot, unit * 5.5);
      if (sprite) {
        cont.addChild(sprite);
      } else {
        const col = raiderHeavy ? pal.warn : pal.accent;
        const g = new Graphics();
        const s = unit * 1.15;
        g.poly([0, -s, s * 0.95, s * 0.7, 0, s * 0.2, -s * 0.95, s * 0.7]).fill({ color: col, alpha: 0.95 });
        g.stroke({ width: unit * 0.28, color: pal.ink, alpha: 0.7 });
        cont.addChild(g);
      }
      layers.fleets.addChild(cont);
    }
    // ----- stationed survey vessels (selectable → dispatch to scout from the map) -----
    for (const f of myStationedSurveyors()) {
      const selected = selection?.kind === "survey" && selection.id === f.systemId;
      const cont = new Container();
      cont.position.set(f.x, f.y);
      const halo = new Graphics();
      halo.circle(0, 0, unit * 1.7).fill({ color: pal.accent2, alpha: 0.16 });
      halo.blendMode = "add";
      cont.addChild(halo);
      halos.push({ g: halo, base: unit * 1.7 });
      if (selected) {
        const ring = new Graphics();
        ring.circle(0, 0, unit * 2.9).stroke({ width: unit * 0.5, color: pal.accent2, alpha: 1 });
        cont.addChild(ring);
        selRing = { g: ring, base: unit * 2.9 };
      }
      const sprite = fleetSprite("fleeticon-survey", unit * 5);
      if (sprite) {
        cont.addChild(sprite);
      } else {
        const g = new Graphics();
        const s = unit * 1.0;
        g.poly([s, 0, 0, s * 0.82, -s, 0, 0, -s * 0.82]).stroke({ width: unit * 0.32, color: pal.accent2, alpha: 0.95 });
        g.circle(0, 0, unit * 0.34).fill({ color: pal.accent2, alpha: 1 });
        cont.addChild(g);
      }
      layers.fleets.addChild(cont);
    }
    for (const f of myTransitFleets()) {
      const col = fleetKindColor(f.kind, pal);
      // Off-lane fleets have no warp lane beneath them — draw a faint dashed track so the direct
      // jump reads as deliberately "off the lanes".
      if (f.offLane) {
        const track = new Graphics();
        drawDashed(track, { x: f.ax, y: f.ay }, { x: f.bx, y: f.by }, unit * 1.1, unit * 0.9, unit * 0.25, col, 0.3);
        layers.fleets.addChild(track);
      }
      const cont = new Container();
      cont.position.set(f.x, f.y);
      const halo = new Graphics();
      halo.circle(0, 0, unit * 1.7).fill({ color: pal.accent, alpha: 0.18 });
      halo.blendMode = "add";
      cont.addChild(halo);
      halos.push({ g: halo, base: unit * 1.7 });
      // Ship-type sprite by kind + flagship size, flipped to face travel direction.
      const sprite = fleetSprite(transitIconSlot(f.kind, f.maxTier), unit * 5.5, { flip: f.bx < f.ax });
      if (sprite) {
        cont.addChild(sprite);
      } else {
        cont.rotation = f.angle;
        cont.addChild(fleetGlyph(f.kind, unit, col, pal.ink));
      }
      layers.fleets.addChild(cont);
    }

    // ----- rival contacts (Section 04 — ship-mounted sensors) -----
    // A detected rival fleet in transit: a hollow hostile chevron at the midpoint of the leg it is
    // crossing, sized by the rough force band — visually distinct from your filled fleet triangle.
    for (const c of getProps().contacts ?? []) {
      const from = points.get(c.fromSystemId);
      const to = points.get(c.toSystemId);
      if (!from || !to) continue;
      const col = cssNum(corpColor(c.owner));
      const scale = c.forceEstimate === "heavy" ? 1.35 : c.forceEstimate === "medium" ? 1.1 : 0.9;
      if (c.offLane) {
        const track = new Graphics();
        drawDashed(track, { x: from.x, y: from.y }, { x: to.x, y: to.y }, unit * 1.1, unit * 0.9, unit * 0.22, col, 0.3);
        layers.fleets.addChild(track);
      }
      const cont = new Container();
      cont.position.set(from.x + (to.x - from.x) * 0.5, from.y + (to.y - from.y) * 0.5);
      // Rival fleet, fogged to a force band: a size-appropriate ship tinted to the rival's colour,
      // inside a hostile ring so it reads as "theirs, roughly this big" — never an exact type.
      const ring = new Graphics();
      ring.circle(0, 0, unit * 1.9 * scale).stroke({ width: unit * 0.3, color: col, alpha: 0.5 });
      ring.blendMode = "add";
      cont.addChild(ring);
      const sprite = fleetSprite(contactIconSlot(c.forceEstimate), unit * 5.5 * scale, { tint: col, alpha: 0.95, flip: to.x < from.x });
      if (sprite) {
        cont.addChild(sprite);
      } else {
        cont.rotation = Math.atan2(to.y - from.y, to.x - from.x);
        const g = new Graphics();
        const s = unit * 1.0 * scale;
        g.poly([s, 0, -s * 0.7, s * 0.75, -s * 0.7, -s * 0.75]).stroke({ width: unit * 0.4, color: col, alpha: 0.95 });
        cont.addChild(g);
      }
      layers.fleets.addChild(cont);
    }

    // ----- systems -----
    for (const s of sys) {
      const p = pt(s.id);
      const isHub = s.id === galaxy.hubId;
      const mine = s.owner === humanCorpId;
      const open = s.owner === null && !isHub;
      const selected = selection?.kind === "system" && selection.id === s.id;
      const region = s.position?.region ?? (isHub ? "hub" : "core");
      const arch = systemArchetype(s);
      const fill = isHub
        ? pal.accent
        : s.owner
        ? mine
          ? pal.accent
          : cssNum(corpColor(s.owner))
        : cssNum(resourceColors[systemDominant(s)]);

      const cont = new Container();
      cont.position.set(p.x, p.y);

      if (isHub) {
        const glow = new Graphics();
        for (let k = 6; k >= 1; k--) {
          glow.circle(0, 0, (unit * 5 * k) / 6).fill({ color: pal.accent2, alpha: 0.05 });
        }
        glow.blendMode = "add";
        cont.addChild(glow);
        hubGlow = glow;
      }

      const r = nodeRadius(region, unit);
      // Soft halo + luminous core, with a region-specific accent so worlds aren't identical dots.
      const glyph = new Graphics();
      glyph.circle(0, 0, r * 1.35).fill({ color: fill, alpha: 0.1 });
      glyph.blendMode = "normal";
      cont.addChild(glyph);
      drawGlyph(cont, region, arch, r, fill, open, pal);

      // Claimed-territory + development indicator — exactly ONE ring per system (player feedback).
      // A claimed system (yours or a rival's) wears a single owner-coloured ring; how built-up it is
      // reads as the ring's WEIGHT (a busier colony, or one with a megastructure, wears a bolder,
      // brighter ring) rather than a stack of extra rings or pips.
      if (s.owner && !isHub) {
        const ownerCol = mine ? pal.accent : cssNum(corpColor(s.owner));
        const mega = s.megastructures && s.megastructures.length > 0 ? 1 : 0;
        const dev = Math.min(5, developmentTier(s) + mega); // 1 (outpost) … 5 (metropolis / megastructure)
        const ring = new Graphics();
        ring.circle(0, 0, r * 1.7).stroke({ width: unit * (0.28 + dev * 0.09), color: ownerCol, alpha: (mine ? 0.62 : 0.5) + dev * 0.06 });
        cont.addChild(ring);
      }

      // Warp Disruptor (Section 04): a glowing outer ring marks the system as a slow-zone that holds
      // rival fleet arrivals.
      if (s.hasDisruptor && !isHub) {
        const disRing = new Graphics();
        disRing.circle(0, 0, r * 2.05).stroke({ width: unit * 0.35, color: pal.accent2, alpha: 0.7 });
        disRing.blendMode = "add";
        cont.addChild(disRing);
      }

      layers.systems.addChild(cont);

      // Selection ring.
      if (selected) {
        const ring = new Graphics();
        ring.circle(0, 0, r * 2.2).stroke({ width: unit * 0.5, color: pal.accent, alpha: 1 });
        ring.position.set(p.x, p.y);
        layers.rings.addChild(ring);
        selRing = { g: ring, base: r * 2.2 };
      }

      // Label (screen space).
      const t = new Text({
        text: s.name,
        style: {
          fill: isHub ? pal.accent : mine ? pal.ink : pal.inkDim,
          fontSize: 12, // tracks the desktop type bump (styles.css root scale) so labels read consistently
          fontFamily: "ui-monospace, Menlo, monospace",
          fontWeight: isHub || mine ? "600" : "400",
        },
      });
      t.anchor.set(0.5, 0);
      t.resolution = Math.min(window.devicePixelRatio || 1, 2);
      labelLayer.addChild(t);
      labels.push({ t, wx: p.x, wy: p.y + r * 2.4, priority: isHub || mine || selected });
    }

    // Selection ring for a selected convoy.
    if (selection?.kind === "convoy") {
      const c = view.convoys.find((cv) => cv.id === selection.id);
      const rid = c?.routeIds[c.position];
      const route = rid ? galaxy.routes.get(rid) : undefined;
      if (c && route) {
        const a = pt(route.a);
        const b = pt(route.b);
        const frac = c.launchedTurn >= turn ? 0.18 : 0.5;
        const ring = new Graphics();
        ring.circle(0, 0, unit * 2.4).stroke({ width: unit * 0.5, color: pal.accent, alpha: 1 });
        ring.position.set(a.x + (b.x - a.x) * frac, a.y + (b.y - a.y) * frac);
        layers.rings.addChild(ring);
        selRing = { g: ring, base: unit * 2.4 };
      }
    }

    markCullable();
    applyCamera();
  }

  return {
    draw,
    playReplay,
    frame,
    destroy: () => {
      app.ticker.remove(tick);
      ro.disconnect();
      themeObserver.disconnect();
      app.canvas.removeEventListener("wheel", onWheel);
      app.canvas.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      app.destroy(true, { children: true });
    },
  };
}

// ---------------------------------------------------------------------------
// Geometry + drawing helpers
// ---------------------------------------------------------------------------

/**
 * Display-only spread factor for the procedural galaxy. The generator packs a dense core
 * inside a sparse halo, so fit-to-view shrinks the centre into an unreadable ball of
 * overlapping glyphs. Remapping each system's hub-distance by r^SPREAD (SPREAD < 1) pushes
 * the inner systems outward and evens out the radial density. The rim systems stay put, so
 * the overall bounds are unchanged. Purely cosmetic — engine transit distances are never
 * derived from this map; lanes, convoys, and hit-testing all read from it, so they stay
 * consistent.
 */
const LAYOUT_SPREAD = 0.62;

function layoutPoints(galaxy: PlayerView["galaxy"]): Map<string, { x: number; y: number }> {
  const all = galaxy.allSystems();
  const hasPositions = all.every((s) => s.position);
  if (!hasPositions) {
    // Legacy scenarios carry no coordinates — fall back to the radial layout (0..100 space).
    return computeLayout(galaxy);
  }
  const hub = all.find((s) => s.id === galaxy.hubId)?.position;
  const hx = hub?.x ?? 0;
  const hy = hub?.y ?? 0;
  let maxR = 0;
  for (const s of all) {
    const r = Math.hypot(s.position!.x - hx, s.position!.y - hy);
    if (r > maxR) maxR = r;
  }
  const m = new Map<string, { x: number; y: number }>();
  for (const s of all) {
    const dx = s.position!.x - hx;
    const dy = s.position!.y - hy;
    const r = Math.hypot(dx, dy);
    if (r < 1e-6 || maxR < 1e-6) {
      m.set(s.id, { x: hx, y: hy });
      continue;
    }
    const k = (maxR * Math.pow(r / maxR, LAYOUT_SPREAD)) / r;
    m.set(s.id, { x: hx + dx * k, y: hy + dy * k });
  }
  return m;
}

function computeBounds(points: Map<string, { x: number; y: number }>): {
  minX: number;
  minY: number;
  w: number;
  h: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points.values()) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  if (!Number.isFinite(minX)) return { minX: -1, minY: -1, w: 2, h: 2 };
  return { minX, minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
}

function nodeRadius(region: string, unit: number): number {
  if (region === "hub") return unit * 2.8;
  if (region === "core") return unit * 1.5;
  if (region === "frontier") return unit * 1.3;
  if (region === "abyss") return unit * 1.2;
  return unit * 1.4;
}

/**
 * Deterministic relaxation that guarantees no two system glyphs render touching. The required
 * centre-to-centre distance for a pair is each glyph's drawn radius (scaled past its halo/ring
 * decorations by GLYPH_FOOTPRINT) plus a fixed visible gap. Overlapping pairs are pushed apart
 * (the hub stays pinned at the origin); a few dozen passes converge because generation already
 * separates most systems and only the few true overlaps move. Pure function of the input points,
 * so the layout stays seed-deterministic. Operates in the same world space the glyphs draw in, so
 * the gap holds at every camera zoom.
 */
function enforceGlyphSeparation(
  points: Map<string, { x: number; y: number }>,
  systems: ReadonlyArray<{ id: string; position?: { region?: string } }>,
  hubId: string,
  unit: number,
): void {
  const GLYPH_FOOTPRINT = 1.95; // clear the halo (1.35·r), star aura (1.55·r) + owner ring & dev pips (1.7·r + pip)
  const GAP = unit * 1.7; // a generous lane of empty space between any two glyphs
  const MAX_ITERS = 200;
  const list = systems.map((s, i) => ({
    p: points.get(s.id),
    r: nodeRadius(s.position?.region ?? (s.id === hubId ? "hub" : "core"), unit) * GLYPH_FOOTPRINT,
    hub: s.id === hubId,
    i,
  })).filter((e): e is { p: { x: number; y: number }; r: number; hub: boolean; i: number } => !!e.p);

  // Spatial grid (Galaxy Map Expansion, Phase 1): a node can only overlap another within
  // `maxR + maxR + GAP` of it, so binning into cells of that size means each node only checks the
  // 3×3 cell neighbourhood instead of all N others — turning the relaxation from O(N²) per pass
  // into O(N·neighbours), which keeps a scale-2/3 galaxy (150–225 systems) layout cheap. The grid
  // is rebuilt each pass because nodes move; rebuilding a Map of N entries is itself O(N).
  let maxR = 0;
  for (const e of list) if (e.r > maxR) maxR = e.r;
  const cell = Math.max(1e-3, maxR * 2 + GAP);
  const keyOf = (x: number, y: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;

  for (let iter = 0; iter < MAX_ITERS; iter++) {
    let moved = false;
    const grid = new Map<string, (typeof list)[number][]>();
    for (const e of list) {
      const k = keyOf(e.p.x, e.p.y);
      const bucket = grid.get(k);
      if (bucket) bucket.push(e);
      else grid.set(k, [e]);
    }
    for (const a of list) {
      const cx = Math.floor(a.p.x / cell);
      const cy = Math.floor(a.p.y / cell);
      // Gather the 3×3 neighbourhood and process by ascending index. Non-neighbour pairs are
      // always ≥ `cell` (= maxR·2 + GAP ≥ minD) apart, so they can't overlap and are skipped with
      // no effect — mirroring the original ascending i<j double loop's no-ops. The convergence
      // guarantee (iterate until no moves) is unchanged, so the final layout is fully separated.
      const candidates: (typeof list)[number][] = [];
      for (let gx = cx - 1; gx <= cx + 1; gx++) {
        for (let gy = cy - 1; gy <= cy + 1; gy++) {
          const bucket = grid.get(`${gx},${gy}`);
          if (!bucket) continue;
          for (const b of bucket) if (b.i > a.i) candidates.push(b);
        }
      }
      candidates.sort((m, n) => m.i - n.i);
      for (const b of candidates) {
        const minD = a.r + b.r + GAP;
        let dx = b.p.x - a.p.x;
        let dy = b.p.y - a.p.y;
        let dist = Math.hypot(dx, dy);
        if (dist >= minD) continue;
        if (dist < 1e-6) {
          // Coincident points — separate along a stable per-pair axis so it stays deterministic.
          const ang = (((a.i * 73856093) ^ (b.i * 19349663)) % 628) / 100;
          dx = Math.cos(ang);
          dy = Math.sin(ang);
          dist = 1;
        }
        const overlap = minD - dist;
        const ux = dx / dist;
        const uy = dy / dist;
        if (a.hub) {
          b.p.x += ux * overlap; b.p.y += uy * overlap;
        } else if (b.hub) {
          a.p.x -= ux * overlap; a.p.y -= uy * overlap;
        } else {
          const h = overlap / 2;
          a.p.x -= ux * h; a.p.y -= uy * h;
          b.p.x += ux * h; b.p.y += uy * h;
        }
        moved = true;
      }
    }
    if (!moved) break;
  }
}

/** Draw a system's luminous glyph; shape varies by region/archetype so worlds read distinctly. */
function drawGlyph(
  cont: Container,
  region: string,
  arch: string,
  r: number,
  fill: number,
  open: boolean,
  pal: Palette,
): void {
  const g = new Graphics();
  const coreAlpha = open ? 0.4 : 1;

  if (region === "hub") {
    g.circle(0, 0, r * 1.15).fill({ color: pal.accent, alpha: 0.25 });
    g.circle(0, 0, r).fill({ color: pal.accent, alpha: 1 });
    g.circle(0, 0, r * 0.45).fill({ color: 0xffffff, alpha: 0.9 });
  } else if (region === "frontier" || arch === "isotopes") {
    // Crystalline diamond for rare-isotope frontier worlds.
    g.poly([0, -r * 1.5, r * 1.1, 0, 0, r * 1.5, -r * 1.1, 0]).fill({ color: fill, alpha: coreAlpha });
    g.poly([0, -r * 0.7, r * 0.5, 0, 0, r * 0.7, -r * 0.5, 0]).fill({ color: 0xffffff, alpha: open ? 0.2 : 0.55 });
  } else if (region === "abyss") {
    // Sharp four-point star for antimatter abyss worlds.
    const o = r * 1.7;
    const i = r * 0.55;
    g.poly([0, -o, i, -i, o, 0, i, i, 0, o, -i, i, -o, 0, -i, -i]).fill({ color: fill, alpha: coreAlpha });
    g.circle(0, 0, r * 0.5).fill({ color: 0xffffff, alpha: 0.85 });
  } else {
    // Core basics: a clean luminous disc with a bright centre.
    g.circle(0, 0, r).fill({ color: fill, alpha: coreAlpha });
    if (!open) g.circle(0, 0, r * 0.42).fill({ color: 0xffffff, alpha: 0.6 });
  }
  if (open) g.circle(0, 0, r).stroke({ width: r * 0.12, color: fill, alpha: 0.8 });
  cont.addChild(g);
}

/** How built-up a claimed system is (Section 08): one development pip per population stage. */
const POP_RANK: Record<PopulationStage, number> = {
  outpost: 1,
  settlement: 2,
  colony: 3,
  city: 4,
  metropolis: 5,
};

function developmentTier(s: { populationStage: PopulationStage }): number {
  return POP_RANK[s.populationStage] ?? 1;
}

/** Every galaxy-map fleet-icon asset (`/assets/<slot>.png`), preloaded once per scene. */
const FLEET_ICON_SLOTS = [
  "fleeticon-trader",
  "fleeticon-freighter",
  "fleeticon-escort",
  "fleeticon-frigate",
  "fleeticon-cruiser",
  "fleeticon-capital",
  "fleeticon-raider",
  "fleeticon-survey",
];

/** Warship size band → icon by largest hull tier: escort (R1–2), frigate (R3–4), cruiser (R5–6), capital (R7–8). */
function warIconSlot(maxTier: number): string {
  if (maxTier >= 7) return "fleeticon-capital";
  if (maxTier >= 5) return "fleeticon-cruiser";
  if (maxTier >= 3) return "fleeticon-frigate";
  return "fleeticon-escort";
}

/** A transiting own fleet's icon: survey skiff / raider / warship-by-size, MoO-style flagship read. */
function transitIconSlot(kind: FleetKind, maxTier: number): string {
  return kind === "survey" ? "fleeticon-survey" : kind === "raid" ? "fleeticon-raider" : warIconSlot(maxTier);
}

/** A fogged rival contact's icon by rough force band (exact type never leaks — Section 04). */
function contactIconSlot(force: "light" | "medium" | "heavy"): string {
  return force === "heavy" ? "fleeticon-capital" : force === "medium" ? "fleeticon-frigate" : "fleeticon-escort";
}

/** Trade-convoy icon: a bulk freighter for high-value runs, a light trader otherwise. */
function convoyIconSlot(value: number): string {
  return value >= 1800 ? "fleeticon-freighter" : "fleeticon-trader";
}

/** Marker colour per own-fleet kind: war = theme accent, raid = amber, survey = cool cyan. */
function fleetKindColor(kind: FleetKind, pal: Palette): number {
  return kind === "raid" ? pal.warn : kind === "survey" ? pal.accent2 : pal.accent;
}

/**
 * The icon for an own fleet in transit, drawn pointing along travel (+x) so it reads at a glance:
 * a filled arrowhead for a line war fleet, a longer swept dagger for a raider strike, and a hollow
 * scan-diamond with a sensor boom + bright core for an unarmed survey skiff.
 */
function fleetGlyph(kind: FleetKind, unit: number, color: number, ink: number): Graphics {
  const g = new Graphics();
  if (kind === "raid") {
    const s = unit * 1.15;
    g.poly([s * 1.35, 0, -s * 0.45, s * 0.62, -s * 0.85, 0, -s * 0.45, -s * 0.62]).fill({ color, alpha: 0.95 });
    g.stroke({ width: unit * 0.26, color: ink, alpha: 0.7 });
  } else if (kind === "survey") {
    const s = unit * 1.0;
    g.poly([s, 0, 0, s * 0.82, -s, 0, 0, -s * 0.82]).stroke({ width: unit * 0.32, color, alpha: 0.95 });
    g.moveTo(-s * 1.5, 0).lineTo(-s * 0.95, 0).stroke({ width: unit * 0.22, color, alpha: 0.7 });
    g.circle(0, 0, unit * 0.34).fill({ color, alpha: 1 });
  } else {
    const s = unit * 1.1;
    g.poly([s, 0, -s * 0.7, s * 0.75, -s * 0.7, -s * 0.75]).fill({ color, alpha: 0.92 });
    g.stroke({ width: unit * 0.28, color: ink, alpha: 0.7 });
  }
  return g;
}

/** Shortest distance from a point to a line segment (world space), for lane hit testing. */
function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-6) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Emulated dashed line (Pixi v8 Graphics has no native dash) for uncharted scan traces. */
function drawDashed(
  g: Graphics,
  a: { x: number; y: number },
  b: { x: number; y: number },
  dash: number,
  gap: number,
  width: number,
  color: number,
  alpha: number,
): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 0.001) return;
  const ux = dx / len;
  const uy = dy / len;
  let d = 0;
  while (d < len) {
    const e = Math.min(len, d + dash);
    g.moveTo(a.x + ux * d, a.y + uy * d).lineTo(a.x + ux * e, a.y + uy * e);
    d += dash + gap;
  }
  g.stroke({ width, color, alpha, cap: "round" });
}

// ---------------------------------------------------------------------------
// Palette (read from the active theme's CSS variables)
// ---------------------------------------------------------------------------

interface Palette {
  bg: number;
  accent: number;
  accent2: number;
  ink: number;
  inkDim: number;
  faint: number;
  warn: number;
  negative: number;
  rival: number;
}

function readPalette(el: HTMLElement): Palette {
  const cs = getComputedStyle(el);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return {
    bg: cssNum(v("--bg", "#07080c")),
    accent: cssNum(v("--accent", "#ffb000")),
    accent2: cssNum(v("--accent-2", "#56d4ff")),
    ink: cssNum(v("--ink", "#f4ede0")),
    inkDim: cssNum(v("--ink-dim", "#b8b0a0")),
    faint: cssNum(v("--ink-faint", "#8a857a")),
    warn: cssNum(v("--warn", "#ffc14d")),
    negative: cssNum(v("--negative", "#ff6b6b")),
    rival: cssNum("#ff6f9c"),
  };
}

/** Parse a CSS color string (#hex / #rgb / rgb()/rgba()) to a 0xRRGGBB number. */
function cssNum(str: string): number {
  const s = str.trim();
  if (s.startsWith("#")) {
    let h = s.slice(1);
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    if (h.length === 8) h = h.slice(0, 6);
    const n = Number.parseInt(h, 16);
    return Number.isFinite(n) ? n : 0xffffff;
  }
  const m = s.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const parts = m[1]!.split(",").map((x) => parseFloat(x));
    const [r, g, b] = parts;
    return ((clamp255(r) << 16) | (clamp255(g) << 8) | clamp255(b)) >>> 0;
  }
  return 0xffffff;
}

function clamp255(v: number | undefined): number {
  return Math.max(0, Math.min(255, Math.round(v ?? 0)));
}

// Small, fast deterministic RNG for the starfield/nebula (stable per galaxy signature).
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSignature(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
