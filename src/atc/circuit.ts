// An AI light aircraft flying circuits (docs/atc.md, step 3): the circuit as a pure function of the field and the
// runway end in use, and a kinematic stepper that flies it. No aerodynamics: the aircraft holds each leg's speed and
// height, banks into the turns at a limited roll rate (the heading follows the bank, as in a co-ordinated turn) and
// tracks each leg with a cross-track correction, so it rolls out on the centreline. Every circuit ends in a touch
// and go. Pure and three.js-free: the traffic subsystem poses a mesh from the state; tests fly it in node.

import type { Airfield } from '../world/airfields';
import { fieldPoint } from '../world/airfields';
import { activeFrame, type RunwayEnd } from './calls';

const DEG = Math.PI / 180;
const FT = 0.3048;
const KT = 0.514444;
const G = 9.80665;

export type LegId = 'upwind' | 'crosswind' | 'downwind' | 'base' | 'final';

export interface CircuitLeg {
  id: LegId;
  /** Start and end of the leg's track in the active runway's frame (along the take-off direction, across + right), m. */
  from: { along: number; across: number };
  to: { along: number; across: number };
  /** Height above the field to hold, m (final follows the glide path instead). */
  height: number;
  /** Indicated airspeed to hold, m/s. */
  speed: number;
}

export interface CircuitPath {
  field: Airfield;
  end: RunwayEnd;
  legs: CircuitLeg[];
  /** Touchdown aim point, m along the active frame. */
  aim: number;
  /** How much farther downwind than usual base is turned (following traffic ahead), m. */
  extension: number;
}

/** Circuit height above the field, m. */
export const CIRCUIT_HEIGHT = 1000 * FT;
/** Downwind is flown this far out from the centreline, m. */
const DOWNWIND_OFFSET = 1000;
/** The final approach slope, rad, and the aim point past the threshold, m: the scripted pilot's (sim/scenarios.ts GLIDE_PATH, AIM_POINT). */
const GLIDE = 3 * DEG;
const AIM = 150;
/** Final is turned onto this far before the threshold, m: about 1.5 NM, near 500 ft on the glide path. */
const FINAL_LENGTH = 2600;
/** Bank in the circuit turns, rad. */
const TURN_BANK = 25 * DEG;
const ROLL_RATE = 15 * DEG;
const CLIMB = 700 * 0.00508;
const DESCENT = 500 * 0.00508;
/** Descent on base, to arrive at the final turn near the glide path, m/s. */
const BASE_DESCENT = 700 * 0.00508;
/** The roll after a touchdown before full power is put on again (flaps up, carb heat cold), s. */
const ROLL_HOLD = 5;
const ROTATE = 55 * KT;
/** Below this height on final the aircraft flares, m. */
const FLARE = 6;

/**
 * The circuit for a field and runway end: upwind, crosswind, downwind, base and final on the field's circuit side.
 * An extension (following traffic ahead) moves base that much farther out, flown higher to stay near the glide path.
 */
export function circuitPath(field: Airfield, end: RunwayEnd, extension = 0): CircuitPath {
  const thr = -field.length / 2;
  const side = field.circuit === 'left' ? -1 : 1;
  const out = side * DOWNWIND_OFFSET;
  const turnUp = Math.max(field.length / 2 + 400, thr + 1800);
  const turnBase = thr - FINAL_LENGTH - extension;
  const baseHeight = Math.min(CIRCUIT_HEIGHT, Math.max(500 * FT, (thr + AIM - turnBase) * Math.tan(GLIDE)));
  const p = (along: number, across: number) => ({ along, across });
  return {
    field,
    end,
    aim: thr + AIM,
    extension,
    legs: [
      { id: 'upwind', from: p(thr, 0), to: p(turnUp, 0), height: CIRCUIT_HEIGHT, speed: 70 * KT },
      { id: 'crosswind', from: p(turnUp, 0), to: p(turnUp, out), height: CIRCUIT_HEIGHT, speed: 75 * KT },
      { id: 'downwind', from: p(turnUp, out), to: p(turnBase, out), height: CIRCUIT_HEIGHT, speed: 90 * KT },
      { id: 'base', from: p(turnBase, out), to: p(turnBase, 0), height: baseHeight, speed: 70 * KT },
      { id: 'final', from: p(turnBase, 0), to: p(thr + AIM, 0), height: 0, speed: 65 * KT },
    ],
  };
}

