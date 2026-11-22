// Probe: the erosion pass's cut as the terrain gets it (erosion.ts, heightfield.ts): beading along diagonal valleys,
// closed hollows on a 250 m grid, overshoot above the uneroded ground, the cut near the lattice edge and by home.
//   CUT_SEEDS=42,777777,4242 [CUT_PARTS=beads,thalweg,home,pits,wide,over] [T_LINE=seed:n0,e0,n1,e1;...]
//   [T_RIVER=seed:north,east,km;...] [CUT_MAP=50: map of the hollows deeper than that, with 'wide']
//   npx vitest run --config scripts/probes/vitest.config.ts cutCheck --silent=false --disable-console-intercept
import { it } from 'vitest';
import { hydrology, naturalHeight, naturalHeightCoarse, naturalHeightRaw } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
import { AIRPORT } from '../../src/core/world';

const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
const parts = (env.CUT_PARTS ?? 'beads,thalweg,pits,over').split(',');

/** Priority flood (8-neighbour) of an nx x ny grid, outlets at the grid edge and at or below 0 m. */
function fill(h: Float64Array, nx: number, ny: number): Float64Array {
  const f = new Float64Array(nx * ny).fill(Infinity);
  const ids: number[] = [];
  const ks: number[] = [];
  const push = (id: number, k: number): void => {
    let i = ids.length;
    ids.push(id);
    ks.push(k);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (ks[p] <= k) break;
      ids[i] = ids[p];
      ks[i] = ks[p];
      i = p;
    }
    ids[i] = id;
    ks[i] = k;
  };
  const pop = (): number => {
    const top = ids[0];
    const id = ids.pop()!;
    const k = ks.pop()!;
    const L = ids.length;
    if (L > 0) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= L) break;
        let m = l;
        if (l + 1 < L && ks[l + 1] < ks[l]) m = l + 1;
        if (ks[m] >= k) break;
        ids[i] = ids[m];
        ks[i] = ks[m];
        i = m;
      }
      ids[i] = id;
      ks[i] = k;
    }
    return top;
  };
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      const c = y * nx + x;
      if (h[c] <= 0 || x === 0 || y === 0 || x === nx - 1 || y === ny - 1) {
        f[c] = h[c];
        push(c, h[c]);
      }
    }
  }
  while (ids.length) {
    const c = pop();
    const y = (c / nx) | 0;
    const x = c % nx;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const yy = y + dy;
        const xx = x + dx;
        if (yy < 0 || xx < 0 || yy >= ny || xx >= nx) continue;
        const nb = yy * nx + xx;
        if (f[nb] !== Infinity) continue;
        f[nb] = Math.max(h[nb], f[c]);
        push(nb, f[nb]);
      }
    }
  }
  return f;
}

