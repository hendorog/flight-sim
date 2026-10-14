// scripts/shot-era.mjs plugin: the ambient (roaming) T. rex hunt away from the safari start (Deep Time inc 2b, P2).
// Contract (see shot-era.mjs's header): export default (h) => [{ name, label, page, evalJs?, wait?, timeout? }, ...].
// Run just these: node scripts/shot-era.mjs --plugins ambient-rex --out <dir>
//
// Self-contained (it does not depend on the habitat streaming placing a T. rex): at an away point on the SW river
// floodplain near V1 (~22 km from the safari start) the page spawns its own unpinned prey herd (an Edmontosaurus
// herd, or a Triceratops group) and a T. rex 380 m from it with brainFor('tyrannosaurus') - an ambient agent (its
// home is far from the lair). A fixed camera near the site at boot keeps both inside the streaming radius. The
// aircraft then flies the era-perf SAFARI14 recipe (resetTo + the autoflight hold) on a straight pass from 5 km out,
// 150 m above the herd and 300 m abeam, at 110 kt.
//
//   ambient-rex-charge-fixed   3 s into the charge, a fixed camera beside the herd
//   ambient-rex-charge-chase   3 s into the charge, the chase camera (the herd ahead and to the left)
//   ambient-rex-pass-fixed     at the closest approach, a fixed camera beside the herd (the stampede, the aircraft)
//   ambient-rex-pass-chase     450 m before the closest approach, the chase camera (the herd ~35 deg off the nose)
//   ambient-rex-tri-standoff   Triceratops prey: the T. rex pulled up at the stand-off (roaring), the group facing it

/** The away site: dry, level floodplain 1.2 km from the river, 1.9 km from the V1 camera (searched on the terrain). */
const SITE = { n: -12750, e: -14500 };
const PAGE = (h) => `${h.CRET}&ui=0&tod=10&scenario=runway&camPos=-12900,-12600,420&camLook=${SITE.n},${SITE.e},170`;

