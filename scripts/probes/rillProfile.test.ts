// Rill profiles (probe): the ground along rills that end in a closed hollow (rillFates 'sink'), head to pit, then on
// over the lowest saddle (a flood from the pit) to the first lower ground beyond: the beading of the gully floors.
// Followed on past every hollow (over its lowest saddle) to water, a line or the edge. Text (distance, height) and a
// PNG per profile (black: downhill; red: from a pit back up over its saddle; ticks every 50 m and 1 km).
//   RILL_SEED=42 RILL_N=-23664 RILL_E=71632 RILL_HALF=4000 RILL_STEP=16 RILL_PROFILES=3 RILL_DIR=out/rills
import { it } from 'vitest';
import { hydrology } from '../../src/world/terrain/heightfield';
import type { FlowHit } from '../../src/world/terrain/hydrology';
import { setWorldSeed } from '../../src/world/worldSeed';
import { png } from './png';
import { accumulate, descend, hollow, raster, spillDepth } from './rillGrid';

const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as { writeFileSync(p: string, d: Uint8Array | string): void; mkdirSync(p: string, o: object): void };
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
const hit: FlowHit = { dist: Infinity, side: 0, line: -1, kind: 0, index: 0, s: 0, level: 0, halfWidth: 0, gradient: 0, steepness: 0, regime: 0, speed: 0, dirN: 0, dirE: 0 };

