// Induction system of a naturally aspirated spark engine (the IO-360-L2A by default): air filter and ram inlet,
// throttle butterfly, intake manifold, cylinders.
//
// The manifold pressure is the pressure at which the compressible orifice flow through the inlet and throttle
// equals the flow the cylinders swallow, m = eta_v * rho_manifold * Vd * n / 2 (four-stroke). Manifold filling
// dynamics are much faster than the physics step (volume ~ 3 L, time constant ~ 10 ms), so the balance is
// solved algebraically every step.
//
// A float carburettor adds one slow state, the ice in its venturi (updateIce): the fuel evaporating in the
// venturi and the expansion past the throttle plate cool the air by 15-30 K, so moist air well above freezing
// deposits ice there. The ice narrows the throttle body; carburettor heat melts it.

import { DEG, clamp, interp1, lerp } from '../../core/math';
import type { MoistureSample } from '../interfaces';
import { C172_ENGINE } from './c172Powerplant';
import type { CarburettorDef, EngineDef } from './defs';

const R_AIR = 287.05;
const GAMMA = 1.4;

// The IO-360-L2A (C172_ENGINE, where each number is explained) under the names this module has always exported.
export const COMPRESSION_RATIO = C172_ENGINE.compressionRatio;
export const DISPLACEMENT = C172_ENGINE.displacement;
export const THROTTLE_BORE_AREA = C172_ENGINE.induction.throttleBoreArea;
export const THROTTLE_CD = C172_ENGINE.induction.throttleCd;
export const CLOSED_ANGLE = C172_ENGINE.induction.closedAngle;
export const IDLE_AREA = C172_ENGINE.induction.idleArea as number;
export const INLET_AREA = C172_ENGINE.induction.inletArea;
export const EXHAUST_COEFF = C172_ENGINE.induction.exhaustCoeff;
export const INDUCTION_HEATING = C172_ENGINE.induction.inductionHeating;
export const VE_REFERENCE_T = C172_ENGINE.induction.veReferenceT;
export const VE_RPM = C172_ENGINE.induction.veRpm;
export const VE = C172_ENGINE.induction.ve;

const KELVIN = 273.15;
/** Idle bypass area an engine whose definition gives none starts from, as a fraction of the throttle bore (see PistonEngine.solveIdleArea). */
const PROVISIONAL_IDLE_AREA = 0.012;
/** Dew-point spread at which the air is too dry to ice a carburettor, K. */
const ICE_DRY_SPREAD = 15;
/** Outside air temperatures, C, between which icing is at its worst, and beyond which there is none. */
const ICE_WORST_FROM = -2;
const ICE_WORST_TO = 15;
const ICE_NONE_BELOW = -12;
const ICE_NONE_ABOVE = 32;
/** Icing rate at full throttle relative to closed throttle (the open plate offers the ice less to build on). */
const ICE_FULL_THROTTLE = 0.25;
/** Venturi temperature above which ice melts instead of building, C, and the excess at which it melts at the definition's rate, K. */
const ICE_MELT_ABOVE = 2;
const ICE_MELT_SPAN = 20;
/**
 * Part of the venturi temperature drop that is the expansion of the air alone, K: the rest is the fuel
 * evaporating, and goes with the fuel (none with the mixture at cut-off).
 */
const ICE_EXPANSION_DROP = 5;
/**
 * Air flow, as a fraction of the rated flow, from which the venturi cools and collects ice at the full rate of
 * the law (about an idling engine's): below it both fade in proportion, to none with no flow (a stopped engine).
 */
const ICE_FULL_FLOW = 0.05;
/** Melt water running through the engine roughens it for this long after the last ice has gone, s. */
export const ICE_WATER_SECONDS = 2;

/** Critical pressure ratio and the choked flow function. */
const CRITICAL_RATIO = Math.pow(2 / (GAMMA + 1), GAMMA / (GAMMA - 1));
const CHOKED_PSI = Math.sqrt(GAMMA) * Math.pow(2 / (GAMMA + 1), (GAMMA + 1) / (2 * (GAMMA - 1)));

/** Compressible orifice flow function: mdot = A p0 / sqrt(R T0) * psi(p / p0). */
function flowFunction(pr: number): number {
  if (pr <= CRITICAL_RATIO) return CHOKED_PSI;
  if (pr >= 1) return 0;
  const k = (2 * GAMMA) / (GAMMA - 1);
  return Math.sqrt(k * (Math.pow(pr, 2 / GAMMA) - Math.pow(pr, (GAMMA + 1) / GAMMA)));
}

export interface InductionState {
  /** Manifold absolute pressure, Pa. */
  manifoldPressure: number;
  /** Exhaust back pressure, Pa. */
  exhaustPressure: number;
  /** Charge temperature, K. */
  chargeTemperature: number;
  /** Volumetric efficiency including exhaust-residual backflow. */
  volumetricEfficiency: number;
  /** Air mass flow into the cylinders, kg/s. */
  airFlow: number;
  /** Residual exhaust-gas mass fraction in the charge. */
  residualFraction: number;
}

