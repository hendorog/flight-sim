// Foliage and bark texture atlas, drawn procedurally with Canvas 2D at start-up (~20 ms).
//
//   UV layout (v up):  [0.0-0.5] x [0.5-1.0]  needle spray (conifer branch card; u runs trunk -> tip)
//                      [0.5-1.0] x [0.5-1.0]  broadleaf cluster (centred card)
//                      [0.0-0.5] x [0.0-0.5]  dark fissured bark
//                      [0.5-1.0] x [0.0-0.5]  birch bark
//
// Another era (Deep Time, flora/index.ts) paints its own contents into the same four quadrants (ERA_ATLAS):
//                      [0.0-0.5] x [0.5-1.0]  scale-leaf spray (araucaria, taxodioid)
//                      [0.5-1.0] x [0.5-1.0]  large broad leaves (platanoid)
//                      [0.0-0.5] x [0.0-0.5]  stringy red-brown bark
//                      [0.5-0.6] x [0.0-0.5]  palm trunk fibre and leaf bases; [0.62-0.87] x [0.01-0.49] palm fan
//
// Transparent texels get the mean colour of the opaque ones of their region (colour dilation), so mipmapping never
// bleeds black into the foliage edges.

import * as THREE from 'three';
import { mulberry32 } from '../noise';
import { isPresent } from '../../era/eraState';

// Foliage cards use their region inset by ~3%, so filtering never reaches the opaque bark regions next to
// them (which showed as thin light lines along card edges).
export const ATLAS = {
  needles: [0.012, 0.515, 0.488, 0.985],
  leaves: [0.515, 0.515, 0.985, 0.985],
  bark: [0, 0, 0.5, 0.5],
  birch: [0.5, 0, 1, 0.5],
} as const;

/** The rects of another era's atlas (see the header): the same quadrants, the last split for the palm. */
export const ERA_ATLAS = {
  needles: ATLAS.needles,
  leaves: ATLAS.leaves,
  bark: ATLAS.bark,
  palmFibre: [0.5, 0, 0.599, 0.5],
  // The fan's base (petiole end) at u0, mid-height; its tips at u1. Its texels are about 1 : 1.9 (u : v).
  palmFan: [0.622, 0.012, 0.872, 0.488],
} as const;

const S = 512;

/** CSS colour from a linear RGB albedo (the atlas is sRGB encoded). */
function srgb(r: number, g: number, b: number): string {
  const e = (v: number): number => Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(Math.min(1, v), 1 / 2.4) - 0.055));
  return `rgb(${e(r)},${e(g)},${e(b)})`;
}

// Single-leaf albedos (linear): real foliage reflects ~0.08-0.12 in green, half that in red and a third in
// blue. Crowns come out much darker than this through their own shading and shadowing.
function needleColour(rnd: () => number, light: number): string {
  const v = (0.7 + 0.6 * rnd()) * light;
  return srgb(0.022 * v, 0.05 * v, 0.02 * v);
}

function drawNeedles(g: CanvasRenderingContext2D, rnd: () => number): void {
  // A flat spray seen from above: a tapering, slightly ragged envelope densely filled with needles along a
  // herringbone of side shoots. The core is nearly opaque; needles fringe the edge.
  const half = (t: number): number => (S * 0.42) * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.1)), 0.7) * (1 - 0.55 * t);
  g.fillStyle = srgb(0.01, 0.024, 0.01);
  g.beginPath();
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    g.lineTo(8 + t * (S - 24), S / 2 - half(t) * 0.75);
  }
  for (let i = 40; i >= 0; i--) {
    const t = i / 40;
    g.lineTo(8 + t * (S - 24), S / 2 + half(t) * 0.75);
  }
  g.fill();
  // Side shoots with needles, light on the upper side of each shoot.
  g.lineCap = 'round';
  for (let k = 0; k < 2600; k++) {
    const t = rnd();
    const x = 8 + t * (S - 24);
    const off = (rnd() * 2 - 1) * half(t);
    const y = S / 2 + off;
    const a = Math.sign(off || 1) * (0.6 + 0.5 * rnd()) + (rnd() - 0.5) * 0.4;
    const l = 10 + 12 * rnd();
    g.strokeStyle = needleColour(rnd, 0.7 + 0.6 * rnd());
    g.lineWidth = 2.2;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
  // Main axis.
  g.strokeStyle = '#3a2a1a';
  g.lineWidth = 5;
  g.beginPath();
  g.moveTo(4, S / 2);
  g.lineTo(S * 0.8, S / 2);
  g.stroke();
}

