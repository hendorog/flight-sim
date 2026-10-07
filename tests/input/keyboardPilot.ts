// A scripted "keyboard pilot" that flies the real flight model through the real InputSystem using only
// key presses, with human-like limits: it looks at the aircraft 10 times a second, holds keys for whole
// frames (60 Hz), never presses a key for less than 60 ms, and uses only what a pilot sees (attitude,
// airspeed, altitude, heading, position relative to the runway, and the control-position widget, which shows
// where the hold-position keyboard yoke and rudder are). If this pilot can fly a circuit comfortably, the
// keyboard model gives a human enough authority, resolution and damping.
//
// The rig and the pilot take the aircraft type as options (KeyboardPilotOptions: its input profile, reference
// speeds, flap detents, rest height and a physics factory); without them they are the Cessna 172S, as flown
// by every test of this directory. The test blocks built on them are in keyboardFlight.ts
// (describeKeyboardFlight); this file is also loaded into the real page (scripts/fly-keyboard.mjs), so it must
// not import the test runner.

import { C172S_INPUT } from '../../src/aircraft/c172s/input';
import { C172S_REFERENCE } from '../../src/aircraft/c172s/reference';
import type { ReferenceSpeeds } from '../../src/aircraft/types';
import { createEventBus, type SimContext } from '../../src/core/context';
import { clamp, DEG, FT, KT, RAD, wrapPi } from '../../src/core/math';
import { defaultWeather, type AircraftState, type ControlInputs, type WeatherSettings } from '../../src/core/types';
import { AIRPORT, runwayCoords } from '../../src/core/world';
import { InputSystem } from '../../src/input/InputSystem';
import type { InputProfile } from '../../src/input/profile';
import { keyAuthority, keyRate, type KeyAxisTuning } from '../../src/input/virtualYoke';
import { SimPhysics, type SimPhysicsOptions } from '../../src/sim/SimPhysics';

export const FRAME = 1 / 60;
const DECIDE = 0.1;
const MIN_PRESS = 0.06;
const RWY = AIRPORT.runway;
const FIELD = AIRPORT.elevation;
const PATTERN = FIELD + 1000 * FT;
const HALF = RWY.length / 2;
/**
 * The scripted pilot's gains (exported so a tuning run can vary them). Pitch: elevator per rad of attitude
 * error, per rad/s of pitch rate, and learning rate of the held position, all in units of the key authority.
 * Roll: the same for the aileron (rcap caps the commanded aileron). flare: round-out height, m. si: integral of
 * the airspeed error into the pitch target. de / da: the smallest elevator / aileron change worth a key press.
 */
export const GAINS = { kp: 3, kd: 2.5, ki: 0.2, rkp: 1.5, rkd: 0.5, rki: 0.02, rcap: 0.4, flare: 10, si: 0.015, de: 0.008, da: 0.012 };

/** What the scripted pilot flies: speeds, attitudes and power settings. */
export interface PilotTargets {
  /** Speeds, KIAS: start of the rotation, climb and crosswind (and abeam the threshold), downwind, base, final. */
  rotateKias: number;
  climbKias: number;
  downwindKias: number;
  baseKias: number;
  finalKias: number;
  /** The roll-out is braked below this, KIAS. */
  brakeKias: number;
  /** Pitch attitudes, degrees: rotation, full-power climb, level flight, final approach, landing. */
  rotatePitchDeg: number;
  climbPitchDeg: number;
  levelPitchDeg: number;
  finalPitchDeg: number;
  landingPitchDeg: number;
  /** The power the pilot reads and sets with throttle taps (the tachometer of a fixed-pitch type). */
  power(s: AircraftState): number;
  /** Power on downwind, at pattern speed, on base and on the glide path; the limits on final. */
  powerDownwind: number;
  powerPattern: number;
  powerBase: number;
  powerFinal: number;
  powerMin: number;
  powerMax: number;
  /** Power per knot slow, per metre above the glide path, and the error not worth a throttle tap. */
  powerPerKt: number;
  powerPerMetre: number;
  powerBand: number;
  /**
   * Optional circuit geometry and flare for a type that glides flatter or floats longer than the Cessna 172S
   * (DECISIONS-D2): base leg height, ft AGL (450), and where it begins, m beyond the threshold along the downwind
   * (1300); round-out height, m (GAINS.flare, 10); the height the throttle is closed at in the flare, m (3: on the
   * 172S chopping it at the flare height pitches the nose down); the flare's bank limit, degrees (5); the height the
   * crab is kicked out at, m (Infinity: as the flare begins; a type that floats long drifts downwind in the slip
   * when its ailerons cannot hold the wing down, so it keeps the crab until just before the wheels touch).
   */
  baseFt?: number;
  baseTurnM?: number;
  flareM?: number;
  throttleOffM?: number;
  flareBankDeg?: number;
  decrabM?: number;
}

