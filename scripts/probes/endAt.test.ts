// A line's end: what it joins and how far its last point lies from that line (probes).
//   EA_SEED=1 EA_LINES=1197,1293 npx vitest run --config scripts/probes/vitest.config.ts endAt
import { it } from 'vitest';
import { hydrology } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('end at', () => {
  setWorldSeed(env.EA_SEED ?? '1');
  const R = hydrology.rivers!;
  for (const li of (env.EA_LINES ?? '').split(',').map(Number)) {
    const r = R[li];
    const n = r.north.length - 1;
    const j = r.joins ?? -1;
    let best = Infinity;
    if (j >= 0) for (let i = 0; i < R[j].north.length; i++) best = Math.min(best, Math.hypot(R[j].north[i] - r.north[n], R[j].east[i] - r.east[n]));
    if (j >= 0) console.log(`  receiver ${j} first ${R[j].north[0].toFixed(0)},${R[j].east[0].toFixed(0)} last ${R[j].north[R[j].north.length - 1].toFixed(0)},${R[j].east[R[j].east.length - 1].toFixed(0)} A0 ${R[j].area?.[0]?.toFixed(1)} joins ${R[j].joins}; this first ${r.north[0].toFixed(0)},${r.east[0].toFixed(0)}`);
    console.log(`line ${li} kind ${r.kind} end ${r.end} A0 ${r.area?.[0]?.toFixed(1)} last ${r.north[n].toFixed(0)},${r.east[n].toFixed(0)} joins ${j} (kind ${j >= 0 ? R[j].kind : '-'}, ${j >= 0 ? R[j].north.length : 0} pts, end ${j >= 0 ? R[j].end : '-'}) nearest point of it ${best.toFixed(0)} m; hw last ${r.halfWidth[n].toFixed(2)} first ${r.halfWidth[0].toFixed(2)}`);
  }
});
