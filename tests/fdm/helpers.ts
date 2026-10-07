// Scripted-flight rig for the flight-model tests: a flat world at the airport elevation, the real
// environment (ISA, wind field) and a C172FlightModel at maximum gross weight (or the flight model of another
// definition at one of its loadings).

import { C172 } from '../../src/core/c172';
import { FT, KT, type Vec3 } from '../../src/core/math';
import {
  copyControls,
  defaultControls,
  defaultWeather,
  type ControlInputs,
  type InitialConditions,
  type SurfaceType,
  type WeatherSettings,
} from '../../src/core/types';
import { AIRPORT } from '../../src/core/world';
import type { AircraftDefinition, MassDef } from '../../src/aircraft/types';
import {
  BladeElementFlightModel,
  C172FlightModel,
  MAX_GROSS_PAYLOAD,
  createEnvironment,
  type C172Options,
  type SimEnvironment,
} from '../../src/physics';
import type { LoadingRequest } from '../../src/physics/interfaces';

/** Frame length of the scripted flights (the model sub-steps internally at its own rate), s. */
export const FRAME = 1 / 60;
export const ELEVATION = AIRPORT.elevation;

/**
 * Loadings at maximum take-off weight. 'forward': the whole payload in the front seats, which puts the CG
 * at the forward limit (~26 % MAC, the POH stall-speed condition). 'typical': two front occupants and the
 * rest in the rear seats and baggage area, CG ~29 % MAC. 'aft': CG at the aft limit.
 */
export const LOADING = {
  forward: { payload: MAX_GROSS_PAYLOAD, payloadPosition: C172.mass.crewPos },
  typical: {
    payload: MAX_GROSS_PAYLOAD,
    payloadPosition: { x: (160 * C172.mass.crewPos.x + (MAX_GROSS_PAYLOAD - 160) * -0.8) / MAX_GROSS_PAYLOAD, y: 0, z: -0.05 },
  },
  /** Everything in the rear seats and baggage area: CG ~36 % MAC, the aft limit. */
  aft: { payload: MAX_GROSS_PAYLOAD, payloadPosition: { x: -0.8, y: 0, z: -0.05 } },
} satisfies Record<string, C172Options>;

/** Still, standard air (ISA, no wind, no turbulence) unless overridden. */
export function calmWeather(over: Partial<WeatherSettings> = {}): WeatherSettings {
  return { ...defaultWeather(), windSpeedKt: 0, gustKt: 0, turbulence: 0, isaDeviation: 0, qnhHpa: 1013.25, cloudCover: 0, ...over };
}

/** Flat terrain at `elevation`, one surface type everywhere. */
export function flatEnvironment(weather: WeatherSettings = calmWeather(), elevation: number = ELEVATION, surface: SurfaceType = 'runway'): SimEnvironment {
  return createEnvironment({
    weather,
    terrain: { height: () => elevation, normal: () => ({ x: 0, y: 0, z: -1 }), surface: () => surface },
  });
}

export interface Rig<F extends BladeElementFlightModel = C172FlightModel> {
  fm: F;
  env: SimEnvironment;
  controls: ControlInputs;
  /** Advance by `seconds` in FRAME steps, calling `each` before every frame (return true to stop early). */
  run(seconds: number, each?: (t: number) => boolean | void): void;
}

/**
 * A rig with the C172S at LOADING.typical, or with `def`'s flight model at its named `loading` (default
 * 'maxGross', for the C172S the same numbers as LOADING.typical) or at a payload given outright. `options` go to
 * the flight model last.
 */
export function makeRig(o?: { options?: C172Options; env?: SimEnvironment }): Rig;
export function makeRig(o: {
  def: AircraftDefinition;
  loading?: keyof MassDef['loadings'] | LoadingRequest;
  options?: C172Options;
  env?: SimEnvironment;
}): Rig<BladeElementFlightModel>;
export function makeRig(
  o: { def?: AircraftDefinition; loading?: keyof MassDef['loadings'] | LoadingRequest; options?: C172Options; env?: SimEnvironment } = {},
): Rig<BladeElementFlightModel> {
  let fm: BladeElementFlightModel;
  if (o.def) {
    const l = typeof o.loading === 'object' ? o.loading : o.def.mass.loadings[o.loading ?? 'maxGross'];
    fm = new BladeElementFlightModel(o.def, { payload: l.payload, payloadPosition: l.payloadPosition, ...o.options });
  } else fm = new C172FlightModel({ ...LOADING.typical, ...o.options });
  const env = o.env ?? flatEnvironment();
  // One per-engine entry per engine of the type (the C172S's defaults are the generic ones).
  const controls = o.def ? defaultControls(o.def) : defaultControls();
  return {
    fm,
    env,
    controls,
    run(seconds, each) {
      const n = Math.round(seconds / FRAME);
      for (let i = 0; i < n; i++) {
        if (each && each(fm.state.time) === true) return;
        fm.step(FRAME, controls, env);
      }
    },
  };
}

