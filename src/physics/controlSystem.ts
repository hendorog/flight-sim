// Cockpit controls to control-surface deflections: cable linkages, the elevator trim tab and the electric
// flap motor, built from a ControlSystemDef (by default the Cessna 172S's, aircraft/c172s/systems.ts).
//
// Primary controls are position commands (yoke, pedals) passed through the cable runs:
//  - Travel stops from the definition, with the ailerons rigged differentially (C172S: 20 deg up / 15 deg down).
//  - Cable stretch: the hinge moment, proportional to dynamic pressure times deflection, stretches the
//    cables, so the surface reaches deflection / (1 + q / q_stretch). With cable stiffness ~15 kN m/rad at
//    the surface and hinge-moment gradients of ~0.5 per rad this is a few percent at cruise and ~10 % near
//    Vne ("blow-back").
//  - A rate limit standing for the pilot's arm and the linkage inertia.
//
// Elevator: hands-off (stick-free) elevator with the yoke as an offset. A position-commanded yoke cannot
// show the stick forces of a real one, so the model takes the yoke position as the pilot's input RELATIVE to
// where the free elevator would float: yoke centred = hands off. The free elevator floats where its hinge
// moment, Ch_alpha alpha_t + Ch_delta delta_e + Ch_tab delta_tab, is zero:
//   delta_e = -(Ch_delta_tab / Ch_delta_e) delta_tab - (Ch_alpha / Ch_delta_e) alpha_t.
// - The trim tab: a nose-up tab (trailing edge down) floats the elevator trailing edge up. The C172
//   elevator is horn balanced, so Ch_delta_e is small and the tab float ratio is close to one.
// - The tailplane's angle of attack: air meeting the tail from below pushes the elevator trailing edge up.
//   This is what makes a trimmed aircraft return to its trimmed speed hands off (stick-free stability, neutral
//   point ~6-7 % MAC ahead of the stick-fixed one) and makes the elevator float up as the angle of attack rises
//   toward the stall. It fades out at very low dynamic pressure, where the elevator's weight and the pilot's
//   hand dominate.
//
// Rudder: the C172 rudder carries a ground-adjustable trim tab, bent by maintenance so the ball is centred
// in cruise with the feet off the pedals; it is modelled by the rudder offset it produces.
//
// Feet off on the ground: the pedals, the rudder and the nosewheel are one linkage (steering bungee), and the
// loaded nose tyre resists being steered far more than the rudder's hinge moment can push it. The float is
// therefore scaled by q / (q + restraintQ x nose load / refLoad): the rudder only floats freely once the
// nosewheel is light or off the ground. Without this restraint the airborne float, applied through the bungee to
// a loaded nosewheel, closes an anti-damping loop (yaw -> sideslip at the fin -> float -> steer -> more yaw)
// that ground-loops the aircraft in a few knots of crosswind.
//
// Flaps: an electric motor drives the flaps toward the lever position at its rate (C172S: 28 V, 3 deg/s, 0 to 30
// deg in ~10 s), only while the bus is above its minimum voltage; a hand lever ('manual') moves them at its rate
// with no bus.
//
// The other kinds of the definition:
// - Pitch trim 'antiServoTab' (stabilator): the tab is geared to the surface and its trim offset is the trim; the
//   surface floats at -floatRatio x offset + alphaFloat exactly as a tab-trimmed elevator does (floatRatio about
//   1 / gearing), so it shares the 'tab' law; SurfaceState.elevatorTrim is the offset.
// - Pitch trim 'spring' (no tab): the spring alone would hold the elevator at delta_s = trim x (springUp |
//   springDown); hands off it sits where the spring's moment and the air's balance,
//     (delta_s + (q / springQ) x alphaFloat) / (1 + q / springQ),
//   and the yoke is an offset from there. The trimmed position therefore drifts with speed more than on a tab
//   aircraft.
// - Cockpit rudder trim: a rudder offset of -authority x rudderTrim (nose right for + trim) beside the
//   ground-adjustable tab's; the trim lever moves at its rate. Rudder travel to the right may differ from the
//   travel to the left (maxRight): pedal -1 .. +1 maps each side to its own travel.
// - Steering link 'direct': as the bungee, with its own restraint; 'castering': the pedals are not linked to the
//   nosewheel, so nothing restrains a free rudder on the ground.

import { C172S_CONTROLS } from '../aircraft/c172s/systems';
import type { ControlSystemDef } from '../aircraft/types';
import { clamp } from '../core/math';
import type { ControlInputs, SurfaceState } from '../core/types';

