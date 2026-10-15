// scripts/shot-era.mjs plugin: the Tyrannosaurus rex shots (owner: WP1, Deep Time increment 2).
// Contract (see shot-era.mjs's header): export default (h) => [{ name, label, page, evalJs?, wait? }, ...], names
// unique across all plugins; h.CRET, h.DEFAULT_BOOT, h.timed(body), h.AT_FRAME('G3'), h.SAFARI_AT(ms), ... .
// Run just these: node scripts/shot-era.mjs --plugins tyrannosaurus --out <dir>
//
//   trex-gallery-*   dev/fauna.html: the walk and charge strips, the crouch-idle and the roar (side and 3/4), and
//                    the far LODs at the look-gate ranges (LOD1 at 300 m, LOD2 at 700 m)
//   trex-scale       the C172 40 m from the T. rex (paused), from a chase-like camera behind both
//   trex-charge      the default boot, 3 s into the charge: a camera above and behind the T. rex, the stampede ahead
//   trex-G2, -G3     the default boot, cockpit, at FIRST_MINUTE_FRAMES G2 / G3 (the brain's state in the label)

const DEV = 'dev/fauna.html?species=tyrannosaurus&freeze=1&t=1.3';
// The hero stands at (0, 0) facing east on ground 120 m (dev/fauna.ts); cam / look are north, east, up.
const SIDE = 'strip=0&cam=-17,-0.5,123&look=0,-0.5,122';
const Q34 = 'strip=0&cam=-10,9,124.5&look=0,0,122';

/** Where the T. rex is and what its brain is doing (agent 0 of the fauna's solo pool). */
const REX = `
  const A = f.agents; let i = -1;
  for (let k = 0; k < A.capacity; k++) if (A.active[k]) { i = k; break; }
  const STATES = ['lurk', 'stalk', 'charge', 'roar', 'wander'];
  const rex = () => i < 0 ? null : { i, n: A.n[i], e: A.e[i], h: A.h[i], yaw: A.yaw[i], speed: +A.speed[i].toFixed(1), state: STATES[A.state[i]], roar: +A.flap[i].toFixed(2) };`;

const SCALE = `${REX}
  const r = rex();
  if (!r) return { label: ' (no T. rex)' };
  const base = sim.physics.scenario;
  // The aircraft 40 m to the T. rex's left, 20 m up, flying the way it faces; the camera behind and above both.
  const fn = Math.cos(r.yaw), fe = Math.sin(r.yaw), ln = Math.sin(r.yaw), le = -Math.cos(r.yaw);
  const an = r.n + 40 * ln, ae = r.e + 40 * le;
  sim.physics.resetTo({ ...base, engageAutoflight: false, ic: { ...base.ic, position: { x: an, y: ae, z: -(r.h + 20) }, heading: r.yaw, airspeed: 45, onGround: false } });
  sim.setCamera('chase');
  await sleep(100);
  // From where the aircraft actually is (after the reset), behind and to the left of the pair.
  const s = sim.summary();
  const mn = (r.n + s.north) / 2, me = (r.e + s.east) / 2;
  sim.setFixedCamera([mn - 32 * fn - 8 * ln, me - 32 * fe - 8 * le, r.h + 9], [mn + 6 * fn, me + 6 * fe, r.h + 9]);
  // (The fixed camera is applied by the running frame loop: pause after it has taken.)
  await sleep(250);
  sim.pause(true);
  await sleep(900);
  const cp = sim.ctx.camera.position;
  return { cam: [-cp.z, cp.x, cp.y], label: ' (aircraft ' + Math.round(Math.hypot(s.north - r.n, s.east - r.e)) + ' m from it, ' + Math.round(s.altitudeMSL - r.h) + ' m up)', rex: r, ac: [s.north, s.east, s.altitudeMSL], want: [an, ae, r.h + 20] };`;

