// Handling qualities a C172 pilot notices, beyond the POH numbers: hands-off (stick-free) speed stability and
// its neutral point, the trim changes with flaps and power, hands-off cruise with the controls released, and
// taxi turns with the nosewheel steering and brakes.

import { describe, expect, it } from 'vitest';
import { DEG, FT, KT } from '../../src/core/math';
import { MAX_GROSS_PAYLOAD, tasFromCas } from '../../src/physics';
import { C172, ELEVATION, FRAME, at, flatEnvironment, kt, makeRig, report, resetTo } from './helpers';

const ALT = ELEVATION + 3000 * FT;
const MAC = C172.wing.meanChord;

/**
 * Trim-wheel setting and elevator deflection for steady flight at a range of speeds, at a payload position: level
 * flight (throttle solved), or a fixed throttle (0: power-off glide, 1: full-power climb).
 */
function trimCurve(payloadX: number, speeds = [70, 80, 90, 100, 110], throttle?: number, lateral?: 'zeroSideslip'): { cg: number; points: { cl: number; wheel: number; elevator: number }[] } {
  const rig = makeRig({ options: { payload: MAX_GROSS_PAYLOAD, payloadPosition: { x: payloadX, y: 0, z: -0.05 } } });
  resetTo(rig, { position: at(ALT), airspeed: 90 * KT });
  const fm = rig.fm;
  const atm = rig.env.atmosphere(ALT);
  const W = fm.massProperties.mass * 9.80665;
  const points = [];
  for (const kias of speeds) {
    const tas = tasFromCas(kias * KT, atm);
    const t = fm.solveTrim(throttle === undefined ? { tas, altitude: ALT, flightPathAngle: 0, lateral } : { tas, altitude: ALT, throttle, lateral }, rig.env);
    expect(t.converged).toBe(true);
    const pc = fm.pitchControlsAtTrim(t);
    expect(Math.abs(pc.elevator)).toBeLessThan(1e-4);
    points.push({ cl: (W * Math.cos(t.flightPathAngle)) / (0.5 * atm.density * tas * tas * C172.wing.area), wheel: pc.elevatorTrim, elevator: t.elevator });
  }
  return { cg: 0.25 - fm.massProperties.cgOffset.x / MAC, points };
}

/** Least-squares slope of y against CL. */
function slope(points: { cl: number }[], y: (p: (typeof points)[number] & { wheel: number; elevator: number }) => number): number {
  const ps = points as { cl: number; wheel: number; elevator: number }[];
  const n = ps.length;
  const mx = ps.reduce((s, p) => s + p.cl, 0) / n;
  const my = ps.reduce((s, p) => s + y(p), 0) / n;
  return ps.reduce((s, p) => s + (p.cl - mx) * (y(p) - my), 0) / ps.reduce((s, p) => s + (p.cl - mx) ** 2, 0);
}

/** Stick-fixed (trimmed elevator) and stick-free (trim wheel) neutral points from a forward and an aft loading. */
function neutralPoints(speeds?: number[], throttle?: number, lateral?: 'zeroSideslip') {
  const fwd = trimCurve(0.1, speeds, throttle, lateral);
  const aft = trimCurve(-0.8, speeds, throttle, lateral);
  const wf = slope(fwd.points, (p) => p.wheel), wa = slope(aft.points, (p) => p.wheel);
  const ef = slope(fwd.points, (p) => p.elevator), ea = slope(aft.points, (p) => p.elevator);
  return {
    free: fwd.cg + ((aft.cg - fwd.cg) * wf) / (wf - wa),
    fixed: fwd.cg + ((aft.cg - fwd.cg) * ef) / (ef - ea),
    wf,
    wa,
  };
}

