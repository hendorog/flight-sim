// The job board's map (docs/career.md "Job board"): north up, the nine fields as dots with their codes, the field
// the aircraft stands at ringed, the highlighted offer's route (a line with an arrow to the destination, or a
// scenic loop through its numbered turning points), the job's wind and a scale bar in NM. Drawn as an inline SVG
// string, so it scales crisply with the card and renders in node tests; the projection is exported pure
// (mapBounds, project) so the tests can prove it is north-up and that every point lands inside the frame.

import { NM } from '../../core/math';
import type { Airfield } from '../../world/airfields';
import type { JobOffer } from '../types';
import { wind } from './format';

/** The map's drawing width in SVG units (its viewBox; CSS scales it to the card). */
export const MAP_W = 420;
/** The map's drawing height in SVG units. */
export const MAP_H = 380;
/** Margin inside the frame, SVG units (room for the codes beside the dots and the scale bar). */
const MARGIN = 34;

/** A north-east box in NED metres. */
export interface MapBounds {
  minN: number;
  maxN: number;
  minE: number;
  maxE: number;
}

/** The box around the fields and any extra points (scenic turning points), m; never smaller than 10 km a side. */
export function mapBounds(fields: readonly Airfield[], extra: readonly { north: number; east: number }[] = []): MapBounds {
  const pts = [...fields, ...extra];
  let b: MapBounds = { minN: Infinity, maxN: -Infinity, minE: Infinity, maxE: -Infinity };
  for (const p of pts) b = { minN: Math.min(b.minN, p.north), maxN: Math.max(b.maxN, p.north), minE: Math.min(b.minE, p.east), maxE: Math.max(b.maxE, p.east) };
  if (!Number.isFinite(b.minN)) b = { minN: -5000, maxN: 5000, minE: -5000, maxE: 5000 };
  const grow = (lo: number, hi: number): [number, number] => {
    const span = hi - lo;
    return span >= 10000 ? [lo, hi] : [lo - (10000 - span) / 2, hi + (10000 - span) / 2];
  };
  const [minN, maxN] = grow(b.minN, b.maxN);
  const [minE, maxE] = grow(b.minE, b.maxE);
  return { minN, maxN, minE, maxE };
}

/** Metres per SVG unit for a box fitted (one scale both ways) into a w x h frame with the margin. */
export function mapScale(b: MapBounds, w = MAP_W, h = MAP_H): number {
  return Math.max((b.maxE - b.minE) / (w - 2 * MARGIN), (b.maxN - b.minN) / (h - 2 * MARGIN));
}

/** A NED point (m) to SVG coordinates [x right, y down]: north up, east right, the box centred in the frame. */
export function project(b: MapBounds, north: number, east: number, w = MAP_W, h = MAP_H): [number, number] {
  const s = mapScale(b, w, h);
  const cn = (b.minN + b.maxN) / 2;
  const ce = (b.minE + b.maxE) / 2;
  return [w / 2 + (east - ce) / s, h / 2 - (north - cn) / s];
}

/** A tidy scale-bar length near a fifth of the frame, NM (1, 2, 5, 10, 20...). */
export function scaleBarNm(metresPerUnit: number, w = MAP_W): number {
  const target = (w / 5) * metresPerUnit / NM;
  const steps = [1, 2, 5, 10, 20, 50, 100];
  return steps.reduce((best, s) => (Math.abs(s - target) < Math.abs(best - target) ? s : best), steps[0]);
}

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const f1 = (n: number): string => n.toFixed(1);

/**
 * The map's SVG markup for the world's fields, the field `here` (ringed) and the highlighted offer (or null).
 * Colours are the shell's tokens via CSS classes (styles.ts `.cr-map ...`).
 */
