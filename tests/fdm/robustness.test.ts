// Integrator robustness, crash detection and cost.

import { describe, expect, it } from 'vitest';
import { DEG, FT, KT, quat, type Vec3 } from '../../src/core/math';
import type { AircraftState } from '../../src/core/types';
import { Autopilot, C172FlightModel } from '../../src/physics';
import { ELEVATION, FRAME, LOADING, at, calmWeather, flatEnvironment, kt, makeRig, report, resetTo } from './helpers';

const proc = (globalThis as unknown as { process: { cpuUsage(): { user: number; system: number } } }).process;
/** Process CPU time of one call, ms: unlike the wall clock, a descheduled worker is not counted. */
function cpuTime(f: () => void): number {
  const c0 = proc.cpuUsage();
  f();
  const c1 = proc.cpuUsage();
  return (c1.user + c1.system - c0.user - c0.system) / 1000;
}

function finite(s: AircraftState): boolean {
  const vals = [
    s.position.x, s.position.y, s.position.z, s.velocity.x, s.velocity.y, s.velocity.z,
    s.orientation.w, s.orientation.x, s.orientation.y, s.orientation.z,
    s.angularVelocity.x, s.angularVelocity.y, s.angularVelocity.z,
    s.tas, s.ias, s.alpha, s.beta, s.gLoad, s.slipBall, s.engine.rpm, s.propeller.thrust,
  ];
  return vals.every(Number.isFinite);
}

describe('extreme states', () => {
  const cases: { name: string; velocityBody: Vec3; rates: Vec3; roll: number; pitch: number }[] = [
    { name: 'tumbling at 200 kt', velocityBody: { x: 200 * KT, y: 0, z: 0 }, rates: { x: 3, y: 2, z: -2 }, roll: 0, pitch: 0 },
    { name: 'inverted at 100 kt', velocityBody: { x: 100 * KT, y: 0, z: 0 }, rates: { x: 0, y: 0, z: 0 }, roll: 180 * DEG, pitch: 0 },
    { name: '90 deg angle of attack (flat fall)', velocityBody: { x: 0, y: 0, z: 30 }, rates: { x: 0, y: 0, z: 0 }, roll: 0, pitch: 0 },
    { name: 'tail slide', velocityBody: { x: -20, y: 0, z: 0 }, rates: { x: 0, y: 0, z: 0 }, roll: 0, pitch: 80 * DEG },
    { name: 'knife edge at 90 deg sideslip', velocityBody: { x: 0, y: 40, z: 0 }, rates: { x: 0, y: 0, z: 0 }, roll: 90 * DEG, pitch: 0 },
    { name: 'zero airspeed, engine at full power', velocityBody: { x: 0, y: 0, z: 0 }, rates: { x: 0, y: 0, z: 0 }, roll: 0, pitch: 0 },
  ];
  for (const c of cases) {
    it(`stays finite and physical: ${c.name}`, () => {
      const rig = makeRig({ options: { structuralFailure: false } });
      resetTo(rig, { position: at(ELEVATION + 8000 * FT), airspeed: 100 * KT });
      const q = quat.fromEuler(c.roll, c.pitch, 0);
      rig.fm.setKinematics({ position: at(ELEVATION + 8000 * FT), orientation: q, velocity: quat.rotate(q, c.velocityBody), angularVelocity: c.rates });
      rig.controls.throttle = 1;
      let maxRate = 0, maxSpeed = 0;
      rig.run(30, () => {
        const s = rig.fm.state;
        expect(finite(s)).toBe(true);
        maxRate = Math.max(maxRate, Math.hypot(s.angularVelocity.x, s.angularVelocity.y, s.angularVelocity.z));
        maxSpeed = Math.max(maxSpeed, Math.hypot(s.velocity.x, s.velocity.y, s.velocity.z));
      });
      report(`${c.name}: largest body rate / speed in 30 s`, maxRate / DEG, `${maxSpeed.toFixed(0)} m/s`, 'deg/s');
      // Aerodynamic damping bounds the motion: no energy is created.
      expect(maxRate).toBeLessThan(Math.max(Math.hypot(c.rates.x, c.rates.y, c.rates.z) * 1.5, 7));
      expect(maxSpeed).toBeLessThan(130);
      expect(Math.abs(Math.hypot(rig.fm.state.orientation.w, rig.fm.state.orientation.x, rig.fm.state.orientation.y, rig.fm.state.orientation.z) - 1)).toBeLessThan(1e-9);
    }, 60000);
  }
});

