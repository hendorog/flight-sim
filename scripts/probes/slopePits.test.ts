// Foundation stage 4: where the closed pits of a 20 m export come from. For each pit (tools/pits.py's FILE.pits.json),
// the depth of the closed hollow in a window about it on three surfaces: the coarse ground (naturalHeightCoarse: the
// macro ground with the threshold hillslopes, no gullies), the natural ground (with gullies and small relief) and the
// terrain (with rivers and streams carved), plus the pass's fields at the point.
//   PIT_SEED=42 PIT_FILE=out/f4/data/seeded/seed42_-44250_6250-t1.f32.pits.json PIT_N=60 SLOPE_PARAMS='{}' \
//     npx vitest run --config scripts/probes/vitest.config.ts slopePits
import { it } from 'vitest';
import { makeSample, naturalHeight, naturalHeightCoarse, naturalHeightSmooth, sampleTerrain, debugMacro } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
import { setSlopeParams } from '../../src/world/terrain/hillslopes';

const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as { readFileSync(p: string, e: string): string };
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;

/** Depth of the closed hollow at the window's centre region (priority flood from the window's rim), m. */
function hollowDepth(f: (n: number, e: number) => number, cn: number, ce: number, half = 500, step = 20): number {
  const m = Math.round((2 * half) / step) + 1;
  const z = new Float64Array(m * m);
  for (let y = 0; y < m; y++) for (let x = 0; x < m; x++) z[y * m + x] = f(cn - half + y * step, ce - half + x * step);
  const fl = new Float64Array(m * m).fill(Infinity);
  const done = new Uint8Array(m * m);
  // Simple O(n^2 log) flood with a sorted array heap.
  const heap: number[] = [];
  const push = (q: number): void => {
    heap.push(q);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (fl[heap[p]] <= fl[heap[i]]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = (): number => {
    const top = heap[0];
    const last = heap.pop() as number;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let s = i;
        if (l < heap.length && fl[heap[l]] < fl[heap[s]]) s = l;
        if (r < heap.length && fl[heap[r]] < fl[heap[s]]) s = r;
        if (s === i) break;
        [heap[s], heap[i]] = [heap[i], heap[s]];
        i = s;
      }
    }
    return top;
  };
  for (let y = 0; y < m; y++) for (let x = 0; x < m; x++) if (y === 0 || x === 0 || y === m - 1 || x === m - 1) {
    const q = y * m + x;
    fl[q] = z[q];
    done[q] = 1;
    push(q);
  }
  while (heap.length) {
    const c = pop();
    const y = (c / m) | 0;
    const x = c - y * m;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const yy = y + dy;
      const xx = x + dx;
      if (yy < 0 || xx < 0 || yy >= m || xx >= m) continue;
      const q = yy * m + xx;
      if (done[q]) continue;
      done[q] = 1;
      fl[q] = Math.max(z[q], fl[c]);
      push(q);
    }
  }
  let best = 0;
  const r = Math.round(100 / step);
  const c0 = (m - 1) / 2;
  for (let y = c0 - r; y <= c0 + r; y++) for (let x = c0 - r; x <= c0 + r; x++) best = Math.max(best, fl[y * m + x] - z[y * m + x]);
  return best;
}

it('slope pits', () => {
  if (env.SLOPE_PARAMS) setSlopeParams(JSON.parse(env.SLOPE_PARAMS));
  setWorldSeed(env.PIT_SEED ?? '42');
  const pits = JSON.parse(fs.readFileSync(env.PIT_FILE as string, 'utf8')) as { north: number; east: number; depth: number; ha: number; z: number }[];
  const s = makeSample();
  const terrain = (n: number, e: number): number => {
    sampleTerrain(n, e, s);
    return Math.max(s.ground, s.standing, s.river);
  };
  const lim = Number(env.PIT_N ?? 60);
  const cls: Record<string, number> = {};
  console.log('north east depth | coarse smooth natural terrain | m ch f | river stream');
  for (const p of pits.slice(0, lim)) {
    const dc = hollowDepth(naturalHeightCoarse, p.north, p.east);
    const ds = hollowDepth(naturalHeightSmooth, p.north, p.east);
    const dn = hollowDepth(naturalHeight, p.north, p.east);
    const dt = hollowDepth(terrain, p.north, p.east);
    const dm = debugMacro(p.north, p.east);
    const flow = null as unknown;
    sampleTerrain(p.north, p.east, s);
    const k = dc > 5 ? 'coarse' : ds > 5 ? 'gullies' : dn > 5 ? 'small' : dt > 5 ? 'carve' : 'none';
    cls[k] = (cls[k] ?? 0) + 1;
    console.log(`${p.north} ${p.east} ${p.depth} | ${dc.toFixed(1)} ${ds.toFixed(1)} ${dn.toFixed(1)} ${dt.toFixed(1)} | ${dm ? `${dm.s.m.toFixed(2)} ${dm.s.ch.toFixed(2)} ${dm.s.f.toFixed(2)}` : '-'} | ${s.riverDist.toFixed(0)}   ${k}`);
  }
  console.log('classes', JSON.stringify(cls));
});
