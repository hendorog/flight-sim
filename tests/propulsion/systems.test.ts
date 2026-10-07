import { describe, expect, it } from 'vitest';
import { C172 } from '../../src/core/c172';
import { KT } from '../../src/core/math';
import { PropulsionSystem, ROTOR_INERTIA, TANK_CAPACITY } from '../../src/physics/propulsion';
import { DT, makeInput, run, runningSystem } from './helpers';

describe('forces and moments on the airframe', () => {
  it('reacts the engine torque as a left rolling moment and reports rotor angular momentum along +x', () => {
    const sys = runningSystem(2300);
    const out = run(sys, {}, 20);
    const omega = (out.engine.rpm * Math.PI) / 30;
    // Steady state: block reaction equals the propeller's aerodynamic torque.
    const propTorque = out.engine.power / omega;
    expect(out.moment.x).toBeLessThan(0);
    expect(out.moment.x).toBeCloseTo(-propTorque, -1);
    expect(out.angularMomentum.x).toBeCloseTo(ROTOR_INERTIA * omega, 6);
    expect(out.angularMomentum.y).toBe(0);
    expect(out.angularMomentum.z).toBe(0);
    expect(out.force.x).toBeCloseTo(out.propeller.thrust, 9);
  });

  it('takes the thrust moment about the actual CG (thrust line below a raised CG pitches nose up)', () => {
    const sys = runningSystem(2300);
    const input = makeInput({});
    input.body.cgOffset = { x: -0.1, y: 0, z: -0.3 };
    let out = sys.step(input);
    for (let i = 0; i < 240 * 5; i++) out = sys.step(input);
    const hubZ = C172.prop.hub.z - input.body.cgOffset.z;
    expect(hubZ).toBeGreaterThan(0);
    expect(out.moment.y).toBeCloseTo(hubZ * out.force.x - (C172.prop.hub.x + 0.1) * out.force.z, 6);
    expect(out.moment.y).toBeGreaterThan(0);
  });

  it('adds a left-yawing P-factor moment at high angle of attack under power', () => {
    const level = run(runningSystem(2400), { ktas: 65, alpha: 0 }, 10);
    const yawLevel = level.moment.z;
    const climb = run(runningSystem(2400), { ktas: 65, alpha: 0.2 }, 10);
    console.log(`yaw moment about CG at 65 kt full power: alpha 0 -> ${yawLevel.toFixed(1)} N m, alpha 11.5 deg -> ${climb.moment.z.toFixed(1)} N m (normal force ${climb.force.z.toFixed(0)} N)`);
    expect(yawLevel).toBeCloseTo(0, 6);
    expect(climb.moment.z).toBeLessThan(-30);
    expect(climb.force.z).toBeLessThan(0);
  });

  it('publishes a slipstream at the hub that is stronger at full power than at idle', () => {
    const full = run(runningSystem(2400), { ktas: 60 }, 10);
    const fullU = full.slipstream.inducedVelocity;
    const idle = run(runningSystem(900), { ktas: 60, controls: { throttle: 0 } }, 10);
    console.log(`slipstream at 60 kt: full power u ${fullU.toFixed(1)} m/s; idle u ${idle.slipstream.inducedVelocity.toFixed(2)} m/s`);
    expect(full.slipstream.origin).toEqual(C172.prop.hub);
    expect(fullU).toBeGreaterThan(8);
    expect(idle.slipstream.inducedVelocity).toBeLessThan(fullU / 4);
  });
});

