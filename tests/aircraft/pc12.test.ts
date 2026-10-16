// Pilatus PC-12/47: the type's own checks beyond the conformance suite. The definition is the PC-12's own (a free
// turbine with the condition-lever propeller, beta and reverse, the PCL's torque limiter and the latching starter);
// it rests on its gear at the reference height; the whole aircraft starts from cold and dark with one press of
// STARTER; the trimmed stabiliser, the aileron-rudder interconnect, the stick shaker and pusher, the gear horn and the
// overspeed warning's data behave as the 47E book describes (plan 5.2, 5.7).

import { describe, expect, it } from 'vitest';
import { pc12TorquePsi, PC12_OVERSPEED, PC12_START } from '../../src/aircraft/pc12/facts';
import PC12_DEFINITION from '../../src/aircraft/pc12/index';
import { PC12_RETRACT } from '../../src/aircraft/pc12/gear';
import { PC12_GEOMETRY } from '../../src/aircraft/pc12/geometry';
import { PC12_FLIGHT_IDLE_STOP, PT6A_67B } from '../../src/aircraft/pc12/powerplant';
import { PC12_REFERENCE } from '../../src/aircraft/pc12/reference';
import { PC12_GROUND_IDLE } from '../../src/aircraft/pc12/sim';
import { PC12_CONTROLS, PC12_STICK_PUSHER } from '../../src/aircraft/pc12/systems';
import { loadAircraft } from '../../src/aircraft/registry';
import { DEG, FT, KT } from '../../src/core/math';
import { defaultControls, emptySurfaceState, setEngineControl } from '../../src/core/types';
import { StickPusher, type StickPusherInput } from '../../src/physics/aero/stickPusher';
import { tasFromCas } from '../../src/physics/atmosphere';
import { ControlLaw } from '../../src/physics/controlSystem';
import { RetractActuator, type RetractInput } from '../../src/physics/gear/retract';
import { CUTOFF_BELOW } from '../../src/physics/propulsion/turbineEngine';
import { ELEVATION, FRAME, at, flatEnvironment, makeRig, resetTo } from '../fdm/helpers';
import { restOnGround } from '../fdm/measure';
import type { ScenarioId } from '../../src/core/context';
import { defaultWeather, type WeatherSettings } from '../../src/core/types';
import { parseSnapshot } from '../../src/sim/resume';
import { SimPhysics } from '../../src/sim/SimPhysics';

const def = PC12_DEFINITION;

describe('Pilatus PC-12/47: the definition', () => {
  it('is what the registry loads: the type itself, a free turbine on a condition-lever, reversing propeller', async () => {
    expect(await loadAircraft('pc12')).toBe(def);
    expect(def.placeholder).toBeUndefined();
    const install = def.powerplant.engines[0];
    expect(install.engine).toBe(PT6A_67B);
    expect(install.engine.kind).toBe('freeTurbine');
    expect(install.engine.starterLatch).toEqual({ cutoutNg: PC12_START.starterCutoutNg, cutoutSeconds: PC12_START.starterCutoutSeconds });
    expect(install.engine.turbine?.torqueLimiter?.psi).toBe(44.3);
    const pc = install.propeller.pitchControl;
    expect(pc.kind).toBe('constantSpeed');
    if (pc.kind !== 'constantSpeed') return;
    expect(pc.selectedBy).toBe('conditionLever');
    expect(pc.governor.minRpm).toBe(1700);
    expect(pc.governor.maxRpm).toBe(1700);
    expect(pc.governor.overspeedRpm).toBe(1802);
    expect(pc.fineStop).toBe(PC12_FLIGHT_IDLE_STOP);
    // TCDS C.III.6.6 at the 42 in station: reverse -17.5, feather 79.6 deg.
    expect(pc.beta?.reverse).toBeCloseTo(-17.5 * DEG, 12);
    expect(pc.coarseStop).toBeCloseTo(79.6 * DEG, 12);
    expect(def.reference).toBe(PC12_REFERENCE);
    expect(def.input.has.propeller).toBe(false);
    expect(def.input.has.reverse).toBe(true);
    expect(def.controls.pitchTrim.kind).toBe('stabilizer');
    expect(def.limits.overspeedWarning).toEqual({ kias: PC12_OVERSPEED.kias, mach: PC12_OVERSPEED.mach });
  });

  it('rests on its gear with the reference point at geometry.restHeight (within 3 cm), about level, the propeller clear', () => {
    const rest = restOnGround(makeRig({ def, loading: 'maxGross' }));
    expect(rest.allWheelsOnGround).toBe(true);
    expect(Math.abs(rest.height - PC12_GEOMETRY.restHeight)).toBeLessThan(0.03);
    expect(Math.abs(rest.pitchDeg)).toBeLessThan(1);
    const p = PC12_GEOMETRY.propellers[0];
    const tip = -p.hub.x * Math.sin(rest.pitchDeg * DEG) + (p.hub.z + p.diameter / 2) * Math.cos(rest.pitchDeg * DEG);
    expect(rest.height - tip).toBeGreaterThan(0.25);
  });
});

