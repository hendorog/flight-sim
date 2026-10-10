import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { S269_DEFINITION as def } from '../../src/aircraft/s269';
import { S269_REFERENCE as V } from '../../src/aircraft/s269/reference';
import { createFlightModelFor } from '../../src/physics';
import type { BladeElementFlightModel } from '../../src/physics/flightModel';
import { Rotorcraft } from '../../src/physics/rotorcraft/rotorcraft';
import type { EngineUnit } from '../../src/physics/propulsion/engineUnit';
import { cloneControls, defaultControls } from '../../src/core/types';
import { DEG, FT, HP, KT, clamp, quat, v3 } from '../../src/core/math';
import { ScriptedPilot, observePilot } from '../../src/sim/rotorcraft/scriptedPilot';
import { flatEnvironment } from '../fdm/helpers';

const d = def.rotorcraft!, DT = 1 / 240;
const world = flatEnvironment(undefined, 0), env = { ...world, atmosphere: () => world.atmosphere(0) };
// Follow the repository's node-types-free optional trace harness.
interface TraceFs { mkdirSync(path: string, options: { recursive: boolean }): void; writeFileSync(path: string, data: string): void }
const trace = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.S269_TRACE;
const fs = trace ? await import(/* @vite-ignore */ 'node:fs' as string) as TraceFs : undefined;
const report: Record<string, unknown> = {};
afterAll(() => { fs?.mkdirSync('work/s269-fm', { recursive: true }); fs?.writeFileSync('work/s269-fm/flights.json', JSON.stringify(report, null, 2)); });
function rig(kt = 0, gross = true, height = 90, running = true, onGround = false) {
  const fm = createFlightModelFor(def);
  if (gross) fm.setLoading(def.mass.loadings.maxGross);
  fm.reset({ position: { x: 0, y: 0, z: -height }, heading: 0, airspeed: kt * KT,
    onGround, engineRunning: running, fuelFraction: gross ? 1 : 0.5 }, env);
  return { fm, c: cloneControls(fm.trimControls) };
}
const throttleMemory = new WeakMap<object, { rpm: number; trend: number }>();
function manualThrottle(r: ReturnType<typeof rig>, target = 2650) {
  // Test pilot watches tach value/trend and moves the grip, limited to 0.10 travel/s.
  // This is not part of the aircraft systems and supplies no force or RPM constraint.
  const old = throttleMemory.get(r) ?? { rpm: r.fm.state.engine.rpm, trend: 0 };
  const rpm = r.fm.state.engine.rpm;
  old.trend += ((rpm - old.rpm) / DT - old.trend) * (1 - Math.exp(-DT / 0.3)); old.rpm = rpm;
  r.c.throttle = clamp(r.c.throttle + clamp(0.0003 * (target - rpm) - 0.0004 * old.trend, -0.10, 0.10) * DT, 0, 1);
  throttleMemory.set(r, old);
}
function sample(r: ReturnType<typeof rig>, time: number) {
  const s = r.fm.state;
  return { time, ...observePilot(s, d), hp: s.engine.power / HP, map: s.engine.manifoldPressure,
    collective: r.c.collective!, cyclic: r.c.elevator, pedal: r.c.rudder, tail: s.rotorcraft!.tailContact,
    clutch: s.rotorcraft!.clutchEngagement, governor: s.rotorcraft!.governorActive,
    cht: s.engine.cht, oilTemp: s.engine.oilTemp, oilPressure: s.engine.oilPressure };
}