export function boardMapSvg(fields: readonly Airfield[], here: string | null, offer: JobOffer | null): string {
  const wps = offer?.waypoints ?? [];
  const b = mapBounds(fields, wps);
  const s = mapScale(b);
  const at = (n: number, e: number): [number, number] => project(b, n, e);
  const parts: string[] = [];
  parts.push(`<svg class="cr-map-svg" viewBox="0 0 ${MAP_W} ${MAP_H}" role="img" aria-label="Map of the airfields">`);
  parts.push('<defs><marker id="cr-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">'
    + '<path d="M0 0 L10 5 L0 10 Z" class="cr-map-arrowhead"/></marker></defs>');
  parts.push(`<rect class="cr-map-bg" x="0" y="0" width="${MAP_W}" height="${MAP_H}" rx="10"/>`);
  // A faint 10 km grid, as on a chart.
  const grid = 10000;
  for (let e = Math.ceil(b.minE / grid) * grid - grid * 3; e <= b.maxE + grid * 3; e += grid) {
    const [x] = at(0, e);
    if (x > 0 && x < MAP_W) parts.push(`<line class="cr-map-grid" x1="${f1(x)}" y1="0" x2="${f1(x)}" y2="${MAP_H}"/>`);
  }
  for (let n = Math.ceil(b.minN / grid) * grid - grid * 3; n <= b.maxN + grid * 3; n += grid) {
    const [, y] = at(n, 0);
    if (y > 0 && y < MAP_H) parts.push(`<line class="cr-map-grid" x1="0" y1="${f1(y)}" x2="${MAP_W}" y2="${f1(y)}"/>`);
  }

  // The route under the dots.
  const origin = offer ? fields.find((f) => f.code === offer.origin) : undefined;
  if (offer && origin) {
    if (wps.length > 0) {
      const pts = [origin, ...wps, origin].map((p) => at(p.north, p.east));
      parts.push(`<polyline class="cr-map-route" points="${pts.map(([x, y]) => `${f1(x)},${f1(y)}`).join(' ')}"/>`);
      wps.forEach((w, i) => {
        const [x, y] = at(w.north, w.east);
        const r = Math.max(5, w.radiusM / s);
        parts.push(`<circle class="cr-map-wpring" cx="${f1(x)}" cy="${f1(y)}" r="${f1(r)}"/>`);
        parts.push(`<circle class="cr-map-wp" cx="${f1(x)}" cy="${f1(y)}" r="8"/><text class="cr-map-wpnum" x="${f1(x)}" y="${f1(y + 3.5)}">${i + 1}</text>`);
      });
    } else if (offer.destination.kind === 'field') {
      const destCode = offer.destination.code;
      const dest = fields.find((f) => f.code === destCode);
      if (dest) {
        const [x1, y1] = at(origin.north, origin.east);
        const [x2, y2] = at(dest.north, dest.east);
        // Stop short of the dots so the arrow head is not hidden under the destination's.
        const d = Math.hypot(x2 - x1, y2 - y1) || 1;
        const k = 9 / d;
        parts.push(`<line class="cr-map-route" x1="${f1(x1 + (x2 - x1) * k)}" y1="${f1(y1 + (y2 - y1) * k)}" x2="${f1(x2 - (x2 - x1) * k)}" y2="${f1(y2 - (y2 - y1) * k)}" marker-end="url(#cr-arrow)"/>`);
      }
    }
  }

  const destCode = offer?.destination.kind === 'field' ? offer.destination.code : null;
  for (const f of fields) {
    const [x, y] = at(f.north, f.east);
    const role = f.code === here ? ' here' : f.code === destCode ? ' dest' : '';
    const kind = f.kind === 'home' ? ' home' : f.kind === 'grass' ? ' grass' : '';
    // A runway bar along the field's heading, then the dot and its code.
    const len = Math.max(7, f.length / s);
    const dx = (Math.sin(f.heading) * len) / 2;
    const dy = (-Math.cos(f.heading) * len) / 2;
    parts.push(`<line class="cr-map-rwy${kind}" x1="${f1(x - dx)}" y1="${f1(y - dy)}" x2="${f1(x + dx)}" y2="${f1(y + dy)}"/>`);
    if (role === ' here') parts.push(`<circle class="cr-map-here" cx="${f1(x)}" cy="${f1(y)}" r="11"/>`);
    parts.push(`<circle class="cr-map-dot${kind}${role}" cx="${f1(x)}" cy="${f1(y)}" r="${f.kind === 'home' ? 5 : 4}"/>`);
    // Codes sit right of the dot unless that runs off the frame.
    const left = x > MAP_W - 60;
    parts.push(`<text class="cr-map-code${role}" x="${f1(left ? x - 10 : x + 10)}" y="${f1(y + 4)}" text-anchor="${left ? 'end' : 'start'}">${esc(f.code)}</text>`);
  }

  // North arrow, scale bar, wind.
  parts.push('<g class="cr-map-north"><path d="M22 34 L28 16 L34 34 L28 29 Z"/><text x="28" y="13">N</text></g>');
  const barNm = scaleBarNm(s);
  const barLen = (barNm * NM) / s;
  const by = MAP_H - 16;
  parts.push(`<g class="cr-map-scale"><path d="M16 ${by - 5} V${by} H${f1(16 + barLen)} V${by - 5}"/><text x="${f1(16 + barLen + 6)}" y="${by + 1}">${barNm} NM</text></g>`);
  if (offer) {
    // The arrow points the way the wind blows (from windDirDeg towards the opposite side).
    const cx = MAP_W - 30;
    const cy = 30;
    const rad = ((offer.windDirDeg + 180) * Math.PI) / 180;
    const ux = Math.sin(rad);
    const uy = -Math.cos(rad);
    const calm = offer.windKt < 1;
    parts.push(`<g class="cr-map-wind"><circle cx="${cx}" cy="${cy}" r="16"/>`
      + (calm ? '' : `<line x1="${f1(cx - ux * 11)}" y1="${f1(cy - uy * 11)}" x2="${f1(cx + ux * 9)}" y2="${f1(cy + uy * 9)}" marker-end="url(#cr-arrow)"/>`)
      + `<text x="${cx}" y="${cy + 30}" text-anchor="middle">${esc(wind(offer.windDirDeg, offer.windKt))}</text></g>`);
  }
  parts.push('</svg>');
  return parts.join('');
}