describe('Pilatus PC-12/47: the start (47E-PROXY 4.5)', () => {
  it('starts from cold and dark with one press of STARTER: GROUND IDLE at 13 % Ng, cut-out at 50 % Ng, idle above 950 rpm', () => {
    const rig = makeRig({ def, loading: 'typical', env: flatEnvironment(undefined, 0) });
    resetTo(rig, { onGround: true, position: at(0), engineRunning: false });
    const s = rig.fm.state, c = rig.controls;
    expect(s.engine.running).toBe(false);
    expect(s.propeller.feathered).toBe(true);
    // Battery, fuel pumps, ignition AUTO (the starter's), the PCL at IDLE, the condition lever at CUT-OFF/FEATHER.
    c.masterBattery = true;
    c.alternator = true;
    c.fuelPump = true;
    c.fuelSelector = 'on';
    c.magnetos = 0;
    c.throttle = 0;
    c.mixture = 0;
    c.parkingBrake = true;
    // One press: the switch down for a fifth of a second, then released (the latch holds the starter).
    setEngineControl(c, 0, 'starter', true);
    let t = 0, peakItt = -Infinity, hotSeconds = 0, cutoutNg = NaN, ng50At = NaN, conditionAt = NaN, wasEngaged = false;
    rig.run(70, () => {
      t += FRAME;
      if (t > 0.2) setEngineControl(c, 0, 'starter', false);
      const e = s.engine;
      const ng = e.ng ?? 0;
      if (c.mixture < CUTOFF_BELOW && ng >= PC12_START.conditionAtNg * 100) {
        c.mixture = PC12_GROUND_IDLE;
        conditionAt = ng;
      }
      peakItt = Math.max(peakItt, e.itt ?? -Infinity);
      if ((e.itt ?? 0) > 870) hotSeconds += FRAME;
      if (Number.isNaN(ng50At) && ng >= 50) ng50At = t;
      const engaged = e.starter === true;
      if (wasEngaged && !engaged && Number.isNaN(cutoutNg)) cutoutNg = ng;
      wasEngaged = engaged;
    });
    const e = s.engine;
    expect(conditionAt).toBeGreaterThanOrEqual(13);
    expect(conditionAt).toBeLessThan(15);
    // Plan 5.7: ITT peak 650-850 C (ESTIMATE), never above 1000, above 870 for at most 5 s (TCDS).
    expect(peakItt).toBeGreaterThan(650);
    expect(peakItt).toBeLessThan(850);
    expect(hotSeconds).toBeLessThanOrEqual(5);
    // The latch drops at 50 +- 1 % Ng; Ng above 50 % within 40 s.
    expect(cutoutNg).toBeGreaterThan(49);
    expect(cutoutNg).toBeLessThan(51);
    expect(ng50At).toBeLessThan(40);
    expect(e.running).toBe(true);
    expect(e.starter).toBe(false);
    // Ground idle 50.7-61.4 % Ng; the propeller out of feather at about 1060 rpm, at least 950 (TCDS C.III.6.7).
    expect(e.ng).toBeGreaterThan(50.7);
    expect(e.ng).toBeLessThan(61.4);
    expect(s.propeller.feathered).toBe(false);
    expect(e.propRpm).toBeGreaterThan(950);
    expect(s.electrical.alternatorAmps).toBeGreaterThan(0);
    expect(s.groundSpeed).toBeLessThan(0.1);
    // The condition lever to CUT-OFF/FEATHER: the flame goes out, the gas generator runs down, the propeller feathers.
    c.mixture = 0;
    rig.run(90);
    expect(s.engine.lit).toBe(false);
    expect(s.engine.ng).toBeLessThan(5);
    expect(s.propeller.feathered).toBe(true);
  }, 60_000);
});

