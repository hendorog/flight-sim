// Probe (stage S): camera views of steep streams (kind 1): the middle of each stream's steepest long reach (gradient
// over SC_G, half-width over SC_HW), seen from downstream looking up it, at 150 / 450 / 1500 ft over the highest ground
// near the camera; plus the stream nearest each given reference point (SC_REFS "name@seed@north,east;...").
//   SC_SEEDS=42,1,777777 SC_N=2
import { it } from 'vitest';
import { hydrology, terrainHeight } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
const FT = 0.3048;
function cams(name: string, seed: number, r: any, k: number): void {
  // Downstream direction at k (over +-60 m).
  let a = k, b = k;
  while (a > 0 && r.s[k] - r.s[a] < 60) a--;
  while (b < r.s.length - 1 && r.s[b] - r.s[k] < 60) b++;
  const dn = r.north[b] - r.north[a], de = r.east[b] - r.east[a], dl = Math.hypot(dn, de) || 1;
  const un = dn / dl, ue = de / dl;
  for (const ft of [150, 450, 1500]) {
    const agl = ft * FT;
    const back = 2.5 * agl + 80;
    // Downstream of the point, a little to its side, looking back up the stream.
    const cn = r.north[k] + un * back - ue * 0.35 * back, ce = r.east[k] + ue * back + un * 0.35 * back;
    let hi = -Infinity;
    for (let p = -2; p <= 2; p++) for (let q = -2; q <= 2; q++) hi = Math.max(hi, terrainHeight(cn + p * 40, ce + q * 40));
    console.log(`SCAM ${name}-${ft} seed=${seed}&camPos=${cn.toFixed(0)},${ce.toFixed(0)},${(hi + agl).toFixed(0)}&camLook=${r.north[k].toFixed(0)},${r.east[k].toFixed(0)},${r.level[k].toFixed(0)}`);
  }
}
it('steep cams', () => {
  const G = Number(env.SC_G ?? 0.08), HW = Number(env.SC_HW ?? 2.5), N = Number(env.SC_N ?? 2);
  for (const seed of (env.SC_SEEDS ?? '42,1,777777').split(',').map(Number)) {
    setWorldSeed(seed);
    const cand: Array<{ li: number; k: number; len: number }> = [];
    (hydrology.rivers ?? []).forEach((r: any, li) => {
      if (r.kind !== 1) return;
      let i0 = -1;
      let best = { len: 0, k: -1 };
      for (let i = 0; i < r.s.length; i++) {
        const ok = r.gradient[i] >= G && r.halfWidth[i] >= HW && r.regime[i] !== 4;
        if (ok && i0 < 0) i0 = i;
        if ((!ok || i === r.s.length - 1) && i0 >= 0) {
          const len = r.s[i] - r.s[i0];
          if (len > best.len) best = { len, k: (i0 + i) >> 1 };
          i0 = -1;
        }
      }
      if (best.k >= 0) cand.push({ li, k: best.k, len: best.len });
    });
    cand.sort((a, b) => b.len - a.len);
    // Spread out: no two within 5 km.
    const picked: typeof cand = [];
    for (const c of cand) {
      const r: any = hydrology.rivers![c.li];
      if (picked.some((p) => { const q: any = hydrology.rivers![p.li]; return Math.hypot(q.north[p.k] - r.north[c.k], q.east[p.k] - r.east[c.k]) < 5000; })) continue;
      picked.push(c);
      if (picked.length >= N) break;
    }
    for (const c of picked) {
      const r: any = hydrology.rivers![c.li];
      console.log(`SCINFO s${seed}l${c.li} k ${c.k} reach ${c.len.toFixed(0)} m g ${r.gradient[c.k].toFixed(3)} hw ${r.halfWidth[c.k].toFixed(1)} at ${r.north[c.k].toFixed(0)},${r.east[c.k].toFixed(0)}`);
      cams(`st${seed}l${c.li}`, seed, r, c.k);
    }
    for (const ref of (env.SC_REFS ?? '').split(';').filter(Boolean)) {
      const [name, sd, pt] = ref.split('@');
      if (Number(sd) !== seed) continue;
      const [pn, pe] = pt.split(',').map(Number);
      let bd = Infinity, bl = -1, bk = -1;
      (hydrology.rivers ?? []).forEach((r: any, li) => {
        if (r.kind !== 1) return;
        for (let i = 0; i < r.s.length; i++) {
          const d = Math.hypot(r.north[i] - pn, r.east[i] - pe);
          if (d < bd) { bd = d; bl = li; bk = i; }
        }
      });
      if (bl < 0) continue;
      const r: any = hydrology.rivers![bl];
      console.log(`SCINFO ref ${name}: nearest stream l${bl} at ${bd.toFixed(0)} m, g ${r.gradient[bk].toFixed(3)} hw ${r.halfWidth[bk].toFixed(1)}`);
      if (bd < 800) cams(name, seed, r, bk);
    }
  }
  setWorldSeed(0);
});
