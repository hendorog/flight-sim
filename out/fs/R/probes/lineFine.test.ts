// Round T repairs, item 3: one line every LF_STEP m from LF_S0 to LF_S1 (seed LF_SEED, line LF_LINE): its water, half
// width, regime and pitch, the drawn ground at its centre and HW + 3 m either side, the terrain's water there, the
// approach and airfield blend weights.
import { it } from 'vitest';
import { hydrology, makeSample, sampleTerrain, terrainHeight } from '../../../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('line fine', () => {
  setWorldSeed(Number(env.LF_SEED ?? 777777));
  terrainHeight(0, 0);
  const li = Number(env.LF_LINE ?? 720);
  const r = hydrology.rivers![li] as unknown as { s: Float64Array; north: Float64Array; east: Float64Array; level: Float64Array; halfWidth: Float64Array; regime?: Uint8Array; pitchOn?: Float32Array; sigma?: Float32Array; cut: Float64Array; breach: Float64Array };
  const s = makeSample();
  const S0 = Number(env.LF_S0 ?? 0), S1 = Number(env.LF_S1 ?? 2800), ST = Number(env.LF_STEP ?? 10);
  let dry = 0;
  for (let sv = S0; sv <= Math.min(S1, r.s[r.s.length - 1]); sv += ST) {
    let i = 0;
    while (i < r.s.length - 2 && r.s[i + 1] < sv) i++;
    const f = Math.min(1, Math.max(0, (sv - r.s[i]) / ((r.s[i + 1] - r.s[i]) || 1)));
    const n = r.north[i] + f * (r.north[i + 1] - r.north[i]), e = r.east[i] + f * (r.east[i + 1] - r.east[i]);
    const W = r.level[i] + f * (r.level[i + 1] - r.level[i]);
    const hw = r.halfWidth[i];
    const tn0 = r.north[i + 1] - r.north[i], te0 = r.east[i + 1] - r.east[i];
    const tl = Math.hypot(tn0, te0) || 1, tn = tn0 / tl, te = te0 / tl;
    const g = (d: number) => { sampleTerrain(n + te * d, e - tn * d, s); return { g: s.ground, w: s.river, ap: s.approach, bl: s.airportBlend }; };
    const L = g(-(hw + 3)), R = g(hw + 3), C = g(0);
    if (!(C.w > C.g + 0.05)) dry += ST;
    console.log(`s ${sv.toFixed(0)} [${i}] at ${n.toFixed(0)},${e.toFixed(0)} water ${W.toFixed(2)} hw ${hw.toFixed(1)} reg ${r.regime?.[i] ?? '-'} pitch ${(r.pitchOn?.[i] ?? 0).toFixed(2)} cut ${r.cut[i].toFixed(1)} br ${r.breach[i].toFixed(1)} | centre ${C.g.toFixed(2)} (${C.w > C.g + 0.05 ? 'wet' : 'DRY'}) banks ${L.g.toFixed(2)} / ${R.g.toFixed(2)} | approach ${C.ap.toFixed(2)} blend ${C.bl.toFixed(2)}`);
  }
  console.log(`dry at the centre ${dry} m of ${S0}-${S1}`);
  setWorldSeed(0);
});
