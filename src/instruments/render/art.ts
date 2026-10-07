// Shared artwork for analogue instruments: bezels with screws, glass, matte dial faces, tick marks,
// colour arcs and pre-rendered needle sprites.
//
// Angles on dials are measured clockwise from 12 o'clock, in radians, like a clock face. Light falls
// from above (the windshield), so shadows are cast downward and bevels are lit on their upper faces.

import type { ArcColor } from '../panelDef';
import { context2d, DIAL_FONT, makeCanvas, noiseCanvas, rng, type Ctx2D } from './canvas';

export const INK = '#f1f0e8'; // dial paint white, slightly warm
export const ARC_GREEN = '#1f9c3e';
export const ARC_YELLOW = '#e9c120';
export const ARC_RED = '#d9261c';
export const ARC_WHITE = '#f3f3ee';
export const ARC_BLUE = '#2f7fd6';
/** The paint of a colour arc or radial line by the name a panel definition gives it. */
export const ARC_COLORS: Record<ArcColor, string> = { green: ARC_GREEN, yellow: ARC_YELLOW, red: ARC_RED, white: ARC_WHITE, blue: ARC_BLUE };
export const FACE_BLACK = '#101112';

/** Screen offset of the soft shadow a needle casts on the dial. */
export const SHADOW_DX = 1.2;
export const SHADOW_DY = 3;

export function polarX(a: number, r: number): number {
  return r * Math.sin(a);
}
export function polarY(a: number, r: number): number {
  return -r * Math.cos(a);
}

/** Radial tick from radius r0 to r1 at dial angle a (dial centred on the origin). */
export function tick(g: Ctx2D, a: number, r0: number, r1: number, width: number, color = INK): void {
  const s = Math.sin(a);
  const c = -Math.cos(a);
  g.strokeStyle = color;
  g.lineWidth = width;
  g.lineCap = 'butt';
  g.beginPath();
  g.moveTo(s * r0, c * r0);
  g.lineTo(s * r1, c * r1);
  g.stroke();
}

/** Colour band between dial angles a0 < a1, outer radius r, radial width w. */
export function arcBand(g: Ctx2D, a0: number, a1: number, r: number, w: number, color: string): void {
  g.strokeStyle = color;
  g.lineWidth = w;
  g.lineCap = 'butt';
  g.beginPath();
  g.arc(0, 0, r - w / 2, a0 - Math.PI / 2, a1 - Math.PI / 2);
  g.stroke();
}

export function font(size: number, weight = 600): string {
  return `${weight} ${size}px ${DIAL_FONT}`;
}

/** Upright text centred at polar position (a, r). */
export function dialText(g: Ctx2D, text: string, a: number, r: number, size: number, color = INK, weight = 600): void {
  g.font = font(size, weight);
  g.fillStyle = color;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, polarX(a, r), polarY(a, r) + size * 0.04);
}

export function centredText(g: Ctx2D, text: string, x: number, y: number, size: number, color = INK, weight = 600): void {
  g.font = font(size, weight);
  g.fillStyle = color;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, x, y);
}

/**
 * Matte black dial face of radius r on a size x size canvas, centred. Includes paint grain, a faint
 * vignette where the bezel lip shades the face, and a few specks of dust.
 */
export function makeFace(size: number, r: number, seed: number, color = FACE_BLACK): HTMLCanvasElement {
  const c = makeCanvas(size, size);
  const g = context2d(c);
  const m = size / 2;
  g.save();
  g.beginPath();
  g.arc(m, m, r, 0, Math.PI * 2);
  g.clip();
  g.fillStyle = color;
  g.fillRect(0, 0, size, size);
  g.globalCompositeOperation = 'overlay';
  g.globalAlpha = 0.18;
  g.drawImage(noiseCanvas(size, size, seed, 0.5), 0, 0);
  g.globalCompositeOperation = 'source-over';
  g.globalAlpha = 1;
  const vign = g.createRadialGradient(m, m - r * 0.1, r * 0.2, m, m, r);
  vign.addColorStop(0, 'rgba(255,255,255,0.035)');
  vign.addColorStop(1, 'rgba(0,0,0,0.25)');
  g.fillStyle = vign;
  g.fillRect(0, 0, size, size);
  dust(g, m, m, r, seed, 18);
  g.restore();
  return c;
}

