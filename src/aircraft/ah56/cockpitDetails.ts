// AH-56A crew stations (P ASTA-72 App B para 3 / research-ah56 section 12): the PILOT flies from the REAR seat; the
// copilot/gunner sits in the front swivelling gunner station (SGS) behind the periscopic sight. Rear cockpit: the
// panel face of the frozen panelLayout.ts (an AGENT reconstruction, unverified: no photograph of the rear panel exists)
// under a glare hood, the side consoles with the landing-gear handle and the tail-wheel lock lever on the left, the
// circuit-breaker panels above and behind the pilot's head (P APE-I 134i), the boosted cyclic with its four-way trim
// "coolie hat" (P ASTA-72 para 40), and the collective whose head carries the propeller twist grip FORWARD and the engine
// condition grip (OFF/IDLE/RUN) behind it (P para 73a: same shape, criticised). Front: the SGS sight column with its
// hand grips and eyepiece, the gunner's side consoles. Armoured seats (photographs). Positions and sizes ESTIMATE.
import * as THREE from 'three';
import type { ControlInputs } from '../../core/types';
import type { AirframeVisualDef } from '../../render/aircraft/airframe/types';
import type { RotorcraftCockpit } from '../../render/aircraft/rotorcraft/cockpit';
import { buildOccupants, type Occupants } from '../../render/aircraft/occupants';
import { MeshBatch } from '../../render/aircraft/geometry';
import { box, pathTube, tube } from '../../render/aircraft/rotorcraft/geometry';
import { AH56_PANEL_CANVAS, AH56_PANEL_FACE, AH56_PANEL_OUTLINE, AH56_SIDE_CONSOLES } from './panelLayout';
import * as D from './dimensions';
import { FLOORS, SEATS, fs, wl } from './visual';
import { ellipsoid, type AH56Materials, type AH56SkinWidth } from './exteriorGeometry';

/** Cyclic travel shown on the stick, deg (AMCS 9.9 x 5.8 in, P, on a stick about 22 in tall: about 12.5 x 7.5 deg). */
export const STICK_PITCH_DEG = 12.5, STICK_ROLL_DEG = 7.5;
/** Prop twist-grip rotation over the full lever, deg (P: about 130 deg for 52.8 deg of blade, AMCS). */
export const PROP_GRIP_DEG = 130;