/** Reset and copy the trimmed controls into the rig's controls. Defaults: 1000 ft AGL, 100 KTAS, heading north. */
export function resetTo(rig: Rig<BladeElementFlightModel>, ic: Partial<InitialConditions> = {}): void {
  const full: InitialConditions = {
    position: at(ELEVATION + 1000 * FT),
    heading: 0,
    airspeed: 100 * KT,
    onGround: false,
    engineRunning: true,
    ...ic,
  };
  rig.fm.reset(full, rig.env);
  copyControls(rig.controls, rig.fm.trimControls);
}

/** NED position at an altitude MSL. */
export const at = (altitudeMsl: number, north = 0, east = 0): Vec3 => ({ x: north, y: east, z: -altitudeMsl });

export const kt = (mps: number) => mps / KT;
export const fpm = (mps: number) => (mps / FT) * 60;

/** Print one validation line: target, measured value and error. */
export function report(name: string, measured: number, target: number | string, unit = ''): void {
  const err = typeof target === 'number' ? ` (${(((measured - target) / target) * 100).toFixed(1)} %)` : '';
  console.log(`[fdm] ${name}: measured ${measured.toFixed(2)} ${unit} | target ${typeof target === 'number' ? target.toFixed(2) : target} ${unit}${err}`);
}

/**
 * Period and damping ratio of an oscillation about `reference` (default: the mean of the second half of
 * the record) from its successive extrema: period from the mean half-period, damping from the mean
 * logarithmic decrement between successive peaks of opposite sign (delta per half cycle).
 */
export function oscillation(xs: readonly number[], dt: number, reference?: number): { period: number; zeta: number; peaks: number } {
  const half = xs.slice(xs.length >> 1);
  const ref = reference ?? half.reduce((s, x) => s + x, 0) / half.length;
  const ext: { t: number; v: number }[] = [];
  for (let i = 1; i < xs.length - 1; i++) {
    const a = xs[i - 1] - ref, b = xs[i] - ref, c = xs[i + 1] - ref;
    const peak = (b > 0 && b > a && b >= c) || (b < 0 && b < a && b <= c);
    // Keep only alternating extrema (ignore ripples on the way).
    if (peak && (ext.length === 0 || Math.sign(ext[ext.length - 1].v) !== Math.sign(b))) ext.push({ t: i * dt, v: b });
  }
  if (ext.length < 3) return { period: NaN, zeta: NaN, peaks: ext.length };
  const period = (2 * (ext[ext.length - 1].t - ext[0].t)) / (ext.length - 1);
  let dec = 0;
  for (let i = 1; i < ext.length; i++) dec += Math.log(Math.abs(ext[i - 1].v / ext[i].v));
  const d = (2 * dec) / (ext.length - 1); // per full cycle
  return { period, zeta: d / Math.sqrt(4 * Math.PI * Math.PI + d * d), peaks: ext.length };
}

/**
 * Natural frequency and damping ratio of a free second-order response, from a least-squares fit of
 * x[k+1] = a1 x[k] + a2 x[k-1] + c and the poles of z^2 - a1 z - a2 mapped to s = ln(z) / dt.
 */
export function secondOrderFit(xs: readonly number[], dt: number): { wn: number; zeta: number; dampedPeriod: number } {
  // Normal equations for [a1, a2, c].
  const A = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  const b = [0, 0, 0];
  for (let k = 1; k + 1 < xs.length; k++) {
    const r = [xs[k], xs[k - 1], 1];
    for (let i = 0; i < 3; i++) {
      b[i] += r[i] * xs[k + 1];
      for (let j = 0; j < 3; j++) A[3 * i + j] += r[i] * r[j];
    }
  }
  const det3 = (m: number[]) =>
    m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
  const d = det3(A);
  const col = (i: number) => A.map((v, k) => (k % 3 === i ? b[Math.floor(k / 3)] : v));
  const a1 = det3(col(0)) / d, a2 = det3(col(1)) / d;
  const disc = a1 * a1 + 4 * a2;
  if (disc >= 0) {
    // Real poles: overdamped; report the slower pole as the frequency and zeta >= 1.
    const z1 = (a1 + Math.sqrt(disc)) / 2, z2 = (a1 - Math.sqrt(disc)) / 2;
    const s1 = Math.log(Math.abs(z1)) / dt, s2 = Math.log(Math.abs(z2)) / dt;
    const wn = Math.sqrt(s1 * s2);
    return { wn, zeta: -(s1 + s2) / (2 * wn), dampedPeriod: Infinity };
  }
  const mag = Math.sqrt(-a2);
  const ang = Math.atan2(Math.sqrt(-disc), a1);
  const re = Math.log(mag) / dt, im = ang / dt;
  const wn = Math.hypot(re, im);
  return { wn, zeta: -re / wn, dampedPeriod: (2 * Math.PI) / im };
}

/** Mixture lever setting (0..1) that gives the most shaft power at the current condition (best-power leaning). */
export function leanForBestPower(rig: Rig<BladeElementFlightModel>, seconds = 4): number {
  let best = 1, bestRpm = -1;
  for (let m = 1; m >= 0.3; m -= 0.05) {
    rig.controls.mixture = m;
    rig.run(seconds);
    if (rig.fm.state.engine.rpm > bestRpm) {
      bestRpm = rig.fm.state.engine.rpm;
      best = m;
    }
  }
  rig.controls.mixture = best;
  return best;
}

export { C172 };
