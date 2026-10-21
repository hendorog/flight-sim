// MBB Bo 105 CB-4 crew compartment, pilot in the RIGHT seat (the certificated minimum-crew position, P TCDS p11). Built
// round the integrator-frozen panelLayout.ts: the narrow instrument pedestal on the centreline under its large hood,
// the sloping centre console (switch panel, FM Fig 7-4) below it running aft between the seats, the overhead console
// (FM Fig 7-5) and the TWO POWER LEVERS hanging from the cabin roof just forward of it (engine 1 left, engine 2 right;
// OFF - IDLE - FLIGHT, P5 FM 7-12). The pilot's curved "goose-neck" cyclic rises from the floor ahead of the seat; the
// collective on the pilot's left ends in a switch box with the four-way ENGINE TRIM switch (fore/aft beeps both N2,
// left/right trades torque, FM 7-12). Positions and proportions are ESTIMATES from the Christoph 7, Policia CB and
// schoschie cockpit photographs; dual controls are not fitted (AGENT choice; many operators fit them).
import * as THREE from 'three';
import type { AirframeVisualDef } from '../../render/aircraft/airframe/types';
import type { RotorcraftCockpit } from '../../render/aircraft/rotorcraft/cockpit';
import { engineControl, type ControlInputs } from '../../core/types';
import { frd, MeshBatch } from '../../render/aircraft/geometry';
import { box, tube, pathTube } from '../../render/aircraft/rotorcraft/geometry';
import { BO105_CENTRE_CONSOLE, BO105_OVERHEAD_CONSOLE, BO105_PANEL_CANVAS, BO105_PANEL_FACE, BO105_PANEL_OUTLINE,
  BO105_POWER_LEVERS } from './panelLayout';
import { CABIN_REAR_STA, FLOOR_Z, H, PILOT_SEAT_Y, S } from './visual';
import { ellipsoid, type Bo105Materials, type Bo105SkinWidth } from './exteriorGeometry';

/** Cyclic travel shown on the stick, deg (visual estimate). */
export const STICK_PITCH_DEG = 10, STICK_ROLL_DEG = 8;
/** ENGINE TRIM switch throw shown, rad. */
export const TRIM_SWITCH_THROW = 0.35;
/** Power-lever angle from the hanging position, rad: OFF aft, FLIGHT forward (lever travel = panelLayout travelDeg). */
export function powerLeverAngle(lever: number): number {
  return (Math.min(1, Math.max(0, lever)) - 0.5) * BO105_POWER_LEVERS.travelDeg * Math.PI / 180;
}

