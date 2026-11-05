// Probe: one stream's profile (the stream nearest SP_N, SP_E): every few samples its water level, the ground under it
// (sampleTerrain and naturalHeight) and its flow.
import { it } from 'vitest';
import { hydrology, makeSample, naturalHeight, naturalHeightSmooth, naturalHeightCoarse, sampleTerrain } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
it('stream profile', () => {
  setWorldSeed(Number(process.env.SP_SEED ?? 42));
  const pn = Number(process.env.SP_N ?? -42000), pe = Number(process.env.SP_E ?? 49000);
  const rs = hydrology.rivers!;
  let best = -1, bd = Infinity;
  rs.forEach((r, li) => { if (r.kind !== 1) return; for (let i = 0; i < r.north.length; i++) { const d = Math.hypot(r.north[i] - pn, r.east[i] - pe); if (d < bd) { bd = d; best = li; } } });
  const r = rs[best];
  const s = makeSample();
  console.log(`line ${best}: ${r.north.length} pts, ${(r.s[r.s.length - 1] / 1000).toFixed(1)} km, joins ${r.joins}, ends ${r.end} at ${r.north[r.north.length - 1].toFixed(0)},${r.east[r.east.length - 1].toFixed(0)}`);
  const every = Number(process.env.SP_EVERY ?? 5);
  for (let i = 0; i < r.north.length; i += every) {
    sampleTerrain(r.north[i], r.east[i], s);
    console.log(`  s ${r.s[i].toFixed(0).padStart(6)} at ${(r.north[i] / 1000).toFixed(2)},${(r.east[i] / 1000).toFixed(2)}: level ${r.level[i].toFixed(1)} terrain ${s.ground.toFixed(1)} natural ${naturalHeight(r.north[i], r.east[i]).toFixed(1)} smooth ${naturalHeightSmooth(r.north[i], r.east[i]).toFixed(1)} coarse ${naturalHeightCoarse(r.north[i], r.east[i]).toFixed(1)} hw ${r.halfWidth[i].toFixed(1)} grad ${(100 * r.gradient![i]).toFixed(1)}% regime ${r.regime![i]}`);
  }
  setWorldSeed(0);
});
