// Free-turbine turboprop (by definition data; the pattern is the Pratt & Whitney Canada PT6A): a gas generator
// (gasGenerator.ts) whose gas drives a separate POWER TURBINE on its own shaft, geared down to the propeller. The
// two shafts are coupled by the gas alone, so the propeller governor holds the propeller speed while the power
// lever sets the gas generator's speed, and with it the power.
//
// The engine unit (engineUnit.ts) sees this as it sees a piston engine: its "crank" is the power turbine, and
// breathe() / burn() give the fuel the fuel control meters and the torque on that shaft. What is different:
//   - the starter, the generator and the engine-driven pumps are on the GAS GENERATOR, which carries its own
//     state (Ng, ITT, whether it is alight); the unit routes the starter's torque to it, not to the propeller;
//   - power lever -> the Ng the fuel control governs to, from the idle Ng (condition lever LOW / HIGH IDLE) to
//     maxNg; mixture lever = condition lever: below CUTOFF_BELOW the fuel is shut off;
//   - the igniters spark while the starter is engaged with the IGNITION (magneto) switch at NORM (0), and
//     continuously at ON (any other position); a dry motoring run (to blow out the fuel a failed start left in the
//     combustor) is the starter with the condition lever at CUT-OFF;
//   - power-turbine torque falls linearly with its speed for a given gas power, from stallTorqueRatio times the
//     design-speed torque with the power turbine held still: a free turbine gives the most torque stalled;
//   - the fuel topping governor takes Ng off when the power turbine overspeeds (a failed propeller governor).
// Beta and reverse (PitchControlDef.beta with TurbineDef.reversingCam; the blades are the governor's, governor.ts):
//   - aft of the gate (EngineInput.reverse > 0) the fuel topping governor's set point is reset down to
//     reversingCam.reverseNp, so that it, not the propeller governor (now in underspeed), holds the propeller;
//   - beyond the pitch-only travel the reversing cam raises the Ng set point linearly from the idle to maxReverseNg
//     at full reverse (the power lever itself is at 0: the input never makes both non-zero).
// Torque limiter (TurbineDef.torqueLimiter, PC-12): a cap on the Ng set point, in the same path as the topping cut.
// The cap is SOLVED each step, not integrated: the Ng at which the steady running line, at the present inlet
// conditions and power-turbine speed, gives the limit torque on the propeller shaft, the limit being
// psi x lapse(pressure altitude) less taperPsi spread linearly over ngTaper. Deterministic in a steady evaluation and
// in the time loop alike; in transients the gas power follows the fuel (up to 1.5x) so the torque overshoots the
// limit briefly, as a pneumatic limiter does.

import { clamp, interp1 } from '../../core/math';
import type { BetaDef, EngineDef, TurbineDef } from './defs';
import type { EngineCore, EngineInput } from './engine';
import { GasGenerator, type GasGeneratorInput } from './gasGenerator';

const RPM_PER_RAD_S = 60 / (2 * Math.PI);
/** Mixture (condition) lever below this: fuel cut-off; from it to 1: LOW IDLE to HIGH IDLE. */
export const CUTOFF_BELOW = 0.1;
/** cp / R of air, for the inlet's ram temperature rise from its ram pressure rise (isentropic). */
const GAMMA_RATIO = 0.4 / 1.4;
/** ISA pressure altitude, ft, of a static pressure, Pa (troposphere; the limiter's lapse table is in pressure altitude). */
const pressureAltitudeFt = (p: number): number => 145_442.16 * (1 - Math.pow(p / 101_325, 0.190_263));
/**
 * The fuel topping governor in its reverse reset: Np above reversingCam.reverseNp by this fraction takes the whole of
 * the cam's Ng span (maxReverseNg - low idle) off the set point, or more if topping.gain is stiffer. With the forward
 * topping gain (C208: 5 Ng per unit overspeed) the droop at full reverse reached 3 % of Np, up to the propeller
 * governor's own set speed, which then coarsened the blades out of reverse; the Nf governor that holds a PT6 in
 * reverse is a tight one. AGENT choice.
 */
const REVERSE_TOPPING_DROOP = 0.01;
/** Torque limiter: bisection steps on Ng (2^-30 of the span: far below a thousandth of a psi). */
const LIMITER_ITERATIONS = 30;

