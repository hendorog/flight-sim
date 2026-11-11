// Round W R: a river's floor across, station by station - the drawn ground either side of its water (over the water,
// m), where its valley axis (the course its thread was laid about) lies, the room the law read either side, its bed and
// wet edges. For the owner's river 209 on seed 42 ("the rivers tend to flow down the true left or true right of the
// valley floors").
//   FX_SEED=42 FX_AT=-2889,-10734 FX_SPAN=4000 FX_EVERY=250 FX_HALF=900 FX_STEP=30 \
//     npx vitest run --config scripts/probes/vitest.config.ts scripts/probes/floorX.test.ts --silent=false --disable-console-intercept
import { it } from 'vitest';
import { hydrology, makeSample, sampleTerrain, terrainHeight } from '../../src/world/terrain/heightfield';
import { formProbe } from '../../src/world/terrain/riverNetwork';
import { setWorldSeed } from '../../src/world/worldSeed';

const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
type Line = { north: Float64Array; east: Float64Array; level: Float64Array; halfWidth: Float64Array; s: Float64Array; kind?: number; area?: Float64Array; bedR?: Float32Array; bedL?: Float32Array; wetR?: Float32Array; wetL?: Float32Array };

it('floor across', () => {
  const seed = Number(env.FX_SEED ?? 42);
  const [an, ae] = (env.FX_AT ?? '-2889,-10734').split(',').map(Number);
  const span = Number(env.FX_SPAN ?? 4000), every = Number(env.FX_EVERY ?? 250), half = Number(env.FX_HALF ?? 900), step = Number(env.FX_STEP ?? 30);
  const axes = new Map<number, { north: Float64Array; east: Float64Array; s: Float64Array; roomL: Float64Array; roomR: Float64Array; rL: Float64Array; rR: Float64Array; belt?: Float64Array }>();
  formProbe.on = (li, a) => axes.set(li, { north: Float64Array.from(a.north), east: Float64Array.from(a.east), s: Float64Array.from(a.s), roomL: Float64Array.from(a.roomL), roomR: Float64Array.from(a.roomR), rL: Float64Array.from(a.rL), rR: Float64Array.from(a.rR) });
  setWorldSeed(seed);
  terrainHeight(0, 0);
  formProbe.on = undefined;
  const L = hydrology.rivers as unknown as Line[];
  let best = -1, bi = 0, bd = Infinity;
  const want = env.FX_LINE ? Number(env.FX_LINE) : -1;
  L.forEach((r, li) => {
    if ((r.kind ?? 0) !== 0 && want < 0) return;
    if (want >= 0 && li !== want) return;
    for (let i = 0; i < r.north.length; i++) {
      const d = Math.hypot(r.north[i] - an, r.east[i] - ae);
      if (d < bd) (bd = d), (best = li), (bi = i);
    }
  });
  const S = makeSample();
  if (env.FX_ALL) {
    // Every river of FX_MINA km² or more, every FX_ALLSTEP m of its channel: the room the law read either side (about its
    // axis, at the axis point nearest) against the floor drawn there (lowLine's: about the channel, out to where the
    // ground first reaches the water + 5 m, at most 2 km, stopping at other water), both as widths.
    const minA = Number(env.FX_MINA ?? 20), st = Number(env.FX_ALLSTEP ?? 500);
    const rows: Array<{ A: number; room: number; floor: number; asym: number; pos: number }> = [];
    L.forEach((r, li) => {
      if ((r.kind ?? 0) !== 0) return;
      const ax = axes.get(li);
      if (!ax) return;
      const m = r.s.length;
      for (let sv = 300; sv < r.s[m - 1] - 300; sv += st) {
        let i = 0;
        while (i < m - 2 && r.s[i + 1] <= sv) i++;
        const A = r.area ? r.area[i] : 0;
        if (A < minA) continue;
        const n = r.north[i], e = r.east[i], lv = r.level[i];
        sampleTerrain(n, e, S);
        if (S.standing > S.ground + 0.05) continue;
        const i0 = Math.max(0, i - 3), i1 = Math.min(m - 1, i + 3);
        let dn = r.north[i1] - r.north[i0], de = r.east[i1] - r.east[i0];
        const dl = Math.hypot(dn, de) || 1;
        dn /= dl;
        de /= dl;
        const hw = Math.max(r.halfWidth[i], r.wetR ? r.wetR[i] : 0, r.wetL ? r.wetL[i] : 0);
        let fw = 0;
        for (const sd of [1, -1]) {
          let end = 2000;
          for (let o = hw + 10; o <= 2000; o += 10) {
            sampleTerrain(n - de * o * sd, e + dn * o * sd, S);
            if (S.standing > S.ground + 0.05 || (S.river > S.ground && S.river < lv - 1)) { end = o; break; }
            if (S.ground >= lv + 5) { end = o; break; }
          }
          fw += end;
        }
        let bd = Infinity, bk = 0;
        for (let k = 0; k < ax.north.length; k++) { const d = (ax.north[k] - n) ** 2 + (ax.east[k] - e) ** 2; if (d < bd) (bd = d), (bk = k); }
        // (The axis's place in its room, 0 the middle, 1 at a wall; the channel's offset from the axis over the room on its side.)
        const rw = ax.roomL[bk] + ax.roomR[bk];
        const off = (ax.north[bk] - n) * -de + (ax.east[bk] - e) * dn; // the axis right of the channel: +
        const roomSide = off > 0 ? ax.roomL[bk] : ax.roomR[bk]; // the channel lies left of the axis when off > 0
        rows.push({ A, room: rw, floor: fw, asym: Math.abs(ax.roomR[bk] - ax.roomL[bk]) / Math.max(1, rw), pos: Math.abs(off) / Math.max(1, roomSide) });
      }
    });
    const q = (a: number[], p: number): number => { const b = [...a].sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(p * b.length))] ?? NaN; };
    for (const [lo, hi] of [[20, 100], [100, 500], [500, 2000], [2000, 1e9], [20, 1e9]]) {
      const b = rows.filter((x) => x.A >= lo && x.A < hi);
      const ratio = b.map((x) => x.floor / Math.max(1, x.room));
      console.log(`FXALL seed ${seed} A ${lo}-${hi === 1e9 ? 'up' : hi}: ${b.length} stations; room width p50 ${q(b.map((x) => x.room), 0.5).toFixed(0)} p90 ${q(b.map((x) => x.room), 0.9).toFixed(0)}; drawn floor width p50 ${q(b.map((x) => x.floor), 0.5).toFixed(0)} p90 ${q(b.map((x) => x.floor), 0.9).toFixed(0)}; floor/room p10 ${q(ratio, 0.1).toFixed(2)} p50 ${q(ratio, 0.5).toFixed(2)} p90 ${q(ratio, 0.9).toFixed(2)}; share floor > 3 room ${((100 * ratio.filter((x) => x > 3).length) / Math.max(1, ratio.length)).toFixed(0)} %; axis off-middle of its room p50 ${q(b.map((x) => x.asym), 0.5).toFixed(2)} p90 ${q(b.map((x) => x.asym), 0.9).toFixed(2)}; channel from axis / room that side p50 ${q(b.map((x) => x.pos), 0.5).toFixed(2)} p90 ${q(b.map((x) => x.pos), 0.9).toFixed(2)}`);
    }
    return;
  }
  const r = L[best];
  const ax = axes.get(best);
  console.log(`FX seed ${seed} line ${best} (kind ${r.kind ?? 0}) nearest sample ${bi} at ${bd.toFixed(0)} m; length ${(r.s[r.s.length - 1] / 1000).toFixed(1)} km; axis captured ${!!ax}`);
  const lerp = (s: ArrayLike<number>, a: ArrayLike<number>, sv: number): number => {
    let lo = 0, hi = s.length - 1;
    if (sv <= s[0]) return a[0];
    if (sv >= s[hi]) return a[hi];
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (s[m] <= sv) lo = m; else hi = m; }
    return a[lo] + ((a[hi] - a[lo]) * (sv - s[lo])) / Math.max(1e-9, s[hi] - s[lo]);
  };
  const s0 = r.s[bi];
  const cols: number[] = [];
  for (let o = -half; o <= half + 1e-6; o += step) cols.push(o);
  console.log(`FX columns (right of the flow +, m): ${cols.join(' ')}`);
  for (let sv = Math.max(0, s0 - span / 2); sv <= Math.min(r.s[r.s.length - 1], s0 + span / 2); sv += every) {
    const n = lerp(r.s, r.north, sv), e = lerp(r.s, r.east, sv), lv = lerp(r.s, r.level, sv);
    const pa = Math.max(0, sv - 100), pb = Math.min(r.s[r.s.length - 1], sv + 100);
    let dn = lerp(r.s, r.north, pb) - lerp(r.s, r.north, pa), de = lerp(r.s, r.east, pb) - lerp(r.s, r.east, pa);
    const dl = Math.hypot(dn, de) || 1;
    dn /= dl;
    de /= dl;
    // Right of the flow: (-de, dn).
    let axOff = NaN, rl = NaN, rr = NaN, rL = NaN, rR = NaN, bl = NaN;
    if (ax) {
      let bdd = Infinity, bk = 0, bt = 0;
      for (let k = 0; k + 1 < ax.north.length; k++) {
        const bn = ax.north[k + 1] - ax.north[k], be = ax.east[k + 1] - ax.east[k];
        const l2 = bn * bn + be * be || 1;
        const t = Math.min(1, Math.max(0, ((n - ax.north[k]) * bn + (e - ax.east[k]) * be) / l2));
        const d = (ax.north[k] + bn * t - n) ** 2 + (ax.east[k] + be * t - e) ** 2;
        if (d < bdd) (bdd = d), (bk = k), (bt = t);
      }
      const xn = ax.north[bk] + (ax.north[bk + 1] - ax.north[bk]) * bt, xe = ax.east[bk] + (ax.east[bk + 1] - ax.east[bk]) * bt;
      axOff = (xn - n) * -de + (xe - e) * dn; // the axis right of the water: +
      const ix = (a: Float64Array): number => a[bk] + (a[bk + 1] - a[bk]) * bt;
      rl = ix(ax.roomL); rr = ix(ax.roomR); rL = ix(ax.rL); rR = ix(ax.rR); if (ax.belt) bl = ix(ax.belt);
    }
    const row: string[] = [];
    let lowO = 0, low = Infinity;
    for (const o of cols) {
      const pn = n - de * o, pe = e + dn * o;
      sampleTerrain(pn, pe, S);
      const g = S.ground - lv;
      const wet = S.river > S.ground || S.standing > S.ground + 0.05;
      row.push(wet ? (S.standing > S.ground + 0.05 ? 'L' : '~') : g > 99 ? '+' : g < -9.5 ? 'v' : g.toFixed(0));
      if (!wet && Math.abs(o) > 20 && g < low && g < 30) (low = g), (lowO = o);
    }
    const i = Math.max(0, Math.min(r.s.length - 1, (() => { let lo = 0, hi = r.s.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (r.s[m] <= sv) lo = m; else hi = m; } return lo; })()));
    console.log(`FX s ${(sv / 1000).toFixed(2)} at ${n.toFixed(0)},${e.toFixed(0)} lv ${lv.toFixed(1)} A ${r.area ? r.area[i].toFixed(0) : '?'} hw ${r.halfWidth[i].toFixed(1)} bedL/R ${r.bedL ? r.bedL[i].toFixed(0) : '-'}/${r.bedR ? r.bedR[i].toFixed(0) : '-'} wetL/R ${r.wetL ? r.wetL[i].toFixed(0) : '-'}/${r.wetR ? r.wetR[i].toFixed(0) : '-'} axis ${axOff.toFixed(0)} room L/R ${rl.toFixed(0)}/${rr.toFixed(0)} thread room ${rL.toFixed(0)}/${rR.toFixed(0)} belt ${bl.toFixed(0)} lowest dry ${low.toFixed(1)} at ${lowO} | ${row.join(' ')}`);
  }
});