// The Cessna 172S (aircraft/c172s/systems.ts, where each number is explained) under the names this module has
// always exported.
const C172S_TAB = C172S_CONTROLS.pitchTrim as Extract<ControlSystemDef['pitchTrim'], { kind: 'tab' }>;
const C172S_STEERING = C172S_CONTROLS.steering as Extract<ControlSystemDef['steering'], { kind: 'bungee' }>;
const C172S_FLAP_DRIVE = C172S_CONTROLS.flaps.drive as Extract<ControlSystemDef['flaps']['drive'], { kind: 'electric' }>;
/** Trim tab travel, trailing edge down (nose-up trim) and up (nose-down trim), rad. */
export const TRIM_TAB_DOWN = C172S_TAB.tabDown;
export const TRIM_TAB_UP = C172S_TAB.tabUp;
/** Elevator float per unit tab deflection (horn-balanced elevator). */
export const TRIM_FLOAT_RATIO = C172S_TAB.floatRatio;
/** Elevator float per unit tailplane angle of attack, -Ch_alpha / Ch_delta_e (trailing edge up for + alpha). */
export const ELEVATOR_ALPHA_FLOAT = C172S_CONTROLS.elevator.alphaFloat;
/** Tail angle of attack beyond which the hinge moment stops growing (tailplane stall), rad. */
export const FLOAT_ALPHA_LIMIT = C172S_CONTROLS.elevator.floatAlphaLimit;
/** Dynamic pressure at which the aerodynamic float is half developed, Pa. */
export const FLOAT_Q_HALF = C172S_CONTROLS.elevator.floatQHalf;
/** Rudder deflection set by the ground-adjustable tab (+ = trailing edge left), rad, and the aileron rigging as yoke input. */
export const RUDDER_TAB_OFFSET = C172S_CONTROLS.rudder.tabOffset;
export const AILERON_RIGGING = C172S_CONTROLS.aileron.rigging;
/** Free (feet-off) rudder: float per unit fin angle of attack, and the fin angle beyond which it stops growing, rad. */
export const RUDDER_ALPHA_FLOAT = C172S_CONTROLS.rudder.alphaFloat;
export const RUDDER_FLOAT_LIMIT = C172S_CONTROLS.rudder.floatLimit;
/** Feet off on the ground: the restraint of the loaded nose tyre (see the header). */
export const FEET_OFF_GROUND = { restraintQ: C172S_STEERING.restraintQ, refLoad: C172S_STEERING.refLoad };
/** Dynamic pressure at which cable stretch would halve the deflection, Pa. */
export const STRETCH_Q = C172S_CONTROLS.stretchQ;
/** Surface rate limit, rad/s. */
export const SURFACE_RATE = C172S_CONTROLS.surfaceRate;
/** Flap motor rate, rad/s, and the bus voltage it needs, V. */
export const FLAP_RATE = C172S_FLAP_DRIVE.rate;
export const FLAP_MIN_VOLTS = C172S_FLAP_DRIVE.minVolts;
export const TRIM_RATE = C172S_CONTROLS.trimRate;

/** The control law of one control system: travels, trim, float and rigging, without state. */
export class ControlLaw {
  private readonly elevatorUp: number;
  private readonly elevatorDown: number;
  private readonly tabDown: number;
  private readonly tabUp: number;
  private readonly floatRatio: number;
  /** Spring trim: the elevator datum at full nose-up trim (trailing edge up, < 0) and full nose-down (> 0), rad, and springQ, Pa. */
  private readonly spring: { noseUp: number; noseDown: number; q: number } | null;
  /** Rudder travel to the right, rad (maxRight, or the travel to the left). */
  private readonly rudderRight: number;
  /** The rudder's travel differs left and right, or it has a cockpit trim (the C172S has neither). */
  private readonly rudderExtras: boolean;

  constructor(readonly cfg: ControlSystemDef = C172S_CONTROLS) {
    const trim = cfg.pitchTrim;
    this.elevatorUp = cfg.elevator.maxUp;
    this.elevatorDown = cfg.elevator.maxDown;
    if (trim.kind === 'spring') {
      this.tabDown = this.tabUp = this.floatRatio = 0;
      this.spring = { noseUp: -Math.abs(trim.springUp), noseDown: Math.abs(trim.springDown), q: trim.springQ };
    } else {
      // 'tab' and 'antiServoTab' share the law (see the header).
      this.tabDown = trim.tabDown;
      this.tabUp = trim.tabUp;
      this.floatRatio = trim.floatRatio;
      this.spring = null;
    }
    const R = cfg.rudder;
    this.rudderRight = R.maxRight ?? R.maxDeflection;
    this.rudderExtras = R.maxRight !== undefined || R.trim !== undefined;
  }

