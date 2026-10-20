// Reduced-order wet compass: magnetic restoring torque, a pendulous float and viscous liquid drag.
// SI/radians throughout. Parameter estimates and the FAA references are in docs/magnetic-compass.md.
import { clamp, DEG, wrapPi, wrapTwoPi } from '../../core/math';
import type { AircraftId, AircraftState } from '../../core/types';
import { AIRPORT } from '../../core/world';

export interface CompassReading {
  heading: number;
  /** Card tilt relative to the bowl, aerospace roll/pitch, radians. */
  roll: number;
  pitch: number;
  atStop: boolean;
}
export type CompassInput = Pick<AircraftState, 'aircraft' | 'heading' | 'roll' | 'pitch' | 'specificForce' | 'angularVelocity'>;
/** Residual coefficients in degrees: A + B sin(H) + C cos(H) + D sin(2H). Synthetic compass swings,
 * not measured airframe data. Each placard is generated from these exact same coefficients. */
export const COMPASS_DEVIATION: Record<AircraftId, readonly [number, number, number, number]> = {
  c172s: [0.3, 1.2, -0.7, 0.4], c152: [-0.2, 1.5, 0.6, -0.3],
  pa38: [0.4, -1.3, 0.8, 0.4], da20: [-0.3, 0.8, -0.5, 0.2],
  pa34: [0.5, 1.8, -0.9, 0.5], da42: [0.2, -1.0, 0.6, -0.3],
  c208: [-0.3, 1.4, 0.9, -0.3], pc12: [0.5, -1.0, 0.8, 0.3],
  r22: [-0.4, 1.7, 0.8, 0.4], r44: [0.3, -1.5, 1.0, -0.4], s269: [-0.2, 1.9, -0.7, 0.5], md500: [1.0, 0.5, -1.2, 0.4],
  bo105: [0.8, -0.6, 1.1, 0.3], ah56: [1.4, 0.5, -1.0, 0.6],
};
/** Compass indication minus magnetic heading, radians. */
export function compassDeviation(heading: number, aircraft: AircraftId): number {
  const [a, b, c, d] = COMPASS_DEVIATION[aircraft];
  return DEG * (a + b * Math.sin(heading) + c * Math.cos(heading) + d * Math.sin(2 * heading));
}
export function compassCorrectionCard(aircraft: AircraftId): { for: number; steer: number }[] {
  return Array.from({ length: 12 }, (_, i) => {
    const h = i * 30;
    return { for: h || 360, steer: Math.round(wrapTwoPi(h * DEG + compassDeviation(h * DEG, aircraft)) / DEG) % 360 || 360 };
  });
}

export interface CompassOptions {
  latitudeDeg?: number;
  /** Positive east. No magnetic model exists in this world: default 0 preserves its heading datum. */
  variationDeg?: number;
  /** Positive down; absent uses the centred-dipole approximation tan(I) = 2 tan(latitude). */
  inclinationDeg?: number;
  deviation?: boolean;
}

export class MagneticCompass {
  static readonly TILT_LIMIT = 18 * DEG;
  static readonly NATURAL_FREQUENCY = 1.8; // rad/s; ~3.7 s damped period
  static readonly DAMPING_RATIO = 0.38; // envelope time constant 1/(zeta*wn) = 1.46 s
  static readonly TILT_FREQUENCY = 5; // rad/s
  readonly reading: CompassReading = { heading: 0, roll: 0, pitch: 0, atStop: false };
  readonly inclination: number;
  readonly variation: number;
  private error = 0;
  private speed = 0;
  private rollSpeed = 0;
  private pitchSpeed = 0;
  private initialized = false;

  constructor(private readonly options: CompassOptions = {}) {
    const lat = clamp(options.latitudeDeg ?? AIRPORT.latitudeDeg, -80, 80) * DEG;
    this.inclination = options.inclinationDeg === undefined ? Math.atan(2 * Math.tan(lat)) : clamp(options.inclinationDeg, -85, 85) * DEG;
    this.variation = (options.variationDeg ?? 0) * DEG;
  }

  reset(s: CompassInput): void {
    this.error = this.deviation(s.heading - this.variation, s.aircraft);
    this.speed = this.rollSpeed = this.pitchSpeed = 0;
    Object.assign(this.reading, { heading: wrapTwoPi(s.heading - this.variation + this.error), roll: 0, pitch: 0, atStop: false });
    this.initialized = true;
  }

  private deviation(h: number, aircraft: AircraftId): number {
    return this.options.deviation === false ? 0 : compassDeviation(h, aircraft);
  }

