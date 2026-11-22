// Checker T1: window independence and border agreement of rill patches where round T's backOver fired.
import { it } from 'vitest';
import { buildRillPatch, RILL_TEX } from '../../../../../src/world/terrain/rills';
import { setWorldSeed } from '../../../../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
const T = RILL_TEX;
const diff = (x: Uint8Array | null, y: Uint8Array | null): number => { if (!x || !y) return x === y ? 0 : -1; let c = 0; for (let i = 0; i < x.length; i += 4) if (x[i] !== y[i] || x[i + 1] !== y[i + 1] || x[i + 2] !== y[i + 2] || x[i + 3] !== y[i + 3]) c++; return c; };
const px = (t: Uint8Array, k: number, l: number): string => Array.from(t.subarray((l * T + k) * 4, (l * T + k) * 4 + 4)).join(',');
it('rill seams', () => {
  for (const spec of (env.PATCHES ?? '42:-53:-42,1:-54:58,777777:-51:-18,777777:-66:39').split(',')) {
    const [seed, pi, pj] = spec.split(':').map(Number);
    setWorldSeed(seed);
    const a = buildRillPatch({ pi, pj });
    const wide = buildRillPatch({ pi, pj }, 9, 3);
    const wider = buildRillPatch({ pi, pj }, 1, 23);
    const wider2 = buildRillPatch({ pi, pj }, 30, 30);
    const east = buildRillPatch({ pi: pi + 1, pj });
    const north = buildRillPatch({ pi, pj: pj + 1 });
    const west = buildRillPatch({ pi: pi - 1, pj });
    const south = buildRillPatch({ pi, pj: pj - 1 });
    let be = 0, bn = 0, bw = 0, bs = 0;
    if (a.texels && east.texels) for (let l = 0; l < T; l++) { if (px(a.texels, T - 2, l) !== px(east.texels, 0, l)) be++; if (px(a.texels, T - 1, l) !== px(east.texels, 1, l)) be++; }
    if (a.texels && north.texels) for (let k = 0; k < T; k++) { if (px(a.texels, k, T - 2) !== px(north.texels, k, 0)) bn++; if (px(a.texels, k, T - 1) !== px(north.texels, k, 1)) bn++; }
    if (a.texels && west.texels) for (let l = 0; l < T; l++) { if (px(west.texels, T - 2, l) !== px(a.texels, 0, l)) bw++; if (px(west.texels, T - 1, l) !== px(a.texels, 1, l)) bw++; }
    if (a.texels && south.texels) for (let k = 0; k < T; k++) { if (px(south.texels, k, T - 2) !== px(a.texels, k, 0)) bs++; if (px(south.texels, k, T - 1) !== px(a.texels, k, 1)) bs++; }
    console.log(`seed ${seed} patch ${pi},${pj}: km ${a.stats.km.toFixed(1)}; window diffs wide ${diff(a.texels, wide.texels)} wider ${diff(a.texels, wider.texels)} wider2 ${diff(a.texels, wider2.texels)}; border mismatches E ${be} N ${bn} W ${bw} S ${bs}`);
  }
  setWorldSeed(0);
});
