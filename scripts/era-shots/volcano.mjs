// scripts/shot-era.mjs plugin: the volcano shots (owner: WP5, Deep Time increment 2): the plume and the lava.
// Contract (see shot-era.mjs's header): export default (h) => [{ name, label, page, evalJs?, wait? }, ...], names
// unique across all plugins; h.CRET, h.DEFAULT_BOOT, h.timed(body), h.AT_FRAME('G3'), h.SAFARI_AT(ms), ... .
// Run just these: node scripts/shot-era.mjs --plugins volcano --only <name,...> --out <dir>
//
//   plume-G1, plume-G7  the default boot (safari, cockpit) at the first-minute frames G1 and G7
//   plume-1000          tod 10, line-up 25 on the Flats (chase): the plume against a blue sky
//   plume-backlit       tod 19.6, the same line-up: the cone and plume against the low sun
//   lava-2200           night (tod 22), chase view of the aircraft 8 km south-west of the vent, flying toward it
//                       (the lobes are on the W / SW flanks)
//   lava-close          night (tod 22), a fixed camera 2.3 km south-west of the crater and 400 m above the rim, in
//                       the full sim (dev/terrain.html has a fixed exposure that cannot show a night glow)
//   plume-haze          tod 10, a fixed camera 40 km east of the vent, 600 m MSL: the plume through the haze

// The vent: NED (2000, -17500), crater floor 2440 m MSL (src/world/era/cretaceous.ts).
const VN = 2000;
const VE = -17500;

/** The 07 line-up from the runway scenario's start, turned round to LINE_UP 25 (as shot-era.mjs LINEUP_25). */
const LINEUP_25 = `
  const base = sim.physics.scenario, h = base.ic.heading, p = base.ic.position, L = 1760;
  sim.physics.resetTo({ ...base, ic: { ...base.ic, position: { x: p.x + L * Math.cos(h), y: p.y + L * Math.sin(h), z: p.z }, heading: h + Math.PI } });
  await sleep(2500);
  return { heading: sim.summary().headingDeg };`;

/** The aircraft 8 km south-west of the vent at 2000 m MSL, flying hands-off toward it; chase camera. */
const LAVA_CHASE = `
  const base = sim.physics.scenario, d = 8000, b = 225 * Math.PI / 180;
  const n = ${VN} + d * Math.cos(b), e = ${VE} + d * Math.sin(b);
  sim.physics.resetTo({ ...base, engageAutoflight: false, ic: { ...base.ic, position: { x: n, y: e, z: -2000 }, heading: Math.PI / 4, airspeed: 55, onGround: false } });
  sim.setCamera('chase');
  await sleep(4000);
  const s = sim.summary();
  return { label: ' dist ' + Math.round(Math.hypot(s.north - ${VN}, s.east - ${VE})) + ' m, alt ' + Math.round(s.altitudeMSL) + ' m' };`;

const SETTLE = `await sleep(3000); return {};`;

export default function shots(h) {
  return [
    { name: 'plume-G1', label: 'Plume, default boot, G1 (cockpit)', page: h.DEFAULT_BOOT, evalJs: h.timed(h.AT_FRAME('G1')), wait: 0 },
    { name: 'plume-G7', label: 'Plume, default boot, G7 (cockpit)', page: h.DEFAULT_BOOT, evalJs: h.timed(h.AT_FRAME('G7')), wait: 0 },
    { name: 'plume-1000', label: 'Plume, tod 10, line-up 25 (chase)', page: `${h.CRET}&scenario=runway&tod=10&cam=chase&ui=0`, evalJs: h.timed(LINEUP_25), wait: 500 },
    { name: 'plume-backlit', label: 'Plume, tod 19.6, line-up 25 (chase, backlit)', page: `${h.CRET}&scenario=runway&tod=19.6&cam=chase&ui=0`, evalJs: h.timed(LINEUP_25), wait: 500 },
    { name: 'lava-2200', label: 'Lava, tod 22, chase 8 km SW of the vent', page: `${h.CRET}&tod=22&ui=0`, evalJs: h.timed(LAVA_CHASE), wait: 0 },
    {
      name: 'lava-close',
      label: 'Lava, tod 22, crater and lobes from 2.3 km SW',
      page: `${h.CRET}&tod=22&ui=0&camPos=200,-19000,3000&camLook=${VN},${VE},2440`,
      evalJs: h.timed(SETTLE),
      wait: 0,
    },
    { name: 'plume-haze', label: 'Plume, tod 10, from 40 km east', page: `${h.CRET}&tod=10&ui=0&camPos=${VN},${VE + 40000},600&camLook=${VN},${VE},3600`, evalJs: h.timed(SETTLE), wait: 0 },
  ];
}