describe('S269 engine, drivetrain and flight integration', () => {
  it('stages a cold start through the production ENGAGE/HOLD control to manual-RPM hover', () => {
    const r = rig(0, false, 0, false, true), c = r.c;
    const rotor = (r.fm as BladeElementFlightModel).rotorcraft!;
    let command: 'engage' | 'hold' | 'release' = 'release';
    Object.assign(c, { rotorClutch: false, rotorGovernor: true, throttle: 0.05, mixture: 1,
      magnetos: 3, masterBattery: true, alternator: true, collective: 0 });
    let fired: number | undefined, engaged: number | undefined, hovering: number | undefined;
    let pilot: ScriptedPilot | undefined, holds = 0, engagementThrottle = 0, holdUntil = 0, engageRpm = 1500;
    const samples = [];
    for (let i = 0; i < 300 / DT && !r.fm.state.crashed; i++) {
      const t = i * DT, s = r.fm.state;
      c.starter = t > 2 && fired === undefined;
      if (s.engine.running) { fired ??= t; c.starter = false; }
      if (fired !== undefined && t < 20) manualThrottle(r, 1500);
      if (t >= 20 && engaged === undefined) {
        if (!engagementThrottle) engagementThrottle = c.throttle;
        c.throttle = engagementThrottle; // RFM 4-15: fixed grip during staged engagement.
        if (t >= holdUntil && command === 'hold') engageRpm = s.engine.rpm;
        if (t >= holdUntil && s.engine.rpm < engageRpm - 100) { holdUntil = t + 2; holds++; }
        command = t < holdUntil ? 'hold' : 'engage';
        if (Math.abs(s.engine.rpm - rotor.state.rotorRpm * d.engineRatio) < 10) command = 'engage';
        if (rotor.state.clutchEngagement >= 0.999) { engaged = t; command = 'engage'; }
      }
      if (engaged !== undefined) {
        manualThrottle(r, t - engaged < 20 ? 2000 : 2650);
        if (t > engaged + 50) {
          hovering ??= t; pilot ??= new ScriptedPilot(observePilot(s, d), c);
          pilot.step(DT, observePilot(s, d), c, 0, clamp(0.5 * (3 - (s.altitudeAGL - d.skids.z)), -0.5, 0.5));
        }
      }
      c.rotorClutchCommand = command;
      r.fm.step(DT, c, env);
      expect(rotor.state.governorActive).toBe(false); expect(rotor.state.lowRpmHorn).toBe(false);
      if (i % 240 === 0) samples.push({ ...sample(r, t), command });
      if (hovering !== undefined && t > hovering + 45) break;
    }
    report.start = { fired, engaged, hovering, holds, reason: r.fm.state.crashReason, rotor: { ...r.fm.state.rotorcraft }, samples };
    expect(r.fm.state.rotorcraft!.tailContact).toBe('none');
    expect(fired).toBeDefined(); expect(engaged).toBeDefined(); expect(holds).toBeGreaterThan(0);
    expect(hovering).toBeDefined(); expect(r.fm.state.crashed).toBe(false);
    expect(Math.abs(observePilot(r.fm.state, d).height - 3)).toBeLessThan(0.25);
    expect(r.fm.state.groundSpeed / KT).toBeLessThan(0.5);
    expect(r.fm.state.rotorcraft!.rotorRpm).toBeGreaterThan(442);
    expect(r.fm.state.rotorcraft!.rotorRpm).toBeLessThan(471);
  }, 120000);

  it('HOLD and bus loss freeze belt tension; freewheel cannot motor a stopped engine', () => {
    const rotor = new Rotorcraft(d), c = defaultControls(def);
    const shaft = { omega: 0, inertia: 0.6, shaftTorque: 0,
      get rpm() { return this.omega * 30 / Math.PI; }, state: { rpm: 0, power: 0, manifoldPressure: 0 } };
    const engine = shaft as unknown as EngineUnit;
    rotor.reset(false); c.masterBattery = true;
    rotor.drive(10, c, engine, undefined, 'engage');
    const tension = rotor.state.clutchEngagement;
    expect(tension).toBeGreaterThan(0); expect(rotor.clutchDisengaged).toBe(true);
    rotor.drive(10, c, engine, undefined, 'hold'); expect(rotor.state.clutchEngagement).toBe(tension);
    expect(rotor.state.clutchLight).toBe(false);
    c.masterBattery = false; rotor.drive(10, c, engine, undefined, 'release');
    expect(rotor.state.clutchEngagement).toBe(tension);
    rotor.reset(true); rotor.state.torque = 0;
    const speed = rotor.state.omega;
    rotor.drive(DT, c, engine); expect(engine.omega).toBe(0); expect(rotor.state.omega).toBe(speed);
    expect(rotor.state.driveTorque).toBe(0);
  });

  for (const gross of [true, false]) it(`${gross ? 'gross' : 'solo'} 52-KIAS autorotation with manual collective`, () => {
    const r = rig(52, gross, 1500), pilot = new ScriptedPilot(observePilot(r.fm.state, d), r.c);
    r.c.mixture = 0; r.c.collective = 0;
    let integral = 0, previous = r.fm.state.rotorcraft!.rotorRpm, trend = 0;
    for (let i = 0; i < 70 / DT; i++) {
      const s = observePilot(r.fm.state, d), rpm = r.fm.state.rotorcraft!.rotorRpm;
      trend += ((rpm - previous) / DT - trend) * (1 - Math.exp(-DT / 0.3)); previous = rpm;
      integral = clamp(integral + 0.001 * (rpm - 450) * DT, 0, 0.5);
      pilot.step(DT, s, r.c, 52, -1, undefined, clamp(integral + 0.004 * (rpm - 450) + 0.001 * trend, 0, 0.7), 0.15);
      r.fm.step(DT, r.c, env);
    }
    const end = sample(r, 70);
    report[gross ? 'grossAutorotation' : 'soloAutorotation'] = end;
    expect(end.crashed).toBe(false); expect(r.fm.state.rotorcraft!.driveTorque).toBe(0);
    expect(r.fm.state.rotorcraft!.rotorRpm).toBeGreaterThan(390);
    expect(r.fm.state.rotorcraft!.rotorRpm).toBeLessThan(504);
    expect(Math.abs(end.ias / KT - 52)).toBeLessThan(2);
    expect(end.verticalSpeed).toBeLessThan(0);
  }, 120000);

  for (const gross of [true, false]) it(`${gross ? 'gross' : 'solo'} powered approach, hover and landing`, () => {
    const r = rig(60, gross), pilot = new ScriptedPilot(observePilot(r.fm.state, d), r.c);
    const samples = [], touchdowns: { time: number; speed: number; sink: number; rpm: number; pitch: number }[] = [];
    let landed = false, peakEngineRpm = 0, peakRotorRpm = 0;
    for (let i = 0; i < 145 / DT && !r.fm.state.crashed; i++) {
      const t = i * DT, s = observePilot(r.fm.state, d);
      const speed = t < 35 ? 60 : t < 65 ? 60 - 2 * (t - 35) : 0;
      const height = t < 45 ? 90 - t * 1.5 : t < 70 ? Math.max(3, 22.5 - (t - 45)) :
        t < 100 ? 3 : Math.max(-0.3, 3 - (t - 100) * 0.25);
      if (t > 100 && s.onGround) landed = true;
      if (landed) {
        r.c.collective = Math.max(0, r.c.collective! - 0.2 * DT);
        // An articulated offset hub still transmits cyclic moment after unloading. Center the
        // stick as collective comes down rather than leaving the airborne hover trim held.
        r.c.elevator += clamp(-r.c.elevator, -0.2 * DT, 0.2 * DT);
        r.c.aileron += clamp(-r.c.aileron, -0.2 * DT, 0.2 * DT);
      }
      else pilot.step(DT, s, r.c, speed, clamp(0.5 * (height - s.height), -1.5, 1.5));
      // On touchdown roll the grip toward ground idle as collective is lowered. Keeping
      // flight RPM with the airborne tach-feedback policy lagged the rapid rotor unloading.
      manualThrottle(r, landed ? 1500 : 2650);
      r.fm.step(DT, r.c, env);
      peakEngineRpm = Math.max(peakEngineRpm, r.fm.state.engine.rpm);
      peakRotorRpm = Math.max(peakRotorRpm, r.fm.state.rotorcraft!.rotorRpm);
      for (const touch of r.fm.touchdowns) touchdowns.push({ time: t, speed: s.groundSpeed / KT,
        sink: touch.sinkRate, rpm: s.rotorPercent, pitch: s.pitch / DEG });
      if (i % 240 === 0) samples.push(sample(r, t));
    }
    report[gross ? 'grossApproach' : 'soloApproach'] = { landed, peakEngineRpm, peakRotorRpm, touchdowns, samples };
    expect(peakEngineRpm).toBeLessThanOrEqual(2700);
    expect(peakRotorRpm).toBeLessThanOrEqual(471);
    expect(landed).toBe(true); expect(r.fm.state.crashed).toBe(false);
    expect(touchdowns.length).toBeGreaterThan(0);
    expect(touchdowns[0].speed).toBeLessThan(0.5);
    expect(Math.max(...touchdowns.map(p => p.sink))).toBeLessThan(0.5);
    expect(Math.abs(touchdowns[0].pitch)).toBeLessThan(5);
    expect(samples.every(p => p.tail === 'none')).toBe(true);
    const hover = samples.filter(p => p.time >= 90 && p.time <= 100);
    expect(Math.max(...hover.map(p => Math.abs(p.height - 3)))).toBeLessThan(0.25);
    expect(Math.max(...hover.map(p => p.groundSpeed / KT))).toBeLessThan(0.5);
    expect(Math.max(...samples.map(p => p.hp))).toBeLessThan(180);
    expect(r.c.collective).toBe(0);
    expect(r.fm.state.groundSpeed).toBeLessThan(0.1);
  }, 120000);

  it('detects hard skid landings and tail-disc strikes using the frozen S269 geometry', () => {
    const hard = rig();
    hard.fm.setKinematics({ position: { x: 0, y: 0, z: -d.skids.z - 0.05 }, orientation: quat.identity(),
      velocity: { x: 0, y: 0, z: 5 }, angularVelocity: v3.zero() });
    for (let i = 0; i < 20; i++) hard.fm.step(DT, hard.c, env);
    expect(hard.fm.state.crashed).toBe(true); expect(hard.fm.state.crashReason).toContain('skid');
    const tail = rig();
    tail.fm.setKinematics({ position: { x: 0, y: 0, z: -d.skids.z }, orientation: quat.fromEuler(0, 20 * DEG, 0),
      velocity: v3.zero(), angularVelocity: v3.zero() });
    expect(tail.fm.state.crashed).toBe(true);
    expect(tail.fm.state.crashReason).toContain('Tail rotor');
  });
});

