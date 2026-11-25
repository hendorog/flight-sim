// Richard Pearse Waitohi Monoplane: bespoke procedural 3D open airframe matching the Waitohi Memorial & NZ Patent 21476.
//
// Builds the exact iconic features seen on the Richard Pearse Memorial reconstruction:
//   1. Rectangular open grid-ribbed underside lattice across the flat 7.62 m x 2.00 m parasol wing (four spanwise
//      spars and thirteen chordwise ribs forming square bays), with framed outer bays housing the inset ailerons;
//   2. Tubular mast & perimeter framing around the tall rectangular sail in the centre of the wing, with diagonal
//      guy wires from the top of the sail out to both wingtips, plus rear-edge wing elevator hinge brackets;
//   3. Two-vane diamond/square black paddle variable-pitch airscrew on long tubular arms at the wing leading edge,
//      driven by the horizontally-opposed 2-cylinder double-acting engine & black cylindrical wing-top petrol tank;
//   4. Open vertical silver-grey tubular-steel undercarriage frame below the wing (four vertical hangers down to the
//      lower triangular chassis, suspended tubular pilot seat, diagonal flying wires out to the outer wing spars) and
//      three tall, ultra-thin wire-spoked bicycle wheels (steerable front wheel + wide-track rear wheels).

import * as THREE from 'three';
import type { PropellerState, WheelState } from '../../core/types';
import type { AirframeVisualDef, FRD } from '../../render/aircraft/airframe/types';
import { bladeBlur } from '../../render/aircraft/bladeBlur';
import { frd, gridGeometry, MeshBatch } from '../../render/aircraft/geometry';
import { box, tube } from '../../render/aircraft/rotorcraft/geometry';

export interface PearseExterior {
  group: THREE.Group;
  moving: THREE.Object3D[];
  materials: THREE.Material[];
  textures: THREE.Texture[];
  update(wheels: readonly WheelState[], prop?: PropellerState): void;
}

