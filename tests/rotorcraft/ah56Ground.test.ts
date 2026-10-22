// The AH-56A on its wheels in the flight model (AG, plan revision 2 section 7.2: G13, G15) and the wheeled rotorcraft's
// strike checks (RotorClearance, wheels.ts). The tail wheel's lock, turns and tracking are tests/gear/ah56TailWheel.test.ts
// (the 6-DOF gear rig); the -12 deg reverse-pitch part of the run-on stop is the pusher's (stage 4, AC).
import { describe, expect, it } from 'vitest';
import { DEG, FT, KT, quat, v3 } from '../../src/core/math';
import { defaultWeather } from '../../src/core/types';
import { SimPhysics } from '../../src/sim/SimPhysics';
import { SCENARIO_IDS } from '../../src/sim/scenarios';
import { RotorClearance, wheelRestingPose } from '../../src/physics/rotorcraft/wheels';
import { emptyRotorcraftState } from '../../src/physics/rotorcraft/definition';
import { AH56_DEFINITION } from '../../src/aircraft/ah56';
import { AH56_REFERENCE } from '../../src/aircraft/ah56/reference';
import { hoverScenario } from '../../src/sim/rotorcraft/starts';
import { pusherBetaLever } from '../../src/physics/rotorcraft/pusher';
import { d, gauges, gyroDef, pilot, report, rig, run } from './ah56Rig';