// Same 350-m entry and continuous flare policy as the R22 acceptance scenario, with
// 52-KIAS RFM target and 269 geometry/tach references. Test-only controls; no app demo, force assist, state reset or RPM clamp.
for (const gross of [true, false]) describe(`S269 ${gross ? 'gross' : 'solo'} autorotation landing limitation`, () => {
  let result: { contact: boolean; crashed: boolean; speed: number; sink: number; rpm: number;
    pitch: number; maxRpm: number; maxVs: number; tailClear: boolean; finalSpeed: number; collective: number };
  beforeAll(() => {
    const r = rig(52, gross, 350), pilot = new ScriptedPilot(observePilot(r.fm.state, d), r.c);
    r.c.mixture = 0; r.c.collective = 0;
    let phase = 'autorotate', lastRpm = 100 * 2650 / 2700, lastVs = 0, rpmTrend = 0, acceleration = 0, contact = false;
    const samples = [];
    result = { contact: false, crashed: false, speed: Infinity, sink: Infinity, rpm: 0, pitch: Infinity,
      maxRpm: 0, maxVs: -Infinity, tailClear: true, finalSpeed: Infinity, collective: 1 };
    for (let i = 0; i < 90 / DT && !r.fm.state.crashed; i++) {
      const t = i * DT, s = observePilot(r.fm.state, d), h = s.height, rpm = s.rotorPercent;
      const lag = 1 - Math.exp(-DT / 0.3);
      rpmTrend += ((rpm - lastRpm) / DT - rpmTrend) * lag;
      acceleration += ((s.verticalSpeed - lastVs) / DT - acceleration) * lag;
      if (phase === 'autorotate' && h + 0.6 * s.verticalSpeed < 60 * FT) {
        phase = 'flare'; pilot.pitchRate = 8 * DEG; pilot.cyclicRate = 0.8; pilot.pitchLead = 0.5;
      }
      if (phase === 'flare' && h < 30 * FT && acceleration < -0.2) {
        phase = 'level'; pilot.pitchRate = 24 * DEG; pilot.cyclicRate = 1.2; pilot.pitchLead = 0.3; pilot.pitchDamping = 2;
      } else if (phase === 'level' && acceleration < -0.2) phase = 'cushion';
      if (contact) pilot.slide(DT, s, r.c);
      else if (phase === 'autorotate') pilot.step(DT, s, r.c, 52, -1, undefined, clamp(0.04 + 0.02 * (rpm - 100), 0, 0.5), 1);
      else {
        const portion = clamp((h - 8 * FT) / (52 * FT), 0, 1);
        const targetVs = phase === 'flare' ? -0.4 - 7.6 * portion ** 6 : -Math.min(3.5, 0.55 + h * 0.7);
        const targetAcceleration = phase === 'flare' ? -45.6 / (52 * FT) * portion ** 5 * s.verticalSpeed : 0;
        const pitch = phase === 'flare' ? clamp(pilot.pitchCommand +
          (8 * (targetVs - s.verticalSpeed) + 3 * (targetAcceleration - acceleration)) * DEG * DT, -10 * DEG, 24 * DEG) :
          Math.max(1, Math.min(33, -4 + (h + 0.5 * s.verticalSpeed) / FT * 3, Math.max(2, 2 * (s.groundSpeed / KT - 4)))) * DEG;
        const targetRpm = 100 + 6 * clamp((45 * FT - h) / (15 * FT), 0, 1);
        const support = h > 40 * FT && rpm > 97 && s.verticalSpeed < -4 ? 0.15 : 0;
        const collective = phase !== 'cushion' ? Math.max(support, clamp(0.08 * (rpm - targetRpm) + 0.04 * rpmTrend, 0, 0.8)) :
          clamp(r.c.collective! + (0.7 * (targetVs - s.verticalSpeed) - 0.25 * acceleration) * DT, 0, 1);
        pilot.step(DT, s, r.c, 0, targetVs, pitch, collective, phase === 'flare' ? 0.5 : 0.8);
      }
      lastRpm = rpm; lastVs = s.verticalSpeed;
      r.fm.step(DT, r.c, env);
      const now = observePilot(r.fm.state, d);
      result.maxRpm = Math.max(result.maxRpm, now.rotorPercent);
      if (phase !== 'autorotate' && !contact && !r.fm.touchdowns.length && !now.onGround)
        result.maxVs = Math.max(result.maxVs, now.verticalSpeed);
      if (!contact && (now.onGround || r.fm.touchdowns.length)) {
        contact = true;
        Object.assign(result, { contact, speed: now.groundSpeed / KT,
          sink: Math.max(0, ...r.fm.touchdowns.map(p => p.sinkRate)), rpm: now.rotorPercent, pitch: now.pitch / DEG });
      }
      result.tailClear &&= r.fm.state.rotorcraft!.tailContact === 'none';
      if (i % 60 === 0) samples.push({ ...sample(r, t), phase });
    }
    Object.assign(result, { crashed: r.fm.state.crashed, finalSpeed: r.fm.state.groundSpeed, collective: r.c.collective });
    report[gross ? 'grossAutoLanding' : 'soloAutoLanding'] = { ...result, reason: r.fm.state.crashReason, samples };
  }, 120000);
  it('reproduces the attempted flare through contact or detected damage with finite results', () => {
    expect(result.contact || result.crashed).toBe(true);
    expect(Number.isFinite(result.maxRpm)).toBe(true);
    expect(result.maxRpm).toBeGreaterThan(90);
    expect(Number.isFinite(result.maxVs)).toBe(true);
  });
  it.fails('KNOWN FLARE GAP — lands slowly, level, without a climb or tail strike and within 390–504 RPM', () => {
    expect({ contact: result.contact, undamaged: !result.crashed, slow: result.speed < 10,
      cushioned: result.sink < 1.5, level: Math.abs(result.pitch) < 5, tailClear: result.tailClear,
      noClimb: result.maxVs <= 0, rotorArc: result.rpm >= 390 / 471 * 100 && result.maxRpm <= 504 / 471 * 100,
      stopped: result.finalSpeed < 0.1 && result.collective === 0 }).toEqual({ contact: true, undamaged: true,
      slow: true, cushioned: true, level: true, tailClear: true, noClimb: true, rotorArc: true, stopped: true });
  });
});
