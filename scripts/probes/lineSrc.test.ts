// Round V B: which stream pass built each line (streams.ts streamDebug.src): LS="seed:line,line;..." prints each line's
// pass, its first and last points, end, joins, area; LS_SUM=1 also counts lines and km by pass per seed.
import { it } from 'vitest';
import { hydrology, terrainHeight } from '../../src/world/terrain/heightfield';
import { streamDebug } from '../../src/world/terrain/streams';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
type Line = { north: Float64Array; east: Float64Array; s: Float64Array; level: Float64Array; kind?: number; end?: string; joins?: number; pool?: number; area?: Float64Array };
it('line src', () => {
  for (const t of (env.LS ?? '').split(';').filter(Boolean)) {
    const [sd, ls] = t.split(':');
    setWorldSeed(Number(sd));
    terrainHeight(0, 0);
    const L = hydrology.rivers as unknown as Line[];
    const nR = L.filter((r) => (r.kind ?? 0) === 0).length;
    const src = streamDebug.src ?? [];
    console.log(`LS seed ${sd}: lines ${L.length}, rivers ${nR}, src ${src.length}`);
    for (const x of (ls ?? '').split(',').filter(Boolean).map(Number)) {
      const r = L[x];
      const m = r.north.length - 1;
      console.log(`LS ${sd} line ${x} src ${x >= nR ? src[x - nR] : 'river'} from ${r.north[0].toFixed(0)},${r.east[0].toFixed(0)} lv ${r.level[0].toFixed(1)} to ${r.north[m].toFixed(0)},${r.east[m].toFixed(0)} lv ${r.level[m].toFixed(1)} end ${r.end} joins ${r.joins} pool ${r.pool} area ${r.area?.[0].toFixed(1)}..${r.area?.[m].toFixed(1)} len ${r.s[m].toFixed(0)}`);
    }
    if (env.LS_SUM) {
      const by = new Map<string, [number, number]>();
      for (let i = nR; i < L.length; i++) {
        const k = src[i - nR] ?? '?';
        const v = by.get(k) ?? [0, 0];
        v[0]++;
        v[1] += L[i].s[L[i].s.length - 1] / 1000;
        by.set(k, v);
      }
      console.log(`LS ${sd} by pass: ${[...by.entries()].map(([k, v]) => `${k} ${v[0]} lines ${v[1].toFixed(0)} km`).join('; ')}`);
    }
  }
  setWorldSeed(0);
});
