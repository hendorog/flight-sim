// Relief map of a world seed (probe): hypsometric tint with hill shading of the full terrain (sampleTerrain: rivers,
// lakes, sea, airfields), one PNG per seed. Prints the layout search's report.
//   RELIEF_SEEDS=0,7,42 RELIEF_HALF=80000 RELIEF_STEP=250 RELIEF_DIR=/tmp npx vitest run --config scripts/probes/vitest.config.ts seedRelief
import { it } from 'vitest';
import { makeSample, sampleTerrain } from '../../src/world/terrain/heightfield';
import { layoutReport } from '../../src/world/terrain/seededLayout';
import { setWorldSeed } from '../../src/world/worldSeed';
import { airfields } from '../../src/world/airfields';
import { png } from './png';

const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as { writeFileSync(p: string, d: Uint8Array | string): void };
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;

const TINT: ReadonlyArray<[number, number[]]> = [
  [0, [110, 150, 90]], [150, [150, 175, 105]], [400, [195, 190, 130]], [800, [180, 150, 105]], [1500, [150, 120, 95]], [2200, [170, 165, 160]], [2800, [245, 245, 250]],
];
function tint(h: number): number[] {
  if (h <= TINT[0][0]) return TINT[0][1];
  for (let i = 1; i < TINT.length; i++) {
    if (h <= TINT[i][0]) {
      const t = (h - TINT[i - 1][0]) / (TINT[i][0] - TINT[i - 1][0]);
      return TINT[i - 1][1].map((c, k) => c + (TINT[i][1][k] - c) * t);
    }
  }
  return TINT[TINT.length - 1][1];
}

it('seed relief', () => {
  const half = Number(env.RELIEF_HALF ?? 80000);
  const step = Number(env.RELIEF_STEP ?? 250);
  const dir = env.RELIEF_DIR ?? '.';
  const seeds = (env.RELIEF_SEEDS ?? '0,7,42').split(',');
  for (const seedStr of seeds) {
    const t0 = performance.now();
    setWorldSeed(seedStr);
    const tBuild = performance.now() - t0;
    const n = Math.round((2 * half) / step);
    const ground = new Float64Array(n * n);
    const water = new Uint8Array(n * n);
    const s = makeSample();
    for (let y = 0; y < n; y++) {
      const north = half - (y + 0.5) * step;
      for (let x = 0; x < n; x++) {
        const east = -half + (x + 0.5) * step;
        sampleTerrain(north, east, s);
        ground[y * n + x] = s.ground;
        water[y * n + x] = Math.max(s.standing, s.river) > s.ground ? (s.river > s.ground ? 2 : 1) : s.airportBlend < 0.5 ? 3 : 0;
      }
    }
    const rgb = new Uint8Array(n * n * 3);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const i = y * n + x;
        const hx = ground[y * n + Math.min(n - 1, x + 1)] - ground[y * n + Math.max(0, x - 1)];
        const hy = ground[Math.max(0, y - 1) * n + x] - ground[Math.min(n - 1, y + 1) * n + x];
        // Light from the north-west.
        const shade = Math.min(1.25, Math.max(0.45, 0.9 + (-hx + hy) / (2 * step) * 0.9));
        let c = tint(ground[i]).map((v) => v * shade);
        if (water[i] === 1) c = ground[i] < -40 ? [30, 60, 140] : [55, 95, 175];
        if (water[i] === 2) c = [40, 110, 220];
        if (water[i] === 3) c = [255, 60, 60];
        rgb.set(c.map((v) => Math.max(0, Math.min(255, v))), i * 3);
      }
    }
    for (const f of airfields()) {
      const x = Math.floor((f.east + half) / step);
      const y = Math.floor((half - f.north) / step);
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < n && yy < n) rgb.set([255, 0, 255], (yy * n + xx) * 3);
      }
    }
    fs.writeFileSync(`${dir}/relief-${seedStr}.png`, png(n, n, rgb));
    fs.writeFileSync(`${dir}/relief-${seedStr}.txt`, `seed ${seedStr}: build ${tBuild.toFixed(0)} ms, layout ${JSON.stringify(layoutReport())}, fields ${airfields().length}\n`);
  }
  setWorldSeed(0);
});
