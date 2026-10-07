// Foliage and bark texture atlas, drawn procedurally with Canvas 2D at start-up (~20 ms).
//
//   UV layout (v up):  [0.0-0.5] x [0.5-1.0]  needle spray (conifer branch card; u runs trunk -> tip)
//                      [0.5-1.0] x [0.5-1.0]  broadleaf cluster (centred card)
//                      [0.0-0.5] x [0.0-0.5]  dark fissured bark
//                      [0.5-1.0] x [0.0-0.5]  birch bark
//
// Transparent texels get the mean colour of the opaque ones of their region (colour dilation), so mipmapping never
// bleeds black into the foliage edges.

import * as THREE from 'three';
import { mulberry32 } from '../noise';

// Foliage cards use their region inset by ~3%, so filtering never reaches the opaque bark regions next to
// them (which showed as thin light lines along card edges).
export const ATLAS = {
  needles: [0.012, 0.515, 0.488, 0.985],
  leaves: [0.515, 0.515, 0.985, 0.985],
  bark: [0, 0, 0.5, 0.5],
  birch: [0.5, 0, 1, 0.5],
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
