// Ground contact with the gear not down (GearInput.extension, WheelConfig.stowed), the classification of every
// crash (GearOutput.crashKind), the gear-up landing and the water test of the airframe points. The retractable
// aircraft are the test-beds of testbed.ts: the C172S gear with a PA-34 retraction system, and its twin form.

import { describe, expect, test } from 'vitest';
import { C172 } from '../../src/core/c172';
import { DEG, G0, quat, v3, type Vec3 } from '../../src/core/math';
import type { SurfaceType } from '../../src/core/types';
import type { GearOutput } from '../../src/physics/interfaces';
import { C172_GEAR, RetractActuator, SQUAT_DELAY, type GearConfig } from '../../src/physics/gear';
import { C172_STRUCTURE } from '../../src/physics/gear/structure';
import { DT, GearRig, MASS, planeEnvironment } from './rig';
import { PA34_RETRACT, RETRACT_GEAR, TWIN_RETRACT_GEAR } from './testbed';

const ELEVATION = 120;
const KT = 1852 / 3600;
const UP = [0, 0, 0];
const PROP_TIP: Vec3 = { x: C172.prop.hub.x, y: 0, z: C172.prop.diameter / 2 };
const WINGTIP = C172_STRUCTURE[0].position;
const BELLY = C172_STRUCTURE[5].position;
const NOSE = C172_STRUCTURE[7].position;
/** A landing-like arrival: 58 kt along the ground, 200 ft/min down. */
const SLOW: Vec3 = { x: 30, y: 0, z: 1 };
const FAST: Vec3 = { x: 60, y: 0, z: 0 };

interface Contact { roll?: number; pitch?: number; velocity?: Vec3; extension?: ArrayLike<number>; surface?: SurfaceType }

/** One call of the gear with the aircraft held in an attitude and `point` (body) `depth` m under the ground. */
function touch(config: GearConfig, point: Vec3, depth: number, c: Contact = {}): GearOutput {
  const rig = new GearRig(planeEnvironment(c.surface), MASS, config);
  rig.extension = c.extension;
  rig.orientation = quat.fromEuler(c.roll ?? 0, c.pitch ?? 0, 0);
  rig.position = { x: 0, y: 0, z: -(ELEVATION + quat.rotate(rig.orientation, point).z - depth) };
  rig.velocity = c.velocity ?? v3.zero();
  return rig.step();
}

interface Arrival { extension?: ArrayLike<number>; pitch?: number; roll?: number; speed: number; sink: number; surface?: SurfaceType }

/** A steady descent (lift = weight) from 2.2 m until something ends the flight; returns the output and the height then. */
function arrive(config: GearConfig, a: Arrival): { out: GearOutput; height: number; rig: GearRig } {
  const rig = new GearRig(planeEnvironment(a.surface), MASS, config);
  rig.extension = a.extension;
  rig.orientation = quat.fromEuler(a.roll ?? 0, a.pitch ?? 0, 0);
  rig.position = { x: 0, y: 0, z: -(ELEVATION + 2.2) };
  rig.velocity = { x: a.speed, y: 0, z: a.sink };
  rig.loads = () => ({ force: quat.rotateInv(rig.orientation, { x: 0, y: 0, z: -MASS * G0 }), moment: v3.zero() });
  let height = NaN;
  rig.run(4, (o) => {
    if (!o.crash) return false;
    // The height at the call that latched: the rig has moved one step on since.
    height = rig.heightAGL() + rig.velocity.z * DT;
    return true;
  });
  return { out: rig.output, height, rig };
}

