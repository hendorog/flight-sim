// World overview map (probe): land cover over a square around the field, written as a PNG.
//   MAP_SEED=7 MAP_HALF=20000 MAP_STEP=100 MAP_OUT=map.png npx vitest run --config scripts/probes/vitest.config.ts worldMap
import { it } from 'vitest';
import { makeSample, sampleTerrain } from '../../src/world/terrain/heightfield';
import { computeBiome, coverShape, makeBiome, makeCoverShape } from '../../src/world/terrain/biome';
import { findTownSite } from '../../src/world/airport/valley';
import { terrainHeight } from '../../src/world/terrain/heightfield';
import { setTownSite } from '../../src/world/terrain/townMask';
import { setWorldSeed } from '../../src/world/worldSeed';
import { airfields } from '../../src/world/airfields';
import { regionalRoads, villageSites, regionalRoadKinds, riverCrossings } from '../../src/world/terrain/roads';

const node = (await import(/* @vite-ignore */ 'node:zlib' as string)) as { deflateSync(b: Uint8Array): Uint8Array; crc32?: (b: Uint8Array) => number };
const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as { writeFileSync(p: string, d: Uint8Array | string): void };
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;

function crc(b: Uint8Array): number {
  let c = ~0;
  for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
  return ~c >>> 0;
}
function png(w: number, h: number, rgb: Uint8Array): Uint8Array {
  const raw = new Uint8Array((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) raw.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), y * (w * 3 + 1) + 1);
  const chunk = (t: string, d: Uint8Array): Uint8Array => {
    const o = new Uint8Array(12 + d.length);
    const dv = new DataView(o.buffer);
    dv.setUint32(0, d.length);
    for (let i = 0; i < 4; i++) o[4 + i] = t.charCodeAt(i);
    o.set(d, 8);
    dv.setUint32(8 + d.length, crc(o.subarray(4, 8 + d.length)));
    return o;
  };
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h); ihdr[8] = 8; ihdr[9] = 2;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', node.deflateSync(raw)), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

it('world map', () => {
  const half = Number(env.MAP_HALF ?? 20000), step = Number(env.MAP_STEP ?? 100);
  const cn = Number(env.MAP_N ?? 0), ce = Number(env.MAP_E ?? 0);
  setWorldSeed(env.MAP_SEED ?? 0);
  const town = findTownSite(terrainHeight);
  setTownSite(town);
  console.log('town', town);
  const n = Math.round((2 * half) / step);
  const rgb = new Uint8Array(n * n * 3);
  const s = makeSample(), sh = makeCoverShape(), b = makeBiome();
  for (let y = 0; y < n; y++) {
    const north = cn + half - (y + 0.5) * step;
    for (let x = 0; x < n; x++) {
      const east = ce - half + (x + 0.5) * step;
      sampleTerrain(north, east, s);
      coverShape(north, east, s.ground, sh);
      computeBiome(north, east, s, sh.up, b, sh.north);
      const shade = 0.55 + 0.45 * Math.min(1, Math.max(0, (sh.up - 0.85) / 0.15)) ;
      let c = [150, 140, 120];
      const h = s.ground;
      if (Math.max(s.standing, s.river) > h) c = [40, 80, 200];
      else if (b.plantation > 0.5) c = [20, 70, 40];
      else if (b.forest > 0.5) c = [40, 110, 40];
      else if (b.farmland > 0.5) c = [170, 190, 90];
      else if (h > 1200) c = [200, 200, 200];
      if (s.airportBlend < 0.5) c = [255, 255, 255];
      if (town && Math.hypot(north - town.north, east - town.east) < town.radius) c = [220, 60, 60];
      const k = (y * n + x) * 3;
      rgb[k] = c[0] * shade; rgb[k + 1] = c[1] * shade; rgb[k + 2] = c[2] * shade;
    }
  }
  const put = (north: number, east: number, c: number[]): void => {
    const x = Math.floor((east - (ce - half)) / step), y = Math.floor((cn + half - north) / step);
    if (x < 0 || y < 0 || x >= n || y >= n) return;
    rgb.set(c, (y * n + x) * 3);
  };
  const kinds = regionalRoadKinds();
  for (const [ri, l] of regionalRoads().entries()) {
    const r = { kind: kinds[ri] };
    for (let i = 0; i + 1 < l.north.length; i++) {
      const m = Math.ceil(Math.hypot(l.north[i + 1] - l.north[i], l.east[i + 1] - l.east[i]) / (step / 3));
      for (let k = 0; k <= m; k++) put(l.north[i] + (l.north[i + 1] - l.north[i]) * k / m, l.east[i] + (l.east[i + 1] - l.east[i]) * k / m, r.kind === 0 ? [0, 0, 0] : [120, 60, 20]);
    }
  }
  for (const v of villageSites()) for (let a = 0; a < 64; a++) for (let rr = 0; rr <= v.radius; rr += step / 2) put(v.north + Math.cos(a / 10.2) * rr, v.east + Math.sin(a / 10.2) * rr, [255, 140, 0]);
  for (const c of riverCrossings()) for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) put(c.north + dy * step, c.east + dx * step, [255, 0, 255]);
  // Airfields: red runways (home and generated), drawn thick so they show at a coarse step.
  for (const f of airfields()) {
    for (let t = -f.length / 2; t <= f.length / 2; t += step / 3) {
      for (let w = -2; w <= 2; w++) put(f.north + Math.cos(f.heading) * t - Math.sin(f.heading) * w * step / 2, f.east + Math.sin(f.heading) * t + Math.cos(f.heading) * w * step / 2, [230, 0, 0]);
    }
  }
  fs.writeFileSync(env.MAP_OUT ?? 'map.png', png(n, n, rgb));
});