describe('pitch: hands-off stability and trim', () => {
  it('has its stick-fixed neutral point near 0.45-0.50 MAC and the stick-free one ahead of it, the trim wheel moving nose-up as speed falls', () => {
    const { free, fixed, wf, wa } = neutralPoints();
    report('stick-fixed neutral point, level flight 70-110 KIAS', fixed, '0.45-0.50', 'MAC');
    report('hands-off (stick-free) neutral point, level flight', free, '0.40-0.47 (fixed less the elevator float)', 'MAC');
    // Nose-up trim for slower flight at both CGs (positive speed stability hands-off).
    expect(wf).toBeGreaterThan(0);
    expect(wa).toBeGreaterThan(0);
    // Was 0.56 (tail efficiency 1.0 and a slipstream that stabilised): the fuselage boundary layer over the
    // tailplane roots, the cabin's added mass and a destabilising slipstream bring it to ~0.51.
    expect(fixed).toBeGreaterThan(0.45);
    expect(fixed).toBeLessThan(0.52);
    // Releasing the elevator lets it float with the tail's angle of attack: less stable than holding it, but
    // still stable at the aft CG limit (0.36 MAC) with margin.
    expect(free).toBeLessThan(fixed - 0.03);
    expect(free).toBeGreaterThan(0.4);
  }, 120000);

  // Measured from the trimmed elevator's gradient at two CGs (the flight-test method), power-off glide 0.539 and
  // full-power climb 0.543 MAC: power is nearly neutral in pitch. It read 0.564 / 0.544 (-0.020) while the elevator's
  // large-deflection loss used the surface's full inclination to the free stream (delta + alpha): that made the
  // elevator's effectiveness swing with the tail's angle of attack, more on the slow power-off curve than on the
  // slipstream-fed power-on one, and the trim gradients carried that non-linearity into the neutral points. With the
  // thin-aerofoil coupling (delta + 0.54 alpha, aero/airfoil.ts) the propeller's destabilising normal force (next
  // test) and the slipstream's extra tail dynamic pressure nearly cancel.
  // Both curves are trimmed with the ball centred, as the climbs and glides of a flight test are flown. With the
  // wings held level instead, the full-power trims carry a quarter of right rudder against the slipstream's swirl
  // with the sideslip that balances its side force, and that lateral trim changing with speed added 0.02 MAC.
  it('keeps the full-power neutral point within 0.03 MAC of the power-off one', () => {
    const speeds = [60, 65, 70, 75, 80];
    const off = neutralPoints(speeds, 0, 'zeroSideslip').fixed;
    const on = neutralPoints(speeds, 1, 'zeroSideslip').fixed;
    report('stick-fixed neutral point, power-off glide 60-80 KIAS', off, 'reference', 'MAC');
    report('stick-fixed neutral point, full-power climb 60-80 KIAS', on, 'within 0.03 of power-off', 'MAC');
    expect(Math.abs(on - off)).toBeLessThan(0.03);
  }, 120000);

  it("the propeller's normal force is destabilising (it grows with angle of attack ahead of the CG)", () => {
    // Pitching moment of the propulsion system about the CG at full power, 70 KIAS, at two angles of attack.
    const rig = makeRig();
    const atm = rig.env.atmosphere(ALT);
    resetTo(rig, { position: at(ALT), airspeed: tasFromCas(70 * KT, atm) });
    rig.controls.throttle = 1;
    rig.run(3);
    const fm = rig.fm;
    const prop = fm.propulsion;
    const air = (a: number) => ({ x: -36 * Math.cos(a), y: 0, z: -36 * Math.sin(a) });
    const body = {
      time: 0,
      position: at(ALT),
      orientation: { w: 1, x: 0, y: 0, z: 0 },
      velocityBody: { x: 36, y: 0, z: 0 },
      angularVelocity: { x: 0, y: 0, z: 0 },
      cgOffset: fm.massProperties.cgOffset,
      mass: fm.massProperties.mass,
    };
    // dt = 0: the shaft speed and engine state are held, only the loads are evaluated.
    const moment = (a: number) => prop.step({ body, atmosphere: atm, airVelocityBody: air(a), controls: rig.controls, dt: 0 }).moment.y;
    const dM = moment(8 * DEG) - moment(2 * DEG);
    report('propeller pitching moment, alpha 2 -> 8 deg, full power 70 KIAS', dM, '> 0 (nose up: destabilising)', 'N m');
    expect(dM).toBeGreaterThan(0);
  }, 30000);

  it('pitches up and balloons when the flaps are extended hands-off, and pitches up with power', () => {
    const rig = makeRig();
    const s = rig.fm.state;
    resetTo(rig, { position: at(ALT), airspeed: 72 * KT });
    const pitch0 = s.pitch, ias0 = s.ias, h0 = s.altitudeMSL;
    rig.controls.flaps = 1;
    rig.run(4);
    report('flaps 0 -> 30 at 70 KIAS hands-off: pitch change after 4 s', (s.pitch - pitch0) / DEG, '> 0 (nose up)', 'deg');
    report('  airspeed change', kt(s.ias - ias0), '< 0 (balloon)', 'kt');
    report('  height change', s.altitudeMSL - h0, '> 0 (balloon)', 'm');
    expect(s.pitch - pitch0).toBeGreaterThan(1 * DEG);
    expect(s.ias).toBeLessThan(ias0);
    expect(s.altitudeMSL).toBeGreaterThan(h0);

    resetTo(rig, { position: at(ALT), airspeed: 80 * KT, flightPathAngle: -3 * DEG });
    const p1 = s.pitch;
    rig.controls.throttle = 1;
    // Hands off the yoke; the feet keep the ball centred against the power's left yaw (a quarter of right pedal),
    // as a pilot does: with the pedals left alone the yaw and the bank it brings take the nose down.
    const r0 = rig.controls.rudder;
    let ballI = 0;
    rig.run(3, () => {
      ballI += 0.8 * s.slipBall * FRAME;
      rig.controls.rudder = Math.max(-1, Math.min(1, r0 + 1.5 * s.slipBall + ballI - 0.6 * s.angularVelocity.z));
    });
    report('full power from a trimmed descent, hands-off: pitch change after 3 s', (s.pitch - p1) / DEG, '> 0 (nose up)', 'deg');
    expect(s.pitch - p1).toBeGreaterThan(1 * DEG);
  }, 30000);

  it('trims the full-flap approach nose-up of cruise, and flaps move the trimmed elevator by only a few degrees', () => {
    // The C172's pitch-up with flaps is real (downwash on the tail) but modest: the full-flap final is trimmed
    // nose-up of cruise (which is why a full-flap go-around with that trim pitches up hard).
    const rig = makeRig();
    const atm = rig.env.atmosphere(ALT);
    resetTo(rig, { position: at(ALT), airspeed: tasFromCas(100 * KT, atm) });
    const cruiseWheel = rig.controls.elevatorTrim;
    resetTo(rig, { position: at(ALT), airspeed: tasFromCas(65 * KT, atm), flaps: 1, flightPathAngle: -3 * DEG });
    const approachWheel = rig.controls.elevatorTrim;
    report('trim wheel: cruise 100 KIAS', cruiseWheel, 'reference', '');
    report('trim wheel: full-flap 65 KIAS 3 deg approach', approachWheel, '> cruise (nose up)', '');
    expect(approachWheel).toBeGreaterThan(cruiseWheel + 0.03);
    // Trimmed elevator at 65 KIAS in level flight, clean and with full flap.
    const level = (flaps: number) => {
      resetTo(rig, { position: at(ALT), airspeed: tasFromCas(65 * KT, atm), flaps });
      return rig.fm.lastTrim!.elevator;
    };
    const shift = (level(1) - level(0)) / DEG;
    report('trimmed elevator change, flaps 0 -> 30 at 65 KIAS', shift, '< 9 (was 15)', 'deg');
    expect(shift).toBeGreaterThan(0);
    expect(shift).toBeLessThan(9);
  }, 30000);

  it('balloons moderately when flaps 10 are selected hands-off on the downwind leg', () => {
    const rig = makeRig();
    const s = rig.fm.state;
    resetTo(rig, { position: at(ALT), airspeed: tasFromCas(85 * KT, rig.env.atmosphere(ALT)) });
    const p0 = s.pitch;
    let maxPitch = 0, minIas = Infinity;
    rig.controls.flaps = 1 / 3;
    rig.run(15, () => {
      maxPitch = Math.max(maxPitch, s.pitch - p0);
      minIas = Math.min(minIas, kt(s.ias));
    });
    report('flaps 0 -> 10 at 85 KIAS hands-off: largest pitch-up', maxPitch / DEG, 'moderate (was 23)', 'deg');
    report('  lowest airspeed', minIas, '> 50 (was 40)', 'KIAS');
    expect(maxPitch).toBeGreaterThan(1 * DEG);
    expect(maxPitch).toBeLessThan(15 * DEG);
    expect(minIas).toBeGreaterThan(50);
  }, 30000);
});

