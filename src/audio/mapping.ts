// Pure mapping from simulation state to synthesis and spatialisation parameters. No Web Audio here, so
// every curve is unit-tested (tests/audio).

import { C172S_AUDIO } from '../aircraft/c172s/audio';
import { clamp, DEG, smoothstep } from '../core/math';
import { engineControl, type AircraftState, type ControlInputs, type Environment, type SurfaceType, type WeatherSettings } from '../core/types';
import { ENGINE_P, ENGINE_PARAMS, P, PARAM_COUNT } from './params';
import type { AudioProfile, EngineSoundProfile, PropSoundProfile } from './profile';

// Every function that needs a number of the aircraft type takes the profile (or its engine / propeller part) as
// a trailing parameter; left out, it is the Cessna 172S.
const C172S_ENGINE = C172S_AUDIO.engines[0].engine;
const C172S_PROP = C172S_AUDIO.engines[0].prop;

/** Cessna 172S: crankshaft speed while the starter is turning an engine that has not caught, rev/min. */
export const CRANK_RPM = C172S_ENGINE.crankRpm;
/** Speed of sound used for propagation delay, m/s (ISA sea level). */
export const SPEED_OF_SOUND = 340.3;
/** Distance at which the exterior mix is at reference level, m (about the chase-camera distance). */
export const REFERENCE_DISTANCE = 15;
/** Cessna 172S: thrust giving propLoad = 1 (the flight model's thrust in a 75% power cruise), N. */
export const CRUISE_THRUST = C172S_PROP.cruiseThrustN;
/** Cessna 172S: manifold pressure at idle and at full throttle at sea level in the flight model, inHg. */
export const MAP_IDLE = C172S_ENGINE.mapRange![0];
export const MAP_FULL = C172S_ENGINE.mapRange![1];
/** Cessna 172S: bus voltage above which the bus-powered sounds work (stall horn, flap motor, starter, fan, electric gyro), V. */
export const BUS_POWERED_V = C172S_AUDIO.busPoweredV;

/** Synthesis speed: never below cranking speed while the starter is engaged. */
export function crankRpm(rpm: number, starter: boolean, running: boolean, engine: EngineSoundProfile = C172S_ENGINE): number {
  return starter && !running ? Math.max(rpm, engine.crankRpm) : Math.max(rpm, 0);
}

/**
 * Engine load 0..~1.2: 60% from manifold pressure (C172S: idle ~8.5 inHg, full throttle ~28.8 inHg at sea
 * level in the flight model), 40% from delivered power relative to the rated power (C172S: 180 hp). Negative
 * power (windmilling) counts as no load. An engine without a manifold pressure range (`mapRange` null) takes
 * its load from the power alone.
 */
export function engineLoad(manifoldPressureInHg: number, powerW: number, engine: EngineSoundProfile = C172S_ENGINE): number {
  const pwr = clamp(powerW / engine.ratedPowerW, 0, 1.2);
  const range = engine.mapRange;
  if (range === null) return pwr;
  const map = clamp((manifoldPressureInHg - range[0]) / (range[1] - range[0]), 0, 1.2);
  return 0.6 * map + 0.4 * pwr;
}

/** Roughness of melt water at its full rate (EngineState.roughness 1): that of running on one magneto. */
export const MELT_WATER_ROUGHNESS = 0.25;

/** Combustion irregularity from mixture (too lean or grossly rich) and running on one magneto. */
export function roughness(mixture: number, magnetos: number): number {
  const lean = clamp((0.45 - mixture) / 0.3, 0, 1);
  const singleMag = magnetos === 1 || magnetos === 2 ? 0.25 : 0;
  return clamp(lean + singleMag, 0, 1);
}

/**
 * Turbocharger speed 0..1 of its speed at full load, for the whine. A centrifugal compressor's pressure rise
 * goes with the square of its tip speed and the boost an engine needs goes with its load, so the speed goes
 * with the square root of the load; the exhaust of an idling engine keeps the rotor at about a third. A
 * stopped engine drives nothing.
 */
export function turboSpool(load: number, running: boolean): number {
  return running ? Math.sqrt(clamp(0.1 + 0.9 * load, 0, 1)) : 0;
}

/** Helical blade-tip Mach number: rotational tip speed combined with the forward speed. */
export function tipMach(rpm: number, tas: number, speedOfSound: number, prop: PropSoundProfile = C172S_PROP): number {
  const vt = (Math.PI * prop.diameterM * rpm) / 60;
  return Math.sqrt(vt * vt + tas * tas) / speedOfSound;
}

