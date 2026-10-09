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
  const scrollPaint = new THREE.MeshStandardMaterial({ name: 'coolingScroll', color: 0xb5b2a4, metalness: 0.12, roughness: 0.52 });
  const framePaint = new THREE.MeshStandardMaterial({ name: 'engineFrame', color: 0x72796b, metalness: 0.18, roughness: 0.55 });
  own.push(castMetal, scrollPaint, framePaint);
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
  const guardRadius = d.guardRadius;
  add(mat.plainPaint, pathTube(d.guard, guardRadius, 20));
  add(mat.navyPaint, pathTube(d.guard.slice(2), guardRadius + 0.0005, 8));
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
  const s = d.skids, r = s.tubeRadius ?? 0.027;
  for (const x of s.crossTubes) add(mat.plainPaint, pathTube([[x, -s.halfTrack, s.z - r], [x, -s.halfTrack * 0.9, s.z - 0.15],
    [x, -(s.bellyHalfWidth ?? 0.47), s.bellyZ ?? 0.43], [x, 0, s.crossCentreZ ?? 0.39],
    [x, s.bellyHalfWidth ?? 0.47, s.bellyZ ?? 0.43], [x, s.halfTrack * 0.9, s.z - 0.15], [x, s.halfTrack, s.z - r]], 0.026));
  for (const side of [-1, 1]) {
    const y = side * s.halfTrack;
    add(mat.plainPaint, pathTube([[s.rear, y, s.z - r], [s.rear + 0.4, y, s.z - r], [s.front - 0.32, y, s.z - r], [s.front - 0.12, y, s.z - 0.060], [s.front, y, s.z - 0.13]], r));
    for (const x of s.crossTubes) {
      add(mat.darkMetal, box([x, y, s.z - 0.007], [0.24, 0.057, 0.013], 0.004));
      add(mat.aluminium, tube([x, y - 0.04, s.z - 0.05], [x, y + 0.04, s.z - 0.05], 0.033));
    }
  }

  // Optional exposed piston installation: cylinders, crankcase, sump, cooling fan/shroud and welded frame.
  // Detail dimensions are visual estimates; there is no simulated engine or fan animation here.
  if (d.engineDetail?.exposed !== false) {
  add(castMetal, box([-0.50, 0, 0.09], [0.56, 0.29, 0.29], 0.07));
  const sump = new THREE.SphereGeometry(1, 16, 10); sump.scale(0.135, 0.08, 0.22);
  add(castMetal, sump.translate(...frd(-0.49, 0, 0.265).toArray()));
  add(castMetal, box([-0.42, 0.03, 0.37], [0.15, 0.14, 0.10], 0.03));
  add(mat.black, pathTube([[-0.42, 0.03, 0.39], [-0.32, 0.10, 0.42], [-0.22, 0.22, 0.34]], 0.034, 12));
  for (const side of [-1, 1]) {
    for (const x of d.engineDetail?.cylinderXs ?? [-0.33, -0.65]) {
      add(mat.darkMetal, tube([x, side * 0.10, 0.02], [x, side * 0.39, 0.02], 0.10, 0.085));
      for (let i = 0; i < 8; i++) add(castMetal, tube([x, side * (0.17 + i * 0.027), 0.02], [x, side * (0.178 + i * 0.027), 0.02], 0.101, 0.101));
      add(castMetal, box([x, side * 0.40, 0.02], [0.18, 0.055, 0.17], 0.035));
      add(scrollPaint, box([x, side * 0.29, -0.09], [0.22, 0.24, 0.035], 0.015));
      add(mat.darkMetal, pathTube([[x, side * 0.40, -0.04], [x + 0.04, side * 0.34, -0.16], [-0.22, side * 0.13, -0.12]], 0.005, 10));
      add(mat.exhaust, pathTube([[x, side * 0.32, 0.10], [x, side * 0.34, 0.23], [-0.67, side * 0.26, 0.34]], 0.021));
    }
    for (const [a, b] of [
      [[-0.08, side * 0.44, 0.45], [-0.95, side * 0.28, 0.39]],
      [[-0.95, side * 0.28, 0.39], [-0.83, side * 0.24, -0.42]],
      [[-0.08, side * 0.44, 0.45], [-0.83, side * 0.24, -0.42]],
      [[-0.95, side * 0.28, 0.39], [-0.13, side * 0.43, -0.07]],
    ] as [FRD, FRD][]) add(framePaint, tube(a, b, 0.016));
  }
  add(mat.exhaust, tube([-0.67, -0.32, 0.33], [-0.67, 0.32, 0.33], 0.062));
  add(mat.exhaust, pathTube([[-0.67, -0.27, 0.33], [-0.85, -0.31, 0.32], [-1.05, -0.31, 0.31]], 0.029, 16));
  add(mat.black, tube([-1.051, -0.31, 0.31], [-1.054, -0.31, 0.31], 0.023));

  // Fibreglass scroll with a rolled inlet, recessed fan face and an outlet into the cylinder baffles.
  // MM Fig. 6-5B and engine-rear photographs: the fan is not an open bicycle-spoke wheel.
  add(scrollPaint, gridGeometry({ rows: 17, cols: 49, wrap: true,
    position(i, j, out) {
      const p = i / 16 * Math.PI * 2, a = j / 48 * Math.PI * 2;
      const r = 0.228 + 0.047 * Math.cos(p) + 0.012 * Math.sin(a);
      frd(-1.015 - 0.085 * Math.sin(p), r * Math.cos(a), 0.01 + r * Math.sin(a), out);
    },
  }));
  add(scrollPaint, box([-0.90, 0.22, -0.16], [0.23, 0.23, 0.18], 0.065));
  add(castMetal, tube([-0.94, 0, 0.01], [-1.036, 0, 0.01], 0.18, 0.18, 32));
  add(castMetal, tube([-1.037, 0, 0.01], [-1.067, 0, 0.01], 0.074, 0.033, 24));
  add(mat.aluminium, tube([-1.065, 0, 0.01], [-1.083, 0, 0.01], 0.027, 0.027, 6));
  for (let i = 0; i < 12; i++) {
    const a = i * Math.PI / 6;
    add(mat.aluminium, tube([-1.037, 0.153 * Math.cos(a), 0.01 + 0.153 * Math.sin(a)], [-1.046, 0.153 * Math.cos(a), 0.01 + 0.153 * Math.sin(a)], 0.007, 0.007, 6));
  }
  // Upper driven sheave / lower drive sheave and two double V-belts, partly masked by the aft cowl.
  for (const [z, r] of [[-0.37, 0.115], [0.01, 0.135]]) {
    add(castMetal, tube([-0.86, 0, z], [-0.77, 0, z], r, r, 24));
    add(mat.darkMetal, tube([-0.775, 0, z], [-0.76, 0, z], r * 0.9, r * 0.9, 24));
  }
  for (const x of [-0.785, -0.825]) for (const offset of [-0.006, 0.006])
    add(mat.black, pathTube([[x + offset, -0.13, 0.01], [x + offset, -0.112, -0.37], [x + offset, 0, -0.484],
      [x + offset, 0.112, -0.37], [x + offset, 0.13, 0.01], [x + offset, 0, 0.145], [x + offset, -0.13, 0.01]], 0.0055, 32));
  add(mat.darkMetal, tube([-0.42, 0, -0.64], [-0.92, 0, -1.14], 0.008, 0.004));
  }

  // Windscreen centre post follows the loft from nose to roof; no opaque strip crosses the pilot's view.
  const post: FRD[] = [];
  for (let i = 0; i <= 24; i++) {
    const x = def.fuselage.frontX - i / 24 * (def.fuselage.frontX - (def.glazing.windscreen?.topX ?? 0.68) - 0.02);
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
        const [front, rear] = d.registrationXs ?? [-1.40, -2.62];
        const x = front + i / 17 * (rear - front);
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
