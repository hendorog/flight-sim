// Round V A3r: the world-wide gates' worst sites. For each seed (WN_SEEDS), the WN_N (3) worst sites world-wide of
// each class, at least WN_APART m (3000) apart within a class, each with a camera for it (the shot tool's query: camPos
// about 1.5 km back and 600 m up, from the side whose ground is lowest with a clear line of sight, checked above the
// ground; camLook at the site). Nothing is named: every river, every line, every generated field.
//   perched   a river's water over the drawn ground at its own channel centre (every 50 m; not in standing water)
//   step      the drawn ground's step between 25 m samples across every line (rivers every 100 m, streams and chains
//             every 250 m, out to 700 m either side): the steps over 50 m, worst first (the gate: steps over 100 m)
//   face      a face over 40 degrees within 700 m of a river (the same sections, rivers only) that the water's carve made:
//             the drawn ground over 40 degrees between two 25 m samples where the shaped ground before the carve
//             (naturalHeight) is not; ranked by the face's height (its run of such steps)
//   hidden    a line's water hidden under the drawn ground within a generated field's reach (dryNear's measure, every
//             line of every kind): its hidden length per line and field, worst first
//   poolcut   a fall's pool (every fall) whose water stands under the drawn ground 60 m beside it on both sides (a slot)
//   cross     a line that crosses itself (seededWorld's check, every line)
//   stepup    a junction where the receiver's water stands over the joining line's (junctionGate's measure, > 0.5 m)
//   slot      a line's water in a box slot: the drawn ground 15 m beyond each bank (half-width + 15 m) on both sides over
//             the water, the lower of the two (every 50 m, every line, not in standing water; the A3 checker's chkSlot);
//             km over 20 / 40 m by kind
// Also each class's world-wide totals per seed. WN_OUT: a views file (name query) of every site's camera.
//   WN_SEEDS=1,42,777777 WN_OUT=out/fs/A3r/worstN npx vitest run --config scripts/probes/vitest.config.ts worstN
import { it } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { hydrology, makeSample, sampleTerrain, terrainHeight, naturalHeight } from '../../src/world/terrain/heightfield';
import { generatedAirfields } from '../../src/world/airfields';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
type Line = { north: Float64Array; east: Float64Array; s: Float64Array; level: Float64Array; halfWidth: Float64Array; kind?: number; joins: number };
type Fall = { line: number; index: number; north: number; east: number; height: number; cause: string; dirN: number; dirE: number };
type Site = { cls: string; v: number; n: number; e: number; z: number; text: string; key?: string };
const TAN40 = Math.tan((40 * Math.PI) / 180);

/** A camera on site (n, e) at ground z: 1500 m back and 600 m up from the side whose ground is lowest with a clear
 * line of sight, raised until it stands over the ground; '' if none of the 8 sides is clear. */
function camera(n: number, e: number, z: number): string {
  let best = '';
  let bestG = Infinity;
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    const cn = n + 1500 * Math.cos(a), ce = e + 1500 * Math.sin(a);
    const g = terrainHeight(cn, ce);
    let cz = z + 600;
    if (cz < g + 150) cz = g + 150;
    let clear = true;
    for (let t = 0.1; t < 0.95 && clear; t += 0.05) {
      const pn = cn + (n - cn) * t, pe = ce + (e - ce) * t;
      if (terrainHeight(pn, pe) > cz + (z - cz) * t - 8) clear = false;
    }
    if (clear && g < bestG) {
      bestG = g;
      best = `camPos=${cn.toFixed(0)},${ce.toFixed(0)},${cz.toFixed(0)}&camLook=${n.toFixed(0)},${e.toFixed(0)},${z.toFixed(0)}`;
    }
  }
  return best;
}

/** The N largest of `all` at least `apart` m from each other (and one per `key`, if given). */
function worst(all: Site[], N: number, apart: number): Site[] {
  all.sort((a, b) => b.v - a.v);
  const out: Site[] = [];
  const keys = new Set<string>();
  for (const s of all) {
    if (out.length >= N) break;
    if (s.key && keys.has(s.key)) continue;
    if (out.some((o) => Math.hypot(o.n - s.n, o.e - s.e) < apart)) continue;
    out.push(s);
    if (s.key) keys.add(s.key);
  }
  return out;
}

