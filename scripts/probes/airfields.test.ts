// Probe: the generated airfields for a seed (AF_SEED, default 0) and how long siting takes.
import { it } from 'vitest';
import { generatedAirfields } from '../../src/world/airfields';
import { setWorldSeed } from '../../src/world/worldSeed';
import { naturalHeight } from '../../src/world/terrain/heightfield';

const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;

it('airfields', () => {
  const t0 = performance.now();
  for (let i = 0; i < 20000; i++) naturalHeight(i * 3.1, i * 1.7);
  const t1 = performance.now();
  console.log(`naturalHeight: ${(((t1 - t0) / 20000) * 1000).toFixed(1)} us`);
  const seed = Number(env.AF_SEED ?? 0);
  const t2 = performance.now();
  setWorldSeed(seed === 0 ? 1 : 0);
  setWorldSeed(seed);
  console.log(`siting (with hydrology rebuild x2): ${(performance.now() - t2).toFixed(0)} ms`);
  for (const f of generatedAirfields()) {
    console.log(`${f.code} ${f.name.padEnd(22)} ${f.kind.padEnd(6)} n=${f.north} e=${f.east} d=${(Math.hypot(f.north, f.east) / 1000).toFixed(1)}km elev=${f.elevation} rwy ${f.ids.join('/')} ${f.length}x${f.width} ${f.circuit} ${f.frequency}`);
  }
}, 300000);