/** Tiny pale specks and hairline scratches: the "loved" look of a 20-year-old instrument. */
export function dust(g: Ctx2D, cx: number, cy: number, r: number, seed: number, count: number): void {
  const rand = rng(seed * 7 + 3);
  for (let i = 0; i < count; i++) {
    const a = rand() * Math.PI * 2;
    const d = Math.sqrt(rand()) * r;
    g.fillStyle = `rgba(220,215,200,${0.05 + rand() * 0.12})`;
    g.beginPath();
    g.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 0.4 + rand() * 0.7, 0, Math.PI * 2);
    g.fill();
  }
  g.lineWidth = 0.5;
  for (let i = 0; i < count / 6; i++) {
    const a = rand() * Math.PI * 2;
    const d = Math.sqrt(rand()) * r * 0.9;
    const x = cx + Math.cos(a) * d;
    const y = cy + Math.sin(a) * d;
    const b = rand() * Math.PI;
    const l = 4 + rand() * 12;
    g.strokeStyle = `rgba(230,230,220,${0.03 + rand() * 0.05})`;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(b) * l, y + Math.sin(b) * l);
    g.stroke();
  }
}

/** Phillips-head mounting screw, black oxide, with the slot at a random angle. */
export function screw(g: Ctx2D, x: number, y: number, r: number, rand: () => number): void {
  g.save();
  g.translate(x, y);
  // Countersink shadow
  g.fillStyle = 'rgba(0,0,0,0.55)';
  g.beginPath();
  g.arc(0.4, 1, r + 1.2, 0, Math.PI * 2);
  g.fill();
  const head = g.createRadialGradient(-r * 0.35, -r * 0.45, r * 0.1, 0, 0, r);
  head.addColorStop(0, '#77787a');
  head.addColorStop(0.45, '#3c3d3f');
  head.addColorStop(1, '#141415');
  g.fillStyle = head;
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.fill();
  g.rotate(rand() * Math.PI);
  g.strokeStyle = 'rgba(0,0,0,0.85)';
  g.lineWidth = r * 0.28;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(-r * 0.6, 0);
  g.lineTo(r * 0.6, 0);
  g.moveTo(0, -r * 0.6);
  g.lineTo(0, r * 0.6);
  g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.12)';
  g.lineWidth = 0.6;
  g.beginPath();
  g.moveTo(-r * 0.6, r * 0.16);
  g.lineTo(r * 0.6, r * 0.16);
  g.stroke();
  g.restore();
}

/**
 * Front layer of a round instrument: the bezel (square with four screws, or a round flange), its chamfer
 * into the aperture, the shadow the lip throws onto the dial and the cover glass with its reflections.
 * Everything inside the aperture is translucent, so the dial and needles show through.
 */
