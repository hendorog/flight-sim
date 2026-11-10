// lineAround (round T): a line's samples within LA_R m of LA_AT, every LA_EVERY-th: position, offset from the 250 m
// raster point nearest, heading of the next 100 m, and the slopes' pin (debugMacro mg * ch * 2) and channel weight.
//   LA_SEED=42 LA_LINE=833 LA_AT=-70249,58752 npx vitest run --config scripts/probes/vitest.config.ts lineAround --silent=false
import { it } from 'vitest';
import { hydrology, terrainHeight, debugMacro } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('line around', () => {
  setWorldSeed(Number(env.LA_SEED ?? 42));
  terrainHeight(0, 0);
  const r = hydrology.rivers![Number(env.LA_LINE ?? 833)];
  const [an, ae] = (env.LA_AT ?? '-70249,58752').split(',').map(Number);
  const RR = Number(env.LA_R ?? 1200), EV = Number(env.LA_EVERY ?? 2);
  for (let i = 0; i < r.s.length; i += EV) {
    if (Math.hypot(r.north[i] - an, r.east[i] - ae) > RR) continue;
    const j = Math.min(r.s.length - 1, i + 2);
    const h = (Math.atan2(r.east[j] - r.east[i], r.north[j] - r.north[i]) * 180) / Math.PI;
    const d = debugMacro(r.north[i], r.east[i])!;
    const on = Math.round(r.north[i] / 250) * 250, oe = Math.round(r.east[i] / 250) * 250;
    console.log(`  s ${r.s[i].toFixed(0)} ${r.north[i].toFixed(0)},${r.east[i].toFixed(0)} off raster ${Math.hypot(r.north[i] - on, r.east[i] - oe).toFixed(0)} heading ${h.toFixed(0)} pin ${Math.min(1, d.s.m * d.s.ch * 2).toFixed(2)} ch ${d.s.ch.toFixed(2)} mg ${d.s.m.toFixed(2)} lvl ${r.level[i].toFixed(1)}`);
  }
  setWorldSeed(0);
});
