// MD 500E crew compartment, pilot in the LEFT seat (LH command). RFM Fig 4-4 / sect. 12 of research-md500.md: the
// cyclic grip carries the 4-way trim "coolie" (top right) and the ICS/COMM trigger; the collective head carries the
// START button on its end cap, the governor INC/DEC (beep) switch and the landing-light switch, with the IDLE
// RELEASE ring at the head of the twist grip. Slant console below the panel: FUEL VALVE pull knob and key switch
// on the left, edge-lit switch rows (MD spec: 16.3 x 10.1 in). Positions and proportions are ESTIMATES from the
// Radecki cockpit photograph (CC BY 2.5) and MD's crew-compartment dimensions; dual controls are not fitted.
import * as THREE from 'three';
import type { AirframeVisualDef } from '../../render/aircraft/airframe/types';
import type { RotorcraftCockpit } from '../../render/aircraft/rotorcraft/cockpit';
import type { ControlInputs } from '../../core/types';
import { frd, MeshBatch } from '../../render/aircraft/geometry';
import { box, tube, pathTube } from '../../render/aircraft/rotorcraft/geometry';
import { MD500_CONSOLE, MD500_PANEL_CANVAS, MD500_PANEL_FACE, MD500_PANEL_OUTLINE } from './panelLayout';
import { FLOOR_Z, PILOT_SEAT, SEAT_CENTRES } from './dimensions';
import { SEAT, sta, wl } from './visual';
import { ellipsoid, type MD500Materials, type MD500SkinWidth } from './exteriorGeometry';

/** Cyclic travel shown on the stick, deg (visual: about the OH-6A 12.5 in / 11.5 in stick travel at the grip). */
export const STICK_PITCH_DEG = 11, STICK_ROLL_DEG = 9;

