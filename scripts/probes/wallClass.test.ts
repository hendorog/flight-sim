// Probe (verifier, with the walls' line classes): water walls over the whole world, independent of the lake list (pools included).
//   SEED=42 npx vitest run --config scripts/probes/vitest.config.ts waterWalls --silent=false --disable-console-intercept
// Adversarial whole-world scan (lake-agnostic): sampleTerrain on a STEP grid over +-HALF, streamed row by row.
//  - lake walls: a wet point (standing > ground, standing > 0.5) whose 4-neighbour's top surface
//    (max of ground, river, its own standing water) is more than 2 m below the water level;
//  - river walls: a point in a river channel whose 4-neighbour outside any channel and dry lies > 2 m below the river;
//  - straight shoreline runs: axis-aligned wet/dry boundaries running straight for >= 600 m / 1 km, and how many
//    of them sit within 60 m of a 1 km lattice line.
// SEED, HALF (m, default 150000), STEP (m, default 50).
import { it } from 'vitest';
import { hydrology, makeSample, sampleTerrain } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
it('scan', async () => {
  const seed = Number(process.env.SEED ?? 42);
  const HALF = Number(process.env.HALF ?? 150000);
  const STEP = Number(process.env.STEP ?? 50);
  if (process.env.OLD_WIDTH) (globalThis as { __oldWidth?: boolean }).__oldWidth = true;
  if (process.env.NO_RAISE) (globalThis as { __noRaise?: boolean }).__noRaise = true;
  setWorldSeed(seed);
  const s = makeSample();
  const n = Math.round((2 * HALF) / STEP) + 1;
  const mk = () => ({ g: new Float32Array(n), w: new Float32Array(n), r: new Float32Array(n) });
  let prev = mk(), cur = mk();
  const fillRow = (row: ReturnType<typeof mk>, y: number) => {
    const north = HALF - y * STEP;
    for (let x = 0; x < n; x++) {
      sampleTerrain(north, -HALF + x * STEP, s);
      row.g[x] = s.ground;
      row.w[x] = s.standing > s.ground + 0.05 && s.standing > 0.5 ? s.standing : -Infinity;
      row.r[x] = s.river;
    }
  };
  let shoreEdges = 0, wall2 = 0, wall10 = 0, wall50 = 0, worst = 0, worstAt = '';
  const rpts: string[] = [];
  let rEdges = 0, rwall2 = 0, rwall10 = 0, rworst = 0, rworstAt = '';
  const walls: Array<[number, string]> = [];
  const runsH: number[] = [];
  const runsV: number[] = [];
  let latH = 0, latV = 0;
  const colRun = new Int32Array(n); // vertical boundary run between x and x+1
  const colLat = new Int32Array(n);
  const near = (v: number) => { const m = ((v % 1000) + 1000) % 1000; return Math.min(m, 1000 - m) < 60; };
  const top = (row: ReturnType<typeof mk>, x: number) => Math.max(row.g[x], row.r[x], row.w[x]);
  const check = (L: number, row: ReturnType<typeof mk>, x: number, at: string) => {
    shoreEdges++;
    const h = L - top(row, x);
    if (h > 2) { wall2++; walls.push([h, at]); }
    if (h > 10) wall10++;
    if (h > 50) wall50++;
    if (h > worst) { worst = h; worstAt = at; }
  };
  const rcheck = (R: number, row: ReturnType<typeof mk>, x: number, at: string) => {
    if (row.r[x] > -Infinity || row.w[x] > -Infinity) return;
    rEdges++;
    const h = R - row.g[x];
    if (h > 2) rwall2++;
    if (h > 10) { rwall10++; rpts.push(at); }
    if (h > rworst) { rworst = h; rworstAt = at; }
  };
  for (let y = 0; y < n; y++) {
    fillRow(cur, y);
    const north = HALF - y * STEP;
    // horizontal-run boundary between prev row and cur row
    let run = 0;
    for (let x = 0; x <= n; x++) {
      const b = y > 0 && x < n && (prev.w[x] > -Infinity) !== (cur.w[x] > -Infinity);
      if (b) run++;
      else { if (run >= 12) { runsH.push(run * STEP); if (near(north + STEP / 2)) latH++; } run = 0; }
    }
    for (let x = 0; x < n; x++) {
      const east = -HALF + x * STEP;
      const at = `${north},${east}`;
      // within the row
      if (x + 1 < n) {
        const a = cur.w[x] > -Infinity, b = cur.w[x + 1] > -Infinity;
        if (a && (!b || cur.w[x + 1] < cur.w[x] - 2)) check(cur.w[x], cur, x + 1, at);
        if (b && (!a || cur.w[x] < cur.w[x + 1] - 2)) check(cur.w[x + 1], cur, x, at);
        if (cur.r[x] > -Infinity) rcheck(cur.r[x], cur, x + 1, at);
        if (cur.r[x + 1] > -Infinity) rcheck(cur.r[x + 1], cur, x, at);
        // vertical-run boundary between columns x, x+1
        if (a !== b) { colRun[x]++; } else { if (colRun[x] >= 12) { runsV.push(colRun[x] * STEP); if (near(east + STEP / 2)) latV++; } colRun[x] = 0; }
      }
      if (y > 0) {
        const a = prev.w[x] > -Infinity, b = cur.w[x] > -Infinity;
        if (a && (!b || cur.w[x] < prev.w[x] - 2)) check(prev.w[x], cur, x, at);
        if (b && (!a || prev.w[x] < cur.w[x] - 2)) check(cur.w[x], prev, x, at);
        if (prev.r[x] > -Infinity) rcheck(prev.r[x], cur, x, at);
        if (cur.r[x] > -Infinity) rcheck(cur.r[x], prev, x, at);
      }
    }
    [prev, cur] = [cur, prev];
  }
  for (let x = 0; x < n; x++) if (colRun[x] >= 12) runsV.push(colRun[x] * STEP);
  const runs = [...runsH, ...runsV].sort((a, b) => b - a);
  walls.sort((a, b) => b[0] - a[0]);
  console.log(`SCAN seed ${seed} +-${HALF / 1000} km at ${STEP} m: lake shore edges ${shoreEdges}; walls >2 m ${wall2} (${(100 * wall2 / Math.max(1, shoreEdges)).toFixed(2)} %), >10 m ${wall10}, >50 m ${wall50}; worst ${worst.toFixed(1)} m at ${worstAt}`);
  console.log(`  top walls: ${walls.slice(0, 12).map(([h, a]) => `${h.toFixed(0)}@${a}`).join(' ')}`);
  console.log(`  river bank edges ${rEdges}: river over dry neighbour >2 m ${rwall2} (${(100 * rwall2 / Math.max(1, rEdges)).toFixed(2)} %), >10 m ${rwall10}; worst ${rworst.toFixed(1)} m at ${rworstAt}`);
  console.log(`  straight axis-aligned shoreline runs >=600 m: ${runs.length} (>=1 km ${runs.filter((r) => r >= 1000).length}, >=2 km ${runs.filter((r) => r >= 2000).length}); longest ${runs.slice(0, 8).join(', ')} m; on a 1 km lattice line (+-60 m): E-W ${latH}/${runsH.length}, N-S ${latV}/${runsV.length}`);

  {
    // Which line each wall > 10 m belongs to (the wet point is the edge's own sample or its neighbour: the nearest line).
    const { gullyNet } = await import('../../src/world/terrain/gullies');
    const gn = gullyNet();
    const hit = { dist: Infinity, side: 0, line: -1, kind: 0, index: 0, s: 0, level: 0, halfWidth: 0, gradient: 0, steepness: 0, regime: 0, speed: 0, dirN: 0, dirE: 0 };
    const R = hydrology.rivers ?? [];
    const by: Record<string, number> = {};
    const lines = new Map<number, number>();
    for (const at of rpts) {
      const [n0, e0] = at.split(',').map(Number);
      hydrology.queryFlow!(n0, e0, hit as never);
      let k = 'none';
      if (hit.line >= 0) {
        const r = R[hit.line];
        if ((r.kind ?? 0) === 0) k = 'river';
        else {
          const q = gn ? Math.round((r.north[0] - gn.origin) / gn.cell) * gn.n + Math.round((r.east[0] - gn.origin) / gn.cell) : -1;
          k = gn && gn.dir[q] && (r.area?.[0] ?? 0) >= 9.9 ? 'chain' : (r.area?.[0] ?? 0) <= 6.01 ? 'lattice-stream' : 'other-stream';
        }
        lines.set(hit.line, (lines.get(hit.line) ?? 0) + 1);
      }
      by[k] = (by[k] ?? 0) + 1;
    }
    console.log(`  walls > 10 m by line class: ${JSON.stringify(by)}`);
    console.log(`  top lines: ${[...lines.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([l, c]) => `${l}(${R[l].kind},A0 ${R[l].area?.[0]?.toFixed(1)}):${c}`).join(' ')}`);
  }  setWorldSeed(0);
});