describe('a leg that is not down and locked', () => {
  test('extension [1, 1, 1] is the fixed gear: the same output, bit for bit', () => {
    const run = (extension: ArrayLike<number> | undefined) => {
      const rig = new GearRig();
      rig.extension = extension;
      rig.placeOnGround(0.4, 0.3);
      rig.velocity = { x: 12, y: 1, z: 0 };
      const outputs: GearOutput[] = [];
      rig.run(3, (o) => {
        if (rig.time > 0.5) rig.controls.brakeLeft = 0.6;
        outputs.push(o);
      });
      return outputs;
    };
    const fixed = run(undefined);
    expect(run([1, 1, 1])).toEqual(fixed);
    expect(run(new Float64Array([1, 1, 1]))).toEqual(fixed);
    expect(fixed[fixed.length - 1].onGround).toBe(true);
    expect('crashKind' in fixed[fixed.length - 1]).toBe(false);
  });

  test('carries nothing and reports itself off the ground', () => {
    // Held with the wheels 5 cm into the ground, legs up: no wheel force at all (the airframe points are clear).
    const sunk: Vec3 = { x: 0, y: 0, z: C172.gear.leftMain.z };
    const down = touch(RETRACT_GEAR, sunk, 0.05);
    const up = touch(RETRACT_GEAR, sunk, 0.05, { extension: UP });
    expect(down.onGround).toBe(true);
    expect(-down.force.z).toBeGreaterThan(3000);
    expect(up.onGround).toBe(false);
    expect(up.wheels.map((w) => w.onGround)).toEqual([false, false, false]);
    expect(up.wheels.map((w) => w.load)).toEqual([0, 0, 0]);
    expect(up.force).toEqual({ x: 0, y: 0, z: 0 });
    expect(up.moment).toEqual({ x: 0, y: 0, z: 0 });
    expect(up.crash).toBe('');

    // One leg up: the other two carry what they carried.
    const mains = touch(RETRACT_GEAR, sunk, 0.05, { extension: [0, 1, 1] });
    expect(mains.wheels.map((w) => w.onGround)).toEqual([false, true, true]);
    expect(mains.wheels[1].load).toBe(down.wheels[1].load);
    expect(mains.crash).toBe('');
  });

  test('caught between its stops by the ground, it collapses: at the height of its interpolated contact point', () => {
    // Mains 90 % down: their tyres are on the line from the stowed to the extended contact point.
    const main = RETRACT_GEAR.wheels[1];
    const pitch = 3 * DEG;
    const z = main.stowed!.z + (main.position.z - main.stowed!.z) * 0.9;
    const expected = -main.position.x * Math.sin(pitch) + z * Math.cos(pitch);
    const a = arrive(RETRACT_GEAR, { extension: [0.5, 0.9, 0.9], pitch, speed: 33, sink: 1 });
    console.log(`[gear-up] mains 90 % down: "${a.out.crash}" at ${a.height.toFixed(3)} m (contact point ${expected.toFixed(3)} m below the reference point)`);
    expect(a.out.crash).toBe('Left main gear collapsed (not locked down)');
    expect(a.out.crashKind).toBe('gearCollapse');
    expect(a.out.onGround).toBe(false);
    expect(a.height).toBeLessThanOrEqual(expected);
    expect(a.height).toBeGreaterThan(expected - 1.5 * DT);

    // The same legs fully down land normally.
    expect(arrive(RETRACT_GEAR, { extension: [1, 1, 1], pitch, speed: 33, sink: 1 }).out.crash).toBe('');
  });

  test('each leg reports under its own name, and a leg without a stowed position is tested where it stands when down', () => {
    const sunk = (i: number): Vec3 => ({ ...RETRACT_GEAR.wheels[i].position });
    const one = (i: number) => [0, 1, 2].map((k) => (k === i ? 0.999 : 1));
    expect(touch(RETRACT_GEAR, sunk(0), 0.02, { extension: one(0) }).crash).toBe('Nose gear collapsed (not locked down)');
    expect(touch(RETRACT_GEAR, sunk(1), 0.02, { roll: -3 * DEG, extension: one(1) }).crash).toBe('Left main gear collapsed (not locked down)');
    expect(touch(RETRACT_GEAR, sunk(2), 0.02, { roll: 3 * DEG, extension: one(2) }).crash).toBe('Right main gear collapsed (not locked down)');
    // Half way up, the nose tyre is 0.45 m higher: the same position of the aircraft does not reach it.
    expect(touch(RETRACT_GEAR, sunk(0), 0.02, { extension: [0.5, 1, 1] }).crash).toBe('');
    expect(touch(C172_GEAR, sunk(0), 0.02, { extension: [0.5, 1, 1] }).crash).toBe('Nose gear collapsed (not locked down)');
    // A collapse at impact energy is a terrain impact, as an overloaded leg is.
    const fast = touch(RETRACT_GEAR, sunk(0), 0.02, { extension: one(0), velocity: FAST });
    expect(fast.crash).toBe('Terrain impact at 117 kt, 0 fpm descent (nose gear first)');
    expect(fast.crashKind).toBe('impact');
  });

  test('an aircraft set down with one main leg unlocked falls onto it', () => {
    const rig = new GearRig(planeEnvironment(), MASS, RETRACT_GEAR);
    rig.extension = [1, 0.6, 1];
    rig.placeOnGround(0, 0.02);
    rig.run(3, (o) => o.crash !== '');
    expect(rig.output.crash).toBe('Left main gear collapsed (not locked down)');
    expect(rig.euler().roll).toBeLessThan(-5 * DEG);
  });
});

