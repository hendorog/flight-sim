// Probe (debug): lines ending within HL_R m of river HL_LINE's head. HL_SEED, HL_AREA.
import { it } from 'vitest';
import { setWorldSeed } from '../../src/world/worldSeed';
it('head look', async () => {
  (globalThis as { __SA?: number }).__SA = Number(process.env.HL_AREA ?? 35);
  const hf = await import('../../src/world/terrain/heightfield');
  setWorldSeed(Number(process.env.HL_SEED ?? 42));
  const L = hf.hydrology.rivers!;
  const li = Number(process.env.HL_LINE ?? 308);
  const r = L[li];
  console.log(`line ${li} kind ${r.kind} head ${r.north[0].toFixed(0)},${r.east[0].toFixed(0)} level ${r.level[0].toFixed(0)} len ${r.s[r.s.length - 1].toFixed(0)} joins ${r.joins} area ${(r as { area?: Float64Array }).area?.[0]?.toFixed(1)}`);
  const R = Number(process.env.HL_R ?? 3000);
  L.forEach((q, lj) => {
    const k = q.north.length - 1;
    const d0 = Math.hypot(q.north[k] - r.north[0], q.east[k] - r.east[0]);
    const ds = Math.hypot(q.north[0] - r.north[0], q.east[0] - r.east[0]);
    if (lj !== li && (d0 < R || ds < R)) console.log(`  line ${lj} kind ${q.kind} end ${q.end} joins ${q.joins} start ${ds.toFixed(0)} m end ${d0.toFixed(0)} m from head, len ${q.s[k].toFixed(0)} levels ${q.level[0].toFixed(0)}->${q.level[k].toFixed(0)} hw ${q.halfWidth[k].toFixed(1)}`);
  });
  setWorldSeed(0);
});