describe('G13: on the wheels', () => {
  it('a running ground reset rests on three wheels about level and stays there', () => {
    const r = rig({ onGround: true });
    const s0 = r.fm.state;
    expect(s0.wheels.every((w) => w.onGround)).toBe(true);
    run(r, 5);
    const s = r.fm.state;
    report('G13 ground rest (running, flat pitch, pedals centred)', { tailKN: s.wheels[0].load / 1e3, leftKN: s.wheels[1].load / 1e3,
      rightKN: s.wheels[2].load / 1e3, pitchDeg: s.pitch / DEG, rollDeg: s.roll / DEG, nrPct: gauges(r).nr, tailRotorThrustKN: s.rotorcraft!.tailThrust / 1e3,
      mainRotorThrustKN: s.rotorcraft!.thrust / 1e3, crashed: s.crashed });
    expect(s.crashed).toBe(false);
    expect(s.wheels.every((w) => w.onGround && w.load > 0)).toBe(true);
    expect(Math.abs(s.pitch)).toBeLessThan(1 * DEG);
    // The tail rotor's side force at flat pitch leans it toward the right main (the tyres react it below the CG).
    expect(Math.abs(s.roll)).toBeLessThan(5 * DEG);
  });

  /** Ground idle (or flat pitch at 100 % with `running`), full pedal `pedal`, brakes as given, 10 s: the worst roll, the yaw
   *  rate and the wheel loads (G13's tip-over margin). */
  const fullPedal = (pedal: 1 | -1, brakes: boolean, idle = true) => {
    const r = rig({ onGround: true });
    if (idle) r.c.throttle = d.systems.turboshaft!.grip.groundIdle;
    r.c.rudder = pedal; r.c.parkingBrake = brakes;
    let worstRoll = 0, maxYaw = 0, minLoad = Infinity;
    run(r, 10, () => {
      const s = r.fm.state;
      worstRoll = Math.max(worstRoll, Math.abs(s.roll)); maxYaw = Math.max(maxYaw, Math.abs(s.angularVelocity.z));
      if (!s.crashed) minLoad = Math.min(minLoad, ...s.wheels.map((w) => w.load));
    });
    const s = r.fm.state;
    return { worstRollDeg: worstRoll / DEG, maxYawRateDegPerSec: maxYaw / DEG, minWheelLoadKN: minLoad / 1e3, tailRotorThrustKN: s.rotorcraft!.tailThrust / 1e3,
      nrPct: gauges(r).nr, crashed: s.crashed, crash: (r.fm as unknown as { crashReason?: string }).crashReason ?? '' };
  };

  it('tip-over margin: full pedal either way at ground idle with the parking brake set stays on three wheels, roll within 5 deg', () => {
    for (const pedal of [-1, 1] as const) {
      const m = fullPedal(pedal, true);
      report(`G13 full ${pedal < 0 ? 'left' : 'right'} pedal, ground idle, parking brake`, m);
      expect(m.crashed).toBe(false);
      expect(m.minWheelLoadKN).toBeGreaterThan(0);
      expect(m.worstRollDeg).toBeLessThanOrEqual(5);
    }
  });

  it.fails('G13 KNOWN GAP: full left pedal at ground idle, brakes off: the aircraft stays upright', () => {
    // The tail rotor's 7.4 kN at ground idle (13.6 kN at 100 % Nr) outruns the locked tail wheel's and the free mains'
    // friction: the aircraft pivots up to about 100 deg/s, slides sideways and trips over the left main onto the wingtip in
    // under 4 s. With the brakes on it pivots about the mains (about 80 deg/s) but stays upright (row above). A real
    // ground spin at full pedal is plausible; the trip-over depends on the ESTIMATE tyre friction and CG height (77 in
    // above the ground over a 62 in track: 0.40 g of side force tips it). KNOWN_ISSUES #10.
    const m = fullPedal(-1, false);
    report('G13 full left pedal, ground idle, no brakes', m);
    expect(m.crashed).toBe(false);
  });

  /** Prop taxi at about `kt` (condition RUN, collective down, no brakes): accelerate on +8 deg of blade angle with the pedals
   *  holding the heading, then +3 deg (holds about 20 kt) and 6 s more of heading hold so the pedal settles on its trim; then
   *  `pulseIn` of left pedal for `pulseS` s and the trim pedal again, hands off, for 10 s. The worst yaw rate and roll after the
   *  pulse, the heading change, and the crash text. */
  const taxiPulse = (locked: boolean, kt: number, pulseIn: number, pulseS: number) => {
    const r = rig({ onGround: true });
    r.c.collective = 0; r.c.tailWheelLock = locked; r.c.parkingBrake = false;
    const h0 = r.fm.state.heading, p0 = r.c.rudder, pedalPerIn = 1 / 3.2;
    let yi = 0;
    const hold = () => { const s = r.fm.state, e = Math.atan2(Math.sin(s.heading - h0), Math.cos(s.heading - h0)); yi -= e * 0.5 / 240;
      r.c.rudder = Math.max(-1, Math.min(1, p0 - 3 * e - 1.0 * s.angularVelocity.z + yi)); };
    r.c.propLever = pusherBetaLever(d.pusher!, 8 * DEG);
    for (let t = 0; t < 40 && r.fm.state.groundSpeed < kt * KT; t += 0.25) run(r, 0.25, hold);
    r.c.propLever = pusherBetaLever(d.pusher!, 3 * DEG);
    run(r, 6, hold);
    const trim = r.c.rudder, hs = r.fm.state.heading, speedKt = r.fm.state.groundSpeed / KT;
    let t = 0, yaw = 0, roll = 0;
    run(r, 10, () => { t += 1 / 240; r.c.rudder = t <= pulseS ? Math.max(-1, trim - pulseIn * pedalPerIn) : trim;
      const s = r.fm.state; yaw = Math.max(yaw, Math.abs(s.angularVelocity.z)); roll = Math.max(roll, Math.abs(s.roll)); });
    const s = r.fm.state;
    return { speedKt, maxYawDegS: yaw / DEG, maxRollDeg: roll / DEG, headingChangeDeg: Math.abs(Math.atan2(Math.sin(s.heading - hs), Math.cos(s.heading - hs))) / DEG,
      crashed: s.crashed, crash: (r.fm as unknown as { crashReason?: string }).crashReason ?? '' };
  };

  it('tail wheel LOCKED, prop taxi at 20 kt: a 1 in left pedal pulse for 1 s, then the trim pedal, hands off: under 10 deg/s, heading within 10 deg (P ASTA-72 para 79: locked above 20 kt)', () => {
    const m = taxiPulse(true, 20, 1, 1);
    report('G13 taxi 20 kt, tail wheel locked, 1 in pulse 1 s', m);
    expect(m.crashed).toBe(false);
    expect(m.maxYawDegS).toBeLessThan(10);
    expect(m.headingChangeDeg).toBeLessThan(10);
  }, 120_000);

  it.fails('G13 KNOWN GAP: tail wheel UNLOCKED, prop taxi at 20 kt: a 1 in left pedal pulse for 1 s, then the trim pedal, hands off: stays upright, under 20 deg/s', () => {
    // P ASTA-72 para 79 and APE-I para 133: unlocked taxi is permitted to 20 kt, "directional control during taxi was excellent"
    // (by tail-rotor thrust; the tail wheel unlocked for all taxi turns, locked for take-off, landing and above 20 kt). Hands off,
    // a free castor behind mains that sit 0.76 m ahead of the CG (P CG FS 298, 3V axles FS 268) is directionally divergent on
    // the ground: with stiff main tyres the yaw mode is s = (m x U - N_r) / (Izz + m x^2) (D, the large-cornering-stiffness
    // limit of the two-degree-of-freedom ground model, so the tyre ESTIMATES drop out), m x U = 63 kN m s at 20 kt against the
    // tail rotor's N_r of about 12.5 kN m s at the 1 kN taxi trim (momentum theory, D: 0.14 kN per m/s at 20 kt edgewise), so
    // s = 0.9 /s (doubling 0.8 s) at 20 kt and 0.34 /s at 10 kt; stable only below about 5 kt. Measured: this pulse reaches
    // 27 deg/s at 1 s (0.48 g of turn, above the 0.40 g static tip-over of a 62 in track under a CG 77 in up) and the right
    // wingtip strikes at about 4 s. Tuning-round sweeps (W/tune/ah56/probes, KNOWN_ISSUES R1): swivel friction 100-600 N m
    // turns the castor into a deadband with a breakout (below 1-1.5 in no turn, above it 80-150 deg/s), path-dependent stuck
    // angles (11-88 deg after a turn) and both tests/gear/ah56TailWheel rows red at >= 100 N m; a swivel damper of 500-2000
    // N m s/rad lags the castor by only about 6 % at a 1 /s divergence while slowing walking-pace turns; trail 0.05 m and the
    // tyre ESTIMATES leave it. The row stays red with its measured number; the pilot-in-the-loop rows below are the P sense.
    const m = taxiPulse(false, 20, 1, 1);
    report('G13 taxi 20 kt, tail wheel unlocked, 1 in pulse 1 s', m);
    expect(m.crashed).toBe(false);
    expect(m.maxYawDegS).toBeLessThan(20);
  }, 120_000);

  /** The taxi pulse with a pilot on the pedals: `pulseIn` of left pedal for `pulseS` s, then a pilot who sees the heading and the
   *  yaw rate `delay` s late and answers with pedal (gain 2: 6.4 in of pedal per radian of heading error and per rad/s of yaw
   *  rate, about a third of the travel for 10 deg), inside the travel. The worst yaw rate and roll, the heading change after
   *  10 s, the peak pedal from the trim. */
  const taxiCatch = (kt: number, pulseIn: number, pulseS: number, delay: number) => {
    const r = rig({ onGround: true });
    r.c.collective = 0; r.c.tailWheelLock = false; r.c.parkingBrake = false;
    const h0 = r.fm.state.heading, p0 = r.c.rudder, pedalPerIn = 1 / 3.2;
    let yi = 0;
    const hold = () => { const s = r.fm.state, e = Math.atan2(Math.sin(s.heading - h0), Math.cos(s.heading - h0)); yi -= e * 0.5 / 240;
      r.c.rudder = Math.max(-1, Math.min(1, p0 - 3 * e - 1.0 * s.angularVelocity.z + yi)); };
    r.c.propLever = pusherBetaLever(d.pusher!, 8 * DEG);
    for (let t = 0; t < 40 && r.fm.state.groundSpeed < kt * KT; t += 0.25) run(r, 0.25, hold);
    r.c.propLever = pusherBetaLever(d.pusher!, 3 * DEG);
    run(r, 6, hold);
    const trim = r.c.rudder, hs = r.fm.state.heading, seen: { e: number; r: number }[] = [], lag = Math.round(delay * 240);
    let t = 0, yaw = 0, roll = 0, pedal = 0;
    run(r, 10, () => {
      t += 1 / 240;
      const s = r.fm.state;
      seen.push({ e: Math.atan2(Math.sin(s.heading - hs), Math.cos(s.heading - hs)), r: s.angularVelocity.z });
      const late = seen.length > lag ? seen.shift()! : undefined;
      r.c.rudder = t <= pulseS ? Math.max(-1, trim - pulseIn * pedalPerIn) : late ? Math.max(-1, Math.min(1, trim + 2 * (-late.e - late.r))) : trim;
      yaw = Math.max(yaw, Math.abs(s.angularVelocity.z)); roll = Math.max(roll, Math.abs(s.roll)); pedal = Math.max(pedal, Math.abs(r.c.rudder - trim) / pedalPerIn);
    });
    const s = r.fm.state;
    return { maxYawDegS: yaw / DEG, maxRollDeg: roll / DEG, headingChangeDeg: Math.abs(Math.atan2(Math.sin(s.heading - hs), Math.cos(s.heading - hs))) / DEG,
      peakPedalIn: pedal, crashed: s.crashed, crash: (r.fm as unknown as { crashReason?: string }).crashReason ?? '' };
  };

  // The P sense of para 79 ("directional control by tail rotor thrust ... excellent", unlocked to 20 kt): with the pilot on the pedals
  // the divergent free castor is caught. Tuning round (2026-10-22, W/tune/ah56/probes catch1.log): at 20 kt a 0.3 s reaction holds the
  // heading within 1.5 deg by 4 s on 2.2 in of pedal, 0.5 s within 15 deg (an oscillation), 0.7 s and slower is lost (wingtip); at
  // 10 kt 0.3 / 0.5 s hold, 0.7 s rings, 1.0 s spins it. Lock it for straight taxi above walking pace (para 79).
  it('tail wheel UNLOCKED, prop taxi at 20 kt: the same 1 in pulse with a pilot answering 0.3 s late: upright, heading back within 5 deg by 10 s, inside the pedal travel (P ASTA-72 para 79: directional control by the tail rotor)', () => {
    const m = taxiCatch(20, 1, 1, 0.3);
    report('G13 taxi 20 kt unlocked, 1 in pulse, pilot 0.3 s late', m);
    expect(m.crashed).toBe(false);
    expect(m.headingChangeDeg).toBeLessThan(5);
    expect(m.peakPedalIn).toBeLessThan(3.2);
  }, 120_000);

  it('tail wheel UNLOCKED, prop taxi at 10 kt: the 1 in pulse with a pilot answering 0.5 s late: upright, heading back within 5 deg by 10 s, inside the pedal travel', () => {
    const m = taxiCatch(10, 1, 1, 0.5);
    report('G13 taxi 10 kt unlocked, 1 in pulse, pilot 0.5 s late', m);
    expect(m.crashed).toBe(false);
    expect(m.headingChangeDeg).toBeLessThan(5);
    expect(m.peakPedalIn).toBeLessThan(3.2);
  }, 120_000);

  it('vertical take-off to a hover and a vertical landing on the wheels', () => {
    const r = rig({ onGround: true });
    const fly = pilot(r);
    let airborne = false, maxHeight = 0, touchdown = NaN, t = 0;
    // A hover pilot: the drift held with bank and pitch (the hover hangs about 5 deg left wing low), the collective on a
    // 300 ft/min climb to 5 m and a 150 ft/min descent back to the wheels.
    run(r, 45, () => {
      t += 1 / 240;
      const s = r.fm.state, h = s.altitudeAGL - d.skids.z, v = quat.rotateInv(s.orientation, s.velocity);
      if (!s.onGround) airborne = true;
      maxHeight = Math.max(maxHeight, h);
      const bank = s.onGround ? s.roll : Math.max(-12 * DEG, Math.min(12 * DEG, -5 * DEG - 0.05 * v.y));
      const pitch = s.onGround ? s.pitch : Math.max(-8 * DEG, Math.min(8 * DEG, -0.05 * v.x));
      fly(1 / 240, pitch, bank);
      const climb = t < 25 && maxHeight < 5 ? 300 : -150;
      r.c.collective = Math.min(1, Math.max(0, (r.c.collective ?? 0) + 0.03 * (climb * FT / 60 - s.verticalSpeed) / 240));
      if (airborne && s.onGround && Number.isNaN(touchdown)) touchdown = Math.max(0, -s.verticalSpeed);
    });
    const s = r.fm.state;
    report('G13 vertical take-off and landing', { airborne, maxHeightM: maxHeight, touchdownSinkMs: touchdown, onGround: s.onGround,
      crashed: s.crashed, crash: (r.fm as unknown as { crashReason: string }).crashReason });
    expect(airborne).toBe(true);
    expect(maxHeight).toBeGreaterThan(3);
    expect(s.crashed).toBe(false);
    expect(s.onGround).toBe(true);
  });

  it('the gear cycles up and down in 3-8 s (ESTIMATE 6 s) in the hover', () => {
    const r = rig({ height: 300, gearDown: true });
    const fly = pilot(r);
    const cycle = (lever: 'up' | 'down') => {
      r.c.gearLever = lever;
      let t = 0, done = NaN;
      run(r, 12, () => {
        fly(1 / 240); t += 1 / 240;
        const g = r.fm.state.gear;
        if (Number.isNaN(done) && !g.inTransit && g.extension.every((x) => x === (lever === 'up' ? 0 : 1))) done = t;
      });
      return done;
    };
    const up = cycle('up'), down = cycle('down');
    report('G13 gear cycle', { upS: up, downS: down, target: '3-8' });
    for (const t of [up, down]) { expect(t).toBeGreaterThanOrEqual(3); expect(t).toBeLessThanOrEqual(8); }
  });

  it('G13: the gear-overspeed flag above 130 KCAS (P limit)', () => {
    // AG's contract request to TW, applied by the integrator at the AG merge: flightModel.ts checkStructure runs
    // checkOverspeed's gear rule for a retractable rotorcraft too (the row was it.fails KNOWN GAP on rigid/ag).
    const r = rig({ kt: 140, gearDown: true });
    const fly = pilot(r);
    run(r, 3, () => fly(1 / 240));
    expect(r.fm.overspeed.gear).toBe(true);
  });

  it('from a 60 KCAS run-on landing, the wheel brakes stop it within 300 m (P: "main-gear brakes"; reverse pitch is stage 4)', () => {
    const r = rig({ kt: 60, height: d.skids.z + 1.0, gearDown: true });
    const fly = pilot(r);
    let touch = NaN, t = 0;
    const start = { ...r.fm.state.position };
    let from = start;
    run(r, 40, () => {
      t += 1 / 240;
      const s = r.fm.state;
      if (Number.isNaN(touch) && s.onGround) { touch = t; from = { ...s.position }; }
      if (Number.isNaN(touch)) {
        // Settle onto the wheels: hold the attitude, ease the collective down.
        fly(1 / 240, 0, 0);
        r.c.collective = Math.max(0, (r.c.collective ?? 0) - 0.05 / 240);
      } else {
        // On the wheels: collective down, the stick at the rest attitude, both brakes full.
        fly(1 / 240, 0, 0);
        r.c.collective = Math.max(0, (r.c.collective ?? 0) - 0.5 / 240);
        r.c.brakeLeft = r.c.brakeRight = 1;
      }
    });
    const s = r.fm.state, dist = Math.hypot(s.position.x - from.x, s.position.y - from.y);
    report('G13 run-on stop', { touchdownKias: 0, touchdownAtS: touch, stopDistanceM: dist, groundSpeedKt: s.groundSpeed / KT, target: '<= 300 m',
      crashed: s.crashed, pitchDeg: s.pitch / DEG });
    expect(s.crashed).toBe(false);
    expect(s.groundSpeed).toBeLessThan(0.5);
    expect(dist).toBeLessThanOrEqual(300);
  });

  it('the parking brake holds the aircraft at ground idle', () => {
    const r = rig({ onGround: true });
    r.c.throttle = d.systems.turboshaft!.grip.groundIdle;
    r.c.parkingBrake = true;
    const p0 = { ...r.fm.state.position };
    run(r, 20);
    const s = r.fm.state, drift = Math.hypot(s.position.x - p0.x, s.position.y - p0.y);
    report('G13 parking brake at ground idle', { driftM: drift, ngPct: gauges(r).ng, nrPct: gauges(r).nr });
    expect(drift).toBeLessThan(0.2);
  });
});