/** A circuit aircraft's state. Heights are above the field; heading true, rad. */
export interface TrafficState {
  north: number;
  east: number;
  height: number;
  heading: number;
  bank: number;
  pitch: number;
  /** Indicated airspeed, m/s (no wind correction: the air mass is taken as still). */
  speed: number;
  verticalSpeed: number;
  leg: number;
  onGround: boolean;
  /** Time on the ground since the touchdown, s. */
  rollTime: number;
}

/** Leg bearing in the active frame turned to a true heading. */
export function legHeading(path: CircuitPath, leg: CircuitLeg): number {
  const base = path.field.heading + (path.end === 1 ? Math.PI : 0);
  const da = leg.to.along - leg.from.along;
  const dc = leg.to.across - leg.from.across;
  return base + Math.atan2(dc, da);
}

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/** A point of the circuit, in NED. */
export function pathPoint(path: CircuitPath, along: number, across: number): { north: number; east: number } {
  return path.end === 0 ? fieldPoint(path.field, along, across) : fieldPoint(path.field, -along, -across);
}

/** An aircraft placed on a leg at a fraction of its length, at that leg's speed and height. */
export function placeOnLeg(path: CircuitPath, leg: number, fraction: number): TrafficState {
  const l = path.legs[leg];
  const p = pathPoint(path, l.from.along + (l.to.along - l.from.along) * fraction, l.from.across + (l.to.across - l.from.across) * fraction);
  // On final, on the glide path to the aim point.
  const along = l.from.along + (l.to.along - l.from.along) * fraction;
  const height = l.id === 'final' ? Math.max(15, (path.aim - along) * Math.tan(GLIDE)) : l.height;
  return { ...p, height, heading: legHeading(path, l), bank: 0, pitch: 0, speed: l.speed, verticalSpeed: 0, leg, onGround: false, rollTime: 0 };
}

/** Where the aircraft is along and across the current leg: distance to go and cross-track (+ right of track), m. */
function legProgress(path: CircuitPath, s: TrafficState): { toGo: number; cross: number; length: number } {
  return legPosition(path, s.leg, s.north, s.east);
}

/** A position against a leg of the circuit: distance to go to its end and cross-track (+ right of track), m. */
export function legPosition(path: CircuitPath, leg: number, north: number, east: number): { toGo: number; cross: number; length: number } {
  const l = path.legs[leg];
  const { along, across } = activeFrame(path.field, path.end, north, east);
  const da = l.to.along - l.from.along;
  const dc = l.to.across - l.from.across;
  const len = Math.hypot(da, dc);
  const ua = da / len, uc = dc / len;
  const ra = along - l.from.along, rc = across - l.from.across;
  const done = ra * ua + rc * uc;
  return { toGo: len - done, cross: ra * -uc + rc * ua, length: len };
}

/**
 * The distance still to fly to the touchdown aim point from a position on a leg, m: what is left of that leg and
 * the legs after it (upwind and crosswind count the whole downwind, base and final still to come).
 */
export function circuitRemaining(path: CircuitPath, leg: number, north: number, east: number): number {
  let d = Math.max(0, legPosition(path, leg, north, east).toGo);
  for (let i = leg + 1; i < path.legs.length; i++) {
    const l = path.legs[i];
    d += Math.hypot(l.to.along - l.from.along, l.to.across - l.from.across);
  }
  return d;
}

/** The leg's guidance: the heading to fly, with the cross-track correction (at most 45 degrees of intercept). */
function desiredHeading(path: CircuitPath, s: TrafficState, cross: number): number {
  return legTrack(path, s.leg, cross);
}

/** The track to fly on a leg from this cross-track error (+ right of it), rad: the leg's, plus up to 45 degrees of intercept. */
export function legTrack(path: CircuitPath, leg: number, cross: number): number {
  return legHeading(path, path.legs[leg]) - Math.min(45 * DEG, Math.max(-45 * DEG, Math.atan(cross / 200)));
}

/** The distance before a leg's end at which the turn onto the next begins, at this speed, m. */
export function turnLead(speed: number): number {
  // (A quarter more than the turn's radius for the roll-in and the speed change on the new leg.)
  return (1.25 * speed * speed) / (G * Math.tan(TURN_BANK));
}

/** Pitch attitude from the flight path and an angle of attack that grows as the speed falls, rad. */
function attitude(speed: number, verticalSpeed: number): number {
  const gamma = Math.atan2(verticalSpeed, Math.max(speed, 1));
  return gamma + (1 + 3 * ((60 * KT) / Math.max(speed, 20 * KT)) ** 2 - 1.5) * DEG;
}

