// Camera pose type and small helpers shared by the camera rigs.

import * as THREE from 'three';
import { clamp, RAD } from '../../core/math';

export interface CameraPose {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  /** Vertical field of view, degrees. */
  fov: number;
}

export const makePose = (fov = 60): CameraPose => ({ position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), fov });

export function copyPose(from: CameraPose, to: CameraPose): void {
  to.position.copy(from.position);
  to.quaternion.copy(from.quaternion);
  to.fov = from.fov;
}

/** The aircraft's pose in three.js world space, computed once per frame by CameraSystem. */
export interface AircraftPose {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
}

export const WORLD_UP = new THREE.Vector3(0, 1, 0);
const m = new THREE.Matrix4();

/** Orientation of a camera at `eye` looking at `target` (three.js cameras look down their local -Z). */
export function lookAtQuat(eye: THREE.Vector3, target: THREE.Vector3, up: THREE.Vector3, out: THREE.Quaternion): THREE.Quaternion {
  m.lookAt(eye, target, up);
  return out.setFromRotationMatrix(m);
}

/** Vertical FOV (degrees) that makes an object of `size` metres fill `fraction` of the view height at `dist`. */
export function fitFov(size: number, dist: number, fraction: number, minDeg: number, maxDeg: number): number {
  const fov = 2 * Math.atan(size / (2 * Math.max(dist, 0.1) * fraction)) * RAD;
  return clamp(fov, minDeg, maxDeg);
}

/** Frame-rate independent exponential smoothing factor for time constant tau. */
export const smoothing = (dt: number, tau: number): number => (tau <= 0 ? 1 : 1 - Math.exp(-dt / tau));

/** Zoom FOV by a number of wheel steps (+ = in), multiplicatively so each step feels the same. */
export const zoomFov = (fov: number, steps: number, minDeg: number, maxDeg: number): number =>
  clamp(fov * Math.pow(0.9, steps), minDeg, maxDeg);
