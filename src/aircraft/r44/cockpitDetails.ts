// Closed-door four-place R44 cabin: MM chapter 15, POH 7-6/7-7, Robinson's console photographs.
// Furniture, seams, fasteners and switch bodies are visual ESTIMATES. The common cockpit supplies the
// animated cyclic/collective/pedals and the complete enclosure on the frozen PANEL_* face and UVs.
import * as THREE from 'three';
import type { AirframeVisualDef } from '../../render/aircraft/airframe/types';
import { frd, MeshBatch } from '../../render/aircraft/geometry';
import { box, pathTube, tube } from '../../render/aircraft/rotorcraft/geometry';
import type { RotorcraftCockpit } from '../../render/aircraft/rotorcraft/cockpit';
import { PANEL_CANVAS, PANEL_ENCLOSURE_DEPTH, PANEL_FACE, PANEL_OUTLINE } from './dimensions';
import { ellipsoid, skinPath, type R44DetailMaterials, type R44SkinWidth } from './exteriorGeometry';

export function buildR44CockpitDetails(def: AirframeVisualDef, cockpit: RotorcraftCockpit,
  mat: R44DetailMaterials, skin: R44SkinWidth): THREE.Group {
  const fixed = new MeshBatch();
  for (const seat of def.cockpit.seats) {
    const z = seat.z!, backX = seat.x - seat.depth, centre = seat.x - seat.depth / 2;
    // Four separate bucket cushions with rolled edge bolsters and seam piping. Rear cushion boxes
    // enclose the under-seat baggage spaces; there is no two-place bench spanning the centre tunnel.
    for (const dy of [-1, 1]) {
      const y = seat.y + dy * (seat.width / 2 - 0.025);
      fixed.add(mat.leather, ellipsoid([centre, y, z - 0.012], [seat.depth * 0.43, 0.037, 0.042]));
      const roll = box([0, 0, 0], [0.12, 0.067, 0.54], 0.03);
      roll.rotateX(-seat.reclineDeg! * Math.PI / 180);
      roll.translate(...frd(backX + 0.025, y, z - 0.24).toArray()); fixed.add(mat.leather, roll);
      fixed.add(mat.stitch, pathTube([[seat.x - 0.055, y, z - 0.041], [centre, y, z - 0.052], [backX + 0.06, y, z - 0.041]], 0.0015, 20));
    }
    fixed.add(mat.leather, box([seat.x - 0.024, seat.y, z + 0.040], [0.048, seat.width - 0.075, 0.074], 0.022));
    fixed.add(mat.dark, box([seat.x - 0.02, seat.y, z + 0.16], [0.02, 0.085, 0.035], 0.006));
    fixed.add(mat.metal, tube([seat.x - 0.001, seat.y - 0.030, z + 0.162], [seat.x - 0.001, seat.y + 0.030, z + 0.162], 0.004));
    // Shoulder-belt reel/anchor behind each seat and buckle release on the lap belt.
    fixed.add(mat.dark, box([backX - 0.075, seat.y + 0.10, z - 0.49], [0.055, 0.068, 0.077], 0.018));
    fixed.add(mat.red, box([seat.x - 0.16, seat.y + 0.012, z - 0.046], [0.023, 0.028, 0.008], 0.003));
  }
  // Inner door sills, padded armrests, release levers and front fresh-air vents. Everything follows
  // the lining instead of a cabin-width rectangular wall which would intersect the curved glazing.
  for (const side of [-1, 1]) {
    for (const door of def.glazing.doors) {
      const handle = door.handle!;
      fixed.add(mat.dark, pathTube(skinPath(skin, side, [[handle.x + 0.31, 0.29], [handle.x + 0.08, 0.30], [handle.x - 0.04, 0.29]], -0.024), 0.022, 28));
      const [p] = skinPath(skin, side, [[handle.x, handle.z]], -0.034);
      fixed.add(mat.metal, tube([p[0] - 0.04, p[1], p[2]], [p[0] + 0.04, p[1], p[2] - 0.018], 0.009));
    }
    fixed.add(mat.dark, ellipsoid([1.64, side * 0.47, 0.30], [0.056, 0.021, 0.045]));
    fixed.add(mat.metal, tube([1.64, side * 0.455, 0.29], [1.64, side * 0.437, 0.29], 0.019));
  }
  // Low centre tunnel behind the pedestal and rounded pedal heel rests, clear of the control travel.
  fixed.add(mat.dark, box([0.97, 0.015, 0.505], [1.10, 0.13, 0.055], 0.020));
  for (const y of def.cockpit.pedals.ys) {
    fixed.add(mat.dark, box([1.83, y, def.cockpit.floor.z - 0.007], [0.22, 0.105, 0.017], 0.009));
    fixed.add(mat.metal, tube([1.87, y, 0.494], [1.97, y, 0.47], 0.008));
  }
  // Overhead map light, cable conduit and rotor-brake handle (static; no brake state exists yet).
  fixed.add(mat.dark, box([0.98, 0, -0.677], [0.26, 0.11, 0.052], 0.020));
  fixed.add(mat.metal, ellipsoid([1.05, 0.005, -0.642], [0.040, 0.035, 0.025]));
  fixed.add(mat.dark, tube([0.84, -0.03, -0.66], [0.68, -0.03, -0.61], 0.010));
  fixed.add(mat.rubber, tube([0.74, -0.03, -0.628], [0.67, -0.03, -0.607], 0.017));
  const group = fixed.build('r44CabinDetails', { cast: false, receive: true });

  // Fasteners are on the enclosure sides, ahead of the UV face. No new surface covers a panel pixel,
  // and no gauge, placard or click target is duplicated by the geometry worker.
  const pod = new THREE.Group(); pod.name = 'r44ConsoleFasteners';
  pod.position.copy(frd(PANEL_FACE.centre.x, PANEL_FACE.centre.y, PANEL_FACE.centre.z));
  pod.rotation.x = -PANEL_FACE.tiltBackDeg * Math.PI / 180;
  const screws = new MeshBatch();
  for (const side of [-1, 1]) for (const v of [0.065, 0.22]) {
    const x = side * (PANEL_FACE.width / 2 + 0.013);
    const y = PANEL_FACE.height / 2 - v;
    // Raw local panel coordinates: X lateral, Y up, Z aft.
    const g = new THREE.CylinderGeometry(0.0045, 0.0045, 0.003, 8);
    g.rotateZ(Math.PI / 2); g.translate(x, y, -PANEL_ENCLOSURE_DEPTH * 0.55); screws.add(mat.metal, g);
  }
  // Keep this assembly bound to the same polygon; checks use the canvas aspect and all outline points.
  pod.userData.panelCanvas = PANEL_CANVAS; pod.userData.panelOutline = PANEL_OUTLINE;
  pod.add(screws.build('r44ConsoleScrews')); group.add(pod);

  // Three irreversible main-control servos are inside the mast cowl, not additional cockpit sticks.
  // Cockpit detail adds the friction knobs and switch housings to the existing moving controls.
  const stem = new MeshBatch();
  stem.add(mat.rubber, ellipsoid([0, 0, -0.028], [0.074, 0.058, 0.051]));
  stem.add(mat.metal, tube([-0.01, 0, -0.10], [-0.01, -0.085, -0.10], 0.009));
  stem.add(mat.dark, tube([-0.01, -0.075, -0.10], [-0.01, -0.105, -0.10], 0.024, 0.024, 16));
  stem.add(mat.dark, box([-0.065, -0.023, -0.34], [0.048, 0.065, 0.065], 0.008));
  stem.add(mat.metal, tube([-0.041, -0.023, -0.34], [-0.024, -0.023, -0.34], 0.003));
  cockpit.cyclic.add(stem.build('r44CyclicFriction'));
  const switches = new MeshBatch();
  const rightY = def.rotorcraftVisual!.cyclic!.gripYs![1];
  switches.add(mat.dark, box([0.075, rightY, -0.135], [0.048, 0.061, 0.045], 0.014));
  switches.add(mat.metal, tube([0.065, rightY - 0.034, -0.144], [0.065, rightY - 0.046, -0.155], 0.003));
  cockpit.bar.add(switches.build('r44HydraulicSwitch'));
  cockpit.collectives.forEach((lever, i) => {
    const b = new MeshBatch();
    b.add(mat.rubber, ellipsoid([0.03, 0, 0], [0.11, 0.042, 0.05]));
    b.add(mat.dark, tube([0.01, -0.015, -0.04], [-0.055, -0.015, -0.058], 0.007));
    if (i === 1) {
      b.add(mat.dark, box([0.28, 0, -0.024], [0.08, 0.055, 0.053], 0.010));
      b.add(mat.metal, tube([0.29, -0.029, -0.023], [0.29, -0.043, -0.038], 0.003));
      b.add(mat.red, ellipsoid([0.30, 0, -0.054], [0.009, 0.009, 0.004]));
    }
    lever.add(b.build(i === 1 ? 'r44PilotCollectiveSwitches' : 'r44CopilotCollectiveBoot'));
  });
  return group;
}