export class Induction {
  readonly state: InductionState;
  private readonly displacement: number;
  private readonly compressionRatio: number;
  private readonly throttleBoreArea: number;
  private readonly throttleCd: number;
  private readonly closedAngle: number;
  private idleArea: number;
  private readonly inletArea: number;
  private readonly exhaustCoeff: number;
  private readonly inductionHeating: number;
  private readonly veReferenceT: number;
  private readonly veRpm: readonly number[];
  private readonly ve: readonly number[];
  private readonly carburettor: CarburettorDef | undefined;

  /** Carburettor ice, 0 (none) .. 1 (as much as the venturi holds). */
  ice = 0;
  /** Seconds of rough running still to come from melt water (ICE_WATER_SECONDS while ice is melting). */
  meltWater = 0;

  constructor(engine: EngineDef = C172_ENGINE) {
    const def = engine.induction;
    this.carburettor = def.carburettor;
    this.displacement = engine.displacement;
    this.compressionRatio = engine.compressionRatio;
    this.throttleBoreArea = def.throttleBoreArea;
    this.throttleCd = def.throttleCd;
    this.closedAngle = def.closedAngle;
    // Absent: the unit solves it for the idle speed against its propeller (PistonEngine.solveIdleArea).
    this.idleArea = def.idleArea ?? PROVISIONAL_IDLE_AREA * def.throttleBoreArea;
    this.inletArea = def.inletArea;
    this.exhaustCoeff = def.exhaustCoeff;
    this.inductionHeating = def.inductionHeating;
    this.veReferenceT = def.veReferenceT;
    this.veRpm = def.veRpm;
    this.ve = def.ve;
    this.state = {
      manifoldPressure: 101325,
      exhaustPressure: 101325,
      chargeTemperature: 288,
      volumetricEfficiency: 0.85,
      airFlow: 0,
      residualFraction: 1 / this.compressionRatio,
    };
  }

  /**
   * Solve the manifold for throttle [0, 1], crank speed `rpm`, inlet total pressure `p0` (ambient plus ram
   * recovery, Pa), ambient pressure and temperature. Exhaust back pressure lags one step behind the airflow.
   */
  update(throttle: number, rpm: number, p0: number, ambientPressure: number, ambientTemp: number): InductionState {
    const s = this.state;
    const closed = this.closedAngle;
    const openAngle = closed + Math.min(Math.max(throttle, 0), 1) * (90 * DEG - closed);
    let butterfly = this.throttleCd * (this.throttleBoreArea * (1 - Math.cos(openAngle) / Math.cos(closed)) + this.idleArea);
    // Series restrictions combine like 1/A^2 (both see the same mass flow).
    let area: number;
    if (this.ice > 0) {
      // Ice narrows the gap round the throttle plate (which matters most at small openings) and the venturi throat,
      // which on a carburetted engine is the inlet's restriction, in series with the plate: so it costs air at
      // every throttle position, cruise and full throttle included.
      const open = 1 - this.carburettor!.iceBlockage * this.ice;
      butterfly *= open;
      const throat = this.inletArea * open;
      area = 1 / Math.sqrt(1 / (butterfly * butterfly) + 1 / (throat * throat));
    } else area = 1 / Math.sqrt(1 / (butterfly * butterfly) + 1 / (this.inletArea * this.inletArea));
    const inflowScale = (area * p0) / Math.sqrt(R_AIR * ambientTemp);
    const tCharge = ambientTemp + this.inductionHeating;
    const pe = ambientPressure + this.exhaustCoeff * s.airFlow * s.airFlow;
    const veRpm = interp1(this.veRpm, this.ve, rpm) * Math.sqrt(tCharge / this.veReferenceT);
    const swept = (this.displacement * rpm) / 120; // m^3/s, one intake stroke every two revolutions

    // Flow balance g(pr) = inflow - cylinder demand, decreasing in the pressure ratio pr = pm / p0: bracketed
    // root by Illinois false position (converges in a handful of iterations to the bisection's 1e-10).
    const b = this.solverState;
    b.p0 = p0;
    b.pe = pe;
    b.veRpm = veRpm;
    b.inflowScale = inflowScale;
    b.chargeDensityScale = swept / (R_AIR * tCharge);
    let lo = 0.01;
    let hi = 1;
    let glo = this.balance(lo);
    let ghi = this.balance(hi);
    if (glo <= 0) this.balance(lo);
    else if (ghi < 0) {
      let side = 0;
      for (let i = 0; i < 60 && hi - lo > 1e-10; i++) {
        const pr = (lo * ghi - hi * glo) / (ghi - glo);
        const g = this.balance(pr);
        if (g === 0 || Math.abs(g) <= 1e-12 * inflowScale) break;
        if (g > 0) {
          lo = pr;
          glo = g;
          if (side === 1) ghi *= 0.5;
          side = 1;
        } else {
          hi = pr;
          ghi = g;
          if (side === -1) glo *= 0.5;
          side = -1;
        }
      }
    }
    const pm = b.pm;
    const ve = b.ve;
    const cyl = b.cyl;
    s.manifoldPressure = pm;
    s.exhaustPressure = pe;
    s.chargeTemperature = tCharge;
    s.volumetricEfficiency = Math.max(ve, 0);
    s.airFlow = cyl;
    s.residualFraction = Math.min(Math.pow(pe / pm, 1 / GAMMA) / this.compressionRatio, 1);
    return s;
  }