it('rill profiles', () => {
  const seed = Number(env.RILL_SEED ?? 42);
  const cn = Number(env.RILL_N ?? -23664), ce = Number(env.RILL_E ?? 71632);
  const half = Number(env.RILL_HALF ?? 4000), step = Number(env.RILL_STEP ?? 16);
  const count = Number(env.RILL_PROFILES ?? 3);
  const dir = env.RILL_DIR ?? 'out/rills';
  fs.mkdirSync(dir, { recursive: true });
  setWorldSeed(seed);
  const g = raster(cn, ce, half, step);
  descend(g, 6, 2);
  accumulate(g);
  const n = g.n;
  const big = new Uint8Array(n * n);
  for (let i = 0; i < n * n; i++) if (g.area[i] >= 0.05 && g.to[i] >= 0) big[g.to[i]] = 1;
  // Sink-ending rills from heads in the inner half, the longest first.
  const paths: number[][] = [];
  for (let i = 0; i < n * n; i++) {
    const x = i % n, y = (i / n) | 0;
    if (g.area[i] < 0.05 || big[i] || g.water[i] || x < n / 4 || x > (3 * n) / 4 || y < n / 4 || y > (3 * n) / 4 || hollow(g, i, 2) <= 0.3) continue;
    const path = [i];
    let j = i;
    let ok = true;
    for (;;) {
      hydrology.queryFlow!(g.north0 - ((j / n) | 0) * step, g.east0 + (j % n) * step, hit);
      if (g.water[j] || (hit.line >= 0 && hit.dist <= hit.halfWidth + step + 5)) { ok = false; break; }
      const t = g.to[j];
      if (t === -2) break;
      if (t < 0) { ok = false; break; }
      j = t;
      path.push(j);
    }
    if (ok) paths.push(path);
  }
  paths.sort((a, b) => b.length - a.length);
  // Spread: the longest, then ones whose pit is 1 km from those already taken.
  const picked: number[][] = [];
  for (const p of paths) {
    if (picked.length >= count) break;
    const e = p[p.length - 1];
    if (picked.every((q) => Math.hypot((q[q.length - 1] % n) - (e % n), ((q[q.length - 1] / n) | 0) - ((e / n) | 0)) * step > 1000)) picked.push(p);
  }
  const lines: string[] = [];
  const prev = new Map<number, number>();
  const handed = (j: number): boolean => {
    hydrology.queryFlow!(g.north0 - ((j / n) | 0) * step, g.east0 + (j % n) * step, hit);
    return g.water[j] === 1 || (hit.line >= 0 && hit.dist <= hit.halfWidth + step + 5);
  };
  picked.forEach((p, k) => {
    // Follow on past every sink: over its lowest saddle (a flood from the pit) to the first lower ground, then down
    // again, until water or a line, the window's edge, 12 pits or 12 km.
    const all = [...p];
    const pitAt: number[] = [];
    const rises: number[] = [];
    let end = 'pits';
    for (;;) {
      const pit = all[all.length - 1];
      pitAt.push(all.length - 1);
      const sp = spillDepth(g, pit, 300, 300, prev);
      if (sp.to < 0) { end = 'no spill'; break; }
      rises.push(sp.rise);
      const over: number[] = [];
      for (let c = sp.to; c >= 0 && c !== pit; c = prev.get(c) ?? -1) over.push(c);
      over.reverse();
      all.push(...over);
      let j = sp.to;
      let stop = '';
      for (;;) {
        if (handed(j)) { stop = 'water/line'; break; }
        const t = g.to[j];
        if (t === -2) break;
        if (t < 0) { stop = 'edge'; break; }
        j = t;
        all.push(j);
      }
      if (stop) { end = stop; break; }
      if (pitAt.length >= 12 || all.length * step > 12000) break;
    }
    const dist: number[] = [0];
    for (let q = 1; q < all.length; q++) dist.push(dist[q - 1] + Math.hypot((all[q] % n) - (all[q - 1] % n), ((all[q] / n) | 0) - ((all[q - 1] / n) | 0)) * step);
    const hs = all.map((c) => g.ground[c]);
    lines.push(`profile ${k}: head ${(g.north0 - ((p[0] / n) | 0) * step).toFixed(0)},${(g.east0 + (p[0] % n) * step).toFixed(0)} at ${hs[0].toFixed(0)} m; ${pitAt.length} closed hollows over ${dist[dist.length - 1].toFixed(0)} m (pits at ${pitAt.map((q) => `${dist[q].toFixed(0)} m`).join(', ')}; spill rises ${rises.map((r) => r.toFixed(1)).join(', ')} m); ends: ${end} at ${hs[hs.length - 1].toFixed(0)} m`);
    lines.push('  ' + all.map((c, q) => `${dist[q].toFixed(0)}:${hs[q].toFixed(1)}`).join(' '));
    const W = 900, H = 300;
    const rgb = new Uint8Array(W * H * 3).fill(255);
    const lo = Math.min(...hs), hi = Math.max(...hs);
    const X = (d: number): number => Math.round(10 + ((W - 20) * d) / Math.max(1, dist[dist.length - 1]));
    const Y = (h: number): number => Math.round(H - 10 - ((H - 20) * (h - lo)) / Math.max(1, hi - lo));
    const pits = new Set(pitAt);
    let climbing = false;
    for (let q = 0; q + 1 < all.length; q++) {
      if (pits.has(q)) climbing = true;
      if (climbing && hs[q + 1] < hs[pitAt[[...pits].filter((v) => v <= q).length - 1]]) climbing = false;
      const c = climbing ? [220, 0, 0] : [0, 0, 0];
      for (let t = 0; t <= 20; t++) {
        const x = X(dist[q] + ((dist[q + 1] - dist[q]) * t) / 20), y = Y(hs[q] + ((hs[q + 1] - hs[q]) * t) / 20);
        for (let dy = -1; dy <= 1; dy++) if (y + dy >= 0 && y + dy < H && x >= 0 && x < W) rgb.set(c, ((y + dy) * W + x) * 3);
      }
    }
    for (let h = Math.ceil(lo / 50) * 50; h <= hi; h += 50) for (let x = 0; x < 12; x++) rgb.set([120, 120, 120], (Y(h) * W + x) * 3);
    for (let d = 0; d <= dist[dist.length - 1]; d += 1000) for (let y = H - 8; y < H; y++) rgb.set([120, 120, 120], (y * W + X(d)) * 3);
    fs.writeFileSync(`${dir}/profile-s${seed}-${k}.png`, png(W, H, rgb));
  });
  fs.writeFileSync(`${dir}/profiles-s${seed}.txt`, lines.join('\n') + '\n');
  console.log(lines.filter((l) => l.startsWith('profile')).join('\n'));
  setWorldSeed(0);
});
