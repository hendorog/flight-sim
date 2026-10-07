// Layout check of a panel definition: every component and click hotspot inside the part of the canvas the
// cockpit shows, no two components sharing canvas, nothing in a keep-out circle. Pure (no DOM): the panel
// warns with it when it is built, and the per-type tests assert it returns nothing.

import { buildHotspots, type PanelHotspot } from './hotspots';
import type { PanelDef, Rect } from './panelDef';
import { panelParts, type PanelPart } from './panelParts';

const inside = (r: Rect, outer: Rect): boolean => r.x >= outer.x && r.y >= outer.y && r.x + r.w <= outer.x + outer.w && r.y + r.h <= outer.y + outer.h;
const overlap = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const rectText = (r: Rect): string => `x ${r.x}..${r.x + r.w}, y ${r.y}..${r.y + r.h}`;

/** Distance from a point to a rectangle (0 inside it). */
function rectDistance(r: Rect, x: number, y: number): number {
  return Math.hypot(Math.max(r.x - x, 0, x - (r.x + r.w)), Math.max(r.y - y, 0, y - (r.y + r.h)));
}

/** Whether the bodies of two parts share canvas: the flanges of round instruments, else their rectangles. */
function partsCollide(a: PanelPart, b: PanelPart): boolean {
  if (!overlap(a.rect, b.rect)) return false;
  if (a.round && b.round) return Math.hypot(a.round.x - b.round.x, a.round.y - b.round.y) < a.round.r + b.round.r;
  if (a.round) return rectDistance(b.rect, a.round.x, a.round.y) < a.round.r;
  if (b.round) return rectDistance(a.rect, b.round.x, b.round.y) < b.round.r;
  return true;
}

const hotspotRect = (h: PanelHotspot): Rect => ({ x: h.x - h.hw, y: h.y - h.hh, w: 2 * h.hw, h: 2 * h.hh });

/**
 * What is wrong with the layout of a panel, one line per finding; empty when it is sound.
 *  - a component or a hotspot outside `pxRect` (the part of the canvas on the cockpit's panel face; default: all of it);
 *  - two components whose bodies overlap (each owns its canvas: an overlapped one is painted over when the other redraws);
 *  - a component or a hotspot reaching into a keep-out circle (a yoke boot stands in front of it);
 *  - a hotspot whose centre lies inside another one's box (a click on it operates the other).
 */
export function panelLayoutProblems(def: PanelDef, pxRect?: Rect, hotspots: readonly PanelHotspot[] = buildHotspots(def)): string[] {
  const face = pxRect ?? { x: 0, y: 0, w: def.size.w, h: def.size.h };
  const problems: string[] = [];
  const parts = panelParts(def);
  parts.forEach((p, i) => {
    if (!inside(p.rect, face)) problems.push(`'${p.id}' (${rectText(p.rect)}) lies outside the panel face (${rectText(face)})`);
    for (let j = 0; j < i; j++) if (partsCollide(parts[j], p)) problems.push(`'${p.id}' overlaps '${parts[j].id}'`);
    for (const k of def.keepOut) {
      let reach: number;
      if (p.round) reach = Math.hypot(p.round.x - k.x, p.round.y - k.y) - p.round.r;
      else if (p.solid) reach = Math.min(Infinity, ...p.solid.map((r) => rectDistance(r, k.x, k.y)));
      else reach = rectDistance(p.rect, k.x, k.y);
      if (reach < k.r) problems.push(`'${p.id}' reaches into the keep-out circle at (${k.x}, ${k.y})`);
    }
  });
  hotspots.forEach((h, i) => {
    const box = hotspotRect(h);
    if (!inside(box, face)) problems.push(`hotspot '${h.id}' (${rectText(box)}) lies outside the panel face (${rectText(face)})`);
    for (const k of def.keepOut) if (rectDistance(box, k.x, k.y) < k.r) problems.push(`hotspot '${h.id}' reaches into the keep-out circle at (${k.x}, ${k.y})`);
    // hotspotAt() answers with the first hotspot of the list under the pointer.
    for (let j = 0; j < i; j++) {
      const other = hotspots[j];
      if (Math.abs(h.x - other.x) <= other.hw && Math.abs(h.y - other.y) <= other.hh) problems.push(`hotspot '${h.id}' is covered by hotspot '${other.id}'`);
    }
  });
  return problems;
}
