// Biot-Savart kernels for straight vortex filaments and horseshoe vortices (Katz & Plotkin,
// "Low-Speed Aerodynamics", 2nd ed., sec. 10.2.2), with a solid-core cut-off so points close to a
// filament see a finite velocity. All functions ACCUMULATE into `out` and allocate nothing.

import type { Vec3 } from '../../core/math';

export interface MutableVec3 {
  x: number;
  y: number;
  z: number;
}

const INV_4PI = 1 / (4 * Math.PI);

/** Velocity at p induced by a filament from a to b of strength `gamma` (right-hand rule along a->b). */
export function addSegmentVelocity(p: Vec3, a: Vec3, b: Vec3, gamma: number, core: number, out: MutableVec3): void {
  const r1x = p.x - a.x, r1y = p.y - a.y, r1z = p.z - a.z;
  const r2x = p.x - b.x, r2y = p.y - b.y, r2z = p.z - b.z;
  const n1 = Math.sqrt(r1x * r1x + r1y * r1y + r1z * r1z);
  const n2 = Math.sqrt(r2x * r2x + r2y * r2y + r2z * r2z);
  if (n1 < 1e-9 || n2 < 1e-9) return;
  const cx = r1y * r2z - r1z * r2y;
  const cy = r1z * r2x - r1x * r2z;
  const cz = r1x * r2y - r1y * r2x;
  const r0x = b.x - a.x, r0y = b.y - a.y, r0z = b.z - a.z;
  const r0sq = r0x * r0x + r0y * r0y + r0z * r0z;
  const dot = r0x * (r1x / n1 - r2x / n2) + r0y * (r1y / n1 - r2y / n2) + r0z * (r1z / n1 - r2z / n2);
  const k = (gamma * INV_4PI * dot) / (cx * cx + cy * cy + cz * cz + core * core * r0sq);
  out.x += k * cx;
  out.y += k * cy;
  out.z += k * cz;
}

/** Velocity at p induced by a semi-infinite filament starting at a and running to infinity along unit u. */
export function addSemiInfiniteVelocity(p: Vec3, a: Vec3, u: Vec3, gamma: number, core: number, out: MutableVec3): void {
  const rx = p.x - a.x, ry = p.y - a.y, rz = p.z - a.z;
  const rl = Math.sqrt(rx * rx + ry * ry + rz * rz);
  if (rl < 1e-9) return;
  const ur = u.x * rx + u.y * ry + u.z * rz;
  const h2 = Math.max(rl * rl - ur * ur, 0);
  const k = (gamma * INV_4PI * (1 + ur / rl)) / (h2 + core * core);
  out.x += k * (u.y * rz - u.z * ry);
  out.y += k * (u.z * rx - u.x * rz);
  out.z += k * (u.x * ry - u.y * rx);
}

/**
 * Velocity at p induced by a horseshoe vortex of strength `gamma`: a trailing leg that lies along a + s u
 * (s > 0) and runs toward a, the bound segment a->b, and a trailing leg from b to infinity along the
 * wake direction u.
 */
export function addHorseshoeVelocity(p: Vec3, a: Vec3, b: Vec3, u: Vec3, gamma: number, core: number, out: MutableVec3): void {
  addSegmentVelocity(p, a, b, gamma, core, out);
  addSemiInfiniteVelocity(p, b, u, gamma, core, out);
  addSemiInfiniteVelocity(p, a, u, -gamma, core, out);
}

/**
 * Horseshoe whose trailing legs first run from the bound-vortex ends a, b to the trailing-edge points ta, tb
 * (along the chord) and then to infinity along the wake direction u.
 */
export function addChordwiseHorseshoe(p: Vec3, a: Vec3, b: Vec3, ta: Vec3, tb: Vec3, u: Vec3, gamma: number, core: number, out: MutableVec3): void {
  addSegmentVelocity(p, a, b, gamma, core, out);
  addSegmentVelocity(p, b, tb, gamma, core, out);
  addSemiInfiniteVelocity(p, tb, u, gamma, core, out);
  addSegmentVelocity(p, ta, a, gamma, core, out);
  addSemiInfiniteVelocity(p, ta, u, -gamma, core, out);
}
