// The FADEC turbodiesel of the DA42-like test-bed (testbed.ts): the POWER law of the engine control unit at the
// handbook's settings, the critical altitude, the reduction gear, liquid cooling, the glow plugs, and what keeps
// the ECU alive (the bus, the engine's own alternator, the backup battery).

import { describe, expect, it } from 'vitest';

import { setEngineControl } from '../../src/core/types';
import { Powerplant } from '../../src/physics/propulsion';
import { DieselEngine } from '../../src/physics/propulsion/dieselEngine';
import { DT, advance, makeInput } from './helpers';
import { DIESEL_ENGINE, DIESEL_PROPELLER, TWIN_DIESEL_POWERPLANT, dieselUnit, singlePowerplant, twinDieselPowerplant } from './testbed';

const RPM = Math.PI / 30;
const GEAR = DIESEL_ENGINE.gearRatio;

function diesel(): Powerplant {
  const sys = new Powerplant(singlePowerplant(dieselUnit(), TWIN_DIESEL_POWERPLANT));
  sys.reset({ running: true, tanks: [70, 70], rpm: DIESEL_ENGINE.airStartRpm });
  return sys;
}

describe('the power law of the ECU', () => {
  // DA42 NG AFM (da42.md, contract 5.5): LOAD is the fraction of rated power the lever asks for, and the ECU
  // schedules the propeller at 2100 rpm at 92 % and 2029 rpm at 75 % (the 0.2 -> 1800, 0.92 -> 2100 segment).
  // Neither is the rated speed, so a law that demanded a fraction of rated TORQUE would give 92 % x 2100 / 2300
  // = 84 % and 75 % x 2029 / 2300 = 66 %.
  it('delivers 92 +/- 1 % of rated power at lever 0.92 and 2100 rpm, 75 +/- 1 % at 0.75 and 2029 rpm', () => {
    const sys = diesel();
    for (const [lever, propRpm, load] of [[0.92, 2100, 92], [0.75, 1800 + ((0.75 - 0.2) / 0.72) * 300, 75]]) {
      for (const [ktas, altitudeFt] of [[90, 2000], [130, 6000], [150, 10000]]) {
        sys.reset({ running: true, tanks: [70, 70], rpm: DIESEL_ENGINE.airStartRpm });
        const input = makeInput({ ktas, altitudeFt, controls: { fuelSelector: 'on', throttle: lever } });
        sys.settle(input);
        // Flown, not only settled: 5 s of steps from the solution.
        const out = advance(sys, input, 5);
        expect(out.engine.propRpm).toBeCloseTo(propRpm, -1);
        expect(Math.abs(out.engine.loadPercent - load)).toBeLessThan(1);
        expect(Math.abs((100 * sys.brakePower(0)) / DIESEL_ENGINE.ratedPower - load)).toBeLessThan(1);
        // Not the torque law.
        expect(out.engine.loadPercent).toBeGreaterThan(load * (propRpm / 2300) + 3);
      }
    }
  }, 30_000);

  it('holds 92 % to its critical altitude band and loses power with density above it', () => {
    // da42.md section 4: 92 % is available to about 14 000 ft; above that the turbocharger cannot keep up.
    const sys = diesel();
    const at = (altitudeFt: number): number => {
      sys.reset({ running: true, tanks: [70, 70], rpm: DIESEL_ENGINE.airStartRpm });
      return sys.settle(makeInput({ ktas: 130, altitudeFt, controls: { fuelSelector: 'on', throttle: 0.92 } })).engine.loadPercent;
    };
    expect(at(12_000)).toBeCloseTo(92, 0);
    const high = at(18_000);
    expect(high).toBeLessThan(88);
    expect(high).toBeGreaterThan(60);
  }, 30_000);

  it('turns the crank 1.69 times as fast as the propeller, and the propeller absorbs the brake power', () => {
    const sys = diesel();
    const out = sys.settle(makeInput({ ktas: 120, altitudeFt: 4000, controls: { fuelSelector: 'on', throttle: 0.8 } }));
    expect(out.engine.rpm / out.engine.propRpm).toBeCloseTo(GEAR, 12);
    // Steady: the propeller's aerodynamic torque times ITS speed is the engine's brake power (less the alternator).
    const unit = sys.units[0];
    const absorbed = unit.propeller.loads.torque * unit.omega;
    expect(absorbed / out.engine.power).toBeGreaterThan(0.97);
    expect(absorbed / out.engine.power).toBeLessThanOrEqual(1 + 1e-6);
    // Angular momentum: the propeller at its speed plus the crank side at 1.69 times it.
    const omega = out.engine.propRpm * RPM;
    expect(out.angularMomentum.x).toBeCloseTo((DIESEL_PROPELLER.inertia + GEAR * DIESEL_ENGINE.rotatingInertia) * omega, 9);
    // The shaft equation's inertia carries the crank side times the square of the gear.
    expect(unit.inertia).toBeCloseTo(DIESEL_PROPELLER.inertia + GEAR * GEAR * DIESEL_ENGINE.rotatingInertia, 12);
  }, 30_000);

  // review-Bm-propulsion F8: a single offset spur stage (the AE300's) turns the crank the other way from the
  // propeller, and the crank side's angular momentum then subtracts: 0.95 - 1.69 x 0.15 = 0.70 instead of 1.20.
  it('a reversing gear subtracts the crank side\'s angular momentum and leaves the shaft equation alone', () => {
    const unit = dieselUnit();
    const sys = new Powerplant(singlePowerplant({ ...unit, engine: { ...unit.engine, gearReverses: true } }, TWIN_DIESEL_POWERPLANT));
    sys.reset({ running: true, tanks: [70, 70], rpm: DIESEL_ENGINE.airStartRpm });
    const out = sys.settle(makeInput({ ktas: 120, altitudeFt: 4000, controls: { fuelSelector: 'on', throttle: 0.8 } }));
    const omega = out.engine.propRpm * RPM;
    expect(sys.units[0].momentInertia).toBeCloseTo(DIESEL_PROPELLER.inertia - GEAR * DIESEL_ENGINE.rotatingInertia, 12);
    expect(out.angularMomentum.x).toBeCloseTo((DIESEL_PROPELLER.inertia - GEAR * DIESEL_ENGINE.rotatingInertia) * omega, 9);
    expect(sys.units[0].inertia).toBeCloseTo(DIESEL_PROPELLER.inertia + GEAR * GEAR * DIESEL_ENGINE.rotatingInertia, 12);
    // The steady speed and power do not depend on which way the crank turns.
    const same = diesel();
    const ref = same.settle(makeInput({ ktas: 120, altitudeFt: 4000, controls: { fuelSelector: 'on', throttle: 0.8 } }));
    expect(out.engine.propRpm).toBe(ref.engine.propRpm);
    expect(out.engine.power).toBe(ref.engine.power);
  }, 30_000);

  it('lags the delivered torque behind the demand by the turbocharger\'s time constant', () => {
    const sys = diesel();
    const input = makeInput({ ktas: 120, altitudeFt: 4000, controls: { fuelSelector: 'on', throttle: 0.4 } });
    sys.settle(input);
    const engine = sys.units[0].engine as DieselEngine;
    const before = engine.deliveredTorque;
    input.controls.throttle = 0.9;
    advance(sys, input, DIESEL_ENGINE.fadec!.torqueLag);
    const oneLag = engine.deliveredTorque;
    advance(sys, input, 5);
    const after = engine.deliveredTorque;
    // After one time constant, 1 - 1/e = 63 % of the way (the target itself moves a little with the speed).
    const fraction = (oneLag - before) / (after - before);
    expect(fraction).toBeGreaterThan(0.55);
    expect(fraction).toBeLessThan(0.72);
  }, 30_000);
});

