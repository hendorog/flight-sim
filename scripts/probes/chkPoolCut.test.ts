// Checker probe (design-V chk-one-network): each break-of-slope fall (cause not 'fault') - how deep its pool and the reach
// just below the lip sit under the shaped ground (naturalHeight, before the network's carve), and the drawn ground
// (terrainHeight) beside the pool, i.e. whether the pool lies in a slot cut into the wall.
// (Round V step 0: ported unchanged from design-V/chk-one-network/tools).
import { it } from 'vitest';
import { hydrology, terrainHeight, naturalHeight } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
type Line = { north: Float64Array; east: Float64Array; s: Float64Array; level: Float64Array; halfWidth: Float64Array; kind?: number };
type Fall = { line: number; index: number; north: number; east: number; top: number; height: number; cause: string; dirN: number; dirE: number };
it('pool cut', () => {
  for (const seed of (env.CP_SEEDS ?? '1,42,777777').split(',').map(Number)) {
    setWorldSeed(seed);
    terrainHeight(0, 0);
    const L = (hydrology.rivers ?? []) as unknown as Line[];
    const falls = ((hydrology.falls ?? []) as unknown as Fall[]).filter((f) => f.cause !== 'fault');
    const rows: string[] = [];
    const cuts: number[] = [];
    for (const f of falls) {
      const r = L[f.line];
      const i = f.index;
      let k = i + 1;
      while (k + 1 < r.level.length && Math.abs(r.level[k + 1] - r.level[i + 1]) < 0.3) k++;
      const m = Math.round((i + 1 + k) / 2);
      const pn = r.north[m], pe = r.east[m], lv = r.level[m];
      const cutNat = naturalHeight(pn, pe) - lv;
      // drawn ground beside the pool, perpendicular to the fall's direction, at hw + 25 m and hw + 60 m either side
      const hw = r.halfWidth[m];
      const side = (d: number): number => Math.max(terrainHeight(pn + -f.dirE * d, pe + f.dirN * d), terrainHeight(pn - -f.dirE * d, pe - f.dirN * d)) - lv;
      const s25 = Math.min(terrainHeight(pn + -f.dirE * (hw + 25), pe + f.dirN * (hw + 25)), terrainHeight(pn - -f.dirE * (hw + 25), pe - f.dirN * (hw + 25))) - lv;
      const s60 = side(hw + 60);
      cuts.push(cutNat);
      rows.push(`  ${f.cause} line ${f.line} kind ${r.kind} lip ${f.north.toFixed(0)},${f.east.toFixed(0)} drop ${f.height.toFixed(0)} pool ${(r.s[k] - r.s[i + 1]).toFixed(0)} m: pool water under shaped ground ${cutNat.toFixed(0)} m; lower bank at hw+25 m ${s25.toFixed(0)} m over it; higher at hw+60 m ${s60.toFixed(0)} m`);
    }
    cuts.sort((a, b) => a - b);
    const q = (p: number): string => (cuts.length ? cuts[Math.min(cuts.length - 1, Math.floor(p * cuts.length))].toFixed(0) : '-');
    console.log(`seed ${seed}: ${falls.length} break-of-slope falls; pool water under the shaped ground p50 ${q(0.5)} m, p90 ${q(0.9)} m, max ${q(1)} m; > 20 m: ${cuts.filter((c) => c > 20).length}`);
    for (const x of rows.slice(0, Number(env.CP_TOP ?? 12))) console.log(x);
  }
  setWorldSeed(0);
});