describe('Pilatus PC-12/47: beta and reverse on the brakes', () => {
  it('ground fine about zero thrust; full reverse 40-70 % of the static take-off thrust, on its wheels', () => {
    const rig = makeRig({ def, loading: 'maxGross', env: flatEnvironment(undefined, 0) });
    const run = (throttle: number, reverse: number, condition: number) => {
      resetTo(rig, { onGround: true, position: at(0) });
      rig.controls.throttle = throttle;
      rig.controls.reverse = reverse;
      rig.controls.mixture = condition;
      rig.run(12);
      const s = rig.fm.state;
      return { thrust: s.propellers[0].thrust, psi: pc12TorquePsi(s.engines[0].torque), np: s.engines[0].propRpm, crashed: s.crashed, wheels: s.wheels.every((w) => w.onGround) };
    };
    const takeoff = run(1, 0, 1);
    const fine = run(0, 0.45, PC12_GROUND_IDLE);
    const full = run(0, 1, 1);
    expect(Math.abs(fine.thrust)).toBeLessThan(500);
    expect(full.thrust).toBeLessThan(0);
    expect(-full.thrust / takeoff.thrust).toBeGreaterThan(0.4);
    expect(-full.thrust / takeoff.thrust).toBeLessThan(0.7);
    // The topping governor holds the reverse Np, 1650 rpm (47E 2-6), +- 2 %.
    expect(Math.abs(full.np - 1650)).toBeLessThan(33);
    expect(full.crashed).toBe(false);
    expect(full.wheels).toBe(true);
  }, 60_000);
});

