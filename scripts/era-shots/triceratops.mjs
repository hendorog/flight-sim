// scripts/shot-era.mjs plugin: the Triceratops shots (owner: WP2, Deep Time increment 2).
// Contract (see shot-era.mjs's header): export default (h) => [{ name, label, page, evalJs?, wait? }, ...], names
// unique across all plugins; h.CRET, h.DEFAULT_BOOT, h.timed(body), h.AT_FRAME('G3'), h.SAFARI_AT(ms), ... .
// Run just these: node scripts/shot-era.mjs --plugins triceratops --only <name,...> --out <dir>
//
//   trike-gallery       the body and the walk cycle (dev/fauna.html strip), mid-morning light
//   trike-gallery-face  the hero facing a threat (head and horns down, frill presented), three-quarter front
//   trike-group         the showcase group of 7 at the safari's own light, a fixed camera 120 m off and 40 m up
//   trike-face          the same group 7 s after a predator-level threat 280 m off in the camera's direction: the
//                       group turns to face it (and the camera), frills presented, nobody runs
//   trike-G1, trike-G3  the default boot, cockpit, at the first-minute frames (FIRST_MINUTE_FRAMES)

/** The Triceratops group: the only 'face' herd (herds.ts REACTION_KIND.face = 1). */
const FIND_GROUP = `
  await until(() => H && H.count() > 0, 20000);
  let g = -1;
  for (let k = 0; k < H.capacity; k++) if (H.size[k] > 0 && H.kind[k] === 1) { g = k; break; }
  if (g < 0) return { group: false };
  const cn = H.cN[g], ce = H.cE[g], ch = H.cH[g];`;

/** Camera 120 m from the group (from the side the aircraft comes from), 40 m up, looking at its centre. */
const GROUP_CAMERA = `
  const s0 = sim.summary();
  const toAc = Math.atan2(s0.east - ce, s0.north - cn) + 0.5;
  const camN = cn + 115 * Math.cos(toAc), camE = ce + 115 * Math.sin(toAc);
  sim.setFixedCamera([camN, camE, ch + 40], [cn, ce, ch + 2]);`;

const members = `
  const ids = []; for (let k = 0; k < H.size[g]; k++) ids.push(g * H.memberCap + k);`;

const GROUP = `${FIND_GROUP}
  await sleep(2500);
  ${GROUP_CAMERA}
  await sleep(1200);
  ${members}
  return { group: true, size: H.size[g], label: ' (' + H.size[g] + ' animals, tod ' + sim.summary().timeOfDay.toFixed(2) + ')' };`;

const FACE = `${FIND_GROUP}
  await sleep(1500);
  ${GROUP_CAMERA}
  // A predator-level threat 280 m off toward the camera (beyond predatorFleeRange): they turn and stand.
  const dn = camN - cn, de = camE - ce, dl = Math.hypot(dn, de);
  const sn = cn + 280 * dn / dl, se = ce + 280 * de / dl;
  H.setExternalThreat(g, sn, se, 0, 0, H.time + 30, 2);
  ${members}
  let vmax = 0;
  const t0 = performance.now();
  while (performance.now() - t0 < 7000) { for (const i of ids) vmax = Math.max(vmax, H.speed[i]); await sleep(100); }
  let facing = 0;
  for (const i of ids) { let d = H.yaw[i] - Math.atan2(se - H.mE[i], sn - H.mN[i]); d = Math.atan2(Math.sin(d), Math.cos(d)); if (Math.abs(d) < 35 / 57.3) facing++; }
  return { group: true, react: H.react[g], facing, vmax, label: ' (' + facing + '/' + ids.length + ' within 35 deg, max speed ' + vmax.toFixed(2) + ' m/s)' };`;

export default function shots(h) {
  return [
    { name: 'trike-gallery', label: 'Triceratops: body and walk cycle (gallery, tod 10)', page: 'dev/fauna.html?species=triceratops&action=walk&freeze=1&t=1&tod=10', wait: 2500 },
    {
      name: 'trike-gallery-face',
      label: 'Triceratops: facing a threat (head and horns down, frill presented)',
      page: 'dev/fauna.html?species=triceratops&strip=0&action=face&freeze=1&t=0.2&tod=10&cam=-3,12,123&look=0,0.5,121.6',
      wait: 2500,
    },
    { name: 'trike-group', label: 'Triceratops group of 7 at the safari light, 120 m', page: `${h.CRET}&ui=0`, evalJs: h.timed(GROUP), wait: 0 },
    { name: 'trike-face', label: 'Triceratops group facing a threat (toward the camera), 120 m', page: `${h.CRET}&ui=0`, evalJs: h.timed(FACE), wait: 0 },
    { name: 'trike-G1', label: 'Default boot, cockpit, G1', page: h.DEFAULT_BOOT, evalJs: h.timed(h.AT_FRAME('G1')), wait: 0 },
    { name: 'trike-G3', label: 'Default boot, cockpit, G3', page: h.DEFAULT_BOOT, evalJs: h.timed(h.AT_FRAME('G3')), wait: 0 },
  ];
}