/** Propeller loading 0..1.6: thrust relative to the cruise thrust of the type. */
export function propLoad(thrust: number, prop: PropSoundProfile = C172S_PROP): number {
  return clamp(Math.abs(thrust) / prop.cruiseThrustN, 0, 1.6);
}

/**
 * Airframe wind noise: pressure amplitude grows with IAS squared (dynamic pressure), 1 at 50 m/s (97 kt).
 * The noise band rises with speed; sideslip adds a whistle from the door seals and flaps add flow noise.
 */
export function windNoise(
  ias: number,
  beta: number,
  flapRad: number,
  profile: AudioProfile = C172S_AUDIO,
): { level: number; freq: number; slip: number; flap: number } {
  const v = Math.max(ias, 0);
  return {
    level: Math.min((v / 50) ** 2, 2.5),
    freq: 250 + v * 9,
    slip: clamp(Math.abs(beta) / (10 * DEG), 0, 1) * clamp(v / 25, 0, 1),
    flap: clamp(flapRad / profile.flapMaxRad, 0, 1) * clamp(v / 30, 0, 1),
  };
}

/**
 * Stall horn: the 172's warning is a reed sucked by the low pressure at the wing leading edge, so it needs
 * airflow and gets louder and higher as the angle of attack approaches the stall. An electric warner is a
 * horn on the switch of a lift-detector vane: it is on or off, at one strength.
 */
export function stallHorn(stallWarning: boolean, alpha: number, ias: number, warner: AudioProfile['stallWarner'] = C172S_AUDIO.stallWarner): number {
  if (!stallWarning) return 0;
  if (warner.kind === 'electric') return 1;
  return (0.45 + 0.55 * smoothstep(10 * DEG, 16 * DEG, alpha)) * clamp(ias / 12, 0, 1);
}

/**
 * Flow noise of the extended landing gear, 0..2.5: the unsteady load on the legs and wheels goes with the
 * dynamic pressure, so like the airframe wind noise it grows with IAS squared (1 at 50 m/s with every leg
 * out). `extension`: mean extension of the legs, 0 = up, 1 = down.
 */
export function gearWind(extension: number, ias: number): number {
  return clamp(extension, 0, 1) * Math.min((Math.max(ias, 0) / 50) ** 2, 2.5);
}

/** Strength of the thump of a gear event (a 'thump' message to the worklet): a leg locking down is the loudest. */
export function gearThumpAmplitude(kind: 'unlock' | 'downLocked' | 'up'): number {
  return kind === 'downLocked' ? 1 : kind === 'up' ? 0.7 : 0.4;
}

export function buffet(stallFraction: number): number {
  return clamp(stallFraction * 1.2, 0, 1);
}

export function surfaceKind(s: SurfaceType): 0 | 1 | 2 {
  if (s === 'runway' || s === 'taxiway') return 0;
  if (s === 'grass' || s === 'snow' || s === 'water') return 1;
  return 2;
}

/** Tyre rolling noise from ground speed with any wheel on the ground. */
export function rolling(wheelsOnGround: number, groundSpeed: number): number {
  if (wheelsOnGround === 0) return 0;
  return Math.pow(clamp(groundSpeed / 25, 0, 1.2), 1.3) * (0.6 + 0.4 * (wheelsOnGround / 3));
}

/** Brake squeal: needs some motion, loudest at walking pace just before the aircraft stops. */
export function brakeSqueal(brake: number, groundSpeed: number, onGround: boolean): number {
  if (!onGround || brake <= 0.05) return 0;
  return clamp(brake, 0, 1) * smoothstep(0.3, 1.5, groundSpeed) * (0.35 + 0.65 * (1 - smoothstep(3, 12, groundSpeed)));
}

/** Touchdown chirp amplitude from sink rate (m/s): a greaser at 0.3 m/s is a whisper, 3 m/s is a bang. */
export function chirpAmplitude(sinkRate: number): number {
  return clamp(0.15 + 0.5 * sinkRate, 0.15, 1.8);
}

/**
 * Gyro spin, 0..1: vacuum instruments (attitude, heading) spin with the engine-driven pump, the turn
 * coordinator with electrical power. Spin-up takes ~20 s, run-down about a minute. A type whose gyros are all
 * electric needs only the bus; one without spinning gyros (solid-state attitude sensors) has no whine.
 * `engineRpm`: of the fastest engine (every engine drives a vacuum pump).
 */
