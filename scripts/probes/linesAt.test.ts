// Lines (rivers kind 0, streams kind 1) passing within LN_R m of points: index, kind, catchment there, length, end.
//   LN_SEED=42 LN_PTS="-12300,-41300;-12700,-41700" LN_R=400 npx vitest run --config scripts/probes/vitest.config.ts linesAt
import { it } from 'vitest';
import { hydrology } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('lines at', () => {
  setWorldSeed(env.LN_SEED ?? '42');
  const R = Number(env.LN_R ?? 400);
  for (const p of (env.LN_PTS ?? '').split(';')) {
    const [n, e] = p.split(',').map(Number);
    const rows: string[] = [];
    (hydrology.rivers ?? []).forEach((r, li) => {
      let best = Infinity, k = -1;
      for (let i = 0; i < r.north.length; i++) { const d = Math.hypot(r.north[i] - n, r.east[i] - e); if (d < best) { best = d; k = i; } }
      if (best > R) return;
      const sr = hydrology.streamReport as unknown as { chains?: unknown };
      void sr;
      rows.push(`  line ${li} kind ${r.kind} d ${best.toFixed(0)} A ${r.area?.[k]?.toFixed(1)} hw ${r.halfWidth[k].toFixed(1)} s ${r.s[k].toFixed(0)}/${r.s[r.s.length - 1].toFixed(0)} head ${r.north[0].toFixed(0)},${r.east[0].toFixed(0)} A0 ${r.area?.[0]?.toFixed(1)} end ${r.end} joins ${r.joins}`);
    });
    console.log(`at ${n},${e}:\n${rows.join('\n')}`);
  }
});