/** Build a tall, ultra-thin wire-spoked bicycle wheel (tyre + rim + 24 fine crossed spokes + hub) about local X. */
function buildThinBicycleWheel(
  tyreMat: THREE.Material,
  rimMat: THREE.Material,
  spokeMat: THREE.Material,
  radius: number,
): THREE.Group {
  const b = new MeshBatch();
  const tubeR = 0.015;
  const rimR = radius - tubeR * 1.35;

  // Narrow black pneumatic bicycle tyre.
  const tyre = new THREE.TorusGeometry(radius - tubeR, tubeR, 10, 40);
  tyre.rotateY(Math.PI / 2);
  b.add(tyreMat, tyre);

  // Steel inner wheel rim.
  const rim = new THREE.TorusGeometry(rimR, 0.007, 8, 36);
  rim.rotateY(Math.PI / 2);
  b.add(rimMat, rim);

  // Narrow steel axle hub barrel and spoke flanges.
  const hub = new THREE.CylinderGeometry(0.016, 0.016, 0.075, 12);
  hub.rotateZ(Math.PI / 2);
  b.add(rimMat, hub);
  for (const sx of [-0.028, 0.028]) {
    const flange = new THREE.CylinderGeometry(0.026, 0.026, 0.004, 14);
    flange.rotateZ(Math.PI / 2);
    flange.translate(sx, 0, 0);
    b.add(rimMat, flange);
  }

  // 24 fine crossed steel spokes.
  const spokeCount = 24;
  for (let i = 0; i < spokeCount; i++) {
    const a0 = (i / spokeCount) * Math.PI * 2;
    const a1 = a0 + (i % 2 === 0 ? 0.24 : -0.24);
    const sx = i % 2 === 0 ? -0.026 : 0.026;
    const p0 = new THREE.Vector3(sx, Math.cos(a0) * 0.022, Math.sin(a0) * 0.022);
    const p1 = new THREE.Vector3(0, Math.cos(a1) * (rimR - 0.004), Math.sin(a1) * (rimR - 0.004));
    const d = new THREE.Vector3().subVectors(p1, p0);
    const g = new THREE.CylinderGeometry(0.0018, 0.0018, d.length(), 4);
    g.translate(0, d.length() / 2, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
    g.translate(p0.x, p0.y, p0.z);
    b.add(spokeMat, g);
  }

  return b.build('pearseBicycleWheel');
}

/** Build Pearse's signature two-vane diamond/square black paddle airscrew on long tubular arms (local spin around Z). */
function buildPaddlePropeller(
  baseArmMat: THREE.MeshStandardMaterial,
  baseVaneMat: THREE.MeshStandardMaterial,
  baseCollarMat: THREE.MeshStandardMaterial,
  diameter: number,
): {
  group: THREE.Group;
  blades: THREE.Group;
  bladeMats: THREE.MeshStandardMaterial[];
  disc: THREE.Mesh;
  discMat: THREE.MeshBasicMaterial;
  discTex: THREE.DataTexture;
} {
  const group = new THREE.Group();
  group.name = 'pearsePaddleProp';

  // Central shaft sleeve stays opaque on the hub; spinning arms & paddles fade smoothly with bladeBlur(rpm, 2)
  // so TemporalAA never ghosts opaque paddles across the cockpit or chase view!
  const hubBatch = new MeshBatch();
  const hubCyl = new THREE.CylinderGeometry(0.032, 0.032, 0.16, 14);
  hubCyl.rotateX(Math.PI / 2);
  hubBatch.add(baseCollarMat, hubCyl);
  group.add(hubBatch.build('pearsePaddleHub'));

  const armMat = baseArmMat.clone();
  const vaneMat = baseVaneMat.clone();
  const collarMat = baseCollarMat.clone();
  const bladeMats = [armMat, vaneMat, collarMat];
  for (const m of bladeMats) {
    m.transparent = true;
    m.depthWrite = true;
  }

  const b = new MeshBatch();
  const R = diameter / 2; // 0.99 m

  // Main tubular cross-shaft running all the way through both diamond paddle vanes (-0.95 R .. +0.95 R).
  const crossArm = new THREE.CylinderGeometry(0.013, 0.013, R * 1.9, 10);
  crossArm.rotateZ(Math.PI / 2);
  b.add(armMat, crossArm);

  // Two angled black diamond/square paddle sails at opposite ends of the cross-arm, exactly as on the Memorial!
  const pitchRad = (28 * Math.PI) / 180;
  for (const side of [-1, 1] as const) {
    const rCentre = side * (R * 0.72);
    const sideLen = 0.42;
    const halfDiag = (sideLen * Math.SQRT2) / 2; // ~0.297 m diamond half-diagonal!

    // Thin double-sided diamond plate tilted by pitchRad around the radial arm (model X), rotated 45 deg in plane so
    // its corners point radially and tangentially like a diamond!
    const vaneGeo = gridGeometry({
      rows: 2,
      cols: 2,
      position(i, j, out) {
        const su = i - 0.5;
        const sv = j - 0.5;
        const radial = (su - sv) * sideLen * 0.7071;
        const tang = (su + sv) * sideLen * 0.7071;
        const x = rCentre + radial;
        const y = tang * Math.cos(pitchRad);
        const z = -side * tang * Math.sin(pitchRad);
        out.set(x, y, z);
      },
    });
    b.add(vaneMat, vaneGeo);

    // Tubular diagonal perimeter ribs & pitch-control brace rod to each diamond vane.
    const corners = [
      new THREE.Vector3(rCentre + halfDiag, 0, 0),
      new THREE.Vector3(rCentre, halfDiag * Math.cos(pitchRad), -side * halfDiag * Math.sin(pitchRad)),
      new THREE.Vector3(rCentre - halfDiag, 0, 0),
      new THREE.Vector3(rCentre, -halfDiag * Math.cos(pitchRad), side * halfDiag * Math.sin(pitchRad)),
    ];
    for (let k = 0; k < 4; k++) {
      const c0 = corners[k];
      const c1 = corners[(k + 1) % 4];
      const d = new THREE.Vector3().subVectors(c1, c0);
      const edge = new THREE.CylinderGeometry(0.006, 0.006, d.length(), 6);
      edge.translate(0, d.length() / 2, 0);
      edge.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
      edge.translate(c0.x, c0.y, c0.z);
      b.add(armMat, edge);
    }
    const rodStart = new THREE.Vector3(side * 0.08, 0, -0.05);
    const rodEnd = corners[1];
    const rd = new THREE.Vector3().subVectors(rodEnd, rodStart);
    const rod = new THREE.CylinderGeometry(0.005, 0.005, rd.length(), 6);
    rod.translate(0, rd.length() / 2, 0);
    rod.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), rd.normalize()));
    rod.translate(rodStart.x, rodStart.y, rodStart.z);
    b.add(collarMat, rod);
  }

  const blades = b.build('pearsePaddleBlades');
  group.add(blades);

  // Subtle annular motion-blur ring over the outer paddle sweep [0.40 R .. 1.0 R] when spinning fast.
  const texW = 128;
  const data = new Uint8Array(texW * 4);
  for (let i = 0; i < texW; i++) {
    const f = (i + 0.5) / texW;
    const armBand = f > 0.06 && f < 0.45 ? 10 : 0;
    const paddleBand = Math.round(36 * Math.exp(-(((f - 0.72) / 0.17) ** 2)));
    const rim = Math.min(1, Math.max(0, (1 - f) / 0.04));
    const alpha = Math.round((armBand + paddleBand) * rim);
    data.set([24, 24, 26, alpha], i * 4);
  }
  const discTex = new THREE.DataTexture(data, texW, 1, THREE.RGBAFormat);
  discTex.colorSpace = THREE.SRGBColorSpace;
  discTex.magFilter = THREE.LinearFilter;
  discTex.minFilter = THREE.LinearFilter;
  discTex.needsUpdate = true;

  const discGeo = new THREE.RingGeometry(0.08, R, 48, 1);
  const uv = discGeo.getAttribute('uv') as THREE.BufferAttribute;
  const pos = discGeo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const r = Math.hypot(pos.getX(i), pos.getY(i)) / R;
    uv.setXY(i, r, 0.5);
  }
  const discMat = new THREE.MeshBasicMaterial({
    name: 'pearsePaddleBlur',
    map: discTex,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    opacity: 0,
  });
  const disc = new THREE.Mesh(discGeo, discMat);
  disc.renderOrder = 1;
  disc.visible = false;
  group.add(disc);

  return { group, blades, bladeMats, disc, discMat, discTex };
}

