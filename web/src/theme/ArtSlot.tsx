import { useState, type CSSProperties } from "react";
import { artManifest } from "./artManifest";
import type { SystemArchetype } from "../match/format";

/**
 * A themed placeholder for generated art. It first tries `/assets/<slot>.png`; if that
 * asset hasn't been generated yet it falls back to a labelled procedural placeholder, so
 * the layout is always intact and every slot announces what art belongs there.
 */
export function ArtSlot({
  slot,
  className,
  style,
}: {
  slot: string;
  className?: string;
  style?: CSSProperties;
}) {
  const [failed, setFailed] = useState(false);
  const meta = artManifest[slot];
  if (!failed) {
    return (
      <img
        className={`artslot-img ${className ?? ""}`}
        style={style}
        src={`/assets/${slot}.png`}
        alt={meta?.label ?? slot}
        loading="lazy"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <div className={`artslot ${className ?? ""}`} style={style} role="img" aria-label={meta?.label ?? slot}>
      <span className="artslot__grid" aria-hidden />
      <span className="artslot__label">{meta?.label ?? slot}</span>
      <span className="artslot__tag" aria-hidden>
        ART
      </span>
    </div>
  );
}

const archetypeGradient: Record<SystemArchetype, string> = {
  ice: "radial-gradient(circle at 35% 30%, #d6f3ff, #7fd4f5 38%, #2a6c8c 72%, #0c2433)",
  metals: "radial-gradient(circle at 35% 30%, #efe9dc, #c3bcae 40%, #6c6457 74%, #2a2620)",
  helium3: "radial-gradient(circle at 35% 30%, #ffe6a8, #f0c468 42%, #b07c2c 75%, #3c2a10)",
  isotopes: "radial-gradient(circle at 35% 30%, #efd9ff, #c79bff 40%, #6f43b0 74%, #271436)",
  garden: "radial-gradient(circle at 35% 30%, #cdf6d6, #86e0a0 42%, #2f8f57 74%, #103021)",
  hub: "radial-gradient(circle at 50% 50%, #fff6df, #f3d489 30%, #56d4ff 60%, #0a1830 90%)",
};

/**
 * Archetypes that have a commissioned `/assets/system-<archetype>.png` portrait. Any
 * archetype not listed falls straight through to the procedural gradient disc (no wasted
 * 404 request). The hub uses the dedicated `hero-wormhole-hub` slot, not PlanetArt.
 */
const SYSTEM_PORTRAITS = new Set<SystemArchetype>(["metals", "garden", "ice", "helium3", "isotopes"]);

/**
 * Star-system portrait. Renders the painted portrait at `/assets/system-<archetype>.png`
 * when one exists, falling back to a themed procedural gradient disc otherwise.
 */
export function PlanetArt({
  archetype,
  className,
  style,
}: {
  archetype: SystemArchetype;
  className?: string;
  style?: CSSProperties;
}) {
  const [failed, setFailed] = useState(false);
  if (SYSTEM_PORTRAITS.has(archetype) && !failed) {
    return (
      <img
        className={`planet-art planet-art--img ${className ?? ""}`}
        style={style}
        src={`/assets/system-${archetype}.png`}
        alt={`${archetype} system`}
        loading="lazy"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <span
      className={`planet-art ${className ?? ""}`}
      style={{ background: archetypeGradient[archetype], ...style }}
      role="img"
      aria-label={`${archetype} system`}
    />
  );
}
