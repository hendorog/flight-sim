// FROZEN rig of the golden tests (see README.md). Copied from tests/fdm/helpers.ts of the untouched tree; do
// not "improve" it: the loading, the frame length and the calm weather below are part of the recorded numbers.
//
// Scripted-flight rig for the flight-model tests: a flat world at the airport elevation, the real
// environment (ISA, wind field) and a C172FlightModel at maximum gross weight.

import { C172 } from '../../../src/core/c172';
import { FT, KT, type Vec3 } from '../../../src/core/math';
import {
  defaultControls,
  defaultWeather,
  type ControlInputs,
  type InitialConditions,
  type SurfaceType,
  type WeatherSettings,
} from '../../../src/core/types';
import { AIRPORT } from '../../../src/core/world';
import { C172FlightModel, MAX_GROSS_PAYLOAD, createEnvironment, type C172Options, type SimEnvironment } from '../../../src/physics';

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

export interface Rig {
  fm: C172FlightModel;
  env: SimEnvironment;
  controls: ControlInputs;
  /** Advance by `seconds` in FRAME steps, calling `each` before every frame (return true to stop early). */
  run(seconds: number, each?: (t: number) => boolean | void): void;
}

export function makeRig(o: { options?: C172Options; env?: SimEnvironment } = {}): Rig {
  const fm = new C172FlightModel({ ...LOADING.typical, ...o.options });
  const env = o.env ?? flatEnvironment();
  const controls = defaultControls();
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
export function resetTo(rig: Rig, ic: Partial<InitialConditions> = {}): void {
  const full: InitialConditions = {
    position: at(ELEVATION + 1000 * FT),
    heading: 0,
    airspeed: 100 * KT,
    onGround: false,
    engineRunning: true,
    ...ic,
  };
  rig.fm.reset(full, rig.env);
  Object.assign(rig.controls, rig.fm.trimControls);
  rig.controls.lights = { ...rig.fm.trimControls.lights };
}

/** NED position at an altitude MSL. */
export const at = (altitudeMsl: number, north = 0, east = 0): Vec3 => ({ x: north, y: east, z: -altitudeMsl });
