// A parked aircraft with an external camera dragged down to ground level: the camera must hold still (the sight-line
// lift used to decay between its every-third-frame samples and snap back, bouncing the view ~12 cm at 20 Hz).
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SimContext } from '../../src/core/context';
import { quat } from '../../src/core/math';
import type { AircraftState } from '../../src/core/types';
import { CameraSystem } from '../../src/render/cameras/CameraSystem';

function parked(): AircraftState {
  return {
    position: { x: 0, y: 0, z: -1.0 },
    orientation: quat.fromEuler(0, 0.05, 0.3),
    velocity: { x: 0, y: 0, z: 0 },
    angularVelocity: { x: 0, y: 0, z: 0 },
    specificForce: { x: 0, y: 0, z: -1 },
    roll: 0, pitch: 0.05, heading: 0.3, ias: 0, groundSpeed: 0, onGround: true, stallFraction: 0,
    altitudeAGL: 1, altitudeMSL: 1, verticalSpeed: 0,
  } as AircraftState;
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('external camera at ground level, aircraft parked', () => {
  for (const mode of ['chase', 'orbit'] as const) {
    for (const ground of ['flat', 'rise'] as const) {
      it(`${mode} on ${ground} ground holds still`, () => {
        const nowhere = { clientWidth: 1366, clientHeight: 768, addEventListener: () => {}, removeEventListener: () => {},
          getBoundingClientRect: () => ({ left: 0, top: 0, width: 1366, height: 768 }) };
        vi.stubGlobal('window', nowhere);
        vi.stubGlobal('document', { pointerLockElement: null, exitPointerLock: () => {} });
        let wall = 1000;
        vi.spyOn(performance, 'now').mockImplementation(() => wall);
        // A gentle rise between camera and aircraft (behind the aircraft), or flat.
        const elev = ground === 'flat' ? () => 0 : (n: number, e: number) => Math.max(0, 0.8 - Math.abs(Math.hypot(n, e) - 8) * 0.2);
        const cameras = new CameraSystem({ towerPositionNED: { x: 500, y: 500, z: -10 }, domElement: nowhere as unknown as HTMLElement });
        const ctx = { state: parked(), env: { surface: () => 'runway', groundElevation: elev }, weather: { turbulence: 0 },
          camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 60000), events: { on: () => () => {} }, cameraMode: mode } as unknown as SimContext;
        cameras.init(ctx);
        // Drag the view down to ground level.
        const rig = (cameras as unknown as { rigs: Record<string, { look?: (dx: number, dy: number) => void }> }).rigs[mode];
        rig.look?.(0, -3000);
        const ys: number[] = [];
        const qs: number[] = [];
        for (let i = 0; i < 600; i++) {
          wall += 1000 / 60;
          cameras.update(1 / 60, ctx);
          if (i >= 420) { ys.push(ctx.camera.position.y); qs.push(ctx.camera.quaternion.x); }
        }
        let jump = 0, jq = 0;
        for (let i = 1; i < ys.length; i++) { jump = Math.max(jump, Math.abs(ys[i] - ys[i - 1])); jq = Math.max(jq, Math.abs(qs[i] - qs[i - 1])); }
        expect(jump).toBeLessThan(1e-3);
        expect(jq).toBeLessThan(1e-4);
      });
    }
  }
});
