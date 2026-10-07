// Ground handling and POH take-off / landing ground rolls (max gross, ISA, sea level, dry paved runway).

import { describe, expect, it } from 'vitest';
import { DEG, wrapPi } from '../../src/core/math';
import type { AircraftState, ControlInputs } from '../../src/core/types';
import { C172, LOADING, at, calmWeather, flatEnvironment, kt, makeRig, report, resetTo } from './helpers';
import { RUNWAY_HEADING, centrelineHeading, crossTrack, landingRoll, parkedDrift, pedalSteer, runwayRig, takeoffRoll, taxi } from './measure';

const POH = C172.poh;

/** Rudder (and nosewheel) steering onto the centreline: heading toward a point 60 m ahead on the line. */
const steer = (s: AircraftState, c: ControlInputs): void => pedalSteer(s, c, centrelineHeading(s));

/** Ground roll from brake release to lift-off, rotating to `pitch` at `rotateKias` (measure.ts takeoffRoll). */
function takeoff(flaps: number, rotateKias: number, pitch: number, windKt = 0, windFromDeg = 0, staticRunUp = true) {
  return takeoffRoll(runwayRig(undefined, 'typical', windKt, windFromDeg), { flapLever: flaps, rotateKias, pitch, windKt, windFromDeg, staticRunUp });
}