export function buildPearseExterior(def: AirframeVisualDef): PearseExterior {
  const srgb = (r: number, g: number, b: number) => new THREE.Color().setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);

  // Galvanised / painted light-grey tubular steel frame (matching the Waitohi Memorial's airy silver-grey tubes).
  const frameSteel = new THREE.MeshStandardMaterial({ name: 'pearseFrameSteel', color: srgb(172, 180, 184), roughness: 0.42, metalness: 0.62 });
  // Dark bamboo/steel wing-grid ribs & spars visible across the underside of the wing.
  const wingGrid = new THREE.MeshStandardMaterial({ name: 'pearseBamboo', color: srgb(58, 56, 50), roughness: 0.68, metalness: 0.25 });
  const castIron = new THREE.MeshStandardMaterial({ name: 'pearseCastIron', color: srgb(34, 35, 38), roughness: 0.62, metalness: 0.72 });
  const paddleBlack = new THREE.MeshStandardMaterial({
    name: 'pearsePaddle',
    color: srgb(24, 25, 28),
    roughness: 0.78,
    metalness: 0.12,
    side: THREE.DoubleSide,
  });
  const tyreRubber = new THREE.MeshStandardMaterial({ name: 'pearseTyre', color: srgb(26, 26, 28), roughness: 0.88, metalness: 0.05 });
  const brass = new THREE.MeshStandardMaterial({ name: 'pearseBrass', color: srgb(196, 156, 72), roughness: 0.3, metalness: 0.9 });
  const copper = new THREE.MeshStandardMaterial({ name: 'pearseCopper', color: srgb(184, 110, 66), roughness: 0.32, metalness: 0.88 });
  const wire = new THREE.MeshStandardMaterial({ name: 'pearseWire', color: srgb(120, 126, 132), roughness: 0.35, metalness: 0.85 });

  const materials: THREE.Material[] = [frameSteel, wingGrid, castIron, paddleBlack, tyreRubber, brass, copper, wire];
  const batch = new MeshBatch();

  const addFrame = (a: FRD, b: FRD, r = 0.015) => batch.add(frameSteel, tube(a, b, r, r, 10));
  const addGrid = (a: FRD, b: FRD, r = 0.012) => batch.add(wingGrid, tube(a, b, r, r, 8));
  const addWire = (a: FRD, b: FRD) => batch.add(wire, tube(a, b, 0.0028, 0.0028, 5));

  const wingZ = def.wing.qcZ; // -0.92 (LE at +0.50, TE at -1.50)
  const halfSpan = 3.81;

  // =========================================================================
  // 1. RECTANGULAR UNDERSIDE WING GRID LATTICE & ENCLOSED INSET AILERON BAYS
  // =========================================================================
  const gridZ = wingZ + 0.022;
  // Continuous four-spar rectangular grid (LE +0.49, front-mid -0.18, rear-mid -0.84, AND continuous TE -1.49)
  // so the inset outer ailerons (2.55..3.45 m) sit genuinely WITHIN the closed rectangular wing perimeter!
  for (const sx of [0.49, -0.18, -0.84, -1.49]) {
    addGrid([sx, -halfSpan, gridZ], [sx, halfSpan, gridZ], sx === 0.49 || sx === -1.49 ? 0.015 : 0.013);
  }
  // Framing around each inset aileron cut-out within the outer wing panel (2.55..3.45 m).
  for (const side of [-1, 1] as const) {
    addGrid([-0.76, side * 2.55, gridZ], [-0.76, side * 3.45, gridZ], 0.013);
    // Crisp silver-grey outer wingtip & trailing-edge perimeter tube enclosing the inset aileron bay!
    addFrame([-1.5, side * 2.55, wingZ + 0.005], [-1.5, side * halfSpan, wingZ + 0.005], 0.014);
    addFrame([0.5, side * halfSpan, wingZ + 0.005], [-1.5, side * halfSpan, wingZ + 0.005], 0.014);
  }

  // Chordwise ribs from LE (+0.49) to TE (-1.49) across the entire span, creating the iconic grid seen from below!
  for (const ry of [0, 0.52, 1.04, 1.56, 2.06, 2.55, 3.45, 3.8]) {
    if (ry === 0) {
      addGrid([0.49, 0, gridZ], [-1.49, 0, gridZ], 0.013);
    } else {
      addGrid([0.49, -ry, gridZ], [-1.49, -ry, gridZ], 0.012);
      addGrid([0.49, ry, gridZ], [-1.49, ry, gridZ], 0.012);
    }
  }
  // Intermediate rib forward of each inset aileron bay.
  for (const side of [-1, 1] as const) {
    addGrid([0.49, side * 3.0, gridZ], [-0.77, side * 3.0, gridZ], 0.011);
  }

  // Rear-edge wing elevator hinge brackets & side-frame bars at x = -1.50 m.
  for (const ey of [-1.05, -0.35, 0.35, 1.05]) {
    addFrame([-1.46, ey, wingZ + 0.01], [-1.54, ey, wingZ + 0.02], 0.01);
  }

  // =========================================================================
  // 2. TALL CENTRAL WING-TOP SAIL MASTS & WINGTIP GUY WIRES
  // =========================================================================
  // The tall rectangular sail stands from z = -0.95 up to z = -2.40, spanning x = +0.07 to -1.43 in the wing centre.
  const sailFrontX = 0.07;
  const sailRearX = -1.43;
  const sailTopZ = -2.41;
  // Front pivot mast, rear mast and upper/lower horizontal sail booms.
  addFrame([sailFrontX, 0, wingZ + 0.02], [sailFrontX, 0, sailTopZ - 0.03], 0.016);
  addFrame([sailRearX, 0, wingZ + 0.02], [sailRearX, 0, sailTopZ], 0.012);
  addFrame([sailFrontX, 0, sailTopZ], [sailRearX, 0, sailTopZ], 0.013);

  // Iconic V-shaped guy wires from the top of the tall central sail out to both outer wingtips (exact to the photo!).
  for (const side of [-1, 1] as const) {
    addWire([sailFrontX, 0, sailTopZ - 0.01], [0.42, side * 3.68, wingZ - 0.01]);
    addWire([sailFrontX, 0, sailTopZ - 0.01], [-0.82, side * 3.68, wingZ - 0.01]);
    addWire([sailRearX, 0, sailTopZ - 0.01], [-1.42, side * 2.55, wingZ - 0.01]);
    // Elevator & rudder control cables.
    addWire([0.32, side * 0.14, 0.25], [-1.75, side * 0.85, wingZ + 0.06]);
  }

  // =========================================================================
  // 3. OPEN VERTICAL TUBULAR-STEEL UNDERCARRIAGE CHASSIS & SUSPENDED SEAT
  // =========================================================================
  const noseX = def.gear[0].contact[0]; // +0.72
  const noseAxleZ = def.gear[0].contact[2] - def.gear[0].radius; // 1.06 - 0.28 = 0.78
  const mainX = def.gear[1].contact[0]; // -0.45
  const mainY = def.gear[2].contact[1]; // 1.10
  const mainAxleZ = def.gear[1].contact[2] - def.gear[1].radius; // 1.06 - 0.36 = 0.70

  for (const side of [-1, 1] as const) {
    // Two tall outer vertical hangers dropping straight down from the rear-mid wing spar to the wide main axle!
    addFrame([mainX, side * (mainY - 0.04), wingZ + 0.02], [mainX, side * (mainY - 0.04), mainAxleZ], 0.016);

    // Two forward vertical hangers dropping straight down from the front wing spar (+0.48, +/-0.24) to the lower frame!
    addFrame([0.48, side * 0.24, wingZ + 0.02], [0.48, side * 0.24, mainAxleZ], 0.016);
    // Mid-cockpit diagonal & seat-support tubes.
    addFrame([-0.18, side * 0.24, wingZ + 0.02], [0.12, side * 0.22, 0.56], 0.014);
    addFrame([0.48, side * 0.24, 0.56], [0.12, side * 0.22, 0.56], 0.014);

    // Lower horizontal triangular chassis tubes: from wide rear axle forward to the steerable front wheel head!
    addFrame([mainX, side * (mainY - 0.04), mainAxleZ], [noseX, 0, mainAxleZ], 0.016);
    addFrame([mainX, side * (mainY - 0.04), mainAxleZ], [0.48, side * 0.24, mainAxleZ], 0.014);

    // Lower diagonal flying wires from the undercarriage corners up and out to the outer wing spars (exact to photo!).
    addWire([mainX, side * (mainY - 0.04), mainAxleZ - 0.04], [0.44, side * 2.55, gridZ]);
    addWire([mainX, side * (mainY - 0.04), mainAxleZ - 0.04], [-0.84, side * 2.55, gridZ]);
    addWire([0.48, side * 0.24, mainAxleZ - 0.04], [0.44, side * 1.56, gridZ]);
    addWire([0.48, side * 0.24, mainAxleZ - 0.04], [-0.84, side * 1.56, gridZ]);
  }

  // Full-width rear main axle cross-tube & lower panel cross-brace (clear of instrument faces!).
  addFrame([mainX, -(mainY - 0.03), mainAxleZ], [mainX, mainY - 0.03, mainAxleZ], 0.017);
  addFrame([0.48, -0.24, mainAxleZ], [0.48, 0.24, mainAxleZ], 0.015);
  addFrame([0.48, -0.24, 0.25], [0.48, 0.24, 0.25], 0.014);
  // Forward A-brace to nosewheel head tube (+0.72, 0).
  addFrame([0.48, -0.24, 0.42], [noseX, 0, 0.52], 0.014);
  addFrame([0.48, 0.24, 0.42], [noseX, 0, 0.52], 0.014);
  addFrame([noseX, 0, 0.48], [noseX, 0, 0.68], 0.018);

  // Minimal tubular foot-rest & panel backing plate (strictly forward of PANEL_X = 0.54).
  addFrame([0.58, -0.22, 0.54], [0.58, 0.22, 0.54], 0.013);
  batch.add(castIron, box([0.562, 0, 0.127], [0.022, 0.39, 0.18], 0.005));

  // =========================================================================
  // 4. WING-LEADING-EDGE 2-CYL DOUBLE-ACTING ENGINE & WING-TOP CYLINDRICAL TANK
  // =========================================================================
  const engX = 0.56;
  const engZ = -0.84;

  // Crankcase & forward propeller shaft housing right at the centre front of the wing!
  batch.add(castIron, box([engX, 0, engZ], [0.22, 0.16, 0.15], 0.015));
  batch.add(frameSteel, tube([engX, 0, engZ], [0.88, 0, engZ], 0.024, 0.022, 12));
  batch.add(brass, tube([0.78, 0, engZ], [0.83, 0, engZ], 0.04, 0.04, 14));

  for (const side of [-1, 1] as const) {
    const cylX = engX + side * 0.025;
    batch.add(castIron, tube([cylX, side * 0.08, engZ], [cylX, side * 0.38, engZ], 0.056, 0.056, 14));
    for (let f = 0; f < 8; f++) {
      const yf = side * (0.11 + f * 0.032);
      batch.add(castIron, tube([cylX, yf, engZ], [cylX, yf + side * 0.007, engZ], 0.072, 0.072, 14));
    }
    // Double-acting outer cylinder head & brass spark plugs.
    batch.add(castIron, tube([cylX, side * 0.38, engZ], [cylX, side * 0.4, engZ], 0.062, 0.058, 12));
    batch.add(brass, tube([cylX, side * 0.13, engZ + 0.055], [cylX, side * 0.13, engZ + 0.082], 0.008, 0.006, 8));
    batch.add(brass, tube([cylX, side * 0.35, engZ + 0.055], [cylX, side * 0.35, engZ + 0.082], 0.008, 0.006, 8));
    // Short stub exhausts.
    batch.add(castIron, tube([cylX - 0.02, side * 0.25, engZ + 0.05], [cylX - 0.08, side * 0.27, engZ + 0.16], 0.016, 0.018, 8));
  }

  // Dark cylindrical petrol tank perched atop the centre of the wing behind the engine (clearly visible in the photo!).
  batch.add(castIron, tube([0.34, 0, -1.03], [-0.08, 0, -1.03], 0.085, 0.085, 18));
  batch.add(brass, tube([0.14, 0, -1.115], [0.14, 0, -1.14], 0.018, 0.022, 10));
  batch.add(copper, tube([0.28, 0.04, -0.95], [engX - 0.05, 0.04, engZ + 0.04], 0.006, 0.006, 6));

  const group = batch.build('pearseExterior');

  // =========================================================================
  // 5. ANIMATED PADDLE AIRSCREW & THIN WIRE-SPOKED BICYCLE WHEELS
  // =========================================================================
  const paddleProp = buildPaddlePropeller(frameSteel, paddleBlack, brass, def.props[0].diameter);
  paddleProp.group.position.copy(frd(def.props[0].hub[0], def.props[0].hub[1], def.props[0].hub[2]));
  group.add(paddleProp.group);

  // Steerable front fork + thin 22-inch spoked wheel.
  const noseCarrier = new THREE.Group();
  noseCarrier.position.copy(frd(noseX, 0, noseAxleZ));
  const noseSteer = new THREE.Group();
  const forkBatch = new MeshBatch();
  for (const sy of [-0.038, 0.038]) {
    forkBatch.add(frameSteel, tube([0, sy, 0], [0, sy * 0.5, -0.26], 0.01, 0.01, 8));
  }
  forkBatch.add(frameSteel, tube([0, -0.04, -0.26], [0, 0.04, -0.26], 0.011, 0.011, 8));
  forkBatch.add(frameSteel, tube([0, 0, -0.26], [0, 0, -0.38], 0.013, 0.013, 8));
  noseSteer.add(forkBatch.build('pearseNoseFork'));

  const noseSpin = buildThinBicycleWheel(tyreRubber, frameSteel, wire, def.gear[0].radius);
  noseSteer.add(noseSpin);
  noseCarrier.add(noseSteer);
  group.add(noseCarrier);

  const leftSpin = buildThinBicycleWheel(tyreRubber, frameSteel, wire, def.gear[1].radius);
  leftSpin.position.copy(frd(mainX, -mainY, mainAxleZ));
  group.add(leftSpin);

  const rightSpin = buildThinBicycleWheel(tyreRubber, frameSteel, wire, def.gear[2].radius);
  rightSpin.position.copy(frd(mainX, mainY, mainAxleZ));
  group.add(rightSpin);

  const baseNoseY = noseCarrier.position.y;
  const baseMainY = leftSpin.position.y;

  return {
    group,
    moving: [paddleProp.blades, noseSteer, leftSpin, rightSpin],
    materials: [...materials, ...paddleProp.bladeMats, paddleProp.discMat],
    textures: [paddleProp.discTex],
    update(wheels: readonly WheelState[], prop?: PropellerState) {
      if (prop) {
        paddleProp.blades.rotation.z = -prop.rotation;
        const blur = bladeBlur(prop.rpm, 2);
        paddleProp.blades.visible = blur.solid > 0.005;
        for (const m of paddleProp.bladeMats) {
          m.opacity = blur.solid;
          m.depthWrite = blur.solid > 0.99;
        }
        paddleProp.disc.visible = blur.disc > 0.01;
        paddleProp.discMat.opacity = blur.disc;
      }
      const [nw, lw, rw] = wheels;
      if (nw) {
        noseCarrier.position.y = baseNoseY + nw.compression;
        noseSteer.rotation.y = -nw.steerAngle;
        noseSpin.rotation.x = -nw.rotation;
      }
      if (lw) {
        leftSpin.position.y = baseMainY + lw.compression;
        leftSpin.rotation.x = -lw.rotation;
      }
      if (rw) {
        rightSpin.position.y = baseMainY + rw.compression;
        rightSpin.rotation.x = -rw.rotation;
      }
    },
  };
}
