// A circuit aircraft on the real flight model (docs/atc.md): the type's own BladeElementFlightModel, flown through
// its controls by the scripted pilot the player's aircraft uses (sim/autoflight.ts) on the field's runway in use.
// The take-off roll, rotation and climb-out are the Autoflight's 'takeoff'; crosswind, downwind and base are its
// altitude and heading hold, the heading set every step from the circuit's legs (circuit.ts) with the drift
// added, as a pilot crabs into the wind; final, the flare and the touchdown are its 'approach'. A touch and go
// follows: flaps to the take-off setting and full power once the nosewheel is down. A go-around is full power,
// the take-off flap and the climb-out from wherever it is. Flaps by the type's sim profile: the base setting
// abeam the threshold, the final setting on base. Node-safe (no three.js).

import type { AircraftDefinition } from '../aircraft/types';
import { DEG, FT, KT, quat, wrapPi, type Quat, type Vec3 } from '../core/math';
import { copyControls, defaultControls, defaultWeather, type AircraftState, type ControlInputs, type Environment } from '../core/types';
import { createEnvironment, createFlightModelFor, type BladeElementFlightModel } from '../physics';
import { Autoflight, type AutoflightRunway } from '../sim/autoflight';
import { flapLever } from '../sim/scenarios';
import { activeFrame } from './calls';
import { CIRCUIT_HEIGHT, legPosition, legTrack, turnLead, type CircuitPath, type TrafficState } from './circuit';

/** Full rate on and near the ground (the gear's stiff contacts), the coarse rate in the air (SimPhysics). */
const GROUND_RATE = 240;
const AIR_RATE = 120;
const AIR_RATE_AGL = 60;
/** The nosewheel is let down for this long after the mains touch before the power goes on again, s. */
const TOUCH_HOLD = 2;
/** Not below this height on the climb-out does the crosswind turn begin, m (500 ft less a margin). */
const CROSSWIND_MIN = 450 * FT;
/** The descent from abeam the threshold to the base height, m/s (500 fpm). */
const CIRCUIT_DESCENT = 500 * FT / 60;
const DRIFT_TAU = 3;
/** The autopilot's bank limit in the circuit: its turns overshoot the limit by a few degrees, so a little under 25. */
const CIRCUIT_BANK = 22 * DEG;
/** At most this much flight time is carried to the next frame (a stalled tab must not replay seconds at once), s. */
const MAX_CARRY = 0.5;

/**
 * Over this height the posed aircraft no longer follows the ground under it (the pavement's lift above the field),
 * m: it fades out on the climb and in on the descent, so the touchdown has no step.
 */
const LIFT_FADE = 5;

/** How a type stands at rest on level ground: each wheel's compression, its pitch and the reference point's height. */
interface Rest {
  compression: number[];
  pitch: number;
  height: number;
}
const RESTS = new WeakMap<AircraftDefinition, Rest>();
let level: Environment | null = null;

/** The flight model settled at rest on level ground, calm, once per type. */
function restOf(def: AircraftDefinition, fm: BladeElementFlightModel): Rest {
  let r = RESTS.get(def);
  if (r) return r;
  level ??= createEnvironment({
    weather: { ...defaultWeather(), windSpeedKt: 0, gustKt: 0, turbulence: 0 },
    terrain: { height: () => 0, normal: () => ({ x: 0, y: 0, z: -1 }), surface: () => 'runway' },
  });
  fm.reset({ position: { x: 0, y: 0, z: -def.geometry.restHeight }, heading: 0, airspeed: 0, onGround: true, engineRunning: false, flaps: 0, flightPathAngle: 0 }, level);
  const s = fm.state;
  r = { compression: s.wheels.map((w) => w.compression), pitch: s.pitch, height: s.altitudeMSL };
  RESTS.set(def, r);
  return r;
}

/**
 * The height MSL of a kinematic aircraft's wheels: its height above the field, plus near the ground the ground's own
 * height above the field there (the pavement is raised a few centimetres, runway 9 and taxiways 5, and the wheels
 * of the flight model stand on it: sim/worldEnvironment.ts).
 */