describe('liquid cooling and glow plugs', () => {
  it('warms the coolant to the thermostat in cruise and fills CHT and EGT for the gauges that read them', () => {
    const sys = new Powerplant(singlePowerplant(dieselUnit(), TWIN_DIESEL_POWERPLANT));
    sys.reset({ running: true, tanks: [70, 70], rpm: DIESEL_ENGINE.airStartRpm, warm: false, oat: 288.15 });
    const input = makeInput({ ktas: 120, altitudeFt: 4000, controls: { fuelSelector: 'on', throttle: 0.7 } });
    sys.settle(input);
    const out = advance(sys, input, 900);
    const liquid = DIESEL_ENGINE.thermal.liquid!;
    console.log(`after 15 min at 70 %: coolant ${out.engine.coolantTemp!.toFixed(1)} C, gearbox ${out.engine.gearboxTemp!.toFixed(1)} C, oil ${out.engine.oilTemp.toFixed(1)} C, CHT ${out.engine.cht.toFixed(1)} C`);
    // The thermostat holds the coolant within a few degrees of its setting once warm.
    expect(out.engine.coolantTemp!).toBeGreaterThan(liquid.thermostatC - 5);
    expect(out.engine.coolantTemp!).toBeLessThan(liquid.thermostatC + 12);
    expect(out.engine.gearboxTemp!).toBeGreaterThan(30);
    expect(out.engine.gearboxTemp!).toBeLessThan(120);
    expect(Number.isFinite(out.engine.cht) && Number.isFinite(out.engine.egt)).toBe(true);
    expect(out.engine.egt).toBeGreaterThan(out.engine.cht);
  }, 30_000);

  it('a cold engine glows for its pre-heat time before it fires; a warm one does not glow', () => {
    const glow = DIESEL_ENGINE.ignition.kind === 'compression' ? DIESEL_ENGINE.ignition.glow : undefined;
    for (const warm of [false, true]) {
      const sys = new Powerplant(singlePowerplant(dieselUnit(), TWIN_DIESEL_POWERPLANT));
      sys.reset({ running: false, tanks: [70, 70], rpm: 0, warm, oat: 278.15 });
      const input = makeInput({ controls: { fuelSelector: 'on', throttle: 0, starter: true } });
      let glowed = 0, firedAt = NaN, t = 0;
      for (let i = 0; i < 20 * 240; i++, t += DT) {
        const out = sys.step(input);
        if (out.engine.glow) glowed += DT;
        if (Number.isNaN(firedAt) && sys.units[0].engine.firing) firedAt = t;
      }
      if (warm) {
        expect(glowed).toBe(0);
        expect(firedAt).toBeLessThan(2);
      } else {
        expect(glowed).toBeCloseTo(glow!.preheatSeconds, 1);
        expect(firedAt).toBeGreaterThanOrEqual(glow!.preheatSeconds - DT);
        expect(firedAt).toBeLessThan(glow!.preheatSeconds + 3);
      }
    }
  }, 30_000);
});

