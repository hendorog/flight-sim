// seededWorld's river-network check (tests/terrain/seededWorld.test.ts), every finding counted by kind instead of the
// first ten: finite, falling, narrowing (mouth narrower than head), mouths, sinks beside higher water, self-crossings.
//   NC_SEEDS=1,7,42,1234,99991 npx vitest run --config scripts/probes/vitest.config.ts netCheck
import { it } from 'vitest';
import { hydrology, terrainHeight } from '../../src/world/terrain/heightfield';
import type { ChannelNear } from '../../src/world/terrain/hydrology';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('network check', () => {
  for (const seed of (env.NC_SEEDS ?? '1,7,42,1234,99991').split(',').map(Number)) {
    setWorldSeed(seed);
    terrainHeight(0, 0);
    const rivers = hydrology.rivers!;
    const net = hydrology.network!;
    const hits: ChannelNear[] = [];
    const count: Record<string, number> = {};
    const ex: Record<string, string> = {};
    const bad = (k: string, m: string): void => {
      count[k] = (count[k] ?? 0) + 1;
      ex[k] ??= m;
    };
    let sunk = 0;
    rivers.forEach((r, li) => {
      const n = r.north.length;
      if (n < 2) bad('points', `line ${li} has ${n} points`);
      for (let k = 0; k < n; k++) {
        if (!(Number.isFinite(r.north[k]) && Number.isFinite(r.east[k]) && Number.isFinite(r.level[k]) && Number.isFinite(r.s[k]))) bad('finite', `line ${li} at ${k}`);
        if (k > 0 && r.level[k] > r.level[k - 1]) bad('rises', `line ${li} rises at ${k}`);
      }
      if (r.halfWidth[n - 1] < r.halfWidth[0] - 1e-9) bad(r.kind === 1 ? 'narrows (stream)' : 'narrows (river)', `line ${li}: ${r.halfWidth[0].toFixed(1)} -> ${r.halfWidth[n - 1].toFixed(1)}`);
      const pn = r.north[n - 1];
      const pe = r.east[n - 1];
      if (r.level[n - 1] < 0.5 || Math.max(Math.abs(pn), Math.abs(pe)) > 155000) return;
      if (r.kind === 1 && r.end === 'lake') {
        if (!(hydrology.lakeMask!.at(pn, pe, terrainHeight(pn, pe)) > -Infinity)) bad('lake end in no lake', `stream ${li}`);
        return;
      }
      if (r.kind === 1 && (r.end === 'sink' || r.end === 'stuck')) {
        sunk++;
        const m = net.channels(pn, pe, hits);
        for (let j = 0; j < m; j++) if (hits[j].line !== li && rivers[hits[j].line].joins !== li && hits[j].dist < hits[j].halfWidth + 30 && hits[j].level > r.level[n - 1] + 6) bad('sinks beside higher water', `stream ${li} by ${hits[j].line}`);
        return;
      }
      const k = net.channels(pn, pe, hits);
      let onOther = false;
      for (let j = 0; j < k; j++) if (hits[j].line !== li && hits[j].dist < 60) onOther = true;
      if (!onOther) bad('mouth on no river', `line ${li} at ${pn.toFixed(0)},${pe.toFixed(0)}`);
    });
    let crossings = 0;
    for (const r of rivers) {
      const n = r.north.length;
      const grid = new Map<number, number[]>();
      const key = (pn: number, pe: number): number => (Math.floor(pn / 100) + 32768) * 65536 + (Math.floor(pe / 100) + 32768);
      for (let i = 0; i < n - 1; i++) {
        const k = key(r.north[i], r.east[i]);
        const l = grid.get(k);
        if (l) l.push(i);
        else grid.set(k, [i]);
      }
      for (let i = 0; i < n - 1; i++)
        for (let a = -1; a <= 1; a++)
          for (let b = -1; b <= 1; b++)
            for (const j of grid.get(key(r.north[i] + a * 100, r.east[i] + b * 100)) ?? []) {
              if (j <= i + 2) continue;
              const ax = r.east[i], ay = r.north[i], bx = r.east[i + 1], by = r.north[i + 1];
              const cx = r.east[j], cy = r.north[j], dx = r.east[j + 1], dy = r.north[j + 1];
              const d1 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
              const d2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
              const d3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
              const d4 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
              if (d1 * d2 < 0 && d3 * d4 < 0) crossings++;
            }
    }
    const nS = rivers.filter((r) => r.kind === 1).length;
    console.log(`NC seed ${seed}: ${JSON.stringify(count)}; sunk ${sunk} of ${nS} streams (${((100 * sunk) / nS).toFixed(1)} %, test < 25 %); self-crossings ${crossings}; e.g. ${JSON.stringify(ex)}`);
  }
  setWorldSeed(0);
});