function drawLeaves(g: CanvasRenderingContext2D, rnd: () => number): void {
  g.save();
  g.translate(S / 2, S / 2);
  // A cluster of a few overlapping sub-clumps, so the outline is lobed rather than circular.
  const lobes: Array<[number, number, number]> = [[0, 0, 170]];
  for (let i = 0; i < 5; i++) {
    const a = rnd() * Math.PI * 2;
    lobes.push([Math.cos(a) * 110, Math.sin(a) * 110, 90 + 50 * rnd()]);
  }
  g.strokeStyle = '#3b2c1e';
  for (let i = 0; i < 7; i++) {
    const a = -Math.PI / 2 + (rnd() - 0.5) * 2.6;
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(0, 80);
    g.lineTo(Math.cos(a) * 190, 80 + Math.sin(a) * 190);
    g.stroke();
  }
  for (let i = 0; i < 2600; i++) {
    const [cx, cy, r] = lobes[Math.floor(rnd() * lobes.length)];
    const rr = r * Math.sqrt(rnd());
    const a = rnd() * Math.PI * 2;
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr;
    if (Math.hypot(x, y) > 250) continue;
    // Lit from above: lighter toward the top of the cluster; later leaves (on top) slightly lighter.
    const light = 0.55 + 0.3 * (-y / 250) + 0.3 * rnd() + 0.25 * (i / 2600);
    const v = (0.75 + 0.5 * rnd()) * light;
    // Hue: some leaves yellower, some bluer (age, sun and shade leaves).
    const hue = rnd();
    g.fillStyle = srgb((0.026 + 0.016 * hue) * v, 0.08 * v, (0.032 - 0.01 * hue) * v);
    g.save();
    g.translate(x, y);
    g.rotate(rnd() * Math.PI);
    // A leaf: pointed oval with a slightly lighter half (the midrib catches the light).
    const lw = 9 + 5 * rnd();
    const lh = 4.5 + 2.5 * rnd();
    g.beginPath();
    g.moveTo(-lw, 0);
    g.quadraticCurveTo(0, -lh * 1.6, lw, 0);
    g.quadraticCurveTo(0, lh * 1.6, -lw, 0);
    g.fill();
    g.fillStyle = 'rgba(255,255,230,0.07)';
    g.beginPath();
    g.moveTo(-lw, 0);
    g.quadraticCurveTo(0, -lh * 1.6, lw, 0);
    g.closePath();
    g.fill();
    g.restore();
  }
  g.restore();
}

function drawBark(g: CanvasRenderingContext2D, rnd: () => number, birch: boolean): void {
  g.fillStyle = birch ? '#d8d4c8' : '#4a3a2c';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 260; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    if (birch) {
      g.fillStyle = `rgba(30,28,25,${0.5 + 0.4 * rnd()})`;
      g.fillRect(x, y, 10 + 40 * rnd(), 2 + 4 * rnd());
    } else {
      g.fillStyle = `rgba(20,14,10,${0.4 + 0.4 * rnd()})`;
      g.fillRect(x, y, 2 + 3 * rnd(), 20 + 60 * rnd());
    }
  }
}