export function wheelHeight(elevation: number, ground: number, height: number): number {
  return elevation + height + (ground - elevation) * Math.max(0, 1 - height / LIFT_FADE);
}

/** The runway in use as the scripted pilot's frame (the landing direction). */
export function runwayFrame(path: CircuitPath): AutoflightRunway {
  const f = path.field;
  return {
    heading: f.heading + (path.end === 1 ? Math.PI : 0),
    halfLength: f.length / 2,
    elevation: f.elevation,
    coords: (north, east) => activeFrame(f, path.end, north, east),
  };
}

export class TrafficPilot {
  readonly fm: BladeElementFlightModel;
  readonly controls: ControlInputs;
  readonly autoflight: Autoflight;
  /** The circuit leg being flown (circuit.ts CircuitPath.legs). */
  leg = 0;
  private path: CircuitPath;
  private drift = 0;
  /** Time since the mains touched on a touch and go, s (NaN: not on the ground after a landing). */
  private touchTime = NaN;
  /** This landing is a full stop: the roll-out brakes to a stop (the traffic then taxis it off) instead of a touch and go. */
  fullStop = false;
  /** Flying straight to a point (joining, leaving) instead of round the circuit. */
  private direct: { north: number; east: number } | null = null;
  /** How it stands at rest on level ground (for posing it on the ground). */
  private readonly rest: Rest;
  /** Flap levers: the base and final settings, and the take-off's. */
  private readonly flaps: { first: number; base: number; final: number };
  /**
   * Fixed-step timing, as the player's (sim/SimPhysics.ts): frame time accumulates and whole steps are run; the
   * remainder is carried (acc) and the pose before the last step kept, so the aircraft can be drawn between its
   * steps at the instant the player's aircraft is drawn (drawPose).
   */
  private acc = 0;
  private lastH = 1 / AIR_RATE;
  private readonly prevPos: Vec3 = { x: 0, y: 0, z: 0 };
  private prevQuat: Quat = quat.identity();

  constructor(readonly def: AircraftDefinition, path: CircuitPath) {
    this.fm = createFlightModelFor(def);
    this.controls = defaultControls(def);
    this.autoflight = new Autoflight(def.sim.autoflight, def.reference, def.geometry.restHeight, { gains: def.autopilot, flaps: def.controls.flaps });
    this.path = path;
    this.rest = restOf(def, this.fm);
    const sc = def.sim.scenario;
    const fl = def.controls.flaps;
    const first = fl.detents.find((d) => d > 0);
    this.flaps = {
      first: first === undefined ? 0 : first / fl.maxDeflection,
      base: flapLever(fl, sc.baseFlapsDeg),
      final: flapLever(fl, sc.finalFlapsDeg),
    };
  }

  get state(): AircraftState {
    return this.fm.state;
  }

  /** Height of the wheels above the field, m. */
  get height(): number {
    return this.fm.state.altitudeMSL - this.path.field.elevation - this.def.geometry.restHeight;
  }

  /** Take over from the kinematic stand-in: the flight model starts where it is, trimmed, on the same leg. */
  start(env: Environment, path: CircuitPath, k: TrafficState): void {
    this.path = path;
    this.leg = k.leg;
    const final = path.legs[k.leg].id === 'final';
    const base = path.legs[k.leg].id === 'base';
    this.fm.reset(
      {
        position: { x: k.north, y: k.east, z: -(path.field.elevation + k.height + this.def.geometry.restHeight) },
        heading: k.heading,
        airspeed: k.onGround ? 0 : k.speed,
        onGround: k.onGround,
        engineRunning: true,
        flaps: k.onGround ? 0 : final ? this.flaps.final : base ? this.flaps.base : 0,
        flightPathAngle: k.onGround ? 0 : Math.atan2(k.verticalSpeed, Math.max(k.speed, 1)),
      },
      env,
    );
    copyControls(this.controls, this.fm.trimControls);
    this.controls.parkingBrake = false;
    this.direct = null;
    this.fullStop = k.fullStop ?? false;
    // Nav lights, beacon, strobes and the landing light on, as in the circuit.
    Object.assign(this.controls.lights, { nav: true, beacon: true, strobe: true, landing: true, taxi: false });
    this.drift = 0;
    this.touchTime = NaN;
    this.settle();
    this.engageLeg(k.onGround);
  }

