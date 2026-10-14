// scripts/shot-era.mjs plugin: fauna across the landscape (Deep Time increment 2b, P1).
// Contract (see shot-era.mjs's header): export default (h) => [{ name, label, page, evalJs?, wait? }, ...].
// Run just these: node scripts/shot-era.mjs --plugins landscape --out <dir> [--only <name,...>]
//
// The habitat streaming follows the CAMERA, so a fixed camera (camPos / camLook, NED m, alt MSL) populates any point
// with no teleport. Each verification point (plan section 9) is shot twice, at tod 10 (the default 20.0 start is
// untouched):
//   landscape-V<k>        the wide view from camPos after >= 30 s of sim time; the label lists the herds within
//                         10 km by species (count, nearest distance) and the roaming T. rexes
//   landscape-V<k>-near   the camera re-aimed (sim.setFixedCamera) at the nearest herd of the point's target species
//   landscape-rex (V6)    a roaming T. rex beside its prey herd (the far-east plains, where rexRandom puts eligible
//                         prey; it needs no P2 to be placed), over its shoulder toward the herd
//   landscape-rex-pass    then a pass on the autoflight hold 300 m abeam of the herd at 150 m, shot side-on at
//                         closest approach. The hunt itself (stalk, charge, stampede) needs P2's ambient brain:
//                         before P2 the T. rex just lurks.

const PAGE = (h, cam, look) => `${h.CRET}&ui=0&tod=10&scenario=runway&camPos=${cam.join(',')}&camLook=${look.join(',')}`;

/** The streamed animals near the camera: herds by species within 10 km (count, nearest), roaming T. rexes. */
const CENSUS = `
  await until(() => sim.summary().time > 32, 300000);
  const R = await import('/src/world/fauna/roster.ts');
  const entries = R.ROSTERS.cretaceous.entries;
  const cam = sim.ctx.camera.position, camN = -cam.z, camE = cam.x;
  const herds = [];
  for (let k = 0; k < H.capacity; k++) {
    if (!H.active[k]) continue;
    const d = Math.hypot(H.cN[k] - camN, H.cE[k] - camE);
    if (d > 10000) continue;
    const e = entries[H.entry[k]];
    herds.push({ h: k, species: e.species + (e.habitat === 'plain' ? ' (plains)' : ''), sp: e.species, size: H.size[k], d: Math.round(d), pinned: H.pinned[k], n: Math.round(H.cN[k]), e: Math.round(H.cE[k]) });
  }
  herds.sort((a, b) => a.d - b.d);
  const A = f.agents, rex = [];
  for (let i = 0; i < A.capacity; i++) if (A.active[i] && f.ambientAgent[i]) rex.push({ i, n: Math.round(A.n[i]), e: Math.round(A.e[i]), d: Math.round(Math.hypot(A.n[i] - camN, A.e[i] - camE)), herd: f.agentHerd[i], state: A.state[i] });
  const by = {};
  for (const x of herds) { const b = (by[x.species] ??= { herds: 0, animals: 0, nearest: x.d }); b.herds++; b.animals += x.size; }
  const census = Object.entries(by).map(([k, v]) => k + ' ' + v.herds + 'x/' + v.animals + ' @' + (v.nearest / 1000).toFixed(1) + 'km').join(', ');`;

const WIDE = `${CENSUS}
  return { herds, rex, by, label: ' [' + census + (rex.length ? '; T. rex ' + rex.map((r) => (r.d / 1000).toFixed(1) + 'km').join(', ') : '') + ']' };`;

/** Re-aim at the nearest unpinned herd of `target`: 4 radii + 60 m off (from the camera's side), 30-60 m up. */
const NEAR = (target) => `${CENSUS}
  const t = herds.find((x) => x.sp === '${target}' && !x.pinned) ?? herds.find((x) => x.sp === '${target}');
  if (!t) return { herds, label: ' [no ${target} within 10 km: ' + census + ']' };
  const h = t.h, cn = H.cN[h], ce = H.cE[h], ch = H.cH[h];
  const big = '${target}' === 'alamosaurus';
  const off = Math.min(320, Math.max(110, 1.6 * H.radius[h] + 60)) * (big ? 1.4 : 1);
  const a = Math.atan2(camE - ce, camN - cn) + 0.4;
  const pos = [cn + off * Math.cos(a), ce + off * Math.sin(a), ch + (big ? 55 : 30)];
  sim.setFixedCamera(pos, [cn, ce, ch + (big ? 8 : 2)]);
  await sleep(3500);
  const c2 = sim.ctx.camera.position;
  return { target: t, off: Math.round(off), radius: Math.round(H.radius[h]), camAt: [Math.round(-c2.z), Math.round(c2.x), Math.round(c2.y)], herdNow: [Math.round(H.cN[h]), Math.round(H.cE[h])], label: ' [' + t.species + ' x' + t.size + ' at ' + t.n + ', ' + t.e + ' (' + (t.d / 1000).toFixed(1) + ' km from V); ' + census + ']' };`;

