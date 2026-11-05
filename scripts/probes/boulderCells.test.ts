// Probe: boulder fields and bare-rock reaches. Lists a seed's longest step-pool runs (and placid river reaches), the
// stones per cell around them and the cost of building the cells and of the tiles' flow attribute.
//   BOULDER_SEED=42 npx vitest run --config scripts/probes/vitest.config.ts boulderCells --silent=false --disable-console-intercept
import { it } from 'vitest';
import { hydrology, makeSample, sampleTerrain, terrainHeight } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
import { buildBoulderCell, BOULDER_STRIDE } from '../../src/world/terrain/vegetation/boulders';
import { buildTile } from '../../src/world/terrain/tileBuilder';
import type { FlowHit } from '../../src/world/terrain/hydrology';

const CELL = 256;

it('boulder cells', () => {
  const seed = Number(process.env.BOULDER_SEED ?? 42);
  setWorldSeed(seed);
  const rs = hydrology.rivers!;
  // Longest runs of a regime per line (kind filter), with centre, heading and ground.
  const runs = (kind: number, test: (reg: number, hw: number) => boolean, minHw = 0): Array<{ li: number; a: number; b: number; len: number }> => {
    const out: Array<{ li: number; a: number; b: number; len: number }> = [];
    rs.forEach((r, li) => {
      if ((r.kind ?? 0) !== kind) return;
      let a = -1;
      for (let i = 0; i <= r.north.length; i++) {
        const ok = i < r.north.length && test(r.regime![i], r.halfWidth[i]) && r.halfWidth[i] >= minHw;
        if (ok && a < 0) a = i;
        if (!ok && a >= 0) {
          out.push({ li, a, b: i - 1, len: r.s[i - 1] - r.s[a] });
          a = -1;
        }
      }
    });
    return out.sort((x, y) => y.len - x.len);
  };
  const describe = (tag: string, x: { li: number; a: number; b: number; len: number }): void => {
    const r = rs[x.li];
    const m = (x.a + x.b) >> 1;
    const dn = r.north[Math.min(x.b, m + 4)] - r.north[Math.max(x.a, m - 4)];
    const de = r.east[Math.min(x.b, m + 4)] - r.east[Math.max(x.a, m - 4)];
    const hdg = ((Math.atan2(de, dn) * 180) / Math.PI + 360) % 360;
    console.log(
      `${tag} line ${x.li} (${r.kind ? 'stream' : 'river'}, end ${r.end ?? '-'}) ${x.len.toFixed(0)} m: start ${r.north[x.a].toFixed(0)},${r.east[x.a].toFixed(0)} mid ${r.north[m].toFixed(0)},${r.east[m].toFixed(0)} end ${r.north[x.b].toFixed(0)},${r.east[x.b].toFixed(0)}; heading ${hdg.toFixed(0)}; hw ${r.halfWidth[m].toFixed(1)} m; level ${r.level[x.a].toFixed(0)} -> ${r.level[x.b].toFixed(0)} m; ground ${terrainHeight(r.north[m], r.east[m]).toFixed(0)} m`,
    );
  };
  const steep = runs(1, (g) => g >= 3);
  steep.slice(0, 6).forEach((x) => describe('step-pool', x));
  runs(0, (g) => g >= 3).slice(0, 3).forEach((x) => describe('river step-pool', x));
  runs(0, (g) => g === 0, 12).slice(0, 3).forEach((x) => describe('placid river', x));
  // Outlet streams of lakes: the first few streams whose head lies in a lake.
  let shown = 0;
  rs.forEach((r, li) => {
    if (r.kind !== 1 || shown >= 6) return;
    const lm = hydrology.lakeMask;
    if (!lm || lm.at(r.north[0], r.east[0]) === -Infinity) return;
    let reg3 = 0;
    for (let i = 0; i < r.north.length; i++) if ((r.regime?.[i] ?? 0) >= 3) reg3++;
    if (reg3 < 10) return;
    shown++;
    console.log(`outlet line ${li}: head ${r.north[0].toFixed(0)},${r.east[0].toFixed(0)} level ${r.level[0].toFixed(0)}; ${r.s[r.s.length - 1].toFixed(0)} m long, ${reg3} step-pool samples; end ${r.end}; 10th sample ${r.north[Math.min(10, r.north.length - 1)].toFixed(0)},${r.east[Math.min(10, r.north.length - 1)].toFixed(0)}`);
  });

  // Stones around the longest step-pool run: cells within 700 m of its middle.
  const best = steep[0];
  const r = rs[best.li];
  const m = (best.a + best.b) >> 1;
  const cn = r.north[m];
  const ce = r.east[m];
  let stones = 0;
  let cells = 0;
  let maxCell = 0;
  let water = 0;
  const radii: number[] = [];
  const t0 = performance.now();
  for (let cz = Math.floor((cn - 700) / CELL); cz <= Math.floor((cn + 700) / CELL); cz++)
    for (let cx = Math.floor((ce - 700) / CELL); cx <= Math.floor((ce + 700) / CELL); cx++) {
      const c = buildBoulderCell({ cx, cz, size: CELL });
      cells++;
      stones += c.count;
      maxCell = Math.max(maxCell, c.count);
      for (let k = 0; k < c.count; k++) {
        radii.push(c.boulders[k * BOULDER_STRIDE + 3]);
        if (c.boulders[k * BOULDER_STRIDE + 7] > 0.99) water++;
      }
    }
  const ms = performance.now() - t0;
  radii.sort((a, b) => a - b);
  const q = (p: number): string => (radii.length ? radii[Math.floor(p * (radii.length - 1))].toFixed(2) : '-');
  console.log(`cells within 700 m of the longest step-pool run: ${cells} cells, ${stones} stones (${water} in the water), most in a cell ${maxCell}; radius p10 ${q(0.1)} p50 ${q(0.5)} p90 ${q(0.9)} max ${q(1)} m; ${(ms / cells).toFixed(2)} ms per cell (first includes the index)`);

  // Whole-world totals over a sweep of cells near every step-pool run (density check).
  let total = 0;
  let km = 0;
  for (const x of steep.slice(0, 40)) km += x.len / 1000;
  const seen = new Set<string>();
  for (const x of steep.slice(0, 40)) {
    const rr = rs[x.li];
    for (let i = x.a; i <= x.b; i++) {
      const k = `${Math.floor(rr.east[i] / CELL)},${Math.floor(rr.north[i] / CELL)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const [a, b] = k.split(',').map(Number);
      total += buildBoulderCell({ cx: a, cz: b, size: CELL }).count;
    }
  }
  console.log(`40 longest step-pool runs: ${km.toFixed(1)} km, ${seen.size} cells, ${total} stones (incl. other lines in those cells): ${(total / (km * 1000)).toFixed(2)} per m of run`);

  // Flow attribute cost: queryFlow per call, and buildTile for level-0 tiles along the run.
  const hit = { dist: 0 } as FlowHit;
  const q0 = performance.now();
  let calls = 0;
  for (let j = 0; j < 200; j++)
    for (let i = 0; i < 50; i++) {
      hydrology.queryFlow!(cn - 100 + j, ce - 25 + i, hit);
      calls++;
    }
  const perCall = ((performance.now() - q0) / calls) * 1000;
  const tt0 = performance.now();
  let tiles = 0;
  for (let k = best.a; k <= best.b; k += 6) {
    buildTile({ level: 0, ix: Math.floor(r.east[k] / 128), iz: Math.floor(r.north[k] / 128), grid: 64, leafSize: 128 });
    tiles++;
  }
  const tileMs = (performance.now() - tt0) / tiles;
  const s = makeSample();
  sampleTerrain(cn, ce, s);
  console.log(`queryFlow ${perCall.toFixed(2)} us per call; level-0 tiles on the run ${tileMs.toFixed(1)} ms each (${tiles})`);
  setWorldSeed(0);
});

/**
 * Fixed-camera views along a channel (index.html camPos / camLook): from `back` m upstream of the sample nearest
 * arc length `s`, `side` m to its right and `above` m over the ground there, looking at the water `ahead` m downstream.
 *   VIEWS="42:417:2500,42:3:12000" npx vitest run --config scripts/probes/vitest.config.ts boulderCells -t views
 */
it('views', () => {
  const list = (process.env.VIEWS ?? '').split(',').filter(Boolean);
  for (const v of list) {
    const [seed, li, s, back = 250, side = 40, above = 160, ahead = 250] = v.split(':').map(Number);
    setWorldSeed(seed);
    const r = hydrology.rivers![li];
    const at = (ss: number): { n: number; e: number; level: number; dn: number; de: number } => {
      let i = 0;
      while (i < r.s.length - 2 && r.s[i + 1] < ss) i++;
      const t = Math.min(1, Math.max(0, (ss - r.s[i]) / (r.s[i + 1] - r.s[i] || 1)));
      const dn = r.north[i + 1] - r.north[i];
      const de = r.east[i + 1] - r.east[i];
      const l = Math.hypot(dn, de) || 1;
      return { n: r.north[i] + dn * t, e: r.east[i] + de * t, level: r.level[i] + (r.level[i + 1] - r.level[i]) * t, dn: dn / l, de: de / l };
    };
    const c = at(s - back);
    const cn = c.n - c.de * side;
    const ce = c.e + c.dn * side;
    let g = -Infinity;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) g = Math.max(g, terrainHeight(cn + 30 * a, ce + 30 * b));
    const l = at(s + ahead);
    console.log(`view ${v}: camPos=${cn.toFixed(0)},${ce.toFixed(0)},${(g + above).toFixed(0)}&camLook=${l.n.toFixed(0)},${l.e.toFixed(0)},${l.level.toFixed(0)}  (regime at s: ${r.regime?.[r.s.findIndex((x) => x >= s)]}, hw ${r.halfWidth[r.s.findIndex((x) => x >= s)].toFixed(1)})`);
  }
  setWorldSeed(0);
});