describe('on the ground', () => {
  it('sits still at idle with the parking brake set, without jitter', () => {
    const { drift, maxRate, running, minWheelLoad } = parkedDrift(makeRig());
    report('parked at idle: drift in 30 s', drift * 1000, '< 5', 'mm');
    report('parked at idle: largest body rate', maxRate / DEG, '< 0.05', 'deg/s');
    expect(drift).toBeLessThan(0.005);
    expect(maxRate).toBeLessThan(0.05 * DEG);
    expect(running).toBe(true);
    expect(minWheelLoad).toBeGreaterThan(1000);
  }, 30000);

  it('taxis straight with a touch of pedal and turns tightly with full pedal, smoothly', () => {
    // 10 kt held with throttle and brakes on the centreline, then full right pedal: a steady turn whose radius
    // comes from speed and yaw rate. Yaw acceleration stays smooth.
    const x = taxi(makeRig());
    report('taxi: mean pedal to hold the centreline at 10 kt', x.meanSteer, 'small, right', '');
    report('taxi: largest heading error', x.maxHeadingErrorDeg, '< 2', 'deg');
    report('taxi: ground speed', x.groundSpeedKt, 10, 'kt');
    expect(Math.abs(x.meanSteer)).toBeLessThan(0.3);
    expect(x.maxHeadingErrorDeg).toBeLessThan(2);
    expect(Math.abs(x.groundSpeedKt - 10)).toBeLessThan(1);
    report('taxi: turn radius with full right pedal at 10 kt', x.radius, '8-15', 'm');
    report('taxi: largest yaw acceleration in the steady turn', x.maxYawAccel / DEG, '< 5', 'deg/s^2');
    expect(x.radius).toBeGreaterThan(6);
    expect(x.radius).toBeLessThan(20);
    expect(x.maxYawAccel).toBeLessThan(5 * DEG);
  }, 60000);

  it('take-off ground roll, flaps up, rolling start, rotating at 55 KIAS', () => {
    const r = takeoff(0, 55, 8 * DEG, 0, 0, false);
    // The POH tabulates only the short-field (flaps 10) roll; this is the normal technique for comparison.
    report('take-off ground roll, flaps 0, rolling start, rotate 55 KIAS', r.roll, 'longer than 293', 'm');
    report('  lift-off speed', r.liftoffKias, 'about 57', 'KIAS');
    expect(r.crashed).toBe(false);
    expect(r.climbing).toBe(true);
    expect(r.roll).toBeGreaterThan(POH.takeoffGroundRollM);
    expect(r.roll).toBeLessThan(1.6 * POH.takeoffGroundRollM);
  }, 60000);

  it('take-off ground roll, POH short-field technique (flaps 10, lift off at 51 KIAS)', () => {
    const r = takeoff(1 / 3, 48, 8 * DEG);
    report('take-off ground roll, flaps 10 short field', r.roll, POH.takeoffGroundRollM, 'm');
    report('  lift-off speed', r.liftoffKias, 51, 'KIAS');
    expect(r.crashed).toBe(false);
    expect(Math.abs(r.roll / POH.takeoffGroundRollM - 1)).toBeLessThan(0.1);
  }, 60000);

  it('a 15 kt direct crosswind take-off is controllable with rudder and into-wind aileron', () => {
    const r = takeoff(0, 55, 8 * DEG, 15, 70 - 90, false); // rolling start, wind from the left of runway 07
    report('15 kt crosswind take-off: largest distance off the centreline on the roll', r.maxCross, '< 7.5 (runway half-width 15)', 'm');
    report('15 kt crosswind take-off: largest bank on the ground roll', r.maxBank / DEG, '< 10', 'deg');
    expect(r.crashed).toBe(false);
    expect(r.climbing).toBe(true);
    expect(r.maxCross).toBeLessThan(7.5);
    expect(r.maxBank).toBeLessThan(10 * DEG);
  }, 60000);

  it('landing ground roll with maximum braking: POH 175 m', () => {
    // Short final at 61 KIAS, flaps 30, on a 3 degree path toward the runway start, 60 ft up; flare from 6 m with the
    // throttle closed to a touchdown attitude of 7 degrees, holding off to touch down slowly on the mains; then the
    // POH short-field technique: lower the nose wheel, flaps up, heavy braking a second after the mains touch.
    const { roll, touchdownSink, touchdownKias, crashed } = landingRoll(runwayRig(undefined, 'typical'), { approachKt: 61, flapLever: 1, touchdownPitch: 7 * DEG });
    report('landing ground roll, maximum braking', roll, POH.landingGroundRollM, 'm');
    report('  touchdown sink rate', touchdownSink, '< 1', 'm/s');
    report('  touchdown speed', touchdownKias, 'about 50', 'KIAS');
    expect(crashed).toBe(false);
    expect(Math.abs(roll / POH.landingGroundRollM - 1)).toBeLessThan(0.1);
  }, 60000);

  it('hands and feet off, full power: with the pedals free the loaded nosewheel restrains the floating rudder (no ground loop in a crosswind)', () => {
    // The rudder, the pedals and the nosewheel are one linkage (steering bungee). On the ground the loaded nose
    // tyre holds it: an airborne-style float steering the nosewheel ground-looped the aircraft in a few knots
    // of crosswind (yaw -> sideslip at the fin -> float -> steer -> more yaw).
    const run = (free: boolean, windFrom = 0, windKt = 0, pedal = 0) => {
      const w = calmWeather({ windDirectionDeg: windFrom, windSpeedKt: windKt });
      const rig = makeRig({ env: flatEnvironment(w, 0) });
      resetTo(rig, { onGround: true, position: at(0), heading: RUNWAY_HEADING });
      rig.fm.controlSystem.rudderFree = free;
      const s = rig.fm.state;
      rig.controls.parkingBrake = false;
      rig.controls.throttle = 1;
      rig.controls.rudder = pedal;
      let maxSwing = 0;
      rig.run(25, () => {
        maxSwing = Math.max(maxSwing, Math.abs(wrapPi(s.heading - RUNWAY_HEADING)));
        return kt(s.ias) > 50;
      });
      return { maxSwing, heading: wrapPi(s.heading - RUNWAY_HEADING), crossTrack: crossTrack(s) };
    };
    const hdg = RUNWAY_HEADING / DEG;
    const free = run(true);
    const held = run(false);
    // The pedal that holds the roll straight: between the two that swing it either way, by interpolation.
    const lo = run(false, 0, 0, 0.15);
    const hi = run(false, 0, 0, 0.25);
    const hold = 0.15 + (0.1 * -lo.heading) / (hi.heading - lo.heading);
    const straight = run(false, 0, 0, hold);
    const right = run(true, hdg + 90, 10);
    const left = run(true, hdg - 90, 10);
    report('take-off roll to 50 KIAS, calm: right pedal that holds it straight', hold, '0.15-0.25', '');
    report('  largest heading swing with it held', straight.maxSwing / DEG, '< 10', 'deg');
    report('take-off roll to 50 KIAS, pedals held centred, calm: largest heading swing', held.maxSwing / DEG, 'to the left (owner: 20-45; was 39 with 0.07 pedal to hold it)', 'deg');
    report('take-off roll to 50 KIAS, pedals free, calm: largest heading swing', free.maxSwing / DEG, '< pedals centred', 'deg');
    report('take-off roll to 50 KIAS, pedals free, 10 kt crosswind from the right / left', right.maxSwing / DEG, '< 45', 'deg');
    report('', left.maxSwing / DEG, '< 45', 'deg');
    // Between 0.15 and 0.25 of right pedal holds the roll straight. Nosewheel steering makes the heading very
    // sensitive to the pedal: every 0.1 of pedal away from the holding pedal is a swing of ~45-50 deg by 50 KIAS
    // (the 10 deg nosewheel per full pedal over ~150 m of roll), so the pedals-centred swing is about five times
    // the holding pedal in tens of degrees (~80 deg) and only its direction and order are pinned down here.
    expect(lo.heading).toBeLessThan(0);
    expect(hi.heading).toBeGreaterThan(0);
    expect(straight.maxSwing).toBeLessThan(10 * DEG);
    expect(held.heading).toBeLessThan(-20 * DEG);
    expect(free.heading).toBeLessThan(0);
    // The free rudder floats in the slipstream it sits in (its hinge moment follows the fin's local dynamic
    // pressure, not the free stream's), which unloads the fin against the swirl: less swing than pedals held.
    expect(free.maxSwing).toBeLessThan(held.maxSwing - 8 * DEG);
    // No ground loop with the feet off in a crosswind (the float-steer feedback the nose tyre restrains).
    for (const r of [right, left]) expect(r.maxSwing).toBeLessThan(45 * DEG);
  }, 90000);

  it('dips the nose only 1-2.5 degrees under maximum braking (stiff, highly compressed nose oleo)', () => {
    const rig = makeRig({ env: flatEnvironment(calmWeather(), 0) });
    resetTo(rig, { onGround: true, position: at(0), heading: RUNWAY_HEADING });
    const s = rig.fm.state, c = rig.controls;
    const static0 = s.pitch;
    c.parkingBrake = false;
    c.throttle = 1;
    rig.run(12, () => steer(s, c));
    c.throttle = 0;
    c.brakeLeft = c.brakeRight = 1;
    let lowest = Infinity, v0 = s.groundSpeed, t0 = s.time;
    rig.run(20, () => {
      steer(s, c);
      lowest = Math.min(lowest, s.pitch);
      return s.groundSpeed < 0.3;
    });
    const decel = v0 / (s.time - t0) / 9.80665;
    report('maximum braking: nose dip below the static attitude', (static0 - lowest) / DEG, '1-2.5 (was 4.7)', 'deg');
    report('  mean deceleration', decel, 'about 0.3', 'g');
    expect(static0 - lowest).toBeGreaterThan(0.8 * DEG);
    expect(static0 - lowest).toBeLessThan(2.5 * DEG);
    expect(s.crashed).toBe(false);
  }, 60000);

  it('full aft yoke on the take-off roll lifts the nosewheel only once the elevator has airflow (not at walking pace)', () => {
    const noseLift = (loading: 'typical' | 'aft') => {
      const rig = makeRig({ env: flatEnvironment(calmWeather(), 0), options: LOADING[loading] });
      resetTo(rig, { onGround: true, position: at(0), heading: RUNWAY_HEADING });
      const s = rig.fm.state;
      const c = rig.controls;
      c.parkingBrake = false;
      c.throttle = 1;
      c.elevator = 1;
      let lift = NaN;
      rig.run(30, () => {
        steer(s, c);
        if (s.wheels[0].load <= 0 && kt(s.groundSpeed) > 3) {
          lift = kt(s.ias);
          return true;
        }
      });
      return { lift, crashed: s.crashReason };
    };
    const typical = noseLift('typical');
    const aft = noseLift('aft');
    report('nosewheel lift-off, full aft yoke and full power, typical CG', typical.lift, '25-35 (was 18)', 'KIAS');
    report('nosewheel lift-off, full aft yoke and full power, aft CG', aft.lift, '> 15 (was 8)', 'KIAS');
    expect(typical.lift).toBeGreaterThan(20);
    expect(aft.lift).toBeGreaterThan(11);
    expect(typical.crashed).toBe('');
    expect(aft.crashed).toBe('');
  }, 60000);
});