describe('Pilatus PC-12/47: the trimmed stabiliser and the interconnect', () => {
  const law = new ControlLaw(PC12_CONTROLS);
  const trim = PC12_CONTROLS.pitchTrim as Extract<typeof PC12_CONTROLS.pitchTrim, { kind: 'stabilizer' }>;

  it('turns the stabiliser, + = leading edge up = nose-down trim, noseUp < 0 < noseDown; the elevator follows the yoke alone', () => {
    expect(trim.noseUp).toBeLessThan(0);
    expect(trim.noseDown).toBeGreaterThan(0);
    expect(law.trimTabDeflection(1)).toBeCloseTo(trim.noseUp, 12);
    expect(law.trimTabDeflection(-1)).toBeCloseTo(trim.noseDown, 12);
    const c = defaultControls(def);
    const a = law.surfaceTargets({ ...c, elevator: 0.3, elevatorTrim: 1 }, 2000, emptySurfaceState());
    const b = law.surfaceTargets({ ...c, elevator: 0.3, elevatorTrim: -1 }, 2000, emptySurfaceState());
    expect(a.elevator).toBe(b.elevator);
    expect(a.elevatorTrim).toBeCloseTo(trim.noseUp, 12);
    expect(b.elevatorTrim).toBeCloseTo(trim.noseDown, 12);
    // The trim solver's split round-trips inside the stabiliser's travel and gives the rest to the yoke beyond it.
    for (const deflection of [-6 * DEG, -2 * DEG, 0, 1.5 * DEG]) {
      const p = law.pitchControlsFor(deflection);
      expect(p.elevator).toBeCloseTo(0, 12);
      expect(Math.abs(p.elevatorTrim)).toBeLessThanOrEqual(1);
    }
    const beyond = law.pitchControlsFor(-15 * DEG);
    expect(beyond.elevatorTrim).toBe(1);
    expect(beyond.elevator).toBeGreaterThan(0);
  });

  it('nose-down trim pitches a trimmed aircraft down, the actuator at its rate (0.5 deg/s)', () => {
    const rig = makeRig({ def, loading: 'maxGross' });
    resetTo(rig, { position: at(ELEVATION + 3000 * FT), airspeed: 160 * KT });
    const s = rig.fm.state;
    const before = s.surfaces.elevatorTrim;
    rig.controls.elevatorTrim = -1;
    rig.run(2);
    expect(s.surfaces.elevatorTrim - before).toBeGreaterThan(0.9 * DEG);
    expect(s.surfaces.elevatorTrim - before).toBeLessThanOrEqual(trim.rate * 2 + 1e-9);
    expect(s.angularVelocity.y).toBeLessThan(0);
  });

  it('the interconnect adds 0.15 of rudder travel per unit of aileron (right aileron, right rudder)', () => {
    const c = defaultControls(def);
    const out = law.surfaceTargets({ ...c, aileron: 0.5, rudder: 0, rudderTrim: 0 }, 0, emptySurfaceState());
    const max = PC12_CONTROLS.rudder.maxDeflection;
    // Right rudder is a negative SurfaceState.rudder.
    expect(out.rudder).toBeCloseTo(-0.15 * 0.5 * max, 12);
  });
});