/** V6: find a roaming T. rex and its herd (after the streaming), and the framing beside them. */
const FIND_REX = `${CENSUS}
  await until(() => { for (let i = 0; i < f.agents.capacity; i++) if (f.ambientAgent[i]) return true; return false; }, 90000);
  let i = -1;
  for (let k = 0; k < f.agents.capacity; k++) if (f.ambientAgent[k]) { i = k; break; }
  if (i < 0) return { label: ' [no roaming T. rex: ' + census + ']' };
  const h = f.agentHerd[i];
  const cn = H.cN[h], ce = H.cE[h], ch = H.cH[h];
  // Side-on to the T. rex - herd line, 240 m off its midpoint, 35 m up: both in the frame.
  const frame = () => {
    const mn = (A.n[i] + H.cN[h]) / 2, me = (A.e[i] + H.cE[h]) / 2;
    const ln = H.cN[h] - A.n[i], le = H.cE[h] - A.e[i], l = Math.hypot(ln, le) || 1;
    sim.setFixedCamera([mn - 240 * le / l, me + 240 * ln / l, ch + 35], [mn, me, ch + 6]);
  };
  const what = () => entries[H.entry[h]].species + ' x' + H.size[h] + ', T. rex ' + Math.round(Math.hypot(A.n[i] - H.cN[h], A.e[i] - H.cE[h])) + ' m from it';`;

const REX = `${FIND_REX}
  // Over the T. rex's shoulder toward its herd: 30 m behind it, 12 m to the side, 9 m up.
  const ln = H.cN[h] - A.n[i], le = H.cE[h] - A.e[i], l = Math.hypot(ln, le) || 1;
  sim.setFixedCamera([A.n[i] - 30 * ln / l - 12 * le / l, A.e[i] - 30 * le / l + 12 * ln / l, A.h[i] + 9], [H.cN[h], H.cE[h], H.cH[h] + 3]);
  await sleep(3500);
  return { rexSlot: i, herd: h, rexToHerdHome: Math.round(Math.hypot(A.homeN[i] - H.homeN[h], A.homeE[i] - H.homeE[h])), label: ' [' + what() + ' (tod 10)]' };`;

/** The pass: from 5 km out, 300 m abeam of the herd on the side away from the T. rex, 150 m above it, on the hold. */
const REX_PASS = `${FIND_REX}
  const rxN = H.cN[h] - A.n[i], rxE = H.cE[h] - A.e[i], rxL = Math.hypot(rxN, rxE) || 1;
  const hdg = Math.atan2(rxE, rxN) + Math.PI / 2;
  const an = cn + 300 * rxN / rxL, ae = ce + 300 * rxE / rxL;
  const sn = an - 5000 * Math.cos(hdg), se = ae - 5000 * Math.sin(hdg);
  const base = sim.physics.scenario;
  sim.physics.resetTo({ ...base, id: 'safari', ic: { ...base.ic, position: { x: sn, y: se, z: -(ch + 150) }, heading: hdg, onGround: false, engineRunning: true }, autoflight: { kind: 'hold', heading: hdg, altitude: ch + 150, kias: 110 } });
  sim.setAutoflight(true);
  sim.setCamera('chase');
  const states = [];
  await until(() => {
    const s = sim.summary();
    if (states[states.length - 1] !== A.state[i]) states.push(A.state[i]);
    return Math.hypot(s.north - an, s.east - ae) < 150 || !A.active[i];
  }, 240000);
  frame();
  await sleep(1500);
  return { rexSlot: i, herd: h, states: states.join('>'), fleeing: H.fleeing[h], label: ' [' + what() + ', T. rex states ' + states.join('>') + ', herd fleeing ' + H.fleeing[h] + ' (the hunt needs P2)]' };`;

/** The verification points (plan section 9): camera, look-at, the shot's target species. */
const V = [
  { id: 'V1', place: 'river floodplain SW', cam: [-12900, -12600, 420], look: [-14301, -13749, 110], target: 'edmontosaurus' },
  { id: 'V2', place: 'lake east + upland Araucaria edge', cam: [10600, 4300, 720], look: [13106, 6726, 660], target: 'alamosaurus' },
  { id: 'V3', place: 'southern coastal plain', cam: [-17200, 4800, 520], look: [-19498, 6474, 220], target: 'triceratops' },
  { id: 'V4', place: 'lake west', cam: [4600, -7000, 560], look: [5225, -9180, 240], target: 'edmontosaurus' },
  { id: 'V5', place: 'far-east interior', cam: [-3800, 9800, 460], look: [-5625, 11330, 220], target: 'triceratops' },
];
/**
 * Where rexRandom's salt puts T. rex-eligible prey herds (two Edmontosaurus plains herds, north and south of the
 * camera). It looks east while they stream in: a roaming T. rex is never placed in view within 2.5 km.
 */
const VREX = { cam: [-15000, 21000, 500], look: [-15000, 25000, 150] };

export default function shots(h) {
  const list = [];
  for (const v of V) {
    list.push({ name: `landscape-${v.id}`, label: `${v.id} ${v.place}, wide (tod 10)`, page: PAGE(h, v.cam, v.look), evalJs: h.timed(WIDE), wait: 0, timeout: 400000 });
    list.push({ name: `landscape-${v.id}-near`, label: `${v.id} nearest ${v.target}`, page: PAGE(h, v.cam, v.look), evalJs: h.timed(NEAR(v.target)), wait: 0, timeout: 400000 });
  }
  list.push({ name: 'landscape-rex', label: 'V6 roaming T. rex beside its prey herd (far-east plains)', page: PAGE(h, VREX.cam, VREX.look), evalJs: h.timed(REX), wait: 0, timeout: 600000 });
  list.push({ name: 'landscape-rex-pass', label: 'V6 the pass 300 m abeam at 150 m (hunt: after P2 merges)', page: PAGE(h, VREX.cam, VREX.look), evalJs: h.timed(REX_PASS), wait: 0, timeout: 600000 });
  return list;
}
