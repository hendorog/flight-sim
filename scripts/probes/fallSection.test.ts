// Probe: the terrain across a channel near a fall (or any point on a line): ground at offsets across, the channels
// carving there (level, breach, reach).  FS_SEED=42 FS_LINE=742 FS_S=<arc m> (default: the line's first fall + 40 m)
import { it } from 'vitest';
import { hydrology, makeSample, naturalHeight, sampleTerrain } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
it('fall section', () => {
  setWorldSeed(Number(process.env.FS_SEED ?? 42));
  const li = Number(process.env.FS_LINE ?? 742);
  const r: any = hydrology.rivers![li];
  const f = hydrology.falls!.find((x) => x.line === li);
  console.log(`FS line ${li} kind ${r.kind} fall ${f ? `${f.cause} ${f.height.toFixed(0)} m at s ${r.s[f.index].toFixed(0)}` : 'none'}`);
  const s0 = process.env.FS_S ? Number(process.env.FS_S) : (f ? r.s[f.index] : 0);
  const sm = makeSample();
  for (const ds of [-60, -10, 10, 40, 100, 200, 300]) {
    let i = 0;
    while (i < r.s.length - 2 && r.s[i + 1] < s0 + ds) i++;
    const dn = r.north[i + 1] - r.north[i], de = r.east[i + 1] - r.east[i]; const l = Math.hypot(dn, de) || 1;
    const row: string[] = [];
    for (const o of [-150, -100, -60, -30, -15, 0, 15, 30, 60, 100, 150]) {
      const n = r.north[i] - (de / l) * o, e = r.east[i] + (dn / l) * o;
      sampleTerrain(n, e, sm);
      row.push(`${o}:${(sm.ground - r.level[i]).toFixed(0)}/${(naturalHeight(n, e) - r.level[i]).toFixed(0)}`);
    }
    console.log(`FS s ${(s0 + ds).toFixed(0)} level ${r.level[i].toFixed(0)} breach ${r.breach?.[i]?.toFixed(0)} cut ${r.cut?.[i]?.toFixed(0)}: ground/natural over water ${row.join(' ')}`);
  }
  setWorldSeed(0);
});