describe('gear-up landing', () => {
  test('an arrival at approach speed with the gear up is a gear-up landing, on the propeller or the belly', () => {
    for (const [pitch, part] of [[0, 'propeller'], [3, 'propeller'], [8, 'belly']] as const) {
      const a = arrive(RETRACT_GEAR, { extension: UP, pitch: pitch * DEG, speed: 33, sink: 1 });
      console.log(`[gear-up] 64 kt, ${pitch} deg nose up: "${a.out.crash}" (${a.out.crashKind})`);
      expect(a.out.crash).toBe(`Gear-up landing at 64 kt (${part} first)`);
      expect(a.out.crashKind).toBe('gearUp');
      expect(a.out.onGround).toBe(false);
    }
    // The same arrivals with three greens are landings.
    for (const pitch of [0, 3, 8]) expect(arrive(RETRACT_GEAR, { extension: [1, 1, 1], pitch: pitch * DEG, speed: 33, sink: 1 }).out.crash).toBe('');
  });

  test('a 100 kt dive with the gear up is a terrain impact', () => {
    const dive = 15 * DEG;
    const a = arrive(RETRACT_GEAR, { extension: UP, pitch: -dive, speed: 100 * KT * Math.cos(dive), sink: 100 * KT * Math.sin(dive) });
    console.log(`[gear-up] dive: "${a.out.crash}" (${a.out.crashKind})`);
    expect(a.out.crash).toBe('Terrain impact at 100 kt, 2621 fpm descent, 15° nose down (propeller first)');
    expect(a.out.crashKind).toBe('impact');
    // So is a flat arrival at a speed no landing has (the C172S thresholds: 78 kt).
    const flat = arrive(RETRACT_GEAR, { extension: UP, pitch: 2 * DEG, speed: 100 * KT, sink: 1 });
    expect(flat.out.crash).toBe('Terrain impact at 100 kt, 197 fpm descent (propeller first)');
    expect(flat.out.crashKind).toBe('impact');
  });

  test('only a propeller disc or a belly point makes it a gear-up landing, and only with no leg down', () => {
    const up: Contact = { extension: UP, velocity: SLOW };
    const kt = Math.round(Math.hypot(SLOW.x, SLOW.z) / KT);
    expect(kt).toBe(58);
    expect(touch(RETRACT_GEAR, PROP_TIP, 0.02, up)).toMatchObject({ crash: 'Gear-up landing at 58 kt (propeller first)', crashKind: 'gearUp' });
    expect(touch(RETRACT_GEAR, BELLY, 0.02, { ...up, pitch: 12 * DEG })).toMatchObject({ crash: 'Gear-up landing at 58 kt (belly first)', crashKind: 'gearUp' });
    // In transit counts as up: no leg is locked.
    expect(touch(RETRACT_GEAR, PROP_TIP, 0.02, { ...up, extension: [0.3, 0.3, 0.3], pitch: -5 * DEG }).crashKind).toBe('gearUp');
    // Other airframe points keep their own message.
    expect(touch(RETRACT_GEAR, NOSE, 0.02, { ...up, pitch: -40 * DEG })).toMatchObject({ crash: 'Nose struck the ground', crashKind: 'structure' });
    expect(touch(RETRACT_GEAR, WINGTIP, 0.02, { ...up, roll: -60 * DEG })).toMatchObject({ crash: 'Left wingtip struck the ground', crashKind: 'structure' });
    // With any leg down and locked a propeller strike is a propeller strike and a belly point is itself (here
    // a ventral fin that reaches below the wheels, so that it can touch with a leg down).
    const fin = { position: { x: -1, y: 0, z: 2 }, message: 'Ventral fin struck the ground', tolerance: 0, part: 'ventral fin', belly: true };
    const finned: GearConfig = { ...RETRACT_GEAR, structure: [...RETRACT_GEAR.structure, fin] };
    for (const extension of [undefined, [1, 1, 1], [0, 1, 0], [1, 0, 0]]) {
      expect(touch(RETRACT_GEAR, PROP_TIP, 0.02, { velocity: SLOW, extension, pitch: -27 * DEG })).toMatchObject({ crash: 'Propeller strike', crashKind: 'propStrike' });
      expect(touch(finned, fin.position, 0.02, { velocity: SLOW, extension })).toMatchObject({ crash: 'Ventral fin struck the ground', crashKind: 'structure' });
    }
    expect(touch(finned, fin.position, 0.02, up)).toMatchObject({ crash: 'Gear-up landing at 58 kt (ventral fin first)', crashKind: 'gearUp' });
    // A belly point is one that says so: the C172S list has none, its discs are undersides like any other.
    expect(touch(C172_GEAR, BELLY, 0.02, { ...up, pitch: 12 * DEG })).toMatchObject({ crash: 'Belly struck the ground', crashKind: 'structure' });
    expect(touch(C172_GEAR, PROP_TIP, 0.02, up).crashKind).toBe('gearUp');
  });

  test('the energy test comes first, with the thresholds of the type', () => {
    // 80 kt on the propellers of the twin: a gear-up landing for a type that stalls at 60 kt (thresholds 49
    // and 43 m/s), a terrain impact with the C172S thresholds (40 m/s = 78 kt).
    const a = { extension: UP, pitch: 3 * DEG, speed: 80 * KT, sink: 1 };
    const twin = arrive(TWIN_RETRACT_GEAR, a).out;
    const light = arrive({ ...TWIN_RETRACT_GEAR, impact: undefined }, a).out;
    console.log(`[gear-up] twin at 80 kt: "${twin.crash}"; with the C172S thresholds: "${light.crash}"`);
    expect(twin).toMatchObject({ crash: 'Gear-up landing at 80 kt (left propeller first)', crashKind: 'gearUp' });
    expect(light).toMatchObject({ crash: 'Terrain impact at 80 kt, 197 fpm descent (left propeller first)', crashKind: 'impact' });
    expect(arrive(TWIN_RETRACT_GEAR, { ...a, speed: 100 * KT }).out.crashKind).toBe('impact');
    // Banked, the low propeller is the first part.
    expect(arrive(TWIN_RETRACT_GEAR, { ...a, roll: 5 * DEG }).out.crash).toBe('Gear-up landing at 80 kt (right propeller first)');
  });
});

