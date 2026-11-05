// Repair probe (the streams verifier's site checks): determinism across seed switches, falls over 12 m, water hanging over / buried
// under the ground, outlet endings, river heads with no feeder, and camera views for shots.
//   VS_SEEDS=42,777777,1 npx vitest run --config scripts/probes/vitest.config.ts verifyS --silent=false --disable-console-intercept
import { it } from 'vitest';
import { hydrology, makeSample, sampleTerrain, terrainHeight, snowLine } from '../../src/world/terrain/heightfield';
import type { RiverLine } from '../../src/world/terrain/hydrology';
import { setWorldSeed } from '../../src/world/worldSeed';
import { buildBoulderCell, BOULDER_STRIDE } from '../../src/world/terrain/vegetation/boulders';

const groundTop = (n: number, e: number): number => {
  let g = -Infinity;
  for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) g = Math.max(g, terrainHeight(n + 30 * a, e + 30 * b));
  return g;
};
const at = (r: RiverLine, s: number) => {
  let i = 0;
  while (i < r.s.length - 2 && r.s[i + 1] < s) i++;
  const t = Math.min(1, Math.max(0, (s - r.s[i]) / (r.s[i + 1] - r.s[i] || 1)));
  const dn = r.north[i + 1] - r.north[i];
  const de = r.east[i + 1] - r.east[i];
  const l = Math.hypot(dn, de) || 1;
  return { n: r.north[i] + dn * t, e: r.east[i] + de * t, level: r.level[i] + (r.level[i + 1] - r.level[i]) * t, hw: r.halfWidth[i], dn: dn / l, de: de / l, i };
};
const view = (label: string, cn: number, ce: number, above: number, ln: number, le: number, lalt: number, note: string): void => {
  const alt = groundTop(cn, ce) + above;
  console.log(`${label}: camPos=${cn.toFixed(0)},${ce.toFixed(0)},${alt.toFixed(0)}&camLook=${ln.toFixed(0)},${le.toFixed(0)},${lalt.toFixed(0)}  (${note}; AGL ${(alt - terrainHeight(cn, ce)).toFixed(0)} m)`);
};
// Side view of line r around arc s: camera `back` m upstream, `side` m to the right, `above` m AGL, looking `ahead` m downstream.
const along = (label: string, r: RiverLine, s: number, back: number, side: number, above: number, ahead: number, note: string) => {
  const c = at(r, Math.max(0, s - back));
  const l = at(r, s + ahead);
  view(label, c.n - c.de * side, c.e + c.dn * side, above, l.n, l.e, l.level, note);
};

function hashWorld(): string {
  let h = 2166136261;
  const mix = (x: number) => {
    const f = new Float64Array([x]);
    const u = new Uint32Array(f.buffer);
    h = Math.imul(h ^ u[0], 16777619);
    h = Math.imul(h ^ u[1], 16777619);
  };
  for (const r of hydrology.rivers ?? []) {
    for (let i = 0; i < r.north.length; i++) { mix(r.north[i]); mix(r.east[i]); mix(r.level[i]); mix(r.halfWidth[i]); mix(r.regime?.[i] ?? -1); }
  }
  for (const f of hydrology.falls ?? []) { mix(f.north); mix(f.east); mix(f.top); mix(f.bottom); }
  if (hydrology.queryFlow && hydrology.rivers?.length) {
    const r = hydrology.rivers[Math.min(126, hydrology.rivers.length - 1)];
    const k = r.north.length >> 1;
    const c = buildBoulderCell({ cx: Math.floor(r.east[k] / 256), cz: Math.floor(r.north[k] / 256), size: 256 });
    mix(c.count);
    for (let i = 0; i < c.count * BOULDER_STRIDE; i++) mix(c.boulders[i]);
  }
  const s = makeSample();
  for (let i = 0; i < 64; i++) { sampleTerrain(-50000 + i * 1700, 30000 - i * 900, s); mix(s.ground); mix(s.river); }
  return (h >>> 0).toString(16);
}

