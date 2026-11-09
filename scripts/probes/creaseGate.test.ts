// creaseGate (round T, from inv-vpass' invVpassCrease): the drawn ground's slope breaks on the 250 m node lines in the
// threshold slopes' channel band (the checker: the band is drawn bilinearly, erosion.ts sampleErosion). Along E-W and
// N-S transects at 2 m, the slope jump over +-6 m at each sample, binned by its distance to the nearest node line; only
// samples in the band (debugMacro ch >= CG_CH) count. Gate: mean |jump| at 0-10 m from a node line against mid-cell
// (100-125 m), aim <= 1.5x.
// Transects: CG_N per seed, centred on hash-picked points in the band inside the seed's slope box (gates.sh BOXES), each
// 1.5 km long on a mid-cell line (offset 125 m), alternating E-W and N-S. Seed 42 also runs inv-vpass' three named
// transects (crease42.log: 0.056 against about 0.01, all samples).
//   CG_SEEDS=1,42,777777 npx vitest run --config scripts/probes/vitest.config.ts creaseGate --silent=false
import { it } from 'vitest';
import { makeSample, sampleTerrain, debugMacro, terrainHeight } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
import { hash2i } from '../../src/world/terrain/noise';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
const BOX: Record<number, [number, number, number]> = { 42: [-44250, 6250, 30000], 1: [1000, 109000, 30000], 777777: [-13000, 1000, 30000], 7: [0, 0, 30000] };
it('crease gate', () => {
  const CH = Number(env.CG_CH ?? 0.5);
  const NT = Number(env.CG_N ?? 24);
  for (const seed of (env.CG_SEEDS ?? '1,42,777777').split(',').map(Number)) {
    setWorldSeed(seed);
    terrainHeight(0, 0);
    const s = makeSample();
    const h = 2;
    const bins = new Array(13).fill(0), cnt = new Array(13).fill(0);
    const binsAll = new Array(13).fill(0), cntAll = new Array(13).fill(0);
    const run = (axis: 'N' | 'E', fix: number, a: number, b: number, bandOnly: boolean): void => {
      const at = (t: number): [number, number] => (axis === 'N' ? [fix, t] : [t, fix]);
      const pts: number[] = [], ch: number[] = [];
      for (let t = a; t <= b; t += h) { const [nn, ee] = at(t); sampleTerrain(nn, ee, s); pts.push(s.ground); ch.push(bandOnly ? debugMacro(nn, ee)?.s.ch ?? 0 : 1); }
      for (let i = 4; i < pts.length - 4; i++) {
        const sl = (pts[i] - pts[i - 3]) / (3 * h), sr = (pts[i + 3] - pts[i]) / (3 * h);
        const t = a + i * h;
        const off = ((t % 250) + 250) % 250;
        const k = Math.min(12, Math.floor(Math.min(off, 250 - off) / 10));
        const j = Math.abs(sr - sl);
        binsAll[k] += j; cntAll[k]++;
        if (ch[i] >= CH) { bins[k] += j; cnt[k]++; }
      }
    };
    const [bn, be, bh] = BOX[seed] ?? [0, 0, 30000];
    let made = 0;
    for (let q = 0; made < NT && q < 20000; q++) {
      const u = (hash2i(q, seed * 7 + 1) >>> 0) / 4294967296, v = (hash2i(q, seed * 7 + 2) >>> 0) / 4294967296;
      const n = bn - bh + 2 * bh * u, e = be - bh + 2 * bh * v;
      const d = debugMacro(n, e);
      if (!d || d.s.ch < 0.9) continue;
      const mid = (x: number): number => Math.round((x - 125) / 250) * 250 + 125;
      if (made % 2 === 0) run('N', mid(n), Math.round(e) - 750, Math.round(e) + 750, true);
      else run('E', mid(e), Math.round(n) - 750, Math.round(n) + 750, true);
      made++;
    }
    const mean = (B: number[], C: number[], k0: number, k1: number): number => { let a = 0, c = 0; for (let k = k0; k <= k1; k++) { a += B[k]; c += C[k]; } return a / Math.max(1, c); };
    const node = mean(bins, cnt, 0, 0), midc = mean(bins, cnt, 10, 12);
    console.log(`seed ${seed}: ${made} transects in the band (ch >= ${CH}, ${cnt.reduce((x, y) => x + y, 0)} samples): mean |jump| at a node line (0-10 m) ${node.toFixed(4)}, mid-cell (100-125 m) ${midc.toFixed(4)}: ratio ${(node / Math.max(1e-9, midc)).toFixed(2)} (aim <= 1.5)`);
    console.log(`seed ${seed}:   by distance to a node line (0-10,10-20,.. m): ${bins.map((v, k) => (v / Math.max(1, cnt[k])).toFixed(4)).join(' ')}`);
    if (seed === 42) {
      for (let k = 0; k < 13; k++) { binsAll[k] = 0; cntAll[k] = 0; }
      run('N', -11625, -41250, -39750, false); run('N', -11875, -41250, -39750, false); run('N', -12125, -41500, -40000, false);
      console.log(`seed 42: inv-vpass' three transects (all samples): node ${mean(binsAll, cntAll, 0, 0).toFixed(4)}, mid-cell ${mean(binsAll, cntAll, 10, 12).toFixed(4)}; by distance ${binsAll.map((v, k) => (v / Math.max(1, cntAll[k])).toFixed(4)).join(' ')}`);
    }
  }
  setWorldSeed(0);
});