  /** No step in hand: drawn where the flight model is. */
  private settle(): void {
    const s = this.fm.state;
    this.acc = 0;
    Object.assign(this.prevPos, s.position);
    this.prevQuat = quat.clone(s.orientation);
  }

  /**
   * Where to draw it: between its last two steps by the time carried, i.e. one step behind the traffic clock
   * (which runs on the player's rendered time), so it moves on screen as evenly as the frames come.
   */
  drawPose(position: Vec3, orientation: Quat): void {
    const s = this.fm.state;
    const t = Math.min(1, this.acc / this.lastH);
    const p = this.prevPos;
    const c = s.position;
    position.x = p.x + (c.x - p.x) * t;
    position.y = p.y + (c.y - p.y) * t;
    position.z = p.z + (c.z - p.z) * t;
    // Normalised lerp (the steps are milliseconds apart), on the shorter arc.
    const a = this.prevQuat;
    const b = s.orientation;
    const sign = a.w * b.w + a.x * b.x + a.y * b.y + a.z * b.z < 0 ? -1 : 1;
    const w = a.w + (sign * b.w - a.w) * t;
    const x = a.x + (sign * b.x - a.x) * t;
    const y = a.y + (sign * b.y - a.y) * t;
    const z = a.z + (sign * b.z - a.z) * t;
    const n = Math.hypot(w, x, y, z) || 1;
    orientation.w = w / n;
    orientation.x = x / n;
    orientation.y = y / n;
    orientation.z = z / n;
  }

  /** Back to the kinematic stand-in: its state from the flight model's. */
  handBack(k: TrafficState): void {
    const s = this.fm.state;
    Object.assign(k, {
      north: s.position.x, east: s.position.y, height: Math.max(0, this.height), heading: s.heading, bank: s.roll, pitch: s.pitch,
      speed: Math.max(s.ias, 20 * KT), verticalSpeed: s.verticalSpeed, leg: this.leg, onGround: s.onGround, rollTime: 0,
    });
  }

  /** The circuit changed (the wind swung round), or joining it: fly the circuit from the leg given. */
  setPath(path: CircuitPath, leg: number): void {
    this.path = path;
    this.leg = leg;
    this.direct = null;
    this.engageLeg(false);
  }

  /** Fly straight to a point at this altitude MSL and speed (a joining arrival, a departure leaving the circuit). */
  flyDirect(north: number, east: number, altitude: number, kias: number): void {
    const s = this.fm.state;
    this.direct = { north, east };
    this.controls.flaps = 0;
    this.autoflight.engage({ kind: 'hold', heading: Math.atan2(east - s.position.y, north - s.position.x), altitude: altitude + this.def.geometry.restHeight, kias }, s, this.controls);
  }

  /**
   * Put it where the kinematic traffic has it, for its exterior: no physics. On the ground (taxiing, holding,
   * parked) it stands on its wheels as at rest, the struts compressed, on the ground under it (`ground`, MSL:
   * the pavement), with the propeller at idle when the engine runs; in the air it has the kinematic attitude,
   * the gear hanging free and the propeller at cruise rpm.
   */
  pose(k: TrafficState, elevation: number, ground: number, dt: number, engine: boolean): void {
    const s = this.fm.state;
    const r = this.rest;
    const onGround = k.onGround;
    s.position.x = k.north;
    s.position.y = k.east;
    s.position.z = -(wheelHeight(elevation, ground, k.height) + (onGround ? r.height : this.def.geometry.restHeight));
    s.altitudeMSL = -s.position.z;
    s.orientation = quat.fromEuler(onGround ? 0 : k.bank, k.pitch + (onGround ? r.pitch : 0), k.heading);
    s.heading = k.heading;
    s.pitch = k.pitch + (onGround ? r.pitch : 0);
    s.roll = onGround ? 0 : k.bank;
    s.wheels.forEach((w, i) => {
      w.compression = onGround ? r.compression[i] : 0;
      w.onGround = onGround;
    });
    s.onGround = onGround;
    const rpm = engine ? (onGround ? 900 : 2300) : 0;
    for (const p of s.propellers) {
      p.rpm = rpm;
      p.rotation = (p.rotation + (p.rpm / 60) * 2 * Math.PI * dt) % (2 * Math.PI);
    }
    this.settle();
  }

