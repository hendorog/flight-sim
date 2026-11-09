// mouthDump (round T): a stream's last MD_LEN m against its receiver: each sample's position, level, half-width, the
// distance to the receiver's course and the receiver's water there, and the stream's heading against the receiver's
// downstream heading at the nearest point. The stream: the line (A >= MD_A at its end) passing nearest MD_AT.
//   MD_SEED=42 MD_AT=-13744,-42501 MD_A=50 npx vitest run --config scripts/probes/vitest.config.ts mouthDump --silent=false
import { it } from 'vitest';
import { hydrology, terrainHeight } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('mouth dump', () => {
  setWorldSeed(Number(env.MD_SEED ?? 42));
  terrainHeight(0, 0);
  const L = hydrology.rivers!;
  const [an, ae] = (env.MD_AT ?? '-13744,-42501').split(',').map(Number);
  const MINA = Number(env.MD_A ?? 50);
  let bl = -1, bd = Infinity;
  L.forEach((r, li) => { if ((r.kind ?? 0) === 0 || (r.area?.[r.s.length - 1] ?? 0) < MINA) return; for (let i = 0; i < r.s.length; i++) { const d = Math.hypot(r.north[i] - an, r.east[i] - ae); if (d < bd) { bd = d; bl = li; } } });
  const r = L[bl]; const m = r.s.length; const T = L[r.joins ?? -1];
  console.log(`line ${bl} (${bd.toFixed(0)} m from ${an},${ae}): ${m} samples, ${r.s[m - 1].toFixed(0)} m, A ${r.area![m - 1].toFixed(1)}, joins ${r.joins} (kind ${T?.kind}), end ${r.end}`);
  if (!T) return;
  const D = 180 / Math.PI;
  for (let i = 0; i < m; i++) {
    if (r.s[i] < r.s[m - 1] - Number(env.MD_LEN ?? 1500)) continue;
    let best = Infinity, bi = 0;
    for (let k = 0; k < T.s.length - 1; k++) { const d = Math.hypot(T.north[k] - r.north[i], T.east[k] - r.east[i]); if (d < best) { best = d; bi = k; } }
    const k1 = Math.min(T.s.length - 1, bi + 2);
    const hT = Math.atan2(T.east[k1] - T.east[bi], T.north[k1] - T.north[bi]);
    const i0 = Math.max(0, i - 2);
    const hS = Math.atan2(r.east[i] - r.east[i0], r.north[i] - r.north[i0]);
    let da = Math.abs(hS - hT) * D; if (da > 180) da = 360 - da;
    console.log(`  s ${r.s[i].toFixed(0)} at ${r.north[i].toFixed(0)},${r.east[i].toFixed(0)} lvl ${r.level[i].toFixed(1)} hw ${r.halfWidth[i].toFixed(1)} | receiver ${best.toFixed(0)} m (hw ${T.halfWidth[bi].toFixed(1)}, lvl ${T.level[bi].toFixed(1)}, s ${T.s[bi].toFixed(0)}) heading vs receiver ${da.toFixed(0)} deg`);
  }
  setWorldSeed(0);
});
