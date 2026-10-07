// Core provider ('core'): indicated signals (from InstrumentReadings; truth when readings are null in
// headless tests), truth signals, controls and the derived signals (untrimmedS, studentInput, night,
// sunElevDeg, timeScale). Defaults for hysteresis and rate constants are in section 2.3.
//
// Units are pilot units throughout: kt, ft, fpm, degrees (bank + right, pitch + up), US gal, psi, deg F.
// Indicated signals are what the student sees and what grading uses; the truth twins feed safety, geometry
// and the event detectors. The world has no magnetic variation (the DG is aligned to true heading), so
// "magnetic" in the spec reads as true heading here.

import { FPM, FT, KT, RAD } from '../../../core/math';
import { AIRPORT, sunDirectionNED } from '../../../core/world';
import { KG_PER_GAL } from '../../../instruments/dynamics/engineSystems';
import { vacuumSuction } from '../../../instruments/dynamics/gyro';
import { wrap180 } from '../../geo/angles';
import type { SignalDef, SignalFrame, SignalProvider, TelemetrySources } from '../../types';
import { defineSignals } from './define';

/** untrimmedS: |elevator| above this counts as holding pressure (section 2.3). */
export const UNTRIMMED_ELEVATOR = 0.08;
/** Night: sun elevation below civil twilight (section 3.11, logbook timer). */
export const NIGHT_SUN_ELEV_DEG = -6;
/** Below this ground speed the ground track (and so the drift angle) is undefined; driftDeg reads 0. */
const DRIFT_MIN_GS_KT = 5;

export const CORE_SIGNALS: readonly SignalDef[] = defineSignals([
  // indicated
  ['asiKt', 'number', 'kt', 1, 'Airspeed indicator', 1],
  ['altFt', 'number', 'ft', 20, 'Altimeter (Kollsman setting applied)', 1.5],
  ['vsiFpm', 'number', 'fpm', 50, 'Vertical speed indicator (lagged)'],
  ['hdgDeg', 'angle', 'deg', 2, 'Heading indicator (DG, drifts; aligned to true)'],
  ['aiPitchDeg', 'number', 'deg', 0, 'Attitude indicator pitch, + nose up'],
  ['aiBankDeg', 'number', 'deg', 2, 'Attitude indicator bank, + right', 0.5],
  ['turnRate', 'number', 'std rate', 0, 'Turn coordinator, standard-rate units, + right'],
  ['ball', 'number', '', 0.05, 'Slip/skid ball, -1..1, + ball right'],
  ['rpm', 'number', 'rpm', 0, 'Tachometer'],
  ['oilPsi', 'number', 'psi', 0, 'Oil pressure gauge'],
  ['oilTempF', 'number', 'degF', 0, 'Oil temperature gauge'],
  ['fuelLGal', 'number', 'gal', 0, 'Left fuel gauge, US gal'],
  ['fuelRGal', 'number', 'gal', 0, 'Right fuel gauge, US gal'],
  ['suctionInHg', 'number', 'inHg', 0, 'Suction gauge'],
  ['ammeterA', 'number', 'A', 0, 'Ammeter (battery current, + charging)'],
  // truth
  ['kias', 'number', 'kt', 1, 'Indicated airspeed (truth)', 1],
  ['tasKt', 'number', 'kt', 0, 'True airspeed'],
  ['gsKt', 'number', 'kt', 0, 'Ground speed'],
  ['altMslFt', 'number', 'ft', 0, 'Altitude MSL (truth)'],
  ['aglFt', 'number', 'ft', 10, 'Height of the reference point above the ground (about 4 ft on the wheels)'],
  ['hafFt', 'number', 'ft', 0, 'Height above the aerodrome elevation'],
  ['vsFpm', 'number', 'fpm', 50, 'Vertical speed (truth)'],
  ['pitchDeg', 'number', 'deg', 1, 'Pitch attitude (truth), + nose up'],
  ['bankDeg', 'number', 'deg', 2, 'Bank angle (truth), + right', 0.5],
  ['hdgTrueDeg', 'angle', 'deg', 0, 'True heading'],
  ['trackDeg', 'angle', 'deg', 0, 'Ground track, true'],
  ['driftDeg', 'number', 'deg', 0, 'Heading minus track (wind correction), 0 below 5 kt ground speed'],
  ['aoaDeg', 'number', 'deg', 0, 'Angle of attack'],
  ['gLoad', 'number', 'g', 0.05, 'Normal load factor'],
  ['stallWarn', 'bool', '', 0, 'Stall warning horn'],
  ['stallFrac', 'number', '', 0, 'Fraction of the wing stalled, 0..1'],
  ['onGround', 'bool', '', 0, 'Any wheel on the ground'],
  ['mainsOnGround', 'bool', '', 0, 'Either main wheel on the ground'],
  ['noseOnGround', 'bool', '', 0, 'Nose wheel on the ground'],
  ['crashed', 'bool', '', 0, 'The aircraft has crashed'],
  ['engineRunning', 'bool', '', 0, 'Engine running'],
  ['pitchRateDps', 'number', 'deg/s', 0, 'Body pitch rate, + nose up'],
  ['rollRateDps', 'number', 'deg/s', 0, 'Body roll rate, + right'],
  // controls
  ['throttle', 'number', '', 0, 'Throttle 0..1'],
  ['mixture', 'number', '', 0, 'Mixture 0..1 (1 full rich)'],
  ['flapLever', 'number', '', 0, 'Flap lever 0..1 (ControlInputs.flaps)'],
  ['flapsDeg', 'number', 'deg', 0, 'Flap deflection'],
  ['trim', 'number', '', 0, 'Elevator trim -1..1, + nose up'],
  ['elevator', 'number', '', 0, 'Elevator input -1..1, + back'],
  ['aileron', 'number', '', 0, 'Aileron input -1..1, + right'],
  ['rudder', 'number', '', 0, 'Rudder input -1..1, + right'],
  ['brakes', 'number', '', 0, 'Toe brakes 0..1 (the harder of the two)'],
  ['parkingBrake', 'bool', '', 0, 'Parking brake set'],
  ['mags', 'number', '', 0, 'Magnetos: 0 off, 1 R, 2 L, 3 both'],
  ['starter', 'bool', '', 0, 'Starter engaged'],
  ['master', 'bool', '', 0, 'Battery master'],
  ['alternator', 'bool', '', 0, 'Alternator switch'],
  ['avionics', 'bool', '', 0, 'Avionics master'],
  ['fuelSel', 'enum', '', 0, "Fuel selector: 'off' | 'left' | 'right' | 'both'"],
  ['fuelPump', 'bool', '', 0, 'Electric fuel pump'],
  ['pitotHeat', 'bool', '', 0, 'Pitot heat'],
  ['lightNav', 'bool', '', 0, 'Navigation lights'],
  ['lightBeacon', 'bool', '', 0, 'Beacon'],
  ['lightStrobe', 'bool', '', 0, 'Strobes'],
  ['lightLanding', 'bool', '', 0, 'Landing light'],
  ['lightTaxi', 'bool', '', 0, 'Taxi light'],
  ['qnhErrHpa', 'number', 'hPa', 0, 'Altimeter setting minus QNH'],
  ['dgErrDeg', 'number', 'deg', 0, 'Heading indicator minus heading (0 without readings)'],
  // derived
  ['untrimmedS', 'number', 's', 0, 'Seconds holding elevator pressure in steady flight'],
  ['studentInput', 'bool', '', 0, 'The student moved a flight control this frame'],
  ['night', 'bool', '', 0, 'Sun below -6 deg'],
  ['sunElevDeg', 'number', 'deg', 0, 'Sun elevation'],
  ['timeScale', 'number', 'x', 0, 'Simulation time scale'],
]);

