// Probe: how deep the water stands over the ground on fast reaches (level - ground across the channel), by regime and
// kind, and the sample spacing; tells how big a stone must be to break the surface.
//   SITES_SEED=42 npx vitest run --config scripts/probes/vitest.config.ts cascadeDepth --silent=false --disable-console-intercept
import { it } from 'vitest';
import { hydrology, makeSample, sampleTerrain } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';

const pct = (a: number[], p: number): number => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};

it('cascade depth', () => {
  const seed = Number(process.env.SITES_SEED ?? 42);
  setWorldSeed(seed);
  const rs = hydrology.rivers!;
  const smp = makeSample();
  for (const kind of [0, 1]) {
    for (const reg of [1, 2, 3]) {
      const depth: Record<string, number[]> = { c: [], h5: [], h9: [] };
      const sp: number[] = [];
      const hw: number[] = [];
      const grain: number[] = [];
      let k = 0;
      rs.forEach((r) => {
        if (r.kind !== kind) return;
        for (let i = 1; i + 1 < r.north.length; i++) {
          if (r.regime![i] !== reg) continue;
          if (k++ % 7) continue;
          const tn = r.north[i + 1] - r.north[i - 1];
          const te = r.east[i + 1] - r.east[i - 1];
          const l = Math.hypot(tn, te) || 1;
          const pe = -tn / l;
          const pn = te / l;
          sp.push(r.s[i + 1] - r.s[i]);
          hw.push(r.halfWidth[i]);
          grain.push(r.grain![i]);
          for (const [key, a] of [['c', 0], ['h5', 0.5], ['h9', 0.9]] as const) {
            for (const sgn of a ? [-1, 1] : [1]) {
              sampleTerrain(r.north[i] + pn * a * sgn * r.halfWidth[i], r.east[i] + pe * a * sgn * r.halfWidth[i], smp);
              depth[key].push(r.level[i] - smp.ground);
            }
          }
        }
      });
      const f = (a: number[]): string => [0.1, 0.5, 0.9].map((p) => pct(a, p).toFixed(2)).join('/');
      console.log(`kind ${kind} regime ${reg} n=${sp.length}: depth centre ${f(depth.c)} | 0.5hw ${f(depth.h5)} | 0.9hw ${f(depth.h9)} | spacing ${f(sp)} | hw ${f(hw)} | grain ${f(grain)}`);
    }
  }
  setWorldSeed(0);
});