/**
 * The pilot's targets for a type's reference speeds: rotation starts 2 kt after Vr (the keyboard brings the nose
 * up slowly; see the take-off roll below), the climb is flown a knot above Vy, downwind, base and final at the
 * type's pattern speeds. Attitudes and tachometer settings are those of the Cessna 172S: a type with other
 * ones overrides them (KeyboardPilotOptions.targets).
 */
export function pilotTargets(reference: ReferenceSpeeds = C172S_REFERENCE): PilotTargets {
  return {
    rotateKias: reference.vr + 2,
    climbKias: reference.vy + 1,
    downwindKias: reference.vdownwind,
    baseKias: reference.vapp,
    finalKias: reference.vref,
    brakeKias: 45,
    rotatePitchDeg: 9,
    climbPitchDeg: 7,
    levelPitchDeg: 1.5,
    finalPitchDeg: -3,
    landingPitchDeg: 6,
    power: (s) => s.engine.rpm,
    powerDownwind: 2250,
    powerPattern: 1900,
    powerBase: 1500,
    powerFinal: 1500,
    powerMin: 900,
    powerMax: 2300,
    powerPerKt: 25,
    powerPerMetre: 15,
    powerBand: 60,
    baseFt: 450,
    baseTurnM: 1300,
    flareM: GAINS.flare,
    throttleOffM: 3,
    flareBankDeg: 5,
    decrabM: Infinity,
  };
}

/** The aircraft type a rig and its pilot are for. Everything is optional: the default is the Cessna 172S. */
export interface KeyboardPilotOptions {
  /** Input profile of the type: key rates and authority, flap detents, assists. */
  profile?: InputProfile;
  /** Reference speeds of the type, KIAS (the pilot's speeds come from them: pilotTargets). */
  reference?: ReferenceSpeeds;
  /** Flap lever detents the pilot steps through. Default: those of the profile. */
  flapDetents?: readonly number[];
  /** Height of the CG above the ground with the aircraft at rest, m. */
  restHeight?: number;
  /** Builds the physics of a rig (another type: a SimPhysics for its definition). */
  makePhysics?: (o: SimPhysicsOptions) => SimPhysics;
  /** Overrides of single targets of the pilot. */
  targets?: Partial<PilotTargets>;
}

/** The options with every default filled in. */
export function resolvePilotOptions(o: KeyboardPilotOptions = {}): Required<Omit<KeyboardPilotOptions, 'targets'>> & { targets: PilotTargets } {
  const profile = o.profile ?? C172S_INPUT;
  const reference = o.reference ?? C172S_REFERENCE;
  return {
    profile,
    reference,
    flapDetents: o.flapDetents ?? profile.flapDetents,
    restHeight: o.restHeight ?? 1.25,
    makePhysics: o.makePhysics ?? ((p) => new SimPhysics(p)),
    targets: { ...pilotTargets(reference), ...o.targets },
  };
}

export type Phase = 'takeoffRoll' | 'rotate' | 'climb' | 'crosswind' | 'downwind' | 'base' | 'final' | 'flare' | 'rollout' | 'stopped';

export interface FlightLog {
  phase: Phase;
  t: number;
  kias: number;
  altAgl: number;
  bank: number;
  pitch: number;
  heading: number;
  along: number;
  across: number;
  vs: number;
  elevator: number;
  trim: number;
  throttle: number;
  rudder: number;
}

export interface CircuitResult {
  crashed: boolean;
  crashReason: string;
  log: FlightLog[];
  touchdown: { t: number; along: number; across: number; sinkRate: number; kias: number } | null;
  stop: { along: number; across: number; t: number } | null;
  maxBank: number;
  maxG: number;
  minG: number;
  /** Largest centreline deviation during the take-off roll, m. */
  takeoffMaxAcross: number;
  /** Downwind altitude error band (ft). */
  downwindAltErrFt: [number, number];
  /** Keys pressed per minute (workload). */
  keyRate: number;
  phaseTimes: Partial<Record<Phase, number>>;
}

