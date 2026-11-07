// Foundation stage 4: the threshold hillslopes' fields (weight m, channel floor ch) and the macro model's floor f at a
// list of points (JSON [[north, east, ...rest], ...] in SF_FILE); prints them with the rest of each row.
//   SF_FILE=out/f4/data/valleys-C1.json PIT_SEED=42 SLOPE_PARAMS='{}' npx vitest run --config scripts/probes/vitest.config.ts slopeFields
import { it } from 'vitest';
import { debugMacro } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
import { setSlopeParams } from '../../src/world/terrain/hillslopes';
const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as { readFileSync(p: string, e: string): string };
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('slope fields', () => {
  if (env.SLOPE_PARAMS) setSlopeParams(JSON.parse(env.SLOPE_PARAMS));
  setWorldSeed(env.PIT_SEED ?? '42');
  const rows = JSON.parse(fs.readFileSync(env.SF_FILE as string, 'utf8')) as number[][];
  for (const r of rows) {
    const d = debugMacro(r[0], r[1]);
    console.log(`ROW ${r.map((v) => (Math.round(v * 100) / 100).toString()).join(' ')} | m ${d?.s.m.toFixed(2)} ch ${d?.s.ch.toFixed(2)} f ${d?.s.f.toFixed(2)}`);
  }
});
