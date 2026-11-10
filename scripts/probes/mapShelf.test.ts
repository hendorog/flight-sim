// Probe (design-V map 2, read-only): what is the floor beside a shelf river? For each lattice river's axis point (about
// every 240 m) the lowest natural ground (the drawn ground before the network carves it) 100-700 m either side across
// the axis; where the river's level stands > 30 m over it, is that low on the model's own course (the lattice cells
// smoothed, as erosion.ts carves them: the wander's gap) or somewhere else (a floor finer than the 1 km model)? And is
// the low lower in the coarse ground (the model, its carve and the 250 m slopes, no noise detail) or in the detail?
// And does a traced stream run in it? MS_SEEDS (default 1,42,777777).
// (Round V step 0: ported unchanged from design-V/map/rules-probe (map 2; mapShelf3.log is its final run)).
import { it } from 'vitest';
import { naturalHeight, seededDrainage, hydrology, debugMacro, makeSample, sampleTerrain } from '../../src/world/terrain/heightfield';
import { levelProbe } from '../../src/world/terrain/riverNetwork';
import { cellNorth, cellEast } from '../../src/world/terrain/drainage';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;

function smoothCourse(n: number[], e: number[]): void {
  for (let pass = 0; pass < 3; pass++) {
    const n2 = n.slice(), e2 = e.slice();
    for (let i = 1; i < n.length - 1; i++) {
      n2[i] = 0.25 * n[i - 1] + 0.5 * n[i] + 0.25 * n[i + 1];
      e2[i] = 0.25 * e[i - 1] + 0.5 * e[i] + 0.25 * e[i + 1];
    }
    n.splice(0, n.length, ...n2);
    e.splice(0, e.length, ...e2);
  }
}
function distTo(pn: number[], pe: number[], qn: number, qe: number): number {
  let best = Infinity;
  for (let i = 0; i + 1 < pn.length; i++) {
    const dn = pn[i + 1] - pn[i], de = pe[i + 1] - pe[i];
    const L2 = dn * dn + de * de || 1;
    const u = Math.min(1, Math.max(0, ((qn - pn[i]) * dn + (qe - pe[i]) * de) / L2));
    best = Math.min(best, Math.hypot(qn - pn[i] - u * dn, qe - pe[i] - u * de));
  }
  return best;
}