/** Where the pilot's key presses go: InputSystem.keyDown/keyUp in node, a real-keyboard queue in the browser. */
export interface KeyBackend {
  keyDown(code: string, shift?: boolean): unknown;
  keyUp(code: string): unknown;
}

/** One key the pilot works like a human: press for a while, then let go. */
class Key {
  private until = -1;
  private down = false;
  /** Time the current press started. */
  since = 0;
  constructor(
    private readonly input: KeyBackend,
    readonly code: string,
    private readonly shift = false,
    private readonly counter: { n: number },
  ) {}

  /** Hold for `seconds` from now (extends an existing press). */
  press(now: number, seconds: number): void {
    this.until = Math.max(this.until, now + Math.max(MIN_PRESS, seconds));
    if (!this.down) {
      this.input.keyDown(this.code, this.shift);
      this.down = true;
      this.since = now;
      this.counter.n++;
    }
  }

  release(): void {
    this.until = -1;
    if (this.down) this.input.keyUp(this.code);
    this.down = false;
  }

  tick(now: number): void {
    if (this.down && now >= this.until) {
      this.input.keyUp(this.code);
      this.down = false;
    }
  }

  get isDown(): boolean {
    return this.down;
  }
}

/**
 * How long to hold a key to move a hold-position control by `gap` (the pilot's feel for the key rates, read
 * off the control-position widget), counting from a press already `held` s old; capped at `cap` s.
 */
export function pressTime(gap: number, ias: number, tuning: KeyAxisTuning, held: number, cap: number): number {
  const L = keyAuthority(ias, tuning) * (gap < 0 ? tuning.negativeScale : 1);
  let d = 0;
  let T = 0;
  const dt = 1 / 120;
  while (d < Math.abs(gap) && T < cap) {
    d += L * keyRate(tuning, held + T) * dt;
    T += dt;
  }
  return T;
}

export interface Rig {
  physics: SimPhysics;
  input: InputSystem;
  ctx: SimContext;
  weather: WeatherSettings;
  /** The type the rig was built for (absent: the Cessna 172S). */
  options?: KeyboardPilotOptions;
}

export function makeRig(weather: Partial<WeatherSettings> = {}, options?: KeyboardPilotOptions): Rig {
  const w = { ...defaultWeather(), ...weather };
  const events = createEventBus();
  const physics = options?.makePhysics ? options.makePhysics({ weather: w, events }) : new SimPhysics({ weather: w, events });
  physics.reset('runway', w);
  const noop = (): void => {};
  const ctx = {
    state: physics.renderState,
    controls: physics.controls,
    weather: w,
    env: physics.env,
    events,
    paused: false,
    timeScale: 1,
    cameraMode: 'cockpit',
    simTime: 0,
    commands: { reset: noop, setPaused: noop, setCameraMode: noop, setTimeScale: noop, setQuality: noop },
  } as unknown as SimContext;
  const input = options?.profile ? new InputSystem({ profile: options.profile }) : new InputSystem();
  input.attach(ctx);
  return options ? { physics, input, ctx, weather: w, options } : { physics, input, ctx, weather: w };
}

/** Advance one rendered frame: input, then physics (as Simulator.frame does). */
export function frame(r: Rig): void {
  r.input.update(FRAME, r.ctx);
  r.physics.advance(FRAME);
}

/**
 * Fly a left-hand circuit on runway 07 from the take-off position to a full stop, keyboard only, with the
 * hold-position keyboard yoke: every decision the pilot works out where each control should be (from the
 * attitude, its rate and a slowly learned "position that holds it", as a pilot does) and taps or holds the key
 * toward it, watching the control-position widget. `maxTime` bounds the run (s).
 */
export function flyCircuit(r: Rig, maxTime = 900): CircuitResult {
  const pilot = createCircuitPilot(r.input, r.physics.renderState, r.physics.controls, r.ctx.events, r.options);
  let t = 0;
  for (; t < maxTime; t += FRAME) {
    pilot.tick(t);
    frame(r);
    if (pilot.observe()) break;
  }
  return pilot.result(t);
}

