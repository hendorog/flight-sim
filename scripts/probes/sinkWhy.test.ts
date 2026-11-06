// Probe (A1b): what the detail sinks of the rill heads sit on: the gully octave sum g there, the eroded macro
// ground's slope, the gully depths in the troughs (kCap) and on the spurs (kFull), and the knob amplitude; and whether
// the sink is still one on the ground without the small relief (naturalHeightSmooth).
//   RILL_WINS='42@-23664,71632 ...' SW_HALF=6000
import { it } from 'vitest';
import { gullyProbe as gullyDebug, hydrology, naturalHeight, naturalHeightCoarse, naturalHeightSmooth } from '../../src/world/terrain/heightfield';
import type { FlowHit } from '../../src/world/terrain/hydrology';
import { setWorldSeed } from '../../src/world/worldSeed';
import { accumulate, descend, raster, spillDepth } from './rillGrid';

const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
const hit: FlowHit = { dist: Infinity, side: 0, line: -1, kind: 0, index: 0, s: 0, level: 0, halfWidth: 0, gradient: 0, steepness: 0, regime: 0, speed: 0, dirN: 0, dirE: 0 };
const q = (a: number[], f: number): string => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(f * a.length))].toFixed(2) : '-');

it('sink why', () => {
  const half = Number(env.SW_HALF ?? 6000);
  const step = 16;
  const wins = (env.RILL_WINS ?? '42@-23664,71632').split(/\s+/).map((w) => { const [sd, at] = w.split('@'); const [n, e] = at.split(',').map(Number); return { seed: Number(sd), n, e }; });
  for (const w of wins) {
    setWorldSeed(w.seed);
    const cn = Math.round(w.n / step) * step, ce = Math.round(w.e / step) * step;
    const g = raster(cn, ce, half, step);
    descend(g, 6, 2);
    accumulate(g);
    const n = g.n;
    const big = new Uint8Array(n * n);
    for (let i = 0; i < n * n; i++) if (g.area[i] >= 0.05 && g.to[i] >= 0) big[g.to[i]] = 1;
    const inner = (i: number): boolean => { const x = i % n, y = (i / n) | 0; return x > n / 4 && x < (3 * n) / 4 && y > n / 4 && y < (3 * n) / 4; };
    const sinks = new Map<number, number>();
    let heads = 0;
    for (let i = 0; i < n * n; i++) {
      if (g.area[i] < 0.05 || big[i] || g.water[i] || !inner(i)) continue;
      heads++;
      let j = i;
      for (;;) {
        if (g.water[j]) break;
        hydrology.queryFlow!(g.north0 - ((j / n) | 0) * step, g.east0 + (j % n) * step, hit);
        if (hit.line >= 0 && hit.dist <= hit.halfWidth + step + 5) break;
        const t = g.to[j];
        if (t === -2) { sinks.set(j, (sinks.get(j) ?? 0) + 1); break; }
        if (t < 0) break;
        j = t;
      }
    }
    const rows: string[] = [];
    const cls: Record<string, number> = {};
    for (const [j, cnt] of [...sinks.entries()].sort((a, b) => b[1] - a[1])) {
      const north = g.north0 - ((j / n) | 0) * step, east = g.east0 + (j % n) * step;
      // Macro basin? (coarse ground filled about the sink, 1 km box)
      let lo = Infinity;
      const hc = naturalHeightCoarse(north, east);
      let rimC = Infinity;
      for (let a = 0; a < 32; a++) { const t = (a / 32) * 2 * Math.PI; let mx = -Infinity; for (let r = 100; r <= 1500; r += 100) mx = Math.max(mx, naturalHeightCoarse(north + r * Math.cos(t), east + r * Math.sin(t))); rimC = Math.min(rimC, mx); }
      void lo;
      const macro = rimC > hc + 0.25;
      naturalHeight(north, east);
      const d = { ...gullyDebug };
      const sp = spillDepth(g, j, 60, 80);
      // Same pit on the smooth ground (no small relief)? A 9x9 check: is the sink cell's smooth height the lowest within 3 cells?
      const hs = naturalHeightSmooth(north, east);
      let smoothPit = true;
      for (let a = -3; a <= 3 && smoothPit; a++) for (let b = -3; b <= 3; b++) { if (!a && !b) continue; if (naturalHeightSmooth(north + a * step, east + b * step) < hs) { smoothPit = false; break; } }
      const c = macro ? 'macro' : smoothPit ? (d.g < 0 ? 'gully-trough' : 'gully-spur') : (d.g < 0 ? 'knob-trough' : 'knob-spur');
      cls[c] = (cls[c] ?? 0) + cnt;
      if (c !== 'macro') { const fb = d.fall < 0.02 ? 'f<.02' : d.fall < 0.05 ? 'f<.05' : d.fall < 0.1 ? 'f<.1' : 'f>=.1'; cls[fb] = (cls[fb] ?? 0) + cnt; }
      if (rows.length < 25) rows.push(`  ${north.toFixed(0)},${east.toFixed(0)} heads ${cnt} ${c} rise ${sp.rise.toFixed(1)} c0 ${d.c0.toFixed(2)} A0 ${d.A0.toFixed(2)} g ${d.g.toFixed(2)} fall ${d.fall.toFixed(3)} kCap ${d.kCap.toFixed(1)} kFull ${d.kFull.toFixed(1)}`);
    }
    console.log(`SINKWHY seed ${w.seed} ${cn},${ce}: heads ${heads}, sinks ${sinks.size}; heads by class ${JSON.stringify(cls)}\n${rows.join('\n')}`);
  }
  setWorldSeed(0);
});
