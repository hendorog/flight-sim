// Top-down shaded relief map of the procedural heightfield, for checking the landscape layout.
//   dev/terrainmap.html?extent=50000&center=10000,0&size=900
// extent = half-width of the map in metres, center = north,east of the map centre.
// Colours: hypsometric tint with hill shading; water blue; runway red; approach corridors outlined.

import { AIRPORT, runwayThreshold } from '../core/world';
import { APPROACH_GRADIENT, makeSample, sampleTerrain, terrainSurface } from '../world/terrain/heightfield';

const params = new URLSearchParams(location.search);
const extent = Number(params.get('extent') ?? 50000);
const [cn, ce] = (params.get('center') ?? '10000,0').split(',').map(Number);
const size = Number(params.get('size') ?? 900);
const surfaceMode = params.get('surface') === '1';

document.body.style.cssText = 'margin:0;background:#111;color:#ddd;font:13px monospace';
const canvas = document.createElement('canvas');
canvas.width = canvas.height = size;
document.body.appendChild(canvas);
const info = document.createElement('pre');
info.style.cssText = 'position:absolute;left:8px;top:4px;margin:0;text-shadow:0 0 3px #000';
document.body.appendChild(info);

const g = canvas.getContext('2d')!;
const img = g.createImageData(size, size);
const px = (2 * extent) / size;
const heights = new Float64Array((size + 1) * (size + 1));
const wet = new Uint8Array((size + 1) * (size + 1));
const sample = makeSample();
const t0 = performance.now();
let hMin = Infinity;
let hMax = -Infinity;
for (let j = 0; j <= size; j++) {
  for (let i = 0; i <= size; i++) {
    const north = cn + extent - j * px;
    const east = ce - extent + i * px;
    const s = sampleTerrain(north, east, sample);
    heights[j * (size + 1) + i] = s.ground;
    wet[j * (size + 1) + i] = s.ground < Math.max(s.standing, s.river) ? 1 : 0;
    hMin = Math.min(hMin, s.ground);
    hMax = Math.max(hMax, s.ground);
  }
}
const usPerSample = ((performance.now() - t0) * 1000) / ((size + 1) * (size + 1));

const tint = (h: number): [number, number, number] => {
  const stops: Array<[number, [number, number, number]]> = [
    [-400, [20, 40, 90]],
    [0, [70, 120, 170]],
    [1, [200, 190, 140]],
    [60, [110, 150, 80]],
    [300, [140, 160, 90]],
    [800, [150, 130, 90]],
    [1600, [130, 110, 95]],
    [2200, [150, 145, 140]],
    [2700, [240, 240, 245]],
  ];
  if (h <= stops[0][0]) return stops[0][1];
  for (let k = 1; k < stops.length; k++) {
    if (h <= stops[k][0]) {
      const [h0, c0] = stops[k - 1];
      const [h1, c1] = stops[k];
      const t = (h - h0) / (h1 - h0);
      return [c0[0] + (c1[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * t, c0[2] + (c1[2] - c0[2]) * t];
    }
  }
  return stops[stops.length - 1][1];
};
const surfaceColour: Record<string, [number, number, number]> = {
  grass: [90, 150, 70],
  dirt: [180, 150, 100],
  rock: [120, 115, 110],
  snow: [245, 245, 250],
  water: [50, 90, 160],
};

// Light from the north-west, 45 degrees up.
const L = [-0.5, 0.5, 0.707];
for (let j = 0; j < size; j++) {
  for (let i = 0; i < size; i++) {
    const k = j * (size + 1) + i;
    const h = heights[k];
    const dhdx = (heights[k + 1] - h) / px; // east
    const dhdy = (h - heights[k + size + 1]) / px; // north
    const nl = Math.hypot(dhdx, dhdy, 1);
    const shade = Math.max(0, (-dhdx * L[0] - dhdy * L[1] + L[2]) / nl);
    let c = tint(h);
    if (surfaceMode) c = surfaceColour[terrainSurface(cn + extent - j * px, ce - extent + i * px)];
    else if (wet[k]) c = h < 0 ? [40, 80, 150] : [60, 110, 190];
    const f = wet[k] && !surfaceMode ? 1 : 0.35 + 0.9 * shade;
    const o = 4 * (j * size + i);
    img.data[o] = Math.min(255, c[0] * f);
    img.data[o + 1] = Math.min(255, c[1] * f);
    img.data[o + 2] = Math.min(255, c[2] * f);
    img.data[o + 3] = 255;
  }
}
g.putImageData(img, 0, 0);

// Runway and approach corridors.
const toPx = (north: number, east: number): [number, number] => [(east - ce + extent) / px, (cn + extent - north) / px];
g.strokeStyle = '#f33';
g.lineWidth = 3;
g.beginPath();
const a = runwayThreshold(0);
const b = runwayThreshold(1);
g.moveTo(...toPx(a.x, a.y));
g.lineTo(...toPx(b.x, b.y));
g.stroke();
g.strokeStyle = 'rgba(255,80,80,0.6)';
g.lineWidth = 1;
const dir = { n: Math.cos(AIRPORT.runway.heading), e: Math.sin(AIRPORT.runway.heading) };
for (const [t, sgn] of [[a, -1], [b, 1]] as const) {
  g.beginPath();
  g.moveTo(...toPx(t.x, t.y));
  g.lineTo(...toPx(t.x + sgn * dir.n * 10000, t.y + sgn * dir.e * 10000));
  g.stroke();
}
// 10 km scale bar.
g.strokeStyle = '#fff';
g.lineWidth = 2;
g.beginPath();
g.moveTo(20, size - 20);
g.lineTo(20 + 10000 / px, size - 20);
g.stroke();

info.textContent =
  `extent ${extent} m  centre ${cn},${ce}\n` +
  `ground ${hMin.toFixed(0)} .. ${hMax.toFixed(0)} m\n` +
  `sampleTerrain ${usPerSample.toFixed(2)} us/sample\n` +
  `approach gradient ${APPROACH_GRADIENT}`;
(window as unknown as { __ready: boolean }).__ready = true;
