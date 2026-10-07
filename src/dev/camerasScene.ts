// Stand-in scenery and aircraft for the camera dev page: a textured ground, the runway, scattered
// buildings/trees for motion and scale cues, a tower block at the tower camera, and a box-model C172
// (with a simple instrument panel and window posts so the cockpit view has a frame of reference).

import * as THREE from 'three';
import { C172 } from '../core/c172';
import { nedToThree } from '../core/frames';
import type { Vec3 } from '../core/math';
import { AIRPORT } from '../core/world';

function groundTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d')!;
  g.fillStyle = '#5d7d3c';
  g.fillRect(0, 0, 512, 512);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 4000; i++) {
    const v = 70 + rnd() * 60;
    g.fillStyle = `rgba(${v * 0.8},${v * 1.1},${v * 0.5},0.35)`;
    g.fillRect(rnd() * 512, rnd() * 512, 2 + rnd() * 10, 2 + rnd() * 10);
  }
  g.strokeStyle = 'rgba(40,50,25,0.5)';
  g.lineWidth = 2;
  g.strokeRect(0, 0, 512, 512);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function buildScenery(scene: THREE.Scene, towerNED: Vec3): void {
  const size = 40000;
  const tex = groundTexture();
  tex.repeat.set(size / 100, size / 100);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 1 }),
  );
  ground.position.y = AIRPORT.elevation;
  ground.receiveShadow = true;
  scene.add(ground);

  // Runway with centreline dashes, laid along its true heading (three yaw = -heading).
  const rw = AIRPORT.runway;
  const runway = new THREE.Group();
  const asphalt = new THREE.Mesh(
    new THREE.PlaneGeometry(rw.width, rw.length).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x3a3a3c, roughness: 0.9 }),
  );
  runway.add(asphalt);
  const paint = new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.8 });
  for (let a = -rw.length / 2 + 60; a < rw.length / 2 - 60; a += 50) {
    const dash = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 30).rotateX(-Math.PI / 2), paint);
    dash.position.set(0, 0.02, a);
    runway.add(dash);
  }
  runway.position.set(rw.center.east, AIRPORT.elevation + 0.03, -rw.center.north);
  runway.rotation.y = -rw.heading;
  scene.add(runway);

  // Scattered trees (cones) and buildings (boxes), deterministic.
  const treeGeo = new THREE.ConeGeometry(3, 12, 7).translate(0, 6, 0);
  const treeMat = new THREE.MeshStandardMaterial({ color: 0x2f4f22, roughness: 1 });
  const houseGeo = new THREE.BoxGeometry(10, 6, 14).translate(0, 3, 0);
  const houseMat = new THREE.MeshStandardMaterial({ color: 0xb8a68a, roughness: 0.9 });
  const trees = new THREE.InstancedMesh(treeGeo, treeMat, 1500);
  const houses = new THREE.InstancedMesh(houseGeo, houseMat, 200);
  const m = new THREE.Matrix4();
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const place = (mesh: THREE.InstancedMesh, count: number, scale: number) => {
    for (let i = 0; i < count; ) {
      const n = (rnd() - 0.5) * 9000;
      const e = (rnd() - 0.5) * 9000;
      const along = n * Math.cos(rw.heading) + e * Math.sin(rw.heading);
      const across = -n * Math.sin(rw.heading) + e * Math.cos(rw.heading);
      if (Math.abs(across) < 180 && Math.abs(along) < 1500) continue; // keep the runway strip clear
      const s = scale * (0.7 + rnd() * 0.6);
      m.makeRotationY(rnd() * Math.PI).scale(new THREE.Vector3(s, s, s)).setPosition(e, AIRPORT.elevation, -n);
      mesh.setMatrixAt(i++, m);
    }
    mesh.castShadow = true;
    scene.add(mesh);
  };
  place(trees, 1500, 1);
  place(houses, 200, 1);

  const towerTop = nedToThree(towerNED);
  const towerH = towerTop.y - AIRPORT.elevation;
  const tower = new THREE.Mesh(
    new THREE.BoxGeometry(6, towerH - 1.5, 6).translate(0, (towerH - 1.5) / 2, 0),
    new THREE.MeshStandardMaterial({ color: 0xd0ccc4, roughness: 0.8 }),
  );
  tower.position.set(towerTop.x + 4, AIRPORT.elevation, towerTop.z + 4);
  scene.add(tower);
}

/** Box-model C172 in model space (nose -Z, right +X, up +Y), positioned from the shared geometry. */
export function buildStandInAircraft(root: THREE.Object3D): void {
  const white = new THREE.MeshStandardMaterial({ color: 0xf2f2f0, roughness: 0.5 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x9c1c1c, roughness: 0.5 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1e1f22, roughness: 0.7 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x223344, roughness: 0.1, transparent: true, opacity: 0.25 });
  const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    b.position.set(x, y, z);
    b.castShadow = true;
    root.add(b);
    return b;
  };
  // FRD -> model: (x, y, z) -> (y, -z, -x)
  const f = C172.fuselage;
  box(1.0, 0.85, 1.45, white, 0, -0.1, -1.52); // engine cowl, top just below the glare shield
  box(1.06, 0.9, 1.8, glass, 0, 0.1, 0.55); // cabin glazing
  box(1.06, 0.5, 2.2, white, 0, -0.45, 0.3); // cabin lower half
  box(0.6, 0.6, 3.4, white, 0, 0.25, 3.0); // tail cone
  box(C172.wing.span, 0.14, C172.wing.meanChord, white, 0, 0.62, 0.05);
  box(C172.hTail.span, 0.08, 0.95, white, 0, 0.25, 4.6);
  box(0.08, C172.vTail.height, 1.1, trim, 0, 0.25 + C172.vTail.height / 2, 4.95);
  box(0.12, 0.4, 0.4, dark, 0, 0, -f.noseX + 0.15); // spinner
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(C172.prop.diameter / 2, 32),
    new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.15, side: THREE.DoubleSide }),
  );
  disc.position.set(0, 0, -C172.prop.hub.x);
  root.add(disc);
  for (const side of [-1, 1]) {
    const strut = box(0.06, 0.06, 2.1, white, 0, 0, 0);
    const s = C172.wing.strut;
    strut.position.set(side * (s.fuselage.y + s.wing.y) / 2, -(s.fuselage.z + s.wing.z) / 2, 0);
    strut.lookAt(new THREE.Vector3(side * s.wing.y, -s.wing.z, 0));
    box(0.12, 0.44, 0.44, dark, side * C172.gear.leftMain.y * -1, -1.25 + 0.22, -C172.gear.leftMain.x);
  }
  box(0.1, 0.38, 0.38, dark, 0, -1.25 + 0.19, -C172.gear.nose.x);
  // Cockpit: instrument panel, glare shield, window posts.
  box(1.0, 0.4, 0.06, dark, 0, 0.0, -0.62);
  box(1.0, 0.05, 0.3, dark, 0, 0.22, -0.72);
  for (const side of [-1, 1]) box(0.05, 0.75, 0.05, white, side * 0.5, 0.62, -0.72);
}