describe('with the retraction system', () => {
  const weightOnWheels = (o: GearOutput) => o.wheels[1].onGround || o.wheels[2].onGround;

  test('selector UP on the ramp: the squat switch saves the aircraft, and without it the legs fold under it', () => {
    for (const squatInhibit of [true, false]) {
      const rig = new GearRig(planeEnvironment(), MASS, RETRACT_GEAR);
      const actuator = new RetractActuator({ ...PA34_RETRACT, squatInhibit });
      rig.extension = actuator.state.extension;
      rig.placeOnGround(0);
      rig.run(1);
      rig.run(2, (o) => {
        actuator.update(DT, { lever: 'up', emergency: false, busVoltage: 14, weightOnWheels: weightOnWheels(o), minThrottle: 0, flapLever: 0, onGround: o.onGround });
        return o.crash !== '';
      });
      if (squatInhibit) {
        expect(rig.output.crash).toBe('');
        expect(rig.output.wheels.map((w) => w.onGround)).toEqual([true, true, true]);
        expect(actuator.state.warning).toBe(true);
      } else {
        expect(rig.output).toMatchObject({ crash: 'Nose gear collapsed (not locked down)', crashKind: 'gearCollapse' });
        expect(rig.time).toBeLessThan(1 + 3 * DT);
      }
    }
  });

  test('selector UP on the roll, a bump unloads the mains for a moment: the legs stay locked (review Bm F5)', () => {
    // Lifted clear of the ground by the static deflection plus `drop` and let fall: the mains are off for
    // 0.08 s at 2 mm. Without the squat switch's delay the pump unlocked all three legs and the gear folded.
    for (const drop of [0.002, 0.005, 0.01]) {
      const rig = new GearRig(planeEnvironment(), MASS, RETRACT_GEAR);
      const actuator = new RetractActuator(PA34_RETRACT);
      rig.extension = actuator.state.extension;
      rig.placeOnGround(0);
      rig.run(1, (o) => void actuator.update(DT, { lever: 'up', emergency: false, busVoltage: 14, weightOnWheels: weightOnWheels(o), minThrottle: 0, flapLever: 0, onGround: o.onGround }));
      rig.position = { ...rig.position, z: rig.position.z - 0.1 - drop };
      let unloaded = 0;
      rig.run(2, (o) => {
        if (!weightOnWheels(o)) unloaded += DT;
        actuator.update(DT, { lever: 'up', emergency: false, busVoltage: 14, weightOnWheels: weightOnWheels(o), minThrottle: 0, flapLever: 0, onGround: o.onGround });
        return o.crash !== '';
      });
      console.log(`[gear-up] bump of ${drop * 1000} mm with the selector UP: mains unloaded ${unloaded.toFixed(3)} s, legs ${[...actuator.state.extension].join(', ')}`);
      expect(unloaded).toBeGreaterThan(0);
      expect(unloaded).toBeLessThan(SQUAT_DELAY);
      expect(rig.output.crash).toBe('');
      expect(actuator.state.locked).toEqual([true, true, true]);
    }
  });

  test('a circuit: up after lift-off, down by free fall with a dead bus, and a normal landing on three greens', () => {
    const rig = new GearRig(planeEnvironment(), MASS, RETRACT_GEAR);
    const actuator = new RetractActuator(PA34_RETRACT);
    rig.extension = actuator.state.extension;
    const input = { lever: 'up' as 'up' | 'down', emergency: false, busVoltage: 14, minThrottle: 0.8, flapLever: 0 };
    const fly = (seconds: number) =>
      rig.run(seconds, (o) => {
        actuator.update(DT, { ...input, weightOnWheels: weightOnWheels(o), onGround: o.onGround });
        return o.crash !== '';
      });
    // Level at 3 m and 64 kt, lift = weight, selector UP: the legs go.
    rig.placeOnGround(0, 3 - 1.25);
    rig.velocity = { x: 33, y: 0, z: 0 };
    rig.loads = () => ({ force: quat.rotateInv(rig.orientation, { x: 0, y: 0, z: -MASS * G0 }), moment: v3.zero() });
    fly(PA34_RETRACT.retractTime + 0.5);
    expect(actuator.state.extension).toEqual([0, 0, 0]);
    // Bus dead, selector DOWN: nothing (PA-34: no pump, pressure trapped). The knob: three greens in the free-fall time.
    input.lever = 'down';
    input.busVoltage = 0;
    fly(3);
    expect(actuator.state.extension).toEqual([0, 0, 0]);
    expect(actuator.state.inTransit).toBe(true);
    input.emergency = true;
    fly(PA34_RETRACT.emergency.freeFallTime + 0.5);
    expect(actuator.state.locked).toEqual([true, true, true]);
    expect(actuator.state.inTransit).toBe(false);
    // Down at 200 ft/min, 4 degrees nose up; then the wing stops flying and the brakes stop the aircraft.
    rig.orientation = quat.fromEuler(0, 4 * DEG, 0);
    rig.velocity = { x: 30, y: 0, z: 1 };
    rig.enableLandingAero(0.9);
    const touchdowns: string[] = [];
    const roll = (o: GearOutput) => {
      touchdowns.push(...o.touchdowns.map((t) => t.wheel));
      return o.crash !== '';
    };
    rig.run(4, roll);
    rig.loads = null;
    rig.controls.brakeLeft = rig.controls.brakeRight = 1;
    rig.run(14, roll);
    const total = rig.output.wheels.reduce((sum, w) => sum + w.load, 0);
    console.log(`[gear-up] landing on a free-fallen gear: touchdowns ${[...new Set(touchdowns)].join(', ')}; at rest ${rig.heightAGL().toFixed(3)} m, wheels carry ${(total / (MASS * G0)).toFixed(4)} of the weight`);
    expect(rig.output.crash).toBe('');
    expect([...new Set(touchdowns)].sort()).toEqual(['left', 'nose', 'right']);
    // At rest on the legs that fell free: the weight on three wheels at the design height.
    expect(v3.len(rig.velocity)).toBeLessThan(0.01);
    expect(Math.abs(total - MASS * G0) / (MASS * G0)).toBeLessThan(0.01);
    expect(Math.abs(rig.heightAGL() - 1.25)).toBeLessThan(0.03);
  });
});

