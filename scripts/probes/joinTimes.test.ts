// Probe (Round V A4'+B join): the network build's form-pass and network timings, the line counts by kind, and how many
// streams are too short for a thread (the channel-form law still forms their section).
//   JT2_SEEDS=1,42,777777 npx vitest run --config scripts/probes/vitest.config.ts joinTimes
import { it } from 'vitest';
import { hydrology } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('join times', () => {
  for (const seed of (env.JT2_SEEDS ?? '42').split(',').map(Number)) {
    const t0 = performance.now();
    setWorldSeed(seed);
    const tot = performance.now() - t0;
    const rep = hydrology.streamReport as unknown as { form?: { ms: Record<string, number> }; netMs?: Record<string, number>; phases?: number[] };
    const L = (hydrology.rivers ?? []) as unknown as Array<{ s: Float64Array; kind?: number; bedR?: Float32Array }>;
    let nR = 0, ns = 0, short = 0, km = 0, noForm = 0;
    for (const r of L) {
      if ((r.kind ?? 0) === 0) { nR++; continue; }
      ns++;
      const len = r.s[r.s.length - 1] ?? 0;
      km += len / 1000;
      if (r.s.length < 4 || len < 4 * 48) short++;
      if (!r.bedR || r.bedR.length !== r.s.length) noForm++;
    }
    const f = rep.form?.ms ?? {};
    const n = rep.netMs ?? {};
    console.log(`JT seed ${seed}: build ${tot.toFixed(0)} ms; phases ${(rep.phases ?? []).map((v) => v.toFixed(0)).join('/')}; form ms ${Object.entries(f).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(', ')}; net ms ${Object.entries(n).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(', ')}; rivers ${nR}, streams ${ns} (${km.toFixed(0)} km), too short for a thread ${short}, no form arrays ${noForm}`);
  }
  setWorldSeed(0);
});