export class TurbineEngine implements EngineCore {
  readonly gasGenerator: GasGenerator;
  // Results of the last breathe()/burn() pair.
  fuelDemand = 0;
  readonly phi = 0;
  firing = false;
  /** Power-turbine torque, N m at the power-turbine shaft, >= 0; its friction; the same. */
  indicatedTorque = 0;
  lossTorque = 0;
  frictionTorque = 0;
  readonly carbIce = 0;
  /** Inlet total pressure, Pa, and temperature, K. */
  manifoldPressure = 101325;
  chargeTemperature = 288.15;
  /** Ng the fuel control is governing to, fraction. */
  ngDemand = 0;
  /** The torque limiter set the Ng demand in the last breathe() (types with TurbineDef.torqueLimiter). */
  torqueLimited = false;

  private readonly turbine: TurbineDef;
  private readonly ratedPower: number;
  /** Power-turbine design speed, rad/s. */
  private readonly omegaDesign: number;
  /** Power-turbine speed of the last breathe(), rad/s. */
  private omegaPt = 0;
  private readonly gg: GasGeneratorInput = {
    inletPressure: 101325, inletTemperature: 288.15, ngDemand: 0, cutoff: true, igniters: false,
    accessoryPower: 0, starterTorque: 0, dt: 0, steady: false,
  };

  /** `beta`: the propeller's beta range (PitchControlDef.beta), whose pitch-only travel the reversing cam starts after. */
  constructor(readonly def: EngineDef, readonly beta?: BetaDef) {
    if (def.kind !== 'freeTurbine' || !def.turbine) throw new Error(`${def.name}: TurbineEngine is a free turbine (kind 'freeTurbine' with turbine data)`);
    this.turbine = def.turbine;
    this.gasGenerator = new GasGenerator(def.turbine.gasGenerator, def.fuel.lhv);
    this.ratedPower = def.ratedPower;
    this.omegaDesign = (def.ratedRpm * 2 * Math.PI) / 60;
  }

  /** Power-turbine output relative to rated (the thermal model's load). */
  get load(): number {
    return (this.indicatedTorque * this.omegaPt) / this.ratedPower;
  }

  /** Ng, fraction; ITT, C; gas-generator rpm. */
  get ng(): number {
    return this.gasGenerator.ng;
  }

  get ittC(): number {
    return this.gasGenerator.ittC;
  }

  get ngRpm(): number {
    return this.gasGenerator.rpm;
  }

  breathe(input: EngineInput): void {
    const def = this.turbine;
    const fcu = def.gasGenerator.fcu;
    const gg = this.gg;
    const ram = input.ramPressure;
    gg.inletPressure = input.ambientPressure + ram;
    gg.inletTemperature = input.ambientTemperature * Math.pow(gg.inletPressure / input.ambientPressure, GAMMA_RATIO);
    this.manifoldPressure = gg.inletPressure;
    this.chargeTemperature = gg.inletTemperature;
    this.omegaPt = input.omega;

    // Levers: the condition lever's idle, the power lever's span above it, the topping governor's cut.
    const condition = input.mixture;
    gg.cutoff = condition < CUTOFF_BELOW;
    const idle = fcu.lowIdleNg + (fcu.highIdleNg - fcu.lowIdleNg) * clamp((condition - CUTOFF_BELOW) / (1 - CUTOFF_BELOW), 0, 1);
    let demand = idle + (fcu.maxNg - idle) * clamp(input.throttle, 0, 1);
    // Aft of the gate: the topping governor reset to the reverse Np, and beyond the pitch-only travel the cam.
    const reverse = input.reverse ?? 0;
    const cam = def.reversingCam;
    let toppingNp = def.powerTurbine.topping.np;
    let toppingGain = def.powerTurbine.topping.gain;
    if (cam && reverse > 0) {
      toppingNp = cam.reverseNp;
      toppingGain = Math.max(toppingGain, (cam.maxReverseNg - fcu.lowIdleNg) / REVERSE_TOPPING_DROOP);
      const pot = this.beta?.pitchOnlyTravel ?? 0;
      if (reverse > pot) demand = Math.max(demand, idle + (cam.maxReverseNg - idle) * clamp((reverse - pot) / (1 - pot), 0, 1));
    }
    // The torque limiter and the topping governor cut the set point; the fuel control's minimum-flow stop keeps
    // the cut from going below the running line's first point (they bleed the governor's air, they do not shut
    // the fuel off: an overspeed is not a flame-out).
    const floor = Math.min(demand, this.gasGenerator.firstMapNg * Math.sqrt(gg.inletTemperature / 288.15));
    if (def.torqueLimiter) demand = this.limitTorque(demand, input);
    const overspeed = input.omega / this.omegaDesign - toppingNp;
    if (overspeed > 0) demand = Math.max(floor, demand - toppingGain * overspeed);
    this.ngDemand = gg.ngDemand = Math.max(demand, 0);
    gg.igniters = input.igniters === true;
    gg.accessoryPower = input.accessoryPower;
    gg.dt = input.steady ? 0 : (input.dt ?? 0);
    gg.steady = input.steady === true;
    this.fuelDemand = this.gasGenerator.breathe(gg);

    // Power-turbine and gearbox friction.
    const [constant, perKrpm] = def.powerTurbine.friction;
    this.frictionTorque = input.omega > 0 ? constant + (perKrpm * input.omega * RPM_PER_RAD_S) / 1000 : 0;
    this.lossTorque = this.frictionTorque;
  }

