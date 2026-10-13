// `node scripts/safari-geometry.mjs sweep`: the lighting sweep of the safari's first minute (see safari-geometry.mjs).
// The default boot (cockpit, the stub content) at each tod x track, shot at each time. A track other than SAFARI's
// re-starts the hold in the page at that track (its `across` solved in node so the river herd passes the same
// distance left), so the frames compare like with like. Per frame, from the PNG itself:
//   - herd / ground: the river herd members' screen positions (projected in the page): mean luminance of the 3x3
//     pixels at each visible member vs the ring 10-16 px around it (ratio of the larger to the smaller);
//   - cone / sky: the volcano summit projected in the page; mean luminance of a box on the cone just below the
//     summit vs a box of sky above it (the ratio), i.e. how well the cone region reads against the sky;
//   - the auto-exposure, where the sun is on screen, and the sky's dayFactor.
//
//   --tods 17.8,18.3,18.6,19.0,19.4   --tracks 20,27,35   --times 2,12   --out dir
//   (PNGs: wp0a-sweep-<tod>-<track>-<t>.png)

import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readPng } from './lib/png.mjs';

const EVAL = (t, pose) => `(async () => {
  const sim = window.__sim, f = sim.fauna, H = f.herds, h = f.riverHerd;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  (() => { const seen = new Set(); const walk = (o, d) => { if (!o || typeof o !== 'object' || seen.has(o) || d > 4) return; seen.add(o); if (typeof o.updateLight === 'function' && 'light' in o) { o.updateLight = () => {}; if (o.light) o.light.upload.flush = () => {}; } for (const k of Object.keys(o)) { try { walk(o[k], d + 1); } catch {} } }; walk(sim.systems, 0); })();
  const POSE = ${JSON.stringify(pose)};
  let t0 = 0, hdgDeg = sim.summary().headingDeg;
  if (POSE) {
    // The safari hold at POSE.track / POSE.across (SAFARI's along and AGL), as the scenario builds it.
    const A = await import('/src/world/era/cretaceousAnchors.ts');
    const sc = await import('/src/sim/scenarios.ts');
    const { terrainHeight } = await import('/src/world/terrain/heightfield.ts');
    const start = { ...A.SAFARI, trackDeg: POSE.track, across: POSE.across };
    const p0 = A.safariStartNed(start), hdg = A.safariHeading(start);
    const alt = terrainHeight(p0.north, p0.east) + start.aglFt * 0.3048;
    const P = sim.physics, base = P.scenario;
    P.resetTo({ ...base, ic: { ...base.ic, position: { x: p0.north, y: p0.east, z: -alt }, heading: hdg, airspeed: sc.kiasToTas(base.autoflight.kias, alt, P.env) }, autoflight: { ...base.autoflight, heading: hdg, altitude: alt }, engageAutoflight: true });
    t0 = sim.summary().time;
    hdgDeg = hdg * 57.29578;
  }
  while (sim.summary().time < t0 + ${t}) await sleep(30);
  sim.pause(true);
  await sleep(400);
  const url = performance.getEntriesByType('resource').map((e) => e.name).find((n) => /\\/deps\\/three\\.js/.test(n));
  const T = await import(url);
  const cam = sim.ctx.camera, v = new T.Vector3(), pts = [];
  for (let k = 0; k < H.size[h]; k++) {
    const i = h * H.memberCap + k;
    v.set(H.mE[i], H.mH[i] + 1.2, -H.mN[i]).project(cam);
    if (v.z < 1 && Math.abs(v.x) < 1 && Math.abs(v.y) < 1) pts.push([Math.round((v.x + 1) * innerWidth / 2), Math.round((1 - v.y) * innerHeight / 2)]);
  }
  let exposure = null;
  try { const px = new Float32Array(4); sim.ctx.renderer.readRenderTargetPixels(sim.post.exposure.adapted[0], 0, 0, 1, 1, px); exposure = +px[0].toFixed(3); } catch {}
  const sd = sim.ctx.sky.sunDir.clone().multiplyScalar(1e5).add(cam.position).project(cam);
  const V = (await import('/src/world/era/eraState.ts')).era().terrain.volcano;
  const vs = V ? new T.Vector3(V.east, V.summit, -V.north).project(cam) : null;
  const summit = vs && vs.z < 1 ? [Math.round((vs.x + 1) * innerWidth / 2), Math.round((1 - vs.y) * innerHeight / 2)] : null;
  const s = sim.summary();
  return { t: s.time - t0, tod: s.timeOfDay, hdgDeg: +hdgDeg.toFixed(1), pts, summit, exposure, sun: [Math.round((sd.x + 1) * innerWidth / 2), Math.round((1 - sd.y) * innerHeight / 2), sd.z < 1], dayFactor: sim.ctx.sky.dayFactor, sunElev: +(Math.asin(sim.ctx.sky.sunDir.y) * 57.3).toFixed(1) };
})()`;

