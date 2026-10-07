// Run-time propeller: turns the BEMT coefficient maps into body-axis loads at the hub for the current inflow
// and shaft speed, and derives the slipstream (actuator-disc momentum theory) for the aerodynamics module.
//
// Rotation sense. The maps are those of a propeller turning clockwise seen from the cockpit. A propeller that
// turns the other way is its mirror image in the aircraft's plane of symmetry: forces mirror as vectors,
// moments and rotations as axial vectors. Written out for the same inflow, the thrust and the in-plane force
// are unchanged, while the hub moment (P-factor), the swirl of the slipstream, the torque reaction and the
// angular momentum change sign. The first two are applied here; the last two belong to the shaft (engineUnit.ts).

import type { Vec3 } from '../../core/math';
import type { Slipstream } from '../interfaces';
import { C172_PROPELLER } from './c172Powerplant';
import { PropellerCharacteristics, SWIRL_BINS, propellerCharacteristicsFor, type MapSample, type PropellerMap } from './propellerMap';

export interface PropellerLoads {
  /** Force along body +x, N. */
  thrust: number;
  /** Aerodynamic torque resisting rotation, N*m (negative when the air drives the propeller). */
  torque: number;
  /** In-plane (normal) force on the propeller, body axes, N (x component is zero; thrust is separate). */
  inPlaneForce: Vec3;
  /** Aerodynamic moment about the hub from asymmetric disc loading (P-factor), body axes, N*m (x component is zero). */
  hubMoment: Vec3;
  /** Axial inflow speed at the disc, m/s (+ = from ahead). */
  axialSpeed: number;
  /** Advance ratio J = Va / (n D); 0 when the propeller is (nearly) stopped. */
  advanceRatio: number;
}

export class Propeller {
  readonly loads: PropellerLoads = {
    thrust: 0,
    torque: 0,
    inPlaneForce: { x: 0, y: 0, z: 0 },
    hubMoment: { x: 0, y: 0, z: 0 },
    axialSpeed: 0,
    advanceRatio: 0,
  };
  private readonly sample: MapSample = { ct: 0, cq: 0, cf: 0, cm: 0 };
  private rho = 1.225;
  /** Advance angle of the last evaluation, rad. */
  private beta = 0;
  /** Blade angle of the last evaluation, rad (variable pitch only). */
  private pitch = 0;
  private readonly swirlProfile = new Float64Array(SWIRL_BINS);
  /** The one map of a fixed-pitch propeller; a variable-pitch one samples its characteristics instead. */
  private readonly map: PropellerMap | undefined;
  private readonly characteristics: PropellerCharacteristics | undefined;
  /** Tip radius, m, and disc area, m^2. */
  readonly radius: number;
  readonly discArea: number;

  /**
   * From the characteristics of a propeller definition (fixed pitch: their one slice), or from a map.
   * `rotation`: +1 clockwise seen from the cockpit, -1 the other way.
   */
  constructor(
    source: PropellerCharacteristics | PropellerMap = propellerCharacteristicsFor(C172_PROPELLER),
    readonly rotation: 1 | -1 = 1,
  ) {
    if (source instanceof PropellerCharacteristics && source.variablePitch) this.characteristics = source;
    else this.map = source instanceof PropellerCharacteristics ? source.slice(0) : source;
    this.radius = source.radius;
    this.discArea = source.discArea;
  }

