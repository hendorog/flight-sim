// Seven-segment display lettering for the radios, transponder and the LCD clock.

import type { Ctx2D } from './canvas';

// Segment bits: a=1 (top), b=2 (top right), c=4 (bottom right), d=8 (bottom), e=16 (bottom left),
// f=32 (top left), g=64 (middle).
const GLYPHS: Record<string, number> = {
  '0': 63, '1': 6, '2': 91, '3': 79, '4': 102, '5': 109, '6': 125, '7': 7, '8': 127, '9': 111,
  '-': 64, ' ': 0, A: 119, b: 124, C: 57, c: 88, d: 94, E: 121, F: 113, H: 118, L: 56, n: 84, o: 92,
  P: 115, r: 80, S: 109, t: 120, U: 62, Y: 110, '°': 99,
};

export interface SegmentStyle {
  /** Digit height, px. */
  height: number;
  on: string;
  /** Colour of unlit segments (LCD ghosting / dark LED segments); omit to draw nothing. */
  off?: string;
  /** Glow radius for emissive displays, px. */
  glow?: number;
}

/** Width of one digit cell (including spacing) for a given height. */
export const cellWidth = (h: number): number => h * 0.8;

/**
 * Draw text right-aligned so its last cell ends at x. '.' and ':' attach to the previous cell. Returns
 * the left edge.
 */
export function drawSegments(g: Ctx2D, text: string, xRight: number, yTop: number, s: SegmentStyle): number {
  let cells = 0;
  for (const ch of text) if (ch !== '.' && ch !== ':') cells++;
  const cw = cellWidth(s.height);
  let x = xRight - cells * cw;
  const left = x;
  g.save();
  if (s.glow) {
    g.shadowColor = s.on;
    g.shadowBlur = s.glow;
  }
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '.' || ch === ':') continue;
    const next = text[i + 1];
    if (s.off) {
      g.shadowBlur = 0;
      digit(g, 127, x, yTop, s.height, s.off, next === '.', next === ':');
      if (s.glow) g.shadowBlur = s.glow;
    }
    digit(g, GLYPHS[ch] ?? 0, x, yTop, s.height, s.on, next === '.', next === ':');
    x += cw;
  }
  g.restore();
  return left;
}

function digit(g: Ctx2D, bits: number, x: number, y: number, h: number, color: string, dot: boolean, colon: boolean): void {
  const w = h * 0.5;
  const t = h * 0.12; // segment thickness
  const slant = h * 0.08; // italic lean
  const hh = h / 2;
  g.fillStyle = color;
  // Segment as a hexagon between two points, skewed for the italic lean.
  const seg = (x0: number, y0: number, x1: number, y1: number): void => {
    const sx0 = x + x0 + slant * (1 - y0 / h);
    const sx1 = x + x1 + slant * (1 - y1 / h);
    const yy0 = y + y0;
    const yy1 = y + y1;
    const horizontal = y0 === y1;
    const e = t / 2;
    g.beginPath();
    if (horizontal) {
      g.moveTo(sx0 + e * 0.3, yy0);
      g.lineTo(sx0 + e * 1.3, yy0 - e);
      g.lineTo(sx1 - e * 1.3, yy1 - e);
      g.lineTo(sx1 - e * 0.3, yy1);
      g.lineTo(sx1 - e * 1.3, yy1 + e);
      g.lineTo(sx0 + e * 1.3, yy0 + e);
    } else {
      g.moveTo(sx0, yy0 + e * 0.3);
      g.lineTo(sx0 + e, yy0 + e * 1.3);
      g.lineTo(sx1 + e, yy1 - e * 1.3);
      g.lineTo(sx1, yy1 - e * 0.3);
      g.lineTo(sx1 - e, yy1 - e * 1.3);
      g.lineTo(sx0 - e, yy0 + e * 1.3);
    }
    g.closePath();
    g.fill();
  };
  if (bits & 1) seg(0, 0, w, 0);
  if (bits & 2) seg(w, 0, w, hh);
  if (bits & 4) seg(w, hh, w, h);
  if (bits & 8) seg(0, h, w, h);
  if (bits & 16) seg(0, hh, 0, h);
  if (bits & 32) seg(0, 0, 0, hh);
  if (bits & 64) seg(0, hh, w, hh);
  if (dot) {
    g.beginPath();
    g.arc(x + w + t * 1.9, y + h - t * 0.4, t * 0.6, 0, Math.PI * 2);
    g.fill();
  }
  if (colon) {
    for (const f of [0.3, 0.72]) {
      g.beginPath();
      g.arc(x + w + t * 1.6 + slant * (1 - f), y + h * f, t * 0.55, 0, Math.PI * 2);
      g.fill();
    }
  }
}
