// Fixed rotorcraft fittings: tail cone, fins, skids, mast fairing and the exposed piston-engine installation.
// The larger cabin is the same textured, glazed loft used by the aeroplanes.
import * as THREE from 'three';
import type { AirframeVisualDef, FRD } from '../airframe/types';
import { frd, gridGeometry, MeshBatch } from '../geometry';
import type { FuselageShape } from '../fuselageShape';
import type { AircraftMaterials } from '../materials';
import { boom, box, fin, mastFairing, pathTube, tube } from './geometry';

export interface RotorcraftAirframe { group: THREE.Group; materials: THREE.Material[]; textures: THREE.Texture[] }

export function buildRotorcraftAirframe(def: AirframeVisualDef, mat: AircraftMaterials, skin: FuselageShape): RotorcraftAirframe {
  const d = def.rotorcraftVisual!;
  const batch = new MeshBatch();
  const own: THREE.Material[] = [];
  const castMetal = new THREE.MeshStandardMaterial({ name: 'rotorcraftCastMetal', color: 0x939b9e, metalness: 0.25, roughness: 0.48 });
  own.push(castMetal);
  const textures: THREE.Texture[] = [];
  const add = (m: THREE.Material, g: THREE.BufferGeometry): void => batch.add(m, g);
  add(mat.plainPaint, boom(d.boom.front, d.boom.rear, d.boom.radii));
  // Tail-cone joints, and a narrow red stripe swept onto both sides of the tapered tube.
  for (let k = 1; k < 6; k++) {
    const t = k / 6, r = THREE.MathUtils.lerp(...d.boom.radii, t);
    const x = THREE.MathUtils.lerp(d.boom.front[0], d.boom.rear[0], t);
    const z = THREE.MathUtils.lerp(d.boom.front[2], d.boom.rear[2], t);
    const ring = new THREE.TorusGeometry(r + 0.0006, 0.0012, 4, 32);
    add(mat.darkMetal, ring.translate(0, -z, -x));
  }
  for (const side of [-1, 1]) add(mat.navyPaint, gridGeometry({ rows: 24, cols: 3, flip: side > 0,
    position(i, j, out) {
      const t = i / 23, r = THREE.MathUtils.lerp(...d.boom.radii, t) + 0.001;
      const a = Math.PI / 2 + (j - 1) * 0.17;
      frd(THREE.MathUtils.lerp(d.boom.front[0], d.boom.rear[0], t), side * r * Math.sin(a), THREE.MathUtils.lerp(d.boom.front[2], d.boom.rear[2], t) + r * Math.cos(a), out);
    },
  }));
  for (const f of d.fins) {
    add(mat.plainPaint, fin(f.outline, f.thickness, f.axis));
    // Colour cap follows the actual polygon instead of a world-aligned rectangular decal.
    if (f.name === 'upperFin') {
      const top = f.outline.slice(1, 3);
      const pts: FRD[] = [top[0], top[1], [top[1][0] + 0.005, top[1][1], top[1][2] + 0.10], [top[0][0] + 0.04, top[0][1], top[0][2] + 0.10]];
      add(mat.navyPaint, fin(pts, f.thickness + 0.0015, f.axis));
    }
  }
  add(mat.plainPaint, pathTube(d.guard, 0.016, 20));
  add(mat.navyPaint, pathTube(d.guard.slice(2), 0.0165, 8));
  const th = d.tail.hub;
  add(castMetal, tube([th[0], 0.06, th[2]], th, 0.059, 0.035, 20));
  add(castMetal, box([th[0] + 0.015, 0, th[2]], [0.14, 0.12, 0.13], 0.035));
  add(mat.aluminium, tube([th[0], -0.095, th[2]], [th[0], -0.113, th[2]], 0.056, 0.056, 20));
  for (const x of [-0.038, 0.038]) for (const z of [-0.035, 0.035])
    add(mat.aluminium, tube([th[0] + x, -0.063, th[2] + z], [th[0] + x, -0.075, th[2] + z], 0.009, 0.009, 6));

  // Streamlined mast cowl; the shaft, control rods and swashplate remain exposed above its shoulder.
  const m = d.mast;
  add(mat.plainPaint, mastFairing(m.bottom, m.top, [m.bottomWidth, m.topWidth]));
  add(mat.chrome, tube(m.top, d.main.hub, 0.034));
  for (const side of [-1, 1]) for (let i = 0; i < 5; i++) add(mat.darkMetal, box([m.top[0] - 0.07 + i * 0.023, side * 0.088, m.top[2] + 0.043], [0.006, 0.007, 0.055], 0.002));

  // Arched cross tubes continue beneath the belly. Toes turn up; the tube underside meets SKID_Z.
  const s = d.skids, r = 0.027;
  for (const x of s.crossTubes) add(mat.plainPaint, pathTube([[x, -s.halfTrack, s.z - r], [x, -s.halfTrack * 0.9, s.z - 0.15],
    [x, -0.47, 0.43], [x, 0, 0.39], [x, 0.47, 0.43], [x, s.halfTrack * 0.9, s.z - 0.15], [x, s.halfTrack, s.z - r]], 0.026));
  for (const side of [-1, 1]) {
    const y = side * s.halfTrack;
    add(mat.plainPaint, pathTube([[s.rear, y, s.z - r], [s.rear + 0.4, y, s.z - r], [s.front - 0.32, y, s.z - r], [s.front - 0.12, y, s.z - 0.060], [s.front, y, s.z - 0.13]], r));
    for (const x of s.crossTubes) {
      add(mat.darkMetal, box([x, y, s.z - 0.007], [0.24, 0.057, 0.013], 0.004));
      add(mat.aluminium, tube([x, y - 0.04, s.z - 0.05], [x, y + 0.04, s.z - 0.05], 0.033));
    }
  }

  // Exposed O-360: four finned cylinders, central crankcase, sump, cooling fan/shroud and welded frame.
  // Detail dimensions are visual estimates; there is no simulated engine or fan animation here.
  add(mat.aluminium, box([-0.50, 0, 0.09], [0.56, 0.29, 0.29], 0.07));
  add(mat.darkMetal, box([-0.49, 0, 0.32], [0.32, 0.25, 0.14], 0.03));
  for (const side of [-1, 1]) {
    for (const x of [-0.33, -0.65]) {
      add(mat.darkMetal, tube([x, side * 0.10, 0.02], [x, side * 0.39, 0.02], 0.10, 0.085));
      for (let i = 0; i < 9; i++) add(mat.aluminium, tube([x, side * (0.17 + i * 0.024), 0.02], [x, side * (0.18 + i * 0.024), 0.02], 0.101, 0.101));
      add(mat.aluminium, box([x, side * 0.40, 0.02], [0.18, 0.055, 0.17], 0.035));
      add(mat.exhaust, pathTube([[x, side * 0.32, 0.10], [x, side * 0.34, 0.23], [-0.67, side * 0.26, 0.34]], 0.021));
    }
    for (const [a, b] of [
      [[-0.08, side * 0.44, 0.45], [-0.95, side * 0.28, 0.39]],
      [[-0.95, side * 0.28, 0.39], [-0.83, side * 0.24, -0.42]],
      [[-0.08, side * 0.44, 0.45], [-0.83, side * 0.24, -0.42]],
      [[-0.95, side * 0.28, 0.39], [-0.13, side * 0.43, -0.07]],
    ] as [FRD, FRD][]) add(mat.darkMetal, tube(a, b, 0.013));
  }
  add(mat.exhaust, tube([-0.36, -0.32, 0.37], [-0.87, -0.32, 0.37], 0.045));
  add(mat.darkMetal, tube([-0.87, 0, 0.01], [-1.04, 0, 0.01], 0.23, 0.23, 32));
  const fanRim = new THREE.TorusGeometry(0.215, 0.027, 8, 32);
  add(mat.aluminium, fanRim.translate(...frd(-1.045, 0, 0.01).toArray()));
  for (let i = 0; i < 18; i++) {
    const a = i * Math.PI / 9;
    add(mat.aluminium, tube([-1.05, 0.06 * Math.cos(a), 0.01 + 0.06 * Math.sin(a)], [-1.05, 0.20 * Math.cos(a + 0.16), 0.01 + 0.20 * Math.sin(a + 0.16)], 0.007));
  }
  add(mat.darkMetal, tube([-0.42, 0, -0.64], [-0.92, 0, -1.14], 0.008, 0.004));

  // Windscreen centre post follows the loft from nose to roof; no opaque strip crosses the pilot's view.
  const post: FRD[] = [];
  for (let i = 0; i <= 24; i++) {
    const x = def.fuselage.frontX - i / 24 * (def.fuselage.frontX - 0.70);
    post.push([x, 0, skin.section(x).zTop - 0.005]);
  }
  add(mat.plainPaint, pathTube(post, 0.012, 32));
  add(mat.black, pathTube(post.map(p => [p[0] - 0.004, p[1], p[2] + 0.01]), 0.007, 32));
  const group = batch.build('rotorcraftAirframe');

  // Procedural lettering projected onto the conical surface, upright and readable from either side.
  const c = document.createElement('canvas'); c.width = 1024; c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#202127'; ctx.font = 'bold 105px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(def.livery.registration, 512, 66);
  const texture = new THREE.CanvasTexture(c); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 8;
  textures.push(texture);
  const letterMat = new THREE.MeshStandardMaterial({ name: 'tailRegistration', map: texture, transparent: true, depthWrite: false, roughness: 0.6, side: THREE.DoubleSide });
  own.push(letterMat);
  for (const side of [-1, 1]) {
    const g = gridGeometry({ rows: 18, cols: 5, flip: side > 0,
      position(i, j, out) {
        const x = -1.40 - i / 17 * 1.22;
        const t = (x - d.boom.front[0]) / (d.boom.rear[0] - d.boom.front[0]);
        const r = THREE.MathUtils.lerp(...d.boom.radii, t) + 0.002;
        const a = Math.PI / 2 + 0.95 - j / 4 * 0.72;
        frd(x, side * r * Math.sin(a), THREE.MathUtils.lerp(d.boom.front[2], d.boom.rear[2], t) + r * Math.cos(a), out);
      },
      uv(i, j, out) { out.set(side < 0 ? i / 17 : 1 - i / 17, 1 - j / 4); },
    });
    const letters = new THREE.Mesh(g, letterMat); letters.name = side < 0 ? 'registrationLeft' : 'registrationRight';
    letters.renderOrder = 1; group.add(letters);
  }
  return { group, materials: own, textures };
}