  /** Inputs and last evaluation of the manifold flow balance (see update). */
  private readonly solverState = { p0: 0, pe: 0, veRpm: 0, inflowScale: 0, chargeDensityScale: 0, pm: 0, ve: 0, cyl: 0 };

  /** Inflow minus cylinder demand at pressure ratio pr, leaving pm, ve and the demand in solverState. */
  private balance(pr: number): number {
    const b = this.solverState;
    b.pm = pr * b.p0;
    // Ideal-cycle residual correction (Heywood section 6.2): exhaust gas left at pe re-expands into the cylinder.
    const cr = this.compressionRatio;
    b.ve = (b.veRpm * (cr - Math.pow(b.pe / b.pm, 1 / GAMMA))) / (cr - 1);
    b.cyl = Math.max(b.ve, 0) * b.pm * b.chargeDensityScale;
    return b.inflowScale * flowFunction(pr) - b.cyl;
  }

  /** Idle bypass area, m^2 (the definition's, or the one solved for the idle speed). */
  get idleBypassArea(): number {
    return this.idleArea;
  }

  set idleBypassArea(area: number) {
    this.idleArea = area;
  }

  /**
   * Carburettor ice over dt for throttle [0, 1], carburettor-inlet temperature (K, carburettor heat included),
   * outside air temperature (K) and the moisture of the air (absent: dry air, no ice forms); `airFlow`, the air
   * flow relative to the rated flow, and `fuel`, the fraction of the evaporative cooling there is (1 for a
   * mixture at or richer than stoichiometric, 0 at cut-off). Absent: 1 and 1 (a running engine).
   *
   * Growth per minute = iceRatePerMin x humidity x temperature x power: humidity falls linearly from 1 in
   * saturated air (or in cloud) to 0 at a dew-point spread of 15 K; the temperature factor is 1 between -2 and
   * +15 C outside and fades to 0 at -12 C (too little water in the air) and +32 C; power is 1 at closed
   * throttle and 0.25 wide open. The venturi runs colder than the inlet by the definition's drop (larger at
   * closed throttle); once it is above +2 C nothing freezes and the ice melts instead, at meltRatePerMin for
   * every 20 K of excess. These are the proportions of the usual carburettor-icing probability chart (serious
   * icing at any power between -2 and +15 C with a spread under about 5 K, at descent power over a much wider
   * range), not a measured accretion law. Both the drop and the growth need air flowing through the venturi
   * (they fade below ICE_FULL_FLOW), and all but ICE_EXPANSION_DROP of the drop needs fuel evaporating in it.
   */
  updateIce(dt: number, throttle: number, inletTemp: number, oat: number, moisture: MoistureSample | undefined, airFlow = 1, fuel = 1): void {
    const carb = this.carburettor;
    if (!carb || !(dt > 0)) return;
    const opening = clamp(throttle, 0, 1);
    const flowing = clamp(airFlow / ICE_FULL_FLOW, 0, 1);
    const drop = lerp(carb.venturiDropIdle, carb.venturiDropFull, opening);
    const expansion = Math.min(drop, ICE_EXPANSION_DROP);
    const venturiC = inletTemp - flowing * (expansion + (drop - expansion) * clamp(fuel, 0, 1)) - KELVIN;
    if (venturiC > ICE_MELT_ABOVE) {
      if (this.ice > 0) {
        this.ice = Math.max(0, this.ice - ((carb.meltRatePerMin * (venturiC - ICE_MELT_ABOVE)) / ICE_MELT_SPAN) * (dt / 60));
        this.meltWater = ICE_WATER_SECONDS;
        return;
      }
    } else if (moisture) {
      const humidity = moisture.inCloud ? 1 : clamp(1 - moisture.dewPointSpread / ICE_DRY_SPREAD, 0, 1);
      const oatC = oat - KELVIN;
      const temperature = clamp(Math.min((oatC - ICE_NONE_BELOW) / (ICE_WORST_FROM - ICE_NONE_BELOW), (ICE_NONE_ABOVE - oatC) / (ICE_NONE_ABOVE - ICE_WORST_TO)), 0, 1);
      const power = lerp(1, ICE_FULL_THROTTLE, opening);
      this.ice = Math.min(1, this.ice + carb.iceRatePerMin * humidity * temperature * power * flowing * (dt / 60));
    }
    this.meltWater = Math.max(0, this.meltWater - dt);
  }

  reset(ambientPressure: number, ambientTemp: number): void {
    const s = this.state;
    s.manifoldPressure = s.exhaustPressure = ambientPressure;
    s.chargeTemperature = ambientTemp + this.inductionHeating;
    s.airFlow = 0;
  }
}