describe('what keeps the ECU alive', () => {
  // The inverse of a magneto engine: with the master switches on and the bus dead, a FADEC engine runs on its
  // ECU backup battery for backupSeconds and then stops (contract 3.2). Here a definition whose ECUs are not fed
  // by their own alternators, with a 30 s backup so the test is short.
  it('stops backupSeconds after the bus dies, unless its own alternator feeds the ECU', () => {
    for (const alternatorFed of [false, true]) {
      const def = twinDieselPowerplant({ alternatorFed, backupSeconds: 30 });
      const sys = new Powerplant(def);
      sys.reset({ running: true, tanks: [70, 70], rpm: [3380, 3380] });
      const input = makeInput({ ktas: 120, altitudeFt: 4000, engines: 2, controls: { fuelSelector: 'on', throttle: 0.6 } });
      sys.settle(input);
      input.controls.masterBattery = false;
      let stoppedAt = NaN, t = 0;
      for (let i = 0; i < 45 * 240; i++) {
        const out = sys.step(input);
        t += DT;
        expect(out.electrical.busVoltage).toBe(0);
        if (Number.isNaN(stoppedAt) && !sys.units[0].engine.firing) stoppedAt = t;
      }
      if (alternatorFed) {
        expect(stoppedAt).toBeNaN();
        expect(sys.units[1].engine.firing).toBe(true);
      } else {
        expect(stoppedAt).toBeCloseTo(30, 1);
        expect(sys.units[1].engine.firing).toBe(false);
        expect(sys.units[0].state.ecuPowered).toBe(false);
      }
    }
  }, 60_000);

  // review-Bm-propulsion F9: the backup battery is charged from the aircraft's system (da42.md), so a second
  // bus failure an hour after a first one of 25 min gets the whole backup time again, not what was left.
  it('recharges the backup battery while the bus is up', () => {
    const sys = new Powerplant(twinDieselPowerplant({ alternatorFed: false, backupSeconds: 30 }));
    sys.reset({ running: true, tanks: [70, 70], rpm: [3380, 3380] });
    const input = makeInput({ ktas: 120, altitudeFt: 4000, engines: 2, controls: { fuelSelector: 'on', throttle: 0.6 } });
    sys.settle(input);
    const engine = sys.units[0].engine as DieselEngine;
    input.controls.masterBattery = false;
    advance(sys, input, 25);
    expect(engine.firing).toBe(true);
    expect(engine.backupUsed).toBeCloseTo(25, 6);
    input.controls.masterBattery = true;
    advance(sys, input, 15);
    // Half way back after half the backup time.
    expect(engine.backupUsed).toBeCloseTo(10, 1);
    advance(sys, input, 30);
    expect(engine.backupUsed).toBe(0);
    input.controls.masterBattery = false;
    advance(sys, input, 25);
    expect(engine.firing).toBe(true);
    advance(sys, input, 6);
    expect(engine.firing).toBe(false);
  }, 60_000);

  it('a fuel cut with the master on leaves the ECU alive and the propeller windmilling (failed, not secured)', () => {
    const sys = new Powerplant(TWIN_DIESEL_POWERPLANT);
    sys.reset({ running: true, tanks: [70, 70], rpm: [3380, 3380] });
    const input = makeInput({ ktas: 90, altitudeFt: 4000, engines: 2, controls: { fuelSelector: 'on', throttle: 0.9 } });
    sys.settle(input);
    setEngineControl(input.controls, 0, 'fuelSelector', 'off');
    const out = advance(sys, input, 20);
    expect(sys.units[0].engine.firing).toBe(false);
    expect(out.engines[0].ecuPowered).toBe(true);
    expect(out.engines[0].propRpm).toBeGreaterThan(600);
    expect(out.propellers[0].feathered).toBe(false);
  }, 30_000);
});
