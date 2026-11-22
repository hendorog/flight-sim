// Probe (stage S): a stream's samples about a point (SPT="seed@north,east", SPT_HALF m either side along it): level,
// natural ground, drawn ground, half-width, end kind, joins, pool, pitchOn.
import { it } from 'vitest';
import { hydrology, makeSample, naturalHeight, sampleTerrain } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('stream point', () => {
  for (const spec of (env.SPT ?? '').split(';').filter(Boolean)) {
    const [sd, xy] = spec.split('@');
    const [pn, pe] = xy.split(',').map(Number);
    setWorldSeed(Number(sd));
    const sm = makeSample();
    let bd = Infinity, bl = -1, bk = -1;
    (hydrology.rivers ?? []).forEach((r: any, li) => {
      if (r.kind !== 1) return;
      for (let i = 0; i < r.s.length; i++) { const d = Math.hypot(r.north[i] - pn, r.east[i] - pe); if (d < bd) { bd = d; bl = li; bk = i; } }
    });
    const r: any = hydrology.rivers![bl];
    const mask: any = (hydrology as any).lakeMask;
    console.log(`SPT ${spec}: line ${bl} (${r.s.length} samples, length ${r.s[r.s.length - 1].toFixed(0)}, end ${r.end}, joins ${r.joins}, starts in lake ${mask.at(r.north[0], r.east[0]) > -Infinity}) sample ${bk} at ${bd.toFixed(0)} m`);
    const half = Number(env.SPT_HALF ?? 300);
    for (let i = 0; i < r.s.length; i++) {
      if (Math.abs(r.s[i] - r.s[bk]) > half) continue;
      sampleTerrain(r.north[i], r.east[i], sm);
      console.log(`SPT  i ${i} s ${r.s[i].toFixed(0)} lvl ${r.level[i].toFixed(1)} nat ${naturalHeight(r.north[i], r.east[i]).toFixed(1)} drawn ${sm.ground.toFixed(1)} hw ${r.halfWidth[i].toFixed(1)} cut ${r.cut[i].toFixed(1)} br ${r.breach[i].toFixed(0)} g ${r.gradient[i].toFixed(3)} on ${r.pitchOn ? r.pitchOn[i] : '-'} wet ${mask.at(r.north[i], r.east[i]) > -Infinity}`);
    }
  }
  setWorldSeed(0);
});