const CHARGE = `${REX}
  const h = f.riverHerd;
  const runningNow = () => { let c = 0; for (let k = 0; k < H.size[h]; k++) if (H.speed[h * H.memberCap + k] > 2) c++; return c; };
  // Late in the charge or the roar, once the stampede is under way.
  await until(() => i >= 0 && A.state[i] >= 2 && runningNow() >= 15, 60000);
  const r = rex();
  const cn = H.cN[h], ce = H.cE[h], ch = H.cH[h];
  // Above and behind the T. rex, looking past it at the herd's centre.
  const dn = cn - r.n, de = ce - r.e, d = Math.hypot(dn, de) || 1;
  sim.setFixedCamera([r.n - 70 * dn / d + 25 * de / d, r.e - 70 * de / d - 25 * dn / d, r.h + 45], [r.n + 0.55 * dn, r.e + 0.55 * de, ch]);
  await sleep(500);
  let running = 0;
  for (let k = 0; k < H.size[h]; k++) if (H.speed[h * H.memberCap + k] > 2) running++;
  return { label: ' t ' + sim.summary().time.toFixed(1) + ': ' + r.state + ' ' + r.speed + ' m/s, herd ' + Math.round(d) + ' m, fleeing ' + H.fleeing[h] + ', running ' + running, rex: r, running };`;

const frame = (h, id) => `${REX}
  const res = await (async () => { ${h.AT_FRAME(id)} })();
  const r = rex();
  const s = sim.summary();
  const rel = r ? (() => { const dn = r.n - s.north, de = r.e - s.east, hd = s.headingDeg * Math.PI / 180; let b = Math.atan2(de, dn) - hd; b = Math.atan2(Math.sin(b), Math.cos(b)); const d = Math.hypot(dn, de); return ' | T. rex ' + r.state + ' ' + r.speed + ' m/s ' + Math.round(b * 57.3) + '/' + (Math.atan2(s.altitudeMSL - r.h, d) * 57.3).toFixed(1) + '/' + Math.round(d); })() : '';
  // The T. rex's screen position (px at the shot size), for checking the frame by eye.
  let px = null;
  if (r) { const cam = sim.ctx.camera, v = cam.position.clone().set(r.e, r.h + 2, -r.n).project(cam); px = [Math.round((v.x + 1) * innerWidth / 2), Math.round((1 - v.y) * innerHeight / 2)]; }
  return { ...res, label: (res.label || '') + rel + (px ? ' @' + px.join(',') + 'px' : ''), rex: r, px };`;

export default function shots(h) {
  return [
    { name: 'trex-gallery-walk', label: 'T. rex walk strip (one stride, 6 phases)', page: `${DEV}&gait=1&strip=6`, wait: 1500 },
    { name: 'trex-gallery-charge', label: 'T. rex charge strip (one stride, 6 phases)', page: `${DEV}&gait=2&strip=6`, wait: 1500 },
    { name: 'trex-gallery-idle', label: 'T. rex crouch-idle, side', page: `${DEV}&gait=0&${SIDE}`, wait: 1500 },
    { name: 'trex-gallery-roar', label: 'T. rex roar, side', page: `${DEV}&action=roar&${SIDE}`, wait: 1500 },
    { name: 'trex-gallery-roar34', label: 'T. rex roar, 3/4', page: `${DEV}&action=roar&${Q34}`, wait: 1500 },
    { name: 'trex-gallery-walk34', label: 'T. rex walk, 3/4', page: `${DEV}&gait=1&${Q34}`, wait: 1500 },
    { name: 'trex-gallery-lod1-300', label: 'T. rex LOD1 at 300 m (walk)', page: `${DEV}&gait=1&strip=0&lod=1&cam=-300,0,215&look=0,0,124`, wait: 1500 },
    { name: 'trex-gallery-lod2-700', label: 'T. rex LOD2 at 700 m (charge)', page: `${DEV}&gait=2&strip=0&lod=2&cam=-700,0,340&look=0,0,124`, wait: 1500 },
    { name: 'trex-scale', label: 'T. rex beside the C172 (40 m), paused', page: `${h.CRET}&tod=17.5&ui=0`, evalJs: h.timed(SCALE), wait: 0 },
    { name: 'trex-charge', label: 'T. rex charge and the stampede (default boot)', page: h.DEFAULT_BOOT, evalJs: h.timed(CHARGE), wait: 0 },
    { name: 'trex-G2', label: 'G2 (default boot, cockpit)', page: h.DEFAULT_BOOT, evalJs: h.timed(frame(h, 'G2')), wait: 0 },
    { name: 'trex-G3', label: 'G3 (default boot, cockpit)', page: h.DEFAULT_BOOT, evalJs: h.timed(frame(h, 'G3')), wait: 0 },
  ];
}
