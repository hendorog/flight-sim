// Minimal 6-DOF rigid-body rig for exercising the landing gear without the rest of the flight model:
// gravity + gear + an optional external body-axis force, integrated with semi-implicit Euler at 240 Hz.
// The CG is at the reference point (cgOffset = 0), so `position` is both. The rig takes the gear
// configuration, mass and principal inertias of the aircraft on it; the defaults are the Cessna 172S.

import { C172 } from '../../src/core/c172';
import { G0, quat, v3, type Quat, type Vec3 } from '../../src/core/math';
import { defaultControls, type ControlInputs, type Environment, type SurfaceType } from '../../src/core/types';
import { AIRPORT } from '../../src/core/world';
import type { GearOutput } from '../../src/physics/interfaces';
import { C172_GEAR, LandingGear, type GearConfig } from '../../src/physics/gear';

export const DT = 1 / 240;
export const MASS = 1050;

/** Inclined plane through (0, 0, elevation) with the given up-normal (NED, z < 0). */
export function planeEnvironment(surface: SurfaceType = 'runway', normal: Vec3 = { x: 0, y: 0, z: -1 }, elevation = AIRPORT.elevation): Environment {
  const n = v3.normalize(normal);
  return {
    atmosphere: () => ({ temperature: 288, pressure: 101325, density: 1.225, speedOfSound: 340, viscosity: 1.8e-5 }),
    wind: () => v3.zero(),
    groundElevation: (north, east) => elevation + (n.x * north + n.y * east) / n.z,
    groundNormal: () => n,
    surface: () => surface,
  };
}

export interface ExternalLoad {
  /** Body-axis force, N. */
  force: Vec3;
  /** Application point, body axes from the CG, m. */
  point: Vec3;
}

export class GearRig {
  readonly gear: LandingGear;
  readonly controls: ControlInputs = { ...defaultControls(), mixture: 0 };
  position: Vec3 = v3.zero();
  velocity: Vec3 = v3.zero();
  orientation: Quat = quat.identity();
  angularVelocity: Vec3 = v3.zero();
  time = 0;
  external: ExternalLoad | null = null;
  /** Additional NED force at the CG (e.g. a steady crosswind side load), N. */
  externalNed: Vec3 = v3.zero();
  /** Optional extra body-axis loads evaluated every step (e.g. a crude aerodynamic model for landings). */
  loads: ((rig: GearRig) => { force: Vec3; moment: Vec3 }) | null = null;
  /** Extension of the three legs (retractable gear), handed to the gear at every step. Absent: all down and locked. */
  extension: ArrayLike<number> | undefined = undefined;
  output!: GearOutput;

  constructor(
    readonly env: Environment = planeEnvironment(),
    readonly mass = MASS,
    readonly config: GearConfig = C172_GEAR,
    /** Principal moments of inertia, kg m^2. */
    readonly inertia: Readonly<Vec3> = { x: C172.mass.Ixx, y: C172.mass.Iyy, z: C172.mass.Izz },
  ) {
    this.gear = new LandingGear(config);
  }

  /** Place the aircraft at rest in its static attitude, `extraHeight` above the resting height. */
  placeOnGround(heading = 0, extraHeight = 0, north = 0, east = 0): void {
    const pose = this.gear.restingPose(this.mass, v3.zero());
    const ground = this.env.groundElevation(north, east);
    this.position = { x: north, y: east, z: -(ground + pose.height + extraHeight) };
    this.orientation = quat.fromEuler(0, pose.pitch, heading);
    this.velocity = v3.zero();
    this.angularVelocity = v3.zero();
    this.gear.reset();
  }

  heightAGL(): number {
    return -this.position.z - this.env.groundElevation(this.position.x, this.position.y);
  }

  euler() {
    return quat.toEuler(this.orientation);
  }

  step(dt = DT): GearOutput {
    const q = this.orientation;
    const out = this.gear.compute({
      body: {
        time: this.time,
        position: this.position,
        orientation: q,
        velocityBody: quat.rotateInv(q, this.velocity),
        angularVelocity: this.angularVelocity,
        cgOffset: v3.zero(),
        mass: this.mass,
      },
      controls: this.controls,
      env: this.env,
      dt,
      extension: this.extension,
    });
    let F = out.force;
    let M = out.moment;
    if (this.external) {
      F = v3.add(F, this.external.force);
      M = v3.add(M, v3.cross(this.external.point, this.external.force));
    }
    F = v3.add(F, quat.rotateInv(q, this.externalNed));
    if (this.loads) {
      const extra = this.loads(this);
      F = v3.add(F, extra.force);
      M = v3.add(M, extra.moment);
    }
    const a = v3.add(v3.scale(quat.rotate(q, F), 1 / this.mass), { x: 0, y: 0, z: G0 });
    const w = this.angularVelocity;
    const I = this.inertia;
    const Iw = { x: I.x * w.x, y: I.y * w.y, z: I.z * w.z };
    const gyro = v3.cross(w, Iw);
    const wdot = { x: (M.x - gyro.x) / I.x, y: (M.y - gyro.y) / I.y, z: (M.z - gyro.z) / I.z };
    this.velocity = v3.addScaled(this.velocity, a, dt);
    this.angularVelocity = v3.addScaled(w, wdot, dt);
    this.position = v3.addScaled(this.position, this.velocity, dt);
    const qd = quat.derivative(q, this.angularVelocity);
    this.orientation = quat.normalize({ w: q.w + qd.w * dt, x: q.x + qd.x * dt, y: q.y + qd.y * dt, z: q.z + qd.z * dt });
    this.time += dt;
    this.output = out;
    return out;
  }

  run(seconds: number, each?: (out: GearOutput) => void | boolean): void {
    const n = Math.round(seconds / DT);
    for (let i = 0; i < n; i++) {
      const out = this.step();
      if (each && each(out) === true) return;
    }
  }

  /**
   * Crude landing aerodynamics: wing lift supporting `liftFraction` of the weight at 25 m/s (scaling with
   * speed squared) and C172 pitch/yaw rate damping at approach speed (Mq, Nr ~ -3400 N m s/rad).
   */
  enableLandingAero(liftFraction = 0.9): void {
    this.loads = (rig) => {
      const vx = rig.velocityBody().x;
      const lift = liftFraction * rig.mass * G0 * Math.min(1, (vx / 25) ** 2);
      const w = rig.angularVelocity;
      return { force: { x: 0, y: 0, z: -lift }, moment: { x: -1500 * w.x, y: -3400 * w.y, z: -3400 * w.z } };
    };
  }

  /** Body-axis velocity. */
  velocityBody(): Vec3 {
    return quat.rotateInv(this.orientation, this.velocity);
  }
}
