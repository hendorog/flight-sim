// Probe: cameras on rivers' heads, looking up-valley from downstream (450 ft and 1500 ft over the ground): the river
// heads no line joins nearest home, plus HC_LINES. Prints shot-list lines. (The shots in out/h were placed on the heads
// as they stood before the feeders, streams.ts feedHeads: run it in a checkout of 1d0be57 for those.)
//   HC_SEED=42 HC_N=3 HC_LINES=308 npx vitest run --config scripts/probes/vitest.config.ts headCams --silent=false
import { it } from 'vitest';
import { hydrology, naturalHeight } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
import { AIRPORT } from '../../src/core/world';
it('head cams', () => {
  const seed = Number(process.env.HC_SEED ?? 42);
  setWorldSeed(seed);
  const L = hydrology.rivers!;
  const mask = hydrology.lakeMask!;
  const fed = new Uint8Array(L.length);
  L.forEach((q) => { if ((q.joins ?? -1) >= 0) fed[q.joins!] = 1; });
  const home = AIRPORT.runway.center;
  const pick: number[] = (process.env.HC_LINES ?? '').split(',').filter(Boolean).map(Number);
  const cand = L.map((r, li) => ({ r, li })).filter(({ r, li }) => r.kind === 0 && !fed[li] && !(mask.at(r.north[0], r.east[0]) > -Infinity))
    .map(({ r, li }) => ({ li, d: Math.hypot(r.north[0] - home.north, r.east[0] - home.east) })).sort((a, b) => a.d - b.d);
  for (const c of cand.slice(0, Number(process.env.HC_N ?? 3))) if (!pick.includes(c.li)) pick.push(c.li);
  const lines: string[] = [];
  for (const li of pick) {
    const r = L[li];
    const at = (sv: number) => { const i = Math.max(0, r.s.findIndex((s) => s >= sv)); return [r.north[i], r.east[i]]; };
    const [hn, he] = [r.north[0], r.east[0]];
    for (const [tag, sd, agl] of [['450', 1300, 137], ['1500', 2600, 457]] as Array<[string, number, number]>) {
      const [cn, ce] = at(sd);
      const dn = hn - cn, de = he - ce, dl = Math.hypot(dn, de) || 1;
      const ln = hn + (dn / dl) * 900, le = he + (de / dl) * 900;
      const cz = naturalHeight(cn, ce) + agl;
      const lz = naturalHeight(ln, le);
      lines.push(`h${seed}-${li}-${tag} seed=${seed}&camPos=${cn.toFixed(0)},${ce.toFixed(0)},${cz.toFixed(0)}&camLook=${ln.toFixed(0)},${le.toFixed(0)},${lz.toFixed(0)}`);
    }
    console.log(`line ${li}: head ${hn.toFixed(0)},${he.toFixed(0)} level ${r.level[0].toFixed(0)} ${(Math.hypot(hn - home.north, he - home.east) / 1000).toFixed(1)} km from home`);
  }
  console.log('SHOTS\n' + lines.join('\n'));
  setWorldSeed(0);
});