  /** Elevator deflection (rad, + = trailing edge down) from the yoke alone (+ = back). */
  yokeDeflection(yoke: number): number {
    const e = clamp(yoke, -1, 1);
    return e > 0 ? -e * this.elevatorUp : -e * this.elevatorDown;
  }

  /** Trim tab deflection (rad, + = trailing edge down) for a trim input (+ = nose up); 0 on a spring-trimmed elevator. */
  trimTabDeflection(trim: number): number {
    const t = clamp(trim, -1, 1);
    return t > 0 ? t * this.tabDown : t * this.tabUp;
  }

  /** Spring trim: the elevator position the spring alone would hold for a trim input (+ = nose up), rad. */
  springDatum(trim: number): number {
    const t = clamp(trim, -1, 1);
    const sp = this.spring!;
    return t > 0 ? t * sp.noseUp : -t * sp.noseDown;
  }

  /** Spring trim: the trim input (+ = nose up) whose spring datum is `datum` (rad); inverse of springDatum. */
  springTrimFor(datum: number): number {
    const sp = this.spring!;
    return clamp(datum < 0 ? datum / sp.noseUp : -datum / sp.noseDown, -1, 1);
  }

  /** The elevator trim is a spring (no tab). */
  get springTrim(): boolean {
    return this.spring !== null;
  }

  /** Hands-off float of the elevator due to the tailplane angle of attack `tailAlpha` at dynamic pressure q, rad. */
  alphaFloat(tailAlpha: number, q: number): number {
    if (!Number.isFinite(tailAlpha)) return 0;
    const e = this.cfg.elevator;
    const a = clamp(tailAlpha, -e.floatAlphaLimit, e.floatAlphaLimit);
    // Fades out as the tail's flow turns broadside and reverses (tail slides): cos^2 alpha_t.
    const c = Math.cos(tailAlpha);
    const qq = Math.max(q, 0);
    return c > 0 ? (-e.alphaFloat * a * c * c * qq) / (qq + e.floatQHalf) : 0;
  }

  /**
   * Feet-off float of the rudder for a fin angle of attack `finAlpha` (flow from the left positive) at dynamic
   * pressure q, rad (+ = trailing edge left): the free rudder trails downstream. Same fading as alphaFloat.
   */
  rudderFloat(finAlpha: number, q: number): number {
    if (!Number.isFinite(finAlpha)) return 0;
    const r = this.cfg.rudder;
    const a = clamp(finAlpha, -r.floatLimit, r.floatLimit);
    const c = Math.cos(finAlpha);
    const qq = Math.max(q, 0);
    return c > 0 ? (-r.alphaFloat * a * c * c * qq) / (qq + this.cfg.elevator.floatQHalf) : 0;
  }

  /**
   * Split an elevator deflection command (before cable stretch) into a trim-wheel setting that floats the
   * elevator there hands-off, plus whatever yoke is still needed if the trim runs out of travel. `float` is
   * the part of the hands-off position set by the tail's angle of attack (alphaFloat); leave it 0 when the
   * result only has to round-trip through surfaceTargets with the same value. `q` (Pa) matters only to a spring
   * trim, whose hands-off position depends on it.
   */
  pitchControlsFor(deflection: number, float = 0, q = 0): { elevatorTrim: number; elevator: number } {
    if (this.spring) return this.springControlsFor(deflection, float, q);
    const tab = -(deflection - float) / this.floatRatio;
    const trim = clamp(tab > 0 ? tab / this.tabDown : tab / this.tabUp, -1, 1);
    const rest = deflection - float + this.floatRatio * this.trimTabDeflection(trim);
    const elevator = clamp(rest < 0 ? -rest / this.elevatorUp : -rest / this.elevatorDown, -1, 1);
    return { elevatorTrim: trim, elevator };
  }

  /** pitchControlsFor() of a spring trim: delta_s = deflection (1 + q / springQ) - (q / springQ) float. */
  private springControlsFor(deflection: number, float: number, q: number): { elevatorTrim: number; elevator: number } {
    const sp = this.spring!;
    const k = Math.max(q, 0) / sp.q;
    const datum = deflection * (1 + k) - k * float;
    const trim = clamp(datum < 0 ? datum / sp.noseUp : -datum / sp.noseDown, -1, 1);
    const rest = deflection - (this.springDatum(trim) + k * float) / (1 + k);
    const elevator = clamp(rest < 0 ? -rest / this.elevatorUp : -rest / this.elevatorDown, -1, 1);
    return { elevatorTrim: trim, elevator };
  }

