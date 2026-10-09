// Fixed R44 fittings, traced from POH 1-3, MM chapters 4/5/16/26/27 and Robinson's left-side photo.
// Local dimensions are ESTIMATES. Fins, stinger, rotor centres and skid contacts stay in dimensions.ts.
import * as THREE from 'three';
import type { AirframeVisualDef } from '../../render/aircraft/airframe/types';
import { frd, gridGeometry, MeshBatch } from '../../render/aircraft/geometry';
import { box, pathTube, tube } from '../../render/aircraft/rotorcraft/geometry';
import { SKID_TUBE_RADIUS, TAIL_HUB, TAIL_STINGER, TAIL_STINGER_RADIUS, UPPER_FIN_OUTLINE, LOWER_FIN_OUTLINE } from './dimensions';
import { ellipsoid, skinPatch, skinPath, type R44DetailMaterials, type R44SkinWidth } from './exteriorGeometry';

export function buildR44ExteriorDetails(def: AirframeVisualDef, mat: R44DetailMaterials, skin: R44SkinWidth) {
  const batch = new MeshBatch(), textures: THREE.Texture[] = [], materials: THREE.Material[] = [];
  const d = def.rotorcraftVisual!, s = d.skids;
  // Standard skid cross-tube fairings, a lenticular sleeve over each outboard descending tube. Rounded
  // cross sections retain the load-carrying tube; no vertical rectangular slabs or added contact points.
  for (const x of s.crossTubes) for (const side of [-1, 1]) {
    batch.add(mat.paint, gridGeometry({ rows: 17, cols: 33, wrap: true, flip: side < 0,
      position(i, j, out) {
        const t = i / 16, a = j / 32 * Math.PI * 2;
        const y = THREE.MathUtils.lerp(s.bellyHalfWidth!, s.halfTrack, t);
        const z = THREE.MathUtils.lerp(s.bellyZ!, s.z - SKID_TUBE_RADIUS - 0.01, t);
        const chord = 0.15 + 0.035 * Math.sin(t * Math.PI);
        frd(x - 0.035 + chord * Math.cos(a) / 2, side * (y + 0.032 * Math.sin(a)), z, out);
      },
    }));
    batch.add(mat.dark, box([x, side * s.halfTrack, s.z - 0.011], [0.28, 0.071, 0.020], 0.006));
    // Toe step/tread on the front cross tube and replaceable skid shoes at each saddle.
    if (x === s.crossTubes[0]) batch.add(mat.dark, box([x + 0.01, side * (s.halfTrack - 0.035), s.z - 0.105], [0.20, 0.10, 0.014], 0.008));
    for (const dx of [-0.07, 0.07]) batch.add(mat.metal,
      tube([x + dx, side * (s.halfTrack + 0.039), s.z - 0.045], [x + dx, side * (s.halfTrack + 0.044), s.z - 0.045], 0.007, 0.007, 6));
  }

  for (const side of [-1, 1]) {
    // Separate engine-cowl panels, recessed black ventilation slots and small camloc heads. These are
    // closed-cowl visual recesses; the engine, fan and belt compartment are deliberately not exposed.
    for (const path of [
      [[-0.26, -0.45], [-0.78, -0.38], [-1.31, -0.24], [-1.39, 0.32], [-0.76, 0.45], [-0.26, 0.47], [-0.26, -0.45]],
      [[-0.81, -0.37], [-0.81, 0.44]],
    ] as const) batch.add(mat.dark, pathTube(skinPath(skin, side, path), 0.0018, 80));
    for (let j = 0; j < 6; j++) {
      const z = -0.20 + j * 0.058;
      batch.add(mat.dark, skinPatch(skin, side, -1.25, -1.53, z, z + 0.024, 0.004));
      batch.add(mat.paint, pathTube(skinPath(skin, side, [[-1.25, z + 0.025], [-1.53, z + 0.025]], 0.009), 0.005, 12));
    }
    for (const x of [-0.28, -0.78, -1.27]) for (const z of [-0.30, 0.36]) {
      const y = side * skin(x, z);
      batch.add(mat.metal, tube([x, y, z], [x, y + side * 0.008, z], 0.0065, 0.0065, 8));
    }
    // Door seals and the two small hinge barrels on each door (all four doors are closed).
    for (const door of def.glazing.doors) {
      batch.add(mat.rubber, pathTube(skinPath(skin, side, [...door.pts, door.pts[0]], 0.003), 0.0026, 96));
      const x = door.pts[1][0], top = door.pts[1][1];
      for (const dz of [0.15, 0.42]) {
        const hx = x + dz * 0.45, z = top + dz, y = side * (skin(hx, z) + 0.015);
        batch.add(mat.paint, tube([hx - 0.022, y, z - 0.035], [hx + 0.022, y, z + 0.035], 0.010));
        batch.add(mat.metal, tube([hx - 0.024, y, z - 0.038], [hx + 0.024, y, z + 0.038], 0.004));
      }
    }
    // Fuel filler caps on the shoulder aft of the rear doors; etched cap handles, no open fuel tanks.
    const capX = side < 0 ? -0.27 : -0.17, capY = side * 0.37, capZ = -0.612;
    batch.add(mat.metal, ellipsoid([capX, capY, capZ], [0.049, 0.046, 0.016]));
    batch.add(mat.dark, box([capX, capY, capZ - 0.017], [0.045, 0.012, 0.009], 0.003));
    // Small cabin inlet below the forward seat, separate from the large cowl ventilation slots.
    batch.add(mat.dark, skinPatch(skin, side, 1.33, 1.19, 0.42, 0.445));
  }

  // The shared fairing already supplies upper mast vents; do not overlay freestanding slot boxes.
  // Empennage attachment ears and the faired white-light mount between the fins, MM Fig. 4-7.
  const tx = TAIL_HUB.x, tz = TAIL_HUB.z, fy = UPPER_FIN_OUTLINE[0].y;
  for (const z of [tz - 0.045, tz + 0.055]) for (const x of [tx + 0.06, tx - 0.13]) {
    batch.add(mat.paint, box([x, fy, z], [0.085, 0.16, 0.025], 0.008));
    for (const dy of [-0.065, 0.065]) batch.add(mat.metal, tube([x, fy + dy, z - 0.019], [x, fy + dy, z + 0.019], 0.010, 0.010, 6));
  }
  batch.add(mat.paint, ellipsoid([tx - 0.27, fy, tz + 0.02], [0.15, 0.046, 0.045]));
  // The frozen stabiliser is below the tailcone. Do not invent an extended bracket to conceal that
  // contract mismatch; the proposed correction and source drawing are in docs/r44-exterior.md.
  // Four fasteners near each fin root, and the stinger's clamp to the lower fin.
  for (const fin of [UPPER_FIN_OUTLINE, LOWER_FIN_OUTLINE]) for (const fraction of [0.12, 0.27]) {
    const z = THREE.MathUtils.lerp(fin[0].z, fin[2].z, fraction);
    for (const dx of [-0.13, 0.06]) batch.add(mat.metal,
      tube([tx + dx, fy - 0.023, z], [tx + dx, fy + 0.023, z], 0.006, 0.006, 8));
  }
  // Alternating high-visibility guard bands seen in the manufacturer photograph. Spacing is a visual
  // estimate. The shared red sleeve uses the last four guard points and only eight tube segments;
  // interpolate its actual rings so these thin paint overlays do not cut inside its coarse facets.
  const guard = new THREE.CatmullRomCurve3(TAIL_STINGER.slice(2).map(p => frd(p.x, p.y, p.z)), false, 'centripetal');
  const sleeve = new THREE.TubeGeometry(guard, 8, TAIL_STINGER_RADIUS + 0.0012, 8, false);
  const p = sleeve.getAttribute('position'), a = new THREE.Vector3(), b = new THREE.Vector3();
  const bandStep = 0.17 / guard.getLength();
  for (let start = bandStep / 2; start < 1; start += bandStep) for (let segment = 0; segment < 8; segment++) {
    const from = Math.max(start, segment / 8), to = Math.min(start + bandStep / 2, (segment + 1) / 8);
    if (to <= from) continue;
    batch.add(mat.paint, gridGeometry({ rows: 2, cols: 9, wrap: true,
      position(i, j, out) {
        a.fromBufferAttribute(p, segment * 9 + j); b.fromBufferAttribute(p, (segment + 1) * 9 + j);
        out.copy(a).lerp(b, (i === 0 ? from : to) * 8 - segment);
      },
    }));
  }
  sleeve.dispose();

  for (const lamp of def.lamps) {
    if (lamp.id === 'beacon') batch.add(mat.dark, ellipsoid([lamp.pos[0], lamp.pos[1], lamp.pos[2] + 0.025], [0.060, 0.052, 0.022]));
    if (lamp.id.startsWith('nav') && lamp.id !== 'navTail') {
      batch.add(mat.paint, ellipsoid([lamp.pos[0] - 0.03, lamp.pos[1] * 0.985, lamp.pos[2]], [0.075, 0.030, 0.040]));
    }
  }
  const group = batch.build('r44ExteriorDetails');
  // Original procedural badges, not photo textures. Registration itself remains on the shared boom.
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 192;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#303237'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = 'bold italic 116px sans-serif'; ctx.fillText('R44', 256, 76);
  ctx.font = '25px sans-serif'; ctx.fillText('R A V E N   I I', 256, 150);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 8;
  const decal = new THREE.MeshStandardMaterial({ name: 'r44Badge', map: texture, transparent: true, depthWrite: false,
    side: THREE.DoubleSide, roughness: 0.55 });
  textures.push(texture); materials.push(decal);
  for (const side of [-1, 1]) {
    const badge = new THREE.Mesh(skinPatch(skin, side, -0.20, -0.67, -0.41, -0.22, 0.007), decal);
    badge.name = side < 0 ? 'r44BadgeLeft' : 'r44BadgeRight'; badge.renderOrder = 1; group.add(badge);
  }
  return { group, textures, materials };
}
