import type { Galaxy } from "@engine";

export interface Pt {
  x: number;
  y: number;
}

/**
 * Deterministic radial layout for the galaxy map (the scenario carries no coordinates).
 * Hub at the centre, inner-ring systems on a circle in id order, frontier systems pushed
 * outward from the inner system they hang off. Coordinates are in a 0..100 viewBox.
 */
export function computeLayout(galaxy: Galaxy): Map<string, Pt> {
  const pts = new Map<string, Pt>();
  const all = galaxy.allSystems();
  const hubId = galaxy.hubId;
  pts.set(hubId, { x: 50, y: 50 });

  const inner = all
    .filter((s) => s.id !== hubId && /^s\d+$/.test(s.id))
    .sort((a, b) => numId(a.id) - numId(b.id));
  const frontier = all.filter((s) => s.id !== hubId && !/^s\d+$/.test(s.id));

  const R = 33;
  inner.forEach((s, i) => {
    const angle = (Math.PI * 2 * i) / Math.max(1, inner.length) - Math.PI / 2;
    pts.set(s.id, { x: 50 + Math.cos(angle) * R, y: 50 + Math.sin(angle) * R });
  });

  // Anchor each frontier system to the inner system it shares a route with.
  for (const f of frontier) {
    const anchorId = findAnchor(galaxy, f.id, inner.map((s) => s.id));
    const anchor = (anchorId && pts.get(anchorId)) || { x: 50, y: 50 };
    const dx = anchor.x - 50;
    const dy = anchor.y - 50;
    const len = Math.max(1, Math.hypot(dx, dy));
    pts.set(f.id, { x: anchor.x + (dx / len) * 16, y: anchor.y + (dy / len) * 16 });
  }

  return pts;
}

function numId(id: string): number {
  const n = Number.parseInt(id.replace(/\D/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

function findAnchor(galaxy: Galaxy, frontierId: string, innerIds: string[]): string | undefined {
  for (const r of galaxy.routes.values()) {
    if (r.a === frontierId && innerIds.includes(r.b)) return r.b;
    if (r.b === frontierId && innerIds.includes(r.a)) return r.a;
  }
  return undefined;
}
