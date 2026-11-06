// Camera sites for the rill shots (out/b): in each window the hillside point with the most rill length within 400 m,
// seen from 150, 450 and 1500 ft over the ground, from the side where the ground under the camera is lowest (over the
// valley, looking at the slope). Writes a shot list (name, query) for out/b/shots.sh.
//   RILL_WINS='42@-23664,71632 ...' RCAM_OUT=out/b/shotlist.txt
//   npx vitest run --config scripts/probes/vitest.config.ts scripts/probes/rillCams.test.ts
import { it } from 'vitest';
import { makeSample, sampleTerrain } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
import { computeBiome, makeBiome } from '../../src/world/terrain/biome';
import { RILL_CELL, rillSegments, traceRillGraph } from '../../src/world/terrain/rills';

const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as { writeFileSync(p: string, d: string): void };
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;

it('rill cams', () => {
  const wins = (env.RILL_WINS ?? '42@-23664,71632 42@-44992,-9504 1@-62512,21712 1@-28912,76960 777777@-104992,37248 777777@-20752,-20992').split(/\s+/).filter(Boolean);
  const out: string[] = [];
  const s = makeSample();
  const gnd = (n: number, e: number): number => sampleTerrain(n, e, s).ground;
  for (const w of wins) {
    const [sd, at] = w.split('@');
    const seed = Number(sd);
    setWorldSeed(seed);
    const [wn, we] = at.split(',').map(Number);
    const cn = Math.round(wn / RILL_CELL), ce = Math.round(we / RILL_CELL);
    const H = 125, F = H + 100;
    const g = traceRillGraph(ce - F, cn - F, 2 * F + 1, 2 * F + 1, 90, 90, 2 * F - 89, 2 * F - 89);
    const segs = rillSegments(g, F - H, F - H, F + H + 1, F + H + 1);
    // Rill length on open ground (no forest to hide it) counts.
    const bio = makeBiome();
    const open = segs.filter((sg) => {
      sampleTerrain(sg.n0, sg.e0, s);
      const gn = (gnd(sg.n0 + 8, sg.e0) - gnd(sg.n0 - 8, sg.e0)) / 16, ge = (gnd(sg.n0, sg.e0 + 8) - gnd(sg.n0, sg.e0 - 8)) / 16;
      sampleTerrain(sg.n0, sg.e0, s);
      computeBiome(sg.n0, sg.e0, s, 1 / Math.sqrt(1 + gn * gn + ge * ge), bio);
      return bio.forest < 0.3;
    });
    let best = { n: wn, e: we, score: -1 };
    for (let dn = -1500; dn <= 1500; dn += 250) for (let de = -1500; de <= 1500; de += 250) {
      const n = cn * RILL_CELL + dn, e = ce * RILL_CELL + de;
      const slope = Math.hypot(gnd(n + 50, e) - gnd(n - 50, e), gnd(n, e + 50) - gnd(n, e - 50)) / 100;
      if (slope < 0.2) continue;
      let score = 0;
      for (const sg of open) if ((sg.n0 - n) ** 2 + (sg.e0 - e) ** 2 < 400 * 400) score += Math.hypot(sg.e1 - sg.e0, sg.n1 - sg.n0) * (sg.s0 > 0.3 ? 2 : 1);
      if (score > best.score) best = { n, e, score };
    }
    const tH = gnd(best.n, best.e);
    // The ground's normal at the target (east, north, up).
    const gE = (gnd(best.n, best.e + 30) - gnd(best.n, best.e - 30)) / 60, gN = (gnd(best.n + 30, best.e) - gnd(best.n - 30, best.e)) / 60;
    const nl = Math.hypot(gE, gN, 1);
    const nE = -gE / nl, nN = -gN / nl, nU = 1 / nl;
    for (const [ft, dist] of [[150, 500], [450, 900], [1500, 1800]] as const) {
      // From the side the slope faces most (its face toward the camera), with the line of sight clear of the ground.
      let cam = { n: 0, e: 0, alt: 0, face: -Infinity };
      for (let k = 0; k < 24; k++) {
        const a = (k / 24) * Math.PI * 2;
        const n = best.n + Math.cos(a) * dist, e = best.e + Math.sin(a) * dist;
        const alt = gnd(n, e) + ft * 0.3048;
        let clear = true;
        for (let t = 0.05; t < 0.95 && clear; t += 0.03) if (gnd(n + (best.n - n) * t, e + (best.e - e) * t) > alt + (tH - alt) * t - 3) clear = false;
        if (!clear) continue;
        const vl = Math.hypot(best.e - e, best.n - n, tH - alt);
        const face = -((best.e - e) * nE + (best.n - n) * nN + (tH - alt) * nU) / vl;
        if (face > cam.face) cam = { n, e, alt, face };
      }
      if (cam.face === -Infinity) continue;
      const name = `s${seed}${String.fromCharCode(97 + wins.filter((x) => x.startsWith(sd + '@')).indexOf(w))}-${ft}`;
      out.push(`${name} seed=${seed}&camPos=${Math.round(cam.n)},${Math.round(cam.e)},${Math.round(cam.alt)}&camLook=${best.n},${best.e},${Math.round(tH)}`);
    }
  }
  fs.writeFileSync(env.RCAM_OUT ?? 'out/b/shotlist.txt', out.join('\n') + '\n');
});
