// Round V A3r: an approach camera for generated fields FC_CODES (codes, or 'home' for the home field) on seed FC_SEED: on
// the extended centreline 2.5 km out from the runway's low-numbered end, 250 m over the field (raised to clear the ground
// under it), looking at the runway's far end; with the field's place, heading and elevation.
import { it } from 'vitest';
import { terrainHeight } from '../../src/world/terrain/heightfield';
import { airfields } from '../../src/world/airfields';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('field cams', () => {
  const seed = Number(env.FC_SEED ?? 777777);
  setWorldSeed(seed);
  terrainHeight(0, 0);
  const all = airfields();
  for (const code of (env.FC_CODES ?? 'home').split(',')) {
    const f = code === 'home' ? all[0] : all.find((a) => a.code === code);
    if (!f) { console.log(`FC ${code}: none on seed ${seed}`); continue; }
    const c = Math.cos(f.heading), s = Math.sin(f.heading);
    const back = f.length / 2 + 2500;
    const pn = f.north - c * back, pe = f.east - s * back;
    let pz = f.elevation + 250;
    for (let t = 0; t <= 1; t += 0.05) pz = Math.max(pz, terrainHeight(pn + (f.north - pn) * t, pe + (f.east - pe) * t) + 120);
    const ln = f.north + (c * f.length) / 2, le = f.east + (s * f.length) / 2;
    console.log(`FC ${code === 'home' ? 'home ' + f.code : f.code} at ${f.north.toFixed(0)},${f.east.toFixed(0)} heading ${((f.heading * 180) / Math.PI).toFixed(0)} elev ${f.elevation.toFixed(0)} length ${f.length} | seed=${seed}&camPos=${pn.toFixed(0)},${pe.toFixed(0)},${pz.toFixed(0)}&camLook=${ln.toFixed(0)},${le.toFixed(0)},${f.elevation.toFixed(0)}`);
  }
  setWorldSeed(0);
});
