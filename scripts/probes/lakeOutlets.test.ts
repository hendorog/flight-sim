// Probe: lakes without a drawn stream leaving them, and how wide rivers start (the RIVER_AREA threshold).
import { it } from 'vitest';
import { hydrology } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
it('lake outlets', () => {
  for (const seed of (process.env.STREAM_SEEDS ?? '1,42,777777').split(',').map(Number)) {
    setWorldSeed(seed);
    const lines = hydrology.rivers!;
    let none = 0, big = 0;
    const where: string[] = [];
    for (const l of hydrology.lakes) {
      const R = Math.max(l.radiusA, l.radiusB) + 400;
      let hit = false;
      for (const r of lines) {
        for (let i = 0; i < r.north.length && !hit; i += 2) if (Math.hypot(r.north[i] - l.north, r.east[i] - l.east) < R) hit = true;
        if (hit) break;
      }
      if (!hit) { none++; if (l.radiusA > 600) big++; where.push(`${(l.north / 1000).toFixed(1)},${(l.east / 1000).toFixed(1)} (level ${l.level.toFixed(0)}, r ${Math.max(l.radiusA, l.radiusB).toFixed(0)} m)`); }
    }
    const starts = lines.map((r) => r.halfWidth[0]).sort((a, b) => a - b);
    const km = lines.reduce((s, r) => s + r.s[r.s.length - 1], 0) / 1000;
    console.log(`seed ${seed}: ${hydrology.lakes.length} lakes, ${none} with no river within 400 m of them (${big} of them > 600 m radius); ${lines.length} lines, ${km.toFixed(0)} km; start half-width median ${starts[starts.length >> 1].toFixed(1)} m, min ${starts[0].toFixed(1)}${where.length ? `; lakes with none (km): ${where.join('; ')}` : ''}`);
  }
});
