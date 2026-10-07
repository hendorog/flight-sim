// Plausible AircraftState / Environment stand-ins so rendering, instrument, audio and camera modules
// can be developed and tested without the flight model.

import { DEG, FT, KT, quat, v3, type Vec3 } from './math';
import {
  emptyEngineState,
  emptyPropellerState,
  emptySurfaceState,
  fixedGearState,
  type AircraftState,
  type AtmosphereSample,
  type EngineState,
  type Environment,
  type PropellerState,
  type WheelState,
} from './types';
import { AIRPORT } from './world';
import type { AircraftDefinition } from '../aircraft/types';

export interface MockStateOptions {
  north?: number;
  east?: number;
  /** Height above the airport elevation, m. 0 = sitting on the runway. */
  heightAGL?: number;
  heading?: number;
  roll?: number;
  pitch?: number;
  /** True airspeed, m/s. */
  tas?: number;
  rpm?: number;
  flaps?: number;
  /** The type the state is for (its id and engine count). Default: the Cessna 172S. */
  def?: AircraftDefinition;
  /** Overrides the number of engines and propellers in the state (a twin's visual over a placeholder definition). */
  engines?: number;
}

/** Height of the CG above the ground when the aircraft rests on its wheels, m (Cessna 172). */
export const CG_HEIGHT_ON_GROUND = 1.25;

export function makeMockState(o: MockStateOptions = {}): AircraftState {
  const onGround = (o.heightAGL ?? 1000 * FT) <= 0;
  const agl = onGround ? CG_HEIGHT_ON_GROUND : (o.heightAGL ?? 1000 * FT);
  const heading = o.heading ?? AIRPORT.runway.heading;
  const pitch = o.pitch ?? (onGround ? 0 : 2 * DEG);
  const roll = o.roll ?? 0;
  const tas = o.tas ?? (onGround ? 0 : 105 * KT);
  const rpm = o.rpm ?? (onGround ? 800 : 2350);
  const altitudeMSL = AIRPORT.elevation + agl;
  const orientation = quat.fromEuler(roll, pitch, heading);
  const velocity: Vec3 = { x: Math.cos(heading) * tas, y: Math.sin(heading) * tas, z: 0 };
  const wheel = (name: WheelState['name']): WheelState => ({
    name,
    // Static deflections that put the tyres exactly on the ground at CG_HEIGHT_ON_GROUND.
    compression: onGround ? (name === 'nose' ? 0.06 : 0.08) : 0,
    onGround,
    load: onGround ? 3500 : 0,
    spinRate: 0,
    rotation: 0,
    steerAngle: 0,
    skid: 0,
  });
  const makeEngine = (): EngineState => ({
    ...emptyEngineState(),
    running: true,
    rpm,
    manifoldPressure: onGround ? 12 : 23,
    power: onGround ? 8000 : 95000,
    torque: onGround ? 95 : 386,
    fuelFlow: onGround ? 0.0012 : 0.0072,
    egt: 720,
    cht: 190,
    oilTemp: 85,
    oilPressure: 60,
    fuelPressure: 22,
    propRpm: rpm,
    loadPercent: onGround ? 6 : 71,
  });
  const makePropeller = (): PropellerState => ({
    ...emptyPropellerState(),
    rpm,
    thrust: onGround ? 300 : 900,
    advanceRatio: onGround ? 0 : 0.7,
    bladePitch: 18.5 * DEG,
  });
  // engines[0] / propellers[0] ARE engine / propeller: tests and dev pages set a mock through the legacy fields.
  const count = Math.max(1, o.engines ?? o.def?.engineCount ?? 1);
  const engines = Array.from({ length: count }, makeEngine);
  const propellers = Array.from({ length: count }, makePropeller);
  // The tank quantities and the alternator list read (and write) through the legacy fields, for the same reason.
  const fuel: AircraftState['fuel'] = { left: 68, right: 68, capacityEach: 72, tanks: [] };
  for (const side of ['left', 'right'] as const) {
    fuel.tanks.push(
      Object.defineProperties({ id: side } as AircraftState['fuel']['tanks'][number], {
        quantity: { enumerable: true, get: () => fuel[side], set: (kg: number) => void (fuel[side] = kg) },
        capacity: { enumerable: true, get: () => fuel.capacityEach, set: (kg: number) => void (fuel.capacityEach = kg) },
      }),
    );
  }
  const electrical: AircraftState['electrical'] = { busVoltage: 28, batteryCharge: 1, alternatorAmps: 12, batteryAmps: 2, alternators: [] };
  Object.defineProperty(electrical.alternators, 0, {
    enumerable: true,
    get: () => electrical.alternatorAmps,
    set: (amps: number) => void (electrical.alternatorAmps = amps),
  });
  return {
    aircraft: o.def?.id ?? 'c172s',
    time: 0,
    position: { x: o.north ?? 0, y: o.east ?? 0, z: -altitudeMSL },
    velocity,
    orientation,
    angularVelocity: v3.zero(),
    roll,
    pitch,
    heading,
    track: heading,
    altitudeMSL,
    altitudeAGL: agl,
    verticalSpeed: 0,
    groundSpeed: tas,
    tas,
    ias: tas * 0.97,
    mach: tas / 340,
    alpha: pitch,
    beta: 0,
    airVelocityBody: { x: tas * Math.cos(pitch), y: 0, z: tas * Math.sin(pitch) },
    specificForce: { x: Math.sin(pitch), y: -Math.sin(roll) * Math.cos(pitch), z: -Math.cos(roll) * Math.cos(pitch) },
    gLoad: 1,
    slipBall: 0,
    staticPressure: 101325 * Math.pow(1 - 2.25577e-5 * altitudeMSL, 5.25588),
    oat: 288.15 - 0.0065 * altitudeMSL,
    airDensity: 1.225 * Math.pow(1 - 2.25577e-5 * altitudeMSL, 4.25588),
    onGround,
    stallWarning: false,
    stallFraction: 0,
    crashed: false,
    crashReason: '',
    surfaces: { ...emptySurfaceState(), flaps: o.flaps ?? 0 },
    engine: engines[0],
    propeller: propellers[0],
    engines,
    propellers,
    wheels: [wheel('nose'), wheel('left'), wheel('right')],
    fuel,
    // A retractable gear, down and locked.
    gear: o.def?.geometry.gear.retractable ? { ...fixedGearState(), retractable: true } : fixedGearState(),
    mass: 1050,
    electrical,
  };
}

function isaAtmosphere(h: number): AtmosphereSample {
  const T = Math.max(216.65, 288.15 - 0.0065 * h);
  const p = 101325 * Math.pow(T / 288.15, 5.25588);
  const density = p / (287.053 * T);
  return {
    temperature: T,
    pressure: p,
    density,
    speedOfSound: Math.sqrt(1.4 * 287.053 * T),
    viscosity: (1.458e-6 * Math.pow(T, 1.5)) / (T + 110.4),
  };
}

/** Flat world at airport elevation, ISA atmosphere, no wind. */
export function makeMockEnvironment(): Environment {
  return {
    atmosphere: isaAtmosphere,
    wind: () => v3.zero(),
    groundElevation: () => AIRPORT.elevation,
    groundNormal: () => ({ x: 0, y: 0, z: -1 }),
    surface: () => 'grass',
  };
}