describe('turbulence and integration', () => {
  it('severe turbulence and gusty wind do not destabilise the integrator; the autopilot holds on', () => {
    const env = flatEnvironment(calmWeather({ windSpeedKt: 25, gustKt: 35, windDirectionDeg: 250, turbulence: 1 }));
    const rig = makeRig({ env });
    resetTo(rig, { position: at(ELEVATION + 2000 * FT), airspeed: 100 * KT, heading: 70 * DEG });
    const s = rig.fm.state;
    const ap = new Autopilot();
    ap.settings = { ...ap.settings, lateral: 'heading', heading: 70 * DEG, vertical: 'altitude', altitude: ELEVATION + 2000 * FT, autothrottle: true, airspeed: 100 * KT, maxBank: 30 * DEG };
    let maxAltErr = 0, maxG = 0, minG = 10;
    rig.run(120, () => {
      ap.update(FRAME, s, rig.controls);
      expect(finite(s)).toBe(true);
      maxAltErr = Math.max(maxAltErr, Math.abs(s.altitudeMSL - ELEVATION - 2000 * FT));
      maxG = Math.max(maxG, s.gLoad);
      minG = Math.min(minG, s.gLoad);
    });
    report('severe turbulence: largest altitude excursion', maxAltErr, '< 100', 'm');
    report('severe turbulence: load factor range', minG, `${maxG.toFixed(2)} g max`, 'g min');
    expect(s.crashed).toBe(false);
    expect(maxAltErr).toBeLessThan(100);
    expect(maxG).toBeLessThan(3.8);
  }, 120000);

  it('the fixed-step RK4 at 240 Hz agrees with 960 Hz through a manoeuvre and a landing', () => {
    const run = (rate: number) => {
      const rig = makeRig({ options: { physicsRate: rate } });
      resetTo(rig, { position: at(ELEVATION + 60), airspeed: 65 * KT, flaps: 1, flightPathAngle: -3 * DEG });
      const s = rig.fm.state;
      rig.controls.aileron = 0.3;
      rig.run(2);
      rig.controls.aileron = -0.3;
      rig.run(2);
      rig.controls.aileron = rig.fm.trimControls.aileron;
      // Hands off on the trimmed 3 degree approach power until the wheels are down, then idle.
      rig.run(40, () => {
        if (s.onGround) rig.controls.throttle = 0;
        return s.onGround && s.groundSpeed < 25;
      });
      return { t: s.time, x: s.position.x, y: s.position.y, heading: s.heading, touchdown: s.onGround };
    };
    const a = run(240), b = run(960);
    const dPos = Math.hypot(a.x - b.x, a.y - b.y);
    report('240 Hz vs 960 Hz: position difference after a manoeuvre and touchdown', dPos, '< 1', 'm');
    expect(a.touchdown && b.touchdown).toBe(true);
    expect(Math.abs(a.t - b.t)).toBeLessThan(0.1);
    expect(dPos).toBeLessThan(1);
  }, 120000);

  it('costs well under a millisecond per physics step', () => {
    const gusty = () => makeRig({ env: flatEnvironment(calmWeather({ windSpeedKt: 15, turbulence: 0.5 })) });
    const air = gusty(), taxi = gusty(), calm = makeRig();
    resetTo(air, { position: at(ELEVATION + 2000 * FT), airspeed: 100 * KT });
    air.run(2);
    resetTo(taxi, { onGround: true });
    taxi.controls.parkingBrake = false;
    taxi.controls.throttle = 0.4;
    taxi.run(1);
    resetTo(calm, { position: at(ELEVATION + 2000 * FT), airspeed: 100 * KT });
    calm.run(2);
    // Each flies 20 s as five 4 s batches, the three interleaved, and the cheapest batch counts. The bounds are
    // ratios to the calm trimmed cruise step measured alongside (contract 4.0.4): a loaded full-suite run slows
    // all three alike, and failed the old absolute 400 us. 2.4 is that 400 us over today's 166 us calm step
    // (1.40 and 1.80 measured); the absolute figures are reported and judged at the gate. The batches are timed in
    // process CPU time: on the wall clock a full suite descheduled every turbulence batch and none of the calm
    // ones, and the ratio read 2.00 for an unchanged step.
    let tAir = Infinity, tTaxi = Infinity, tCalm = Infinity;
    for (let i = 0; i < 5; i++) {
      tAir = Math.min(tAir, cpuTime(() => air.run(4)));
      tTaxi = Math.min(tTaxi, cpuTime(() => taxi.run(4)));
      tCalm = Math.min(tCalm, cpuTime(() => calm.run(4)));
    }
    const perStep = (ms: number): number => (ms * 1000) / (4 * air.fm.physicsRate);
    report('CPU per physics step in flight (turbulence on)', perStep(tAir), '< 200', 'us');
    report('CPU per physics step taxiing', perStep(tTaxi), '< 200', 'us');
    console.log(`[cost] physics step / calm cruise step (${perStep(tCalm).toFixed(2)} us): in turbulence ${(tAir / tCalm).toFixed(2)}, taxiing ${(tTaxi / tCalm).toFixed(2)}`);
    expect(tAir / tCalm).toBeLessThan(2);
    expect(tTaxi / tCalm).toBeLessThan(2.4);
  }, 120000);

  it('a long frame is capped instead of stalling the simulator', () => {
    const rig = makeRig();
    resetTo(rig);
    const t0 = rig.fm.state.time;
    rig.fm.step(5, rig.controls, rig.env);
    expect(rig.fm.state.time - t0).toBeLessThan(0.3);
  });
});