  /** Deterministic; no wall clock, random oscillator or weather-slider noise. Gust forces/rates excite
   * the float directly. Input specific force is accelerometer FRD in g, including gravity's reaction. */
  step(dt: number, s: CompassInput): CompassReading {
    if (!this.initialized) this.reset(s);
    if (!(dt > 0) || !Number.isFinite(dt)) return this.reading;
    const h = wrapTwoPi(s.heading - this.variation);
    const sf = s.specificForce, rates = s.angularVelocity, out = this.reading;
    const cp = Math.cos(s.pitch), sp = Math.sin(s.pitch), cr = Math.cos(s.roll), sr = Math.sin(s.roll);
    // Euler rates from real body angular velocity. Protect the Euler singularity during a tumble.
    const headingRate = (rates.y * sr + rates.z * cr) / Math.max(0.15, Math.abs(cp));
    const rollRate = rates.x + sp * headingRate;
    const pitchRate = rates.y * cr - rates.z * sr;
    const force = Math.hypot(sf.x, sf.y, sf.z);
    const targetRoll = force > 0.05 ? Math.atan2(sf.y, -sf.z) : out.roll;
    const targetPitch = force > 0.05 ? -Math.atan2(sf.x, Math.hypot(sf.y, sf.z)) : out.pitch;
    // Substeps keep the stop collision and pendulum stable across render frame rates.
    const steps = Math.ceil(dt / (1 / 120)), step = dt / steps;
    for (let i = 0; i < steps; i++) {
      const tiltK = MagneticCompass.TILT_FREQUENCY ** 2 * Math.min(force, 3);
      // Rates are inertial float rates; subtract case rotation to obtain motion in the bowl.
      this.rollSpeed += (tiltK * wrapPi(targetRoll - out.roll) - 5 * (this.rollSpeed - rollRate)) * step;
      this.pitchSpeed += (tiltK * (targetPitch - out.pitch) - 5 * (this.pitchSpeed - pitchRate)) * step;
      out.roll += (this.rollSpeed - rollRate) * step;
      out.pitch += (this.pitchSpeed - pitchRate) * step;
      const tilt = Math.hypot(out.roll, out.pitch);
      out.atStop = tilt >= MagneticCompass.TILT_LIMIT - 1e-9;
      if (tilt > MagneticCompass.TILT_LIMIT) {
        const scale = MagneticCompass.TILT_LIMIT / tilt;
        out.roll *= scale; out.pitch *= scale;
        // Inelastic contact: remove outward velocity at the circular stop, retain tangential swing.
        const outward = ((this.rollSpeed - rollRate) * out.roll + (this.pitchSpeed - pitchRate) * out.pitch) / MagneticCompass.TILT_LIMIT ** 2;
        if (outward > 0) { this.rollSpeed -= outward * out.roll; this.pitchSpeed -= outward * out.pitch; }
      }
      // Project the Earth field into the actual tilted float plane. This is what creates BOTH
      // turning and acceleration errors, without heading-specific offsets: in a coordinated turn
      // the apparent vertical banks with the case; on acceleration the pendulum swings aft.
      // B is a unit field in body FRD (inclination positive down, heading relative to magnetic N).
      const horizontal = Math.cos(this.inclination), down = Math.sin(this.inclination);
      const north = horizontal * Math.cos(h), east = -horizontal * Math.sin(h);
      const bx = cp * north - sp * down;
      const by = sr * sp * north + cr * east + sr * cp * down;
      const bz = cr * sp * north - sr * east + cr * cp * down;
      const ct = Math.cos(out.pitch), st = Math.sin(out.pitch), cb = Math.cos(out.roll), sb = Math.sin(out.roll);
      const fieldX = ct * bx + sb * st * by - cb * st * bz;
      const fieldY = cb * by + sb * bz;
      const targetError = wrapPi(-Math.atan2(fieldY, fieldX) - h) + this.deviation(h, s.aircraft);
      const wn = MagneticCompass.NATURAL_FREQUENCY;
      const torque = wn * wn * Math.sin(wrapPi(targetError - this.error));
      // At the tilt stop the pivot/cup rubs: stiction for small torque, heavy drag otherwise.
      if (out.atStop && Math.abs(torque) < 0.18) this.speed = -headingRate;
      else this.speed += (torque - (out.atStop ? 6 : 2 * MagneticCompass.DAMPING_RATIO * wn) * (this.speed + headingRate)) * step;
      this.error = wrapPi(this.error + this.speed * step);
    }
    out.heading = wrapTwoPi(h + this.error);
    return out;
  }
}