  /** The pitch attitude it stands at on its wheels. */
  get restPitch(): number {
    return this.rest.pitch;
  }

  /** The height base is flown at and final turned onto, m (higher on an extended downwind). */
  private get baseHeight(): number {
    return this.path.legs[3].height;
  }

  /** The same circuit with base moved out (following traffic): flown on from where it is, nothing re-engaged. */
  extend(path: CircuitPath): void {
    this.path = path;
  }

  /** Go around: full power, take-off flap, climb out on the runway heading, then the circuit again. */
  goAround(): void {
    const s = this.fm.state;
    this.leg = 0;
    this.touchTime = NaN;
    this.autoflight.runway = runwayFrame(this.path);
    this.autoflight.engage(this.takeoffPlan(), s, this.controls);
    this.controls.flaps = Math.min(this.controls.flaps, this.flaps.base);
  }

  private takeoffPlan() {
    const rw = runwayFrame(this.path);
    return { kind: 'takeoff' as const, heading: rw.heading, climbTo: this.path.field.elevation + CIRCUIT_HEIGHT, cruiseKias: this.def.sim.scenario.downwindKias };
  }

  /** Engage the scripted pilot for the leg being flown. */
  private engageLeg(onGround: boolean): void {
    const af = this.autoflight;
    const s = this.fm.state;
    af.runway = runwayFrame(this.path);
    const leg = this.path.legs[this.leg];
    if (onGround || leg.id === 'upwind') af.engage(this.takeoffPlan(), s, this.controls);
    else if (leg.id === 'final') af.engage({ kind: 'approach', kias: this.def.sim.scenario.finalKias }, s, this.controls);
    else this.hold(leg.id === 'base' ? this.baseHeight : CIRCUIT_HEIGHT, leg.id === 'downwind' ? this.def.sim.scenario.downwindKias : this.def.sim.scenario.finalKias + 5);
  }

  private hold(height: number, kias: number): void {
    const s = this.fm.state;
    this.autoflight.engage({ kind: 'hold', heading: s.heading, altitude: this.path.field.elevation + height + this.def.geometry.restHeight, kias }, s, this.controls);
  }

  /**
   * Fly for dt seconds of sim time. Returns the new leg index when it changes (0 after a touchdown, as the
   * kinematic stepper does).
   */
  step(dt: number, env: Environment): number | null {
    let changed: number | null = null;
    const s = this.fm.state;
    this.acc = Math.min(this.acc + dt, MAX_CARRY);
    for (;;) {
      const rate = s.onGround || s.altitudeAGL < AIR_RATE_AGL ? GROUND_RATE : AIR_RATE;
      if (this.fm.physicsRate !== rate) this.fm.setPhysicsRate(rate);
      const h = 1 / rate;
      // A hair of tolerance: a frame of whole steps (1/30 s at 120 Hz) must not leave its last step behind.
      if (this.acc < h - 1e-9) break;
      this.acc = Math.max(0, this.acc - h);
      Object.assign(this.prevPos, s.position);
      this.prevQuat = quat.clone(s.orientation);
      this.lastH = h;
      const c = this.control(h);
      if (c !== null) changed = c;
      this.autoflight.autopilot.settings.maxBank = CIRCUIT_BANK;
      this.autoflight.update(h, s, this.controls);
      this.fm.step(h, this.controls, env);
      if (s.crashed) break;
    }
    return changed;
  }