  /**
   * Target deflections for a set of controls at dynamic pressure q (Pa). Flaps are the lever target.
   * `float` is the elevator's hands-off float from the tail angle of attack (alphaFloat). `rudderTrim`: the
   * position of the rudder-trim lever (the ControlSystem moves it at its rate; default the control itself).
   * `pitchTrim`: the spring trim's actual position (the ControlSystem moves it at its rate; default the control).
   */
  surfaceTargets(
    c: ControlInputs,
    q: number,
    out: SurfaceState,
    float = 0,
    rudderFree: number | null = null,
    rudderTrim = c.rudderTrim,
    pitchTrim = c.elevatorTrim,
  ): SurfaceState {
    const cfg = this.cfg;
    if (this.spring) {
      const k = Math.max(q, 0) / this.spring.q;
      const handsOff = (this.springDatum(pitchTrim) + k * float) / (1 + k);
      const elevator = clamp(this.yokeDeflection(c.elevator) + handsOff, -this.elevatorUp, this.elevatorDown);
      out.elevator = elevator / (1 + q / cfg.stretchQ.elevator);
      out.elevatorTrim = 0;
    } else {
      const tab = this.trimTabDeflection(c.elevatorTrim);
      const elevator = clamp(this.yokeDeflection(c.elevator) - this.floatRatio * tab + float, -this.elevatorUp, this.elevatorDown);
      out.elevator = elevator / (1 + q / cfg.stretchQ.elevator);
      out.elevatorTrim = tab;
    }
    // Roll right: left aileron trailing edge down, right one up.
    const A = cfg.aileron;
    const a = clamp(c.aileron + A.rigging, -1, 1);
    const stretchA = 1 + q / cfg.stretchQ.aileron;
    out.aileronLeft = (a > 0 ? a * A.maxDown : a * A.maxUp) / stretchA;
    out.aileronRight = (a > 0 ? -a * A.maxUp : -a * A.maxDown) / stretchA;
    // Right pedal: rudder trailing edge right, which is negative in SurfaceState. A free rudder (rudderFree = its
    // float, rad) ignores the pedal input.
    const R = cfg.rudder;
    if (this.rudderExtras) {
      const r = clamp(c.rudder, -1, 1);
      const pedal = rudderFree === null ? (r > 0 ? -r * this.rudderRight : -r * R.maxDeflection) : rudderFree;
      out.rudder = clamp(this.rudderOffset(rudderTrim) + pedal, -this.rudderRight, R.maxDeflection) / (1 + q / cfg.stretchQ.rudder);
      out.rudderTrim = this.rudderTrimTab(rudderTrim);
    } else {
      const pedal = rudderFree === null ? -clamp(c.rudder, -1, 1) * R.maxDeflection : rudderFree;
      out.rudder = clamp(R.tabOffset + pedal, -R.maxDeflection, R.maxDeflection) / (1 + q / cfg.stretchQ.rudder);
      out.rudderTrim = 0;
    }
    out.flaps = clamp(c.flaps, 0, 1) * cfg.flaps.maxDeflection;
    return out;
  }

  /** Rudder deflection with the pedals neutral: the ground-adjustable tab's, less the cockpit trim's (+ trim = nose right), rad. */
  rudderOffset(rudderTrim: number): number {
    const R = this.cfg.rudder;
    return R.trim ? R.tabOffset - R.trim.authority * clamp(rudderTrim, -1, 1) : R.tabOffset;
  }

  /** Rudder-trim tab angle shown for a trim lever position (SurfaceState.rudderTrim, + = tab trailing edge left), rad. */
  rudderTrimTab(rudderTrim: number): number {
    const T = this.cfg.rudder.trim;
    if (!T) return 0;
    const t = clamp(rudderTrim, -1, 1);
    return t > 0 ? t * T.tabDeflection : t * (T.tabDeflectionLeft ?? T.tabDeflection);
  }

  /** Pedal position (-1 .. 1) that commands a rudder deflection before cable stretch with the trim lever at `rudderTrim`. */
  pedalFor(rudder: number, rudderTrim: number): number {
    const p = -(rudder - this.rudderOffset(rudderTrim));
    return clamp(p > 0 ? p / this.rudderRight : p / this.cfg.rudder.maxDeflection, -1, 1);
  }
}

