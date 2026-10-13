// scripts/shot-era.mjs plugin: the Alamosaurus shots (owner: WP3, Deep Time increment 2).
// Contract (see shot-era.mjs's header): export default (h) => [{ name, label, page, evalJs?, wait? }, ...], names
// unique across all plugins; h.CRET, h.DEFAULT_BOOT, h.timed(body), h.AT_FRAME('G3'), h.SAFARI_AT(ms), ... .
// Run just these: node scripts/shot-era.mjs --plugins alamosaurus --only <name,...> --out <dir>
//
//   alamo-gallery        dev/fauna.html: the walk strip (gait 1) and a browsing hero, side on, with a 1.8 m figure
//   alamo-browse         dev/fauna.html: six browsing animals at different points of the reach / sweep cycle
//   alamo-scale          the trio at its stand with the C172 parked beside the nearest one (paused), chase-like
//   alamo-trees          a chase-height camera 300 m from the trio: the necks against the nearby crowns
//   alamo-G1, alamo-G6   the default boot (cockpit) at FIRST_MINUTE_FRAMES' G1 and G6, labelled with the trio's
//                        bearing / depression / distance and its MEASURED on-screen size (body length and neck
//                        rise, px, projected through the live camera for each member)

/** Find the Alamosaurus herd slot (H, f in scope). */
const FIND = `
  const A = await import('/src/world/era/cretaceousAnchors.ts');
  let ah = -1;
  for (const h of f.showcaseHerds) if (Math.hypot(H.cN[h] - A.ALAMOSAURUS_STAND.north, H.cE[h] - A.ALAMOSAURUS_STAND.east) < 400 && H.size[h] === 3) ah = h;
  const members = () => Array.from({ length: ah >= 0 ? H.size[ah] : 0 }, (_, k) => ah * H.memberCap + k);`;

/** Project each member's nose, tail tip, shoulder top and head through the live camera: px sizes at 1600 x 900. */
const MEASURE = `
  const measure = () => {
    const cam = sim.ctx.camera;
    cam.updateMatrixWorld();
    const V = cam.matrixWorldInverse.elements, P = cam.projectionMatrix.elements;
    const W = window.innerWidth, Hh = window.innerHeight;
    const proj = (x, y, z) => {
      const vx = V[0] * x + V[4] * y + V[8] * z + V[12], vy = V[1] * x + V[5] * y + V[9] * z + V[13], vz = V[2] * x + V[6] * y + V[10] * z + V[14];
      const cx = P[0] * vx + P[4] * vy + P[8] * vz + P[12], cy = P[1] * vx + P[5] * vy + P[9] * vz + P[13], cw = P[3] * vx + P[7] * vy + P[11] * vz + P[15];
      return [(cx / cw * 0.5 + 0.5) * W, (0.5 - cy / cw * 0.5) * Hh, cw > 0];
    };
    return members().map((i) => {
      const n = H.mN[i], e = H.mE[i], g = H.mH[i], y = H.yaw[i], s = H.scale[i];
      const at = (fwd, up) => proj(e + Math.sin(y) * fwd * s, g + up * s, -(n + Math.cos(y) * fwd * s));
      const nose = at(13.5, 9.6), tail = at(-12.5, 1.5), shoulder = at(3.3, 5.0), foot = at(1.5, 0);
      return { len: Math.round(Math.hypot(nose[0] - tail[0], nose[1] - tail[1])), neckRise: Math.round(shoulder[1] - nose[1]), tall: Math.round(foot[1] - nose[1]), x: Math.round(foot[0]), y: Math.round(foot[1]), front: nose[2] };
    });
  };`;

/** The default boot at a G frame, plus the trio's measured pixel sizes. */
const AT_G = (h, id) => `${FIND}${MEASURE}
  const g = await (async () => { ${h.AT_FRAME(id)} })();
  const m = measure();
  const txt = m.map((v) => v.len + 'x' + v.tall + 'px@' + v.x + ',' + v.y).join(' ');
  return { ...g, alamosaurus: m, label: (g.label || '') + ' | trio ' + txt };`;