/**
 * The circuit pilot, stepped by the caller: tick(t) before each frame (sim time t, s), observe() after it.
 * `options`: the type it flies (default: the Cessna 172S).
 */
export function createCircuitPilot(
  input: KeyBackend,
  s: AircraftState,
  c: ControlInputs,
  events: SimContext['events'],
  options?: KeyboardPilotOptions,
): { tick(t: number): void; observe(): boolean; result(t: number): CircuitResult; readonly phase: Phase; readonly log: FlightLog[] } {
  const G = { ...GAINS };
  const { profile, flapDetents, restHeight, targets: T } = resolvePilotOptions(options);
  const AXES = profile.assists.axes;
  /** The flap lever is short of its n-th detent (the last one beyond the list). */
  const flapsShortOf = (n: number): boolean => c.flaps < flapDetents[Math.min(n, flapDetents.length - 1)] - 0.03;
  const counter = { n: 0 };
  const k = (code: string, shift = false): Key => new Key(input, code, shift, counter);
  const keys = {
    left: k('ArrowLeft'),
    right: k('ArrowRight'),
    back: k('ArrowDown'),
    fwd: k('ArrowUp'),
    rudL: k('KeyZ'),
    rudR: k('KeyX'),
    thrUp: k('F3'),
    thrDn: k('F2'),
    trimUp: k('End'),
    trimDn: k('Home'),
    flapsDn: k('F6'),
    flapsUp: k('F5'),
    brakes: k('KeyB'),
    parking: k('KeyB', true),
    idle: k('F1'),
    full: k('F4'),
    centre: k('Numpad5'),
  };
  const all = Object.values(keys);

  let phase = 'takeoffRoll' as Phase;
  const phaseTimes: Partial<Record<Phase, number>> = { takeoffRoll: 0 };
  const log: FlightLog[] = [];
  let t = 0;
  let lastTick = 0;
  let nextDecision = 0;
  let maxBank = 0;
  let maxG = 1;
  let minG = 1;
  let takeoffMaxAcross = 0;
  const dwAlt: [number, number] = [Infinity, -Infinity];
  let touchdown: CircuitResult['touchdown'] = null;
  let stop: CircuitResult['stop'] = null;
  let elevAvg = 0;
  let lastTrimAt = 0;
  let flareStart = 0;
  const unsub = events.on('touchdown', (e) => {
    if (!touchdown && (phase === 'flare' || phase === 'final')) {
      const rc = runwayCoords(s.position.x, s.position.y);
      touchdown = { t, along: rc.along, across: rc.across, sinkRate: e.sinkRate, kias: s.ias / KT };
    }
  });

  const setPhase = (p: Phase): void => {
    phase = p;
    phaseTimes[p] = t;
  };

  // Release the parking brake: Shift+B toggles it.
  keys.parking.press(0, 0.1);

  // ---- pilot skills -------------------------------------------------------------------------------
  /** Move a hold-position control toward `want` with the key pair (neg, pos), as the widget shows it. */
  const moveTo = (neg: Key, pos: Key, current: number, want: number, tuning: KeyAxisTuning, dead: number): void => {
    const gap = want - current;
    if (Math.abs(gap) <= dead) {
      neg.release();
      pos.release();
      return;
    }
    const [key, other] = gap > 0 ? [pos, neg] : [neg, pos];
    other.release();
    const held = key.isDown ? t - key.since : 0;
    key.press(t, pressTime(gap, s.ias, tuning, held, DECIDE + 0.02));
  };
  // The position that holds the present attitude / bank, learned slowly (the pilot's integral).
  let elevRef = 0;
  let ailRef = 0;
  let rudRef = 0;
  const L = (tuning: KeyAxisTuning): number => keyAuthority(s.ias, tuning);
  /** Bank toward a target: aileron for a roll rate proportional to the bank error. */
  const flyBank = (target: number): void => {
    const La = L(AXES.aileron);
    const err = target - s.roll;
    ailRef = clamp(ailRef + G.rki * err * DECIDE, -0.1, 0.1);
    const want = ailRef + clamp(La * (G.rkp * err - G.rkd * s.angularVelocity.x), -G.rcap * La, G.rcap * La);
    moveTo(keys.left, keys.right, c.aileron, want, AXES.aileron, G.da);
  };
  /** Pitch toward a target attitude: elevator from the attitude error and pitch rate. */
  const flyPitch = (target: number, gain = 1): void => {
    const Le = L(AXES.elevator);
    const err = target - s.pitch;
    elevRef = clamp(elevRef + Le * G.ki * gain * err * DECIDE, -0.5, 0.6);
    const want = elevRef + Le * clamp(gain * (G.kp * err - G.kd * s.angularVelocity.y), -0.25, 0.3);
    moveTo(keys.fwd, keys.back, c.elevator, want, AXES.elevator, G.de);
  };
  /** Rudder: on the ground track a heading, in the air keep the ball centred. */
  const steer = (heading: number): void => {
    const Lr = L(AXES.rudder);
    const err = wrapPi(heading - s.heading);
    rudRef = clamp(rudRef + 0.5 * err * DECIDE, -0.4, 0.4);
    const want = rudRef + clamp(Lr * (2 * err - 1.2 * s.angularVelocity.z), -0.5, 0.5);
    moveTo(keys.rudL, keys.rudR, c.rudder, want, AXES.rudder, 0.01);
  };
  const ball = (): void => {
    rudRef = clamp(rudRef + 0.06 * s.slipBall * DECIDE, -0.3, 0.3);
    moveTo(keys.rudL, keys.rudR, c.rudder, rudRef + 0.12 * s.slipBall, AXES.rudder, 0.02);
  };
  /** Trim away a steady yoke force: a tap every ~1.5 s while the average yoke is held off centre. */
  const trim = (): void => {
    if (t - lastTrimAt < 1.5) return;
    if (elevAvg > 0.03) {
      keys.trimUp.press(t, elevAvg > 0.12 ? 0.25 : MIN_PRESS);
      lastTrimAt = t;
    } else if (elevAvg < -0.03) {
      keys.trimDn.press(t, elevAvg < -0.12 ? 0.25 : MIN_PRESS);
      lastTrimAt = t;
    }
  };
  /** Heading converging onto a line parallel to the runway at `offset` (m, + = right of 07), flown on `course`. */
  const trackCourse = (course: number, offset: number, gain = 250): number => {
    const rc = runwayCoords(s.position.x, s.position.y);
    const dir = Math.cos(course - RWY.heading) > 0 ? 1 : -1;
    return course - Math.atan2((rc.across - offset) * dir, gain) * 0.9;
  };
  const bankForHeading = (hdg: number, maxBank = 22 * DEG): number => clamp(wrapPi(hdg - s.track) * 1.6, -maxBank, maxBank);
  /** Throttle toward a target power (rpm on the Cessna 172S) with taps. */
  const rpmTo = (rpm: number): void => {
    const e = rpm - T.power(s);
    if (e > T.powerBand) keys.thrUp.press(t, MIN_PRESS);
    else if (e < -T.powerBand) keys.thrDn.press(t, MIN_PRESS);
  };
  /** Pitch attitude for an airspeed: nose up when fast. */
  let speedPitch = 0;
  const pitchForSpeed = (kias: number, basePitch: number): number => {
    const e = s.ias / KT - kias;
    speedPitch = clamp(speedPitch + e * G.si * DEG * DECIDE * 10, -6 * DEG, 6 * DEG);
    return basePitch + clamp(e * 0.35 * DEG, -5 * DEG, 5 * DEG) + speedPitch;
  };

  const heading07 = RWY.heading;
  const heading25 = wrapPi(RWY.heading + Math.PI);

  const tick = (now: number): void => {
    const dt = Math.max(0, now - lastTick);
    t = lastTick = now;
    for (const key of all) key.tick(t);
    const rc = runwayCoords(s.position.x, s.position.y);
    const agl = s.altitudeMSL - FIELD - restHeight;
    const kias = s.ias / KT;
    elevAvg += (c.elevator - elevAvg) * Math.min(1, dt / 3);

    if (t >= nextDecision) {
      nextDecision = t + DECIDE;
      switch (phase) {
        case 'takeoffRoll': {
          if (t > 0.3 && c.throttle < 1) keys.full.press(t, 0.1);
          // Centreline with the rudder (the first press takes the pedals from the auto-rudder).
          steer(heading07 - Math.atan2(rc.across, 80));
          flyBank(0);
          // Rotate just after the C172S POH normal take-off speed ("lift nose wheel at 55 KIAS"): the keyboard
          // brings the nose up slowly, and the aircraft flies off at ~61 KIAS. Rotating at 53 lifted off at ~57
          // KIAS, and the push that checks this pilot's ~9 deg/s rotation then lowered the nose to ~6 deg, too
          // little angle of attack at that speed: the wheels touched again a second later. At 55 the same happened
          // once the propeller absorbed its proper power (static thrust 4 % lower, a slower roll): 57 gives margin.
          if (kias > T.rotateKias) setPhase('rotate');
          break;
        }
        case 'rotate':
          steer(heading07 - Math.atan2(rc.across, 80));
          flyPitch(T.rotatePitchDeg * DEG);
          flyBank(0);
          if (agl > 15) setPhase('climb');
          break;
        case 'climb':
        case 'crosswind':
        case 'downwind':
        case 'base': {
          ball();
          let hdg: number;
          let alt = PATTERN;
          let kiasT = T.climbKias;
          if (phase === 'climb') {
            hdg = trackCourse(heading07, 0);
            if (agl > 150 && rc.along > HALF + 300) setPhase('crosswind');
          } else if (phase === 'crosswind') {
            hdg = wrapPi(heading07 - Math.PI / 2);
            // Start the turn onto downwind 200 m before the 900 m line: the 90 deg turn at up to 22 deg of bank
            // and 75-90 KIAS has a radius of ~400-550 m, and starting it at 780 m swung the aircraft ~500 m wide of
            // the line before it tracked back (the classified downwind then averaged ~0.535 NM out, not 0.49).
            if (rc.across < -700) setPhase('downwind');
          } else if (phase === 'downwind') {
            hdg = trackCourse(heading25, -900);
            kiasT = T.downwindKias;
            if (rc.along < -HALF + 100) {
              // Abeam the threshold: power back, first flaps, start down.
              if (flapsShortOf(1)) keys.flapsDn.press(t, 0.1);
              kiasT = T.climbKias;
              alt = PATTERN - 250 * FT;
            }
            if (rc.along < -HALF - (T.baseTurnM ?? 1300)) setPhase('base');
          } else {
            hdg = wrapPi(heading07 + Math.PI / 2);
            alt = FIELD + (T.baseFt ?? 450) * FT;
            kiasT = T.baseKias;
            if (flapsShortOf(2)) keys.flapsDn.press(t, 0.1);
            if (rc.across > -300) setPhase('final');
          }
          flyBank(bankForHeading(hdg));
          const climbing = phase === 'climb' || (phase === 'crosswind' && s.altitudeMSL < alt - 30);
          if (climbing) {
            // Full power, pitch for Vy.
            flyPitch(pitchForSpeed(kiasT, T.climbPitchDeg * DEG));
          } else {
            // Level off / hold altitude with pitch, speed with power.
            const altErr = alt - s.altitudeMSL;
            const vsWant = clamp(altErr * 0.08, phase === 'base' ? -3.5 : -2.5, 2.5);
            const pitchWant = clamp(T.levelPitchDeg * DEG + (vsWant - s.verticalSpeed) * 1.2 * DEG + (phase === 'base' ? -2 * DEG : 0), -8 * DEG, 10 * DEG);
            flyPitch(pitchWant);
            const rpmBase = phase === 'base' ? T.powerBase : kiasT >= T.downwindKias ? T.powerDownwind : T.powerPattern;
            rpmTo(rpmBase + (kiasT - kias) * T.powerPerKt);
          }
          if (phase === 'downwind') {
            dwAlt[0] = Math.min(dwAlt[0], (s.altitudeMSL - PATTERN) / FT);
            dwAlt[1] = Math.max(dwAlt[1], (s.altitudeMSL - PATTERN) / FT);
          }
          trim();
          break;
        }
        case 'final': {
          ball();
          if (flapsShortOf(Infinity) && rc.along > -HALF - 1500) keys.flapsDn.press(t, 0.1);
          flyBank(bankForHeading(trackCourse(heading07, 0, 200), 15 * DEG));
          // Glide path to the aim point 150 m past the threshold: power for the path, pitch for 65 kt.
          const dist = -HALF + 250 - rc.along;
          const pathAlt = FIELD + Math.max(0, dist) * Math.tan(3 * DEG);
          const high = s.altitudeMSL - pathAlt;
          flyPitch(pitchForSpeed(T.finalKias, T.finalPitchDeg * DEG));
          rpmTo(clamp(T.powerFinal - high * T.powerPerMetre, T.powerMin, T.powerMax));
          trim();
          if (agl < (T.flareM ?? G.flare)) {
            setPhase('flare');
            flareStart = s.pitch;
          }
          break;
        }
        case 'flare': {
          flyBank(bankForHeading(trackCourse(heading07, 0, 150), (T.flareBankDeg ?? 5) * DEG));
          if (agl < (T.decrabM ?? Infinity)) steer(heading07 - Math.atan2(rc.across, 150));
          else ball();
          // Round out: arrest the sink progressively as the wheels near the runway (hold ~0.3 m/s at the end).
          // The power comes off only close to the runway: chopping it at the flare height pitches the nose down
          // (the slipstream over the tail goes) just as the round-out needs it up.
          if (agl < (T.throttleOffM ?? 3) && c.throttle > 0) keys.idle.press(t, 0.1);
          const vsWant = -clamp(agl * 0.22, 0.3, 2);
          // ...and raise the nose toward the landing attitude (~6 deg) as the height goes.
          const attitude = (1 - clamp(agl / 3, 0, 1)) * T.landingPitchDeg * DEG;
          const want = clamp(Math.max(s.pitch + (vsWant - s.verticalSpeed) * 3 * DEG, attitude), flareStart, 10 * DEG);
          flyPitch(want, 1.2);
          if (s.wheels[0].onGround) setPhase('rollout');
          break;
        }
        case 'rollout': {
          flyBank(0);
          keys.back.release();
          // Yoke back to centre (the nosewheel is down), then steer and brake.
          moveTo(keys.fwd, keys.back, c.elevator, 0, AXES.elevator, 0.02);
          steer(heading07 - Math.atan2(rc.across, 60));
          if (kias < T.brakeKias && s.wheels[0].onGround) keys.brakes.press(t, DECIDE + 0.02);
          if (s.groundSpeed < 0.2) {
            keys.brakes.release();
            keys.parking.press(t, 0.1);
            keys.centre.press(t, 0.1);
            stop = { along: rc.along, across: rc.across, t };
            setPhase('stopped');
          }
          break;
        }
        case 'stopped':
          break;
      }
      if (phase === 'takeoffRoll') takeoffMaxAcross = Math.max(takeoffMaxAcross, Math.abs(rc.across));
      log.push({
        phase,
        t: +t.toFixed(2),
        kias: +kias.toFixed(1),
        altAgl: +agl.toFixed(1),
        bank: +(s.roll * RAD).toFixed(1),
        pitch: +(s.pitch * RAD).toFixed(1),
        heading: +((((s.heading * RAD) % 360) + 360) % 360).toFixed(1),
        along: +rc.along.toFixed(0),
        across: +rc.across.toFixed(1),
        vs: +(s.verticalSpeed / 0.00508).toFixed(0),
        elevator: +c.elevator.toFixed(3),
        trim: +c.elevatorTrim.toFixed(3),
        throttle: +c.throttle.toFixed(2),
        rudder: +c.rudder.toFixed(3),
      });
    }
  };

  /** After a frame: statistics; true once the flight is over (stopped or crashed). */
  const observe = (): boolean => {
    if (!s.onGround) {
      maxBank = Math.max(maxBank, Math.abs(s.roll));
      maxG = Math.max(maxG, s.gLoad);
      minG = Math.min(minG, s.gLoad);
    }
    const over = s.crashed || phase === 'stopped';
    if (over) {
      for (const key of all) key.release();
      unsub();
    }
    return over;
  };

  const result = (end: number): CircuitResult => ({
    crashed: s.crashed,
    crashReason: s.crashReason,
    log,
    touchdown,
    stop,
    maxBank: maxBank * RAD,
    maxG,
    minG,
    takeoffMaxAcross,
    downwindAltErrFt: dwAlt,
    keyRate: counter.n / (end / 60),
    phaseTimes,
  });

  return {
    tick,
    observe,
    result,
    get phase() {
      return phase;
    },
    log,
  };
}