export function stepGyro(spin: number, engineRpm: number, busVoltage: number, dt: number, profile: AudioProfile = C172S_AUDIO): number {
  if (profile.gyros === 'none') return 0;
  const electric = busVoltage > profile.busPoweredV;
  const target = profile.gyros === 'electric' ? (electric ? 1 : 0) : (engineRpm > 500 ? 0.7 : 0) + (electric ? 0.3 : 0);
  const tau = target > spin ? 20 : 60;
  return spin + (target - spin) * (1 - Math.exp(-dt / tau));
}

/** Flap motor runs while the flaps are moving (actual deflection rate above 0.2 deg/s). */
export function flapMotorRunning(prevFlapRad: number, flapRad: number, dt: number): number {
  if (dt <= 0) return 0;
  return Math.abs(flapRad - prevFlapRad) / dt > 0.2 * DEG ? 1 : 0;
}

/** Spherical spreading relative to the reference distance, capped close up. */
export function distanceGain(d: number): number {
  return Math.min(1.4, REFERENCE_DISTANCE / Math.max(d, 1));
}

/** Air absorption: effective low-pass cutoff falling with distance (atmospheric absorption above ~2 kHz). */
export function airAbsorptionCutoff(d: number): number {
  return clamp(20000 * Math.pow(40 / Math.max(d, 40), 0.8), 1200, 20000);
}

/** Propagation delay, s. Varying it produces the Doppler shift naturally. */
export function propagationDelay(d: number): number {
  return d / SPEED_OF_SOUND;
}

/** Everything the parameter block needs beyond AircraftState / ControlInputs. */
export interface SoundContext {
  surface: SurfaceType;
  speedOfSound: number;
  turbulence: number;
  gyroSpin: number;
  flapMotor: number;
}

/**
 * Fill the worklet parameter block: the shared parameters, and a block for every engine of the profile
 * (engine 0 at the first indices of the block, see params.ts).
 */
export function fillSynthParams(s: AircraftState, c: ControlInputs, x: SoundContext, out: Float32Array, profile: AudioProfile = C172S_AUDIO): Float32Array {
  const powered = s.electrical.busVoltage > profile.busPoweredV;
  const engines = Math.min(profile.engines.length, ENGINE_P.length);
  for (let i = 0; i < engines; i++) {
    const ix = ENGINE_P[i];
    // Engine 0 through the legacy fields, which every state carries.
    const e = i === 0 ? s.engine : s.engines[i];
    const prop = i === 0 ? s.propeller : s.propellers[i];
    if (e === undefined || prop === undefined) {
      // The state has fewer engines than the profile: that voice is silent.
      for (const name of ENGINE_PARAMS) out[ix[name]] = 0;
      continue;
    }
    const voice = profile.engines[i];
    const diesel = voice.engine.combustion === 'diesel';
    const starter = engineControl(c, i, 'starter') && powered;
    // No combustion, no load: a cranking or windmilling engine's manifold sits near ambient pressure.
    const load = e.running ? engineLoad(e.manifoldPressure, e.power, voice.engine) : 0;
    out[ix.rpm] = crankRpm(e.rpm, starter, e.running, voice.engine);
    out[ix.firing] = e.running ? 1 : 0;
    out[ix.load] = load;
    // Intake roar: the throttle plate's opening. A diesel has none: its intake noise follows the air it is given.
    out[ix.throttle] = diesel ? Math.min(load, 1) : engineControl(c, i, 'throttle');
    out[ix.starter] = starter ? 1 : 0;
    // A diesel has neither a mixture to lean nor magnetos. Melt water from carburettor ice (EngineState.roughness,
    // absent on an engine without a carburettor) runs rough on top, at full strength like one magneto off.
    const rough = diesel ? 0 : roughness(engineControl(c, i, 'mixture'), engineControl(c, i, 'magnetos'));
    const melt = e.roughness;
    out[ix.roughness] = melt ? Math.min(1, rough + melt * MELT_WATER_ROUGHNESS) : rough;
    out[ix.propLoad] = propLoad(prop.thrust, voice.prop);
    out[ix.tipMach] = tipMach(prop.rpm, s.tas, x.speedOfSound, voice.prop);
    out[ix.propRpm] = prop.rpm;
    out[ix.turbo] = voice.engine.turbo ? turboSpool(load, e.running) : 0;
  }
  const w = windNoise(s.ias, s.beta, s.surfaces.flaps, profile);
  out[P.windLevel] = w.level;
  out[P.windFreq] = w.freq;
  out[P.slip] = w.slip;
  out[P.flapNoise] = w.flap;
  out[P.buffet] = buffet(s.stallFraction);
  out[P.horn] = powered || !profile.stallWarner.needsBus ? stallHorn(s.stallWarning, s.alpha, s.ias, profile.stallWarner) : 0;
  out[P.flapMotor] = powered && profile.flapMotor ? x.flapMotor : 0;
  let onGround = 0;
  let skid = 0;
  for (const wh of s.wheels) {
    if (wh.onGround) onGround++;
    skid = Math.max(skid, wh.skid);
  }
  out[P.rolling] = rolling(onGround, s.groundSpeed);
  out[P.rollSpeed] = s.groundSpeed;
  out[P.surface] = surfaceKind(x.surface);
  const brake = c.parkingBrake ? 1 : Math.max(c.brakeLeft, c.brakeRight);
  out[P.brakeSqueal] = brakeSqueal(brake, s.groundSpeed, onGround > 0);
  out[P.skid] = onGround > 0 ? clamp(skid, 0, 1) : 0;
  out[P.gyro] = x.gyroSpin;
  out[P.fan] = c.avionics && c.masterBattery && powered ? 1 : 0;
  out[P.turbulence] = x.turbulence;
  // Retractable gear: the hydraulic pump works while a leg is in transit (not when the gear falls free on the
  // emergency release, and not without the bus), the warning needs the bus, the legs in the flow rumble.
  const gear = profile.gear;
  if (gear !== null && s.gear.retractable) {
    out[P.gearPump] = gear.pump && powered && s.gear.inTransit && !c.gearEmergency ? 1 : 0;
    out[P.gearHorn] = gear.warningHorn && powered && s.gear.warning ? 1 : 0;
    const legs = s.gear.extension;
    out[P.gearWind] = gearWind((legs[0] + legs[1] + legs[2]) / 3, s.ias);
  } else {
    out[P.gearPump] = 0;
    out[P.gearHorn] = 0;
    out[P.gearWind] = 0;
  }
  return out;
}

