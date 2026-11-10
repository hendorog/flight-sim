// Round V A3r: each river channel (kind 0) against its own valley (NetworkQuery.valleys for its line): how far the
// channel lies past its swing (belt + half-width, the floor the valley carve keeps), every ~50 m. Km past the swing, past
// it by SWING_KEEP (70 m: the carve's floor ends there), and the worst sites. BO_SEEDS.
import { it } from 'vitest';
import { hydrology, terrainHeight } from '../../src/world/terrain/heightfield';
import type { ValleyNear } from '../../src/world/terrain/hydrology';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('belt out', () => {
  for (const seed of (env.BO_SEEDS ?? '1,42,777777').split(',').map(Number)) {
    setWorldSeed(seed);
    terrainHeight(0, 0);
    const net = hydrology.network!;
    const vs: ValleyNear[] = [];
    let km0 = 0, km70 = 0, tot = 0;
    const worst: Array<[number, string]> = [];
    (hydrology.rivers ?? []).forEach((r, li) => {
      if ((r.kind ?? 0) !== 0) return;
      let last = -1e9;
      for (let i = 0; i < r.north.length; i++) {
        if (r.s[i] - last < 50) continue;
        last = r.s[i];
        tot += 0.05;
        const nv = net.valleys(r.north[i], r.east[i], vs);
        // (On any valley's floor - its own, or its parent's where a tributary runs to the parent's channel - is on a floor:
        // the floodplain, or the swing and SWING_KEEP, whichever reaches further, as the carve keeps it.)
        let own: ValleyNear | null = null;
        let past = Infinity;
        for (let k = 0; k < nv; k++) {
          const p = vs[k].dist - Math.max(vs[k].floodplain, vs[k].swing + 70) + 70;
          if (p < past) { past = p; own = vs[k]; }
        }
        if (!own) continue;
        if (past > 0) km0 += 0.05;
        if (past > 70) {
          km70 += 0.05;
          worst.push([past, `line ${li} at ${r.north[i].toFixed(0)},${r.east[i].toFixed(0)}: ${own.dist.toFixed(0)} m from the axis of ${own.line}, swing ${own.swing.toFixed(0)}, floodplain ${own.floodplain.toFixed(0)}, level ${r.level[i].toFixed(1)}`]);
        }
      }
    });
    worst.sort((a, b) => b[0] - a[0]);
    const seen: string[] = [];
    const top = worst.filter(([, w]) => { const k = w.split(':')[0]; if (seen.includes(k)) return false; seen.push(k); return true; }).slice(0, 8);
    console.log(`BO seed ${seed}: rivers ${tot.toFixed(0)} km; channel past the floor's edge less 70 m ${km0.toFixed(1)} km, past the floor's edge (on no valley's floor) ${km70.toFixed(1)} km`);
    for (const [p, w] of top) console.log(`BO   ${p.toFixed(0)} m past: ${w}`);
  }
  setWorldSeed(0);
});
