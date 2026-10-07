// Minimal harness page: a ground plane and a box at the mock aircraft position. Verifies the harness,
// frame mapping and screenshot tooling; also a template for other dev pages.
import * as THREE from 'three';
import { runHarness } from './harness';
import { AIRPORT } from '../core/world';

void runHarness({
  subsystems: [
    {
      init(ctx) {
        const ground = new THREE.Mesh(
          new THREE.PlaneGeometry(20000, 20000).rotateX(-Math.PI / 2),
          new THREE.MeshStandardMaterial({ color: 0x4f7a3a, roughness: 1 }),
        );
        ground.position.y = AIRPORT.elevation;
        ctx.scene.add(ground);
        // Nose toward -Z, right wing +X, up +Y.
        const fuselage = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.3, 7), new THREE.MeshStandardMaterial({ color: 0xffffff }));
        const wing = new THREE.Mesh(new THREE.BoxGeometry(11, 0.15, 1.5), new THREE.MeshStandardMaterial({ color: 0xcc2222 }));
        wing.position.set(0, 0.8, -0.5);
        ctx.aircraftRoot.add(fuselage, wing);
      },
      update() {},
    },
  ],
});
