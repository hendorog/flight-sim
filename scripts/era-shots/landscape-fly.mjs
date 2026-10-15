// scripts/shot-era.mjs plugin: fly past the animals away from the start (Deep Time increment 2b, merge gate).
// Contract (see shot-era.mjs's header): export default (h) => [{ name, label, page, evalJs?, wait? }, ...].
// Run just these: node scripts/shot-era.mjs --plugins landscape-fly --out <dir> [--only <name,...>]
//
// Each verification point of scripts/era-shots/landscape.mjs (plan section 9, V1-V5) plus VR (the far-east plains
// where roaming T. rexes stream) is flown, not just looked at from a fixed camera:
//   1. the page boots with a fixed camera at the point (camPos / camLook: the streaming follows the camera) and
//      waits 32 s of sim time, so the habitat cells around it are streamed;
//   2. it picks the nearest unpinned herd of the point's target species (VR: the herd a roaming T. rex shadows);
//   3. it resets the aircraft (the era-perf SAFARI14 recipe) 4 km out on the camera's side, on a track that passes
//      160 m abeam of the herd (herd ahead-left), 100 m above it (higher if the ground on the way is), on the autoflight hold, and switches to the cockpit or
//      chase view (which also drops the fixed camera: the streaming follows the aircraft from then on);
//   4. it shoots when the herd is `stop` degrees off the nose (cockpit 24, chase 24), or < 150 m ahead.
// The eval returns the herds and the roaming T. rexes within 3 km of the aircraft at the shot (fauna census).
// Names: landscape-fly-<V>-<view><tod>, e.g. landscape-fly-V3-cockpit20. tod 20 is the default start's time of day
// (fixed: clock=0).

const PAGE = (h, cam, look, tod) => `${h.CRET}&ui=0&tod=${tod}&scenario=runway&camPos=${cam.join(',')}&camLook=${look.join(',')}`;