export function createFoliageAtlas(renderer: THREE.WebGLRenderer): THREE.DataTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 2 * S;
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  const rnd = mulberry32(77);
  if (!isPresent()) return eraAtlas(renderer, canvas, g, rnd);
  // Canvas y runs down; the atlas UVs above have v up, so the top half of the canvas is v in [0.5, 1].
  g.save();
  drawNeedles(g, rnd);
  g.translate(S, 0);
  drawLeaves(g, rnd);
  g.restore();
  g.save();
  g.translate(0, S);
  drawBark(g, rnd, false);
  g.translate(S, 0);
  drawBark(g, rnd, true);
  g.restore();

  const img = g.getImageData(0, 0, 2 * S, 2 * S);
  const d = img.data;
  // Colour dilation per region: transparent texels take the mean colour of the opaque texels of their own
  // quadrant (needles, leaves), so filtering at a card's alpha edge blends toward the foliage colour
  // instead of a bark-tinted average (which drew a dark outline around every crown).
  for (let qy = 0; qy < 2; qy++) {
    for (let qx = 0; qx < 2; qx++) {
      let r = 0;
      let gg = 0;
      let b = 0;
      let n = 0;
      for (let y = qy * S; y < (qy + 1) * S; y++) {
        for (let x = qx * S; x < (qx + 1) * S; x++) {
          const i = (y * 2 * S + x) * 4;
          if (d[i + 3] > 128) {
            r += d[i];
            gg += d[i + 1];
            b += d[i + 2];
            n++;
          }
        }
      }
      if (n === 0) continue;
      for (let y = qy * S; y < (qy + 1) * S; y++) {
        for (let x = qx * S; x < (qx + 1) * S; x++) {
          const i = (y * 2 * S + x) * 4;
          if (d[i + 3] < 8) {
            d[i] = r / n;
            d[i + 1] = gg / n;
            d[i + 2] = b / n;
            d[i + 3] = 0;
          }
        }
      }
    }
  }
  return atlasTexture(renderer, d);
}

function atlasTexture(renderer: THREE.WebGLRenderer, d: Uint8ClampedArray): THREE.DataTexture {
  // Flip rows so v = 0 is the bottom of the image (DataTexture uploads without flipping).
  const flipped = new Uint8Array(d.length);
  const row = 2 * S * 4;
  for (let y = 0; y < 2 * S; y++) flipped.set(d.subarray(y * row, (y + 1) * row), (2 * S - 1 - y) * row);
  const tex = new THREE.DataTexture(flipped, 2 * S, 2 * S, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  tex.needsUpdate = true;
  return tex;
}

// ------------------------------------------------------------------------------------------------ eras

/** Colour dilation of one region (canvas pixels [x0, x1) x [y0, y1)), as for the present quadrants. */
function dilate(d: Uint8ClampedArray, x0: number, y0: number, x1: number, y1: number): void {
  let r = 0;
  let gg = 0;
  let b = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * 2 * S + x) * 4;
      if (d[i + 3] > 128) {
        r += d[i];
        gg += d[i + 1];
        b += d[i + 2];
        n++;
      }
    }
  }
  if (n === 0) return;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * 2 * S + x) * 4;
      if (d[i + 3] < 8) {
        d[i] = r / n;
        d[i + 1] = gg / n;
        d[i + 2] = b / n;
        d[i + 3] = 0;
      }
    }
  }
}

/**
 * Paint one atlas region at canvas pixels (x, y), clipped to its w x h rect so no stroke can bleed into a
 * neighbouring region (the scale-spray ropes sweep forward past the needle quadrant's right edge).
 */
function region(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, draw: () => void): void {
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  g.translate(x, y);
  draw();
  g.restore();
}