/**
 * Fly the circuit for dt seconds. Returns the leg index the aircraft moved onto, if it changed (a touchdown starts
 * the upwind leg again, on the ground). Steps of at most 0.1 s are taken internally.
 */
export function stepTraffic(path: CircuitPath, s: TrafficState, dt: number): number | null {
  let changed: number | null = null;
  for (let left = dt; left > 1e-9; ) {
    const h = Math.min(0.1, left);
    left -= h;
    const c = stepOnce(path, s, h);
    if (c !== null) changed = c;
  }
  return changed;
}

function stepOnce(path: CircuitPath, s: TrafficState, dt: number): number | null {
  const leg = path.legs[s.leg];
  let changed: number | null = null;
  const prog = legProgress(path, s);

  if (s.onGround) {
    // The touch and go: roll on, flaps up and full power, rotate at 55 kt.
    s.rollTime += dt;
    s.speed = s.rollTime < ROLL_HOLD ? Math.max(45 * KT, s.speed - 1.5 * dt) : s.speed + 1.8 * dt;
    s.bank = 0;
    s.heading = desiredHeading(path, s, prog.cross);
    s.verticalSpeed = 0;
    s.height = 0;
    s.pitch = s.speed > ROTATE - 3 * KT ? Math.min(8 * DEG, s.pitch + 4 * DEG * dt) : 0;
    if (s.rollTime > ROLL_HOLD && s.speed >= ROTATE) {
      s.onGround = false;
      s.verticalSpeed = 1;
    }
  } else {
    // The next leg once the turn onto it would take up the distance left (its radius at the turn bank).
    const radius = turnLead(s.speed);
    if (leg.id !== 'final' && prog.toGo < radius) {
      s.leg = (s.leg + 1) % path.legs.length;
      changed = s.leg;
    }
    const now = path.legs[s.leg];
    const p = changed === null ? prog : legProgress(path, s);
    // Bank toward the heading error, rolled at a limited rate; the heading follows the bank.
    const err = wrap(desiredHeading(path, s, p.cross) - s.heading);
    const bankCmd = Math.max(-TURN_BANK, Math.min(TURN_BANK, err * 1.2));
    s.bank += Math.max(-ROLL_RATE * dt, Math.min(ROLL_RATE * dt, bankCmd - s.bank));
    s.heading = wrap(s.heading + ((G * Math.tan(s.bank)) / Math.max(s.speed, 10)) * dt);
    // The power comes off in the flare and the speed bleeds away to the touchdown.
    if (now.id === 'final' && s.height < FLARE) s.speed = Math.max(48 * KT, s.speed - 1.2 * dt);
    else s.speed += Math.max(-1 * dt, Math.min(1 * dt, now.speed - s.speed));
    let vsCmd: number;
    if (now.id === 'final') {
      // The glide path to the aim point, then the flare.
      const toAim = Math.max(0, p.toGo);
      const onSlope = toAim * Math.tan(GLIDE);
      vsCmd = s.height < FLARE ? -0.3 - s.height * 0.08 : -s.speed * Math.tan(GLIDE) + (onSlope - s.height) * 0.15;
      vsCmd = Math.max(-BASE_DESCENT, Math.min(2, vsCmd));
    } else {
      vsCmd = Math.max(now.id === 'base' ? -BASE_DESCENT : -DESCENT, Math.min(CLIMB, (now.height - s.height) * 0.1));
    }
    s.verticalSpeed += (vsCmd - s.verticalSpeed) * Math.min(1, dt / 1.5);
    s.height += s.verticalSpeed * dt;
    s.pitch = attitude(s.speed, s.verticalSpeed) + (now.id === 'final' && s.height < FLARE ? (FLARE - s.height) * 0.8 * DEG : 0);
    if (s.height <= 0) {
      // Touchdown: back to the upwind leg on the ground.
      s.height = 0;
      s.onGround = true;
      s.rollTime = 0;
      s.bank = 0;
      s.leg = 0;
      changed = 0;
    }
  }
  const gs = s.speed * Math.cos(Math.atan2(s.verticalSpeed, Math.max(s.speed, 1)));
  s.north += Math.cos(s.heading) * gs * dt;
  s.east += Math.sin(s.heading) * gs * dt;
  return changed;
}