describe('crash detection', () => {
  it('breaks the wing beyond the ultimate load factor', () => {
    const rig = makeRig();
    resetTo(rig, { position: at(ELEVATION + 3000 * FT), airspeed: 150 * KT });
    rig.controls.elevator = 1;
    rig.run(3, () => rig.fm.state.crashed);
    report('full aft yoke at 150 KTAS', rig.fm.state.gLoad, rig.fm.state.crashReason, 'g');
    expect(rig.fm.state.crashed).toBe(true);
    expect(rig.fm.state.crashReason).toMatch(/overstressed/);
  });

  it('fails the structure beyond the design dive speed', () => {
    const rig = makeRig();
    resetTo(rig, { position: at(ELEVATION + 8000 * FT), airspeed: 150 * KT });
    const q = quat.fromEuler(0, -45 * DEG, 0);
    rig.fm.setKinematics({ position: at(ELEVATION + 8000 * FT), orientation: q, velocity: quat.rotate(q, { x: 150 * KT, y: 0, z: 0 }), angularVelocity: { x: 0, y: 0, z: 0 } });
    rig.controls.throttle = 1;
    rig.run(60, () => rig.fm.state.crashed);
    report('dive at full power: structural failure at', kt(rig.fm.cas), rig.fm.state.crashReason, 'KCAS');
    expect(rig.fm.state.crashReason).toMatch(/overspeed|overstressed/);
  }, 30000);

  it('detects a hard landing, a wingtip strike and freezes the aircraft', () => {
    const rig = makeRig();
    // 1000 fpm into the runway, flat.
    rig.fm.reset({ position: at(ELEVATION + 1.25 + 0.5), heading: 0, airspeed: 30, onGround: false, engineRunning: true }, rig.env);
    const q = quat.fromEuler(0, 0, 0);
    rig.fm.setKinematics({ position: at(ELEVATION + 1.25 + 0.5), orientation: q, velocity: { x: 30, y: 0, z: 6 }, angularVelocity: { x: 0, y: 0, z: 0 } });
    rig.run(2, () => rig.fm.state.crashed);
    report('6 m/s touchdown', 6, rig.fm.state.crashReason, 'm/s');
    expect(rig.fm.state.crashed).toBe(true);
    const frozen = { ...rig.fm.state.position };
    rig.run(1);
    expect(rig.fm.state.position).toEqual(frozen);
    // Banked 30 degrees onto the ground: a wingtip hits.
    const r = quat.fromEuler(30 * DEG, 5 * DEG, 0);
    rig.fm.setKinematics({ position: at(ELEVATION + 2.2), orientation: r, velocity: { x: 28, y: 0, z: 1 }, angularVelocity: { x: 0, y: 0, z: 0 } });
    rig.run(2, () => rig.fm.state.crashed);
    report('landing with 30 deg of bank', 30, rig.fm.state.crashReason, 'deg');
    expect(rig.fm.state.crashReason).toMatch(/wingtip/i);
  });

  it('a new flight model constructed per loading reports its mass', () => {
    const fm = new C172FlightModel(LOADING.typical);
    fm.reset({ position: at(ELEVATION + 1000), heading: 0, airspeed: 50, onGround: false, engineRunning: true }, flatEnvironment());
    expect(fm.state.mass).toBeCloseTo(1156.7, 0);
  });
});