export function buildAH56Cockpit(def: AirframeVisualDef, cockpit: RotorcraftCockpit, m: AH56Materials, lining: AH56SkinWidth) {
  const b = new MeshBatch();
  const IN = 0.0254;
  // ---------------------------------------------------------------- floors, bulkheads
  const front = FLOORS.front, rear = FLOORS.rear;
  const plate = (s0: number, s1: number, w: number, thick = 0.02) => {
    for (let s = s0; s < s1; s += 4) {
      const hw = lining(fs(s + 2), wl(w) - 0.02) - 0.01;
      if (hw > 0.05) b.add(m.panel, box([fs(s + 2), 0, wl(w) + thick / 2], [4 * IN + 0.002, 2 * hw, thick], 0.004));
    }
  };
  plate(front.fs0, front.fs1, front.wl);
  // The step: the bulkhead between the gunner's floor and the pilot's raised footwell, and the panel's lower face.
  const step = (s: number, w0: number, w1: number) => {
    for (let k = 0; k < 6; k++) {
      const z0 = THREE.MathUtils.lerp(wl(w0), wl(w1), k / 6), z1 = THREE.MathUtils.lerp(wl(w0), wl(w1), (k + 1) / 6);
      const hw = Math.min(lining(fs(s), z0), lining(fs(s), z1)) - 0.01;
      if (hw > 0.05) b.add(m.panel, box([fs(s), 0, (z0 + z1) / 2], [0.02, 2 * hw, Math.abs(z1 - z0) + 0.003], 0.004));
    }
  };
  step(front.fs1 + 1, front.wl, rear.wl);
  step(rear.fs1 + 22, rear.wl, 134);
  // ---------------------------------------------------------------- rear (pilot) station
  // Glare hood over the panel face; the face itself is the generic panel at AH56_PANEL_FACE.
  const tilt = AH56_PANEL_FACE.tiltBackDeg * Math.PI / 180, ph = AH56_PANEL_FACE.height, pw = AH56_PANEL_FACE.width;
  const pod = new THREE.Group(); pod.name = 'ah56PanelHood';
  pod.position.set(AH56_PANEL_FACE.centre.y, -AH56_PANEL_FACE.centre.z, -AH56_PANEL_FACE.centre.x); pod.rotation.x = -tilt;
  const hood = new MeshBatch();
  hood.add(m.frame, new THREE.BoxGeometry(pw + 0.06, 0.014, 0.16).translate(0, ph / 2 + 0.009, 0.05));
  for (const s of [-1, 1]) hood.add(m.frame, new THREE.BoxGeometry(0.014, ph + 0.03, 0.12).translate(s * (pw / 2 + 0.024), 0, 0.03));
  hood.add(m.frame, new THREE.BoxGeometry(pw + 0.06, ph + 0.04, 0.02).translate(0, 0, -0.17));
  pod.userData.panelOutline = AH56_PANEL_OUTLINE; pod.userData.panelCanvas = AH56_PANEL_CANVAS;
  pod.add(hood.build('ah56PanelHoodParts', { cast: false, receive: true }));
  // Side consoles: gear handle (wheel knob) and tail-wheel lock lever left, switch rows both sides.
  const sc = AH56_SIDE_CONSOLES;
  for (const [side, c] of [[-1, sc.left.centre], [1, sc.right.centre]] as const) {
    b.add(m.panel, box([c.x, c.y, c.z + 0.08], [sc.length, sc.width, 0.16], 0.01));
    for (let k = 0; k < 5; k++) {
      b.add(m.dark, box([c.x + 0.18 - k * 0.075, c.y, c.z + 0.002], [0.03, 0.05, 0.006], 0.002));
      b.add(m.metal, tube([c.x + 0.18 - k * 0.075, c.y - side * 0.01, c.z - 0.002], [c.x + 0.18 - k * 0.075, c.y - side * 0.01, c.z - 0.025], 0.003));
    }
    if (side < 0) {
      // Landing-gear handle (wheel-shaped knob) and the tail-wheel lock T-handle.
      b.add(m.metal, tube([c.x - 0.12, c.y + 0.02, c.z], [c.x - 0.10, c.y + 0.02, c.z - 0.10], 0.007));
      b.add(m.white, new THREE.TorusGeometry(0.018, 0.007, 8, 18).translate(...[c.y + 0.02, -(c.z - 0.105), -(c.x - 0.10)] as [number, number, number]));
      b.add(m.yellow, tube([c.x - 0.20, c.y - 0.02, c.z], [c.x - 0.20, c.y - 0.02, c.z - 0.06], 0.006));
      b.add(m.yellow, tube([c.x - 0.20, c.y - 0.045, c.z - 0.065], [c.x - 0.20, c.y + 0.005, c.z - 0.065], 0.008));
    }
  }
  // Circuit-breaker panels above and behind the pilot's head (P APE-I 134i), on the rear canopy frame.
  for (const s of [-1, 1]) {
    const x = fs(198), z = wl(128), hw = lining(x, z) - 0.03;
    b.add(m.panel, box([x, s * (hw - 0.03), z], [0.20, 0.03, 0.16], 0.006));
    for (let r = 0; r < 3; r++) for (let k = 0; k < 4; k++)
      b.add(m.black, tube([x + 0.07 - k * 0.045, s * (hw - 0.05), z - 0.05 + r * 0.05], [x + 0.07 - k * 0.045, s * (hw - 0.065), z - 0.05 + r * 0.05], 0.006));
  }
  // Armoured seat sides for both seats.
  for (const seat of def.cockpit.seats) for (const s of [-1, 1])
    b.add(m.paintDark, box([seat.x - seat.depth / 2, seat.y + s * (seat.width / 2 + 0.012), seat.z! - 0.12], [seat.depth + 0.04, 0.02, 0.34], 0.008));
  // ---------------------------------------------------------------- front (gunner) station: the SGS sight
  {
    const x0 = fs(97), base = wl(front.wl), head = { x: fs(106), z: wl(111) };
    b.add(m.cast, tube([x0, 0, base], [x0 - 0.02, 0, wl(100)], 0.05, 0.045, 18));
    b.add(m.panel, box([head.x, 0, head.z], [0.24, 0.20, 0.16], 0.02));
    b.add(m.black, tube([head.x - 0.12, 0, head.z - 0.01], [head.x - 0.18, 0, head.z - 0.01], 0.035, 0.03, 16));
    b.add(m.rubber, tube([head.x - 0.18, 0, head.z - 0.01], [head.x - 0.20, 0, head.z - 0.01], 0.038, 0.038, 16));
    for (const s of [-1, 1]) {
      // Sight hand grips (the turret and laser rangefinder controls).
      b.add(m.cast, tube([head.x - 0.02, s * 0.10, head.z + 0.06], [head.x - 0.04, s * 0.17, head.z + 0.14], 0.012));
      b.add(m.rubber, tube([head.x - 0.04, s * 0.17, head.z + 0.10], [head.x - 0.07, s * 0.17, head.z + 0.21], 0.019, 0.017, 12));
      // Gunner's side consoles.
      const cx = fs(118), cz = wl(86), hw = lining(cx, cz) - 0.06;
      b.add(m.panel, box([cx, s * (hw - 0.05), cz + 0.08], [0.40, 0.10, 0.16], 0.01));
    }
    // The small instrument panel under the front windshield.
    b.add(m.panel, box([fs(80), 0, wl(93)], [0.04, 0.42, 0.14], 0.01));
  }
  const group = b.build('ah56CabinDetails', { cast: false, receive: true });
  group.add(pod);

  // ---------------------------------------------------------------- pilot cyclic (rear seat, between the knees)
  for (const child of cockpit.cyclic.children) child.visible = false;
  const stick = new THREE.Group(); stick.name = 'ah56Cyclic';
  const parts = new MeshBatch();
  const stem = def.rotorcraftVisual!.cyclic!.stem, end = stem[stem.length - 1];
  parts.add(m.rubber, ellipsoid([0, 0, -0.025], [0.07, 0.065, 0.035], 16, 8));
  parts.add(m.dark, pathTube(stem, 0.014, 40));
  parts.add(m.rubber, tube([end[0] + 0.01, 0, end[2] + 0.02], [end[0] - 0.03, 0, end[2] - 0.12], 0.02, 0.023, 14));
  parts.add(m.dark, ellipsoid([end[0] - 0.033, 0, end[2] - 0.125], [0.032, 0.027, 0.02], 14, 8));
  parts.add(m.grey, tube([end[0] - 0.03, 0.012, end[2] - 0.14], [end[0] - 0.03, 0.012, end[2] - 0.15], 0.0075, 0.006, 10)); // trim coolie hat
  parts.add(m.red, box([end[0] + 0.024, 0, end[2] - 0.08], [0.012, 0.012, 0.02], 0.003)); // trigger
  stick.add(parts.build('ah56CyclicGrip')); cockpit.cyclic.add(stick);

  // ---------------------------------------------------------------- collective head: prop twist grip forward, condition grip
  const propGrips: THREE.Group[] = [];
  cockpit.collectives.forEach((lever, i) => {
    const L = def.rotorcraftVisual!.collective.length;
    const head = new MeshBatch();
    head.add(m.metal, tube([0, 0.03, 0], [0, 0.06, 0], 0.006));
    head.add(m.dark, tube([0, 0.055, 0], [0, 0.07, 0], 0.02)); // friction collar
    head.add(m.dark, tube([L - 0.10, 0, 0], [L + 0.07, 0, 0], 0.012)); // the lever runs on through both grips
    head.add(m.dark, box([L + 0.095, 0, -0.03], [0.05, 0.05, 0.05], 0.008)); // switch box: RPM SET beep, directional trim
    head.add(m.metal, tube([L + 0.095, 0.012, -0.055], [L + 0.095, 0.012, -0.073], 0.004));
    head.add(m.metal, tube([L + 0.095, -0.014, -0.055], [L + 0.095, -0.014, -0.069], 0.003));
    lever.add(head.build(`ah56CollectiveHead${i}`));
    // The generic twist grip is the engine condition grip; the prop grip sits ahead of it, the same shape (P).
    const ribs = new MeshBatch();
    for (let j = 0; j < 8; j++) ribs.add(m.rubber, tube([-0.04 + j * 0.011, 0, 0], [-0.035 + j * 0.011, 0, 0], 0.0235));
    cockpit.throttles[i].add(ribs.build(`ah56ConditionGrip${i}`));
    const prop = new THREE.Group(); prop.name = 'ah56PropGrip';
    // In the lever frame the lever runs along FRD x (three.js -Z): the prop grip is just ahead of the condition grip.
    prop.position.set(0, 0, -(L + 0.015));
    const pr = new MeshBatch();
    pr.add(m.black, tube([-0.045, 0, 0], [0.045, 0, 0], 0.022, 0.022, 16));
    for (let j = 0; j < 7; j++) pr.add(m.rubber, tube([-0.038 + j * 0.012, 0, 0], [-0.033 + j * 0.012, 0, 0], 0.024));
    pr.add(m.yellow, box([0, 0, -0.024], [0.03, 0.006, 0.004], 0.001)); // index mark
    prop.add(pr.build(`ah56PropGripParts${i}`)); lever.add(prop); propGrips.push(prop);
  });

  // ---------------------------------------------------------------- the gunner figure (front seat), external views only
  const gunner: Occupants | null = buildOccupants({ ...def.cockpit, floor: { ...def.cockpit.floor, z: wl(front.wl) }, occupants: [{ seat: 1 }] }, true);
  if (gunner) gunner.group.name = 'ah56GunnerFigure';
  return {
    group, stick, propGrips, gunner, eye: D.PILOT_EYE, seats: SEATS,
    update(c: ControlInputs, inside: boolean) {
      cockpit.cyclic.rotation.set(0, 0, 0);
      stick.rotation.set(c.elevator * STICK_PITCH_DEG * Math.PI / 180, 0, -c.aileron * STICK_ROLL_DEG * Math.PI / 180);
      for (const g of propGrips) g.rotation.z = -(c.propLever ?? 0) * PROP_GRIP_DEG * Math.PI / 180;
      if (gunner) gunner.group.visible = !inside;
    },
  };
}
