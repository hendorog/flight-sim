// Probe: how many of a world's lakes stand above the snow line (they would be frozen, under snow), and the highest
// lakes and river water with their positions (for camPos shots).
//   STREAM_SEEDS=0,1,42 SNOW_SHIFT=-600 TOP=5 npx vitest run --config scripts/probes/vitest.config.ts frozenLakes --silent=false --disable-console-intercept
import { it } from 'vitest';
import { hydrology, setSnowShift, snowLine, snowLineBase, terrainSurface } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
it('frozen lakes', () => {
  const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
  setSnowShift(Number(env.SNOW_SHIFT ?? 0));
  const top = Number(env.TOP ?? 0);
  for (const seed of (env.STREAM_SEEDS ?? '0,1,42,777777,4242').split(',').map(Number)) {
    setWorldSeed(seed);
    const ls = hydrology.lakes;
    let above = 0, near = 0, hi = -Infinity, snowSurf = 0;
    for (const l of ls) {
      const d = l.level - snowLine(l.north, l.east);
      if (d > 0) above++;
      else if (d > -300) near++;
      hi = Math.max(hi, l.level);
      if (terrainSurface(l.north, l.east) === 'snow') snowSurf++;
    }
    let riverHi = -Infinity;
    for (const r of hydrology.rivers ?? [hydrology.river]) for (let i = 0; i < r.level.length; i++) riverHi = Math.max(riverHi, r.level[i]);
    console.log(`seed ${seed}: ${ls.length} lakes, ${above} above the snow line, ${near} within 300 m below it, highest ${hi.toFixed(0)} m; river water up to ${riverHi.toFixed(0)} m; snow line base ${snowLineBase()} m; lake centres on 'snow' ${snowSurf}`);
    if (top > 0) {
      const sorted = [...ls].sort((a, b) => b.level - a.level).slice(0, top);
      for (const l of sorted)
        console.log(`  lake n ${l.north.toFixed(0)} e ${l.east.toFixed(0)} level ${l.level.toFixed(0)} snowLine ${snowLine(l.north, l.east).toFixed(0)} bound ${l.bound.toFixed(0)} surface ${terrainSurface(l.north, l.east)}`);
    }
  }
});