describe('Pilatus PC-12/47: the stick shaker and pusher (47E-PROXY 7-21)', () => {
  const base: StickPusherInput = { alphaDeg: 0, flapDeg: 0, loadFactor: 1, busVolts: 28, weightOnWheels: false, ptTorqueNm: 0, interrupt: false, dt: 0.02 };
  const fly = (p: StickPusher, i: Partial<StickPusherInput>, seconds: number, yoke = 0.5): number => {
    let out = yoke;
    for (let t = 0; t < seconds; t += base.dt) out = p.step({ ...base, ...i }, yoke);
    return out;
  };
  const trip = PC12_STICK_PUSHER.pusherAlphaDeg[0];
  const shake = PC12_STICK_PUSHER.shakerAlphaDeg[0];

  it('shakes above the shaker angle, pushes above the pusher angle (0.35 of the travel, ramped), lets go below its reset', () => {
    const p = new StickPusher(PC12_STICK_PUSHER);
    expect(fly(p, { alphaDeg: shake - 0.1 }, 1)).toBe(0.5);
    expect(p.shaker).toBe(false);
    fly(p, { alphaDeg: shake + 0.1 }, 1);
    expect(p.shaker).toBe(true);
    expect(p.pusher).toBe(false);
    const pushed = fly(p, { alphaDeg: trip + 0.2 }, 1);
    expect(p.pusher).toBe(true);
    expect(pushed).toBeCloseTo(0.5 - PC12_STICK_PUSHER.pushElevator, 12);
    // Still pushing a degree below the trip; let go 1.5 deg below it, the push ramping out.
    fly(p, { alphaDeg: trip - 1 }, 0.1);
    expect(p.pusher).toBe(true);
    fly(p, { alphaDeg: trip - 2 }, 1);
    expect(p.pusher).toBe(false);
  });

  it('is inhibited on the ground, for 5 s after lift-off, below 0.5 g, with a dead bus, while the interrupt is held; the clutch slips at the aft stop', () => {
    const p = new StickPusher(PC12_STICK_PUSHER);
    fly(p, { alphaDeg: trip + 3, weightOnWheels: true }, 1);
    expect(p.shaker || p.pusher).toBe(false);
    // Just after lift-off: shaker yes, pusher no until 5 s.
    fly(p, { alphaDeg: trip + 3 }, 4.5);
    expect(p.shaker).toBe(true);
    expect(p.pusher).toBe(false);
    fly(p, { alphaDeg: trip + 3 }, 1);
    expect(p.pusher).toBe(true);
    const q = new StickPusher(PC12_STICK_PUSHER);
    fly(q, { alphaDeg: trip + 3, loadFactor: 0.4 }, 1);
    expect(q.pusher).toBe(false);
    fly(q, { alphaDeg: trip + 3, busVolts: 10 }, 1);
    expect(q.pusher || q.shaker).toBe(false);
    expect(fly(q, { alphaDeg: trip + 3, interrupt: true }, 1)).toBe(0.5);
    expect(q.shaker).toBe(true);
    expect(fly(q, { alphaDeg: trip + 3 }, 1, 1)).toBe(1);
  });

  it('keeps its trips, push ramp and lift-off timer through a snapshot; a snapshot without them restores as reset()', () => {
    // Mid-push, 0.2 s into the ramp, a degree below the trip (inside the reset hysteresis), 1 s after lift-off.
    const p = new StickPusher(PC12_STICK_PUSHER);
    fly(p, { alphaDeg: trip + 1 }, 0.2);
    fly(p, { alphaDeg: trip - 1 }, 0.02);
    const saved = JSON.parse(JSON.stringify(p.capture()));
    const q = new StickPusher(PC12_STICK_PUSHER);
    q.restore(saved);
    expect(q.capture()).toEqual(p.capture());
    expect(fly(q, { alphaDeg: trip - 1 }, 0.1)).toBe(fly(p, { alphaDeg: trip - 1 }, 0.1));
    expect(q.pusher).toBe(true);
    // During the 5 s lift-off inhibit: still inhibited after the restore.
    const r = new StickPusher(PC12_STICK_PUSHER);
    fly(r, { alphaDeg: trip + 3, weightOnWheels: true }, 0.1);
    fly(r, { alphaDeg: 0 }, 2);
    const t = new StickPusher(PC12_STICK_PUSHER);
    t.restore(JSON.parse(JSON.stringify(r.capture())));
    expect(t.capture().airborneSeconds).toBeCloseTo(2, 1);
    fly(t, { alphaDeg: trip + 3 }, 1);
    expect(t.pusher).toBe(false);
    // Missing or corrupt: as reset(); out of range: clamped.
    const u = new StickPusher(PC12_STICK_PUSHER);
    u.restore(undefined);
    expect(u.capture()).toEqual(new StickPusher(PC12_STICK_PUSHER).capture());
    u.restore({ ramp: 7, airborneSeconds: -3, shaker: 'yes' as unknown as boolean });
    expect(u.capture()).toEqual({ shaker: false, pusher: false, ramp: 1, airborneSeconds: 0 });
  });

  it('trips later with torque (0.03 deg per psi) and earlier with flaps', () => {
    const p = new StickPusher(PC12_STICK_PUSHER);
    const idle = p.tripAngles(0, 0).pusher;
    expect(p.tripAngles(0, 40).pusher - idle).toBeCloseTo(1.2, 9);
    expect(p.tripAngles(40, 0).pusher).toBe(PC12_STICK_PUSHER.pusherAlphaDeg[3]);
  });
});

