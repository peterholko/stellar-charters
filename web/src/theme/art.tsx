import { useState, type CSSProperties } from "react";
import type { Resource } from "@engine";
import { resourceColors, resourceLabels, corpColor } from "../match/format";

/** seat index parsed from a corp id like "corp-3" (matches `corpColor`). */
function seatIndex(corpId: string): number {
  const n = Number.parseInt(corpId.replace(/\D/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Commodity icon. Renders the painted resource icon from `/assets/resource-<key>.png`,
 * falling back to the themed colour dot if no art exists for that resource (e.g. antimatter).
 */
export function ResourceIcon({
  resource,
  size = 18,
  className,
}: {
  resource: Resource;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const label = resourceLabels[resource] ?? resource;
  if (failed) {
    return (
      <span
        className={`res-dot ${className ?? ""}`}
        title={label}
        aria-label={label}
        style={{ width: Math.round(size * 0.5), height: Math.round(size * 0.5), background: resourceColors[resource] ?? "var(--ink-faint)" }}
      />
    );
  }
  return (
    <img
      className={`res-icon ${className ?? ""}`}
      src={`/assets/resource-${resource}.png`}
      alt={label}
      title={label}
      width={size}
      height={size}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

/**
 * Chartered-corporation crest. Renders `/assets/corp-crest-<seat>.png` (crests 0–7 ship for all
 * eight seats), falling back to the seat colour dot if a crest asset is ever missing.
 */
export function CorpCrest({
  corpId,
  size = 18,
  className,
  style,
}: {
  corpId: string;
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span
        className={`corp-dot ${className ?? ""}`}
        style={{ width: Math.round(size * 0.55), height: Math.round(size * 0.55), background: corpColor(corpId), ...style }}
      />
    );
  }
  return (
    <img
      className={`corp-crest ${className ?? ""}`}
      src={`/assets/corp-crest-${seatIndex(corpId)}.png`}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      onError={() => setFailed(true)}
      style={style}
    />
  );
}