const lum = (img, x, y) => {
  const i = (y * img.width + x) * 4;
  const c = (k) => { const s = img.data[i + k] / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * c(0) + 0.7152 * c(1) + 0.0722 * c(2);
};

/** Mean luminance of the pixels in [x0, x1) x [y0, y1), clipped to the image; null when nothing is left. */
const boxLum = (img, x0, x1, y0, y1) => {
  let a = 0, n = 0;
  for (let y = Math.max(0, y0); y < Math.min(img.height, y1); y++)
    for (let x = Math.max(0, x0); x < Math.min(img.width, x1); x++) {
      a += lum(img, x, y);
      n++;
    }
  return n ? a / n : null;
};

export async function sweep({ flags, shot, tracks = [20], across = {}, safari = { trackDeg: 20, across: 3220 } }) {
  const tods = String(flags.tods ?? '17.8,18.3,18.6,19.0,19.4').split(',').map(Number);
  const times = String(flags.times ?? '2,12').split(',').map(Number);
  const out = resolve(flags.out ?? 'work/sweep');
  mkdirSync(out, { recursive: true });
  const SAFARI = safari;
  const rows = [];
  for (const track of tracks)
    for (const tod of tods)
      for (const t of times) {
        // SAFARI's own track flies the default boot (its pinned across); any other re-solves across.
        const acr = track === SAFARI.trackDeg ? SAFARI.across : across[track] ?? SAFARI.across;
        const pose = track === SAFARI.trackDeg ? null : { track, across: acr };
        const file = join(out, `wp0a-sweep-${tod}-${track}-${t}.png`);
        const r = shot(`index.html?era=cretaceous&ui=0&mute=1&resume=0&tod=${tod}`, file, EVAL(t, pose));
        const img = readPng(file);
        let herd = 0, ground = 0, n = 0;
        for (const [x, y] of r.pts) {
          if (x < 18 || y < 18 || x >= img.width - 18 || y >= img.height - 18) continue;
          let a = 0, b = 0, na = 0, nb = 0;
          for (let dy = -16; dy <= 16; dy++)
            for (let dx = -16; dx <= 16; dx++) {
              const d = Math.hypot(dx, dy);
              if (d <= 1.5) { a += lum(img, x + dx, y + dy); na++; }
              else if (d >= 10 && d <= 16) { b += lum(img, x + dx, y + dy); nb++; }
            }
          herd += a / na;
          ground += b / nb;
          n++;
        }
        const ratio = n ? Math.max(herd, ground) / Math.max(1e-6, Math.min(herd, ground)) : null;
        // The cone region: a box on the flank just below the summit vs the sky just above it.
        let cone = null, sky = null;
        if (r.summit) {
          const [sx, sy] = r.summit;
          cone = boxLum(img, sx - 12, sx + 13, sy + 12, sy + 40);
          sky = boxLum(img, sx - 12, sx + 13, sy - 40, sy - 15);
        }
        const coneContrast = cone !== null && sky !== null ? Math.max(cone, sky) / Math.max(1e-6, Math.min(cone, sky)) : null;
        const sunX = r.sun[2] ? r.sun[0] : null; // [x, y, in front of the eye]
        const central60 = sunX !== null && Math.abs(sunX - img.width / 2) < 0.3 * img.width;
        const central40 = sunX !== null && Math.abs(sunX - img.width / 2) < 0.2 * img.width;
        const row = {
          tod, track, across: Math.round(acr), t, hdgDeg: r.hdgDeg, members: n,
          herdLum: n ? +(herd / n).toFixed(4) : null, groundLum: n ? +(ground / n).toFixed(4) : null, contrast: ratio && +ratio.toFixed(2),
          summit: r.summit, coneLum: cone === null ? null : +cone.toFixed(4), skyLum: sky === null ? null : +sky.toFixed(4), coneContrast: coneContrast && +coneContrast.toFixed(2),
          exposure: r.exposure, sun: r.sun, sunElev: r.sunElev, sunInCentral60: central60, sunInCentral40: central40, dayFactor: +r.dayFactor.toFixed(2), file,
        };
        rows.push(row);
        console.log(JSON.stringify(row));
      }
  // The tod x track table at each time: herd / ground and cone / sky contrast.
  for (const t of times) {
    console.log(`\nt ${t} s: herd/ground | cone/sky contrast (sun in central 40 %: *)`);
    console.log(`  tod   ${tracks.map((k) => `track ${k}`.padEnd(17)).join('')}`);
    for (const tod of tods)
      console.log(`  ${String(tod).padEnd(5)} ${tracks.map((k) => { const x = rows.find((q) => q.t === t && q.tod === tod && q.track === k); return `${x?.contrast ?? '-'} | ${x?.coneContrast ?? '-'}${x?.sunInCentral40 ? '*' : ''}`.padEnd(17); }).join('')}`);
  }
  return rows;
}