describe('crash kinds of the fixed gear', () => {
  test('every crash of the Cessna 172S carries its kind, and its words are unchanged', () => {
    expect(touch(C172_GEAR, WINGTIP, 0.02, { roll: -60 * DEG })).toMatchObject({ crash: 'Left wingtip struck the ground', crashKind: 'structure' });
    expect(touch(C172_GEAR, PROP_TIP, 0.02, { pitch: -27 * DEG })).toMatchObject({ crash: 'Propeller strike', crashKind: 'propStrike' });
    expect(touch(C172_GEAR, PROP_TIP, 0.02, { pitch: -27 * DEG, velocity: FAST })).toMatchObject({ crash: 'Terrain impact at 117 kt, 0 fpm descent, 27° nose down (propeller first)', crashKind: 'impact' });
    expect(touch(C172_GEAR, C172.gear.leftMain, 0.02, { surface: 'water' })).toMatchObject({ crash: 'Ditched: the landing gear touched water', crashKind: 'ditching' });
    // A flat arrival at 4 m/s folds the nose leg.
    const hard = new GearRig();
    hard.placeOnGround(0, 0.05);
    hard.velocity = { x: 25, y: 0, z: 4 };
    hard.enableLandingAero();
    hard.run(2, (o) => o.crash !== '');
    expect(hard.output.crash).toMatch(/^Nose gear collapsed \(\d+ kN\)$/);
    expect(hard.output.crashKind).toBe('gearCollapse');
    // No crash: no kind. reset() clears both.
    const fine = touch(C172_GEAR, C172.gear.leftMain, 0.02);
    expect(fine.crash).toBe('');
    expect('crashKind' in fine).toBe(false);
    hard.placeOnGround(0);
    hard.loads = null;
    hard.run(0.5);
    expect(hard.output.crash).toBe('');
    expect(hard.output.crashKind).toBeUndefined();
  });
});

