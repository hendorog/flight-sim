// Probe (sea-level rivers): for each line riverZero flags, where its level first falls under 1 m over ground > 30 m
// after each stage of riverNetwork.ts's level pipeline (levelProbe): A running minimum, B confluence cut,
// C0 parent join / sea mouth, C capFall, D the other valleys' carve, E destair. RZ_SEEDS.
import { it } from 'vitest';
import { hydrology, naturalHeight, seededDrainage } from '../../src/world/terrain/heightfield';
import { levelProbe } from '../../src/world/terrain/riverNetwork';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('river zero phases', () => {
  for (const seed of (env.RZ_SEEDS ?? '1,42,777777').split(',')) {
    const snaps = new Map<string, { level: Float64Array; s: Float64Array; ground: Float64Array }>();
    levelProbe.on = (ph, li, L) => { if (L.ground) snaps.set(`${ph}:${li}`, { level: L.level.slice(), s: Float64Array.from(L.s), ground: L.ground.slice() }); };
    setWorldSeed(seed);
    levelProbe.on = undefined;
    const d = seededDrainage!;
    const bad: number[] = [];
    (hydrology.rivers ?? []).forEach((r, li) => {
      if (li >= d.lines.length) return;
      for (let k = 0; k < r.north.length; k += 4) if (r.level[k] < 1 && naturalHeight(r.north[k], r.east[k]) > 30) { bad.push(li); return; }
    });
    for (const li of bad) {
      const L = d.lines[li];
      const A = snaps.get(`A:${li}`)!;
      const len = A.s[A.s.length - 1];
      const tribs = d.lines.map((M, j) => (M.joins === li ? j : -1)).filter((j) => j >= 0);
      const parts: string[] = [];
      for (const ph of ['A', 'B', 'C0', 'C', 'D', 'E']) {
        const S = snaps.get(`${ph}:${li}`);
        if (!S) { parts.push(`${ph} -`); continue; }
        let f0 = -1, f30 = -1;
        for (let i = 0; i < S.level.length; i++) {
          if (S.level[i] < 1 && f0 < 0) f0 = i;
          if (S.level[i] < 1 && S.ground[i] > 30 && f30 < 0) f30 = i;
        }
        parts.push(`${ph} lv<1 from ${f0 < 0 ? '-' : (S.s[f0] / 1000).toFixed(1)} (g ${f0 < 0 ? '-' : S.ground[f0].toFixed(0)}), over g>30 from ${f30 < 0 ? '-' : (S.s[f30] / 1000).toFixed(1)}`);
      }
      console.log(`seed ${seed} line ${li} joins ${L.joins} len ${(len / 1000).toFixed(1)} km A ${L.area[L.area.length - 1].toFixed(0)} tribs ${tribs.length}\n   ${parts.join('\n   ')}`);
      // Which tributary mouths are below 1 m at phase A (the confluence cut's source)?
      const low = tribs.filter((j) => { const T = snaps.get(`A:${j}`)!; return T.level[T.level.length - 1] < 1; });
      if (low.length) console.log(`   tributaries arriving < 1 m at A: ${low.map((j) => { const T = snaps.get(`A:${j}`)!; let f = 0; while (f < T.level.length && T.level[f] >= 1) f++; return `${j} (len ${(T.s[T.s.length - 1] / 1000).toFixed(1)}, lv<1 from ${(T.s[f] / 1000).toFixed(1)}, g there ${T.ground[f].toFixed(0)})`; }).join(', ')}`);
    }
  }
  setWorldSeed(0);
});