export function makeBezel(size: number, apertureR: number, seed: number, shape: 'square' | 'round'): HTMLCanvasElement {
  const c = makeCanvas(size, size);
  const g = context2d(c);
  const m = size / 2;
  const rand = rng(seed);

  // Drop shadow of the bezel onto the panel.
  g.save();
  g.shadowColor = 'rgba(0,0,0,0.6)';
  g.shadowBlur = 6;
  g.shadowOffsetY = 3;
  g.fillStyle = '#1b1b1c';
  bezelPath(g, size, shape);
  g.fill();
  g.restore();

  // Body: satin black with a soft top-lit gradient.
  const body = g.createLinearGradient(0, 0, 0, size);
  body.addColorStop(0, '#343537');
  body.addColorStop(0.5, '#1e1f20');
  body.addColorStop(1, '#141415');
  g.fillStyle = body;
  bezelPath(g, size, shape);
  g.fill();
  g.save();
  bezelPath(g, size, shape);
  g.clip();
  g.globalCompositeOperation = 'overlay';
  g.globalAlpha = 0.35;
  g.drawImage(noiseCanvas(size, size, seed + 11, 0.35), 0, 0);
  g.globalCompositeOperation = 'source-over';
  g.globalAlpha = 1;
  // Edge wear: paint rubbed through to grey on the outer edges.
  g.strokeStyle = 'rgba(150,150,150,0.10)';
  g.lineWidth = 1.5;
  bezelPath(g, size, shape);
  g.stroke();
  g.restore();
  // Top-edge highlight
  g.save();
  bezelPath(g, size, shape);
  g.clip();
  const hl = g.createLinearGradient(0, 0, 0, 8);
  hl.addColorStop(0, 'rgba(255,255,255,0.16)');
  hl.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = hl;
  g.fillRect(0, 0, size, 8);
  g.restore();

  // Chamfer into the aperture: a cone facing up and in, so it is lit at the bottom and dark at the top.
  const chamfer = g.createLinearGradient(0, m - apertureR, 0, m + apertureR);
  chamfer.addColorStop(0, '#0b0b0c');
  chamfer.addColorStop(0.55, '#2b2c2e');
  chamfer.addColorStop(1, '#5a5b5e');
  g.strokeStyle = chamfer;
  g.lineWidth = 5;
  g.beginPath();
  g.arc(m, m, apertureR + 2.5, 0, Math.PI * 2);
  g.stroke();

  // Cut the aperture.
  g.globalCompositeOperation = 'destination-out';
  g.beginPath();
  g.arc(m, m, apertureR, 0, Math.PI * 2);
  g.fill();
  g.globalCompositeOperation = 'source-over';

  // Shadow of the lip on the dial, heavier at the top where the light comes from.
  const lip = g.createRadialGradient(m, m + apertureR * 0.07, apertureR * 0.8, m, m, apertureR);
  lip.addColorStop(0, 'rgba(0,0,0,0)');
  lip.addColorStop(0.75, 'rgba(0,0,0,0.25)');
  lip.addColorStop(1, 'rgba(0,0,0,0.75)');
  g.fillStyle = lip;
  g.beginPath();
  g.arc(m, m, apertureR, 0, Math.PI * 2);
  g.fill();

  drawGlass(g, m, m, apertureR, rand);

  if (shape === 'square') {
    const inset = size * 0.085;
    for (const [sx, sy] of [
      [inset, inset],
      [size - inset, inset],
      [inset, size - inset],
      [size - inset, size - inset],
    ]) {
      screw(g, sx, sy, size * 0.036, rand);
    }
  }
  return c;
}

function bezelPath(g: Ctx2D, size: number, shape: 'square' | 'round'): void {
  g.beginPath();
  if (shape === 'round') {
    g.arc(size / 2, size / 2, size / 2 - 3, 0, Math.PI * 2);
  } else {
    g.roundRect(2, 2, size - 4, size - 7, size * 0.09);
  }
}

/** Cover glass: faint overall sheen, a soft window reflection at the top and a thin rim glint. */
export function drawGlass(g: Ctx2D, cx: number, cy: number, r: number, rand: () => number): void {
  g.save();
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.clip();
  const sheen = g.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
  sheen.addColorStop(0, 'rgba(255,255,255,0.075)');
  sheen.addColorStop(0.5, 'rgba(255,255,255,0.012)');
  sheen.addColorStop(1, 'rgba(255,255,255,0.03)');
  g.fillStyle = sheen;
  g.fillRect(cx - r, cy - r, 2 * r, 2 * r);
  // Reflection of the bright windshield: a broad, soft ellipse in the upper part of the glass.
  g.save();
  g.translate(cx - r * 0.12, cy - r * 0.55);
  g.rotate(-0.25 + rand() * 0.1);
  g.scale(1, 0.42);
  const win = g.createRadialGradient(0, 0, 0, 0, 0, r * 0.8);
  win.addColorStop(0, 'rgba(255,255,255,0.10)');
  win.addColorStop(0.7, 'rgba(255,255,255,0.035)');
  win.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = win;
  g.beginPath();
  g.arc(0, 0, r * 0.8, 0, Math.PI * 2);
  g.fill();
  g.restore();
  // Rim glint along the upper-left edge.
  g.lineWidth = 1.6;
  g.lineCap = 'round';
  const glint = g.createLinearGradient(cx - r, cy - r, cx, cy);
  glint.addColorStop(0, 'rgba(255,255,255,0.45)');
  glint.addColorStop(1, 'rgba(255,255,255,0)');
  g.strokeStyle = glint;
  g.beginPath();
  g.arc(cx, cy, r - 2.5, Math.PI * 1.05, Math.PI * 1.55);
  g.stroke();
  g.restore();
}