it('determinism across seed switches', () => {
  const seq = [42, 777777, 1, 42, 0, 42, 1];
  const got: string[] = [];
  for (const sd of seq) { setWorldSeed(sd); got.push(`${sd}:${hashWorld()}`); }
  console.log('DETERMINISM', got.join(' '));
  setWorldSeed(0);
});

it('verify sites', () => {
  for (const seed of (process.env.VS_SEEDS ?? '42').split(',').map(Number)) {
    setWorldSeed(seed);
    const rs = hydrology.rivers!;
    const falls = hydrology.falls!;
    const lm = hydrology.lakeMask!;
    const s = makeSample();
    console.log(`\n===== seed ${seed}: ${rs.length} lines, ${falls.length} falls`);

    // Falls over 12 m.
    const tall = falls.map((f, k) => ({ f, k, d: f.top - f.bottom })).filter((x) => x.d > 12.5).sort((a, b) => b.d - a.d);
    console.log(`falls > 12.5 m: ${tall.length}`);
    for (const { f, k, d } of tall.slice(0, 8)) {
      const r = rs[f.line];
      console.log(`  fall ${k} line ${f.line} kind ${r.kind} drop ${d.toFixed(1)} m width ${f.width.toFixed(1)} at ${(f.north / 1000).toFixed(2)},${(f.east / 1000).toFixed(2)} km lip idx ${f.index}/${r.north.length} joins ${r.joins}`);
      view(`    view500`, f.north + f.dirN * 430 - f.dirE * 250, f.east + f.dirE * 430 + f.dirN * 250, 150, f.north, f.east, (f.top + f.bottom) / 2, 'tall fall from ~500 m');
    }

    // Hanging / buried water on every line (outside lakes and sea), skipping 20 m around fall lips.
    const lipNear = new Set<string>();
    for (const f of falls) for (let d = -1; d <= 1; d++) lipNear.add(`${f.line}:${f.index + d}`);
    type Bad = { li: number; i: number; v: number; n: number; e: number };
    const hang: Bad[] = [];
    const bury: Bad[] = [];
    let pts = 0, hang2 = 0, hang5 = 0, bury1 = 0, bury3 = 0;
    const kindPts = [0, 0], kindHang = [0, 0], kindBury = [0, 0];
    rs.forEach((r, li) => {
      for (let i = 1; i < r.north.length - 1; i++) {
        if (lipNear.has(`${li}:${i}`)) continue;
        const n = r.north[i], e = r.east[i];
        if (lm.at(n, e) > -Infinity) continue;
        sampleTerrain(n, e, s);
        if (s.standing > r.level[i] - 0.5) continue; // lake or sea
        if (r.level[i] < 0.5) continue;
        pts++; kindPts[r.kind ?? 0]++;
        const dn = r.north[i + 1] - r.north[i - 1], de = r.east[i + 1] - r.east[i - 1];
        const l = Math.hypot(dn, de) || 1;
        const pn = -de / l, pe = dn / l;
        const off = 1.2 * r.halfWidth[i] + 1;
        let worst = 0;
        for (const sg of [-1, 1]) {
          sampleTerrain(n + pn * off * sg, e + pe * off * sg, s);
          if (s.standing > r.level[i] - 0.5) continue;
          worst = Math.max(worst, r.level[i] - s.ground);
        }
        if (worst > 2) { hang2++; kindHang[r.kind ?? 0]++; }
        if (worst > 5) { hang5++; hang.push({ li, i, v: worst, n, e }); }
        sampleTerrain(n, e, s);
        const b = s.ground - r.level[i];
        if (b > 1) { bury1++; kindBury[r.kind ?? 0]++; }
        if (b > 3) { bury3++; bury.push({ li, i, v: b, n, e }); }
      }
    });
    console.log(`water edge points ${pts}: ribbon edge >2 m over ground ${(100 * hang2 / pts).toFixed(2)} % (rivers ${(100 * kindHang[0] / kindPts[0]).toFixed(2)} %, streams ${(100 * kindHang[1] / kindPts[1]).toFixed(2)} %), >5 m ${(100 * hang5 / pts).toFixed(2)} %; centre ground >1 m over water ${(100 * bury1 / pts).toFixed(2)} % (rivers ${(100 * kindBury[0] / kindPts[0]).toFixed(2)}, streams ${(100 * kindBury[1] / kindPts[1]).toFixed(2)}), >3 m ${(100 * bury3 / pts).toFixed(2)} %`);
    hang.sort((a, b) => b.v - a.v);
    bury.sort((a, b) => b.v - a.v);
    // De-duplicate within 500 m.
    const top = (arr: Bad[], k: number) => {
      const out: Bad[] = [];
      for (const x of arr) { if (out.every((y) => Math.hypot(y.n - x.n, y.e - x.e) > 500)) out.push(x); if (out.length >= k) break; }
      return out;
    };
    for (const x of top(hang, 5)) {
      const r = rs[x.li];
      console.log(`  HANG ${x.v.toFixed(1)} m line ${x.li} kind ${r.kind} hw ${r.halfWidth[x.i].toFixed(1)} regime ${r.regime?.[x.i]} at ${(x.n / 1000).toFixed(2)},${(x.e / 1000).toFixed(2)} km level ${r.level[x.i].toFixed(0)}`);
      along('    view', r, r.s[x.i], 300, 120, 80, 0, 'hang site');
    }
    for (const x of top(bury, 4)) {
      const r = rs[x.li];
      console.log(`  BURY ${x.v.toFixed(1)} m line ${x.li} kind ${r.kind} hw ${r.halfWidth[x.i].toFixed(1)} at ${(x.n / 1000).toFixed(2)},${(x.e / 1000).toFixed(2)} km level ${r.level[x.i].toFixed(0)}`);
      along('    view', r, r.s[x.i], 300, 120, 80, 0, 'bury site');
    }

    // Outlets: endings; a median outlet and a sink outlet, by lake altitude rank.
    const outs = rs.map((r, li) => ({ r, li })).filter(({ r }) => r.kind === 1 && lm.at(r.north[0], r.east[0]) > -Infinity);
    const ends: Record<string, number> = {};
    for (const { r } of outs) ends[r.end ?? '?'] = (ends[r.end ?? '?'] ?? 0) + 1;
    console.log(`outlet streams ${outs.length}: endings ${JSON.stringify(ends)}`);
    const mtn = outs.filter(({ r }) => r.level[0] > 700).sort((a, b) => a.r.level[0] - b.r.level[0]);
    const mtnEnds: Record<string, number> = {};
    for (const { r } of mtn) mtnEnds[r.end ?? '?'] = (mtnEnds[r.end ?? '?'] ?? 0) + 1;
    console.log(`mountain (lake > 700 m) outlets ${mtn.length}: endings ${JSON.stringify(mtnEnds)}`);
    const show = (tag: string, r: RiverLine, li: number) => {
      const len = r.s[r.s.length - 1];
      const nf = falls.filter((f) => f.line === li).length;
      const lastLevel = r.level[r.level.length - 1];
      sampleTerrain(r.north[r.north.length - 1], r.east[r.east.length - 1], s);
      console.log(`  ${tag} line ${li}: lake ${r.level[0].toFixed(0)} m at ${(r.north[0] / 1000).toFixed(2)},${(r.east[0] / 1000).toFixed(2)} km, ${(len / 1000).toFixed(1)} km, end ${r.end} at ${(r.north[r.north.length - 1] / 1000).toFixed(2)},${(r.east[r.east.length - 1] / 1000).toFixed(2)} level ${lastLevel.toFixed(0)} (ground ${s.ground.toFixed(0)}), joins ${r.joins}, ${nf} falls, hw ${r.halfWidth[0].toFixed(1)} -> ${r.halfWidth[r.halfWidth.length - 1].toFixed(1)}`);
      const d = at(r, 200);
      view(`    view outlet 150AGL`, r.north[0] - d.dn * 400 + d.de * 150, r.east[0] - d.de * 400 - d.dn * 150, 150, at(r, Math.min(len, 900)).n, at(r, Math.min(len, 900)).e, at(r, Math.min(len, 900)).level, 'over the lake shore looking down the outlet');
      along(`    view end 120AGL`, r, len, 500, 150, 120, 0, 'looking at the end');
      view(`    view 1500ft`, r.north[0] - d.dn * 1200, r.east[0] - d.de * 1200, 457, at(r, Math.min(len, 2500)).n, at(r, Math.min(len, 2500)).e, at(r, Math.min(len, 2500)).level, '1500 ft');
    };
    const sinks = mtn.filter(({ r }) => r.end === 'sink');
    const chans = mtn.filter(({ r }) => r.end === 'channel');
    if (chans.length) { const m = chans[chans.length >> 1]; show('MEDIAN channel outlet', m.r, m.li); }
    if (sinks.length) { const m = sinks[sinks.length >> 1]; show('MEDIAN sink outlet', m.r, m.li); }
    if (sinks.length > 1) { const m = sinks[sinks.length - 1]; show('HIGHEST sink outlet', m.r, m.li); }

    // Headwater stream starts (kind 1, head not in a lake): one median.
    const heads = rs.map((r, li) => ({ r, li })).filter(({ r }) => r.kind === 1 && lm.at(r.north[0], r.east[0]) === -Infinity && r.level[0] > 500);
    if (heads.length) {
      const h = heads[heads.length >> 1];
      console.log(`  HEADWATER line ${h.li}: head ${(h.r.north[0] / 1000).toFixed(2)},${(h.r.east[0] / 1000).toFixed(2)} level ${h.r.level[0].toFixed(0)} hw ${h.r.halfWidth[0].toFixed(1)} -> ${at(h.r, 2000).hw.toFixed(1)} at 2 km, end ${h.r.end}`);
      along('    view head', h.r, 300, 400, 100, 100, 600, 'headwater start');
    }

    // River heads (kind 0) not in a lake: is a stream joining within 150 m of the head?
    let rh = 0, rhFed = 0;
    const unfed: Array<{ li: number; hw: number }> = [];
    rs.forEach((r, li) => {
      if (r.kind === 1) return;
      if (lm.at(r.north[0], r.east[0]) > -Infinity) return;
      rh++;
      const fed = rs.some((q) => q.kind === 1 && q.joins === li && Math.hypot(q.north[q.north.length - 1] - r.north[0], q.east[q.east.length - 1] - r.east[0]) < 300);
      if (fed) rhFed++;
      else unfed.push({ li, hw: r.halfWidth[0] });
    });
    unfed.sort((a, b) => b.hw - a.hw);
    console.log(`river heads not in a lake: ${rh}, with a stream ending within 300 m: ${rhFed}; unfed widest start hw: ${unfed.slice(0, 5).map((u) => `${u.li}:${u.hw.toFixed(1)}`).join(' ')}; unfed hw>=5: ${unfed.filter((u) => u.hw >= 5).length}`);
    if (unfed.length) {
      const u = unfed[0];
      const r = rs[u.li];
      console.log(`  UNFED head line ${u.li} at ${(r.north[0] / 1000).toFixed(2)},${(r.east[0] / 1000).toFixed(2)} hw ${u.hw.toFixed(1)} level ${r.level[0].toFixed(0)}`);
      along('    view unfed', r, 0, 0, 0, 0, 0, 'n/a');
      const d = at(r, 100);
      view('    view unfed head', r.north[0] - d.dn * 500 + d.de * 150, r.east[0] - d.de * 500 - d.dn * 150, 150, r.north[0], r.east[0], r.level[0], 'looking at the river head');
    }

    // Lakes above the snow line and the shift needed.
    const lakesHigh = outs.map(({ r }) => ({ lvl: r.level[0], n: r.north[0], e: r.east[0], sl: snowLine(r.north[0], r.east[0]) })).sort((a, b) => b.lvl - a.lvl).slice(0, 3);
    console.log(`highest outlet lakes: ${lakesHigh.map((x) => `${x.lvl.toFixed(0)} m at ${(x.n / 1000).toFixed(1)},${(x.e / 1000).toFixed(1)} (snow line ${x.sl.toFixed(0)})`).join('; ')}`);
  }
  setWorldSeed(0);
});
