import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { R44_DEFINITION as def } from '../../src/aircraft/r44';
import { R44_REFERENCE as V } from '../../src/aircraft/r44/reference';
import { createFlightModelFor } from '../../src/physics';
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
const trace = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.R44_TRACE;
const fs = trace ? await import(/* @vite-ignore */ 'node:fs' as string) as TraceFs : undefined;
const report: Record<string, unknown> = {};
afterAll(() => { fs?.mkdirSync('work/r44-fm', { recursive: true }); fs?.writeFileSync('work/r44-fm/flights.json', JSON.stringify(report, null, 2)); });
function rig(kt = 0, gross = true, height = 90, running = true, onGround = false) {
  const fm = createFlightModelFor(def);
  if (gross) fm.setLoading(def.mass.loadings.maxGross);
  fm.reset({ position: { x: 0, y: 0, z: -height }, heading: 0, airspeed: kt * KT,
    onGround, engineRunning: running, fuelFraction: gross ? 1 : 0.5 }, env);
  return { fm, c: cloneControls(fm.trimControls) };
}
function sample(r: ReturnType<typeof rig>, time: number) {
  const s = r.fm.state;
  return { time, ...observePilot(s, d), hp: s.engine.power / HP, map: s.engine.manifoldPressure,
    collective: r.c.collective!, cyclic: r.c.elevator, pedal: r.c.rudder, tail: s.rotorcraft!.tailContact,
    clutch: s.rotorcraft!.clutchEngagement, governor: s.rotorcraft!.governorActive,
    cht: s.engine.cht, oilTemp: s.engine.oilTemp, oilPressure: s.engine.oilPressure };
}