function eraAtlas(renderer: THREE.WebGLRenderer, canvas: HTMLCanvasElement, g: CanvasRenderingContext2D, rnd: () => number): THREE.DataTexture {
  const fibre = Math.round(0.2 * S);
  const fan = Math.round(0.24 * S);
  region(g, 0, 0, S, S, () => drawScaleSpray(g, rnd));
  region(g, S, 0, S, S, () => drawBigLeaves(g, rnd));
  region(g, 0, S, S, S, () => drawStringyBark(g, rnd));
  region(g, S, S, fibre, S, () => drawPalmFibre(g, rnd, fibre));
  region(g, S + fan, S, S - fan, S, () => drawPalmFan(g, rnd, 258, S));
  const d = g.getImageData(0, 0, canvas.width, canvas.height).data;
  dilate(d, 0, 0, S, S);
  dilate(d, S, 0, 2 * S, S);
  dilate(d, 0, S, S, 2 * S);
  dilate(d, S, S, S + Math.round(0.2 * S), 2 * S);
  dilate(d, S + Math.round(0.2 * S), S, 2 * S, 2 * S);
  return atlasTexture(renderer, d);
}

/**
 * Araucarian / taxodioid foliage: a flat spray of rope-like branchlets clothed in overlapping scale leaves
 * (u runs trunk -> tip, as the needle spray). Darker and glossier than spruce needles.
 */
function drawScaleSpray(g: CanvasRenderingContext2D, rnd: () => number): void {
  const half = (t: number): number => S * 0.42 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.06)), 0.6) * (1 - 0.4 * t);
  // A narrow dark band along the axis only: the spray stays lacy, with sky between its ropes.
  g.fillStyle = srgb(0.012, 0.026, 0.012);
  g.beginPath();
  for (let i = 0; i <= 40; i++) g.lineTo(8 + (i / 40) * (S - 24), S / 2 - half(i / 40) * 0.18);
  for (let i = 40; i >= 0; i--) g.lineTo(8 + (i / 40) * (S - 24), S / 2 + half(i / 40) * 0.18);
  g.fill();
  // Branchlets: ropes swept forward off the axis, each a chain of overlapping scale leaves (glossy upper rim),
  // thinning to the tip, some forking once.
  const rope = (x0: number, y0: number, a0: number, len: number, w0: number): void => {
    let x = x0;
    let y = y0;
    const steps = Math.max(3, Math.round(len / 6));
    for (let st = 0; st < steps; st++) {
      const f = st / steps;
      const a = a0 * (1 - 0.35 * f) + (rnd() - 0.5) * 0.18;
      x += Math.cos(a) * 6;
      y += Math.sin(a) * 6;
      const w = w0 * (1 - 0.55 * f);
      const v = 0.75 + 0.5 * rnd();
      g.fillStyle = srgb(0.02 * v, 0.046 * v, 0.022 * v);
      g.beginPath();
      g.ellipse(x, y, w, w * 0.62, a, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = srgb(0.045 * v, 0.085 * v, 0.04 * v);
      g.lineWidth = 1.4;
      g.beginPath();
      g.ellipse(x, y, w * 0.78, w * 0.45, a, Math.PI * 1.1, Math.PI * 1.9);
      g.stroke();
    }
  };
  const ropes = 64;
  for (let k = 0; k < ropes; k++) {
    const t0 = 0.03 + 0.92 * (k / ropes) + 0.015 * rnd();
    const side = k % 2 === 0 ? 1 : -1;
    const a0 = side * (0.55 + 0.4 * rnd());
    const len = (half(t0) / Math.sin(Math.abs(a0))) * (0.75 + 0.3 * rnd());
    const x0 = 8 + t0 * (S - 24);
    rope(x0, S / 2, a0, len, 6.5);
    // A fork part-way out.
    if (rnd() < 0.5) {
      const f = 0.35 + 0.3 * rnd();
      rope(x0 + Math.cos(a0) * len * f, S / 2 + Math.sin(a0) * len * f, a0 * 0.4, len * (1 - f) * 0.9, 5);
    }
  }
  // The axis rope itself, to the tip.
  rope(4, S / 2, 0, S * 0.92, 8);
  g.strokeStyle = '#3a2618';
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(4, S / 2);
  g.lineTo(S * 0.6, S / 2);
  g.stroke();
}

