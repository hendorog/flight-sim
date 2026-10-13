// scripts/shot-era.mjs plugin: the understorey shots (owner: WP6, Deep Time increment 2).
// Contract (see shot-era.mjs's header): export default (h) => [{ name, label, page, evalJs?, wait? }, ...], names
// unique across all plugins; h.CRET, h.DEFAULT_BOOT, h.timed(body), h.AT_FRAME('G3'), h.SAFARI_AT(ms), ... .
// Run just these: node scripts/shot-era.mjs --plugins understorey --only <name,...> --out <dir>
//
// Every frame comes as an A/B pair: '<name>' with the speckle and '<name>-off' with ?eraoff=speckle.
//   us-1000ft / us-500ft  the cockpit, 1000 / 500 ft over the floodplain beside the river herd's site, flying down
//                         the valley with the river and its marsh band in the left door window (paused there), at the
//                         default boot's dusk (no tod: the safari's SAFARI.tod); the -1000 variants at tod 10
//   us-G7                 the default boot at the first minute's G7 frame (cockpit, the speckled marsh below)
//   us-overview           dev/terrain.html, 1000 ft over the river herd's site looking along the river (tod 10)

/** Cockpit over the floodplain: `agl` m above the ground, 400 m right of the river herd's site, heading 225. */
const OVER_MARSH = (agl) => `
  const A = await import('/src/world/era/cretaceousAnchors.ts');
  const site = A.RIVER_HERD_SITE, hdg = 225 * Math.PI / 180, right = hdg + Math.PI / 2;
  const n = site.north + 400 * Math.cos(right), e = site.east + 400 * Math.sin(right);
  const base = sim.physics.scenario;
  sim.physics.resetTo({ ...base, engageAutoflight: false, ic: { ...base.ic, position: { x: n, y: e, z: -(site.ground + ${agl}) }, heading: hdg, airspeed: 55, onGround: false } });
  await sleep(1500);
  sim.pause(true);
  await sleep(1200);
  const s = sim.summary();
  return { label: ' agl ' + Math.round(s.altitudeAGL / 0.3048) + ' ft, tod ' + s.timeOfDay.toFixed(2), agl: s.altitudeAGL, tod: s.timeOfDay };`;

export default function shots(h) {
  const list = [];
  const pair = (name, label, page, evalJs, wait) => {
    list.push({ name, label: `${label} (speckle)`, page, evalJs, wait });
    list.push({ name: `${name}-off`, label: `${label} (eraoff=speckle)`, page: `${page}&eraoff=speckle`, evalJs, wait });
  };
  pair('us-1000ft', 'Understorey: cockpit 1000 ft over the marsh, dusk', `${h.CRET}&ui=0`, h.timed(OVER_MARSH(305)), 0);
  pair('us-500ft', 'Understorey: cockpit 500 ft over the marsh, dusk', `${h.CRET}&ui=0`, h.timed(OVER_MARSH(152)), 0);
  pair('us-1000ft-1000', 'Understorey: cockpit 1000 ft over the marsh, tod 10', `${h.CRET}&ui=0&tod=10`, h.timed(OVER_MARSH(305)), 0);
  pair('us-500ft-1000', 'Understorey: cockpit 500 ft over the marsh, tod 10', `${h.CRET}&ui=0&tod=10`, h.timed(OVER_MARSH(152)), 0);
  pair('us-G7', 'Understorey: default boot, G7', h.DEFAULT_BOOT, h.timed(h.AT_FRAME('G7')), 0);
  pair('us-overview', 'Understorey: 1000 ft over the river herd site, along the river, tod 10', 'dev/terrain.html?era=cretaceous&cam=-2100,3900,470&look=-1622,4315,164&tod=10&freeze=1', undefined, 3000);
  return list;
}
