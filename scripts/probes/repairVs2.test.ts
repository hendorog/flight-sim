// Repair probe (the streams verifier's detail checks): falls over 12 m, lip water over the lower bank, terrain following by regime, outlet start levels, receivers narrower than tributaries. VS_SEEDS
import { it } from 'vitest';
import { hydrology, makeSample, naturalHeight, naturalHeightSmooth, sampleTerrain, terrainHeight } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const seeds = (process.env.VS_SEEDS ?? '42').split(',').map(Number);
const pct = (a: number, b: number) => `${(100 * a / Math.max(1, b)).toFixed(2)}%`;
const q = (arr: number[], p: number) => { if (!arr.length) return NaN; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
it('detail', () => {
  for (const seed of seeds) {
    setWorldSeed(seed);
    const rs: any[] = (hydrology as any).rivers; const falls: any[] = (hydrology as any).falls; const mask = (hydrology as any).lakeMask;
    const S = makeSample();
    console.log(`\n===== seed ${seed}`);
    // falls > 12 m
    for (const f of falls) { const d = f.top - f.bottom; if (d <= 12.01) continue; const r = rs[f.line]; const m = r.level.length; const i = f.index;
      console.log(`BIGFALL ${d.toFixed(1)} m line ${f.line} kind ${r.kind} end ${r.end} lip ${i}/${m} next-in-lake ${mask.at(r.north[i + 1], r.east[i + 1]) > -Infinity} levels ${Array.from(r.level.slice(Math.max(0, i - 2), i + 4)).map((v: any) => v.toFixed(1)).join(',')} s ${Array.from(r.s.slice(Math.max(0, i - 2), i + 4)).map((v: any) => v.toFixed(0)).join(',')}`); }
    // falls: water over the lower bank at lip and at foot
    const lipB: number[] = [], footB: number[] = [];
    for (const f of falls) {
      const r = rs[f.line]; const i = f.index; const m = r.level.length; if (i + 1 >= m || i < 1) continue;
      for (const [k, arr] of [[i, lipB], [i + 1, footB]] as const) {
        const dn = r.north[Math.min(m - 1, k + 1)] - r.north[k - 1], de = r.east[Math.min(m - 1, k + 1)] - r.east[k - 1]; const len = Math.hypot(dn, de) || 1;
        const off = r.halfWidth[k] + 8; let lo = Infinity;
        for (const sg of [-1, 1]) { sampleTerrain(r.north[k] - de / len * off * sg, r.east[k] + dn / len * off * sg, S); lo = Math.min(lo, S.ground); }
        arr.push(r.level[k] - lo);
      }
    }
    const c = (a: number[], t: number) => a.filter((v) => v > t).length;
    console.log(`FALLBANK lip water over lower bank (hw+8 m) >2 m ${c(lipB, 2)} >5 m ${c(lipB, 5)} >10 m ${c(lipB, 10)} of ${lipB.length} (max ${Math.max(...lipB).toFixed(1)}); foot >2 ${c(footB, 2)} >5 ${c(footB, 5)} >10 ${c(footB, 10)} (max ${Math.max(...footB).toFixed(1)})`);
    // follow by regime, robust direction (k+-2), offsets within 120 m, drawn ground and natural
    for (const kind of [0, 1]) {
      const tot = [0, 0, 0, 0, 0], low = [0, 0, 0, 0, 0], lowS = [0, 0, 0, 0, 0], low10 = [0, 0, 0, 0, 0];
      const ex: string[] = [];
      rs.forEach((r, li) => { if ((r.kind ?? 0) !== kind) return;
        for (let k = 3; k < r.north.length - 3; k += 4) {
          const pn = r.north[k], pe = r.east[k]; if (mask.at(pn, pe) > -Infinity) continue;
          sampleTerrain(pn, pe, S); if (S.ground < 1) continue;
          const g = r.regime[k]; tot[g]++;
          const dn = r.north[k + 2] - r.north[k - 2], de = r.east[k + 2] - r.east[k - 2]; const len = Math.hypot(dn, de) || 1;
          const L = r.level[k]; let lo = Infinity, loS = Infinity, at = 0;
          for (let o = 20; o <= Number(process.env.VS_WIN ?? 120); o += 10) for (const sg of [-1, 1]) {
            if (o < r.halfWidth[k] + 15) continue;
            const x = pn - de / len * o * sg, y = pe + dn / len * o * sg;
            sampleTerrain(x, y, S); const wet = (S.standing > S.ground + 0.05 && S.standing > 0.5) || S.river > -Infinity;
            if (!wet && S.ground < lo) { lo = S.ground; at = o * sg; }
            loS = Math.min(loS, naturalHeightSmooth(x, y));
          }
          if (lo < L - 2) { low[g]++; if (lo < L - 10) { low10[g]++; if (ex.length < 8 && g <= 1) ex.push(`line ${li} @${(pn / 1000).toFixed(2)},${(pe / 1000).toFixed(2)} lvl ${L.toFixed(1)} ground ${(lo).toFixed(1)} at ${at} m`); } }
          if (loS < L - 2) lowS[g]++;
        }
      });
      console.log(`FOLLOW2 kind ${kind} by regime [placid,riffle,rapids,steppool,lip]: pts ${tot.join('/')}; drawn dry ground within 120 m across >2 m below water ${tot.map((t, i) => pct(low[i], t)).join(' / ')}; >10 m ${tot.map((t, i) => pct(low10[i], t)).join(' / ')}; routing ground (naturalHeightSmooth) >2 m below ${tot.map((t, i) => pct(lowS[i], t)).join(' / ')}`);
      console.log(`  examples (placid/riffle >10 m): ${ex.join('; ')}`);
    }
    // area decreasing: which kind
    const ad = [0, 0]; let adw = 0, adAt = '';
    rs.forEach((r, li) => { for (let i = 0; i + 1 < r.area.length; i++) { const d = r.area[i] - r.area[i + 1]; if (d > 0.01) { ad[r.kind ?? 0]++; if (d > adw) { adw = d; adAt = `line ${li} k${r.kind} i ${i} ${r.area[i].toFixed(1)}->${r.area[i + 1].toFixed(1)}`; } } } });
    console.log(`AREADEC rivers ${ad[0]} streams ${ad[1]} worst ${adw.toFixed(1)} ${adAt}`);
    // outlet level vs lake level: streams starting in lake water, rivers starting within 300 m of lake water
    { const dif: number[] = []; const ex: string[] = []; let n = 0, above05 = 0, above2 = 0;
      rs.forEach((r, li) => { if (r.kind !== 1) return; const lv = mask.at(r.north[0], r.east[0], terrainHeight(r.north[0], r.east[0])); if (!(lv > -Infinity)) return; n++;
        const d = r.level[0] - lv; dif.push(d); if (d > 0.5) above05++; if (d > 2) { above2++; if (ex.length < 8) ex.push(`line ${li} @${(r.north[0] / 1000).toFixed(2)},${(r.east[0] / 1000).toFixed(2)} lake ${lv.toFixed(1)} stream ${r.level[0].toFixed(1)} end ${r.end}`); }
        // first sample past the lake: level vs lake
      });
      console.log(`OUTLETLVL streams starting in lake water ${n}: start level above the lake >0.5 m ${above05}, >2 m ${above2}; p50/p90/max ${q(dif, 0.5).toFixed(2)}/${q(dif, 0.9).toFixed(2)}/${Math.max(...dif).toFixed(2)}: ${ex.join('; ')}`);
    }
    { const ex: Array<[number, string]> = [];
      for (const f of falls) { const r = rs[f.line]; const k = f.index; const m = r.level.length; if (k < 1 || k + 1 >= m) continue;
        const dn = r.north[k + 1] - r.north[k - 1], de = r.east[k + 1] - r.east[k - 1]; const len = Math.hypot(dn, de) || 1; const off = r.halfWidth[k] + 8; let lo = Infinity;
        for (const sg of [-1, 1]) { sampleTerrain(r.north[k] - de / len * off * sg, r.east[k] + dn / len * off * sg, S); lo = Math.min(lo, S.ground); }
        ex.push([r.level[k] - lo, `${(r.level[k] - lo).toFixed(1)} m line ${f.line}(k${r.kind}) @${(f.north / 1000).toFixed(3)},${(f.east / 1000).toFixed(3)} lvl ${r.level[k].toFixed(0)} drop ${(f.top - f.bottom).toFixed(1)}`]); }
      ex.sort((a, b) => b[0] - a[0]); console.log(`LIPHANG worst: ${ex.slice(0, 6).map((e) => e[1]).join('; ')}`);
    }
    { const ex: string[] = []; let n = 0;
      rs.forEach((r, li) => { const p = r.joins ?? -1; if (p < 0) return; if ((r.kind ?? 0) === 0 && (rs[p].kind ?? 0) === 0) return; const P = rs[p]; const m = r.north.length;
        let bj = 0, bd = Infinity; for (let j = 0; j < P.north.length; j++) { const d = Math.hypot(P.north[j] - r.north[m - 1], P.east[j] - r.east[m - 1]); if (d < bd) { bd = d; bj = j; } }
        if (bd > 300) return; let jd = bj; while (jd < P.s.length - 1 && P.s[jd] < P.s[bj] + 300) jd++;
        if (P.halfWidth[jd] + 0.05 < r.halfWidth[m - 1]) { n++; if (ex.length < 6) ex.push(`${li}(k${r.kind} hw ${r.halfWidth[m - 1].toFixed(1)} area ${r.area[m - 1].toFixed(0)}) into ${p}(k${P.kind} hw ${P.halfWidth[jd].toFixed(1)} area ${P.area[jd].toFixed(0)}) @${(r.north[m - 1] / 1000).toFixed(1)},${(r.east[m - 1] / 1000).toFixed(1)}`); } });
      console.log(`NARROWRECV involving streams ${n}: ${ex.join('; ')}`); }
    // fall dumps: 6 deterministic picks
    for (let t = 0; t < 6; t++) { const f = falls[Math.floor((t + 0.5) * falls.length / 6)]; const r = rs[f.line]; const i = f.index; const lo = Math.max(0, i - 2), hi = Math.min(r.level.length, i + 7);
      console.log(`FALLDUMP line ${f.line} k${r.kind} lip ${i} drop ${(f.top - f.bottom).toFixed(1)}: ` + Array.from({ length: hi - lo }, (_, q) => `s${r.s[lo + q].toFixed(0)}:${r.level[lo + q].toFixed(1)}`).join(' ')); }
    // no-exit lakes: lines nearby
    const want = (process.env.VS_LAKES ?? '').split(';').filter(Boolean).map((s) => s.split(',').map(Number));
    for (const [ln, le] of want) {
      const l = hydrology.lakes.find((x) => Math.abs(x.north / 1000 - ln) < 0.06 && Math.abs(x.east / 1000 - le) < 0.06); if (!l) { console.log(`lake ${ln},${le} not found`); continue; }
      const near: string[] = [];
      rs.forEach((r, li) => { let best = Infinity, bi = 0; for (let i = 0; i < r.north.length; i++) { const d = Math.hypot(r.north[i] - l.north, r.east[i] - l.east); if (d < best) { best = d; bi = i; } }
        if (best < l.bound + 1500) near.push(`line ${li} k${r.kind} end ${r.end} closest ${best.toFixed(0)} m at i ${bi}/${r.north.length} lvl ${r.level[bi].toFixed(1)} maskAt ${mask.at(r.north[bi], r.east[bi]).toFixed(1)} start-dist ${Math.hypot(r.north[0] - l.north, r.east[0] - l.east).toFixed(0)}`); });
      console.log(`LAKE ${ln},${le} level ${l.level.toFixed(1)} bound ${l.bound.toFixed(0)} rA ${l.radiusA.toFixed(0)} centre-maskAt ${mask.at(l.north, l.east).toFixed(1)}: ${near.join(' | ') || 'no line within bound+1500'}`);
    }
  }
  setWorldSeed(0);
});