/**
 * A needle rendered once to an offscreen sprite (pointing to 12 o'clock, pivot at the sprite centre) with
 * a matching blurred shadow sprite, so drawing it each frame is two rotated drawImage calls.
 */
export class NeedleSprite {
  private readonly sprite: HTMLCanvasElement;
  private readonly shadow: HTMLCanvasElement;
  private readonly half: number;

  /** @param paint draws the needle pointing up (-y) about the origin, within radius `reach`. */
  constructor(reach: number, paint: (g: Ctx2D) => void) {
    const pad = 6;
    this.half = Math.ceil(reach + pad);
    const size = this.half * 2;
    this.sprite = makeCanvas(size, size);
    const g = context2d(this.sprite);
    g.translate(this.half, this.half);
    paint(g);
    this.shadow = makeCanvas(size, size);
    const s = context2d(this.shadow);
    s.filter = 'blur(1.6px) brightness(0)';
    s.globalAlpha = 0.6;
    s.drawImage(this.sprite, 0, 0);
  }

  draw(g: Ctx2D, x: number, y: number, angle: number, shadow = true): void {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    if (shadow) {
      g.setTransform(c, s, -s, c, x + SHADOW_DX, y + SHADOW_DY);
      g.drawImage(this.shadow, -this.half, -this.half);
    }
    g.setTransform(c, s, -s, c, x, y);
    g.drawImage(this.sprite, -this.half, -this.half);
    g.setTransform(1, 0, 0, 1, 0, 0);
  }
}

/** Classic Cessna needle: a white tapered pointer with a short black counterweight tail. */
export function paintPointer(g: Ctx2D, length: number, width: number, tail: number, color = INK): void {
  g.fillStyle = '#18191a';
  g.beginPath();
  g.moveTo(-width * 0.9, 0);
  g.lineTo(-width * 0.7, tail);
  g.lineTo(width * 0.7, tail);
  g.lineTo(width * 0.9, 0);
  g.closePath();
  g.fill();
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(-width / 2, 0);
  g.lineTo(-width * 0.42, -length * 0.82);
  g.lineTo(0, -length);
  g.lineTo(width * 0.42, -length * 0.82);
  g.lineTo(width / 2, 0);
  g.closePath();
  g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.lineWidth = 0.6;
  g.stroke();
  hub(g, width * 1.5);
}

/** Black pivot cap with a small specular highlight. */
export function hub(g: Ctx2D, r: number): void {
  const cap = g.createRadialGradient(-r * 0.3, -r * 0.4, r * 0.1, 0, 0, r);
  cap.addColorStop(0, '#5b5c5e');
  cap.addColorStop(0.5, '#222324');
  cap.addColorStop(1, '#0a0a0a');
  g.fillStyle = cap;
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.fill();
}

/** Knurled black instrument knob seen face-on, with its shadow on the bezel. */
export function knob(g: Ctx2D, x: number, y: number, r: number, marker?: string): void {
  g.save();
  g.translate(x, y);
  g.fillStyle = 'rgba(0,0,0,0.55)';
  g.beginPath();
  g.arc(1, 3, r + 1.5, 0, Math.PI * 2);
  g.fill();
  // Knurled rim
  g.fillStyle = '#0d0d0e';
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.13)';
  g.lineWidth = 0.8;
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    g.beginPath();
    g.moveTo(Math.cos(a) * r * 0.8, Math.sin(a) * r * 0.8);
    g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    g.stroke();
  }
  const top = g.createRadialGradient(-r * 0.3, -r * 0.35, 0, 0, 0, r * 0.8);
  top.addColorStop(0, '#4a4b4d');
  top.addColorStop(1, '#161617');
  g.fillStyle = top;
  g.beginPath();
  g.arc(0, 0, r * 0.78, 0, Math.PI * 2);
  g.fill();
  if (marker) {
    g.fillStyle = marker;
    g.fillRect(-1, -r * 0.75, 2, r * 0.45);
  }
  g.restore();
}
