// Probe (verify3): slopes either side of a suspected seam (SP_AT='seed@north,east', SP_AXIS e|n): the detail ground,
// the macro fields (cached and exact) and the erosion sample, one-sided differences over SP_H m.
import { it } from 'vitest';
import * as HF from '../../src/world/terrain/heightfield';
import { macroAt, macroCachedAt } from '../../src/world/terrain/seededLayout';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('seam probe', () => {
  const [sd, p] = (env.SP_AT ?? '777777@-105500,37250').split('@');
  const [n0, e0] = p.split(',').map(Number);
  setWorldSeed(Number(sd));
  const H = Number(env.SP_H ?? 2);
  const ax = env.SP_AXIS ?? 'e';
  const at = (d: number): [number, number] => (ax === 'e' ? [n0, e0 + d] : [n0 + d, e0]);
  const fields: Record<string, (n: number, e: number) => number> = {
    ground: (n, e) => HF.naturalHeight(n, e),
    ...Object.fromEntries(['inland', 'uplift', 'hilly', 'foothill'].map((k) => [`exact.${k}`, (n: number, e: number) => (macroAt(n, e, {} as never) as unknown as Record<string, number>)[k]])),
    ...Object.fromEntries(['inland', 'uplift', 'hilly', 'foothill'].map((k) => [`cached.${k}`, (n: number, e: number) => (macroCachedAt(n, e, {} as never) as unknown as Record<string, number>)[k]])),
  };
  for (const [k, f] of Object.entries(fields)) {
    const v = [-2 * H, -H, 0, H, 2 * H].map((d) => f(...at(d)));
    const sl = (v[1] - v[0]) / H, sr = (v[4] - v[3]) / H, sm1 = (v[2] - v[1]) / H, sm2 = (v[3] - v[2]) / H;
    console.log(`SP ${k}: slopes ${sl.toExponential(3)} ${sm1.toExponential(3)} | ${sm2.toExponential(3)} ${sr.toExponential(3)}  jump ${((sr - sl)).toExponential(2)}`);
  }
  setWorldSeed(0);
});
