// Round V A4' (formNear): lines and oxbows near points FR_PTS (n,e;...), seed FR_SEED, within FR_R m (every line within reach of
// the channel index, plus the nearest oxbow): line, kind, area, half-width, bed edges, level, joins.
import { it } from 'vitest';
import { hydrology, terrainHeight } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('form near', () => {
  setWorldSeed(Number(env.FR_SEED ?? 42));
  terrainHeight(0, 0);
  const R = Number(env.FR_R ?? 400);
  const L = hydrology.rivers ?? [];
  for (const p of (env.FR_PTS ?? '0,0').split(';')) {
    const [n, e] = p.split(',').map(Number);
    const out: string[] = [];
    L.forEach((r, li) => {
      let bd = Infinity;
      let bi = -1;
      for (let i = 0; i < r.north.length; i++) {
        const d = Math.hypot(r.north[i] - n, r.east[i] - e);
        if (d < bd) (bd = d), (bi = i);
      }
      if (bd > R) return;
      const f = r as unknown as { bedR?: Float32Array; bedL?: Float32Array; wetR?: Float32Array; wetL?: Float32Array };
      out.push(`  line ${li} k${r.kind} d ${bd.toFixed(0)} at ${r.north[bi].toFixed(0)},${r.east[bi].toFixed(0)} i ${bi}/${r.north.length} A ${r.area?.[bi]?.toFixed(1)} hw ${r.halfWidth[bi].toFixed(1)} wet ${f.wetL?.[bi]?.toFixed(1)}/${f.wetR?.[bi]?.toFixed(1)} bed ${f.bedL?.[bi]?.toFixed(1)}/${f.bedR?.[bi]?.toFixed(1)} lv ${r.level[bi].toFixed(1)} joins ${r.joins} end ${r.end ?? ''}`);
    });
    const ox = { dist: Infinity, halfWidth: 0, level: 0, depth: 0 } as unknown as { dist: number; halfWidth: number; level: number; depth: number };
    hydrology.queryOxbow?.(n, e, ox as never);
    console.log(`NL ${n},${e}: oxbow d ${ox.dist.toFixed(0)} hw ${ox.halfWidth?.toFixed?.(1)}\n${out.join('\n')}`);
  }
  setWorldSeed(0);
});