describe('the hover readout (plan flights "AH-56 hover readout"): 20 s hands-off from the 15 m hover spawn, calm air', () => {
  const hover = (config: 'amcs' | 'ics') => {
    const weather = { ...defaultWeather(), windSpeedKt: 0, turbulence: 0, gustKt: 0 };
    const p = new SimPhysics({ aircraft: AH56_DEFINITION, weather, rotorcraftConfig: config });
    // The raw aircraft: the profile's STAB ASSIST sim aid (ON by default since the tuning round, KNOWN_ISSUES T8) is off here.
    p.stabilityAssistOn = () => false;
    p.resetTo(hoverScenario(p.env, d), weather);
    const roll0 = p.state.roll, heading0 = p.state.heading;
    p.step(20);
    const s = p.state, headingChangeDeg = Math.abs(Math.atan2(Math.sin(s.heading - heading0), Math.cos(s.heading - heading0))) / DEG;
    report(`hover readout ${config} after 20 s hands-off`, { rollStartDeg: roll0 / DEG, rollDeg: s.roll / DEG, pitchDeg: s.pitch / DEG,
      groundSpeedKt: s.groundSpeed / KT, headingChangeDeg, nrRpm: s.rotorcraft!.rotorRpm, target: 'roll -7..-2 (G9), Nr 239.85 / 246 +/- 2' });
    return Object.assign(s, { headingChangeDeg });
  };
  it('Nr and the gyro mode hold (AMCS 239.85, ICS 246 rpm +/- 2) and nothing crashes', () => {
    for (const config of ['amcs', 'ics'] as const) {
      const s = hover(config);
      expect(s.crashed).toBe(false);
      expect(s.rotorcraft!.controlGyro!.mode).toBe(config);
      expect(Math.abs(s.rotorcraft!.rotorRpm - (config === 'amcs' ? 239.85 : 246))).toBeLessThanOrEqual(2);
      const g = s.rotorcraft!.controlGyro!, t = gyroDef.configs[config].maxTilt;
      expect(g.pitch).toBeLessThanOrEqual(t.up); expect(g.pitch).toBeGreaterThanOrEqual(-t.down);
      expect(g.roll).toBeLessThanOrEqual(t.right); expect(g.roll).toBeGreaterThanOrEqual(-t.left);
    }
  }, 60000);
  it('the hands-off hover stays 2-7 deg left wing low for 20 s (G9 band; was KNOWN GAP until the in-plane force became a vector)', () => {
    // Until the final fix round the trim balanced the rotor at exactly zero airspeed, where Rotorcraft.compute applied the hingeless
    // rotor's hover in-plane force (about 330 N) along the first step's 1e-7 m/s of drift: the AMCS rolled -5.4 -> -1.9 deg with
    // +10.7 deg of pitch and 14.3 kt in 20 s, the ICS -5.3 -> -10.5 deg, 6.6 kt. The force is now applied as a vector in the BEM's
    // own wind frame (rotorcraft.ts inPlaneForce): AMCS -5.35 -> -5.49 deg, +0.76 deg pitch, 0.41 kt; ICS -5.25 -> -5.13 deg, +0.53
    // deg, 0.31 kt.
    const rolls = (['amcs', 'ics'] as const).map((config) => hover(config).roll);
    for (const roll of rolls) {
      expect(roll).toBeLessThanOrEqual(-2 * DEG);
      expect(roll).toBeGreaterThanOrEqual(-7 * DEG);
    }
  }, 60000);
  it('the hands-off hover holds its heading within 5 deg and drifts under 2 kt in 20 s (pilot reviews 1-2: 44 deg and 5.6 kt before the vector in-plane force)', () => {
    // Tuning round (2026-10-22, KNOWN_ISSUES T4): the reviews' 44 deg of heading and 5.6 kt (AMCS), 17.5 deg and 4.7 kt (ICS) were the
    // zero-airspeed in-plane force; re-measured after the final fix round (W/tune/ah56/probes out/hover-r1.log, the 10 ft IGE trim):
    // AMCS -0.6 deg and 0.3 kt, ICS -0.6 deg and 0.3 kt. No plan band: a regression row.
    for (const config of ['amcs', 'ics'] as const) {
      const s = hover(config);
      expect(s.headingChangeDeg).toBeLessThan(5);
      expect(s.groundSpeed / KT).toBeLessThan(2);
    }
  }, 60000);
});

