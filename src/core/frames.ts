// Mapping between the simulation frames (NED world, FRD body) and three.js (Y-up, right-handed).
//
//   three.x =  East   (body: right wing)
//   three.y =  Up     (body: up)
//   three.z = -North  (body: aft)   => an aircraft model is authored with its nose toward -Z.
//
// The same proper rotation maps NED->three-world and FRD->three-model, so a body->NED quaternion
// converts to the three.js object quaternion by transforming only its vector part.

import * as THREE from 'three';
import type { Quat, Vec3 } from './math';

export function nedToThree(v: Vec3, out: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 {
  return out.set(v.y, -v.z, -v.x);
}

export function threeToNed(v: { x: number; y: number; z: number }): Vec3 {
  return { x: -v.z, y: v.x, z: -v.y };
}

export function quatToThree(q: Quat, out: THREE.Quaternion = new THREE.Quaternion()): THREE.Quaternion {
  return out.set(q.y, -q.z, -q.x, q.w);
}

/** Place a three.js object at an aircraft's position and attitude. */
export function applyPose(obj: THREE.Object3D, position: Vec3, orientation: Quat): void {
  nedToThree(position, obj.position);
  quatToThree(orientation, obj.quaternion);
}
