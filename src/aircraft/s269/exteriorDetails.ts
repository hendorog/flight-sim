// Open 300CB installation: RFM Fig 1-1, C1B-040 upper pulley, AOPA Apr 1997 p64 photographs.
// Tube/engine/tank fittings are visual estimates, not a surveyed restoration drawing.
import * as THREE from 'three';
import type { AirframeVisualDef, FRD } from '../../render/aircraft/airframe/types';
import { frd, MeshBatch } from '../../render/aircraft/geometry';
import { boom, box, fin, pathTube, tube } from '../../render/aircraft/rotorcraft/geometry';
import * as D from './dimensions';
import { ellipsoid, sidePatch, skinPath, type S269Materials, type S269SkinWidth } from './exteriorGeometry';
const point = (p: { x: number; y: number; z: number }): FRD => [p.x, p.y, p.z];

export function buildS269Exterior(def: AirframeVisualDef, m: S269Materials, skin: S269SkinWidth) {
  const group = new THREE.Group(); group.name = 's269Exterior';
  const b = new MeshBatch(), d = def.rotorcraftVisual!;
  const add = (material: THREE.Material, g: THREE.BufferGeometry) => b.add(material, g);
  const line = (a: FRD, c: FRD, radius = 0.018) => add(m.frame, tube(a, c, radius));
  const upperMount = (x: number, side: number): FRD => point(D.SKID_DAMPERS.find(
    damper => damper.lower.x === x && Math.sign(damper.lower.y) === side)!.upper);
  // Steel truss: two lower rails, cabin uprights, mast support and converging boom braces.
  for (const side of [-1, 1]) {
    const f = upperMount(D.SKID_CONTACT_FRONT_X, side), r = upperMount(D.SKID_CONTACT_REAR_X, side);
    const shoulder: FRD = [-0.09, side * 0.36, -0.66];
    // The forward rail supports the floor pan; a direct diagonal to the mast shoulder would
    // pass through the occupied seat/door opening. The upright is behind the seat bulkhead.
    const cabinRear: FRD = [-0.09, f[1], 0.32];
    line(f, r, 0.026); line(f, cabinRear); line(cabinRear, shoulder); line(r, shoulder);
    line(shoulder, [0, side * 0.09, D.MAIN_HUB.z + 0.25]);
    line(r, [-1.16, side * 0.09, -0.42]); line(shoulder, [-1.16, side * 0.09, -0.42], 0.016);
    line(r, [-2.35, side * 0.035, -0.45], 0.022);
    line(f, [r[0], -side * 0.30, r[2]], 0.013);
  }
  for (const x of [D.SKID_CONTACT_FRONT_X, D.SKID_CONTACT_REAR_X]) line(upperMount(x, -1), upperMount(x, 1), 0.026);
  // Four independent oleos follow the frozen upper/lower contact mounts, with rod, seal and eyes.
  D.SKID_DAMPERS.forEach((damper, i) => {
    const a = frd(...point(damper.upper)), c = frd(...point(damper.lower));
    const mid = a.clone().lerp(c, 0.64), rod = a.clone().lerp(c, 0.60);
    const parts = new MeshBatch();
    const frdPoint = (v: THREE.Vector3): FRD => [-v.z, v.x, -v.y];
    parts.add(m.dark, tube(point(damper.upper), frdPoint(mid), damper.bodyRadius));
    parts.add(m.metal, tube(frdPoint(rod), point(damper.lower), damper.rodRadius));
    parts.add(m.rubber, tube(frdPoint(a.clone().lerp(c, 0.60)), frdPoint(a.clone().lerp(c, 0.67)), damper.bodyRadius + 0.002));
    for (const p of [damper.upper, damper.lower]) {
      // The lower eye is a flattened clevis above the skid sole, not a ball below ground contact.
      parts.add(m.cast, ellipsoid(point(p), [0.046, 0.045, p === damper.lower ? 0.024 : 0.045]));
      parts.add(m.metal, tube([p.x - 0.049, p.y, p.z], [p.x + 0.049, p.y, p.z], 0.014, 0.014, 6));
    }
    const oleo = parts.build(`s269Oleo${i}`); oleo.userData.upper = point(damper.upper); oleo.userData.lower = point(damper.lower); group.add(oleo);
  });
  for (const side of [-1, 1]) {
    const y = side * D.SKID_HALF_TRACK, z = D.SKID_Z - D.SKID_TUBE_RADIUS;
    // A straight contact rail with a tangent toe curve. A Catmull spline through the long straight
    // section dips below the skid datum before it turns upwards.
    const rail = new THREE.CurvePath<THREE.Vector3>();
    rail.add(new THREE.LineCurve3(frd(D.SKID_REAR_X, y, z), frd(D.SKID_FRONT_X - 0.28, y, z)));
    rail.add(new THREE.QuadraticBezierCurve3(frd(D.SKID_FRONT_X - 0.28, y, z),
      frd(D.SKID_FRONT_X - 0.09, y, z), frd(D.SKID_FRONT_X, y, z - 0.14)));
    add(m.dark, new THREE.TubeGeometry(rail, 80, D.SKID_TUBE_RADIUS, 12, false));
    for (const x of [D.SKID_CONTACT_FRONT_X, D.SKID_CONTACT_REAR_X]) {
      add(m.cast, box([x, y, z - 0.013], [0.14, 0.087, 0.045], 0.01));
      // Diagonal radius rods, not the Robinson's bowed rigid cross-tube gear.
      line([x, y, z - 0.01], upperMount(x === D.SKID_CONTACT_FRONT_X ? D.SKID_CONTACT_REAR_X : D.SKID_CONTACT_FRONT_X, side), 0.012);
    }
  }
  add(m.paint, boom(d.boom.front, d.boom.rear, d.boom.radii));
  // RFM 1-6/1-7: drive shaft and control rod are INTERNAL; no external bearing train.
  for (const t of [0.05, 0.94]) {
    const x = THREE.MathUtils.lerp(d.boom.front[0], d.boom.rear[0], t);
    const z = THREE.MathUtils.lerp(d.boom.front[2], d.boom.rear[2], t), r = THREE.MathUtils.lerp(...d.boom.radii, t);
    add(m.metal, tube([x - 0.003, 0, z], [x + 0.003, 0, z], r + 0.001, r + 0.001, 32));
  }
  for (const f of d.fins) add(m.paint, fin(f.outline, f.thickness, f.axis));
  add(m.paint, pathTube(D.TAIL_STINGER.map(point), D.TAIL_STINGER_RADIUS, 48));
  add(m.cast, ellipsoid([D.TAIL_HUB.x, 0, D.TAIL_HUB.z], [0.075, 0.060, 0.085]));
  add(m.cast, tube([D.TAIL_HUB.x, 0, D.TAIL_HUB.z], point(D.TAIL_HUB), 0.037, 0.026));
  // Open main transmission and mast. Three manual pushrods, no hydraulic servo cylinders.
  add(m.cast, ellipsoid([-0.035, 0, -0.51], [0.21, 0.17, 0.20]));
  add(m.cast, tube([0, 0, -0.50], [0, 0, D.MAIN_HUB.z + 0.24], 0.065, 0.045, 24));
  add(m.metal, tube([0, 0, D.MAIN_HUB.z + 0.30], point(D.MAIN_HUB), 0.037, 0.037, 24));
  for (let i = 0; i < 3; i++) {
    const a = i * Math.PI * 2 / 3, x = Math.sin(a) * 0.12, y = Math.cos(a) * 0.12;
    add(m.metal, tube([x, y, -0.56], [x, y, D.MAIN_HUB.z + 0.33], 0.008));
    add(m.cast, tube([x, y, -0.65], [x, y, -0.73], 0.012));
  }
  // One teardrop-section tank on the LEFT. Fuel arm is not used as a mesh centre; shape is photographic.
  const tank = new THREE.Shape();
  tank.moveTo(-0.47, -0.86); tank.bezierCurveTo(-0.76, -0.84, -0.83, -0.64, -0.82, -0.49);
  tank.bezierCurveTo(-0.79, -0.28, -0.58, -0.20, -0.34, -0.24);
  tank.bezierCurveTo(-0.08, -0.30, -0.10, -0.62, -0.23, -0.80); tank.bezierCurveTo(-0.30, -0.88, -0.39, -0.89, -0.47, -0.86);
  const tankGeometry = new THREE.ExtrudeGeometry(tank, { depth: 0.36, bevelEnabled: true, bevelSize: 0.025,
    bevelThickness: 0.035, bevelSegments: 4, curveSegments: 20, steps: 1 });
  // Shape x/z -> FRD x/z, extrusion -> lateral. Determinant positive preserves winding.
  tankGeometry.applyMatrix4(new THREE.Matrix4().set(0, 0, -1, -0.22, 0, -1, 0, 0, -1, 0, 0, 0, 0, 0, 0, 1));
  add(m.paint, tankGeometry);
  for (const y of [-0.28, -0.52]) add(m.cast, pathTube([[-0.24, y, -0.79], [-0.45, y, -0.885], [-0.73, y, -0.74], [-0.80, y, -0.50], [-0.63, y, -0.255]], 0.008, 48));
  add(m.red, tube([-0.37, -0.43, -0.875], [-0.37, -0.43, -0.902], 0.034, 0.034, 24));
  add(m.dark, pathTube([[-0.63, -0.38, -0.25], [-0.58, -0.36, -0.04], [-0.32, -0.19, 0.24]], 0.009, 25));
  // Horizontally opposed four-cylinder engine, finned barrels, rocker covers and baffle plates.
  add(m.cast, ellipsoid([-0.28, 0, 0.16], [0.32, 0.17, 0.17]));
  add(m.cast, box([-0.29, 0, 0.28], [0.40, 0.27, 0.10], 0.025));
  for (const x of [-0.12, -0.43]) for (const side of [-1, 1]) {
    add(m.dark, tube([x, side * 0.13, 0.10], [x, side * 0.37, 0.10], 0.085));
    for (let k = 0; k < 9; k++) add(m.cast, tube([x, side * (0.19 + k * 0.017), 0.10],
      [x, side * (0.197 + k * 0.017), 0.10], 0.100, 0.098, 20));
    add(m.metal, box([x, side * 0.395, 0.10], [0.20, 0.07, 0.17], 0.035));
    add(m.cast, box([x, side * 0.265, -0.003], [0.25, 0.32, 0.023], 0.008));
    add(m.dark, pathTube([[x, side * 0.34, 0.07], [x + 0.08, side * 0.20, -0.04], [-0.56, side * 0.11, 0.02]], 0.005, 24));
    add(m.exhaust, pathTube([[x, side * 0.26, 0.19], [x, side * 0.31, 0.31], [-0.63, side * 0.26, 0.33]], 0.023, 20));
  }
  add(m.exhaust, tube([-0.64, -0.28, 0.33], [-0.64, 0.28, 0.33], 0.054));
  // Upstack exhaust selected by the carburetted RFM hover-chart configuration.
  add(m.exhaust, pathTube([[-0.64, 0.26, 0.33], [-0.80, 0.31, 0.22], [-0.91, 0.33, -0.10], [-0.95, 0.33, -0.28]], 0.030, 35));
  add(m.dark, tube([-0.95, 0.33, -0.279], [-0.95, 0.33, -0.284], 0.024));
  // Aft engine-driven fan and belt stack. Rounded housing, recessed dark inlet, individual vanes.
  add(m.cast, tube([-0.57, 0, 0.13], [-0.73, 0, 0.13], 0.225, 0.215, 48));
  add(m.dark, tube([-0.731, 0, 0.13], [-0.738, 0, 0.13], 0.188, 0.188, 40));
  for (let i = 0; i < 20; i++) {
    const a = i * Math.PI / 10;
    add(m.metal, tube([-0.74, 0.072 * Math.cos(a), 0.13 + 0.072 * Math.sin(a)],
      [-0.74, 0.178 * Math.cos(a + 0.16), 0.13 + 0.178 * Math.sin(a + 0.16)], 0.009));
  }
  for (const [z, r] of [[-0.40, 0.15], [0.13, 0.17]]) {
    add(m.cast, tube([-0.75, 0, z], [-0.86, 0, z], r, r, 36));
    add(m.metal, tube([-0.86, 0, z], [-0.875, 0, z], r + 0.008, r + 0.008, 36));
    add(m.metal, tube([-0.876, 0, z], [-0.90, 0, z], 0.035, 0.035, 6));
  }
  for (let i = 0; i < 6; i++) {
    const x = -0.755 - i * 0.017;
    add(m.rubber, pathTube([[x, -0.17, 0.13], [x, -0.15, -0.40], [x, 0, -0.55], [x, 0.15, -0.40],
      [x, 0.17, 0.13], [x, 0, 0.30], [x, -0.17, 0.13]], 0.0065, 60));
  }
  add(m.cast, tube([-0.80, 0.17, -0.18], [-0.86, 0.17, -0.18], 0.055));
  add(m.metal, tube([-0.82, 0.17, -0.18], [-0.48, 0.15, 0.31], 0.011));
  // Window seals/door frames follow the actual loft, including the rounded rear-quarter post.
  for (const side of [-1, 1]) {
    for (const door of def.glazing.doors) {
      const loop = [...door.pts, door.pts[0]];
      add(m.paint, pathTube(skinPath(skin, side, loop, -0.008), 0.014, 120));
      add(m.rubber, pathTube(skinPath(skin, side, loop, 0.003), 0.0045, 120));
      const p = skinPath(skin, side, [[door.handle!.x, door.handle!.z]], 0.012)[0];
      add(m.metal, tube([p[0] - 0.04, p[1], p[2]], [p[0] + 0.04, p[1], p[2] - 0.014], 0.009));
    }
    // Circular rotating window vent is an annulus, leaving the view through the bubble clear.
    const vent: FRD[] = [];
    for (let i = 0; i <= 48; i++) {
      const a = i / 48 * 2 * Math.PI, x = 0.74 + 0.052 * Math.cos(a), z = -0.37 + 0.052 * Math.sin(a);
      vent.push([x, side * (skin(x, z) + 0.007), z]);
    }
    add(m.metal, pathTube(vent, 0.003, 48));
  }
  // Centre windshield seam and overhead bow; narrow enough to preserve the pilot's sight line.
  const post: FRD[] = def.fuselage.keys.filter(k => k[0] >= 0.54).map(k => [k[0], 0, k[1] - 0.005]);
  add(m.dark, pathTube(post, 0.011, 70));
  add(m.dark, box([1.485, 0, 0.355], [0.10, 0.145, 0.105], 0.035));
  add(m.cast, box([-1.60, 0, -0.503], [0.08, 0.07, 0.035], 0.010));
  group.add(b.build('s269Structure'));

  const textures: THREE.Texture[] = [], materials: THREE.Material[] = [];
  function lettering(name: string, width: number, height: number, paint: (ctx: CanvasRenderingContext2D) => void) {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    paint(canvas.getContext('2d')!); const t = new THREE.CanvasTexture(canvas); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    const material = new THREE.MeshStandardMaterial({ name, map: t, transparent: true, depthWrite: false, roughness: 0.6 });
    textures.push(t); materials.push(material); return material;
  }
  const letters = lettering('s269Registration', 1024, 128, ctx => {
    ctx.fillStyle = '#202b30'; ctx.font = 'bold 100px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(def.livery.registration, 512, 64);
  });
  for (const side of [-1, 1]) {
    const width = (x: number, z: number) => {
      const t = (x - d.boom.front[0]) / (d.boom.rear[0] - d.boom.front[0]);
      const r = THREE.MathUtils.lerp(...d.boom.radii, t), centre = THREE.MathUtils.lerp(d.boom.front[2], d.boom.rear[2], t);
      return Math.sqrt(Math.max(0, r * r - (z - centre) ** 2));
    };
    const centre = (x: number) => THREE.MathUtils.lerp(d.boom.front[2], d.boom.rear[2],
      (x - d.boom.front[0]) / (d.boom.rear[0] - d.boom.front[0]));
    const mesh = new THREE.Mesh(sidePatch(width, side, -2.85, -4.05, -0.04, 0.04, centre), letters);
    mesh.name = 's269Registration'; group.add(mesh);
  }
  const badge = lettering('s269TankBadge', 512, 256, ctx => {
    ctx.textAlign = 'center'; ctx.fillStyle = '#26586a'; ctx.font = 'italic 44px serif'; ctx.fillText('Schweizer', 256, 89);
    ctx.font = 'bold 78px sans-serif'; ctx.fillText('300', 183, 171); ctx.fillStyle = '#be2e2c'; ctx.fillText('CB', 328, 171);
  });
  const badgeMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.18), badge);
  badgeMesh.position.copy(frd(-0.47, -0.616, -0.54)); badgeMesh.rotation.y = -Math.PI / 2; badgeMesh.name = 's269TankBadge'; group.add(badgeMesh);
  return { group, materials, textures };
}