describe('Pilatus PC-12/47: the gear horn (47E-PROXY 7-4) and the overspeed warning', () => {
  const step = (a: RetractActuator, i: Partial<RetractInput>) =>
    a.update(0.1, { lever: 'up', emergency: false, busVoltage: 28, weightOnWheels: false, minThrottle: 0, flapLever: 0, onGround: false, ...i }).warning;

  it('sounds with a leg up and the PCL at idle below 130 KIAS, or flaps 30 and more at any speed', () => {
    const a = new RetractActuator(PC12_RETRACT);
    a.reset(false);
    expect(step(a, { kias: 125 })).toBe(true);
    expect(step(a, { kias: 135 })).toBe(false);
    expect(step(a, { kias: 125, minThrottle: 0.3 })).toBe(false);
    expect(step(a, { kias: 150, minThrottle: 0.3, flapLever: 30 / 40 })).toBe(true);
    expect(step(a, { kias: 150, minThrottle: 0.3, flapLever: 15 / 40 })).toBe(false);
    a.reset(true);
    expect(step(a, { lever: 'down', kias: 100 })).toBe(false);
    // The selector UP on the ground.
    expect(step(a, { lever: 'up', onGround: true, weightOnWheels: true, minThrottle: 0.5, kias: 0 })).toBe(true);
  });

  it('in the flight model: gear up, PCL idle, 125 KIAS: the horn', () => {
    const rig = makeRig({ def, loading: 'maxGross' });
    resetTo(rig, { position: at(ELEVATION + 2000 * FT), airspeed: 130 * KT, gearDown: false });
    rig.controls.throttle = 0;
    rig.run(1);
    expect(rig.fm.state.gear.warning).toBe(true);
  });

  it('in the flight model: gear up, PCL idle, from 175 KCAS (above 135 KIAS throughout): no horn (the airspeed switch reads the flight model\'s IAS)', () => {
    const rig = makeRig({ def, loading: 'maxGross' });
    const alt = ELEVATION + 2000 * FT;
    resetTo(rig, { position: at(alt), airspeed: tasFromCas(175 * KT, rig.env.atmosphere(alt)), gearDown: false });
    rig.controls.throttle = 0;
    let fast = Infinity, warnedFast = false;
    rig.run(1, () => {
      const kias = rig.fm.state.ias / KT;
      fast = Math.min(fast, kias);
      if (kias > 135 && rig.fm.state.gear.warning) warnedFast = true;
    });
    expect(fast).toBeGreaterThan(135);
    expect(warnedFast).toBe(false);
    // Flaps 30 sound it at any speed.
    rig.controls.flaps = 30 / 40;
    rig.run(0.1);
    expect(rig.fm.state.gear.warning).toBe(true);
  });

  it('the overspeed warning at Vmo 236 KIAS or Mmo 0.48: the Mach limit takes over near 16 000 ft (47E schedule about 15 200 ft)', () => {
    const env = flatEnvironment();
    const machAt = (kias: number, ft: number) => {
      const atm = env.atmosphere(ft * FT);
      return tasFromCas(kias * KT, atm) / atm.speedOfSound;
    };
    let crossover = NaN;
    for (let ft = 10_000; ft <= 22_000; ft += 100) {
      if (machAt(PC12_OVERSPEED.kias + 2, ft) >= PC12_OVERSPEED.mach) {
        crossover = ft;
        break;
      }
    }
    expect(crossover).toBeGreaterThan(14_000);
    expect(crossover).toBeLessThan(18_000);
  });
});