export function buildBo105Cockpit(def: AirframeVisualDef, cockpit: RotorcraftCockpit, m: Bo105Materials, lining: Bo105SkinWidth) {
  const b = new MeshBatch();
  // Seats: bolsters, harness and the seat-back shells over the generic seats (front pair and the rear bench).
  for (const seat of def.cockpit.seats) {
    const z = seat.z!, backX = seat.x - seat.depth;
    if (seat.kind === 'front') {
      for (const side of [-1, 1]) b.add(m.seat, ellipsoid([seat.x - seat.depth / 2, seat.y + side * (seat.width / 2 - 0.03), z - 0.01],
        [seat.depth * 0.45, 0.035, 0.04], 16, 10));
      b.add(m.dark, box([backX - 0.02, seat.y, z - 0.30], [0.03, seat.width, 0.58], 0.012));
      // Shoulder harness from the seat back to the lap-belt buckle.
      for (const side of [-1, 1]) b.add(m.dark, tube([backX + 0.06, seat.y + side * 0.11, z - 0.58], [seat.x - 0.17, seat.y + side * 0.02, z - 0.06], 0.006, 0.006, 6));
    } else {
      b.add(m.dark, box([backX - 0.03, seat.y, z - 0.30], [0.03, seat.width + 0.04, 0.60], 0.012));
    }
  }
  // Rear cabin bulkhead behind the bench (the cargo compartment under the engines lies aft of it).
  const bulkX = S(CABIN_REAR_STA) - 0.01, roofZ = H(2.0);
  for (let k = 0; k < 8; k++) {
    const z0 = THREE.MathUtils.lerp(FLOOR_Z, roofZ, k / 8), z1 = THREE.MathUtils.lerp(FLOOR_Z, roofZ, (k + 1) / 8), zc = (z0 + z1) / 2;
    const hw = Math.min(lining(bulkX, z0), lining(bulkX, z1)) - 0.01;
    if (hw > 0.05) b.add(m.frame, box([bulkX - 0.01, 0, zc], [0.02, 2 * hw, Math.abs(z1 - z0) + 0.002], 0.004));
  }

  // ---------------------------------------------------------------- the instrument pedestal and its hood
  const face = BO105_PANEL_FACE, tilt = face.tiltBackDeg * Math.PI / 180, ph = face.height, pw = face.width;
  const pod = new THREE.Group(); pod.name = 'bo105PedestalHood';
  pod.position.copy(frd(face.centre.x, 0, face.centre.z)); pod.rotation.x = -tilt;
  const hood = new MeshBatch();
  // In the pod: local x right, y up the face, z out of the face (towards the crew). The hood is a deep visor over the
  // face top and its upper sides (photographs), the pedestal sides run down to the console.
  hood.add(m.frame, new THREE.BoxGeometry(pw + 0.14, 0.016, 0.36).translate(0, ph / 2 + 0.05, -0.03));
  hood.add(m.frame, new THREE.BoxGeometry(pw + 0.14, 0.05, 0.016).translate(0, ph / 2 + 0.03, 0.145));
  for (const s of [-1, 1]) {
    const cheek = new THREE.Shape([new THREE.Vector2(-0.21, 0), new THREE.Vector2(0.15, 0), new THREE.Vector2(0.15, -0.06),
      new THREE.Vector2(0.02, -0.30), new THREE.Vector2(-0.21, -0.36)]);
    const g = new THREE.ExtrudeGeometry(cheek, { depth: 0.012, bevelEnabled: false });
    // Shape x -> local z (towards the crew), shape y -> local y; extruded across.
    g.rotateY(-Math.PI / 2).translate(s * (pw / 2 + 0.065) + 0.006, ph / 2 + 0.045, 0);
    hood.add(m.frame, g);
  }
  for (const s of [-1, 1]) hood.add(m.frame, new THREE.BoxGeometry(0.014, ph + 0.02, 0.22).translate(s * (pw / 2 + 0.008), 0, -0.10));
  pod.userData.panelOutline = BO105_PANEL_OUTLINE; pod.userData.panelCanvas = BO105_PANEL_CANVAS;
  pod.add(hood.build('bo105PedestalHoodParts', { cast: false, receive: true }));
  // Pedestal body below the face, down to the floor (the instruments' cases and wiring are inside it).
  const bottom = { x: face.centre.x - ph / 2 * Math.sin(tilt), z: face.centre.z + ph / 2 * Math.cos(tilt) };
  b.add(m.frame, box([bottom.x + 0.13, 0, (bottom.z + FLOOR_Z) / 2], [0.26, pw + 0.02, FLOOR_Z - bottom.z + 0.02], 0.02));

  // ---------------------------------------------------------------- centre console (switch panel), sloping
  const cc = BO105_CENTRE_CONSOLE, ct = cc.tiltBackDeg * Math.PI / 180;
  const slant = new THREE.Group(); slant.name = 'bo105CentreConsole';
  slant.position.copy(frd(cc.centre.x, 0, cc.centre.z)); slant.rotation.x = -ct;
  const sc = new MeshBatch();
  // In the slant group: local x right, y up the face (forward), z out of the face (up and aft).
  sc.add(m.frame, new THREE.BoxGeometry(cc.width, cc.depth, 0.05).translate(0, 0, -0.025));
  for (let row = 0; row < 4; row++) for (let k = 0; k < 5; k++) {
    const x = -cc.width / 2 + 0.045 + k * 0.052, y = cc.depth / 2 - 0.06 - row * 0.085;
    sc.add(m.switchBlack, new THREE.BoxGeometry(0.028, 0.02, 0.006).translate(x, y, 0.003));
    sc.add(m.metal, new THREE.CylinderGeometry(0.0035, 0.0035, 0.018, 6).rotateX(Math.PI / 2 - 0.3).translate(x, y, 0.012));
  }
  // EMERG FUEL VALVE 1 / 2 guarded switches (red covers), FM Fig 7-4.
  for (const x of [-0.06, 0.06]) sc.add(m.red, new THREE.BoxGeometry(0.035, 0.05, 0.02).translate(x, -cc.depth / 2 + 0.05, 0.012));
  slant.add(sc.build('bo105CentreConsoleParts', { cast: false, receive: true }));
  // Console box under the sloping face down to the floor, and its low extension aft between the seats.
  const ccTop = { x: cc.centre.x + cc.depth / 2 * Math.sin(ct), z: cc.centre.z - cc.depth / 2 * Math.cos(ct) };
  const ccLow = { x: cc.centre.x - cc.depth / 2 * Math.sin(ct), z: cc.centre.z + cc.depth / 2 * Math.cos(ct) };
  b.add(m.frame, box([(ccTop.x + ccLow.x) / 2, 0, (ccLow.z + FLOOR_Z) / 2 + 0.01], [ccTop.x - ccLow.x, cc.width, FLOOR_Z - ccLow.z + 0.02], 0.01));
  b.add(m.frame, box([(ccLow.x + S(2.02)) / 2, 0, (ccLow.z + FLOOR_Z) / 2], [ccLow.x - S(2.02), cc.width - 0.02, FLOOR_Z - ccLow.z], 0.012));

  // ---------------------------------------------------------------- overhead console and the two power levers
  const oc = BO105_OVERHEAD_CONSOLE;
  b.add(m.frame, box([oc.centre.x, 0, oc.centre.z], [oc.length, oc.width, 0.05], 0.01));
  for (let row = 0; row < 3; row++) for (let k = 0; k < 4; k++) {
    const x = oc.centre.x + oc.length / 2 - 0.08 - row * 0.12, y = -oc.width / 2 + 0.05 + k * 0.053;
    b.add(m.switchBlack, box([x, y, oc.centre.z + 0.027], [0.02, 0.03, 0.006], 0.002));
    b.add(m.metal, tube([x, y, oc.centre.z + 0.03], [x + 0.006, y, oc.centre.z + 0.045], 0.0035, 0.003, 6));
  }
  const pl = BO105_POWER_LEVERS;
  // Quadrant: a roof-mounted housing with the lever slots and the OFF / IDLE / FLIGHT gates.
  b.add(m.frame, box([pl.pivot.x, 0, pl.pivot.z - 0.005], [0.20, 0.15, 0.045], 0.01));
  for (const y of pl.ys) b.add(m.switchBlack, box([pl.pivot.x, y, pl.pivot.z + 0.018], [0.17, 0.016, 0.004], 0.001));
  const levers = pl.ys.map((y, i) => {
    const lever = new THREE.Group(); lever.name = `bo105PowerLever${i + 1}`;
    lever.position.copy(frd(pl.pivot.x, y, pl.pivot.z));
    const parts = new MeshBatch();
    parts.add(m.metal, tube([0, 0, 0], [0, 0, pl.length - 0.03], 0.006));
    parts.add(m.switchBlack, ellipsoid([0, 0, pl.length - 0.01], [0.022, 0.016, 0.03], 14, 10));
    parts.add(m.metal, tube([0, -0.012, 0], [0, 0.012, 0], 0.012, 0.012, 10));
    lever.add(parts.build(`bo105PowerLever${i + 1}Parts`));
    return lever;
  });

  // ---------------------------------------------------------------- floor details
  for (const y of def.cockpit.pedals.ys) b.add(m.dark, box([def.cockpit.pedals.x - 0.17, y, FLOOR_Z - 0.008], [0.22, 0.10, 0.014], 0.005));
  // Fire extinguisher on the floor by the co-pilot's door post. ESTIMATE
  b.add(m.red, tube([S(1.95), -PILOT_SEAT_Y - 0.24, FLOOR_Z - 0.06], [S(1.95), -PILOT_SEAT_Y - 0.24, FLOOR_Z - 0.36], 0.04, 0.04, 16));
  const group = b.build('bo105CabinDetails', { cast: false, receive: true });
  group.add(pod, slant, ...levers);

  // ---------------------------------------------------------------- the pilot's cyclic: the curved Bo 105 stick
  for (const child of cockpit.cyclic.children) child.visible = false;
  const stick = new THREE.Group(); stick.name = 'bo105Cyclic';
  const parts = new MeshBatch();
  const stem = def.rotorcraftVisual!.cyclic!.stem, end = stem[stem.length - 1];
  parts.add(m.rubber, ellipsoid([0, 0, -0.03], [0.07, 0.06, 0.04], 16, 8)); // floor boot
  parts.add(m.grey, pathTube(stem, 0.016, 50));
  // Grip: canted handle with the cyclic trim switch (coolie hat) on top, trigger in front, red button.
  parts.add(m.switchBlack, tube([end[0] + 0.005, 0, end[2] + 0.01], [end[0] - 0.035, 0, end[2] - 0.13], 0.02, 0.023, 14));
  parts.add(m.switchBlack, ellipsoid([end[0] - 0.04, 0, end[2] - 0.135], [0.034, 0.028, 0.022], 14, 8));
  parts.add(m.grey, tube([end[0] - 0.04, 0.0, end[2] - 0.155], [end[0] - 0.04, 0.0, end[2] - 0.165], 0.008, 0.006, 10));
  parts.add(m.red, box([end[0] - 0.02, 0.022, end[2] - 0.14], [0.012, 0.012, 0.012], 0.003));
  parts.add(m.dark, box([end[0] + 0.02, 0, end[2] - 0.075], [0.012, 0.014, 0.03], 0.003));
  stick.add(parts.build('bo105CyclicGripAndTrim')); cockpit.cyclic.add(stick);

  // ---------------------------------------------------------------- collective head with the ENGINE TRIM switch
  const trimSwitches: THREE.Group[] = [];
  cockpit.collectives.forEach((lever, i) => {
    const head = new MeshBatch(), L = def.rotorcraftVisual!.collective.length;
    cockpit.throttles[i].visible = false; // no twist grip: the power levers are overhead
    head.add(m.rubber, tube([L - 0.20, 0, 0], [L - 0.06, 0, 0], 0.019, 0.019, 16)); // grip sleeve
    head.add(m.switchBlack, box([L - 0.02, 0, -0.025], [0.07, 0.05, 0.05], 0.008)); // switch box
    head.add(m.metal, tube([L - 0.04, 0.016, -0.05], [L - 0.04, 0.016, -0.066], 0.004)); // landing-light switch
    head.add(m.red, tube([L + 0.015, 0, -0.01], [L + 0.025, 0, -0.01], 0.010, 0.010, 12)); // trim release
    head.add(m.metal, tube([L - 0.25, 0, 0], [L - 0.25, 0.04, 0], 0.009)); // friction knob stem
    head.add(m.dark, tube([L - 0.25, 0.04, 0], [L - 0.25, 0.055, 0], 0.016, 0.016, 12));
    lever.add(head.build(`bo105CollectiveHead${i}`));
    const trim = new THREE.Group(); trim.name = 'bo105EngineTrimSwitch';
    trim.position.copy(frd(L - 0.005, -0.004, -0.05));
    const hat = new MeshBatch();
    hat.add(m.metal, tube([0, 0, 0], [0, 0, -0.014], 0.004));
    hat.add(m.switchBlack, ellipsoid([0, 0, -0.016], [0.009, 0.009, 0.005], 10, 6));
    trim.add(hat.build('bo105EngineTrimHat')); lever.add(trim); trimSwitches.push(trim);
  });
  return { group, stick, levers, trimSwitches, update(c: ControlInputs) {
    cockpit.cyclic.rotation.set(0, 0, 0);
    stick.rotation.set(c.elevator * STICK_PITCH_DEG * Math.PI / 180, 0, -c.aileron * STICK_ROLL_DEG * Math.PI / 180);
    levers.forEach((l, i) => { l.rotation.x = powerLeverAngle(engineControl(c, i, 'throttle')); });
    // ENGINE TRIM: fore (INCREASE) tilts the hat forward, right (more torque on engine 2) tilts it right.
    for (const t of trimSwitches) t.rotation.set(-(c.n2Beep ?? 0) * TRIM_SWITCH_THROW, 0, -(c.n2BeepSplit ?? 0) * TRIM_SWITCH_THROW);
  } };
}