describe('G15: every scenario spawns on the wheels and survives 5 s, in both configurations', () => {
  for (const config of [undefined, 'ics'] as const) for (const id of SCENARIO_IDS) it(`${id} (${config ?? 'amcs default'})`, () => {
    const p = new SimPhysics({ aircraft: AH56_DEFINITION, weather: { ...defaultWeather(), turbulence: 0, gustKt: 0 }, ...(config ? { rotorcraftConfig: config } : {}) });
    p.reset(id);
    p.step(5);
    const s = p.state;
    expect(s.crashed).toBe(false);
    expect(s.rotorcraft!.controlGyro!.mode).toBe(config ?? 'amcs');
    if (id === 'runway' || id === 'apron') expect(s.wheels.every((w) => w.onGround)).toBe(true);
  }, 60000);
});

describe('RotorClearance (the wheeled rotorcraft\'s strike checks, extracted from the skids)', () => {
  const pose = wheelRestingPose(AH56_DEFINITION.geometry.gear, 8301, v3.zero());
  const body = (rollDeg: number) => ({ time: 0, position: { x: 0, y: 0, z: -pose.height }, orientation: quat.fromEuler(rollDeg * DEG, 0, 0),
    velocityBody: v3.zero(), angularVelocity: v3.zero(), cgOffset: v3.zero(), mass: 8301 });
  it('level on the wheels: clear; rolled far over: the main rotor strikes', () => {
    const c = new RotorClearance(d), s = emptyRotorcraftState();
    expect(c.check(body(0), s, pose.height)).toBeNull();
    const rolled = c.check(body(40), s, pose.height * Math.cos(40 * DEG));
    report('RotorClearance', { level: 'clear', rolled40: rolled ?? 'clear', restHeightM: pose.height, gearLimitKcas: AH56_REFERENCE.gearKcas });
    expect(rolled).toBe('Main rotor strike');
  });
});
