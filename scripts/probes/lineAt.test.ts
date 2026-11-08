// A drawn line's samples near a point: level, ground, half-width, catchment-free (probes).
//   LA_SEED=777777 LA_LINE=544 LA_AT=22225,-140000 npx vitest run --config scripts/probes/vitest.config.ts lineAt
import { it } from 'vitest';
import { hydrology, naturalHeight } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('line at', () => {
  setWorldSeed(env.LA_SEED ?? '777777');
  const r = hydrology.rivers![Number(env.LA_LINE ?? 544)];
  const [N0, E0] = (env.LA_AT ?? '22225,-140000').split(',').map(Number);
  let k0 = 0, best = Infinity;
  for (let i = 0; i < r.north.length; i++) { const d = Math.hypot(r.north[i] - N0, r.east[i] - E0); if (d < best) { best = d; k0 = i; } }
  console.log(`line ${env.LA_LINE} kind ${r.kind} samples ${r.north.length} nearest ${k0} at ${best.toFixed(0)} m; length ${r.s[r.s.length - 1].toFixed(0)}`);
  for (let i = Math.max(0, k0 - 8); i < Math.min(r.north.length, k0 + 8); i++) console.log(`  ${i} s ${r.s[i].toFixed(0)} ${r.north[i].toFixed(0)},${r.east[i].toFixed(0)} level ${r.level[i].toFixed(1)} ground ${naturalHeight(r.north[i], r.east[i]).toFixed(1)} hw ${r.halfWidth[i].toFixed(1)} regime ${(r as unknown as { regime?: Uint8Array }).regime?.[i]}`);
});
