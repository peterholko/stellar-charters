import type { ReactNode } from "react";

/**
 * Procedural vector glyphs for art slots that don't yet have a commissioned PNG (Section 24/27/28:
 * colony buildings, research divisions, secret projects). `ArtSlot` tries `/assets/<slot>.png`
 * first and only falls back to these — so when real art is dropped in it transparently takes over.
 * Until then the buildings / research / colony screens read as finished iconography instead of a
 * "missing art" debug badge. Everything is theme-tinted via currentColor + the --accent token.
 */

const DIVISION_BY_PREFIX: Record<string, string> = {
  pro: "prospectus",
  fab: "fabrication",
  nav: "navigation",
  col: "colonial",
  sec: "security",
  acq: "acquisitions",
};

/** 24×24 line glyphs (fill:none stroke:currentColor unless a path opts into fill). */
const GLYPHS: Record<string, ReactNode> = {
  // ---- colony buildings (Section 24/27) ----
  factory: (
    <>
      <path d="M2 21h20M4 21V10l5 3V10l5 3V10l5 3v8" />
      <path d="M16.5 7.5V4h2.5v3.5" />
    </>
  ),
  reactor: (
    <>
      <path d="M5 21h14M7 21l1.8-8h6.4L17 21" />
      <circle cx="12" cy="9.5" r="3.2" />
      <circle cx="12" cy="9.5" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  agridome: (
    <>
      <path d="M3 20.5h18" />
      <path d="M5 20.5a7 7 0 0 1 14 0" />
      <path d="M12 20.5v-6" />
      <path d="M12 14.5c0-2.2 2-3.4 3.4-3.4 0 2.2-2 3.4-3.4 3.4Z" fill="currentColor" stroke="none" />
      <path d="M12 15.5c0-2-2-3-3.2-3 0 2 2 3 3.2 3Z" fill="currentColor" stroke="none" />
    </>
  ),
  miningrig: (
    <>
      <path d="M5 21h14" />
      <path d="M8 21V8.5h8V21" />
      <path d="M9.5 8.5 12 3l2.5 5.5" />
      <path d="M10 13h4l-2 4z" fill="currentColor" stroke="none" />
    </>
  ),
  habitat: (
    <>
      <path d="M3 20.5h18" />
      <path d="M4 20.5a8 8 0 0 1 16 0" />
      <path d="M5.5 16h13M12 12.5v8M9 20.5v-4.5h6v4.5" />
    </>
  ),
  powergrid: (
    <>
      <path d="M13 2 4 14h6l-1 8 9-12h-6z" fill="currentColor" stroke="none" />
    </>
  ),
  lab: (
    <>
      <path d="M9 3h6M10 3v6.2l-4.6 8.3A2 2 0 0 0 7.2 21h9.6a2 2 0 0 0 1.8-3.5L14 9.2V3" />
      <path d="M8.2 15.5h7.6" />
    </>
  ),

  // ---- research divisions (Section 28) — also reused by secret-<prefix>-* capstones ----
  prospectus: (
    <>
      <circle cx="10" cy="10" r="6" />
      <path d="m14.4 14.4 5.6 5.6" />
      <circle cx="8.8" cy="11" r="1" fill="currentColor" stroke="none" />
      <circle cx="11.4" cy="8.8" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  fabrication: (
    <>
      <path d="M12 2.5l1.4 2.4 2.7-.5.3 2.8 2.6 1-1.3 2.4 1.3 2.4-2.6 1-.3 2.8-2.7-.5L12 21.5l-1.4-2.4-2.7.5-.3-2.8-2.6-1 1.3-2.4-1.3-2.4 2.6-1 .3-2.8 2.7.5z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  navigation: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M15.5 8.5 11 13l-2.5 2.5L13 11z" fill="currentColor" stroke="none" />
    </>
  ),
  colonial: (
    <>
      <circle cx="11" cy="11" r="6" />
      <ellipse cx="11" cy="11" rx="11" ry="3.4" transform="rotate(-22 11 11)" />
    </>
  ),
  security: (
    <>
      <path d="M12 2.5l8 2.8v5.7c0 5-3.6 8-8 10.5-4.4-2.5-8-5.5-8-10.5V5.3z" />
      <path d="M8.5 12l2.3 2.3 4.5-4.6" />
    </>
  ),
  acquisitions: (
    <>
      <rect x="3" y="7.5" width="18" height="12.5" rx="2" />
      <path d="M8.5 7.5V6a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v1.5" />
      <path d="M3 12.5h18" />
    </>
  ),
};

export interface SlotGlyph {
  node: ReactNode;
  /** Domain id used to tint the tile (factory/lab/security/…). */
  domain: string;
  /** A galaxy-unique secret-project capstone — rendered with the prestige treatment + star. */
  secret: boolean;
}

/** Resolve a slot id to a procedural glyph, or null if the slot has no procedural fallback. */
export function slotGlyph(slot: string): SlotGlyph | null {
  let domain: string | undefined;
  let secret = false;
  if (slot.startsWith("building-")) domain = slot.slice("building-".length);
  else if (slot.startsWith("research-")) domain = slot.slice("research-".length);
  else if (slot.startsWith("secret-")) {
    secret = true;
    domain = DIVISION_BY_PREFIX[slot.slice("secret-".length).split("-")[0]!];
  }
  if (!domain) return null;
  const node = GLYPHS[domain];
  if (!node) return null;
  return { node, domain, secret };
}

/** The themed placeholder tile content for a glyph slot (icon + optional secret star). */
export function SlotGlyphTile({ glyph }: { glyph: SlotGlyph }) {
  return (
    <>
      <svg className="slotglyph__svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {glyph.node}
      </svg>
      {glyph.secret && (
        <svg className="slotglyph__star" viewBox="0 0 24 24" aria-hidden>
          <path d="M12 3l2.2 5.5L20 9.3l-4 4.2 1 5.8-5-2.9-5 2.9 1-5.8-4-4.2 5.8-.8z" fill="currentColor" stroke="none" />
        </svg>
      )}
    </>
  );
}