describe('integration', () => {
  it('gives the same steady state at 120 Hz and 480 Hz physics', () => {
    const rpmAt = (dt: number): number => {
      const sys = runningSystem(1500);
      const input = makeInput({ ktas: 80 });
      input.dt = dt;
      let rpm = 0;
      for (let t = 0; t < 15; t += dt) rpm = sys.step(input).engine.rpm;
      return rpm;
    };
    const coarse = rpmAt(1 / 120);
    const fine = rpmAt(1 / 480);
    expect(Math.abs(coarse - fine)).toBeLessThan(3);
  });

  it('spins up with the real rotor inertia (about 1 s from idle to take-off rpm)', () => {
    const sys = runningSystem(700);
    run(sys, { controls: { throttle: 0 } }, 20);
    const input = makeInput({ controls: { throttle: 1 } });
    let t = 0;
    while (sys.step(input).engine.rpm < 2200 && t < 10) t += DT;
    console.log(`idle to 2200 rpm in ${t.toFixed(2)} s`);
    expect(t).toBeGreaterThan(0.4);
    expect(t).toBeLessThan(3);
  });

  it('stays finite under random control inputs and flight conditions', () => {
    const sys = runningSystem(2000);
    let seed = 12345;
    const rnd = (): number => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const input = makeInput({});
    for (let i = 0; i < 240 * 60; i++) {
      if (i % 120 === 0) {
        const c = input.controls;
        c.throttle = rnd();
        c.mixture = rnd();
        c.magnetos = Math.floor(rnd() * 4) as 0 | 1 | 2 | 3;
        c.starter = rnd() < 0.2;
        c.fuelSelector = (['off', 'left', 'right', 'both'] as const)[Math.floor(rnd() * 4)];
        const v = (rnd() * 180 - 20) * KT;
        input.airVelocityBody = { x: -v, y: (rnd() - 0.5) * 30, z: (rnd() - 0.5) * 30 };
      }
      const out = sys.step(input);
      for (const x of [out.force.x, out.force.y, out.force.z, out.moment.x, out.moment.y, out.moment.z, out.engine.rpm, out.engine.egt, out.engine.cht, out.slipstream.swirlRate]) {
        expect(Number.isFinite(x)).toBe(true);
      }
      expect(out.engine.rpm).toBeGreaterThanOrEqual(0);
      expect(out.engine.rpm).toBeLessThan(4000);
    }
  });
});

describe('electrical system', () => {
  it('holds 28 V with the alternator above idle and discharges on battery alone', () => {
    const charging = run(runningSystem(2000), { ktas: 90, controls: { throttle: 0.6 } }, 30);
    expect(charging.electrical.busVoltage).toBeGreaterThan(27.8);
    expect(charging.electrical.busVoltage).toBeLessThan(28.8);
    expect(charging.electrical.alternatorAmps).toBeGreaterThan(10);

    const sys = runningSystem(2000);
    const battery = run(sys, { ktas: 90, controls: { throttle: 0.6, alternator: false } }, 600);
    console.log(`alternator off 10 min: bus ${battery.electrical.busVoltage.toFixed(2)} V, charge ${(battery.electrical.batteryCharge * 100).toFixed(1)} %`);
    expect(battery.electrical.busVoltage).toBeLessThan(26);
    expect(battery.electrical.batteryCharge).toBeLessThan(0.8);
    expect(battery.electrical.alternatorAmps).toBe(0);
  });

  it('has a dead bus with the master off, and the engine keeps running on its magnetos', () => {
    const out = run(runningSystem(2000), { ktas: 90, controls: { throttle: 0.6, masterBattery: false } }, 10);
    expect(out.electrical.busVoltage).toBe(0);
    expect(out.engine.running).toBe(true);
  });
});

