// Round V B (item 4 pictures): three gully-rich valleys per seed, picked by rule before any picture is looked at: the
// rivers at least GV_MINKM (5) km long ranked by gully mouths per river km (feedCount's per-river table, GV_FEED dir of
// feedCount-s<seed>.json: pass channels of 1.5 km2 or more meeting the river), the first three whose midpoints lie at
// least GV_APART (10000) m apart; each looked at from worstN's camera rule (1500 m back, 600 m up, the side whose ground
// is lowest with a clear line of sight) at the river's sample half way along it.
//   GV_SEEDS=1,42,777777 GV_FEED=out/fs/VB/probes/feed npx vitest run --config scripts/probes/vitest.config.ts gullyValleys --silent=false --disable-console-intercept
import { it } from 'vitest';
import { readFileSync } from 'node:fs';
import { hydrology, terrainHeight } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
type Line = { north: Float64Array; east: Float64Array; s: Float64Array; level: Float64Array };
type Row = { li: number; km: number; gullies: number };
function camera(n: number, e: number, z: number): string {
  let best = '';
  let bestG = Infinity;
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    const cn = n + 1500 * Math.cos(a), ce = e + 1500 * Math.sin(a);
    const g = terrainHeight(cn, ce);
    let cz = z + 600;
    if (cz < g + 150) cz = g + 150;
    let clear = true;
    for (let t = 0.1; t < 0.95 && clear; t += 0.05) if (terrainHeight(cn + (n - cn) * t, ce + (e - ce) * t) > cz + (z - cz) * t - 8) clear = false;
    if (clear && g < bestG) {
      bestG = g;
      best = `camPos=${cn.toFixed(0)},${ce.toFixed(0)},${cz.toFixed(0)}&camLook=${n.toFixed(0)},${e.toFixed(0)},${z.toFixed(0)}`;
    }
  }
  return best;
}
it('gully valleys', () => {
  const MINKM = Number(env.GV_MINKM ?? 5), APART = Number(env.GV_APART ?? 10000);
  for (const seed of (env.GV_SEEDS ?? '1,42,777777').split(',').map(Number)) {
    const rows = (JSON.parse(readFileSync(`${env.GV_FEED}/feedCount-s${seed}.json`, 'utf8')) as { rows: Row[] }).rows;
    setWorldSeed(seed);
    terrainHeight(0, 0);
    const L = hydrology.rivers as unknown as Line[];
    const ranked = rows.filter((r) => r.km >= MINKM).sort((a, b) => b.gullies / b.km - a.gullies / a.km || a.li - b.li);
    const picked: Array<{ n: number; e: number }> = [];
    for (const r of ranked) {
      const line = L[r.li];
      const half = line.s[line.s.length - 1] / 2;
      let i = 0;
      while (i < line.s.length - 1 && line.s[i] < half) i++;
      const n = line.north[i], e = line.east[i];
      if (picked.some((p) => Math.hypot(p.n - n, p.e - e) < APART)) continue;
      const cam = camera(n, e, line.level[i]);
      if (!cam) continue;
      picked.push({ n, e });
      console.log(`GV g${seed}-${picked.length} seed=${seed}&${cam}`);
      console.log(`GV-INFO seed ${seed} river ${r.li}: ${r.gullies} gully mouths over ${r.km.toFixed(1)} km (${(r.gullies / r.km).toFixed(2)} per km), at ${n.toFixed(0)},${e.toFixed(0)}`);
      if (picked.length >= 3) break;
    }
  }
  setWorldSeed(0);
});
