// 300CB cabin: two bucket seats, individual cyclics with electric trim hats, collective twist grips.
// Visual estimates from AOPA Apr 1997 p64 and CSP-C1-1 Fig 4-1/4-2A. No hydraulic/governor fittings.
import * as THREE from 'three';
import type { AirframeVisualDef } from '../../render/aircraft/airframe/types';
import type { RotorcraftCockpit } from '../../render/aircraft/rotorcraft/cockpit';
import type { ControlInputs } from '../../core/types';
import { frd, MeshBatch } from '../../render/aircraft/geometry';
import { box, tube, pathTube } from '../../render/aircraft/rotorcraft/geometry';
import { PANEL_FACE, PANEL_ENCLOSURE_DEPTH, PANEL_OUTLINE, PANEL_CANVAS } from './dimensions';
import { ellipsoid, skinPath, type S269Materials, type S269SkinWidth } from './exteriorGeometry';

export function buildS269Cockpit(def: AirframeVisualDef, cockpit: RotorcraftCockpit, m: S269Materials, skin: S269SkinWidth) {
  const b = new MeshBatch();
  for (const seat of def.cockpit.seats) {
    const x = seat.x - seat.depth / 2, backX = seat.x - seat.depth, z = seat.z!;
    for (const side of [-1, 1]) {
      const y = seat.y + side * (seat.width / 2 - 0.026);
      b.add(m.leather, ellipsoid([x, y, z - 0.012], [seat.depth * 0.44, 0.037, 0.048]));
      b.add(m.stitch, pathTube([[seat.x - 0.045, y, z - 0.038], [x, y, z - 0.061], [backX + 0.06, y, z - 0.044]], 0.002, 24));
      const roll = box([0, 0, 0], [0.13, 0.065, 0.55], 0.028);
      roll.rotateX(-seat.reclineDeg! * Math.PI / 180); roll.translate(...frd(backX + 0.005, y, z - 0.24).toArray()); b.add(m.leather, roll);
    }
    // Lap-belt buckle/reel, upholstered top seam and tubular seat-back frame.
    b.add(m.red, box([seat.x - 0.16, seat.y + 0.015, z - 0.047], [0.025, 0.028, 0.006], 0.002));
    b.add(m.dark, box([backX - 0.10, seat.y + 0.12, z - 0.48], [0.06, 0.07, 0.075], 0.017));
    b.add(m.cast, pathTube([[backX - 0.015, seat.y - 0.19, z + 0.06], [backX - 0.105, seat.y - 0.19, z - 0.49],
      [backX - 0.115, seat.y, z - 0.54], [backX - 0.105, seat.y + 0.19, z - 0.49], [backX - 0.015, seat.y + 0.19, z + 0.06]], 0.012, 45));
  }
  for (const side of [-1, 1]) {
    const door = def.glazing.doors[0];
    b.add(m.dark, pathTube(skinPath(skin, side, [[0.24, 0.19], [0.43, 0.28], [0.84, 0.32], [1.09, 0.23]], -0.019), 0.018, 45));
    const p = skinPath(skin, side, [[door.handle!.x, door.handle!.z]], -0.025)[0];
    b.add(m.metal, tube([p[0] - 0.035, p[1], p[2]], [p[0] + 0.040, p[1], p[2] - 0.02], 0.008));
  }
  for (const y of def.cockpit.pedals.ys) b.add(m.dark, box([1.12, y, def.cockpit.floor.z - 0.01], [0.20, 0.11, 0.018], 0.010));
  // Low floor conduit leaves two independent footwells around the fixed pedestal.
  b.add(m.dark, box([0.89, 0, def.cockpit.floor.z - 0.013], [0.65, 0.09, 0.026], 0.012));
  b.add(m.dark, box([0.59, 0, -1.057], [0.22, 0.09, 0.035], 0.012));
  b.add(m.metal, ellipsoid([0.62, 0, -1.033], [0.030, 0.023, 0.012]));
  const group = b.build('s269CabinDetails', { cast: false, receive: true });

  const pod = new THREE.Group(); pod.name = 's269ConsoleFasteners';
  pod.position.copy(frd(PANEL_FACE.centre.x, PANEL_FACE.centre.y, PANEL_FACE.centre.z));
  pod.rotation.x = -PANEL_FACE.tiltBackDeg * Math.PI / 180;
  const screws = new MeshBatch();
  for (const side of [-1, 1]) for (const h of [0.08, 0.32, 0.53]) {
    const g = new THREE.CylinderGeometry(0.0045, 0.0045, 0.003, 8); g.rotateZ(Math.PI / 2);
    g.translate(side * (PANEL_FACE.width / 2 + 0.013), PANEL_FACE.height / 2 - h, -PANEL_ENCLOSURE_DEPTH / 2); screws.add(m.metal, g);
  }
  pod.userData.panelOutline = PANEL_OUTLINE; pod.userData.panelCanvas = PANEL_CANVAS;
  pod.add(screws.build('s269ConsoleScrews')); group.add(pod);

  // The shared individual-stick group rolls about the cabin centre. Replace that motion with two
  // local floor pivots so lateral input never translates one stick's base up through the floor.
  for (const child of cockpit.cyclic.children) child.visible = false;
  const sticks = def.rotorcraftVisual!.cyclic!.gripYs.map((y, i) => {
    const stick = new THREE.Group(); stick.name = `s269Cyclic${i}`; stick.position.x = y;
    const parts = new MeshBatch();
    const stem = def.rotorcraftVisual!.cyclic!.stem, end = stem[stem.length - 1];
    parts.add(m.dark, pathTube(stem, 0.013, 40));
    parts.add(m.rubber, ellipsoid([0, 0, -0.027], [0.053, 0.049, 0.034]));
    parts.add(m.rubber, ellipsoid([end[0], 0, end[2]], [0.031, 0.025, 0.070]));
    parts.add(m.dark, box([end[0] + 0.005, 0, end[2] - 0.059], [0.055, 0.056, 0.033], 0.013));
    parts.add(m.cast, box([end[0], 0, end[2] - 0.079], [0.017, 0.025, 0.009], 0.004));
    parts.add(m.red, ellipsoid([end[0] + 0.021, 0.018, end[2] - 0.061], [0.009, 0.006, 0.008]));
    parts.add(m.metal, tube([0, 0, -0.06], [0, -0.065, -0.06], 0.005));
    parts.add(m.dark, tube([0, -0.055, -0.06], [0, -0.083, -0.06], 0.018));
    stick.add(parts.build('s269CyclicGripAndTrim')); cockpit.cyclic.add(stick); return stick;
  });
  cockpit.collectives.forEach((lever, i) => {
    const parts = new MeshBatch();
    parts.add(m.rubber, ellipsoid([0.02, 0, 0], [0.068, 0.045, 0.038]));
    parts.add(m.metal, tube([0, 0.016, 0], [0, 0.060, 0], 0.007));
    parts.add(m.dark, tube([0, 0.051, 0], [0, 0.068, 0], 0.022));
    lever.add(parts.build(`s269CollectiveFriction${i}`));
    const grip = new MeshBatch();
    for (let j = 0; j < 10; j++) grip.add(m.rubber, tube([-0.045 + j * 0.011, 0, 0], [-0.040 + j * 0.011, 0, 0], 0.022));
    cockpit.throttles[i].add(grip.build('s269ThrottleRibs'));
  });
  return { group, update(c: ControlInputs) {
    cockpit.cyclic.rotation.set(0, 0, 0);
    for (const stick of sticks) stick.rotation.set(c.elevator * 12 * Math.PI / 180, 0, -c.aileron * 12 * Math.PI / 180);
  } };
}