describe('lateral: hands-off cruise', () => {
  // The tab and the wings are rigged at full-throttle level flight at sea level (controlSystem.ts); slower, the
  // swirl outgrows the tab and the aircraft wanders slowly left with the pedals neutral (about 0.03 pedal short at
  // 110 KIAS: a gentle spiral, not a roll-off).
  it('holds its wings level at the rigged cruise with the yoke and pedals released (rigged tab and wings)', () => {
    const run = (kias: number, altitude: number) => {
      const rig = makeRig({ env: flatEnvironment(undefined, altitude - 1000) });
      const s = rig.fm.state;
      resetTo(rig, { position: at(altitude), airspeed: tasFromCas(kias * KT, rig.env.atmosphere(altitude)) });
      rig.controls.aileron = 0;
      rig.controls.rudder = 0;
      let maxRoll = 0;
      rig.run(30, () => {
        maxRoll = Math.max(maxRoll, Math.abs(s.roll));
      });
      return maxRoll;
    };
    const rigged = run(124, 300);
    const cruise = run(110, ALT);
    report('hands and feet off at 124 KIAS near sea level (the rig point): largest bank in 30 s', rigged / DEG, '< 3', 'deg');
    report('hands and feet off at 110 KIAS: largest bank in 30 s', cruise / DEG, '< 15 (slow left spiral)', 'deg');
    expect(rigged).toBeLessThan(3 * DEG);
    expect(cruise).toBeLessThan(15 * DEG);
  }, 30000);
});