/** One law per definition object, for the free functions below. */
const LAWS = new WeakMap<ControlSystemDef, ControlLaw>();
function lawFor(cfg: ControlSystemDef): ControlLaw {
  let law = LAWS.get(cfg);
  if (!law) LAWS.set(cfg, (law = new ControlLaw(cfg)));
  return law;
}

/** Trim tab deflection (rad, + = trailing edge down) for a trim input (+ = nose up). */
export function trimTabDeflection(trim: number, cfg: ControlSystemDef = C172S_CONTROLS): number {
  return lawFor(cfg).trimTabDeflection(trim);
}

/** Hands-off float of the elevator due to the tailplane angle of attack `tailAlpha` at dynamic pressure q, rad. */
export function alphaFloat(tailAlpha: number, q: number, cfg: ControlSystemDef = C172S_CONTROLS): number {
  return lawFor(cfg).alphaFloat(tailAlpha, q);
}

/** Feet-off float of the rudder (see ControlLaw.rudderFloat), rad. */
export function rudderFloat(finAlpha: number, q: number, cfg: ControlSystemDef = C172S_CONTROLS): number {
  return lawFor(cfg).rudderFloat(finAlpha, q);
}

/** Trim wheel and yoke that float the elevator at `deflection` (see ControlLaw.pitchControlsFor; `q` for a spring trim). */
export function pitchControlsFor(deflection: number, float = 0, cfg: ControlSystemDef = C172S_CONTROLS, q = 0): { elevatorTrim: number; elevator: number } {
  return lawFor(cfg).pitchControlsFor(deflection, float, q);
}

/** Target deflections for a set of controls at dynamic pressure q (see ControlLaw.surfaceTargets). */
export function surfaceTargets(
  c: ControlInputs,
  q: number,
  out: SurfaceState,
  float = 0,
  rudderFree: number | null = null,
  cfg: ControlSystemDef = C172S_CONTROLS,
): SurfaceState {
  return lawFor(cfg).surfaceTargets(c, q, out, float, rudderFree);
}

const approach = (value: number, target: number, maxStep: number): number =>
  value + clamp(target - value, -maxStep, maxStep);

export class ControlSystem {
  /** Actual surface deflections. */
  readonly surfaces: SurfaceState = { elevator: 0, aileronLeft: 0, aileronRight: 0, rudder: 0, flaps: 0, elevatorTrim: 0, rudderTrim: 0 };
  private readonly target: SurfaceState = { elevator: 0, aileronLeft: 0, aileronRight: 0, rudder: 0, flaps: 0, elevatorTrim: 0, rudderTrim: 0 };
  /** The control law of the definition. */
  readonly law: ControlLaw;
  /** Mean geometric angle of attack of the tailplane (set by the flight model from the aerodynamics), rad. */
  tailAlpha = 0;
  /** Mean geometric angle of attack of the fin (flow from the left positive; set by the flight model), rad. */
  finAlpha = 0;
  /**
   * Feet off the pedals: the rudder floats with the fin's local flow (sideslip, slipstream swirl) and the
   * pedals, and through the steering bungee the nosewheel, follow it (see pedalPosition). For users without
   * rudder pedals or a rudder axis, whose rudder input is then really "feet off"; with pedals (or a held
   * rudder key) leave it false and the pedal position commands the rudder.
   */
  rudderFree = false;
  /** Pedal position (-1..1, + = right) that corresponds to the current rudder: the input, or the floated rudder's. */
  pedalPosition = 0;
  /** Vertical load on the nose tyre, N (set by the flight model; restrains a free rudder on the ground). */
  noseLoad = 0;
  /**
   * Local dynamic pressure at the fin, Pa (set by the flight model; NaN = use the free stream's). The rudder's
   * hinge moment is set by the air it sits in: on the take-off roll that is mostly the propeller's slipstream.
   */
  finDynamicPressure = NaN;
  /** Rudder-trim lever position, -1 .. 1 (moves toward the control at the trim's rate; 0 without cockpit rudder trim). */
  rudderTrim = 0;
  /**
   * Spring trim only: the trim's actual position, -1 .. 1 (+ = nose up). Its spring datum moves toward the
   * control's at trimRate (rad of datum per second), and an electric trim (trimDrive) only above minVolts.
   * Equal to controls.elevatorTrim after setImmediate; unused (0) with a trim tab, whose rate acts on the tab.
   */
  pitchTrim = 0;
  /** Restraint of a free rudder by the loaded nose tyre; null for a castering nosewheel (no linkage). */
  private readonly steering: { restraintQ: number; refLoad: number } | null;
  private readonly flapRate: number;
  /** The flap motor runs only above this bus voltage; -Infinity for a hand lever. */
  private readonly flapMinVolts: number;
  /** The pitch trim moves only above this bus voltage (an electric trim); undefined for a trim wheel. */
  private readonly trimMinVolts: number | undefined;

