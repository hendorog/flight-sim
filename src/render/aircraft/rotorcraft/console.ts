// Separate instrument shell, overhanging hood and pedestal, all in the face's local coordinates.
import * as THREE from 'three';
import type { RotorcraftVisualDef } from '../airframe/types';
import type { PanelDef } from '../../../instruments/panelDef';

export function consoleShape(outline: readonly (readonly [number, number])[], p: RotorcraftVisualDef['panel']): THREE.Shape {
  return new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2((x / p.canvas.w - 0.5) * p.width, (0.5 - y / p.canvas.h) * p.height)));
}

export function buildConsole(pod: THREE.Group, p: RotorcraftVisualDef['panel'], def: PanelDef | undefined,
  material: THREE.MeshStandardMaterial): THREE.Material[] {
  const d = def?.console;
  const outline = p.outline ?? [[0, 0], [p.canvas.w, 0], [p.canvas.w, p.canvas.h], [0, p.canvas.h]];
  const shellMaterial = material.clone(), stemMaterial = material.clone();
  shellMaterial.color.setHex(d?.color ?? 0x252825); stemMaterial.color.setHex(d?.pedestalColor ?? 0x333733);
  const shell = (points: typeof outline, depth: number, m: THREE.Material, name: string): void => {
    const shape = consoleShape(points, p);
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: depth - 0.016, steps: 1, bevelEnabled: true,
      bevelThickness: 0.006, bevelSize: 0.005, bevelSegments: 3, curveSegments: 8 });
    geometry.translate(0, 0, -depth);
    const mesh = new THREE.Mesh(geometry, m); mesh.name = name;
    mesh.castShadow = mesh.receiveShadow = true; pod.add(mesh);
  };
  const upper = d?.podOutline ?? outline;
  shell(upper, p.enclosureDepth ?? 0.146, shellMaterial, 'consoleHousing');
  if (d) shell(d.pedestalOutline, 0.11, stemMaterial, 'pedestalHousing');

  // The rolled lip projects aft of the face, deepest across the brow. Its side returns taper to
  // the lower pod edge, leaving all dials and warning lenses exposed from either seat.
  const points = upper.map(([x, y]) => new THREE.Vector3((x / p.canvas.w - 0.5) * p.width,
    (0.5 - y / p.canvas.h) * p.height, 0.008));
  const path = new THREE.CurvePath<THREE.Vector3>();
  points.forEach((q, i) => path.add(new THREE.LineCurve3(q, points[(i + 1) % points.length])));
  const rim = new THREE.Mesh(new THREE.TubeGeometry(path, Math.max(240, points.length * 2), 0.009, 8, true), shellMaterial);
  rim.name = 'consoleRim'; rim.castShadow = true; pod.add(rim);
  if (d) {
    const vertices: number[] = [], indices: number[] = [];
    const bottom = Math.max(...upper.map(q => q[1]));
    upper.forEach(([x, y], i) => {
      const point = points[i];
      const reach = 0.006 + (d.hoodOverhang - 0.006) * Math.max(0, 1 - y / (bottom * 0.78));
      for (const z of [-0.04, reach]) vertices.push(point.x, point.y + (y < 90 ? 0.003 : 0), z);
      const a = 2 * i, b = 2 * ((i + 1) % upper.length);
      indices.push(a, a + 1, b, b, a + 1, b + 1);
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); geometry.setIndex(indices); geometry.computeVertexNormals();
    const hoodMaterial = shellMaterial.clone(); hoodMaterial.side = THREE.DoubleSide;
    const hood = new THREE.Mesh(geometry, hoodMaterial); hood.name = 'consoleHood'; hood.castShadow = hood.receiveShadow = true; pod.add(hood);
    return [shellMaterial, stemMaterial, hoodMaterial];
  }
  return [shellMaterial, stemMaterial];
}