describe('taxi turns', () => {
  const turn = (speedKt: number, brake: number) => {
    const rig = makeRig({ env: flatEnvironment() });
    resetTo(rig, { onGround: true, position: at(ELEVATION) });
    const s = rig.fm.state, c = rig.controls;
    c.parkingBrake = false;
    // Speed hold on the throttle, full right pedal (plus some right toe brake).
    const hold = () => {
      c.throttle = Math.min(Math.max(0.25 + 0.15 * (speedKt - kt(s.groundSpeed)), 0), 0.7);
    };
    rig.run(12, hold);
    c.rudder = 1;
    c.brakeRight = brake;
    rig.run(10, hold);
    let r = 0, n = 0;
    rig.run(3, () => {
      hold();
      r += s.angularVelocity.z;
      n++;
    });
    return s.groundSpeed / (r / n);
  };

  it('turns on a ~10 m radius on full pedal at walking pace, and much tighter with differential braking', () => {
    const pedal = turn(6, 0);
    const braked = turn(3, 1);
    report('taxi: full right pedal at 6 kt, turn radius', pedal, '9-11 (10 deg nosewheel)', 'm');
    report('taxi: full right pedal + full right brake at 3 kt, turn radius', braked, '< 5 (nosewheel castering)', 'm');
    expect(pedal).toBeGreaterThan(8.5);
    expect(pedal).toBeLessThan(12);
    expect(braked).toBeLessThan(5);
    expect(braked).toBeGreaterThan(2);
    void FRAME;
  }, 60000);
});