  /**
   * Loads for air velocity relative to the hub `air` (body axes; x is negative in forward flight),
   * shaft speed `omega` (rad/s, >= 0), density `rho` and speed of sound `soundSpeed`; `pitch` is the blade
   * angle at the reference station, rad (a variable-pitch propeller needs it, a fixed-pitch one ignores it).
   * The returned object is reused on every call.
   */
  evaluate(air: Vec3, omega: number, rho: number, soundSpeed: number, pitch = 0): PropellerLoads {
    const L = this.loads;
    this.rho = rho;
    const va = -air.x;
    const vip = Math.hypot(air.y, air.z);
    const tip07 = 0.7 * omega * this.radius;
    const u2 = va * va + vip * vip + tip07 * tip07;
    L.axialSpeed = va;
    const n = omega / (2 * Math.PI);
    L.advanceRatio = n > 0.5 ? va / (n * 2 * this.radius) : 0;
    if (u2 < 1e-8) {
      L.thrust = L.torque = 0;
      L.inPlaneForce.y = L.inPlaneForce.z = L.hubMoment.y = L.hubMoment.z = 0;
      return L;
    }
    const u = Math.sqrt(u2);
    this.beta = Math.atan2(va, tip07);
    const map = this.map;
    let s: MapSample;
    if (map !== undefined) s = map.sample(this.beta, vip / u, u / soundSpeed, this.sample);
    else {
      this.pitch = pitch;
      s = this.characteristics!.sample(this.beta, vip / u, u / soundSpeed, pitch, this.sample);
    }
    const qa = 0.5 * rho * u2 * this.discArea;
    L.thrust = s.ct * qa;
    L.torque = s.cq * qa * this.radius;
    // The map holds in-plane loads for air moving toward -z. Rotate them about x into the actual in-plane
    // direction d = (air.y, air.z) / vip: a rotation taking (0, -1) to d maps (0, f) to (-f dy, -f dz).
    if (vip > 1e-9) {
      const dy = air.y / vip;
      const dz = air.z / vip;
      const f = s.cf * qa;
      const m = s.cm * qa * this.radius;
      L.inPlaneForce.y = -f * dy;
      L.inPlaneForce.z = -f * dz;
      L.hubMoment.y = -m * dy;
      L.hubMoment.z = -m * dz;
      if (this.rotation < 0) {
        L.hubMoment.y = m * dy;
        L.hubMoment.z = m * dz;
      }
    } else {
      L.inPlaneForce.y = L.inPlaneForce.z = L.hubMoment.y = L.hubMoment.z = 0;
    }
    return L;
  }

  /**
   * Slipstream of the last evaluation from actuator-disc momentum theory, T = 2 rho A |V + u| u, with the far
   * wake contracted to R sqrt((V + u) / (V + 2u)) and a far-wake swirl carrying the shaft torque:
   * Q = mdot * swirl * Rw^2 / 2 (solid-body swirl over the contracted wake), signed by the rotation sense.
   */
  slipstream(hub: Vec3, out: Slipstream): Slipstream {
    const { thrust, torque, axialSpeed: v } = this.loads;
    const k = thrust / (2 * this.rho * this.discArea);
    let u: number;
    if (v >= 0) {
      const disc = v * v + 4 * k;
      u = disc >= 0 ? 0.5 * (-v + Math.sqrt(disc)) : -0.5 * v;
    } else {
      // Flow arriving from behind: no clean momentum solution (vortex-ring state); use the static value.
      u = Math.sign(k) * Math.sqrt(Math.abs(k));
    }
    const through = v + u;
    const far = v + 2 * u;
    out.origin.x = hub.x;
    out.origin.y = hub.y;
    out.origin.z = hub.z;
    out.inducedVelocity = u;
    // Momentum theory contracts the far wake to R sqrt((V + u) / (V + 2u)), which is R / sqrt 2 for a static
    // propeller; with air arriving from behind (V < 0) the ratio can tend to zero while there is no clean
    // tube at all, so the static contraction is the limit.
    out.radius = through > 0 && far > 0 ? this.radius * Math.sqrt(Math.max(through / far, 0.5)) : this.radius;
    // The disc passes at least the induced flow: with air arriving from behind (vortex-ring state) the net
    // through-flow can vanish while the propeller still churns rho A u through itself.
    const massFlow = this.rho * this.discArea * Math.max(Math.abs(through), Math.abs(u));
    out.swirlRate = massFlow > 1e-3 ? (2 * torque) / (massFlow * out.radius * out.radius) : 0;
    if (this.rotation < 0) out.swirlRate = -out.swirlRate;
    // How that angular momentum is spread over the jet's radius: the blade's own torque distribution.
    const map = this.map;
    out.swirlProfile =
      map !== undefined ? map.swirlProfile(this.beta, this.swirlProfile) : this.characteristics!.swirlProfile(this.beta, this.pitch, this.swirlProfile);
    return out;
  }
}
