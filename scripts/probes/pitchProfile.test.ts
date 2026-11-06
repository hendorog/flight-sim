// Probe (stage S): a stream's long profile about a point (the stream nearest it): per sample the arc length, water
// level, drawn ground under the centreline (sampleTerrain), natural ground, unit coordinate, pitchOn, steepness ->
// JSON lines for out/s/profile.py.  SP_PTS="name@seed@north,east;..." SP_HALF=400 SP_OUT=out/s/prof-after.jsonl
import { it } from 'vitest';
import { appendFileSync, writeFileSync } from 'node:fs';
import { hydrology, makeSample, naturalHeight, sampleTerrain } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('pitch profile', () => {
  const out = env.SP_OUT ?? 'out/s/prof.jsonl';
  writeFileSync(out, '');
  const half = Number(env.SP_HALF ?? 400);
  const smp = makeSample();
  for (const pt of (env.SP_PTS ?? '').split(';').filter(Boolean)) {
    const [name, sd, xy] = pt.split('@');
    const [pn, pe] = xy.split(',').map(Number);
    setWorldSeed(Number(sd));
    let bd = Infinity, bl = -1, bk = -1;
    (hydrology.rivers ?? []).forEach((r: any, li) => {
      if (r.kind !== 1) return;
      for (let i = 0; i < r.s.length; i++) {
        const d = Math.hypot(r.north[i] - pn, r.east[i] - pe);
        if (d < bd) { bd = d; bl = li; bk = i; }
      }
    });
    const r: any = hydrology.rivers![bl];
    const s0 = r.s[bk] - half, s1 = r.s[bk] + half;
    const rows: number[][] = [];
    for (let i = 0; i < r.s.length; i++) {
      if (r.s[i] < s0 || r.s[i] > s1) continue;
      sampleTerrain(r.north[i], r.east[i], smp);
      rows.push([r.s[i], r.level[i], smp.ground, naturalHeight(r.north[i], r.east[i]), r.sigma ? r.sigma[i] : -1, r.pitchOn ? r.pitchOn[i] : 0, r.steepness[i], r.halfWidth[i], r.gradient[i]]);
    }
    // The drawn ground every 1 m along (centreline), for the bed between the samples.
    const fine: number[][] = [];
    for (let i = 0; i + 1 < r.s.length; i++) {
      if (r.s[i + 1] < s0 || r.s[i] > s1) continue;
      const len = r.s[i + 1] - r.s[i];
      for (let t = 0; t < len; t += 1) {
        const f = t / len;
        const n = r.north[i] + (r.north[i + 1] - r.north[i]) * f, e = r.east[i] + (r.east[i + 1] - r.east[i]) * f;
        sampleTerrain(n, e, smp);
        fine.push([r.s[i] + t, smp.ground, r.level[i] + (r.level[i + 1] - r.level[i]) * f]);
      }
    }
    appendFileSync(out, JSON.stringify({ name, seed: Number(sd), line: bl, dist: bd, rows, fine }) + '\n');
    console.log(`SPROF ${name}: line ${bl} at ${bd.toFixed(0)} m, ${rows.length} samples`);
  }
  setWorldSeed(0);
});