  /** The circuit pilot's decisions before a physics step: leg changes, flaps, the touch and go. */
  private control(dt: number): number | null {
    const s = this.fm.state;
    const af = this.autoflight;
    const path = this.path;
    const leg = path.legs[this.leg];
    let changed: number | null = null;
    if (!s.onGround && s.groundSpeed > 15) this.drift += (wrapPi(s.heading - s.track) - this.drift) * Math.min(1, dt / DRIFT_TAU);

    // The touch and go: mains down, nosewheel let down, then flaps to the take-off setting and full power.
    if (af.phase === 'rollout' || af.phase === 'stopped') {
      if (Number.isNaN(this.touchTime)) {
        this.touchTime = 0;
        this.leg = 0;
        changed = 0;
      }
      // A full stop: the scripted pilot brakes it to a stop on the centreline.
      if (this.fullStop) return changed;
      this.touchTime += dt;
      this.controls.brakeLeft = this.controls.brakeRight = 0;
      this.controls.parkingBrake = false;
      if (this.touchTime > TOUCH_HOLD) {
        this.touchTime = NaN;
        af.engage(this.takeoffPlan(), s, this.controls);
      }
      return changed;
    }
    if (s.onGround) return null;
    if (this.direct) {
      if (af.phase === 'hold') af.autopilot.settings.heading = Math.atan2(this.direct.east - s.position.y, this.direct.north - s.position.x);
      return null;
    }

    const pos = legPosition(path, this.leg, s.position.x, s.position.y);
    if (leg.id !== 'final' && pos.toGo < turnLead(s.groundSpeed) && (leg.id !== 'upwind' || this.height > CROSSWIND_MIN)) {
      this.leg = (this.leg + 1) % path.legs.length;
      changed = this.leg;
      const next = path.legs[this.leg];
      if (next.id === 'final') {
        this.controls.flaps = this.flaps.final;
        af.engage({ kind: 'approach', kias: this.def.sim.scenario.finalKias }, s, this.controls);
      } else if (next.id === 'base') {
        this.controls.flaps = this.flaps.base;
        this.hold(this.baseHeight, this.def.sim.scenario.finalKias + 5);
        this.autoflight.autopilot.settings.verticalSpeed = CIRCUIT_DESCENT;
      } else {
        // Crosswind and downwind at circuit height (the climb continues on crosswind).
        if (next.id === 'crosswind') this.controls.flaps = 0;
        this.hold(CIRCUIT_HEIGHT, next.id === 'downwind' ? this.def.sim.scenario.downwindKias : this.def.reference.vy ?? this.def.sim.scenario.downwindKias);
      }
    }
    const now = path.legs[this.leg];
    if (af.phase === 'hold') {
      // The leg's track, with the intercept and the wind correction.
      const p = legPosition(path, this.leg, s.position.x, s.position.y);
      af.autopilot.settings.heading = wrapPi(legTrack(path, this.leg, p.cross) + this.drift);
      // Abeam the threshold on downwind: power back, the first stage of flap, the approach's speed plus ten and
      // a 500 fpm descent toward the base height.
      // Following traffic, abeam the threshold moves out with the extended downwind.
      if (now.id === 'downwind' && activeFrame(path.field, path.end, s.position.x, s.position.y).along < -path.field.length / 2 - path.extension && af.autopilot.settings.altitude > path.field.elevation + this.baseHeight + this.def.geometry.restHeight + 1) {
        this.controls.flaps = Math.max(this.controls.flaps, Math.min(this.flaps.first, this.flaps.base));
        af.autopilot.settings.airspeed = (this.def.sim.scenario.finalKias + 10) * KT;
        af.autopilot.settings.altitude = path.field.elevation + this.baseHeight + this.def.geometry.restHeight;
        af.autopilot.settings.verticalSpeed = CIRCUIT_DESCENT;
      }
    }
    return changed;
  }
}