const FLY = (target, view, stop) => `
  await until(() => sim.summary().time > 32, 300000);
  const R = await import('/src/world/fauna/roster.ts');
  const entries = R.ROSTERS.cretaceous.entries;
  const A = f.agents;
  const cam0 = sim.ctx.camera.position, c0n = -cam0.z, c0e = cam0.x;
  const census = (pn, pe, r) => {
    const herds = [];
    for (let k = 0; k < H.capacity; k++) {
      if (!H.active[k]) continue;
      const d = Math.hypot(H.cN[k] - pn, H.cE[k] - pe);
      if (d > r) continue;
      const e = entries[H.entry[k]];
      herds.push({ h: k, species: e.species + (e.habitat === 'plain' ? ' (plains)' : ''), sp: e.species, size: H.size[k], d: Math.round(d), pinned: H.pinned[k] });
    }
    herds.sort((a, b) => a.d - b.d);
    const rex = [];
    for (let i = 0; i < A.capacity; i++) if (A.active[i] && f.ambientAgent[i]) {
      const d = Math.hypot(A.n[i] - pn, A.e[i] - pe);
      if (d <= r) rex.push({ i, d: Math.round(d), herd: f.agentHerd[i], state: A.state[i] });
    }
    return { herds, rex };
  };
  const at0 = census(c0n, c0e, 10000);
  let h = -1, rexSlot = -1;
  if ('${target}' === 'rexprey') {
    for (let i = 0; i < A.capacity; i++) if (A.active[i] && f.ambientAgent[i]) { rexSlot = i; h = f.agentHerd[i]; break; }
    if (h < 0) {
      await until(() => { for (let i = 0; i < A.capacity; i++) if (A.active[i] && f.ambientAgent[i]) return true; return false; }, 90000);
      for (let i = 0; i < A.capacity; i++) if (A.active[i] && f.ambientAgent[i]) { rexSlot = i; h = f.agentHerd[i]; break; }
    }
  } else {
    const t = at0.herds.find((x) => x.sp === '${target}' && !x.pinned);
    if (t) h = t.h;
  }
  if (h < 0) return { label: ' [no ${target} near the point]', at0 };
  const hn = H.cN[h], he = H.cE[h], hh = H.cH[h];
  // From the camera's side (VR: the side away from the T. rex, so it charges across the view).
  let a = Math.atan2(c0e - he, c0n - hn);
  if (rexSlot >= 0) a = Math.atan2(he - A.e[rexSlot], hn - A.n[rexSlot]) + 0.5;
  // The track passes ABEAM: 160 m to the herd's right as flown, so the herd is ahead-left (the pilot's side) and
  // not under the glareshield.
  const hdg = a + Math.PI;
  const rn = Math.cos(hdg + Math.PI / 2), re = Math.sin(hdg + Math.PI / 2);
  const pn = hn + 160 * rn, pe = he + 160 * re;
  const sn = pn + 4000 * Math.cos(a), se = pe + 4000 * Math.sin(a);
  let top = hh;
  for (let s = 0; s <= 4000; s += 100) top = Math.max(top, f.terrain.height(pn + s * Math.cos(a), pe + s * Math.sin(a)));
  const alt = Math.max(hh + 100, top + 70);
  const base = sim.physics.scenario;
  sim.physics.resetTo({ ...base, id: 'safari', ic: { ...base.ic, position: { x: sn, y: se, z: -alt }, heading: hdg, airspeed: 56.6, onGround: false, engineRunning: true }, autoflight: { kind: 'hold', heading: hdg, altitude: alt, kias: 110 } });
  sim.setAutoflight(true);
  sim.setCamera('${view}');
  const states = [];
  await until(() => {
    const s = sim.summary();
    if (rexSlot >= 0 && states[states.length - 1] !== A.state[rexSlot]) states.push(A.state[rexSlot]);
    // The herd's bearing off the nose as flown (wind drift and a herd on the move change the abeam distance): shoot
    // when it is \`stop\` degrees off the nose, or once it is less than 150 m ahead along the track.
    const dn = H.cN[h] - s.north, de = H.cE[h] - s.east;
    const along = dn * Math.cos(hdg) + de * Math.sin(hdg), across = -dn * Math.sin(hdg) + de * Math.cos(hdg);
    return Math.abs(Math.atan2(across, along)) * 180 / Math.PI > ${stop} || along < 150 || !H.active[h];
  }, 240000);
  await sleep(300);
  const s = sim.summary();
  // Where the target herd is in the frame (px of the 1600x900 shot; z > 1: behind the camera).
  const cam = sim.ctx.camera, v = cam.position.clone().set(H.cE[h], H.cH[h] + 2, -H.cN[h]).project(cam);
  const px = [Math.round((v.x + 1) * 800), Math.round((1 - v.y) * 450), +v.z.toFixed(4)];
  const near = census(s.north, s.east, 3000);
  const by = {};
  for (const x of near.herds) { const b = (by[x.species] ??= { herds: 0, animals: 0, nearest: x.d }); b.herds++; b.animals += x.size; }
  const txt = Object.entries(by).map(([k, v]) => k + ' ' + v.herds + 'x/' + v.animals + ' @' + (v.nearest / 1000).toFixed(1) + 'km').join(', ');
  const tgt = entries[H.entry[h]];
  return {
    target: { h, species: tgt.species, habitat: tgt.habitat ?? 'waterside', size: H.size[h], n: Math.round(hn), e: Math.round(he) },
    aircraft: { n: Math.round(s.north), e: Math.round(s.east), alt: Math.round(alt), agl: Math.round(alt - hh), hdg: Math.round(hdg * 180 / Math.PI) },
    px, rexStates: states.join('>'), fleeing: H.fleeing[h], within3km: near, debug: { ...f.debug },
    label: ' [' + tgt.species + ' x' + H.size[h] + ' at px ' + px[0] + ',' + px[1] + '; within 3 km: ' + (txt || 'none') + (near.rex.length ? '; T. rex ' + near.rex.map((r) => (r.d / 1000).toFixed(1) + 'km st' + r.state).join(', ') : '') + (states.length ? '; rex ' + states.join('>') + ', fleeing ' + H.fleeing[h] : '') + ']',
  };`;

const V = [
  { id: 'V1', place: 'river floodplain SW', cam: [-12900, -12600, 420], look: [-14301, -13749, 110], target: 'edmontosaurus' },
  { id: 'V2', place: 'lake east uplands', cam: [10600, 4300, 720], look: [13106, 6726, 660], target: 'alamosaurus' },
  { id: 'V3', place: 'southern coastal plain', cam: [-17200, 4800, 520], look: [-19498, 6474, 220], target: 'triceratops' },
  { id: 'V4', place: 'lake west', cam: [4600, -7000, 560], look: [5225, -9180, 240], target: 'edmontosaurus' },
  { id: 'V5', place: 'far-east interior', cam: [-3800, 9800, 460], look: [-5625, 11330, 220], target: 'triceratops' },
  { id: 'VR', place: 'far-east plains, roaming T. rex', cam: [-15000, 21000, 500], look: [-15000, 25000, 150], target: 'rexprey' },
];

export default function shots(h) {
  const list = [];
  for (const v of V) {
    // tod 20 (the default start's time of day) from the cockpit and the chase view, and a tod 10 daylight read.
    for (const [view, tod, stop] of [['cockpit', 20, 24], ['chase', 20, 24], ['chase', 10, 24]]) {
      list.push({
        name: `landscape-fly-${v.id}-${view}${tod}`,
        label: `${v.id} ${v.place}, ${view}, tod ${tod}`,
        page: PAGE(h, v.cam, v.look, tod),
        evalJs: h.timed(FLY(v.target, view, stop)),
        wait: 0,
        timeout: 600000,
      });
    }
  }
  return list;
}