  constructor(readonly cfg: ControlSystemDef = C172S_CONTROLS) {
    this.law = new ControlLaw(cfg);
    const steering = cfg.steering;
    this.steering = steering.kind === 'castering' ? null : steering;
    const drive = cfg.flaps.drive;
    this.flapRate = drive.rate;
    this.flapMinVolts = drive.kind === 'electric' ? drive.minVolts : -Infinity;
    this.trimMinVolts = cfg.trimDrive?.minVolts;
  }

  /** The free rudder's float target, rad, restrained by the loaded nosewheel on the ground. */
  private freeFloat(freeStreamQ: number): number | null {
    if (!this.rudderFree) return null;
    const q = Number.isFinite(this.finDynamicPressure) ? this.finDynamicPressure : freeStreamQ;
    const qq = Math.max(q, 0);
    const restraint = this.steering ? (this.steering.restraintQ * Math.max(0, this.noseLoad)) / this.steering.refLoad : 0;
    return this.law.rudderFloat(this.finAlpha, q) * (qq + restraint > 0 ? qq / (qq + restraint) : 0);
  }

  /** Move the surfaces toward the commanded positions over dt. */
  update(dt: number, controls: ControlInputs, q: number, busVoltage: number): void {
    const cfg = this.cfg;
    const law = this.law;
    const R = cfg.rudder;
    if (R.trim) this.rudderTrim = approach(this.rudderTrim, clamp(controls.rudderTrim, -1, 1), R.trim.rate * dt);
    if (law.springTrim && (this.trimMinVolts === undefined || busVoltage > this.trimMinVolts)) {
      const datum = approach(law.springDatum(this.pitchTrim), law.springDatum(controls.elevatorTrim), cfg.trimRate * dt);
      this.pitchTrim = law.springTrimFor(datum);
    }
    const pitchTrim = law.springTrim ? this.pitchTrim : controls.elevatorTrim;
    const t = law.surfaceTargets(controls, q, this.target, law.alphaFloat(this.tailAlpha, q), this.freeFloat(q), this.rudderTrim, pitchTrim);
    const s = this.surfaces;
    const step = cfg.surfaceRate * dt;
    s.elevator = approach(s.elevator, t.elevator, step);
    s.aileronLeft = approach(s.aileronLeft, t.aileronLeft, step);
    s.aileronRight = approach(s.aileronRight, t.aileronRight, step);
    s.rudder = approach(s.rudder, t.rudder, step);
    if (this.trimMinVolts === undefined || busVoltage > this.trimMinVolts) s.elevatorTrim = approach(s.elevatorTrim, t.elevatorTrim, cfg.trimRate * dt);
    if (busVoltage > this.flapMinVolts) s.flaps = approach(s.flaps, t.flaps, this.flapRate * dt);
    if (R.trim) s.rudderTrim = t.rudderTrim;
    if (!this.rudderFree) this.pedalPosition = clamp(controls.rudder, -1, 1);
    else if (R.trim || R.maxRight !== undefined) this.pedalPosition = law.pedalFor(s.rudder * (1 + q / cfg.stretchQ.rudder), this.rudderTrim);
    else this.pedalPosition = clamp(-((s.rudder * (1 + q / cfg.stretchQ.rudder) - R.tabOffset) / R.maxDeflection), -1, 1);
  }

  /** Put every surface at its commanded position at once (for resets and trim). */
  setImmediate(controls: ControlInputs, q: number): void {
    const law = this.law;
    this.rudderTrim = this.cfg.rudder.trim ? clamp(controls.rudderTrim, -1, 1) : 0;
    this.pitchTrim = law.springTrim ? clamp(controls.elevatorTrim, -1, 1) : 0;
    Object.assign(this.surfaces, law.surfaceTargets(controls, q, this.target, law.alphaFloat(this.tailAlpha, q), this.freeFloat(q), this.rudderTrim));
    this.pedalPosition = clamp(controls.rudder, -1, 1);
  }
}