  /**
   * The torque limiter's cap on an Ng set point `demand`: the Ng (no lower than the running line's first point) at
   * which the steady gas power at the present inlet and power-turbine speed gives the limit torque on the
   * propeller shaft, net of the power-turbine friction; `demand` itself when it is below that.
   */
  private limitTorque(demand: number, input: EngineInput): number {
    const lim = this.turbine.torqueLimiter!;
    const gg = this.gasGenerator;
    const sqrtTheta = Math.sqrt(this.gg.inletTemperature / 288.15);
    const scale = (this.gg.inletPressure / 101_325) * sqrtTheta;
    const lapse = lim.lapse;
    const atAltitude = interp1(lapse.altFt, lapse.psi, pressureAltitudeFt(input.ambientPressure)) * (lim.psi / lapse.psi[0]);
    const a = this.turbine.powerTurbine.stallTorqueRatio;
    const w = input.omega / this.omegaDesign;
    const [constant, perKrpm] = this.turbine.powerTurbine.friction;
    const friction = input.omega > 0 ? constant + (perKrpm * input.omega * RPM_PER_RAD_S) / 1000 : 0;
    const shaft = (this.def.gearRatio * lim.psiPerNm * Math.max(0, a - (a - 1) * w)) / this.omegaDesign;
    const frictionPsi = friction * this.def.gearRatio * lim.psiPerNm;
    const [t0, t1] = lim.ngTaper;
    // Torque above the limit at Ng = ng, psi (rises with Ng: the gas power rises and the limit tapers down).
    const excess = (ng: number): number =>
      gg.steadyGasPower(ng / sqrtTheta) * scale * shaft - frictionPsi - (atAltitude - lim.taperPsi * clamp((ng - t0) / (t1 - t0), 0, 1));
    this.torqueLimited = false;
    if (!(excess(demand) > 0)) return demand;
    let lo = gg.firstMapNg * sqrtTheta;
    if (excess(lo) >= 0) {
      this.torqueLimited = true;
      return Math.min(demand, lo);
    }
    let hi = demand;
    for (let i = 0; i < LIMITER_ITERATIONS; i++) {
      const mid = 0.5 * (lo + hi);
      if (excess(mid) > 0) hi = mid;
      else lo = mid;
    }
    this.torqueLimited = true;
    return lo;
  }

  burn(input: EngineInput, fuelDelivered: number): void {
    const gg = this.gg;
    gg.starterTorque = input.starterTorque ?? 0;
    this.gasGenerator.burn(gg, fuelDelivered);
    this.firing = this.gasGenerator.lit;
    // The power turbine: the gas power's torque at the design speed, more when slower, less when faster.
    const a = this.turbine.powerTurbine.stallTorqueRatio;
    const designTorque = this.gasGenerator.gasPower / this.omegaDesign;
    this.indicatedTorque = Math.max(0, designTorque * (a - (a - 1) * (input.omega / this.omegaDesign)));
  }

  /** Stopped, cold-soaked at `ambientTemp` (K). */
  reset(ambientPressure: number, ambientTemp: number): void {
    this.gasGenerator.reset(ambientTemp);
    this.fuelDemand = this.indicatedTorque = this.lossTorque = this.frictionTorque = 0;
    this.firing = false;
    this.manifoldPressure = ambientPressure;
    this.chargeTemperature = ambientTemp;
  }

  /** Alight at low idle (or `ng`) with a warm ITT: a running engine at a reset. */
  light(ng?: number): void {
    this.gasGenerator.reset(this.chargeTemperature, true, ng);
    this.firing = true;
  }
}
