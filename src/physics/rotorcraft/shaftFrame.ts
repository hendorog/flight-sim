// The frame of a main-rotor shaft tilted forward by `tilt` (RotorcraftDefinition.shaftTilt; the MD 500E's 3 deg
// static mast): x forward in the plane of the hub, y right, z along the shaft (down). The rotor's flap coordinates
// (RotorcraftState.flapForward / flapRight) are in this frame, so every consumer that turns them into airframe
// geometry (loads, blade-to-airframe and blade-to-ground contacts) rotates the result back to the body.

import type { Vec3 } from '../../core/math';

/** Body vector to the frame of a shaft tilted forward by `tilt` (its z along the shaft, down). */
export function toShaft(v: Vec3, tilt: number): Vec3 {
  const c = Math.cos(tilt), sn = Math.sin(tilt);
  return { x: v.x * c + v.z * sn, y: v.y, z: v.z * c - v.x * sn };
}
/** Shaft-frame vector back to the body. */
export function toBody(v: Vec3, tilt: number): Vec3 {
  const c = Math.cos(tilt), sn = Math.sin(tilt);
  return { x: v.x * c - v.z * sn, y: v.y, z: v.x * sn + v.z * c };
}
/** A point given in the shaft frame relative to the hub, as a body (airframe datum) point. Untilted: unchanged arithmetic. */
export function hubPointToBody(hub: Vec3, p: Vec3, tilt: number): Vec3 {
  if (!tilt) return { x: hub.x + p.x, y: hub.y + p.y, z: hub.z + p.z };
  const b = toBody(p, tilt);
  return { x: hub.x + b.x, y: hub.y + b.y, z: hub.z + b.z };
}