export function createCoreProvider(): SignalProvider {
  // untrimmedS state: seconds counted, and how long the counting condition has been broken.
  let untrimmed = 0;
  let brokenS = 0;
  return {
    id: 'core',
    defs: CORE_SIGNALS,
    sample(out: SignalFrame, src: TelemetrySources, dt: number): void {
      const s = src.state;
      const c = src.controls;
      const r = src.readings;
      const w = src.weather;

      // truth
      const kias = s.ias / KT;
      const vsFpm = s.verticalSpeed / FPM;
      const bank = s.roll * RAD;
      const pitch = s.pitch * RAD;
      const hdgTrue = s.heading * RAD;
      const gs = s.groundSpeed / KT;
      out.kias = kias;
      out.tasKt = s.tas / KT;
      out.gsKt = gs;
      out.altMslFt = s.altitudeMSL / FT;
      out.aglFt = s.altitudeAGL / FT;
      out.hafFt = (s.altitudeMSL - AIRPORT.elevation) / FT;
      out.vsFpm = vsFpm;
      out.pitchDeg = pitch;
      out.bankDeg = bank;
      out.hdgTrueDeg = hdgTrue;
      out.trackDeg = s.track * RAD;
      out.driftDeg = gs < DRIFT_MIN_GS_KT ? 0 : wrap180(hdgTrue - s.track * RAD);
      out.aoaDeg = s.alpha * RAD;
      out.gLoad = s.gLoad;
      out.stallWarn = s.stallWarning;
      out.stallFrac = s.stallFraction;
      out.onGround = s.onGround;
      out.mainsOnGround = s.wheels[1].onGround || s.wheels[2].onGround;
      out.noseOnGround = s.wheels[0].onGround;
      out.crashed = s.crashed;
      out.engineRunning = s.engine.running;
      out.pitchRateDps = s.angularVelocity.y * RAD;
      out.rollRateDps = s.angularVelocity.x * RAD;

      // indicated (truth stand-ins without an instrument panel)
      if (r) {
        out.asiKt = r.airspeedKt;
        out.altFt = r.altitudeFt;
        out.vsiFpm = r.verticalSpeedFpm;
        out.hdgDeg = r.headingDeg;
        out.aiPitchDeg = r.attitudePitch * RAD;
        out.aiBankDeg = r.attitudeRoll * RAD;
        out.turnRate = r.turnRate;
        out.ball = r.ball;
        out.rpm = r.rpm;
        out.oilPsi = r.oilPressurePsi;
        out.oilTempF = r.oilTempF;
        out.fuelLGal = r.fuelLeftGal;
        out.fuelRGal = r.fuelRightGal;
        out.suctionInHg = r.suctionInHg;
        out.ammeterA = r.ammeterAmps;
        out.dgErrDeg = wrap180(r.headingDeg - hdgTrue);
      } else {
        out.asiKt = kias;
        out.altFt = s.altitudeMSL / FT;
        out.vsiFpm = vsFpm;
        out.hdgDeg = hdgTrue;
        out.aiPitchDeg = pitch;
        out.aiBankDeg = bank;
        out.turnRate = standardRateUnits(s.angularVelocity, s.roll, s.pitch);
        out.ball = s.slipBall;
        out.rpm = s.engine.rpm;
        out.oilPsi = s.engine.oilPressure;
        out.oilTempF = (s.engine.oilTemp * 9) / 5 + 32;
        out.fuelLGal = s.fuel.left / KG_PER_GAL;
        out.fuelRGal = s.fuel.right / KG_PER_GAL;
        out.suctionInHg = vacuumSuction(s.engine.rpm);
        out.ammeterA = s.electrical.batteryAmps;
        out.dgErrDeg = 0;
      }

      // controls
      out.throttle = c.throttle;
      out.mixture = c.mixture;
      out.flapLever = c.flaps;
      out.flapsDeg = s.surfaces.flaps * RAD;
      out.trim = c.elevatorTrim;
      out.elevator = c.elevator;
      out.aileron = c.aileron;
      out.rudder = c.rudder;
      out.brakes = Math.max(c.brakeLeft, c.brakeRight);
      out.parkingBrake = c.parkingBrake;
      out.mags = c.magnetos;
      out.starter = c.starter;
      out.master = c.masterBattery;
      out.alternator = c.alternator;
      out.avionics = c.avionics;
      out.fuelSel = c.fuelSelector;
      out.fuelPump = c.fuelPump;
      out.pitotHeat = c.pitotHeat;
      out.lightNav = c.lights.nav;
      out.lightBeacon = c.lights.beacon;
      out.lightStrobe = c.lights.strobe;
      out.lightLanding = c.lights.landing;
      out.lightTaxi = c.lights.taxi;
      out.qnhErrHpa = Number.isFinite(c.kollsmanHpa) ? c.kollsmanHpa - w.qnhHpa : 0;

      // derived
      // untrimmedS (section 2.3): seconds with |elevator| > 0.08 in steady flight (|VS| < 300 fpm, |bank| <
      // 10 deg); the count survives a break shorter than 1 s and resets after a longer one. On the ground it
      // never counts (holding the yoke on the roll is technique, not a trim fault).
      if (dt > 0) {
        const holding = !s.onGround && Math.abs(c.elevator) > UNTRIMMED_ELEVATOR && Math.abs(vsFpm) < 300 && Math.abs(bank) < 10;
        if (holding) {
          untrimmed += dt;
          brokenS = 0;
        } else {
          brokenS += dt;
          if (brokenS >= 1 - 1e-9) untrimmed = 0; // (allowance for summed frame times)
        }
      }
      out.untrimmedS = untrimmed;
      out.studentInput = src.studentInput;
      const sun = sunDirectionNED(w.timeOfDay, w.dayOfYear);
      const sunElev = Math.asin(Math.max(-1, Math.min(1, -sun.z))) * RAD;
      out.sunElevDeg = sunElev;
      out.night = sunElev < NIGHT_SUN_ELEV_DEG;
      out.timeScale = src.timeScale;
    },
  };
}

/**
 * Turn rate in standard-rate units (3 deg/s = 1), + right: the Euler heading rate from the body rates,
 * psi_dot = (q sin(phi) + r cos(phi)) / cos(theta). What a turn coordinator settles to without its lag.
 */
function standardRateUnits(w: { x: number; y: number; z: number }, roll: number, pitch: number): number {
  const ct = Math.cos(pitch);
  if (Math.abs(ct) < 1e-3) return 0;
  const psiDot = (w.y * Math.sin(roll) + w.z * Math.cos(roll)) / ct;
  return (psiDot * RAD) / 3;
}
