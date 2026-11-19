// Braids: how much river axis each form of the braid share would braid (BS_SEEDS), from the law's own reach state on
// every river axis sample (formProbe): km by catchment class with share > 0.5, and the floor over the belt / thread.
// V0 is 1d7825d's share (with the size gate BED_BIG, smooth(100, 1000, A)); V3 is the share formOf now gives.
import { it } from 'vitest';
import { terrainHeight } from '../../src/world/terrain/heightfield';
import { formProbe } from '../../src/world/terrain/riverNetwork';
import { formOf, smooth } from '../../src/world/terrain/channelForm';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('braid share variants', () => {
  for (const seed of (env.BS_SEEDS ?? '42').split(',').map(Number)) {
    const cls = [0, 30, 100, 300, 1000, 3000, 1e9];
    const km = (): number[] => cls.slice(1).map(() => 0);
    const tot = km();
    const v0 = km();
    const v1 = km();
    const v2 = km();
    const v3 = km();
    const piOver = km();
    const fb: number[] = [];
    const fw: number[] = [];
    formProbe.on = (_li, a) => {
      for (let i = 1; i < a.north.length; i++) {
        const ds = (a.s[i] - a.s[i - 1]) / 1000;
        const A = a.area[i];
        const F = Math.max(10, a.roomL[i] + a.roomR[i]);
        const f = formOf(A, a.S[i], F);
        const c = cls.findIndex((x, k) => A >= x && A < cls[k + 1]);
        tot[c] += ds;
        const b0 = smooth(1, 1.5, f.pi) * (1 - f.sigma) * smooth(0.5, 1.5, F / f.B) * smooth(100, 1000, A);
        if (b0 > 0.5) v0[c] += ds;
        const conf = smooth(3, 6, F / f.Ws);
        const b1 = smooth(1, 1.5, f.pi) * (1 - f.sigma) * conf * smooth(100, 1000, A);
        const b2 = smooth(1, 1.5, f.pi) * (1 - f.sigma) * conf;
        if (b1 > 0.5) v1[c] += ds;
        if (b2 > 0.5) v2[c] += ds;
        const b3 = smooth(1, 1.5, f.pi) * (1 - f.sigma) * smooth(0.5, 1.5, F / f.B);
        if (b3 > 0.5) v3[c] += ds;
        if (f.pi > 1) {
          piOver[c] += ds;
          fb.push(F / f.B);
          fw.push(F / f.Ws);
        }
      }
    };
    setWorldSeed(seed);
    terrainHeight(0, 0);
    formProbe.on = undefined;
    const r = (v: number[]): string => v.map((x) => x.toFixed(0).padStart(6)).join(' ');
    const q = (v: number[], p: number): string => (v.length ? v.sort((x, y) => x - y)[Math.floor(p * (v.length - 1))].toFixed(2) : '-');
    console.log(`BS seed ${seed} classes A km2 ${cls.slice(0, -1).join('/')}+`);
    console.log(`BS seed ${seed} axis km        ${r(tot)}`);
    console.log(`BS seed ${seed} pi > 1 km      ${r(piOver)}`);
    console.log(`BS seed ${seed} V0 (F/B, big)  ${r(v0)}`);
    console.log(`BS seed ${seed} V1 (F/Ws, big) ${r(v1)}`);
    console.log(`BS seed ${seed} V2 (F/Ws)      ${r(v2)}`);
    console.log(`BS seed ${seed} V3 (F/B, any A) ${r(v3)}`);
    console.log(`BS seed ${seed} pi>1: F/B p10/50/90 ${q(fb, 0.1)}/${q(fb, 0.5)}/${q(fb, 0.9)}  F/Ws ${q(fw, 0.1)}/${q(fw, 0.5)}/${q(fw, 0.9)}`);
  }
  setWorldSeed(0);
});
