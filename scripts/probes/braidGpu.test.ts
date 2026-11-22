// Braids: the ribbon's threads as the GPU draws them against the ground's water (the CPU twin), per seed (BG_SEEDS).
// The ribbon is built as the game builds it (water.ts createRiverNetworkGeometries); at points every 1 m across every
// braided 1 km piece's middle every BG_EVERY km, the triangle under the point is found and its attributes interpolated
// as the GPU interpolates them (barycentric, in the plane), and the thread test is the shader's (braidAt on aBraidK, aBraidPh,
// aBraidU and the water's width, where aDepth < 0). The ground's water: sampleTerrain's river over its ground. Reports
// how many of the points either calls wet both call wet (thread points only: the main water's own ribbon columns are
// left out, as is other water).
import { it } from 'vitest';
import type * as THREE from 'three';
import { hydrology, makeSample, sampleTerrain, terrainHeight } from '../../src/world/terrain/heightfield';
import { braidAt } from '../../src/world/terrain/channelForm';
import { createRiverNetworkGeometries, setWaterFlow } from '../../src/world/terrain/water';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
type Line = { north: Float64Array; east: Float64Array; s: Float64Array; bedR: Float32Array; bedL: Float32Array; wetR: Float32Array; wetL: Float32Array; braidK?: Float32Array };
it('braid gpu twin', () => {
  const S = makeSample();
  const every = Number(env.BG_EVERY ?? 3) * 1000;
  const CELL = 40;
  for (const seed of (env.BG_SEEDS ?? '42').split(',').map(Number)) {
    setWorldSeed(seed);
    terrainHeight(0, 0);
    setWaterFlow(true);
    const small: unknown[] = [];
    const gs = createRiverNetworkGeometries(small as never) as THREE.BufferGeometry[];
    // The braided triangles, listed in CELL squares by their bounds.
    type Tri = { g: THREE.BufferGeometry; a: number; b: number; c: number };
    const grid = new Map<string, Tri[]>();
    for (const g of gs) {
      const br = g.getAttribute('aBraidK');
      if (!br) continue;
      const pos = g.getAttribute('position');
      const idx = g.index!;
      for (let k = 0; k < idx.count; k += 3) {
        const a = idx.getX(k);
        const b = idx.getX(k + 1);
        const c = idx.getX(k + 2);
        if (16 * br.getX(a) <= 1 && 16 * br.getX(b) <= 1 && 16 * br.getX(c) <= 1) continue;
        const xs = [pos.getX(a), pos.getX(b), pos.getX(c)];
        const zs = [pos.getZ(a), pos.getZ(b), pos.getZ(c)];
        for (let cx = Math.floor(Math.min(...xs) / CELL); cx <= Math.floor(Math.max(...xs) / CELL); cx++)
          for (let cz = Math.floor(Math.min(...zs) / CELL); cz <= Math.floor(Math.max(...zs) / CELL); cz++) {
            const key = `${cx},${cz}`;
            let l = grid.get(key);
            if (!l) grid.set(key, (l = []));
            l.push({ g, a, b, c });
          }
      }
    }
    const ribbonWet = (pn: number, pe: number): number => {
      const x = pe;
      const z = -pn;
      const l = grid.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`);
      if (!l) return -1;
      for (const t of l) {
        const pos = t.g.getAttribute('position');
        const x0 = pos.getX(t.a), z0 = pos.getZ(t.a), x1 = pos.getX(t.b), z1 = pos.getZ(t.b), x2 = pos.getX(t.c), z2 = pos.getZ(t.c);
        const det = (z1 - z2) * (x0 - x2) + (x2 - x1) * (z0 - z2);
        if (Math.abs(det) < 1e-9) continue;
        const l0 = ((z1 - z2) * (x - x2) + (x2 - x1) * (z - z2)) / det;
        const l1 = ((z2 - z0) * (x - x2) + (x0 - x2) * (z - z2)) / det;
        const l2 = 1 - l0 - l1;
        if (l0 < -1e-6 || l1 < -1e-6 || l2 < -1e-6) continue;
        const v = (name: string, comp: number): number => {
          const at = t.g.getAttribute(name);
          const get = (i: number): number => (comp === 0 ? at.getX(i) : comp === 1 ? at.getY(i) : comp === 2 ? at.getZ(i) : at.getW(i));
          return l0 * get(t.a) + l1 * get(t.b) + l2 * get(t.c);
        };
        if (v('aDepth', 0) >= 0) return 2;
        const K = 16 * v('aBraidK', 0);
        if (K <= 1) return 0;
        return braidAt(v('aBraidU', 0), v('aBraidU', 1), 4096 * v('aBraidK', 1), K, v('aBraidPh', 0), v('aBraidPh', 1), 2 * v('aRiverInfo', 2)) > 0 ? 1 : 0;
      }
      return -1;
    };
    const L = (hydrology.rivers ?? []) as unknown as Line[];
    let nPts = 0;
    let nRib = 0;
    let nCpu = 0;
    let nBoth = 0;
    let noTri = 0;
    for (const r of L) {
      const K = r.braidK;
      const m = r.s.length;
      if (!K || m < 3) continue;
      for (let s0 = 0; s0 + 1000 <= r.s[m - 1]; s0 += every) {
        let im = 0;
        while (im < m - 1 && r.s[im] < s0 + 500) im++;
        if (K[im] < 1.5) continue;
        const a = Math.max(0, im - 1);
        const b = Math.min(m - 1, im + 1);
        const tl = Math.hypot(r.north[b] - r.north[a], r.east[b] - r.east[a]) || 1;
        const rn = -(r.east[b] - r.east[a]) / tl;
        const re = (r.north[b] - r.north[a]) / tl;
        for (let o = -r.bedL[im]; o <= r.bedR[im]; o += 1) {
          const pn = r.north[im] + rn * o;
          const pe = r.east[im] + re * o;
          const rib = ribbonWet(pn, pe);
          if (rib < 0) {
            noTri++;
            continue;
          }
          if (rib === 2) continue;
          nPts++;
          sampleTerrain(pn, pe, S);
          const cpu = S.river > -Infinity && S.ground < S.river;
          if (rib === 1) nRib++;
          if (cpu) nCpu++;
          if (rib === 1 && cpu) nBoth++;
        }
      }
    }
    const either = nRib + nCpu - nBoth;
    console.log(`BG seed ${seed}: bar points ${nPts} (no ribbon ${noTri}); drawn wet ${nRib}, ground wet ${nCpu}, both ${nBoth}: they agree on ${(100 * nBoth / Math.max(1, either)).toFixed(1)} % of the wet points (drawn only ${nRib - nBoth}, ground only ${nCpu - nBoth})`);
  }
  setWorldSeed(0);
});
