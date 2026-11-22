// Repair probe: every line's arrays are finite and its samples are no further apart than they should be.
import { it, expect } from 'vitest';
import { hydrology } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
it('finite', () => {
  for (const seed of (process.env.REPAIR_SEEDS ?? '1,42,777777').split(',').map(Number)) {
    setWorldSeed(seed);
    let bad = 0, gap = 0, worst = 0;
    for (const r of hydrology.rivers!) {
      for (const k of ['north', 'east', 'level', 'halfWidth', 's', 'area'] as const) for (const v of r[k] as Float64Array) if (!Number.isFinite(v)) bad++;
      for (let i = 1; i < r.s.length; i++) { const d = r.s[i] - r.s[i - 1]; if (d > 400) { gap++; console.log(`  gap ${d.toFixed(0)} m line ${hydrology.rivers!.indexOf(r)} kind ${r.kind} i ${i}/${r.s.length} at ${(r.north[i] / 1000).toFixed(2)},${(r.east[i] / 1000).toFixed(2)} end ${r.end}`); } worst = Math.max(worst, d); }
    }
    for (const f of hydrology.falls!) if (!Number.isFinite(f.top) || !Number.isFinite(f.bottom)) bad++;
    console.log(`seed ${seed}: non-finite ${bad}, sample gaps > 400 m ${gap}, widest ${worst.toFixed(0)} m`);
    expect(bad).toBe(0);
  }
  setWorldSeed(0);
});