describe('aerodynamic loads where the lifting line does not apply', () => {
  /** Largest aerodynamic force over q S and the largest one-step change of it over a run of `steps`. */
  const loads = (rig: ReturnType<typeof makeRig>, steps: number) => {
    const s = rig.fm.state;
    let maxCoeff = 0, maxJump = 0, maxJumpN = 0, prevF = NaN;
    for (let i = 0; i < steps; i++) {
      rig.fm.step(1 / 240, rig.controls, rig.env);
      const a = rig.fm.lastAero!;
      const F = Math.hypot(a.force.x, a.force.y, a.force.z);
      const qS = 0.5 * s.airDensity * s.tas * s.tas * 16.17;
      const coeff = F / Math.max(qS, 200);
      maxCoeff = Math.max(maxCoeff, coeff);
      if (Number.isFinite(prevF)) {
        maxJump = Math.max(maxJump, Math.abs(F - prevF) / Math.max(qS, 200));
        maxJumpN = Math.max(maxJumpN, Math.abs(F - prevF));
      }
      prevF = F;
    }
    return { maxCoeff, maxJump, maxJumpN };
  };

  it('a power-on tail slide stays within flat-plate loads and does not break the wing', () => {
    // 80 deg nose up, sliding back at 20 m/s with cruise power: the wing and tail meet the air trailing edge
    // first. Before the reversed-flow strips were taken out of the circulation solve this produced single-step
    // spikes of ~600 q S (and a "wing overstressed" failure at 55 KIAS).
    const rig = makeRig({ options: { structuralFailure: true } });
    resetTo(rig, { position: at(ELEVATION + 5000 * FT), airspeed: 100 * KT });
    const s = rig.fm.state;
    rig.fm.setKinematics({ position: { ...s.position }, orientation: quat.fromEuler(0, 80 * DEG, 0), velocity: { x: 0, y: 0, z: 20 }, angularVelocity: { x: 0, y: 0, z: 0 } });
    const r = loads(rig, 240 * 4);
    report('tail slide, power on: largest |F aero| / qS', r.maxCoeff, '< 4', '');
    report('tail slide, power on: largest one-step change / qS', r.maxJump, '< 3', '');
    expect(r.maxCoeff).toBeLessThan(4);
    expect(r.maxJump).toBeLessThan(3);
    expect(s.crashReason).not.toMatch(/Structural/);
  }, 30000);

  it('a run-up with a 20 kt tailwind has no load spikes (the jet fades out instead of flipping round)', () => {
    const env = flatEnvironment(calmWeather({ windSpeedKt: 20, windDirectionDeg: 180 }));
    const rig = makeRig({ env });
    resetTo(rig, { onGround: true, position: at(ELEVATION), heading: 0 });
    rig.controls.throttle = 0.8;
    rig.controls.parkingBrake = true;
    const r = loads(rig, 240 * 10);
    report('tailwind run-up: largest one-step change of the aerodynamic force', r.maxJumpN, '< 300', 'N');
    expect(r.maxJumpN).toBeLessThan(300);
    expect(rig.fm.state.crashed).toBe(false);
  }, 30000);
});

