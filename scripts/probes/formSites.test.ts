// Probe (design-V map 3, read-only): how channel form is chosen, by kind against reach state, and what is drawn where a
// channel's course runs off a steep edge (a shelf, a terrace, a valley wall).
//   FS_SEEDS=42,1 FS_OUT=/path npx vitest run --config scripts/probes/vitest.config.ts formSites --silent=false --disable-console-intercept
// (Round V step 0: ported unchanged from design-V/map-forms/probe (map 3)).
import { it } from 'vitest';
import { hydrology, terrainHeight, naturalHeight } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as { writeFileSync(p: string, d: string): void; mkdirSync(p: string, o: unknown): void };
type Line = { north: Float64Array; east: Float64Array; s: Float64Array; level: Float64Array; halfWidth: Float64Array; area?: Float64Array; kind?: number; joins?: number; regime?: Uint8Array; gradient?: Float32Array; pitchOn?: Float32Array; end?: string };
type Fall = { line: number; index: number; north: number; east: number; top: number; bottom: number; height: number; width: number; cause: string };

// The break-of-slope detector (generic: reads only the water's profile): a lip at sample i where the water above falls
// at most FLOOR_G over FLOOR_RUN m, and below it drops at least DROP_MIN m at WALL_G or more over 40-400 m, the floor at
// most half the wall's gradient (as falls.ts wallStep, with lower thresholds and no kind/position gate).
const FLOOR_RUN = Number(env.FS_FLOOR_RUN ?? 300);
const FLOOR_G = Number(env.FS_FLOOR_G ?? 0.05);
const WALL_G = Number(env.FS_WALL_G ?? 0.25);
const DROP_MIN = Number(env.FS_DROP ?? 20);

function levelAt(r: Line, sv: number): number {
  const s = r.s;
  if (sv <= s[0]) return r.level[0];
  const m = s.length;
  if (sv >= s[m - 1]) return r.level[m - 1];
  let lo = 0, hi = m - 1;
  while (hi - lo > 1) { const md = (lo + hi) >> 1; if (s[md] <= sv) lo = md; else hi = md; }
  const t = (sv - s[lo]) / Math.max(1e-9, s[hi] - s[lo]);
  return r.level[lo] + (r.level[hi] - r.level[lo]) * t;
}