describe('water', () => {
  test('a gear-up arrival on water is a ditching, not a gear-up landing', () => {
    const a = arrive(RETRACT_GEAR, { extension: UP, pitch: 3 * DEG, speed: 33, sink: 1, surface: 'water' });
    expect(a.out).toMatchObject({ crash: 'Ditched: the airframe touched water', crashKind: 'ditching' });
    expect(touch(RETRACT_GEAR, BELLY, 0.02, { extension: UP, velocity: SLOW, pitch: 12 * DEG, surface: 'water' }).crash).toMatch(/water/);
  });

  test('wheels in the water say what they said, locked or in transit', () => {
    expect(arrive(RETRACT_GEAR, { extension: [1, 1, 1], pitch: 3 * DEG, speed: 33, sink: 1, surface: 'water' }).out).toMatchObject({ crash: 'Ditched: the landing gear touched water', crashKind: 'ditching' });
    expect(arrive(C172_GEAR, { pitch: 3 * DEG, speed: 33, sink: 1, surface: 'water' }).out.crash).toBe('Ditched: the landing gear touched water');
    expect(arrive(RETRACT_GEAR, { extension: [0.5, 0.95, 0.95], pitch: 3 * DEG, speed: 33, sink: 1, surface: 'water' }).out).toMatchObject({ crash: 'Ditched: the landing gear touched water', crashKind: 'ditching' });
  });

  test('any airframe point in the water ends the flight, whatever it tolerates on land', () => {
    const probe = { position: { x: 0, y: 0, z: 2 }, message: 'Probe', tolerance: 100 };
    const config: GearConfig = { ...C172_GEAR, structure: [probe] };
    expect(touch(config, probe.position, 0.05, { velocity: SLOW }).crash).toBe('');
    expect(touch(config, probe.position, 0.05, { velocity: SLOW, surface: 'water' })).toMatchObject({ crash: 'Ditched: the airframe touched water', crashKind: 'ditching' });
    expect(touch(C172_GEAR, WINGTIP, 0.02, { roll: -60 * DEG, surface: 'water' }).crash).toBe('Ditched: the airframe touched water');
  });

  test('at impact energy an airframe point meets water as it meets land', () => {
    // The Cessna 172S diving propeller first into a lake read "Terrain impact ... (propeller first)" before
    // the airframe points had a water test, and still does.
    const fixed = touch(C172_GEAR, PROP_TIP, 0.02, { pitch: -27 * DEG, velocity: FAST, surface: 'water' });
    expect(fixed).toMatchObject({ crash: 'Terrain impact at 117 kt, 0 fpm descent, 27° nose down (propeller first)', crashKind: 'impact' });
    const dive = 15 * DEG;
    const a = { extension: UP, pitch: -dive, speed: 100 * KT * Math.cos(dive), sink: 100 * KT * Math.sin(dive) };
    const land = arrive(RETRACT_GEAR, a).out;
    const water = arrive(RETRACT_GEAR, { ...a, surface: 'water' }).out;
    expect(water.crash).toBe(land.crash);
    expect(water.crashKind).toBe('impact');
  });
});

