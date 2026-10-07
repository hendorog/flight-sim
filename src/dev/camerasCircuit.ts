// Animated mock flight for camera/audio dev pages: a left-hand touch-and-go circuit on runway 07.
//
// The ground track is a stadium: the runway line (final approach, touch-and-go, climb-out) joined to a
// downwind leg by two 180-degree turns. Altitude is a piecewise-linear profile along the track, bank
// follows the turn curvature with eased roll-in/roll-out, and body rates come from differentiating the
// Euler angles, so the head-motion and chase-lag code sees plausible inputs.

import { DEG, G0, quat, smoothstep, wrapPi } from '../core/math';
import type { AircraftState } from '../core/types';
import { AIRPORT, runwayDirection } from '../core/world';
import { CG_HEIGHT_ON_GROUND } from '../core/mockState';

const SPEED = 45; // m/s ground speed, about 87 kt
const RADIUS = 450; // turn radius, m
const START = -2600; // along-runway coordinate where final begins, m
const END = 1400; // along-runway coordinate where the crosswind turn begins, m
const STRAIGHT = END - START;
const TURN = Math.PI * RADIUS;
export const CIRCUIT_LENGTH = 2 * STRAIGHT + 2 * TURN;
/** Distance over which bank is rolled in/out at each end of a turn, m. */
const ROLL_DIST = 140;

/** Height above the field along the track (s in metres from the start of final). */
function heightAt(s: number): number {
  const along = START + s;
  if (s < STRAIGHT) {
    if (along < -850) return 120 * ((-850 - along) / (-850 - START)); // 3.9 degree approach
    if (along < 150) return 0; // touch-and-go ground roll
    return 110 * ((along - 150) / (END - 150));
  }
  s -= STRAIGHT;
  if (s < TURN) return 110 + 190 * smoothstep(0, TURN, s); // climbing crosswind turn
  s -= TURN;
  if (s < STRAIGHT) return 300; // downwind
  s -= STRAIGHT;
  return 300 - 180 * smoothstep(0, TURN, s); // descending base turn
}

interface TrackPoint {
  north: number;
  east: number;
  heading: number;
  /** Signed turn curvature, 1/m (+ = right turn). */
  curvature: number;
  /** 0..1 how far into a turn (for bank easing). */
  bankEase: number;
}

function trackAt(s: number): TrackPoint {
  s = ((s % CIRCUIT_LENGTH) + CIRCUIT_LENGTH) % CIRCUIT_LENGTH;
  const d = runwayDirection();
  const left = { x: d.y, y: -d.x }; // unit vector to the left of the runway direction (NED)
  const rwyHdg = AIRPORT.runway.heading;
  const at = (along: number, side: number) => ({ north: d.x * along + left.x * side, east: d.y * along + left.y * side });
  const ease = (u: number, len: number) => Math.min(smoothstep(0, ROLL_DIST, u), smoothstep(0, ROLL_DIST, len - u));
  if (s < STRAIGHT) return { ...at(START + s, 0), heading: rwyHdg, curvature: 0, bankEase: 0 };
  s -= STRAIGHT;
  if (s < TURN) {
    const a = s / RADIUS; // left turn around a centre to the left of the runway end
    const p = at(END + Math.sin(a) * RADIUS, RADIUS - Math.cos(a) * RADIUS);
    return { ...p, heading: rwyHdg - a, curvature: -1 / RADIUS, bankEase: ease(s, TURN) };
  }
  s -= TURN;
  if (s < STRAIGHT) return { ...at(END - s, 2 * RADIUS), heading: rwyHdg + Math.PI, curvature: 0, bankEase: 0 };
  s -= STRAIGHT;
  const a = s / RADIUS;
  const p = at(START - Math.sin(a) * RADIUS, RADIUS + Math.cos(a) * RADIUS);
  return { ...p, heading: rwyHdg + Math.PI - a, curvature: -1 / RADIUS, bankEase: ease(s, TURN) };
}

function attitudeAt(s: number): { roll: number; pitch: number; heading: number; gamma: number; h: number } {
  const tp = trackAt(s);
  const h = heightAt(((s % CIRCUIT_LENGTH) + CIRCUIT_LENGTH) % CIRCUIT_LENGTH);
  const gamma = Math.atan2(heightAt((s + 5) % CIRCUIT_LENGTH) - heightAt(((s - 5) % CIRCUIT_LENGTH + CIRCUIT_LENGTH) % CIRCUIT_LENGTH), 10);
  const bank = Math.atan((SPEED * SPEED * tp.curvature) / G0) * tp.bankEase;
  const alpha = h > 0.5 ? 3 * DEG : 0;
  return { roll: bank, pitch: gamma + alpha, heading: ((tp.heading % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI), gamma, h };
}

/** Write the circuit state at time t (s) into `st`. */
export function circuitState(t: number, st: AircraftState): void {
  const s = t * SPEED;
  const tp = trackAt(s);
  const att = attitudeAt(s);
  const dt = 0.02;
  const next = attitudeAt(s + SPEED * dt);
  const prev = attitudeAt(s - SPEED * dt);
  // Euler rates -> body rates (p, q, r).
  const phiDot = (next.roll - prev.roll) / (2 * dt);
  const thetaDot = (next.pitch - prev.pitch) / (2 * dt);
  const psiDot = wrapPi(next.heading - prev.heading) / (2 * dt);
  const { roll, pitch, heading } = att;
  const onGround = att.h <= 0.01;

  st.time = t;
  st.position = { x: tp.north, y: tp.east, z: -(AIRPORT.elevation + att.h + CG_HEIGHT_ON_GROUND) };
  const vh = SPEED * Math.cos(att.gamma);
  st.velocity = { x: Math.cos(tp.heading) * vh, y: Math.sin(tp.heading) * vh, z: -SPEED * Math.sin(att.gamma) };
  st.orientation = quat.fromEuler(roll, pitch, heading);
  st.angularVelocity = {
    x: phiDot - psiDot * Math.sin(pitch),
    y: thetaDot * Math.cos(roll) + psiDot * Math.sin(roll) * Math.cos(pitch),
    z: -thetaDot * Math.sin(roll) + psiDot * Math.cos(roll) * Math.cos(pitch),
  };
  st.roll = roll;
  st.pitch = pitch;
  st.heading = heading;
  st.track = heading;
  st.altitudeMSL = AIRPORT.elevation + att.h + CG_HEIGHT_ON_GROUND;
  st.altitudeAGL = att.h + CG_HEIGHT_ON_GROUND;
  st.verticalSpeed = SPEED * Math.sin(att.gamma);
  st.groundSpeed = vh;
  st.tas = SPEED;
  st.ias = SPEED * 0.98;
  st.alpha = onGround ? 0 : 3 * DEG;
  // Coordinated flight: specific force straight down the body z axis with magnitude 1/cos(bank).
  st.gLoad = 1 / Math.cos(roll);
  st.specificForce = { x: 0, y: 0, z: -st.gLoad };
  st.onGround = onGround;
  for (const w of st.wheels) {
    w.onGround = onGround;
    w.compression = onGround ? 0.06 : 0;
  }
  // Flaps 20 on final and through the touch-and-go, retracted from the start of the climb.
  const sm = ((s % CIRCUIT_LENGTH) + CIRCUIT_LENGTH) % CIRCUIT_LENGTH;
  st.surfaces.flaps = sm < 150 - START ? 20 * DEG : 0;
}