it('form sites', () => {
  const out = env.FS_OUT ?? '/tmp/formSites';
  fs.mkdirSync(out, { recursive: true });
  for (const seed of (env.FS_SEEDS ?? '42,1').split(',').map(Number)) {
    setWorldSeed(seed);
    terrainHeight(0, 0);
    const L = (hydrology.rivers ?? []) as unknown as Line[];
    const falls = (hydrology.falls ?? []) as unknown as Fall[];
    // Classes (as cornerGate): rivers, then outlets / heads (6 km²) / feeders (5 km²), the chain block, continuations.
    const rep = hydrology.streamReport as unknown as { chains?: { traced: number }; shape?: Record<string, number> };
    const nR = L.filter((r) => (r.kind ?? 0) === 0).length;
    let cs = nR;
    for (let i = nR; i < L.length; i++) { const a0 = L[i].area?.[0] ?? 0; if (Math.abs(a0 - 5) < 1e-6 || Math.abs(a0 - 6) < 1e-6) cs = i + 1; else if (a0 >= 9.95 && a0 < 10.05 && i > cs + 30) break; }
    const ce = cs + (rep.chains?.traced ?? 0);
    const cls = (i: number): string => {
      const r = L[i];
      if ((r.kind ?? 0) === 0) return 'river';
      if (i >= cs && i < ce) return 'chain';
      if (i >= ce) return 'cont';
      const a0 = r.area?.[0] ?? 0;
      return Math.abs(a0 - 6) < 1e-6 ? 'head' : Math.abs(a0 - 5) < 1e-6 ? 'feeder' : 'outlet';
    };
    const lines: string[] = [];
    const log = (t: string): void => { console.log(t); lines.push(t); };
    log(`=== seed ${seed}: ${L.length} lines, rivers ${nR}, chain block ${cs}..${ce - 1}; falls ${falls.length}; shape report ${JSON.stringify(rep.shape ?? {})}`);
    // --- Per class: km, km by regime, km cut into pitches, km at river-sized catchment (>= 45 km²), falls by cause.
    type St = { n: number; km: number; reg: number[]; pitch: number; big: number; maxA: number; falls: Record<string, number> };
    const st = new Map<string, St>();
    const get = (c: string): St => st.get(c) ?? (st.set(c, { n: 0, km: 0, reg: [0, 0, 0, 0, 0], pitch: 0, big: 0, maxA: 0, falls: {} }).get(c) as St);
    for (let li = 0; li < L.length; li++) {
      const r = L[li];
      const S = get(cls(li));
      S.n++;
      for (let i = 0; i < r.s.length - 1; i++) {
        const ds = (r.s[i + 1] - r.s[i]) / 1000;
        S.km += ds;
        S.reg[r.regime?.[i] ?? 0] += ds;
        if ((r.pitchOn?.[i] ?? 0) > 0) S.pitch += ds;
        if ((r.area?.[i] ?? 0) >= 45) S.big += ds;
        S.maxA = Math.max(S.maxA, r.area?.[i] ?? 0);
      }
    }
    for (const f of falls) { const S = get(cls(f.line)); S.falls[f.cause] = (S.falls[f.cause] ?? 0) + 1; }
    for (const [c, S] of st) log(`  ${c.padEnd(7)} n ${S.n} km ${S.km.toFixed(0)}; regime km placid ${S.reg[0].toFixed(0)} riffle ${S.reg[1].toFixed(0)} rapids ${S.reg[2].toFixed(0)} steppool ${S.reg[3].toFixed(1)} fall-lip ${S.reg[4].toFixed(2)}; pitch-cut km ${S.pitch.toFixed(0)}; km at A>=45 ${S.big.toFixed(0)} (max A ${S.maxA.toFixed(0)}); falls ${JSON.stringify(S.falls)}`);
    // Falls: heights by cause.
    const byCause = new Map<string, number[]>();
    for (const f of falls) (byCause.get(f.cause) ?? byCause.set(f.cause, []).get(f.cause)!).push(f.height);
    for (const [c, h] of byCause) { h.sort((a, b) => a - b); log(`  falls ${c}: ${h.length}, height p50 ${h[h.length >> 1].toFixed(1)} max ${h[h.length - 1].toFixed(1)}`); }
    // --- Breaks of slope on every line's water (the generic detector).
    type Site = { li: number; c: string; i: number; s: number; drop: number; run: number; gf: number; gw: number; area: number; hw: number; n: number; e: number; fn: number; fe: number; fall: string; lipLevel: number; side: number; sideN: number; regimeWall: number; pitchWall: number; mouthIn: number };
    const sites: Site[] = [];
    const fallsOn = new Map<number, Fall[]>();
    for (const f of falls) (fallsOn.get(f.line) ?? fallsOn.set(f.line, []).get(f.line)!).push(f);
    for (let li = 0; li < L.length; li++) {
      const r = L[li];
      const n = r.s.length;
      const sEnd = r.s[n - 1];
      let i = 0;
      while (i < n - 1) {
        if (r.s[i] < FLOOR_RUN) { i++; continue; }
        const gf = (levelAt(r, r.s[i] - FLOOR_RUN) - r.level[i]) / FLOOR_RUN;
        if (gf > FLOOR_G || r.level[i] < 2) { i++; continue; }
        let best: { j: number; drop: number; run: number } | null = null;
        for (let j = i + 1; j < n && r.s[j] - r.s[i] <= 400; j++) {
          const run = r.s[j] - r.s[i];
          if (run < 40) continue;
          const drop = r.level[i] - r.level[j];
          if (drop < DROP_MIN || drop < WALL_G * run || gf > 0.5 * (drop / run)) continue;
          if (!best || drop > best.drop) best = { j, drop, run };
        }
        if (!best) { i++; continue; }
        // (The tallest lip within the next 100 m of the first: one site per edge.)
        let bi = i;
        let bb = best;
        for (let k = i + 1; k < n && r.s[k] - r.s[i] <= 100; k++) {
          if (r.s[k] < FLOOR_RUN) continue;
          const gk = (levelAt(r, r.s[k] - FLOOR_RUN) - r.level[k]) / FLOOR_RUN;
          if (gk > FLOOR_G) continue;
          for (let j = k + 1; j < n && r.s[j] - r.s[k] <= 400; j++) {
            const run = r.s[j] - r.s[k];
            if (run < 40) continue;
            const drop = r.level[k] - r.level[j];
            if (drop < DROP_MIN || drop < WALL_G * run || gk > 0.5 * (drop / run)) continue;
            if (drop > bb.drop) { bb = { j, drop, run }; bi = k; }
          }
        }
        const fs0 = (fallsOn.get(li) ?? []).filter((f) => Math.abs(r.s[f.index] - r.s[bi]) < 250 || (r.s[f.index] >= r.s[bi] && r.s[f.index] <= r.s[bb.j]));
        // Ground across the lip (drawn), 150-800 m either side: how far the lowest stands under the water (a shelf or
        // terrace has lower ground beside it).
        const a = Math.max(0, bi - 2), b = Math.min(n - 1, bi + 2);
        const tn = r.north[b] - r.north[a], te = r.east[b] - r.east[a], tl = Math.hypot(tn, te) || 1;
        let low = Infinity, lowN = Infinity;
        for (const off of [150, 300, 500, 800]) for (const sd of [-1, 1]) {
          const pn = r.north[bi] + sd * (-te / tl) * off, pe = r.east[bi] + sd * (tn / tl) * off;
          low = Math.min(low, terrainHeight(pn, pe));
          lowN = Math.min(lowN, naturalHeight(pn, pe));
        }
        let reg3 = 0, pit = 0, cnt = 0;
        for (let k = bi; k <= bb.j; k++) { cnt++; if ((r.regime?.[k] ?? 0) >= 3) reg3++; if ((r.pitchOn?.[k] ?? 0) > 0) pit++; }
        sites.push({ li, c: cls(li), i: bi, s: r.s[bi], drop: bb.drop, run: bb.run, gf: (levelAt(r, r.s[bi] - FLOOR_RUN) - r.level[bi]) / FLOOR_RUN, gw: bb.drop / bb.run, area: r.area?.[bi] ?? 0, hw: r.halfWidth[bi], n: r.north[bi], e: r.east[bi], fn: r.north[bb.j], fe: r.east[bb.j], fall: fs0.map((f) => `${f.cause}:${f.height.toFixed(0)}`).join('+'), lipLevel: r.level[bi], side: low - r.level[bi], sideN: lowN - r.level[bi], regimeWall: cnt ? reg3 / cnt : 0, pitchWall: cnt ? pit / cnt : 0, mouthIn: sEnd - r.s[bb.j] });
        i = bb.j;
      }
    }
    log(`  breaks of slope (floor <= ${FLOOR_G} over ${FLOOR_RUN} m, drop >= ${DROP_MIN} m at >= ${WALL_G} over 40-400 m): ${sites.length}`);
    const band = (d: number): string => (d < 40 ? '20-40' : d < 80 ? '40-80' : '80+');
    const tab = new Map<string, { n: number; fall: number; shelf: number }>();
    for (const x of sites) {
      for (const k of [`${x.c} ${band(x.drop)}`, `${x.c} all`, `all ${band(x.drop)}`, 'all all']) {
        const t = tab.get(k) ?? (tab.set(k, { n: 0, fall: 0, shelf: 0 }).get(k) as { n: number; fall: number; shelf: number });
        t.n++;
        if (x.fall) t.fall++;
        if (x.side < -15) t.shelf++;
      }
    }
    for (const k of [...tab.keys()].sort()) { const t = tab.get(k)!; log(`    ${k.padEnd(14)} ${String(t.n).padStart(5)} sites, with a fall ${t.fall}, lower ground beside the lip (>15 m under its water within 800 m) ${t.shelf}`); }
    // The wall's drawing: step-pool share and pitch-cut share.
    const wallRegime = (c: string): string => { const xs = sites.filter((x) => x.c === c); if (!xs.length) return '-'; const r3 = xs.reduce((a, x) => a + x.regimeWall, 0) / xs.length; const p = xs.reduce((a, x) => a + x.pitchWall, 0) / xs.length; return `steppool ${(100 * r3).toFixed(0)} %, pitch-cut ${(100 * p).toFixed(0)} %`; };
    for (const c of ['river', 'outlet', 'head', 'feeder', 'chain', 'cont']) log(`    wall samples ${c}: ${wallRegime(c)}`);
    // Where along the line: within 1.5 km of its mouth (into a receiver: a hanging valley's place) or not.
    const nearMouth = sites.filter((x) => x.mouthIn < 1500).length;
    log(`    of which the wall's foot within 1.5 km of the line's mouth: ${nearMouth}`);
    // The sites written out (all), and the tallest shelf ones printed.
    const csv = ['seed,line,class,s,lipN,lipE,footN,footE,lipLevel,drop,run,floorG,wallG,areaKm2,hw,fall,sideDrawn,sideNatural,steppoolShare,pitchShare,mouthIn'];
    for (const x of sites) csv.push([seed, x.li, x.c, x.s.toFixed(0), x.n.toFixed(0), x.e.toFixed(0), x.fn.toFixed(0), x.fe.toFixed(0), x.lipLevel.toFixed(1), x.drop.toFixed(1), x.run.toFixed(0), x.gf.toFixed(3), x.gw.toFixed(2), x.area.toFixed(1), x.hw.toFixed(1), x.fall || '-', x.side.toFixed(0), x.sideN.toFixed(0), x.regimeWall.toFixed(2), x.pitchWall.toFixed(2), x.mouthIn.toFixed(0)].join(','));
    fs.writeFileSync(`${out}/sites-${seed}.csv`, csv.join('\n') + '\n');
    const top = sites.filter((x) => x.side < -15 && !x.fall).sort((a, b) => b.drop * Math.sqrt(b.area) - a.drop * Math.sqrt(a.area)).slice(0, 15);
    log(`  tallest shelf/terrace edges with no fall (by drop x sqrt(area)):`);
    for (const x of top) log(`    line ${x.li} ${x.c} A ${x.area.toFixed(1)} hw ${x.hw.toFixed(1)} lip (${x.n.toFixed(0)}, ${x.e.toFixed(0)}) ${x.lipLevel.toFixed(0)} m -> foot (${x.fn.toFixed(0)}, ${x.fe.toFixed(0)}): drop ${x.drop.toFixed(0)} m over ${x.run.toFixed(0)} m (floor ${(100 * x.gf).toFixed(1)} %), side ${x.side.toFixed(0)} m, steppool ${(100 * x.regimeWall).toFixed(0)} %, pitch ${(100 * x.pitchWall).toFixed(0)} %, mouth in ${x.mouthIn.toFixed(0)} m`);
    const withFall = sites.filter((x) => x.fall).slice(0, 10);
    log(`  sites that do have a fall:`);
    for (const x of withFall) log(`    line ${x.li} ${x.c} A ${x.area.toFixed(1)} lip (${x.n.toFixed(0)}, ${x.e.toFixed(0)}) drop ${x.drop.toFixed(0)} over ${x.run.toFixed(0)}: ${x.fall}`);
    fs.writeFileSync(`${out}/summary-${seed}.txt`, lines.join('\n') + '\n');
  }
});
