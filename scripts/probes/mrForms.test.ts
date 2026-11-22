// design V (model-rivers): forms by reach state - km by regime and with pitches, rivers and streams; the falls by cause
// (edge falls listed with their lip, drop, line kind and catchment); the owner's valley boxes per line.
// Round V: the break-of-slope falls read are 'edge' (model-rivers), 'hanging' and 'outlet' (the base's FA2 / FA3).
//   MF_SEEDS=1,42,777777 MF_OUT=dir npx vitest run --config scripts/probes/vitest.config.ts mrForms --silent=false --disable-console-intercept
// (Round V step 0: ported unchanged from design-V/model-rivers/prototype.patch).
import { it } from 'vitest';
import { hydrology } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
import { writeFileSync, mkdirSync } from 'node:fs';
type L = { north: Float64Array; east: Float64Array; s: Float64Array; level: Float64Array; halfWidth: Float64Array; kind?: number; regime?: Uint8Array; pitchOn?: Float32Array; area?: Float64Array; joins?: number };
const BOXES: Record<string, [number, number, number, number]> = { wind: [-13500, -11500, -42500, -40500], head: [-14000, -12000, -43000, -40800] };
it('model-rivers forms', () => {
  const OUT = process.env.MF_OUT ?? 'out/mrForms';
  mkdirSync(OUT, { recursive: true });
  for (const seed of (process.env.MF_SEEDS ?? '42').split(',')) {
    setWorldSeed(seed);
    const rivers = (hydrology.rivers ?? []) as unknown as L[];
    const reg = [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0]];
    const pit = [0, 0];
    const box: Record<string, Map<number, { kind: number; km: number; reg: number[]; pitch: number; amin: number; amax: number; lvl: number[] }>> = { wind: new Map(), head: new Map() };
    rivers.forEach((r, li) => {
      const k = (r.kind ?? 0) === 0 ? 0 : 1;
      for (let i = 1; i < r.s.length; i++) {
        const ds = (r.s[i] - r.s[i - 1]) / 1000;
        const g = r.regime?.[i] ?? 0;
        reg[k][g] += ds;
        if ((r.pitchOn?.[i] ?? 0) > 0) pit[k] += ds;
        for (const b of Object.keys(BOXES)) {
          const [n0, n1, e0, e1] = BOXES[b];
          if (r.north[i] < n0 || r.north[i] > n1 || r.east[i] < e0 || r.east[i] > e1) continue;
          let o = box[b].get(li);
          if (!o) box[b].set(li, (o = { kind: r.kind ?? 0, km: 0, reg: [0, 0, 0, 0, 0], pitch: 0, amin: Infinity, amax: 0, lvl: [Infinity, -Infinity] }));
          o.km += ds;
          o.reg[g] += ds;
          if ((r.pitchOn?.[i] ?? 0) > 0) o.pitch += ds;
          const A = r.area?.[i] ?? 0;
          o.amin = Math.min(o.amin, A);
          o.amax = Math.max(o.amax, A);
          o.lvl[0] = Math.min(o.lvl[0], r.level[i]);
          o.lvl[1] = Math.max(o.lvl[1], r.level[i]);
        }
      }
    });
    const f = (a: number[]): string => `placid ${a[0].toFixed(0)} riffle ${a[1].toFixed(0)} rapids ${a[2].toFixed(0)} steppool ${a[3].toFixed(0)} fall ${a[4].toFixed(1)}`;
    console.log(`seed ${seed}: rivers km ${f(reg[0])}, with pitches ${pit[0].toFixed(0)}; streams km ${f(reg[1])}, with pitches ${pit[1].toFixed(0)}`);
    for (const b of Object.keys(BOXES)) {
      for (const [li, o] of box[b]) if (o.km > 0.2) console.log(`  box ${b} line ${li} kind ${o.kind} ${o.km.toFixed(2)} km A ${o.amin.toFixed(0)}-${o.amax.toFixed(0)} lvl ${o.lvl[0].toFixed(0)}-${o.lvl[1].toFixed(0)}: regime ${o.reg.map((x) => x.toFixed(2)).join('/')} pitches ${o.pitch.toFixed(2)} km`);
    }
    const falls = hydrology.falls ?? [];
    const by: Record<string, number> = {};
    const rows: string[] = ['cause,line,kind,area,north,east,top,bottom,height,width,dirN,dirE,flight'];
    for (const fl of falls) {
      by[fl.cause] = (by[fl.cause] ?? 0) + 1;
      const r = rivers[fl.line];
      rows.push(`${fl.cause},${fl.line},${r.kind ?? 0},${(r.area?.[fl.index] ?? 0).toFixed(1)},${fl.north.toFixed(0)},${fl.east.toFixed(0)},${fl.top.toFixed(1)},${fl.bottom.toFixed(1)},${fl.height.toFixed(1)},${fl.width.toFixed(1)},${fl.dirN.toFixed(3)},${fl.dirE.toFixed(3)},${fl.flight}`);
    }
    const edge = falls.filter((x) => x.cause === 'edge' || x.cause === 'hanging' || x.cause === 'outlet');
    const hs = edge.map((x) => x.height).sort((a, b) => a - b);
    console.log(`  falls ${JSON.stringify(by)}; edge/hanging heights p50 ${hs[hs.length >> 1]?.toFixed(1)} max ${hs[hs.length - 1]?.toFixed(1)}; on rivers ${edge.filter((x) => (rivers[x.line].kind ?? 0) === 0).length}`);
    console.log(`  shape report ${JSON.stringify(hydrology.streamReport?.shape)}`);
    writeFileSync(`${OUT}/falls-s${seed}.csv`, rows.join('\n') + '\n');
  }
  setWorldSeed(0);
});