describe('cost', () => {
  test('handing the gear an extension costs nothing measurable, and legs in transit cost less than legs on the ground', () => {
    const timer = (extension: ArrayLike<number> | undefined, height: number) => {
      const rig = new GearRig(planeEnvironment(), MASS, RETRACT_GEAR);
      rig.placeOnGround(0, height);
      rig.velocity = { x: 10, y: 0, z: 0 };
      if (height === 0) rig.run(1);
      const body = { time: rig.time, position: rig.position, orientation: rig.orientation, velocityBody: rig.velocityBody(), angularVelocity: rig.angularVelocity, cgOffset: v3.zero(), mass: MASS };
      const input = { body, controls: rig.controls, env: rig.env, dt: DT, extension };
      return () => {
        const start = performance.now();
        for (let i = 0; i < 20000; i++) {
          body.time += DT;
          rig.gear.compute(input);
        }
        return ((performance.now() - start) / 20000) * 1000;
      };
    };
    // Rolling without an extension; rolling with [1, 1, 1]; half-way legs 0.5 m up, each tested against the
    // ground at every call. Alternating, the minimum of five each: the three see the same machine.
    const timers = [timer(undefined, 0), timer(new Float64Array([1, 1, 1]), 0), timer(new Float64Array([0.5, 0.5, 0.5]), 0.5)];
    const best = [Infinity, Infinity, Infinity];
    timers[0]();
    for (let rep = 0; rep < 5; rep++) timers.forEach((run, k) => (best[k] = Math.min(best[k], run())));
    const [fixed, down, transit] = best;
    console.log(`[gear-up] compute(): ${fixed.toFixed(2)} us rolling without an extension, ${down.toFixed(2)} us with [1, 1, 1], ${transit.toFixed(2)} us with the legs in transit near the ground`);
    expect(down / fixed).toBeLessThan(1.25);
    expect(transit / fixed).toBeLessThan(1);
  }, 60_000);
});
