// Probe: a relief map of a seeded world's water with its fault lines (red), falls by cause (fault orange, hanging
// magenta, outlet cyan), tarns (pale blue water) and stream breaches (yellow tint), one PNG per seed or a window.
//   H2M_SEEDS=42 [H2M_N=0 H2M_E=0 H2M_HALF=150000 H2M_STEP=300] H2M_DIR=out/hydro2 npx vitest run --config scripts/probes/vitest.config.ts hydro2Map
import { it } from 'vitest';
import { hydrology, makeSample, sampleTerrain } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
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

it('hydro2 map', () => {
  const half = Number(env.H2M_HALF ?? 150000);
  const cn = Number(env.H2M_N ?? 0);
  const ce = Number(env.H2M_E ?? 0);
  const step = Number(env.H2M_STEP ?? 300);
  const dir = env.H2M_DIR ?? '.';
  const tag = env.H2M_TAG ?? '';
  for (const seed of (env.H2M_SEEDS ?? '42').split(',').map(Number)) {
    setWorldSeed(seed);
    const h: any = hydrology;
    const n = Math.round((2 * half) / step);
    const ground = new Float64Array(n * n);
    const water = new Uint8Array(n * n);
    const s = makeSample();
    const lm = h.lakeMask;
    for (let y = 0; y < n; y++) {
      const north = cn + half - (y + 0.5) * step;
      for (let x = 0; x < n; x++) {
        const east = ce - half + (x + 0.5) * step;
        sampleTerrain(north, east, s);
        ground[y * n + x] = s.ground;
        const wet = Math.max(s.standing, s.river) > s.ground;
        water[y * n + x] = wet ? (s.river > s.ground ? 2 : lm.at(north, east) > -Infinity && lm.tarnHit ? 4 : 1) : 0;
      }
    }
    const rgb = new Uint8Array(n * n * 3);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const i = y * n + x;
        const hx = ground[y * n + Math.min(n - 1, x + 1)] - ground[y * n + Math.max(0, x - 1)];
        const hy = ground[Math.max(0, y - 1) * n + x] - ground[Math.min(n - 1, y + 1) * n + x];
        const shade = Math.min(1.25, Math.max(0.45, 0.9 + ((-hx + hy) / (2 * step)) * 0.9));
        let c = tint(ground[i]).map((v) => v * shade);
        if (water[i] === 1) c = ground[i] < -40 ? [30, 60, 140] : [55, 95, 175];
        if (water[i] === 2) c = [40, 110, 220];
        if (water[i] === 4) c = [120, 190, 250];
        rgb.set(c.map((v) => Math.max(0, Math.min(255, v))), i * 3);
      }
    }
    const put = (north: number, east: number, col: number[], r = 0): void => {
      const x = Math.floor((east - ce + half) / step);
      const y = Math.floor((cn + half - north) / step);
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < n && yy < n) rgb.set(col, (yy * n + xx) * 3);
      }
    };
    // Channels drawn over (the narrow streams vanish at this step otherwise), breaches in yellow.
    for (const r of h.rivers) {
      for (let i = 0; i < r.s.length; i++) {
        const b = r.breach?.[i] ?? 0;
        put(r.north[i], r.east[i], b > 0 ? [235, 200, 60] : r.kind === 1 ? [70, 130, 230] : [30, 90, 210]);
      }
    }
    for (const f of h.faults ?? []) for (let i = 0; i < f.north.length - 1; i++) for (let t = 0; t <= 1; t += step / 1000 / 2) put(f.north[i] + (f.north[i + 1] - f.north[i]) * t, f.east[i] + (f.east[i + 1] - f.east[i]) * t, [220, 40, 40]);
    const col: Record<string, number[]> = { fault: [255, 150, 0], hanging: [255, 0, 255], outlet: [0, 255, 255] };
    for (const f of h.falls ?? []) put(f.north, f.east, col[f.cause] ?? [255, 255, 255], Math.max(1, Math.round(300 / step)));
    const name = `${dir}/hydro2-map${tag}-${seed}.png`;
    fs.writeFileSync(name, png(n, n, rgb));
    console.log(`MAP ${name}: ${n} px, ${step} m/px`);
  }
  setWorldSeed(0);
});
