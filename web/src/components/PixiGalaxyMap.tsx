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
import { Application, Container, Graphics, Text } from "pixi.js";
import type { PlayerView } from "@engine";
import { computeLayout } from "../match/layout";
import {
  corpColor,
  resourceColors,
  routeRisk,
  starTypeColor,
  systemArchetype,
  systemDominant,
} from "../match/format";
import type { Selection } from "../match/store";

interface Props {
  view: PlayerView;
  humanCorpId: string;
  selection: Selection;
  onSelect: (sel: Selection) => void;
}

type SceneProps = Props;

interface Scene {
  draw: () => void;
  destroy: () => void;
}

export function PixiGalaxyMap({ view, humanCorpId, selection, onSelect }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<Scene | null>(null);
  const propsRef = useRef<SceneProps>({ view, humanCorpId, selection, onSelect });
  // Keep the latest props reachable from Pixi event handlers / the ticker without
  // re-creating the scene. Assigned on every render so `onSelect` is never stale.
  propsRef.current = { view, humanCorpId, selection, onSelect };

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
  }, [view, selection, humanCorpId]);

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
    lanes: new Container(),
    traffic: new Container(),
    convoys: new Container(),
    systems: new Container(),
    rings: new Container(),
  };
  layers.nebula.blendMode = "add";
  layers.starfield.blendMode = "add";
  layers.traffic.blendMode = "add";
  world.addChild(
    layers.nebula,
    layers.starfield,
    layers.lanes,
    layers.traffic,
    layers.convoys,
    layers.systems,
    layers.rings,
  );

  // Labels live in screen space (constant pixel size) and are reprojected on camera moves.
  const labelLayer = new Container();
  app.stage.addChild(labelLayer);

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
    return Math.min(fitZoom * 6, Math.max(fitZoom * 0.4, z));
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
      if (sel) getProps().onSelect(sel);
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
  };

  // Unified pick: returns the Selection under a canvas-local point, testing convoys, then
  // systems, then lanes (matching the visual stacking order). Pure world-space geometry, so
  // it is independent of Pixi's event system and behaves the same for mouse and touch.
  function pickAt(lx: number, ly: number): Selection {
    const { view } = getProps();
    const galaxy = view.galaxy;
    const wx = (lx - camera.x) / camera.zoom;
    const wy = (ly - camera.y) / camera.zoom;

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

  // ----- animation -----
  let elapsed = 0;
  const tick = (ticker: { deltaMS: number }) => {
    elapsed += ticker.deltaMS / 1000;
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
    const { view, humanCorpId, selection } = getProps();
    const galaxy = view.galaxy;
    const pal = readPalette(host);

    // (Re)compute geometry only when the system set / layout changes (new game, etc.).
    const sys = galaxy.allSystems();
    const sig = sys.map((s) => `${s.id}:${s.position ? `${s.position.x},${s.position.y}` : "?"}`).join("|");
    if (sig !== signature) {
      signature = sig;
      points = layoutPoints(galaxy);
      bounds = computeBounds(points);
      unit = Math.max(1, Math.hypot(bounds.w, bounds.h) / 125);
      resizeBg();
      rebuildBackground(pal);
      fitCamera();
    }

    const turn = view.turn;
    const pt = (id: string) => points.get(id) ?? { x: 0, y: 0 };

    // Reset dynamic layers.
    for (const c of [layers.lanes, layers.traffic, layers.convoys, layers.systems, layers.rings]) {
      c.removeChildren().forEach((ch) => ch.destroy());
    }
    labelLayer.removeChildren().forEach((ch) => ch.destroy());
    pulses = [];
    halos = [];
    selRing = null;
    hubGlow = null;
    labels = [];

    // ----- warp lanes -----
    for (const r of galaxy.routes.values()) {
      const a = pt(r.a);
      const b = pt(r.b);
      const risk = routeRisk(r);
      const selected = selection?.kind === "route" && selection.id === r.id;
      const traffic = galaxy.recentTraffic(r.id, turn);
      const g = new Graphics();

      if (!r.charted) {
        drawDashed(g, a, b, unit * 1.4, unit * 1.4, unit * 0.45, pal.faint, 0.5);
      } else {
        const color =
          risk.level === "severe" ? pal.negative : risk.level === "high" ? pal.warn : pal.accent2;
        const baseAlpha = risk.level === "guarded" ? 0.35 : 0.5;
        const width = unit * (0.3 + Math.min(1.1, traffic * 0.22));
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
      cont.rotation = angle;
      const halo = new Graphics();
      halo.circle(0, 0, unit * 1.6).fill({ color, alpha: 0.22 });
      halo.blendMode = "add";
      cont.addChild(halo);
      halos.push({ g: halo, base: unit * 1.6 });
      const body = new Graphics();
      const s = unit * 1.15;
      body.poly([s, 0, -s * 0.8, s * 0.8, -s * 0.3, 0, -s * 0.8, -s * 0.8]).fill({ color, alpha: 1 });
      if (selected) body.stroke({ width: unit * 0.35, color: pal.ink, alpha: 0.9 });
      cont.addChild(body);

      layers.convoys.addChild(cont);
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
      // Star-type aura (Section 21): a faint additive ring in the star's colour so a red giant,
      // white dwarf, neutron star, etc. read distinctly at a glance without changing the
      // resource/owner-coloured core.
      if (!isHub && s.bodies?.starType) {
        const starGlow = new Graphics();
        starGlow.circle(0, 0, r * 1.55).stroke({ width: unit * 0.45, color: cssNum(starTypeColor[s.bodies.starType]), alpha: 0.5 });
        starGlow.blendMode = "add";
        cont.addChild(starGlow);
      }
      drawGlyph(cont, region, arch, r, fill, open, pal);

      if (mine && !isHub) {
        const ownRing = new Graphics();
        ownRing.circle(0, 0, r * 1.7).stroke({ width: unit * 0.4, color: pal.accent, alpha: 0.85 });
        cont.addChild(ownRing);
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
          fontSize: 11,
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

    applyCamera();
  }

  return {
    draw,
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

function layoutPoints(galaxy: PlayerView["galaxy"]): Map<string, { x: number; y: number }> {
  const all = galaxy.allSystems();
  const hasPositions = all.every((s) => s.position);
  if (hasPositions) {
    const m = new Map<string, { x: number; y: number }>();
    for (const s of all) m.set(s.id, { x: s.position!.x, y: s.position!.y });
    return m;
  }
  // Legacy scenarios carry no coordinates — fall back to the radial layout (0..100 space).
  return computeLayout(galaxy);
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