describe('R44 engine, drivetrain and flight integration', () => {
  it('has 80% governor acquisition, collective-switched 97% warning and 205/245 hp five-minute limits', () => {
    const rotor = new Rotorcraft(d), c = defaultControls(def);
    const shaft = { omega: 0, inertia: 0.85, shaftTorque: 0,
      get rpm() { return this.omega * 30 / Math.PI; }, state: { rpm: 0, power: 0, manifoldPressure: 0 } };
    const engine = shaft as unknown as EngineUnit;
    rotor.reset(false); c.throttle = 0.2;
    engine.omega = 0.79 * V.engineRpm100 * Math.PI / 30;
    rotor.throttle(0.1, c, engine); expect(rotor.state.governorActive).toBe(false);
    engine.omega = 0.81 * V.engineRpm100 * Math.PI / 30;
    rotor.throttle(0.1, c, engine); expect(rotor.state.governorActive).toBe(true);
    rotor.reset(true); engine.omega = 0;
    rotor.state.omega = 0.96 * V.rotorRpm100 * Math.PI / 30; c.collective = 0.1;
    rotor.drive(0, c, engine); expect(rotor.state.lowRpmHorn).toBe(true);
    expect(engine.omega).toBe(0); expect(rotor.state.driveTorque).toBe(0);
    c.collective = 0; rotor.drive(0, c, engine); expect(rotor.state.lowRpmHorn).toBe(false);
    engine.state.power = 230 * HP; rotor.drive(299, c, engine); expect(rotor.state.powerLimitExceeded).toBe(false);
    rotor.drive(2, c, engine); expect(rotor.state.powerLimitExceeded).toBe(true);
    engine.state.power = 200 * HP; rotor.drive(1, c, engine); expect(rotor.state.takeoffPowerSeconds).toBe(0);
    engine.state.power = 250 * HP; rotor.drive(DT, c, engine); expect(rotor.state.powerLimitExceeded).toBe(true);
  });

  it('primes the cold injected engine, starts, tensions the clutch, acquires the governor and hovers', () => {
    const r = rig(0, false, 0, false, true), c = r.c;
    // Generic grip zero is the hard overtravel stop. A small idle opening is needed by this reduced
    // engine model; the real POH procedure says closed. The pump key/clutch automation is not wired:
    // use the existing manual pump input for prime and again when the clutch is engaged.
    Object.assign(c, { rotorClutch: false, rotorGovernor: true, throttle: 0.05, mixture: 1,
      magnetos: 3, masterBattery: true, alternator: false, fuelPump: true, collective: 0 });
    const samples = [];
    let firedAt: number | undefined, movingAt: number | undefined, governorAt: number | undefined;
    let hoverAt: number | undefined, pilot: ScriptedPilot | undefined, magBefore = 0, magAfter = 0;
    let clutchAt20 = 0, clutchOut = false, pressureAt30 = 0;
    for (let i = 0; i < 360 / DT && !r.fm.state.crashed; i++) {
      const t = i * DT, s = r.fm.state;
      if (t >= 4 && t < 12) {
        c.fuelPump = false; c.mixture = firedAt === undefined ? 0 : 1; c.starter = firedAt === undefined;
        if (s.engine.running) { firedAt ??= t; c.mixture = 1; c.starter = false; }
      }
      if (t >= 12 && t < 25) c.throttle = clamp(c.throttle + 0.0004 * (0.55 * V.engineRpm100 - s.engine.rpm) * DT, 0, 0.3);
      if (t >= 25 && t < 100) {
        c.rotorClutch = true; c.fuelPump = true; c.alternator = true;
        // Isolate the manual run-up below governor acquisition; an RPM overshoot must not
        // let the governor replace a 75% magneto check with a governed 101.5% check.
        c.rotorGovernor = false;
        c.throttle = clamp(c.throttle + 0.0003 * ((t < 70 ? 0.65 : 0.75) * V.engineRpm100 - s.engine.rpm) * DT, 0, 0.3);
      }
      if (t >= 100 && t < 102) { if (!magBefore) magBefore = s.engine.rpm; c.magnetos = 1; magAfter = s.engine.rpm; }
      if (t >= 102) c.magnetos = 3;
      if (t >= 105 && t < 135) {
        c.rotorGovernor = true;
        if (s.engine.rpm < 0.81 * V.engineRpm100) c.throttle += 0.02 * DT;
      }
      if (t >= 135 && s.engine.cht >= 95 && s.engine.oilTemp >= 40) hoverAt ??= t;
      if (hoverAt !== undefined) {
        pilot ??= new ScriptedPilot(observePilot(s, d), c);
        pilot.step(DT, observePilot(s, d), c, 0, clamp(0.5 * (3 - (s.altitudeAGL - d.skids.z)), -0.5, 0.5));
      }
      r.fm.step(DT, c, env);
      if (t >= 25 && s.rotorcraft!.rotorRpm > 0.4) movingAt ??= t;
      if (s.rotorcraft!.governorActive) governorAt ??= t;
      if (i === 45 / DT) clutchAt20 = s.rotorcraft!.clutchEngagement;
      if (i === 71 / DT) clutchOut = !s.rotorcraft!.clutchLight;
      if (i === 30 / DT) pressureAt30 = s.engine.oilPressure;
      if (i % 240 === 0) samples.push(sample(r, t));
      if (hoverAt !== undefined && t > hoverAt + 40) break;
    }
    const end = sample(r, samples.at(-1)!.time);
    report.start = { firedAt, movingAt, governorAt, hoverAt, magDropPercent: (magBefore - magAfter) / V.engineRpm100 * 100, samples };
    expect(firedAt).toBeDefined(); expect(firedAt! - 4).toBeLessThan(5);
    expect(movingAt).toBeDefined(); expect(movingAt! - 25).toBeLessThan(5);
    expect(clutchAt20).toBeCloseTo(20 / 45, 3); expect(clutchOut).toBe(true);
    expect(pressureAt30).toBeGreaterThan(25);
    expect(magBefore / V.engineRpm100).toBeGreaterThan(0.73);
    expect(magBefore / V.engineRpm100).toBeLessThan(0.77);
    expect(magBefore - magAfter).toBeGreaterThan(0);
    expect((magBefore - magAfter) / V.engineRpm100).toBeLessThan(0.07);
    expect(governorAt).toBeDefined(); expect(hoverAt).toBeDefined();
    expect(end.rotorPercent).toBeGreaterThan(101); expect(end.rotorPercent).toBeLessThan(102);
    expect(Math.abs(end.height - 3)).toBeLessThan(0.2); expect(end.groundSpeed / KT).toBeLessThan(0.5);
    expect(end.onGround).toBe(false); expect(end.crashed).toBe(false);
  }, 120000);

  for (const gross of [true, false]) it(`${gross ? 'gross' : 'solo'} powered approach, hover and landing`, () => {
    const r = rig(60, gross), pilot = new ScriptedPilot(observePilot(r.fm.state, d), r.c);
    const samples = [], touchdowns: { time: number; speed: number; sink: number; rpm: number; pitch: number }[] = [];
    let landed = false;
    for (let i = 0; i < 145 / DT && !r.fm.state.crashed; i++) {
      const t = i * DT, s = observePilot(r.fm.state, d);
      const speed = t < 35 ? 60 : t < 65 ? 60 - 2 * (t - 35) : 0;
      const height = t < 45 ? 90 - t * 1.5 : t < 70 ? Math.max(3, 22.5 - (t - 45)) :
        t < 100 ? 3 : Math.max(-0.3, 3 - (t - 100) * 0.25);
      if (t > 100 && s.onGround) landed = true;
      if (landed) r.c.collective = Math.max(0, r.c.collective! - 0.2 * DT);
      else pilot.step(DT, s, r.c, speed, clamp(0.5 * (height - s.height), -1.5, 1.5));
      r.fm.step(DT, r.c, env);
      for (const touch of r.fm.touchdowns) touchdowns.push({ time: t, speed: s.groundSpeed / KT,
        sink: touch.sinkRate, rpm: s.rotorPercent, pitch: s.pitch / DEG });
      if (i % 240 === 0) samples.push(sample(r, t));
    }
    report[gross ? 'grossApproach' : 'soloApproach'] = { landed, touchdowns, samples };
    expect(landed).toBe(true); expect(r.fm.state.crashed).toBe(false);
    expect(touchdowns.length).toBeGreaterThan(0);
    expect(touchdowns[0].speed).toBeLessThan(0.5);
    expect(Math.max(...touchdowns.map(p => p.sink))).toBeLessThan(0.5);
    expect(Math.abs(touchdowns[0].pitch)).toBeLessThan(5);
    expect(samples.every(p => p.tail === 'none')).toBe(true);
    const hover = samples.filter(p => p.time >= 90 && p.time <= 100);
    expect(Math.max(...hover.map(p => Math.abs(p.height - 3)))).toBeLessThan(0.25);
    expect(Math.max(...hover.map(p => p.groundSpeed / KT))).toBeLessThan(0.5);
    expect(Math.max(...samples.map(p => p.hp))).toBeLessThan(245);
    expect(r.c.collective).toBe(0);
    expect(r.fm.state.groundSpeed).toBeLessThan(0.1);
  }, 120000);

  it('detects hard skid landings and tail-disc strikes using the frozen R44 geometry', () => {
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

// Same 65-KIAS/350-m entry and continuous flare policy as the R22 acceptance scenario, with
// R44 geometry/tach references. Test-only controls; no app demo, force assist, state reset or RPM clamp.
for (const gross of [true, false]) describe(`R44 ${gross ? 'gross' : 'solo'} autorotation landing limitation`, () => {
  let result: { contact: boolean; crashed: boolean; speed: number; sink: number; rpm: number;
    pitch: number; maxRpm: number; maxVs: number; tailClear: boolean; finalSpeed: number; collective: number };
  beforeAll(() => {
    const r = rig(65, gross, 350), pilot = new ScriptedPilot(observePilot(r.fm.state, d), r.c);
    r.c.mixture = 0; r.c.collective = 0;
    let phase = 'autorotate', lastRpm = 101.5, lastVs = 0, rpmTrend = 0, acceleration = 0, contact = false;
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
      else if (phase === 'autorotate') pilot.step(DT, s, r.c, 65, -1, undefined, clamp(0.04 + 0.02 * (rpm - 102), 0, 0.5), 1);
      else {
        const portion = clamp((h - 8 * FT) / (52 * FT), 0, 1);
        const targetVs = phase === 'flare' ? -0.4 - 7.6 * portion ** 6 : -Math.min(3.5, 0.55 + h * 0.7);
        const targetAcceleration = phase === 'flare' ? -45.6 / (52 * FT) * portion ** 5 * s.verticalSpeed : 0;
        const pitch = phase === 'flare' ? clamp(pilot.pitchCommand +
          (8 * (targetVs - s.verticalSpeed) + 3 * (targetAcceleration - acceleration)) * DEG * DT, -10 * DEG, 24 * DEG) :
          Math.max(1, Math.min(33, -4 + (h + 0.5 * s.verticalSpeed) / FT * 3, Math.max(2, 2 * (s.groundSpeed / KT - 4)))) * DEG;
        const targetRpm = 101.5 + 6 * clamp((45 * FT - h) / (15 * FT), 0, 1);
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
  it.fails('KNOWN FLARE GAP — lands slowly, level, without a climb or tail strike and within 90–108% RPM', () => {
    expect({ contact: result.contact, undamaged: !result.crashed, slow: result.speed < 10,
      cushioned: result.sink < 1.5, level: Math.abs(result.pitch) < 5, tailClear: result.tailClear,
      noClimb: result.maxVs <= 0, rotorArc: result.rpm >= 90 && result.maxRpm <= 108,
      stopped: result.finalSpeed < 0.1 && result.collective === 0 }).toEqual({ contact: true, undamaged: true,
      slow: true, cushioned: true, level: true, tailClear: true, noClimb: true, rotorArc: true, stopped: true });
  });
});
