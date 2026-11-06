// Probe (stage S): the bed's stones (channelStones.ts stoneAt / bigStoneAt) along every channel steeper than rapids,
// as the ribbon carries the values (rows interpolated): count per 100 m2 of water and radii (p50/p90/max) by grain, the
// very large blocks, and on the streams' units the density on pitches (pitch weight > 0.5) against pools (< 0.05).
//   ST_SEEDS=1,42,777777
import { it } from 'vitest';
import { hydrology } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
import { BIG_ACROSS, BIG_ALONG, bigStoneAt, pitchWeight, STONE_ACROSS, STONE_ALONG, STONE_IN, stoneAt, type ChannelStone, type StonePitch } from '../../src/world/terrain/channelStones';
import { pitchPhase, type PitchPhase } from '../../src/world/terrain/pitchPool';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
const q = (a: number[], p: number): number => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(p * a.length))] : NaN);
it('stone stats', () => {
  for (const seed of (env.ST_SEEDS ?? '1,42,777777').split(',').map(Number)) {
    setWorldSeed(seed);
    const bins = [0, 0.3, 1, 2, 9];
    const area = new Array(4).fill(0);
    const radii: number[][] = bins.slice(1).map(() => []);
    const big: number[] = [];
    const pit = { area: 0, n: 0 };
    const pool = { area: 0, n: 0 };
    const ph: PitchPhase = { k: 0, u: 0, pitch: 0, span: 1, size: 1 };
    const st: ChannelStone = { s: 0, x: 0, r: 0, submerged: false, stand: 0, u7: 0, u8: 0 };
    for (const r of hydrology.rivers ?? []) {
      if (!r.steepness || !r.grain) continue;
      for (let i = 0; i + 1 < r.s.length; i++) {
        const s0 = r.s[i], s1 = r.s[i + 1];
        if (!(s1 > s0) || Math.max(r.steepness[i], r.steepness[i + 1]) < 0.5) continue;
        const sg = { g0: r.sigma?.[i] ?? 0, g1: r.sigma?.[i + 1] ?? 0 };
        const P: StonePitch = { on: 0, sigmaAt: (s) => sg.g0 + ((sg.g1 - sg.g0) * (s - s0)) / (s1 - s0) };
        const at = (sv: number) => {
          const t = Math.min(1, Math.max(0, (sv - s0) / (s1 - s0)));
          P.on = (r.pitchOn?.[i] ?? 0) + ((r.pitchOn?.[i + 1] ?? 0) - (r.pitchOn?.[i] ?? 0)) * t;
          return [r.steepness![i] + (r.steepness![i + 1] - r.steepness![i]) * t, r.grain![i] + (r.grain![i + 1] - r.grain![i]) * t, r.halfWidth[i] + (r.halfWidth[i + 1] - r.halfWidth[i]) * t];
        };
        const [, gm, hw] = at((s0 + s1) / 2);
        let b = 0;
        while (gm >= bins[b + 1]) b++;
        const a = (s1 - s0) * 2 * STONE_IN * hw;
        area[b] += a;
        // Pitch / pool share of the segment's water (by its middle).
        let pw = -1;
        if (P.on > 0.5) { pw = pitchWeight(pitchPhase(P.sigmaAt((s0 + s1) / 2), ph)); if (pw > 0.5) pit.area += a; else if (pw < 0.05) pool.area += a; }
        for (const isBig of [false, true]) {
          const al = isBig ? BIG_ALONG : STONE_ALONG, ac = isBig ? BIG_ACROSS : STONE_ACROSS;
          const jm = Math.ceil((STONE_IN * hw) / ac + 0.5);
          for (let k = Math.floor(s0 / al) - 1; k <= Math.floor(s1 / al); k++) for (let j = -jm; j <= jm; j++) {
            const [s1v, g1v, h1v] = at((k + 0.5) * al);
            if (!(isBig ? bigStoneAt : stoneAt)(k, j, s1v, g1v, h1v, st, P)) continue;
            if (st.s < s0 || st.s >= s1) continue;
            if (isBig) big.push(st.r); else radii[b].push(st.r);
            if (P.on > 0.5) {
              const w = pitchWeight(pitchPhase(P.sigmaAt(st.s), ph));
              if (pw > 0.5 && w > 0.5) pit.n++;
              else if (pw >= 0 && pw < 0.05 && w < 0.05) pool.n++;
            }
          }
        }
      }
    }
    bins.slice(1).forEach((_, b) => {
      const R = radii[b];
      console.log(`STONES seed ${seed} grain ${bins[b]}-${bins[b + 1]} m: ${(area[b] / 1e4).toFixed(1)} ha water, ${R.length} stones (${((100 * R.length) / Math.max(1, area[b])).toFixed(2)} per 100 m2), radius p50/p90/max ${q(R, 0.5).toFixed(2)}/${q(R, 0.9).toFixed(2)}/${q(R, 1).toFixed(2)} m`);
    });
    console.log(`STONES seed ${seed} very large blocks: ${big.length}, radius p50/p90/max ${q(big, 0.5).toFixed(2)}/${q(big, 0.9).toFixed(2)}/${q(big, 1).toFixed(2)} m`);
    console.log(`STONES seed ${seed} streams' units: pitches ${(100 * pit.n / Math.max(1, pit.area)).toFixed(2)} per 100 m2 (${(pit.area / 1e4).toFixed(1)} ha), pools ${(100 * pool.n / Math.max(1, pool.area)).toFixed(2)} per 100 m2 (${(pool.area / 1e4).toFixed(1)} ha)`);
  }
  setWorldSeed(0);
});