it('worst N', () => {
  const N = Number(env.WN_N ?? 3);
  const APART = Number(env.WN_APART ?? 3000);
  const classes = (env.WN_CLASSES ?? 'perched,step,face,hidden,poolcut,cross,stepup,slot').split(',');
  const views: string[] = [];
  const s = makeSample();
  for (const seed of (env.WN_SEEDS ?? '1,42,777777').split(',').map(Number)) {
    setWorldSeed(seed);
    terrainHeight(0, 0);
    const L = (hydrology.rivers ?? []) as unknown as Line[];
    const mask = hydrology.lakeMask!;
    const found: Record<string, Site[]> = {};
    const totals: string[] = [];
    const g = (n: number, e: number): number => sampleTerrain(n, e, s).ground;

    if (classes.includes('perched')) {
      const all: Site[] = [];
      let km10 = 0, km30 = 0, hidKm = 0;
      const hid: Site[] = [];
      L.forEach((r, li) => {
        if ((r.kind ?? 0) !== 0) return;
        let last = -1e9;
        for (let i = 0; i < r.north.length; i++) {
          if (r.s[i] - last < 50) continue;
          last = r.s[i];
          sampleTerrain(r.north[i], r.east[i], s);
          if (s.standing >= r.level[i] - 0.05) continue;
          if (s.ground > s.river + 0.05) {
            hidKm += 0.05;
            hid.push({ cls: 'hiddenAll', v: s.ground - r.level[i], n: r.north[i], e: r.east[i], z: s.ground, text: `line ${li} water ${r.level[i].toFixed(1)} under the drawn ground ${s.ground.toFixed(1)} at its centre` });
          }
          const over = r.level[i] - s.ground;
          if (over > 10) km10 += 0.05;
          if (over > 30) km30 += 0.05;
          if (over > 2) all.push({ cls: 'perched', v: over, n: r.north[i], e: r.east[i], z: r.level[i], text: `line ${li} water ${r.level[i].toFixed(1)} over its centre ground ${s.ground.toFixed(1)}: ${over.toFixed(1)} m` });
        }
      });
      found.perched = worst(all, N, APART);
      totals.push(`perched: river water > 10 m over its centre ground ${km10.toFixed(2)} km, > 30 m ${km30.toFixed(2)} km; river water hidden under the drawn ground at its centre (anywhere) ${hidKm.toFixed(2)} km, worst ${worst(hid, 3, 1000).map((x) => `${x.text} at ${x.n.toFixed(0)},${x.e.toFixed(0)}`).join('; ')}`);
    }

    if (classes.includes('step') || classes.includes('face')) {
      const steps: Site[] = [];
      const faces: Site[] = [];
      let n100 = 0, n50 = 0, faceKm2 = 0, face40Km2 = 0;
      L.forEach((r, li) => {
        const river = (r.kind ?? 0) === 0;
        const every = river ? 100 : 250;
        let last = -1e9;
        for (let i = 1; i < r.north.length - 1; i++) {
          if (r.s[i] - last < every) continue;
          last = r.s[i];
          const dn0 = r.north[i + 1] - r.north[i - 1], de0 = r.east[i + 1] - r.east[i - 1];
          const dl = Math.hypot(dn0, de0) || 1;
          const un = -de0 / dl, ue = dn0 / dl;
          for (const sd of [-1, 1]) {
            let pg = g(r.north[i], r.east[i]);
            let pnat = river && classes.includes('face') ? naturalHeight(r.north[i], r.east[i]) : 0;
            let run = 0, runFrom = 0;
            for (let o = 25; o <= 700; o += 25) {
              const pn = r.north[i] + un * o * sd, pe = r.east[i] + ue * o * sd;
              const gg = g(pn, pe);
              const d = Math.abs(gg - pg);
              if (d > 50) {
                n50++;
                if (d > 100) n100++;
                steps.push({ cls: 'step', v: d, n: pn - un * 12.5 * sd, e: pe - ue * 12.5 * sd, z: Math.min(gg, pg), text: `${d.toFixed(0)} m between ${o - 25} and ${o} m from line ${li} (kind ${r.kind ?? 0}, water ${r.level[i].toFixed(1)}): ${pg.toFixed(1)} -> ${gg.toFixed(1)}` });
              }
              if (river && classes.includes('face')) {
                const nat = naturalHeight(pn, pe);
                const steep = d > TAN40 * 25;
                if (steep) face40Km2 += (25 * every) / 1e6;
                const made = steep && !(Math.abs(nat - pnat) > TAN40 * 25);
                if (made) {
                  faceKm2 += (25 * every) / 1e6;
                  if (run === 0) runFrom = o - 25;
                  run += d;
                } else if (run > 0) {
                  faces.push({ cls: 'face', v: run, n: r.north[i] + un * ((runFrom + o - 25) / 2) * sd, e: r.east[i] + ue * ((runFrom + o - 25) / 2) * sd, z: pg, text: `a ${run.toFixed(0)} m face over 40 deg at ${runFrom}-${o - 25} m from river ${li} (water ${r.level[i].toFixed(1)}), not in the shaped ground before the carve` });
                  run = 0;
                }
                pnat = nat;
              }
              pg = gg;
            }
            if (run > 0) faces.push({ cls: 'face', v: run, n: r.north[i] + un * runFrom * sd, e: r.east[i] + ue * runFrom * sd, z: pg, text: `a ${run.toFixed(0)} m face over 40 deg from ${runFrom} m to 700 m from river ${li}, not in the shaped ground before the carve` });
          }
        }
      });
      found.step = worst(steps, N, APART);
      found.face = worst(faces, N, APART);
      totals.push(`step: across every line, steps over 50 m ${n50}, over 100 m ${n100} (25 m samples)`);
      totals.push(`face: within 700 m of rivers, over 40 deg ${face40Km2.toFixed(1)} km2 (sampled), of it made by the carve ${faceKm2.toFixed(1)} km2`);
    }

    if (classes.includes('hidden')) {
      const all: Site[] = [];
      const fields = generatedAirfields();
      const per = new Map<string, { inR: number; hid: number }>();
      for (const f of fields) per.set(f.code, { inR: 0, hid: 0 });
      L.forEach((r, li) => {
        const run = new Map<string, { hid: number; worst: number; n: number; e: number }>();
        for (let i = 1; i < r.north.length; i++) {
          let f0: (typeof fields)[number] | null = null;
          for (const f of fields) {
            const reach = f.length / 2 + f.approachLength + f.blend;
            if ((r.north[i] - f.north) ** 2 + (r.east[i] - f.east) ** 2 <= reach * reach) {
              f0 = f;
              break;
            }
          }
          if (!f0) continue;
          const ds = r.s[i] - r.s[i - 1];
          const p = per.get(f0.code)!;
          p.inR += ds;
          sampleTerrain(r.north[i], r.east[i], s);
          if (s.ground > s.river + 0.05) {
            p.hid += ds;
            const k = run.get(f0.code) ?? { hid: 0, worst: 0, n: r.north[i], e: r.east[i] };
            k.hid += ds;
            const under = Number.isFinite(s.river) ? s.ground - s.river : 99;
            if (under > k.worst) Object.assign(k, { worst: under, n: r.north[i], e: r.east[i] });
            run.set(f0.code, k);
          }
        }
        for (const [code, k] of run) all.push({ cls: 'hidden', v: k.hid, n: k.n, e: k.e, z: g(k.n, k.e), key: `${li}`, text: `line ${li} (kind ${r.kind ?? 0}) hidden ${k.hid.toFixed(0)} m by ${code}, worst ${k.worst >= 99 ? 'off its channel' : `${k.worst.toFixed(1)} m under`}` });
      });
      found.hidden = worst(all, N, 0);
      let tot = 0, totIn = 0;
      for (const [, p] of per) {
        tot += p.hid;
        totIn += p.inR;
      }
      totals.push(`hidden: every line in every field's reach ${totIn.toFixed(0)} m, hidden ${tot.toFixed(0)} m; by field ${[...per.entries()].map(([c, p]) => `${c} ${p.hid.toFixed(0)}/${p.inR.toFixed(0)}`).join(', ')}`);
    }

    if (classes.includes('poolcut')) {
      const all: Site[] = [];
      const falls = (hydrology.falls ?? []) as unknown as Fall[];
      const under: number[] = [];
      for (const f of falls) {
        const r = L[f.line];
        const i = f.index;
        let k = i + 1;
        while (k + 1 < r.level.length && Math.abs(r.level[k + 1] - r.level[i + 1]) < 0.3) k++;
        const m = Math.min(r.level.length - 1, Math.round((i + 1 + k) / 2));
        const pn = r.north[m], pe = r.east[m], lv = r.level[m], hw = r.halfWidth[m];
        const d = hw + 60;
        const slot = Math.min(terrainHeight(pn - f.dirE * d, pe + f.dirN * d), terrainHeight(pn + f.dirE * d, pe - f.dirN * d)) - lv;
        under.push(slot);
        if (slot > 0) all.push({ cls: 'poolcut', v: slot, n: pn, e: pe, z: lv, text: `${f.cause} fall on line ${f.line} (kind ${r.kind ?? 0}), drop ${f.height.toFixed(0)} m: its pool's water ${slot.toFixed(1)} m under the ground 60 m beside it on both sides` });
      }
      under.sort((a, b) => a - b);
      const q = (p: number): string => (under.length ? under[Math.min(under.length - 1, Math.floor(p * under.length))].toFixed(1) : '-');
      found.poolcut = worst(all, N, APART);
      totals.push(`poolcut: ${falls.length} falls; pool water under the ground 60 m beside it (lower side) p50 ${q(0.5)} p90 ${q(0.9)} max ${q(1)} m; over 5 m ${under.filter((u) => u > 5).length}`);
    }

    if (classes.includes('cross')) {
      const all: Site[] = [];
      let crossings = 0;
      L.forEach((r, li) => {
        const n = r.north.length;
        const grid = new Map<number, number[]>();
        const key = (pn: number, pe: number): number => (Math.floor(pn / 100) + 32768) * 65536 + (Math.floor(pe / 100) + 32768);
        for (let i = 0; i < n - 1; i++) {
          const k = key(r.north[i], r.east[i]);
          const l = grid.get(k);
          if (l) l.push(i);
          else grid.set(k, [i]);
        }
        for (let i = 0; i < n - 1; i++)
          for (let a = -1; a <= 1; a++)
            for (let b = -1; b <= 1; b++)
              for (const j of grid.get(key(r.north[i] + a * 100, r.east[i] + b * 100)) ?? []) {
                if (j <= i + 2) continue;
                const ax = r.east[i], ay = r.north[i], bx = r.east[i + 1], by = r.north[i + 1];
                const cx = r.east[j], cy = r.north[j], dx = r.east[j + 1], dy = r.north[j + 1];
                const d1 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
                const d2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
                const d3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
                const d4 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
                if (d1 * d2 < 0 && d3 * d4 < 0) {
                  crossings++;
                  all.push({ cls: 'cross', v: 1, n: r.north[i], e: r.east[i], z: g(r.north[i], r.east[i]), key: `${li}`, text: `line ${li} (kind ${r.kind ?? 0}) crosses itself (segments ${i} and ${j}, levels ${r.level[i].toFixed(1)} / ${r.level[j].toFixed(1)})` });
                }
              }
      });
      found.cross = worst(all, N, 0);
      totals.push(`cross: self-crossings ${crossings}`);
    }

    if (classes.includes('stepup')) {
      const all: Site[] = [];
      const c = [0, 0, 0];
      L.forEach((r, li) => {
        const J = r.joins;
        if (!(J >= 0) || J >= L.length) return;
        const P = L[J];
        const m = r.north.length - 1;
        const pn = r.north[m], pe = r.east[m];
        let bd = Infinity, lev = NaN;
        for (let k = 0; k < P.north.length - 1; k++) {
          const an = P.north[k], ae = P.east[k];
          const dn = P.north[k + 1] - an, de = P.east[k + 1] - ae;
          const l2 = dn * dn + de * de;
          const t = l2 > 0 ? Math.min(1, Math.max(0, ((pn - an) * dn + (pe - ae) * de) / l2)) : 0;
          const d = Math.hypot(an + t * dn - pn, ae + t * de - pe);
          if (d < bd) {
            bd = d;
            lev = P.level[k] + t * (P.level[k + 1] - P.level[k]);
          }
        }
        if (!(bd < 60)) return;
        const step = lev - r.level[m];
        if (step > 0.5) c[0]++;
        if (step > 2) c[1]++;
        if (step > 5) c[2]++;
        const lake = mask.at(pn, pe);
        if (step > 0.5) all.push({ cls: 'stepup', v: step, n: pn, e: pe, z: lev, text: `line ${li} (kind ${r.kind ?? 0}) into ${J} (kind ${P.kind ?? 0}): joining ${r.level[m].toFixed(1)}, receiver ${lev.toFixed(1)}, step up ${step.toFixed(2)} m${lake > -Infinity ? ` (in a lake at ${lake.toFixed(1)})` : ''}` });
      });
      found.stepup = worst(all, N, APART);
      totals.push(`stepup: junction step-ups > 0.5 / 2 / 5 m ${c.join(' / ')} (in lakes and out)`);
    }

    if (classes.includes('slot')) {
      const all: Site[] = [];
      const km = [[0, 0], [0, 0]];
      const ss = makeSample();
      L.forEach((r, li) => {
        const k = (r.kind ?? 0) === 0 ? 0 : 1;
        let last = -1e9;
        for (let i = 1; i < r.north.length - 1; i++) {
          if (r.s[i] - last < 50) continue;
          last = r.s[i];
          sampleTerrain(r.north[i], r.east[i], ss);
          if (Number.isFinite(ss.standing) && ss.standing > 0 && ss.standing >= r.level[i] - 0.05) continue;
          const dn = r.north[i + 1] - r.north[i - 1], de = r.east[i + 1] - r.east[i - 1];
          const dl = Math.hypot(dn, de) || 1;
          const un = -de / dl, ue = dn / dl, d = r.halfWidth[i] + 15;
          const a = terrainHeight(r.north[i] + un * d, r.east[i] + ue * d), b = terrainHeight(r.north[i] - un * d, r.east[i] - ue * d);
          const slot = Math.min(a, b) - r.level[i];
          if (slot > 20) km[k][0] += 0.05;
          if (slot > 40) km[k][1] += 0.05;
          if (slot > 20) all.push({ cls: 'slot', v: slot, n: r.north[i], e: r.east[i], z: r.level[i], key: `${li}`, text: `line ${li} (kind ${r.kind ?? 0}) water ${r.level[i].toFixed(1)} in a slot ${slot.toFixed(0)} m deep (walls ${a.toFixed(0)} / ${b.toFixed(0)} at ${d.toFixed(0)} m)` });
        }
      });
      found.slot = worst(all, N, APART);
      totals.push(`slot: water in a box slot (both walls 15 m past the banks over it) > 20 / > 40 m, km: rivers ${km[0].map((x) => x.toFixed(2)).join(' / ')}, streams ${km[1].map((x) => x.toFixed(2)).join(' / ')}`);
    }

    for (const t of totals) console.log(`WN seed ${seed} TOTAL ${t}`);
    for (const cls of classes) {
      const list = found[cls] ?? [];
      if (!list.length) console.log(`WN seed ${seed} ${cls}: none`);
      list.forEach((x, k) => {
        const cam = camera(x.n, x.e, x.z);
        const name = `w${seed}-${cls}${k + 1}`;
        console.log(`WN seed ${seed} ${cls} #${k + 1}: ${x.text} at ${x.n.toFixed(0)},${x.e.toFixed(0)} | ${name} ${cam ? `seed=${seed}&${cam}` : '(no clear camera)'}`);
        if (cam) views.push(`${name} seed=${seed}&${cam}`);
      });
    }
  }
  if (env.WN_OUT) {
    mkdirSync(env.WN_OUT.replace(/\/[^/]*$/, ''), { recursive: true });
    writeFileSync(`${env.WN_OUT}.txt`, views.join('\n') + '\n');
  }
  setWorldSeed(0);
});