/** The scene and the pass; `at` = 'charge' (charge + 3 s), 'pass' (closest approach) or 'standoff'; cam 'fixed' | 'chase'. */
const BODY = (species, at, cam) => `
  const hf = await import('/src/world/terrain/heightfield.ts');
  const B = await import('/src/world/fauna/brains.ts');
  const RO = await import('/src/world/fauna/roster.ts');
  const A = f.agents;
  await until(() => sim.summary().time > 4, 60000);
  const entries = RO.ROSTERS.cretaceous.entries;
  const entryOf = (sp) => entries.findIndex((x) => x.species === sp);
  const S = hf.makeSample();
  const HN = ${SITE.n}, HE = ${SITE.e};
  const g = hf.sampleTerrain(HN, HE, S).ground;
  // The pass heading: the first (of 12) whose 5 km run-in stays >= 70 m below the hold altitude.
  const D = Math.PI / 180;
  const pass = (hd) => { let hi = -Infinity; for (let s = -5200; s <= 1500; s += 100) { const x = hf.sampleTerrain(HN + s * Math.cos(hd) - 300 * Math.sin(hd), HE + s * Math.sin(hd) + 300 * Math.cos(hd), S); hi = Math.max(hi, x.ground, x.standing); } return hi; };
  let hdg = 60 * D;
  for (let k = 0; k < 12; k++) { const hd = (60 + 30 * k) * D; if (pass(hd) < g + 80) { hdg = hd; break; } }
  // The prey herd (unpinned, a unique seed) and the T. rex 380 m away (430 m from Triceratops), on the far side of
  // the herd from the track, at the first dry bearing.
  const H_ = H;
  const prey = H_.spawn({ north: HN, east: HE, ground: g, size: ${species === 'triceratops' ? 7 : 40}, entry: Math.max(0, entryOf('${species}')), scale: 1, variant: 0, seed: 0x2b0a11 + ${species === 'triceratops' ? 7 : 0}, heading: hdg + 0.4, pinned: false, species: '${species}' }, -1);
  const dist = ${species === 'triceratops' ? 430 : 380};
  let rb = hdg - Math.PI / 2;
  for (let k = 0; k < 12; k++) {
    const b = hdg - Math.PI / 2 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 20 * D;
    let ok = true;
    for (let d = 0; d <= dist + 40 && ok; d += 20) { const x = hf.sampleTerrain(HN + d * Math.cos(b), HE + d * Math.sin(b), S); ok = x.riverDist - x.riverHalfWidth > 40 && x.ground > x.standing + 0.5; }
    if (ok) { rb = b; break; }
  }
  const rn = HN + dist * Math.cos(rb), re = HE + dist * Math.sin(rb);
  const rex = A.spawn({ species: 'tyrannosaurus', entry: Math.max(0, entryOf('tyrannosaurus')), north: rn, east: re, ground: hf.sampleTerrain(rn, re, S).ground, heading: Math.atan2(HE - re, HN - rn), scale: 1, variant: 0, seed: 0x2b0a5e }, B.brainFor('tyrannosaurus'));
  if (prey < 0 || rex < 0) return { label: ' (spawn failed: herd ' + prey + ', rex ' + rex + ')' };
  // The pass: SAFARI14's recipe (resetTo + the autoflight hold) with the hold's 110 kt as the initial airspeed (the
  // runway scenario's ic starts at rest), 5 km out, 300 m abeam.
  const sn = HN - 5000 * Math.cos(hdg) - 300 * Math.sin(hdg), se = HE - 5000 * Math.sin(hdg) + 300 * Math.cos(hdg);
  const alt = g + 150;
  const base = sim.physics.scenario;
  sim.physics.resetTo({ ...base, id: 'safari', ic: { ...base.ic, position: { x: sn, y: se, z: -alt }, heading: hdg, airspeed: 56.6, onGround: false, engineRunning: true }, autoflight: { kind: 'hold', heading: hdg, altitude: alt, kias: 110 } });
  sim.setCamera('chase');
  sim.setAutoflight(true);
  sim.post && sim.post.snapExposure && sim.post.snapExposure();
  const STATES = ['lurk', 'stalk', 'charge', 'roar', 'wander'];
  const acD = () => { const s = sim.summary(); return Math.hypot(s.north - H_.cN[prey], s.east - H_.cE[prey]); };
  const log = {};
  const watch = () => { const st = STATES[A.state[rex]]; if (!(st in log)) log[st] = { t: +sim.summary().time.toFixed(1), km: +(acD() / 1000).toFixed(2) }; };
  const iv = setInterval(watch, 50);
  ${
    at === 'charge'
      ? `await until(() => A.state[rex] === 2, 200000); const tc = sim.summary().time; await until(() => sim.summary().time >= tc + 3, 20000);`
      : at === 'pass'
        ? `await until(() => { const s = sim.summary(); return (s.north - HN) * Math.cos(hdg) + (s.east - HE) * Math.sin(hdg) >= ${cam === 'chase' ? -450 : 0}; }, 260000);`
        : `await until(() => A.state[rex] === 3, 260000); await sleep(600);`
  }
  clearInterval(iv);
  watch();
  const s = sim.summary();
  // The nearest prey member and the T. rex.
  let near = Infinity, running = 0;
  for (let k = 0; k < H_.size[prey]; k++) { const i = prey * H_.memberCap + k; near = Math.min(near, Math.hypot(H_.mN[i] - A.n[rex], H_.mE[i] - A.e[rex])); if (H_.speed[i] > 2) running++; }
  ${
    cam === 'fixed'
      ? `const px = -Math.sin(hdg), pe = Math.cos(hdg);
  if (${at === 'pass'}) {
    // On the T. rex's side of the herd, behind it and up: the T. rex, the stampede beyond it and the aircraft
    // passing over the far side (the track is 300 m beyond the herd, the aircraft ~150 m up).
    const cn = H_.cN[prey], ce = H_.cE[prey], tn = A.n[rex], te = A.e[rex];
    const dn = cn - tn, de = ce - te, d = Math.hypot(dn, de) || 1;
    const ac = sim.summary();
    sim.setFixedCamera([tn - 140 * dn / d - 40 * de / d, te - 140 * de / d + 40 * dn / d, A.h[rex] + 55], [(cn + ac.north) / 2, (ce + ac.east) / 2, g + 40]);
  } else {
    // Above and behind the T. rex, looking past it at the herd (tyrannosaurus.mjs's trex-charge framing).
    const dn = H_.cN[prey] - A.n[rex], de = H_.cE[prey] - A.e[rex], d = Math.hypot(dn, de) || 1;
    sim.setFixedCamera([A.n[rex] - 70 * dn / d + 25 * de / d, A.e[rex] - 70 * de / d - 25 * dn / d, A.h[rex] + 40], [A.n[rex] + 0.55 * dn, A.e[rex] + 0.55 * de, H_.cH[prey]]);
  }
  await sleep(250);`
      : ''
  }
  sim.pause(true);
  await sleep(900);
  return { label: ' t ' + s.time.toFixed(1) + ': T. rex ' + STATES[A.state[rex]] + ' ' + A.speed[rex].toFixed(1) + ' m/s, nearest ' + Math.round(near) + ' m; herd fleeing ' + H_.fleeing[prey] + ' react ' + H_.react[prey] + ' running ' + running + '; aircraft ' + Math.round(acD()) + ' m, ' + Math.round(s.altitudeAGL) + ' m AGL', log, hdgDeg: Math.round(hdg / D), rexBearingDeg: Math.round(rb / D), ground: Math.round(g) };`;

export default function shots(h) {
  const T = 420000;
  return [
    { name: 'ambient-rex-charge-fixed', label: 'Ambient T. rex at V1: charge + 3 s (fixed camera)', page: PAGE(h), evalJs: h.timed(BODY('edmontosaurus', 'charge', 'fixed')), wait: 0, timeout: T },
    { name: 'ambient-rex-charge-chase', label: 'Ambient T. rex at V1: charge + 3 s (chase)', page: PAGE(h), evalJs: h.timed(BODY('edmontosaurus', 'charge', 'chase')), wait: 0, timeout: T },
    { name: 'ambient-rex-pass-fixed', label: 'Ambient T. rex at V1: closest approach (fixed camera)', page: PAGE(h), evalJs: h.timed(BODY('edmontosaurus', 'pass', 'fixed')), wait: 0, timeout: T },
    { name: 'ambient-rex-pass-chase', label: 'Ambient T. rex at V1: 450 m before closest approach (chase)', page: PAGE(h), evalJs: h.timed(BODY('edmontosaurus', 'pass', 'chase')), wait: 0, timeout: T },
    { name: 'ambient-rex-tri-standoff', label: 'Ambient T. rex at V1: Triceratops stand-off, the roar (fixed camera)', page: PAGE(h), evalJs: h.timed(BODY('triceratops', 'standoff', 'fixed')), wait: 0, timeout: T },
  ];
}
