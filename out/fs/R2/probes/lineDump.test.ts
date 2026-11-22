// Round T repairs 2: one line's samples (seed LD_SEED, line LD_LINE) from s LD_S0 to its end (or LD_S1): water, cut,
// breach, half-width, natural ground at the centre and its banks (hw + 25 m either side, as AT_THE_SURFACE's holds()),
// the drawn ground at the centre and hw + 3 m either side, the lake mask's level and pool there (with and without the
// natural ground), the terrain's water (river, standing). Plus the line's end, joins, and the lines joining it.
import { it } from 'vitest';
import { hydrology, makeSample, naturalHeight, sampleTerrain, terrainHeight } from '../../../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('line dump', () => {
  setWorldSeed(Number(env.LD_SEED ?? 7));
  terrainHeight(0, 0);
  const L = hydrology.rivers!;
  const mask = hydrology.lakeMask! as unknown as { at(n: number, e: number, g?: number): number; poolHit: number; pools: Array<{ level: number }> };
  for (const li of (env.LD_LINE ?? '567').split(',').map(Number)) {
    const r = L[li] as unknown as { s: Float64Array; north: Float64Array; east: Float64Array; level: Float64Array; halfWidth: Float64Array; cut: Float64Array; breach: Float64Array; joins: number; end?: string; kind: number; area?: Float64Array };
    const n = r.s.length;
    const joiners: string[] = [];
    L.forEach((q, qi) => { if ((q as unknown as { joins: number }).joins === li) joiners.push(`${qi}`); });
    console.log(`line ${li} kind ${r.kind} samples ${n} s ${r.s[n - 1].toFixed(0)} end ${r.end ?? '-'} joins ${r.joins}; joined by ${joiners.join(' ')}`);
    const S0 = Number(env.LD_S0 ?? Math.max(0, r.s[n - 1] - 3000)), S1 = Number(env.LD_S1 ?? Infinity);
    const s = makeSample();
    for (let i = 0; i < n; i++) {
      if (r.s[i] < S0 || r.s[i] > S1) continue;
      const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
      const tn0 = r.north[b] - r.north[a], te0 = r.east[b] - r.east[a];
      const tl = Math.hypot(tn0, te0) || 1, tn = tn0 / tl, te = te0 / tl;
      const hw = r.halfWidth[i];
      const nat = (d: number) => naturalHeight(r.north[i] + te * d, r.east[i] - tn * d);
      const drawn = (d: number) => { sampleTerrain(r.north[i] + te * d, r.east[i] - tn * d, s); return s.ground; };
      const lv = mask.at(r.north[i], r.east[i]);
      const pool = lv > -Infinity ? mask.poolHit : -1;
      const lvN = mask.at(r.north[i], r.east[i], naturalHeight(r.north[i], r.east[i]));
      sampleTerrain(r.north[i], r.east[i], s);
      const C = s.ground, W = s.river, St = s.standing;
      console.log(`  i ${i} s ${r.s[i].toFixed(0)} at ${r.north[i].toFixed(0)},${r.east[i].toFixed(0)} water ${r.level[i].toFixed(2)} cut ${r.cut[i].toFixed(1)} br ${r.breach[i].toFixed(1)} hw ${hw.toFixed(1)} | natural ${nat(0).toFixed(1)} banks25 ${nat(-(hw + 25)).toFixed(1)} / ${nat(hw + 25).toFixed(1)} | drawn ${C.toFixed(1)} banks3 ${drawn(-(hw + 3)).toFixed(1)} / ${drawn(hw + 3).toFixed(1)} | mask ${lv > -Infinity ? lv.toFixed(1) + ' pool ' + pool : '-'}${lvN > -Infinity && !(lv > -Infinity) ? ' (with natural ' + lvN.toFixed(1) + ')' : ''} | terrain water ${W > -Infinity ? W.toFixed(1) : '-'} standing ${St.toFixed(1)}`);
    }
  }
  setWorldSeed(0);
});
