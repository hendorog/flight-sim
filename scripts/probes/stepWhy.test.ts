// Foundation stage 4 steps: why each step over SW_MIN m between samples 25 m apart (stepScan's profiles) is there.
// For each: the drawn ground's jump, the natural ground's (naturalHeight: the model with the slopes, before the
// rivers' valleys are carved), and the valleys near both samples (line, distance, level, floodplain, reach and the
// nearest point's arc along the axis): a "switch" when one line's nearest axis point jumps along it between them.
//   SW_SEEDS=1,42,777777 SW_MIN=50 SW_EVERY=2000 npx vitest run --config scripts/probes/vitest.config.ts stepWhy
import { it } from 'vitest';
import { debugMacro, hydrology, makeSample, naturalHeight, sampleTerrain } from '../../src/world/terrain/heightfield';
import type { ChannelNear, ValleyNear } from '../../src/world/terrain/hydrology';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
const vals = (n: number, e: number): ValleyNear[] => {
  const out: ValleyNear[] = [];
  const k = hydrology.network ? hydrology.network.valleys(n, e, out) : 0;
  return out.slice(0, k).map((v) => ({ ...v }));
};
const chans = (n: number, e: number): string => {
  const out: ChannelNear[] = [];
  const k = hydrology.network ? hydrology.network.channels(n, e, out) : 0;
  return out.slice(0, k).filter((c) => c.dist < c.halfWidth + 300 || c.breach > 0).map((c) => `C${c.line}${c.kind ? 's' : 'r'} d${c.dist.toFixed(0)} w${c.halfWidth.toFixed(1)} lv${c.level.toFixed(0)}${c.breach > 0 ? ` br${c.breach.toFixed(0)}/${c.reach.toFixed(0)}` : ''}`).join('; ');
};
const pass = (n: number, e: number): string => {
  const d = debugMacro(n, e);
  return d ? `m${d.s.m.toFixed(2)} ch${d.s.ch.toFixed(2)}` : '-';
};
it('step why', () => {
  const every = Number(env.SW_EVERY ?? 2000);
  const min = Number(env.SW_MIN ?? 50);
  const list = Number(env.SW_LIST ?? 12);
  for (const seed of (env.SW_SEEDS ?? '1,42,777777').split(',')) {
    setWorldSeed(seed);
    const s = makeSample();
    const rows: string[] = [];
    let total = 0, inValley = 0, sw = 0, natural = 0, carveOnly = 0;
    for (let dir = 0; dir < 2; dir++) {
      for (let t = -150000; t <= 150000; t += every) {
        let prev = NaN;
        for (let r = -150000; r <= 150000; r += 25) {
          const north = dir === 0 ? t : r;
          const east = dir === 0 ? r : t;
          sampleTerrain(north, east, s);
          const g = s.ground;
          if (Number.isFinite(prev) && Math.abs(g - prev) > min) {
            total++;
            const pn = dir === 0 ? north : north - 25;
            const pe = dir === 0 ? east - 25 : east;
            const na = naturalHeight(pn, pe), nb = naturalHeight(north, east);
            const va = vals(pn, pe), vb = vals(north, east);
            if (va.length || vb.length) inValley++;
            let jump = 0, jl = 0, jI = 0;
            for (const a of va) {
              const b = vb.find((x) => x.line === a.line);
              if (!b) continue;
              const ds = Math.abs((b.s ?? 0) - (a.s ?? 0));
              if (ds > jump) { jump = ds; jl = Math.abs(b.level - a.level); jI = Math.abs(b.influence - a.influence); }
            }
            const lineSet = (x: ValleyNear[]) => x.map((v) => v.line).sort().join('/');
            const enter = lineSet(va) !== lineSet(vb);
            if (jump > 150) sw++;
            const nj = Math.abs(nb - na);
            if (nj > 0.6 * Math.abs(g - prev)) natural++;
            else if (!(va.length || vb.length)) carveOnly++;
            if (rows.length < 4000) rows.push(`${Math.abs(g - prev).toFixed(0)}\t${pn},${pe}->${north},${east}\tground ${prev.toFixed(0)}->${g.toFixed(0)}\tnatural ${na.toFixed(0)}->${nb.toFixed(0)}\tarcJump ${jump.toFixed(0)} dLevel ${jl.toFixed(1)} dI ${jI.toFixed(0)}${enter ? ' lines ' + lineSet(va) + '|' + lineSet(vb) : ''}\tvalleys ${va.map((v) => `L${v.line} d${v.dist.toFixed(0)} f${v.floodplain.toFixed(0)} I${v.influence.toFixed(0)} lv${v.level.toFixed(0)} s${(v.s ?? 0).toFixed(0)}`).join('; ')}\tchannels ${chans(pn, pe)} | ${chans(north, east)}\tpass ${pass(pn, pe)} -> ${pass(north, east)}`);
          }
          prev = g;
        }
      }
    }
    rows.sort((a, b) => Number(b.split('\t')[0]) - Number(a.split('\t')[0]));
    console.log(`seed ${seed}: steps over ${min} m ${total}; with a valley near ${inValley}; a line's nearest point jumps > 150 m along its axis ${sw}; natural ground jumps as much (> 0.6 of it) ${natural}; carve-made, no valley ${carveOnly}`);
    for (const r of rows.slice(0, list)) console.log('  ' + r);
    if (env.SW_ALL) for (const r of rows) console.log('ALL ' + seed + '\t' + r);
  }
  setWorldSeed(0);
});