describe('reset and fuel quantities', () => {
  it('exposes fuel quantities and clamps them to the tank capacity', () => {
    const sys = new PropulsionSystem();
    expect(sys.fuelCapacityEach).toBe(TANK_CAPACITY);
    sys.reset({ running: false, fuelLeft: 30, fuelRight: 1000 });
    expect(sys.fuelLeft).toBe(30);
    expect(sys.fuelRight).toBe(TANK_CAPACITY);
    expect(sys.rpm).toBe(0);
  });

  it('starts a running engine near the requested rpm, warm', () => {
    const sys = new PropulsionSystem();
    sys.reset({ running: true, fuelLeft: 50, fuelRight: 50, rpm: 2400 });
    const out = sys.step(makeInput({ ktas: 100, controls: { throttle: 0.8 } }));
    expect(out.engine.running).toBe(true);
    expect(Math.abs(out.engine.rpm - 2400)).toBeLessThan(10);
    expect(out.engine.cht).toBeGreaterThan(100);
  });

  it('stops when a selected tank runs dry and runs again on the other tank', () => {
    const sys = new PropulsionSystem();
    sys.reset({ running: true, fuelLeft: 0.2, fuelRight: 40, rpm: 2400 });
    const dry = run(sys, { ktas: 100, controls: { fuelSelector: 'left' } }, 60);
    expect(sys.fuelLeft).toBe(0);
    expect(dry.engine.running).toBe(false);
    const again = run(sys, { ktas: 100, controls: { fuelSelector: 'right' } }, 10);
    expect(again.engine.running).toBe(true);
  });

  /** Seconds after `restore` until the engine delivers 50 hp, stepping a windmilling engine at 5000 ft. */
  const timeTo50hp = (sys: PropulsionSystem, controls: Partial<import('../../src/core/types').ControlInputs>, ktas: number): number => {
    const input = makeInput({ ktas, altitudeFt: 5000, controls: { throttle: 0.5, ...controls } });
    for (let t = 0; t < 30; t += DT) {
      const out = sys.step(input);
      if (out.engine.power > 50 * 745.7) return t;
    }
    return Infinity;
  };

  it('restarts after fuel starvation only once the pump has re-primed and the injector lines refilled (sooner with the aux pump)', () => {
    const starve = () => {
      const sys = new PropulsionSystem();
      sys.reset({ running: true, fuelLeft: 40, fuelRight: 40, rpm: 2400 });
      const dead = run(sys, { ktas: 80, altitudeFt: 5000, controls: { throttle: 0.5, fuelSelector: 'off' } }, 40);
      expect(dead.engine.running).toBe(false);
      return sys;
    };
    const plain = timeTo50hp(starve(), { fuelSelector: 'both' }, 80);
    const aux = timeTo50hp(starve(), { fuelSelector: 'both', fuelPump: true }, 80);
    console.log(`[propulsion] restart after starvation: ${plain.toFixed(2)} s windmilling, ${aux.toFixed(2)} s with the aux pump`);
    expect(plain).toBeGreaterThan(3);
    expect(plain).toBeLessThan(12);
    expect(aux).toBeGreaterThan(1);
    expect(aux).toBeLessThan(plain - 1);
  });

  it('relights within about 1-2 s when the mixture is pushed in from idle cut-off', () => {
    const cut = (seconds: number) => {
      const sys = new PropulsionSystem();
      sys.reset({ running: true, fuelLeft: 40, fuelRight: 40, rpm: 2400 });
      const dead = run(sys, { ktas: 80, altitudeFt: 5000, controls: { throttle: 0.5, mixture: 0 } }, seconds);
      expect(dead.engine.running).toBe(false);
      return timeTo50hp(sys, { mixture: 1 }, 80);
    };
    const quick = cut(2), long = cut(20);
    console.log(`[propulsion] relight from cut-off: ${quick.toFixed(2)} s after 2 s, ${long.toFixed(2)} s after 20 s`);
    // Straight back in, the lines are still full: it catches at once, as in the aeroplane.
    expect(quick).toBeLessThan(1);
    expect(long).toBeGreaterThan(0.8);
    expect(long).toBeLessThan(3);
  });

  it('keeps the injector lines full while parked, so a cold engine left standing still starts in a few seconds', () => {
    // Regression: the lines used to drain at rest, and after two minutes on the apron the engine would not
    // start within 30 s of cranking (the Flight School's L02 engine start was unpassable in the browser).
    const sys = new PropulsionSystem();
    sys.reset({ running: false, fuelLeft: 72, fuelRight: 72 });
    const parked = makeInput({ controls: { throttle: 0.1, mixture: 1 } });
    for (let t = 0; t < 600; t += parked.dt) sys.step(parked);
    const crank = makeInput({ controls: { throttle: 0.1, mixture: 1, starter: true } });
    let t = 0;
    while (!sys.step(crank).engine.running && t < 30) t += crank.dt;
    expect(t).toBeLessThan(3);
  });
});