/** Platanoid / magnolialean foliage: a lobed cluster of fewer, larger leaves, palmately lobed or entire. */
function drawBigLeaves(g: CanvasRenderingContext2D, rnd: () => number): void {
  g.save();
  g.translate(S / 2, S / 2);
  const lobes: Array<[number, number, number]> = [[0, 0, 160]];
  for (let i = 0; i < 5; i++) {
    const a = rnd() * Math.PI * 2;
    lobes.push([Math.cos(a) * 105, Math.sin(a) * 105, 95 + 45 * rnd()]);
  }
  g.strokeStyle = '#3b2c1e';
  for (let i = 0; i < 6; i++) {
    const a = -Math.PI / 2 + (rnd() - 0.5) * 2.6;
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(0, 80);
    g.lineTo(Math.cos(a) * 180, 80 + Math.sin(a) * 180);
    g.stroke();
  }
  const N = 520;
  for (let i = 0; i < N; i++) {
    const [cx, cy, r] = lobes[Math.floor(rnd() * lobes.length)];
    const rr = r * Math.sqrt(rnd());
    const a = rnd() * Math.PI * 2;
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr;
    if (Math.hypot(x, y) > 240) continue;
    const light = 0.55 + 0.3 * (-y / 250) + 0.3 * rnd() + 0.25 * (i / N);
    const v = (0.75 + 0.5 * rnd()) * light;
    const hue = rnd();
    g.fillStyle = srgb((0.022 + 0.014 * hue) * v, 0.082 * v, (0.03 - 0.008 * hue) * v);
    g.save();
    g.translate(x, y);
    g.rotate(rnd() * Math.PI * 2);
    const L = 20 + 12 * rnd();
    g.beginPath();
    if (rnd() < 0.55) {
      // Palmate, plane-like: three to five pointed lobes.
      const n = rnd() < 0.5 ? 3 : 5;
      for (let k = 0; k <= n * 2; k++) {
        const ang = -Math.PI / 2 + ((k / (n * 2)) - 0.5) * Math.PI * 1.5;
        const rad = k % 2 === 0 ? L : L * 0.45;
        g.lineTo(Math.cos(ang) * rad, Math.sin(ang) * rad + L * 0.35);
      }
    } else {
      // Entire, magnolia-like: a long glossy oval.
      g.moveTo(-L, 0);
      g.quadraticCurveTo(0, -L * 0.55, L, 0);
      g.quadraticCurveTo(0, L * 0.55, -L, 0);
    }
    g.closePath();
    g.fill();
    // Gloss on the upper half.
    g.fillStyle = 'rgba(255,255,235,0.09)';
    g.beginPath();
    g.ellipse(0, -L * 0.1, L * 0.55, L * 0.22, 0, Math.PI, Math.PI * 2);
    g.fill();
    g.restore();
  }
  g.restore();
}

/** Fibrous, stringy red-brown bark (taxodioids, araucarians, broadleaves alike, told apart by tint). */
function drawStringyBark(g: CanvasRenderingContext2D, rnd: () => number): void {
  g.fillStyle = '#5a3d2b';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 420; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const dark = rnd() < 0.55;
    g.fillStyle = dark ? `rgba(28,16,10,${0.35 + 0.4 * rnd()})` : `rgba(150,105,78,${0.2 + 0.3 * rnd()})`;
    g.fillRect(x, y, 1.5 + 3 * rnd(), 40 + 120 * rnd());
  }
}