/** The C172 parked beside the nearest member (paused), seen from behind and above both. */
const SCALE = `${FIND}
  if (ah < 0) return { found: false };
  sim.pause(true);
  await sleep(200);
  const i = members()[0];
  const n = H.mN[i], e = H.mE[i], g = H.mH[i], y = H.yaw[i];
  // 22 m to the animal's left, nose the same way.
  const ln = n - 22 * Math.sin(y) * -1, le = e - 22 * Math.cos(y);
  const base = sim.physics.scenario;
  const dz = base.ic.position.z + 120;
  sim.physics.resetTo({ ...base, ic: { ...base.ic, position: { x: ln, y: le, z: -g + dz }, heading: y } });
  sim.setCamera('chase');
  await sleep(500);
  const mn = (n + ln) / 2, me = (e + le) / 2;
  sim.setFixedCamera([mn - 55 * Math.cos(y) + 10 * Math.sin(y), me - 55 * Math.sin(y) - 10 * Math.cos(y), g + 9], [mn + 6 * Math.cos(y), me + 6 * Math.sin(y), g + 5]);
  await sleep(800);
  const s = sim.summary();
  return { found: true, sep: Math.round(Math.hypot(s.north - n, s.east - e)), onGround: s.onGround, agl: s.altitudeAGL };`;

/** A camera 300 m from the trio at 45 m, looking across it (from the track side, then from the far side). */
const TREES = (from) => `${FIND}
  if (ah < 0) return { found: false };
  await sleep(2500);
  sim.pause(true);
  const cn = H.cN[ah], ce = H.cE[ah], ch = H.cH[ah];
  const a = ${from} * Math.PI / 180;
  sim.setCamera('chase');
  sim.setFixedCamera([cn + 300 * Math.cos(a), ce + 300 * Math.sin(a), ch + 45], [cn, ce, ch + 8]);
  await sleep(1500);
  return { found: true, modes: H.mode[ah], blend: members().map((i) => +H.blend[i].toFixed(2)) };`;

export default function shots(h) {
  return [
    {
      name: 'alamo-gallery',
      label: 'Alamosaurus: walk strip (gait 1) and browsing hero, 1.8 m figure',
      page: 'dev/fauna.html?species=alamosaurus&gait=1&freeze=1&t=1.3&tod=15&cam=-75,0,135&look=-10,0,124',
      wait: 2500,
    },
    {
      name: 'alamo-browse',
      label: 'Alamosaurus: browsing (gait 0), six points of the reach and sweep cycle',
      page: 'dev/fauna.html?species=alamosaurus&action=graze&freeze=1&t=4&tod=15&cam=-75,0,135&look=-10,0,126',
      wait: 2500,
    },
    { name: 'alamo-scale', label: 'Alamosaurus beside the C172 (paused), at the stand', page: `${h.CRET}&scenario=runway&tod=17&ui=0`, evalJs: h.timed(SCALE), wait: 0 },
    { name: 'alamo-trees', label: 'Alamosaurus trio from 300 m, 45 m up (track side, north)', page: `${h.CRET}&tod=17&ui=0`, evalJs: h.timed(TREES(0)), wait: 0 },
    { name: 'alamo-trees-far', label: 'Alamosaurus trio from 300 m, 45 m up (far side, south-west)', page: `${h.CRET}&tod=17&ui=0`, evalJs: h.timed(TREES(225)), wait: 0 },
    { name: 'alamo-G1', label: 'Default boot G1 (cockpit)', page: h.DEFAULT_BOOT, evalJs: h.timed(AT_G(h, 'G1')), wait: 0 },
    { name: 'alamo-G6', label: 'Default boot G6 (cockpit)', page: h.DEFAULT_BOOT, evalJs: h.timed(AT_G(h, 'G6')), wait: 0 },
  ];
}