it('map shelf', () => {
  const seeds = (env.MS_SEEDS ?? '1,42,777777').split(',');
  const sm = makeSample();
  for (const seed of seeds) {
    const A = new Map<number, { n: Float64Array; e: Float64Array; s: Float64Array }>();
    const E = new Map<number, Float64Array>();
    levelProbe.on = (ph, li, L) => {
      if (ph === 'A') A.set(li, { n: Float64Array.from(L.north), e: Float64Array.from(L.east), s: Float64Array.from(L.s) });
      if (ph === 'E') E.set(li, Float64Array.from(L.level));
    };
    setWorldSeed(seed);
    levelProbe.on = undefined;
    const d = seededDrainage!;
    const un: Array<{ n: number[]; e: number[] }> = [];
    for (let li = 0; li < d.lines.length; li++) {
      const L = d.lines[li];
      const n = L.cells.map((c) => cellNorth(d, c));
      const e = L.cells.map((c) => cellEast(d, c));
      smoothCourse(n, e);
      if (L.joins >= 0) {
        n[n.length - 1] = un[L.joins].n[L.joinAt];
        e[e.length - 1] = un[L.joins].e[L.joinAt];
      }
      un.push({ n, e });
    }
    // Traced streams (kind 1) on a 250 m grid, for "a stream runs in the low".
    const rv = hydrology.rivers!;
    const grid = new Map<number, Array<[number, number, number]>>();
    const key = (n: number, e: number): number => (Math.floor(n / 250) + 4096) * 8192 + Math.floor(e / 250) + 4096;
    for (let li = 0; li < rv.length; li++) {
      const r = rv[li];
      if (r.kind !== 1) continue;
      for (let i = 0; i < r.north.length; i += 2) {
        const k = key(r.north[i], r.east[i]);
        let l = grid.get(k);
        if (!l) grid.set(k, (l = []));
        l.push([r.north[i], r.east[i], li]);
      }
    }
    const streamNear = (n: number, e: number, R: number): boolean => {
      for (let a = -1; a <= 1; a++)
        for (let b = -1; b <= 1; b++) {
          const l = grid.get(key(n + a * 250, e + b * 250));
          if (l) for (const [pn, pe] of l) if (Math.hypot(pn - n, pe - e) < R) return true;
        }
      return false;
    };
    let total = 0, shelf30 = 0, lowOnModel = 0, axisOff = 0, coarseMost = 0, slopesAtLow = 0, streamInLow = 0, drawnStill = 0, lowOnOther = 0, rawMost = 0, wLow = 0, wAxis = 0, fAxis = 0, fLowNotAxis = 0, cLow = 0, bigKm = 0, bigOff = 0;
    const allUn = un;
    const offs: number[] = [];
    for (const [li, a] of A) {
      const lv = E.get(li);
      if (!lv) continue;
      const c = un[li];
      for (let i = 1; i < a.n.length - 1; i += 2) {
        const ds = (a.s[Math.min(a.s.length - 1, i + 2)] - a.s[i]) / 1000;
        total += ds;
        {
          const ci = Math.round((a.n[i] - d.origin) / 1000), cj = Math.round((a.e[i] - d.origin) / 1000);
          const cc = ci * d.n + cj;
          if (d.area[cc] >= 60) {
            bigKm += ds;
            if (debugMacro(a.n[i], a.e[i])!.s.f < 0.5) bigOff += ds;
          }
        }
        const tn = a.n[i + 1] - a.n[i - 1], te = a.e[i + 1] - a.e[i - 1];
        const tl = Math.hypot(tn, te) || 1;
        const un_ = -te / tl, ue = tn / tl;
        // Walk out each side (100-700 m) until the natural ground stands 10 m over the level (a bank holds it), as
        // wallsGate's valley walk: the lowest ground before that.
        let low = Infinity, lo = 0;
        for (const sg of [-1, 1]) {
          for (let o = 100; o <= 700; o += 50) {
            const g = naturalHeight(a.n[i] + sg * o * un_, a.e[i] + sg * o * ue);
            if (g < low) (low = g), (lo = sg * o);
            if (g > lv[i] + 10) break;
          }
        }
        if (!(lv[i] - low > 30) || low < 0.5) continue;
        shelf30 += ds;
        const ln = a.n[i] + lo * un_, le = a.e[i] + lo * ue;
        offs.push(Math.abs(lo));
        const dLowModel = distTo(c.n, c.e, ln, le);
        const dAxisModel = distTo(c.n, c.e, a.n[i], a.e[i]);
        if (dLowModel < 200) lowOnModel += ds;
        if (dAxisModel > 200) axisOff += ds;
        const mA = debugMacro(a.n[i], a.e[i])!, mL = debugMacro(ln, le)!;
        const dG = mA.ground - mL.ground, dC = mA.coarse - mL.coarse;
        if (dG > 0 && dC > 0.5 * dG) coarseMost += ds;
        if (mL.s.m > 0.5) slopesAtLow += ds;
        const dR = mA.coarseRaw - mL.coarseRaw;
        if (dG > 0 && dR > 0.5 * dG) rawMost += ds;
        if (mL.s.w > 0.5) wLow += ds;
        if (mA.s.w > 0.5) wAxis += ds;
        if (mA.s.f > 0.5) fAxis += ds;
        if (mL.s.f > 0.5 && mA.s.f < 0.5) fLowNotAxis += ds;
        if (mL.s.c < mA.s.c - 5) cLow += ds;
        if (dLowModel >= 200) {
          let other = false;
          for (let lj = 0; lj < allUn.length && !other; lj++) {
            if (lj === li) continue;
            const u = allUn[lj];
            let near = false;
            for (let k = 0; k < u.n.length && !near; k++) if (Math.abs(u.n[k] - ln) < 1500 && Math.abs(u.e[k] - le) < 1500) near = true;
            if (near && distTo(u.n, u.e, ln, le) < 200) other = true;
          }
          if (other) lowOnOther += ds;
        }
        if (streamNear(ln, le, 150)) streamInLow += ds;
        sampleTerrain(ln, le, sm);
        if (lv[i] - Math.max(sm.ground, sm.standing, sm.river) > 30) drawnStill += ds;
      }
    }
    offs.sort((x, y) => x - y);
    const f = (x: number): string => x.toFixed(1);
    const pc = (x: number): string => `${f(x)} km (${f((100 * x) / Math.max(1e-9, shelf30))} %)`;
    console.log(`seed ${seed}: river axis ${f(total)} km; level > 30 m over the lowest natural ground 100-700 m across, walking out until a bank 10 m over the level holds it: ${f(shelf30)} km`);
    console.log(`  of it: the low within 200 m of the model's own course ${pc(lowOnModel)}; the axis > 200 m off the model's course ${pc(axisOff)}`);
    console.log(`  the low lower mostly in the coarse ground (model + carve + 250 m slopes, no noise detail) ${pc(coarseMost)}; the low on the slopes' ground (m > 0.5) ${pc(slopesAtLow)}`);
    console.log(`  the low on ANOTHER lattice river's model course ${pc(lowOnOther)}; the drop mostly already in the raw noise ground (no model) ${pc(rawMost)}; model's finer relief given way (w > 0.5) at the low ${pc(wLow)}, at the axis ${pc(wAxis)}; the axis on the model's valley floor (f > 0.5) ${pc(fAxis)}`);
    console.log(`  the low on the model's own valley floor (f > 0.5) while the axis is off it (f < 0.5) ${pc(fLowNotAxis)}; the low carved deeper by the model (c at least 5 m lower than at the axis) ${pc(cLow)}`);
    console.log(`  all river axis where the lattice catchment is >= 60 km2 (the model's floor at full strength): ${f(bigKm)} km, of it off the model's floor (f < 0.5) ${f(bigOff)} km (${f((100 * bigOff) / Math.max(1e-9, bigKm))} %)`);
    console.log(`  a traced stream within 150 m of the low ${pc(streamInLow)}; the low still > 30 m under the level on the drawn surface ${pc(drawnStill)}`);
    console.log(`  offset of the low from the axis p25/p50/p75: ${offs[Math.floor(0.25 * offs.length)] ?? '-'} / ${offs[Math.floor(0.5 * offs.length)] ?? '-'} / ${offs[Math.floor(0.75 * offs.length)] ?? '-'} m`);
  }
  setWorldSeed(0);
});
