// Probe (debug): river samples whose water stands > 2 m over the lower bank (riverBed's test) and the nearest stream
// to that bank point: its distance, level and kind of end.
import { it } from 'vitest';
import { hydrology, makeSample, sampleTerrain } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
it('bank cause', () => {
  setWorldSeed(Number(process.env.BC_SEED ?? 42));
  const s = makeSample();
  const lines = hydrology.rivers!;
  const hist = new Map<string, number>();
  let shown = 0;
  for (const r of lines) {
    if ((r.kind ?? 0) !== 0) continue;
    for (let k = 1; k < r.north.length - 1; k += 3) {
      const pn = r.north[k], pe = r.east[k];
      sampleTerrain(pn, pe, s);
      if (s.standing > s.ground + 0.05 && s.standing > 0.5) continue;
      if (s.ground < 0.5) continue;
      const dn = r.north[k + 1] - r.north[k - 1], de = r.east[k + 1] - r.east[k - 1];
      const len = Math.hypot(dn, de) || 1;
      const off = 1.5 * r.halfWidth[k] + 30;
      let lo = Infinity, bn = 0, be = 0;
      for (const sg of [-1, 1]) { const qn = pn - (de / len) * off * sg, qe = pe + (dn / len) * off * sg; sampleTerrain(qn, qe, s); const v = s.standing > s.ground + 0.05 && s.standing > 0.5 ? s.standing : Math.max(s.ground, s.river); if (v < lo) { lo = v; bn = qn; be = qe; } }
      if (r.level[k] - lo <= 2) continue;
      // nearest stream to the bank point
      let sd = Infinity, sl = -1, si = 0;
      lines.forEach((q, li) => { if (q.kind !== 1) return; for (let i = 0; i < q.north.length; i++) { const d = Math.hypot(q.north[i] - bn, q.east[i] - be); if (d < sd) { sd = d; sl = li; si = i; } } });
      const key = sd < 80 ? 'stream<80m' : sd < 200 ? 'stream<200m' : 'no stream';
      hist.set(key, (hist.get(key) ?? 0) + 1);
      if (sd < 80 && shown++ < 8) console.log(`  river pt ${pn.toFixed(0)},${pe.toFixed(0)} level ${r.level[k].toFixed(1)} bank ${lo.toFixed(1)}; stream ${sl} at ${sd.toFixed(0)} m, its level ${lines[sl].level[si].toFixed(1)} idx ${si}/${lines[sl].north.length}`);
    }
  }
  console.log(`BANK ${JSON.stringify([...hist])}`);
  setWorldSeed(0);
});