export function buildMD500Cockpit(def: AirframeVisualDef, cockpit: RotorcraftCockpit, m: MD500Materials, lining: MD500SkinWidth) {
  const b = new MeshBatch();
  // Seats: the 500's crew seats are upholstered pans on the cargo-compartment bulkhead (STA 78.5); bolsters,
  // back cushion and the lap belt / shoulder harness over the generic seat.
  for (const seat of def.cockpit.seats) {
    const z = seat.z!, backX = seat.x - seat.depth;
    for (const side of [-1, 1]) b.add(m.seat, ellipsoid([seat.x - seat.depth / 2, seat.y + side * (seat.width / 2 - 0.03), z - 0.01],
      [seat.depth * 0.45, 0.035, 0.04], 16, 10));
    b.add(m.seat, box([backX + 0.035, seat.y, z - 0.30], [0.07, seat.width - 0.04, 0.50], 0.03));
    b.add(m.seatTrim, box([seat.x - 0.17, seat.y, z - 0.032], [0.04, 0.06, 0.012], 0.003));
  }
  // Bulkhead behind the crew seats, up to the seat-back top, across the lining width.
  const bulkX = sta(78.5) - 0.01, bulkTop = SEAT.z - 0.62;
  for (let k = 0; k < 6; k++) {
    const z0 = THREE.MathUtils.lerp(FLOOR_Z, bulkTop, k / 6), z1 = THREE.MathUtils.lerp(FLOOR_Z, bulkTop, (k + 1) / 6), zc = (z0 + z1) / 2;
    const hw = Math.min(lining(bulkX, z0), lining(bulkX, z1)) - 0.01;
    if (hw > 0.05) b.add(m.frame, box([bulkX - 0.01, 0, zc], [0.02, 2 * hw, Math.abs(z1 - z0) + 0.002], 0.004));
  }
  // Slant console below the panel pod: switch rows, FUEL VALVE pull knob, key switch, fresh-air knob.
  const tilt = MD500_PANEL_FACE.tiltBackDeg * Math.PI / 180, ph = MD500_PANEL_FACE.height;
  const bottom = { x: MD500_PANEL_FACE.centre.x - ph / 2 * Math.sin(tilt), z: MD500_PANEL_FACE.centre.z + ph / 2 * Math.cos(tilt) };
  const ct = MD500_CONSOLE.tiltBackDeg * Math.PI / 180, ch = MD500_CONSOLE.height, cw = MD500_CONSOLE.width;
  const consoleCentre = { x: bottom.x - ch / 2 * Math.sin(ct) + 0.012, z: bottom.z + ch / 2 * Math.cos(ct) };
  const slant = new THREE.Group(); slant.name = 'md500SlantConsole';
  slant.position.copy(frd(consoleCentre.x, 0, consoleCentre.z)); slant.rotation.x = -ct;
  const sc = new MeshBatch();
  // In the slant group: local x right, y up the console face, z out of the face (towards the pilot).
  sc.add(m.frame, new THREE.BoxGeometry(cw, ch, 0.05).translate(0, 0, -0.025));
  for (let row = 0; row < 2; row++) for (let k = 0; k < 6; k++) {
    const x = -cw / 2 + 0.07 + k * 0.055, y = ch / 2 - 0.06 - row * 0.06;
    sc.add(m.dark, new THREE.BoxGeometry(0.03, 0.022, 0.006).translate(x, y, 0.003));
    sc.add(m.metal, new THREE.CylinderGeometry(0.0035, 0.0035, 0.018, 6).rotateX(Math.PI / 2 - 0.3).translate(x, y, 0.012));
  }
  sc.add(m.red, new THREE.CylinderGeometry(0.014, 0.014, 0.012, 16).rotateX(Math.PI / 2).translate(-cw / 2 + 0.04, -ch / 2 + 0.07, 0.03));
  sc.add(m.metal, new THREE.CylinderGeometry(0.004, 0.004, 0.025, 6).rotateX(Math.PI / 2).translate(-cw / 2 + 0.04, -ch / 2 + 0.07, 0.014));
  sc.add(m.metal, new THREE.CylinderGeometry(0.011, 0.011, 0.008, 16).rotateX(Math.PI / 2).translate(-cw / 2 + 0.045, -ch / 2 + 0.025, 0.004));
  sc.add(m.dark, new THREE.CylinderGeometry(0.012, 0.012, 0.016, 16).rotateX(Math.PI / 2).translate(cw / 2 - 0.04, -ch / 2 + 0.05, 0.008));
  slant.add(sc.build('md500SlantConsoleParts', { cast: false, receive: true }));
  // Panel hood: the annunciator strip sits on top of the panel under a shallow glare hood (Radecki photograph).
  const pod = new THREE.Group(); pod.name = 'md500PanelHood';
  pod.position.copy(frd(MD500_PANEL_FACE.centre.x, 0, MD500_PANEL_FACE.centre.z)); pod.rotation.x = -tilt;
  const hood = new MeshBatch();
  const pw = MD500_PANEL_FACE.width;
  hood.add(m.frame, new THREE.BoxGeometry(pw + 0.05, 0.012, 0.12).translate(0, ph / 2 + 0.008, 0.035));
  for (const s of [-1, 1]) hood.add(m.frame, new THREE.BoxGeometry(0.012, ph + 0.02, 0.10).translate(s * (pw / 2 + 0.02), 0, 0.02));
  pod.userData.panelOutline = MD500_PANEL_OUTLINE; pod.userData.panelCanvas = MD500_PANEL_CANVAS;
  pod.add(hood.build('md500PanelHoodParts', { cast: false, receive: true }));
  // Fire extinguisher on the left door post ahead of the pilot (Radecki photograph).
  const pilotY = SEAT_CENTRES[PILOT_SEAT].y;
  b.add(m.red, tube([sta(56), pilotY - 0.19, FLOOR_Z - 0.06], [sta(56), pilotY - 0.19, FLOOR_Z - 0.36], 0.04, 0.04, 16));
  b.add(m.dark, tube([sta(56), pilotY - 0.19, FLOOR_Z - 0.36], [sta(56), pilotY - 0.19, FLOOR_Z - 0.41], 0.018, 0.018, 10));
  // Overhead: the roof frame between the eyebrow windows carries the cabin/map light and a grab handle.
  b.add(m.frame, box([sta(64), 0, wl(64.6)], [0.42, 0.06, 0.03], 0.01));
  b.add(m.lens, ellipsoid([sta(70), 0, wl(63.8)], [0.03, 0.03, 0.012], 12, 8));
  b.add(m.dark, pathTube([[sta(58), pilotY + 0.06, wl(64.2)], [sta(60), pilotY + 0.06, wl(61.5)], [sta(66), pilotY + 0.06, wl(61.5)], [sta(68), pilotY + 0.06, wl(64.2)]], 0.008, 20));
  // Floor-mounted pedal tubes and heel plates; footwell rails.
  for (const y of def.cockpit.pedals.ys) b.add(m.dark, box([def.cockpit.pedals.x - 0.16, y, FLOOR_Z - 0.008], [0.20, 0.10, 0.014], 0.005));
  const group = b.build('md500CabinDetails', { cast: false, receive: true });
  group.add(slant, pod);

  // The 500 cyclic: a curved tube rising from the floor ahead of the seat, the grip leaning aft (Radecki photograph).
  for (const child of cockpit.cyclic.children) child.visible = false;
  const stick = new THREE.Group(); stick.name = 'md500Cyclic'; stick.position.x = pilotY;
  const parts = new MeshBatch();
  const stem = def.rotorcraftVisual!.cyclic!.stem, end = stem[stem.length - 1];
  parts.add(m.rubber, ellipsoid([0, 0, -0.02], [0.06, 0.055, 0.03], 16, 8)); // floor boot
  parts.add(m.dark, pathTube(stem, 0.0135, 50));
  // Grip: canted handle, coolie hat on top right, ICS trigger in front.
  const grip = tube([end[0] + 0.01, 0, end[2] + 0.02], [end[0] - 0.035, 0, end[2] - 0.115], 0.019, 0.022, 14);
  parts.add(m.rubber, grip);
  parts.add(m.dark, ellipsoid([end[0] - 0.038, 0, end[2] - 0.12], [0.03, 0.025, 0.02], 14, 8));
  parts.add(m.grey, tube([end[0] - 0.035, 0.012, end[2] - 0.135], [end[0] - 0.035, 0.012, end[2] - 0.145], 0.0075, 0.006, 10));
  parts.add(m.red, box([end[0] + 0.022, 0, end[2] - 0.075], [0.012, 0.012, 0.02], 0.003));
  stick.add(parts.build('md500CyclicGripAndTrim')); cockpit.cyclic.add(stick);

  // Collective head: friction nut, ribbed twist grip, idle-release ring, end cap with START button and switch box.
  cockpit.collectives.forEach((lever, i) => {
    const head = new MeshBatch(), L = def.rotorcraftVisual!.collective.length;
    head.add(m.metal, tube([0, 0.03, 0], [0, 0.06, 0], 0.006));
    head.add(m.dark, tube([0, 0.055, 0], [0, 0.07, 0], 0.02));
    // Switch box ahead of the grip: governor INC/DEC beep switch and landing-light switch.
    head.add(m.dark, box([L - 0.005, 0, -0.03], [0.05, 0.05, 0.04], 0.008));
    head.add(m.metal, tube([L - 0.005, 0.012, -0.05], [L - 0.005, 0.012, -0.068], 0.004));
    head.add(m.metal, tube([L - 0.005, -0.014, -0.05], [L - 0.005, -0.014, -0.064], 0.003));
    head.add(m.red, tube([L + 0.022, 0, 0], [L + 0.03, 0, 0], 0.011, 0.011, 14)); // START button on the end cap
    head.add(m.dark, tube([L + 0.012, 0, 0], [L + 0.022, 0, 0], 0.022, 0.022, 18));
    lever.add(head.build(`md500CollectiveHead${i}`));
    const ribs = new MeshBatch();
    for (let j = 0; j < 9; j++) ribs.add(m.rubber, tube([-0.045 + j * 0.012, 0, 0], [-0.040 + j * 0.012, 0, 0], 0.0235));
    // Idle-release ring at the head of the twist grip.
    ribs.add(m.metal, tube([0.075, 0, 0], [0.083, 0, 0], 0.024, 0.024, 20));
    cockpit.throttles[i].add(ribs.build(`md500TwistGrip${i}`));
  });
  return { group, stick, update(c: ControlInputs) {
    cockpit.cyclic.rotation.set(0, 0, 0);
    stick.rotation.set(c.elevator * STICK_PITCH_DEG * Math.PI / 180, 0, -c.aileron * STICK_ROLL_DEG * Math.PI / 180);
  } };
}
