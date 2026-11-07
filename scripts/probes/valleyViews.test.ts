// Foundation stage 4: cockpit-height views inside mountain valleys. Candidates are stream samples (hydrology.rivers,
// kind 1) inside the mountains (the threshold hillslopes' weight >= 0.9) on a pass channel's floor, with the valley's
// walls rising >= 250 m within 700 m either side; the camera stands VV_HEIGHT over the water and looks VV_LOOK m
// down the stream, at its level there. Prints fly-to URLs, one per VV_APART km.
//   VV_SEEDS=42,777777 VV_HEIGHT=450 VV_LOOK=4000 npx vitest run --config scripts/probes/vitest.config.ts valleyViews
import { it } from 'vitest';
import { debugMacro, hydrology, naturalHeight, terrainHeight } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('valley views', () => {
  const H = Number(env.VV_HEIGHT ?? 450);
  const LOOK = Number(env.VV_LOOK ?? 4000);
  const apart = Number(env.VV_APART ?? 15) * 1000;
  for (const seed of (env.VV_SEEDS ?? '42,777777').split(',')) {
    setWorldSeed(seed);
    const got: Array<[number, number]> = [];
    const cands: Array<{ score: number; url: string; n: number; e: number }> = [];
    const why = { pts: 0, mask: 0, straight: 0, wall: 0, clear: 0 };
    for (const r of hydrology.rivers ?? []) {
      if ((r.kind ?? 0) !== 1) continue;
      const S = r.s[r.s.length - 1];
      for (let k = 0; k < r.north.length; k += 20) {
        if (r.s[k] < 1500 || S - r.s[k] < LOOK) continue;
        const d = debugMacro(r.north[k], r.east[k]);
        why.pts++;
        if (!d || d.s.mg < 0.9 || d.s.ch < 0.5) continue;
        why.mask++;
        // Down the stream LOOK m: the look point; the course should keep roughly straight (a valley to look along).
        let j = k;
        while (j < r.s.length - 1 && r.s[j] - r.s[k] < LOOK) j++;
        const dn = r.north[j] - r.north[k];
        const de = r.east[j] - r.east[k];
        const straight = Math.hypot(dn, de) / (r.s[j] - r.s[k]);
        if (straight < Number(env.VV_STRAIGHT ?? 0.8)) continue;
        why.straight++;
        const L = Math.hypot(dn, de);
        const nn = -de / L, ne = dn / L;
        let wall = Infinity;
        for (const side of [-1, 1]) {
          let top = -Infinity;
          for (let x = 100; x <= 700; x += 100) top = Math.max(top, naturalHeight(r.north[k] + side * x * nn, r.east[k] + side * x * ne));
          wall = Math.min(wall, top - r.level[k]);
        }
        if (wall < Number(env.VV_WALL ?? 250)) continue;
        why.wall++;
        // The camera's clearance along the sight line (the ground under it stays under the line).
        const cz = r.level[k] + H;
        let clear = Infinity;
        for (let t = 0.05; t <= 0.8; t += 0.05) {
          const g = terrainHeight(r.north[k] + t * dn, r.east[k] + t * de);
          clear = Math.min(clear, cz + t * (r.level[j] - cz) - g);
        }
        if (env.VV_DEBUG && why.wall < 6) {
          const g0 = terrainHeight(r.north[k], r.east[k]);
          console.log(`  dbg level ${r.level[k].toFixed(0)} ground ${g0.toFixed(0)} cz ${cz.toFixed(0)} end ${r.level[j].toFixed(0)} clear ${clear.toFixed(0)}`);
        }
        if (clear < 60) continue;
        why.clear++;
        const url = `index.html?seed=${seed}&camPos=${r.north[k].toFixed(0)},${r.east[k].toFixed(0)},${cz.toFixed(0)}&camLook=${r.north[j].toFixed(0)},${r.east[j].toFixed(0)},${r.level[j].toFixed(0)}&scenario=runway&tod=10&ui=0&wx=clear&cover=0&clock=0`;
        cands.push({ score: wall, url, n: r.north[k], e: r.east[k] });
      }
    }
    console.log(`seed ${seed}: ${JSON.stringify(why)}`);
    cands.sort((a, b) => b.score - a.score);
    for (const c of cands) {
      if (got.some(([n, e]) => Math.hypot(n - c.n, e - c.e) < apart)) continue;
      got.push([c.n, c.e]);
      console.log(`seed ${seed}: walls ${c.score.toFixed(0)} m  ${c.url}`);
      if (got.length >= Number(env.VV_N ?? 6)) break;
    }
  }
});