describe('Pilatus PC-12/47: resume on reload (SimPhysics snapshot through JSON)', () => {
  const NOW = 1_800_000_000_000;
  const start = (id: ScenarioId, autoflight = false) => {
    const weather = { ...defaultWeather(), turbulence: 0 };
    const p = new SimPhysics({ weather, aircraft: def });
    p.autoflightOnReset = autoflight;
    p.reset(id);
    return { p, weather };
  };
  const reload = (a: { p: SimPhysics; weather: WeatherSettings }) => {
    const snap = parseSnapshot(JSON.stringify(a.p.captureSnapshot({ weather: a.weather, cameraMode: 'chase', quality: 'high', renderScale: null, resume: true, now: NOW })));
    expect(snap).not.toBeNull();
    const q = new SimPhysics({ weather: { ...snap!.weather }, aircraft: def });
    q.restore(snap!);
    return q;
  };

  it('in full reverse on the brakes: the blade stays at -17.5 deg and the gas generator at its reverse Ng', () => {
    const a = start('runway');
    const c = a.p.controls;
    c.parkingBrake = true;
    c.throttle = 0;
    c.reverse = 1;
    a.p.step(12);
    const before = a.p.fm.captureSystems().engines[0];
    expect(before.bladePitch / DEG).toBeCloseTo(-17.5, 3);
    expect(before.gasGenerator!.ng).toBeGreaterThan(0.7);
    const b = reload(a);
    const after = b.fm.captureSystems().engines[0];
    expect(after.bladePitch).toBeCloseTo(before.bladePitch, 9);
    expect(after.gasGenerator!.ng).toBeCloseTo(before.gasGenerator!.ng, 9);
    expect(after.gasGenerator!.itt).toBeCloseTo(before.gasGenerator!.itt, 6);
    // And it runs on as the original does.
    a.p.step(2);
    b.step(2);
    const sa = a.p.fm.state.engines[0], sb = b.fm.state.engines[0];
    expect(Math.abs((sb.ng ?? 0) - (sa.ng ?? 0))).toBeLessThan(0.3);
    expect(Math.abs(sb.propRpm - sa.propRpm)).toBeLessThan(10);
    expect(Math.abs(b.fm.state.propellers[0].thrust - a.p.fm.state.propellers[0].thrust)).toBeLessThan(200);
  }, 60_000);

  it('a start resumed mid-way runs on to its cut-out: the latch, Ng and ITT as saved', () => {
    const a = start('apron');
    const c = a.p.controls;
    c.masterBattery = true;
    c.alternator = true;
    c.fuelPump = true;
    c.fuelSelector = 'on';
    c.magnetos = 0;
    c.throttle = 0;
    c.parkingBrake = true;
    setEngineControl(c, 0, 'starter', true);
    a.p.step(0.2);
    setEngineControl(c, 0, 'starter', false);
    // The condition lever to GROUND IDLE at 13 % Ng (47E-PROXY 4.5), then on to 10 s into the start.
    for (let t = 0.2; t < 10; t += 0.05) {
      a.p.step(0.05);
      if (c.mixture < CUTOFF_BELOW && (a.p.fm.state.engine.ng ?? 0) >= PC12_START.conditionAtNg * 100) c.mixture = PC12_GROUND_IDLE;
    }
    expect(c.mixture).toBe(PC12_GROUND_IDLE);
    const before = a.p.fm.captureSystems().engines[0];
    expect(before.starterLatch?.latched).toBe(true);
    expect(before.gasGenerator!.ng).toBeGreaterThan(0.15);
    expect(before.gasGenerator!.ng).toBeLessThan(0.45);
    const b = reload(a);
    const after = b.fm.captureSystems().engines[0];
    expect(after.starterLatch).toEqual(before.starterLatch);
    expect(after.gasGenerator!.ng).toBeCloseTo(before.gasGenerator!.ng, 9);
    expect(b.fm.state.engine.starter).toBe(true);
    b.step(50);
    a.p.step(50);
    for (const p of [a.p, b]) {
      expect(p.fm.state.engine.running).toBe(true);
      expect(p.fm.state.engine.starter).toBe(false);
      expect(p.fm.state.engine.ng).toBeGreaterThan(50.7);
    }
  }, 60_000);

  it('2 s after lift-off the pusher is still inside its 5 s inhibit after the restore', () => {
    const a = start('runway', true);
    let airborne = 0;
    for (let i = 0; i < 1200 && airborne < 2; i++) {
      a.p.step(0.05);
      if (!a.p.fm.state.onGround) airborne += 0.05;
    }
    expect(airborne).toBeGreaterThanOrEqual(2);
    const before = a.p.fm.captureSystems().stickPusher!;
    expect(before.airborneSeconds).toBeGreaterThan(1.5);
    expect(before.airborneSeconds).toBeLessThan(PC12_STICK_PUSHER.liftoffInhibitSeconds);
    const b = reload(a);
    expect(b.fm.captureSystems().stickPusher).toEqual(before);
  }, 60_000);
});