/** Palm trunk (w px wide strip of the quadrant): criss-crossed leaf-base "boots" over grey-brown fibre. */
function drawPalmFibre(g: CanvasRenderingContext2D, rnd: () => number, w: number): void {
  g.fillStyle = '#6a5a46';
  g.fillRect(0, 0, w, S);
  for (let i = 0; i < 900; i++) {
    g.strokeStyle = `rgba(${40 + 60 * rnd()},${32 + 45 * rnd()},${22 + 30 * rnd()},0.6)`;
    g.lineWidth = 1;
    const x = rnd() * w;
    const y = rnd() * S;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (rnd() - 0.5) * 10, y + 6 + 10 * rnd());
    g.stroke();
  }
  // Rows of split leaf bases, alternating, each a V opening upward.
  const rows = 22;
  for (let r = 0; r < rows; r++) {
    const y = (r + 0.5) * (S / rows);
    for (let k = 0; k < 2; k++) {
      const x = ((k + (r % 2) * 0.5) / 2) * w + w * 0.25;
      g.fillStyle = `rgba(35,26,18,${0.55 + 0.3 * rnd()})`;
      g.beginPath();
      g.moveTo(x, y + 9);
      g.lineTo(x - w * 0.22, y - 10);
      g.lineTo(x - w * 0.12, y - 10);
      g.lineTo(x, y + 2);
      g.lineTo(x + w * 0.12, y - 10);
      g.lineTo(x + w * 0.22, y - 10);
      g.closePath();
      g.fill();
    }
  }
}

/**
 * A costapalmate fan frond seen from above (w x h px): the petiole enters at the left middle; pleated
 * segments radiate over ~150 degrees, splitting into drooping threads at the tips (u runs base -> tip).
 */
function drawPalmFan(g: CanvasRenderingContext2D, rnd: () => number, w: number, h: number): void {
  const ox = 6;
  const oy = h / 2;
  const R = Math.min(w - 12, h * 0.5 - 6);
  const segs = 30;
  const spread = (150 * Math.PI) / 180;
  for (let k = 0; k < segs; k++) {
    const a = -spread / 2 + (spread * (k + 0.5)) / segs;
    const half = (spread / segs) * 0.5;
    const len = R * (0.82 + 0.18 * Math.cos(a * 0.9)) * (0.93 + 0.07 * rnd());
    const split = len * (0.72 + 0.08 * rnd());
    // Alternate pleats: the upward fold lit, the downward one shaded.
    const v = (k % 2 === 0 ? 1.15 : 0.75) * (0.85 + 0.3 * rnd());
    g.fillStyle = srgb(0.034 * v, 0.07 * v, 0.03 * v);
    g.beginPath();
    g.moveTo(ox + Math.cos(a) * 6, oy + Math.sin(a) * 6);
    g.lineTo(ox + Math.cos(a - half) * split, oy + Math.sin(a - half) * split);
    g.lineTo(ox + Math.cos(a) * len, oy + Math.sin(a) * len);
    g.lineTo(ox + Math.cos(a + half) * split, oy + Math.sin(a + half) * split);
    g.closePath();
    g.fill();
    // The free tip splits into two threads.
    g.strokeStyle = srgb(0.04 * v, 0.07 * v, 0.03 * v);
    g.lineWidth = 2;
    for (const s of [-0.4, 0.4]) {
      g.beginPath();
      g.moveTo(ox + Math.cos(a) * split, oy + Math.sin(a) * split);
      g.lineTo(ox + Math.cos(a + half * s) * (len + 6), oy + Math.sin(a + half * s) * (len + 6));
      g.stroke();
    }
    // Pleat crease.
    g.strokeStyle = srgb(0.06 * v, 0.1 * v, 0.045 * v);
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(ox + Math.cos(a) * 8, oy + Math.sin(a) * 8);
    g.lineTo(ox + Math.cos(a) * split, oy + Math.sin(a) * split);
    g.stroke();
  }
  // The costa (the midrib running into the blade) and the hastula.
  g.strokeStyle = srgb(0.07, 0.08, 0.04);
  g.lineWidth = 5;
  g.beginPath();
  g.moveTo(0, oy);
  g.lineTo(ox + R * 0.35, oy);
  g.stroke();
}
