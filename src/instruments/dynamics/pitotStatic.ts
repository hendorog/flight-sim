// Pitot-static instruments: airspeed indicator, altimeter and vertical speed indicator.

import { INHG, KT, smoothstep } from '../../core/math';
import { lagStep } from './filters';

/** Standard sea-level pressure, hPa. */
export const STD_PRESSURE_HPA = 1013.25;

/**
 * Pressure altitude above the Kollsman reference pressure, ft: the barometric formula of the
 * International Standard Atmosphere troposphere, which is how an altimeter's aneroid is calibrated
 * (h = T0/L * (1 - (p/p0)^(R L / g)) = 145 366 ft * (1 - (p/p0)^0.190263)).
 */
export function pressureAltitudeFt(staticPressurePa: number, referenceHpa: number = STD_PRESSURE_HPA): number {
  return 145366.45 * (1 - Math.pow(staticPressurePa / (referenceHpa * 100), 0.190263));
}

/**
 * Airspeed indicator. The diaphragm deflects with dynamic pressure, which is proportional to V^2, so at
 * low speed the pressure is too small to overcome linkage friction: the needle sits on its stop until
 * about 20 kt and only reads true above ~35 kt (the dial starts at 40 KIAS).
 */
export class AirspeedIndicator {
  /** Indicated airspeed shown by the needle, kt. */
  knots = 0;

  step(dt: number, iasMs: number): void {
    const kt = Math.max(0, iasMs / KT);
    const shown = kt * smoothstep(18, 35, kt);
    // Needle and linkage damping.
    this.knots = lagStep(this.knots, shown, dt, 0.12);
  }
}

/** Three-pointer sensitive altimeter with a Kollsman window. */
export class Altimeter {
  /** Indicated altitude, ft. */
  feet = 0;
  /** Kollsman window setting, hPa. */
  settingHpa = STD_PRESSURE_HPA;
  private primed = false;

  get settingInHg(): number {
    return (this.settingHpa * 100) / INHG;
  }

  step(dt: number, staticPressurePa: number): void {
    const target = pressureAltitudeFt(staticPressurePa, this.settingHpa);
    // Aneroid capsule and gear train lag.
    this.feet = this.primed ? lagStep(this.feet, target, dt, 0.15) : target;
    this.primed = true;
  }
}

/**
 * Vertical speed indicator. A diaphragm fed with static pressure sits in a case that is also fed with
 * static pressure, but through a calibrated leak (capillary), so the case pressure lags the outside by a
 * time constant tau. The diaphragm deflection is proportional to the pressure difference, which in a
 * steady climb is (climb rate * tau) expressed as pressure: the reading is correct in steady state and
 * responds to a change of climb rate as a first-order lag of about 6 s (typical for a non-instantaneous
 * VSI; the needle takes 6-9 s to settle). Working in pressure-altitude space keeps the model independent
 * of density.
 */
export class VerticalSpeedIndicator {
  /** Reading, ft/min, before the needle stops. */
  fpm = 0;
  /** Case pressure expressed as a pressure altitude, ft. */
  private caseAltitudeFt = NaN;

  constructor(private readonly tau = 6) {}

  step(dt: number, staticPressurePa: number): void {
    const h = pressureAltitudeFt(staticPressurePa);
    if (Number.isNaN(this.caseAltitudeFt)) this.caseAltitudeFt = h;
    this.caseAltitudeFt = lagStep(this.caseAltitudeFt, h, dt, this.tau);
    this.fpm = ((h - this.caseAltitudeFt) / this.tau) * 60;
  }

  /** Equalise the case pressure (e.g. after a scenario reset). */
  reset(): void {
    this.caseAltitudeFt = NaN;
    this.fpm = 0;
  }
}
