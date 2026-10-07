// Test geometry for the sky/lighting dev page: a textured ground plane with a runway, PBR spheres and a
// stand-in aircraft for close shadows, trees and buildings for the mid cascades, and boxes and mountains
// at 1, 20 and 80 km for aerial perspective.

import * as THREE from 'three';
import { AIRPORT } from '../core/world';

const ELEV = AIRPORT.elevation;
/** three.js position from NED north/east and a height above the airfield. */
const at = (north: number, east: number, up = 0): THREE.Vector3 => new THREE.Vector3(east, ELEV + up, -north);

function noiseTexture(size: number, seed: number): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  let s = seed;
  const rnd = (): number => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const grid = Array.from({ length: 17 * 17 }, rnd);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const gx = (x / size) * 16;
      const gy = (y / size) * 16;
      const ix = Math.floor(gx);
      const iy = Math.floor(gy);
      const fx = gx - ix;
      const fy = gy - iy;
      const g = (i: number, j: number): number => grid[((j % 16) * 17 + (i % 16)) % grid.length];
      const v = THREE.MathUtils.lerp(THREE.MathUtils.lerp(g(ix, iy), g(ix + 1, iy), fx), THREE.MathUtils.lerp(g(ix, iy + 1), g(ix + 1, iy + 1), fx), fy);
      const n = 0.75 + 0.35 * v + 0.12 * (rnd() - 0.5);
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = Math.min(255, n * 200);
      data[i + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, size, size);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

/**
 * Drop vertices by d^2 / 2R with horizontal distance d from the camera, the curved-earth approximation
 * the clouds use, so far geometry sits where it would on a spherical planet (as the atmosphere assumes).
 */
function curveEarth<T extends THREE.Material>(m: T): T {
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      `{
        vec2 dxz = (modelMatrix * vec4(transformed, 1.0)).xz - cameraPosition.xz;
        transformed.y -= dot(dxz, dxz) * ${(1 / (2 * 6_360_000)).toExponential(6)};
      }
      #include <project_vertex>`,
    );
  };
  return m;
}

function shadowed<T extends THREE.Object3D>(o: T): T {
  o.traverse((c) => {
    c.castShadow = true;
    c.receiveShadow = true;
  });
  return o;
}

export function buildSkyTestScene(scene: THREE.Scene, aircraftRoot: THREE.Object3D): void {
  const std = (color: number, roughness = 0.9, metalness = 0): THREE.MeshStandardMaterial =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness });

  // Ground: 800 km square so the horizon is terrain from any test altitude, tessellated to 2 km so vertex
  // positions stay small enough for float32 precision near the camera.
  const groundTex = noiseTexture(256, 7);
  groundTex.repeat.set(4000, 4000);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(800_000, 800_000, 400, 400).rotateX(-Math.PI / 2), curveEarth(new THREE.MeshStandardMaterial({ color: 0x4d6b35, map: groundTex, roughness: 1 })));
  ground.position.y = ELEV;
  ground.receiveShadow = true;
  scene.add(ground);

  // Runway with centreline dashes (markings are what AA must keep steady).
  const runway = new THREE.Group();
  runway.rotation.y = -AIRPORT.runway.heading + Math.PI / 2;
  runway.position.copy(at(0, 0, 0.05));
  const asphalt = new THREE.Mesh(new THREE.PlaneGeometry(AIRPORT.runway.length, AIRPORT.runway.width).rotateX(-Math.PI / 2), std(0x4a4a4a, 0.85));
  asphalt.receiveShadow = true;
  runway.add(asphalt);
  const paint = std(0xdddddd, 0.6);
  for (let x = -AIRPORT.runway.length / 2 + 60; x < AIRPORT.runway.length / 2 - 60; x += 50) {
    const dash = new THREE.Mesh(new THREE.PlaneGeometry(30, 0.9).rotateX(-Math.PI / 2), paint);
    dash.position.set(x, 0.01, 0);
    dash.receiveShadow = true;
    runway.add(dash);
  }
  scene.add(runway);

  // Stand-in aircraft: nose toward -Z, right wing +X.
  const white = std(0xf2f2f2, 0.35);
  const fuselage = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.3, 7.5), white);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(11, 0.14, 1.5), white);
  wing.position.set(0, 0.85, -0.6);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.6, 1.2), std(0xaa2222, 0.4));
  tail.position.set(0, 1.2, 3.3);
  const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.2), std(0x999999, 0.4, 1));
  strut.position.set(1.4, 0.2, -0.6);
  strut.rotation.z = 0.9;
  aircraftRoot.add(shadowed(new THREE.Group().add(fuselage, wing, tail, strut)));

  // PBR spheres: roughness sweep, dielectric (top row) and metal (bottom row).
  [0.05, 0.3, 0.6, 1].forEach((roughness, i) => {
    for (const metal of [0, 1]) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.8, 48, 24), std(metal ? 0xd8c8a0 : 0xb03020, roughness, metal));
      s.position.copy(at(-4 + i * 2.2, 9 + metal * 2.2, 0.8));
      scene.add(shadowed(s));
    }
  });
  const cube = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), std(0x808080));
  cube.position.copy(at(10, -6, 1));
  scene.add(shadowed(cube));

  // Buildings at the apron, trees scattered 150 m .. 3 km.
  for (let i = 0; i < 8; i++) {
    const h = 6 + (i % 3) * 5;
    const b = new THREE.Mesh(new THREE.BoxGeometry(18, h, 14), std(i % 2 ? 0xb8b0a0 : 0x8a8f96, 0.8));
    b.position.copy(at(AIRPORT.apron.north + 60 + (i % 4) * 30, AIRPORT.apron.east - 40 + Math.floor(i / 4) * 40, h / 2));
    scene.add(shadowed(b));
  }
  const trees = new THREE.InstancedMesh(new THREE.ConeGeometry(3.5, 14, 8).translate(0, 7, 0), std(0x2f4a22, 0.95), 600);
  const m = new THREE.Matrix4();
  let s = 11;
  const rnd = (): number => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < trees.count; i++) {
    const r = 150 + 2850 * rnd() ** 1.5;
    const a = rnd() * Math.PI * 2;
    const k = 0.7 + 0.6 * rnd();
    m.makeScale(k, k, k).setPosition(at(Math.cos(a) * r, Math.sin(a) * r));
    trees.setMatrixAt(i, m);
  }
  scene.add(shadowed(trees));

  // Distance markers: 60 m boxes at 1 km, 600 m hills at 20 km, 2.5 km mountains at 80 km.
  const rock = curveEarth(std(0x6f6a60, 0.95));
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const box = new THREE.Mesh(new THREE.BoxGeometry(60, 60, 60), std(0x9a9486, 0.9));
    box.position.copy(at(Math.cos(a) * 1000, Math.sin(a) * 1000, 30));
    scene.add(shadowed(box));
    const hill = new THREE.Mesh(new THREE.ConeGeometry(2500, 600, 24), rock);
    hill.position.copy(at(Math.cos(a + 0.3) * 20_000, Math.sin(a + 0.3) * 20_000, 300));
    scene.add(shadowed(hill));
    const mountain = new THREE.Mesh(new THREE.ConeGeometry(9000, 2500, 24), rock);
    mountain.position.copy(at(Math.cos(a + 0.2) * 80_000, Math.sin(a + 0.2) * 80_000, 1250));
    scene.add(shadowed(mountain));
  }
}