export const makeParamBlock = (): Float32Array => new Float32Array(PARAM_COUNT);

/** Crank speed of the fastest engine, rev/min: every engine drives a vacuum pump. */
function fastestEngineRpm(s: AircraftState): number {
  let rpm = s.engine.rpm;
  for (let i = 1; i < s.engines.length; i++) rpm = Math.max(rpm, s.engines[i].rpm);
  return rpm;
}

/**
 * Per-frame bookkeeping between the simulation and the worklet parameter block: gyro spin-up/run-down,
 * flap-motor detection and the surface under the wheels. Used by AudioSystem and by the offline analysis.
 */
export class SoundTracker {
  readonly sound: SoundContext = { surface: 'runway', speedOfSound: SPEED_OF_SOUND, turbulence: 0, gyroSpin: 0, flapMotor: 0 };
  readonly params = makeParamBlock();
  private prevFlaps = Number.NaN;

  /** `profile`: the sound profile of the aircraft type flown. */
  constructor(private readonly profile: AudioProfile = C172S_AUDIO) {}

  /** A teleport (scenario reset): gyros already spinning if an engine runs (or, all electric, the bus is alive), flap tracker restarted. */
  reset(s: AircraftState): void {
    const gyros = this.profile.gyros;
    if (gyros === 'none') this.sound.gyroSpin = 0;
    else if (gyros === 'electric') this.sound.gyroSpin = s.electrical.busVoltage > this.profile.busPoweredV ? 1 : 0;
    else this.sound.gyroSpin = fastestEngineRpm(s) > 500 ? 1 : 0;
    this.sound.flapMotor = 0;
    this.prevFlaps = Number.NaN;
  }

  update(s: AircraftState, c: ControlInputs, env: Environment, weather: WeatherSettings, dt: number): Float32Array {
    const x = this.sound;
    // The surface only matters for tyre noise: skip the (polygon) lookup while flying.
    if (s.onGround || s.altitudeAGL < 5) x.surface = env.surface(s.position.x, s.position.y);
    x.speedOfSound = env.atmosphere(s.altitudeMSL).speedOfSound;
    x.turbulence = weather.turbulence;
    x.gyroSpin = stepGyro(x.gyroSpin, fastestEngineRpm(s), s.electrical.busVoltage, dt, this.profile);
    const flaps = s.surfaces.flaps;
    if (dt > 0) {
      x.flapMotor = Number.isNaN(this.prevFlaps) ? 0 : flapMotorRunning(this.prevFlaps, flaps, dt);
      this.prevFlaps = flaps;
    }
    return fillSynthParams(s, c, x, this.params, this.profile);
  }
}
