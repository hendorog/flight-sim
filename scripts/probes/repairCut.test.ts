// Repair probe: cut depth along lines (ground vs natural), deepest notches per seed, and trenches (both walls high over a stream).
import { it } from 'vitest';
import { hydrology, makeSample, sampleTerrain, naturalHeight } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
it('cut depth', () => {
  for (const seed of (process.env.VS_SEEDS ?? '777777').split(',').map(Number)) {
    setWorldSeed(seed);
    const rs = hydrology.rivers!;
    const s = makeSample();
    for (const li of (process.env.VS_LINES ?? '').split(',').filter(Boolean).map(Number)) {
      const r = rs[li];
      console.log(`seed ${seed} line ${li} kind ${r.kind} end ${r.end} joins ${r.joins} n ${r.north.length} len ${(r.s[r.s.length - 1] / 1000).toFixed(2)} km`);
      for (let i = 0; i < r.north.length; i += Math.max(1, Math.floor(r.north.length / 30))) {
        const n = r.north[i], e = r.east[i];
        sampleTerrain(n, e, s);
        const nat = naturalHeight(n, e);
        // Bank-top: highest ground within 60 m across.
        const dn = r.north[Math.min(i + 1, r.north.length - 1)] - r.north[Math.max(i - 1, 0)], de = r.east[Math.min(i + 1, r.north.length - 1)] - r.east[Math.max(i - 1, 0)];
        const l = Math.hypot(dn, de) || 1;
        let top = -1e9;
        for (const d of [-60, -30, 30, 60]) { sampleTerrain(n - de / l * d, e + dn / l * d, s); top = Math.max(top, s.ground); }
        sampleTerrain(n, e, s);
        console.log(`  i ${i} s ${(r.s[i]).toFixed(0)} at ${(n / 1000).toFixed(3)},${(e / 1000).toFixed(3)} level ${r.level[i].toFixed(0)} ground ${s.ground.toFixed(0)} natural ${nat.toFixed(0)} cut ${(nat - s.ground).toFixed(0)} bankTop60 ${top.toFixed(0)} hw ${r.halfWidth[i].toFixed(1)} regime ${r.regime?.[i]}`);
      }
    }
    // Deepest cuts anywhere along streams: natural - ground at centreline.
    const cuts: Array<{ li: number; i: number; c: number }> = [];
    rs.forEach((r, li) => { for (let i = 0; i < r.north.length; i += 2) { sampleTerrain(r.north[i], r.east[i], s); if (s.standing > r.level[i] - 0.5) continue; const c = naturalHeight(r.north[i], r.east[i]) - s.ground; if (c > 40) cuts.push({ li, i, c }); } });
    cuts.sort((a, b) => b.c - a.c);
    const seen = new Set<number>();
    const lines: string[] = [];
    let kmDeep = 0;
    for (const c of cuts) { if (!seen.has(c.li)) { seen.add(c.li); if (lines.length < 10) lines.push(`${c.li}(k${rs[c.li].kind}):${c.c.toFixed(0)}m@${(rs[c.li].north[c.i] / 1000).toFixed(2)},${(rs[c.li].east[c.i] / 1000).toFixed(2)}`); } }
    const byKind=[0,0], lineKind=[new Set<number>(), new Set<number>()]; const deep100=[0,0];
    for (const c of cuts) { const k = rs[c.li].kind ?? 0; kmDeep += 2 * (k === 1 ? 50 : 28) / 1000; byKind[k] += 2 * (k === 1 ? 50 : 28) / 1000; lineKind[k].add(c.li); if (c.c > 100) deep100[k] += 2 * (k === 1 ? 50 : 28) / 1000; }
    console.log(`  km cut >40 m: rivers ${byKind[0].toFixed(0)} km on ${lineKind[0].size} lines (>100 m ${deep100[0].toFixed(0)} km), streams ${byKind[1].toFixed(0)} km on ${lineKind[1].size} lines (>100 m ${deep100[1].toFixed(0)} km)`);
    // Trench: both walls high. Drawn ground at hw + 40 m either side, the lower of the two, over the water (streams).
    {
      const tr = [0, 0, 0];
      const ex: string[] = [];
      let n = 0;
      rs.forEach((r, li) => {
        if (r.kind !== 1) return;
        for (let i = 1; i < r.north.length - 1; i += 2) {
          const dn = r.north[i + 1] - r.north[i - 1], de = r.east[i + 1] - r.east[i - 1]; const l = Math.hypot(dn, de) || 1;
          const o = r.halfWidth[i] + 40;
          let lo = Infinity;
          for (const sg of [-1, 1]) { sampleTerrain(r.north[i] - de / l * o * sg, r.east[i] + dn / l * o * sg, s); lo = Math.min(lo, s.ground); }
          n++;
          const w = lo - r.level[i];
          if (w > 20) tr[0]++;
          if (w > 40) { tr[1]++; if (ex.length < 8 && !ex.some((x) => x.startsWith(`${li}:`))) ex.push(`${li}:${w.toFixed(0)}m@${(r.north[i] / 1000).toFixed(2)},${(r.east[i] / 1000).toFixed(2)}`); }
          if (w > 100) tr[2]++;
        }
      });
      console.log(`  TRENCH streams: lower wall at hw+40 m over water >20 m ${(tr[0] * 0.1).toFixed(1)} km, >40 m ${(tr[1] * 0.1).toFixed(1)} km, >100 m ${(tr[2] * 0.1).toFixed(1)} km (of ${(n * 0.1).toFixed(0)} km): ${ex.join(' ')}`);
    }
    console.log(`seed ${seed}: points cut >40 m below natural: ${cuts.length} (~${kmDeep.toFixed(0)} km) on ${seen.size} lines; deepest per line: ${lines.join(' ')}`);
  }
  setWorldSeed(0);
});
