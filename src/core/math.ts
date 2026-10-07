// Shared math for physics and simulation code. No dependency on three.js so it runs in node tests.
// Vectors and quaternions are plain immutable-style objects; every function returns a new value.

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Unit quaternion, Hamilton convention. In this codebase `q` rotates body-frame vectors into the NED frame. */
export interface Quat {
  w: number;
  x: number;
  y: number;
  z: number;
}

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
/** Wrap angle to (-PI, PI]. */
export const wrapPi = (a: number): number => {
  a = (a + Math.PI) % (2 * Math.PI);
  if (a <= 0) a += 2 * Math.PI;
  return a - Math.PI;
};
/** Wrap angle to [0, 2PI). */
export const wrapTwoPi = (a: number): number => {
  a %= 2 * Math.PI;
  return a < 0 ? a + 2 * Math.PI : a;
};

/** Piecewise-linear table lookup; xs must be ascending. Clamps outside the range. */
export function interp1(xs: readonly number[], ys: readonly number[], x: number): number {
  const n = xs.length;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[n - 1]) return ys[n - 1];
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid;
    else hi = mid;
  }
  return lerp(ys[lo], ys[hi], (x - xs[lo]) / (xs[hi] - xs[lo]));
}

export const v3 = {
  make: (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z }),
  zero: (): Vec3 => ({ x: 0, y: 0, z: 0 }),
  clone: (a: Vec3): Vec3 => ({ x: a.x, y: a.y, z: a.z }),
  add: (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }),
  sub: (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }),
  scale: (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s }),
  /** a + b * s */
  addScaled: (a: Vec3, b: Vec3, s: number): Vec3 => ({ x: a.x + b.x * s, y: a.y + b.y * s, z: a.z + b.z * s }),
  neg: (a: Vec3): Vec3 => ({ x: -a.x, y: -a.y, z: -a.z }),
  dot: (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z,
  cross: (a: Vec3, b: Vec3): Vec3 => ({
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  }),
  lenSq: (a: Vec3): number => a.x * a.x + a.y * a.y + a.z * a.z,
  len: (a: Vec3): number => Math.hypot(a.x, a.y, a.z),
  normalize: (a: Vec3): Vec3 => {
    const l = Math.hypot(a.x, a.y, a.z);
    return l > 1e-12 ? { x: a.x / l, y: a.y / l, z: a.z / l } : { x: 0, y: 0, z: 0 };
  },
  lerp: (a: Vec3, b: Vec3, t: number): Vec3 => ({
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  }),
};

export const quat = {
  identity: (): Quat => ({ w: 1, x: 0, y: 0, z: 0 }),
  clone: (q: Quat): Quat => ({ w: q.w, x: q.x, y: q.y, z: q.z }),
  mul: (a: Quat, b: Quat): Quat => ({
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  }),
  conj: (q: Quat): Quat => ({ w: q.w, x: -q.x, y: -q.y, z: -q.z }),
  normalize: (q: Quat): Quat => {
    const l = Math.hypot(q.w, q.x, q.y, q.z) || 1;
    return { w: q.w / l, x: q.x / l, y: q.y / l, z: q.z / l };
  },
  /** Rotate v by q (body -> NED when q is an aircraft orientation). */
  rotate: (q: Quat, v: Vec3): Vec3 => {
    // v' = v + 2w(u x v) + 2u x (u x v)
    const ux = q.x, uy = q.y, uz = q.z, w = q.w;
    const cx = uy * v.z - uz * v.y;
    const cy = uz * v.x - ux * v.z;
    const cz = ux * v.y - uy * v.x;
    return {
      x: v.x + 2 * (w * cx + uy * cz - uz * cy),
      y: v.y + 2 * (w * cy + uz * cx - ux * cz),
      z: v.z + 2 * (w * cz + ux * cy - uy * cx),
    };
  },
  /** Rotate v by the inverse of q (NED -> body when q is an aircraft orientation). */
  rotateInv: (q: Quat, v: Vec3): Vec3 => quat.rotate({ w: q.w, x: -q.x, y: -q.y, z: -q.z }, v),
  fromAxisAngle: (axis: Vec3, angle: number): Quat => {
    const a = v3.normalize(axis);
    const s = Math.sin(angle / 2);
    return { w: Math.cos(angle / 2), x: a.x * s, y: a.y * s, z: a.z * s };
  },
  /** Aerospace 3-2-1 Euler angles (heading psi about down, pitch theta about right, roll phi about forward) -> body->NED quaternion. */
  fromEuler: (roll: number, pitch: number, heading: number): Quat => {
    const cr = Math.cos(roll / 2), sr = Math.sin(roll / 2);
    const cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
    const cy = Math.cos(heading / 2), sy = Math.sin(heading / 2);
    return {
      w: cr * cp * cy + sr * sp * sy,
      x: sr * cp * cy - cr * sp * sy,
      y: cr * sp * cy + sr * cp * sy,
      z: cr * cp * sy - sr * sp * cy,
    };
  },
  /** Inverse of fromEuler. heading in [0, 2PI). */
  toEuler: (q: Quat): { roll: number; pitch: number; heading: number } => {
    const roll = Math.atan2(2 * (q.w * q.x + q.y * q.z), 1 - 2 * (q.x * q.x + q.y * q.y));
    const pitch = Math.asin(clamp(2 * (q.w * q.y - q.z * q.x), -1, 1));
    const heading = wrapTwoPi(Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z)));
    return { roll, pitch, heading };
  },
  /** Time derivative of a body->NED quaternion given body angular velocity omega (rad/s): qdot = 0.5 * q * (0, omega). */
  derivative: (q: Quat, omega: Vec3): Quat => ({
    w: 0.5 * (-q.x * omega.x - q.y * omega.y - q.z * omega.z),
    x: 0.5 * (q.w * omega.x + q.y * omega.z - q.z * omega.y),
    y: 0.5 * (q.w * omega.y + q.z * omega.x - q.x * omega.z),
    z: 0.5 * (q.w * omega.z + q.x * omega.y - q.y * omega.x),
  }),
};

// Unit conversions
export const KT = 0.514444; // m/s per knot
export const FT = 0.3048; // m per foot
export const NM = 1852; // m per nautical mile
export const FPM = 0.00508; // m/s per ft/min
export const LB = 0.45359237; // kg per lb
export const HP = 745.699872; // W per hp
export const INHG = 3386.389; // Pa per inHg
export const G0 = 9.80665; // m/s^2