it('cut check', () => {
  if (parts.includes('beads')) {
    // Seed 42's north-east river (a diagonal run on the lattice) by default; T_LINE runs downstream.
    const lines = (env.T_LINE ?? '42:30750,12000,26500,21750').split(';');
    for (const spec of lines) {
      const [seedStr, coords] = spec.includes(':') ? spec.split(':') : [env.T_SEED ?? '42', spec];
      setWorldSeed(Number(seedStr));
      const [n0, e0, n1, e1] = coords.split(',').map(Number);
      const L = Math.hypot(n1 - n0, e1 - e0);
      const un = (n1 - n0) / L;
      const ue = (e1 - e0) / L;
      let prev = Infinity;
      let rises = 0;
      let rise = 0;
      let sumRise = 0;
      let out = '';
      for (let d = 0; d <= L; d += 100) {
        let lo = Infinity;
        for (let w = -1200; w <= 1200; w += 50) lo = Math.min(lo, naturalHeightCoarse(n0 + un * d - ue * w, e0 + ue * d + un * w));
        if (lo > prev + 1) {
          rises++;
          rise = Math.max(rise, lo - prev);
          sumRise += lo - prev;
        }
        prev = lo;
        if (d % 400 === 0) out += `${(d / 1000).toFixed(1)}:${lo.toFixed(0)} `;
      }
      console.log(`seed ${seedStr} line ${coords}: floor (coarse natural, lowest within 1.2 km either side, every 100 m)\n  ${out}`);
      console.log(`  floor rises downstream ${rises} times (>1 m), worst ${rise.toFixed(1)} m, total ${sumRise.toFixed(0)} m`);
      // Closed hollows on a 250 m grid over the corridor (3 km either side of the line, 2 km beyond its ends).
      const step = 250;
      const along = Math.ceil((L + 4000) / step) + 1;
      const across = Math.ceil(6000 / step) + 1;
      const h = new Float64Array(along * across);
      for (let y = 0; y < across; y++) {
        for (let x = 0; x < along; x++) {
          const d = -2000 + x * step;
          const w = -3000 + y * step;
          h[y * along + x] = naturalHeightCoarse(n0 + un * d - ue * w, e0 + ue * d + un * w);
        }
      }
      const f = fill(h, along, across);
      // Closed hollows: connected cells filled over 1 m; each one's deepest fill.
      const seen = new Uint8Array(along * across);
      const depths: number[] = [];
      const where: string[] = [];
      for (let c = 0; c < h.length; c++) {
        if (seen[c] || f[c] - h[c] <= 1) continue;
        let deep = 0;
        let at = c;
        const stack = [c];
        seen[c] = 1;
        while (stack.length) {
          const q = stack.pop()!;
          if (f[q] - h[q] > deep) [deep, at] = [f[q] - h[q], q];
          const y = (q / along) | 0;
          const x = q % along;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const yy = y + dy;
              const xx = x + dx;
              if (yy < 0 || xx < 0 || yy >= across || xx >= along) continue;
              const nb = yy * along + xx;
              if (seen[nb] || f[nb] - h[nb] <= 1) continue;
              seen[nb] = 1;
              stack.push(nb);
            }
          }
        }
        depths.push(deep);
        const d = -2000 + (at % along) * step;
        const w = -3000 + Math.floor(at / along) * step;
        if (deep > 5) where.push(`${deep.toFixed(0)} m at ${((n0 + un * d - ue * w) / 1000).toFixed(2)},${((e0 + ue * d + un * w) / 1000).toFixed(2)}`);
      }
      depths.sort((a, b) => b - a);
      if (where.length) console.log(`  hollows over 5 m: ${where.join('; ')}`);
      console.log(`  250 m grid, +-3 km corridor: ${depths.length} closed hollows >1 m, ${depths.filter((d) => d > 5).length} >5 m, ${depths.filter((d) => d > 20).length} >20 m; deepest ${depths.slice(0, 6).map((d) => d.toFixed(0)).join(', ')} m`);
    }
  }
  if (parts.includes('thalweg')) {
    // Along a river's course (the river nearest the point, R_KM km of it centred there): the valley floor, the lowest
    // coarse natural ground within 600 m either side, every 100 m downstream; how often it rises.
    for (const spec of (env.T_RIVER ?? '42:28600,16900,14;4242:0,0,14').split(';')) {
      const [seedStr, rest] = spec.split(':');
      const [pn, pe, km] = rest.split(',').map(Number);
      setWorldSeed(Number(seedStr));
      let best = Infinity;
      let li = -1;
      let k0 = 0;
      hydrology.rivers!.forEach((r, i) => {
        for (let k = 0; k < r.north.length; k++) {
          const d = Math.hypot(r.north[k] - pn, r.east[k] - pe);
          if (d < best) [best, li, k0] = [d, i, k];
        }
      });
      const r = hydrology.rivers![li];
      const s0 = r.s[k0];
      let prev = Infinity;
      let rises = 0;
      let worst = 0;
      let total = 0;
      let out = '';
      let k = 0;
      let worstAt = '';
      let lakePts = 0;
      for (let s = Math.max(0, s0 - (km * 500)); s <= Math.min(r.s[r.s.length - 1], s0 + km * 500); s += 100) {
        while (k < r.s.length - 2 && r.s[k + 1] < s) k++;
        const t = (s - r.s[k]) / Math.max(1e-6, r.s[k + 1] - r.s[k]);
        const n = r.north[k] + (r.north[k + 1] - r.north[k]) * t;
        const e = r.east[k] + (r.east[k + 1] - r.east[k]) * t;
        const dn = r.north[k + 1] - r.north[k];
        const de = r.east[k + 1] - r.east[k];
        const L = Math.hypot(dn, de) || 1;
        let lo = Infinity;
        for (let w = -600; w <= 600; w += 50) lo = Math.min(lo, naturalHeightCoarse(n - (de / L) * w, e + (dn / L) * w));
        // Through a lake the floor is the lake's bed: not counted.
        const lake = hydrology.lakeMask ? hydrology.lakeMask.at(n, e) > -Infinity : false;
        if (lake) lakePts++;
        if (lo > prev + 1 && !lake) {
          rises++;
          if (lo - prev > worst) [worst, worstAt] = [lo - prev, `${(n / 1000).toFixed(2)},${(e / 1000).toFixed(2)}`];
          total += lo - prev;
        }
        prev = lo;
        if (Math.round(s) % 1000 < 100) out += `${(n / 1000).toFixed(1)},${(e / 1000).toFixed(1)}:${lo.toFixed(0)} `;
      }
      console.log(`seed ${seedStr} river ${li} (${(best / 1000).toFixed(1)} km from ${pn},${pe}), ${km} km of it: valley floor (lowest coarse within 600 m across, every 100 m)\n  ${out}`);
      console.log(`  floor rises downstream ${rises} times (>1 m), worst ${worst.toFixed(1)} m at ${worstAt}, total ${total.toFixed(0)} m (${lakePts} points in lakes not counted)`);
    }
  }
  const seeds = (env.CUT_SEEDS ?? '42,777777,4242').split(',').map(Number);
  if (parts.includes('home')) {
    // By the home field: how far the ground stands over the rivers within 6 km of it (a trench), outside lakes.
    for (const seed of seeds) {
      setWorldSeed(seed);
      const hn = AIRPORT.runway.center.north;
      const he = AIRPORT.runway.center.east;
      let worst = 0;
      let at = '';
      let pts = 0;
      for (const r of hydrology.rivers!) {
        for (let k = 0; k < r.north.length; k += 4) {
          const n = r.north[k];
          const e = r.east[k];
          if (Math.hypot(n - hn, e - he) > 6000 || (hydrology.lakeMask && hydrology.lakeMask.at(n, e) > -Infinity)) continue;
          pts++;
          const over = naturalHeight(n, e) - r.level[k];
          if (over > worst) [worst, at] = [over, `${((n - hn) / 1000).toFixed(1)},${((e - he) / 1000).toFixed(1)} km from it`];
        }
      }
      console.log(`seed ${seed}: within 6 km of the home field ${pts} river points, the ground stands at most ${worst.toFixed(0)} m over the water (${at})`);
    }
  }
  if (parts.includes('pits')) {
    const half = 60000;
    const step = 250;
    for (const seed of seeds) {
      setWorldSeed(seed);
      const n = Math.round((2 * half) / step) + 1;
      const h = new Float64Array(n * n);
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) h[y * n + x] = naturalHeightCoarse(half - y * step, -half + x * step);
      const fl = fill(h, n, n);
      let land = 0;
      let f5 = 0;
      let f20 = 0;
      let f50 = 0;
      for (let c = 0; c < n * n; c++) {
        if (h[c] <= 0) continue;
        land++;
        const d = fl[c] - h[c];
        if (d > 5) f5++;
        if (d > 20) f20++;
        if (d > 50) f50++;
      }
      console.log(`seed ${seed} eroded coarse (250 m grid, +-60 km): land in fill >5 m ${((100 * f5) / land).toFixed(2)} %, >20 m ${((100 * f20) / land).toFixed(2)} %, >50 m ${((100 * f50) / land).toFixed(2)} %`);
    }
  }
  if (parts.includes('wide')) {
    // The whole lattice on a 500 m grid: closed hollows by distance inside the lattice's edge.
    const half = 160000;
    const step = 500;
    for (const seed of seeds) {
      setWorldSeed(seed);
      const n = Math.round((2 * half) / step) + 1;
      const h = new Float64Array(n * n);
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) h[y * n + x] = naturalHeightCoarse(half - y * step, -half + x * step);
      const fl = fill(h, n, n);
      const bands = [10000, 30000, 200000];
      const land = [0, 0, 0];
      const f20 = [0, 0, 0];
      const f50 = [0, 0, 0];
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const c = y * n + x;
          if (h[c] <= 0) continue;
          const inside = half - Math.max(Math.abs(half - y * step), Math.abs(-half + x * step));
          const b = bands.findIndex((v) => inside < v);
          land[b]++;
          const d = fl[c] - h[c];
          if (d > 20) f20[b]++;
          if (d > 50) f50[b]++;
        }
      }
      const pc = (a: number, b: number): string => ((100 * a) / Math.max(1, b)).toFixed(2);
      const all = (v: number[]): number => v.reduce((a, b) => a + b, 0);
      if (env.CUT_MAP) {
        // Where: per 10 km block, the share of land filled over 50 m (0-9, '.' none, ' ' sea).
        let map = '';
        for (let by = 0; by < 32; by++) {
          for (let bx = 0; bx < 32; bx++) {
            let l = 0;
            let f = 0;
            for (let y = by * 20; y < by * 20 + 20; y++) for (let x = bx * 20; x < bx * 20 + 20; x++) if (h[y * n + x] > 0) (l++, fl[y * n + x] - h[y * n + x] > Number(env.CUT_MAP) && f++);
            map += l === 0 ? ' ' : f === 0 ? '.' : String(Math.min(9, Math.floor((10 * f) / l)));
          }
          map += '\n';
        }
        console.log(map);
      }
      console.log(`seed ${seed} eroded coarse (500 m grid, whole lattice): land in fill >20 m ${pc(all(f20), all(land))} %, >50 m ${pc(all(f50), all(land))} %; within 10 km of the edge ${pc(f20[0], land[0])} / ${pc(f50[0], land[0])} %, 10-30 km ${pc(f20[1], land[1])} / ${pc(f50[1], land[1])} %, further in ${pc(f20[2], land[2])} / ${pc(f50[2], land[2])} %`);
    }
  }
  if (parts.includes('over')) {
    const H = 160000;
    for (const seed of seeds) {
      setWorldSeed(seed);
      const hn = AIRPORT.runway.center.north;
      const he = AIRPORT.runway.center.east;
      let posMax = 0;
      let posNear = 0;
      let pn = 0;
      let pe = 0;
      const bands = [[-15000, 0], [0, 5000], [5000, 20000], [20000, 200000]];
      const bandMin = bands.map(() => 0);
      for (let n = -175000; n <= 175000; n += 500) {
        for (let e = -175000; e <= 175000; e += 500) {
          const d = naturalHeightCoarse(n, e) - naturalHeightRaw(n, e, false);
          if (d > posMax) {
            posMax = d;
            pn = n;
            pe = e;
          }
          if (Math.hypot(n - hn, e - he) < 6000) posNear = Math.max(posNear, d);
          const inside = H - Math.max(Math.abs(n), Math.abs(e));
          bands.forEach(([a, b], k) => {
            if (inside >= a && inside < b) bandMin[k] = Math.min(bandMin[k], d);
          });
        }
      }
      let padMin = 0;
      let padMax = 0;
      for (let n = -2500; n <= 2500; n += 50) {
        for (let e = -2500; e <= 2500; e += 50) {
          if (Math.hypot(n, e) >= 1500) continue;
          const d = naturalHeightCoarse(hn + n, he + e) - naturalHeightRaw(hn + n, he + e, false);
          padMin = Math.min(padMin, d);
          padMax = Math.max(padMax, d);
        }
      }
      console.log(`seed ${seed}: overshoot (ground raised over the uneroded) max ${posMax.toFixed(2)} m at ${(pn / 1000).toFixed(1)},${(pe / 1000).toFixed(1)} km, within 6 km of home ${posNear.toFixed(2)} m; pad (r < 1.5 km) ${padMin.toFixed(2)}..${padMax.toFixed(2)} m`);
      console.log(`  deepest cut by distance inside the lattice edge: ${bands.map(([a, b], k) => `[${a / 1000},${Math.min(b, 999000) / 1000}) km ${bandMin[k].toFixed(0)}`).join('; ')}`);
    }
  }
  setWorldSeed(0);
});
