// The constant-speed hub at work: the governor holding its speed through a power change, feathering and the
// latches that keep a ground shutdown from feathering, unfeathering by the starter and by the accumulator,
// settle() with a governor (both stops, and what it leaves and restores), the three states of a failed engine of
// a twin, and the resume snapshot. Test-beds: the PA-34-like constant-speed twin and the DA42-like FADEC diesel
// twin (testbed.ts).

import { describe, expect, it } from 'vitest';
import { DEG, KT } from '../../src/core/math';
import { PROP_FEATHER_GATE, setEngineControl, type ControlInputs } from '../../src/core/types';
import type { PropulsionInput, PropulsionOutput } from '../../src/physics/interfaces';
import { Powerplant } from '../../src/physics/propulsion';
import type { PowerplantDef, PropellerDef } from '../../src/physics/propulsion/defs';
import { DT, advance, makeInput } from './helpers';
import {
  CS_FEATHER_SECONDS, CS_PROPELLER, TWIN_CS_POWERPLANT, TWIN_DIESEL_POWERPLANT, constantSpeedUnit, dieselUnit, singlePowerplant,
} from './testbed';

const RPM = Math.PI / 30;
type ConstantSpeed = Extract<PropellerDef['pitchControl'], { kind: 'constantSpeed' }>;
const CS = CS_PROPELLER.pitchControl as ConstantSpeed;

/** The engine that is not the failed one is run as the controls say; engine 0 of a twin is failed this way. */
function fail(def: PowerplantDef, controls: ControlInputs): void {
  // A spark engine by its mixture, a FADEC one by its fuel (master still on: failed, not secured).
  if (def.engines[0].engine.kind === 'dieselFadec') setEngineControl(controls, 0, 'fuelSelector', 'off');
  else setEngineControl(controls, 0, 'mixture', 0);
}

/** Steps `sys` for `seconds`, calling `each` with the output after every step. */
function watch(sys: Powerplant, input: PropulsionInput, seconds: number, each: (out: PropulsionOutput, t: number) => void): void {
  const steps = Math.round(seconds / DT);
  for (let i = 1; i <= steps; i++) each(sys.step(input), i * DT);
}

describe('the governor', () => {
  // The defining property of a constant-speed propeller (Hartzell owner's manual; any PA-34 POH, "power
  // changes are made with manifold pressure at constant rpm"): a change of power moves the blade angle, not the
  // speed. 15 -> 25 inHg is a cruise-descent to climb power change made with one throttle movement.
  it('holds the lever\'s speed within 100 rpm through a 15 -> 25 inHg throttle step and settles in 3 s', () => {
    const sys = new Powerplant(singlePowerplant(constantSpeedUnit(1)));
    const input = makeInput({ ktas: 120, altitudeFt: 3000, controls: { fuelSelector: 'on', propeller: 0.7 } });
    // The throttle positions that give 15 and 25 inHg at the governed speed (settle() holds it), by bisection.
    const throttleFor = (inHg: number): number => {
      let lo = 0, hi = 1;
      for (let i = 0; i < 30; i++) {
        const mid = 0.5 * (lo + hi);
        sys.reset({ running: true, tanks: [100, 100], rpm: 2300 });
        input.controls.throttle = mid;
        if (sys.settle(input).engine.manifoldPressure < inHg) lo = mid;
        else hi = mid;
      }
      return 0.5 * (lo + hi);
    };
    const low = throttleFor(15), high = throttleFor(25);
    sys.reset({ running: true, tanks: [100, 100], rpm: 2300 });
    input.controls.throttle = low;
    const start = sys.settle(input);
    const set = sys.units[0].governedSpeed / RPM;
    const pitchBefore = start.propeller.bladePitch;
    expect(start.engine.manifoldPressure).toBeCloseTo(15, 2);
    // Lever at 0.7 of the governing range: 1700 + (0.7 - 0.08) / 0.92 x 1000 = 2374 rpm.
    expect(set).toBeCloseTo(1700 + ((0.7 - 0.08) / 0.92) * 1000, 6);
    expect(start.engine.rpm).toBeCloseTo(set, 0);

    // The throttle moved over one second, as a pilot moves it; slammed, below.
    let worst = 0, lastOut = 0, mp = 0;
    watch(sys, input, 8, (out, t) => {
      input.controls.throttle = Math.min(high, low + (high - low) * t);
      const error = Math.abs(out.engine.rpm - set);
      worst = Math.max(worst, error);
      // "Settled": within 1 % of the governed speed for good.
      if (error > 0.01 * set) lastOut = t;
      mp = out.engine.manifoldPressure;
    });
    console.log(`governor step 15 -> ${mp.toFixed(1)} inHg at ${set.toFixed(0)} rpm: worst excursion ${worst.toFixed(0)} rpm, outside 1 % until ${lastOut.toFixed(2)} s`);
    expect(mp).toBeCloseTo(25, 0);
    expect(worst).toBeLessThan(100);
    expect(worst).toBeGreaterThan(5); // the step does disturb the speed: the governor is not a constraint
    expect(lastOut).toBeLessThan(3);
    // The power went into the blade angle: coarser by several degrees, the speed where it was.
    expect(sys.units[0].bladePitch - pitchBefore).toBeGreaterThan(2 * DEG);
    expect(sys.units[0].rpm).toBeCloseTo(set, -1);

    sys.reset({ running: true, tanks: [100, 100], rpm: 2300 });
    input.controls.throttle = low;
    sys.settle(input);
    input.controls.throttle = high;
    let slam = 0;
    watch(sys, input, 3, (out) => (slam = Math.max(slam, Math.abs(out.engine.rpm - set))));
    console.log(`the same step with the throttle slammed: worst excursion ${slam.toFixed(0)} rpm`);
    // A slam is limited by the hub's coarse-going rate, 11 degrees a second (the 6 s feather time), not by the
    // governor: 118 rpm with the rate sensing, 135 without. Pilots are taught to move the throttle smoothly.
    expect(slam).toBeLessThan(150);
  }, 30_000);

  // review-Bm-propulsion F1: a governor that integrates the speed error alone is a lightly damped second-order
  // loop with the shaft (zeta about 0.2): a prop-lever push took the test-bed to 2795 rpm (+95), a DA42 LOAD
  // advance to 2487 (+187 over the 2300 limit). A flyweight governor settles such a change in 1-2 s with a small
  // overshoot; the flyweights' rate sensing (governor.dampingTime) is what damps it.
  it('settles a propeller-lever step and a FADEC LOAD step with an overshoot under 30 rpm, within 1.5 s', () => {
    /** Largest excursion beyond the new governed speed in the direction of the change, and when the speed was last more than 10 rpm off it. */
    const respond = (sys: Powerplant, input: PropulsionInput, change: () => void): { overshoot: number; settled: number; set: number } => {
      const before = sys.units[0].omega / RPM;
      change();
      sys.units[0].command(input.controls);
      const set = sys.units[0].governedSpeed / RPM;
      const sense = Math.sign(set - before);
      let overshoot = 0, settled = 0;
      watch(sys, input, 5, (out, t) => {
        const rpm = out.engine.propRpm;
        overshoot = Math.max(overshoot, sense * (rpm - set));
        if (Math.abs(rpm - set) > 10) settled = t;
      });
      expect(sys.units[0].omega / RPM).toBeCloseTo(set, -1);
      return { overshoot, settled, set };
    };
    const rows: string[] = [];
    const cs = new Powerplant(singlePowerplant(constantSpeedUnit(1)));
    const lever = makeInput({ ktas: 120, altitudeFt: 3000, controls: { fuelSelector: 'on', throttle: 0.8, propeller: 1 } });
    cs.reset({ running: true, tanks: [100, 100], rpm: 2300 });
    cs.settle(lever);
    const fadec = new Powerplant(singlePowerplant(dieselUnit(), TWIN_DIESEL_POWERPLANT));
    const load = makeInput({ ktas: 100, altitudeFt: 3000, controls: { fuelSelector: 'on', throttle: 0.3 } });
    fadec.reset({ running: true, tanks: [70, 70], rpm: 3380 });
    fadec.settle(load);
    for (const [name, sys, input, change] of [
      ['prop lever 1 -> 0.7', cs, lever, () => (lever.controls.propeller = 0.7)],
      ['prop lever 0.7 -> 1', cs, lever, () => (lever.controls.propeller = 1)],
      ['LOAD 30 -> 100 %', fadec, load, () => (load.controls.throttle = 1)],
      ['LOAD 100 -> 30 %', fadec, load, () => (load.controls.throttle = 0.3)],
    ] as const) {
      const r = respond(sys, input, change);
      rows.push(`${name} (to ${r.set.toFixed(0)} rpm): overshoot ${r.overshoot.toFixed(1)} rpm, within 10 rpm after ${r.settled.toFixed(2)} s`);
      expect(r.overshoot, name).toBeLessThan(30);
      expect(r.settled, name).toBeLessThan(1.5);
    }
    console.log(rows.join('\n'));
  }, 30_000);

  it('feathers in the data sheet\'s time and stops the propeller; a ground shutdown latches it fine instead', () => {
    // In the air at blue line (about 45 m/s): engine 0 failed and windmilling on its fine stop, then feathered.
    const sys = new Powerplant(TWIN_CS_POWERPLANT);
    sys.reset({ running: [false, true], tanks: [100, 100], rpm: [2300, 2300] });
    const input = makeInput({ ktas: 45 / KT, altitudeFt: 3000, engines: 2, controls: { fuelSelector: 'on' } });
    fail(TWIN_CS_POWERPLANT, input.controls);
    advance(sys, input, 5);
    expect(sys.units[0].bladePitch).toBe(CS.fineStop);
    setEngineControl(input.controls, 0, 'propeller', 0);
    let featheredAt = NaN, stoppedAt = NaN;
    watch(sys, input, 30, (out, t) => {
      if (Number.isNaN(featheredAt) && out.propellers[0].bladePitch >= CS.feather!.angle) featheredAt = t;
      if (Number.isNaN(stoppedAt) && out.engines[0].propRpm === 0) stoppedAt = t;
    });
    console.log(`feather: fine stop to feather in ${featheredAt.toFixed(2)} s, propeller stopped after ${stoppedAt.toFixed(1)} s`);
    // pa34.md section 5: about 6 s from the fine stop; the hub moves at a constant rate, so to a step.
    expect(featheredAt).toBeCloseTo(CS_FEATHER_SECONDS, 1);
    expect(sys.units[0].feathered).toBe(true);
    expect(stoppedAt).toBeLessThan(30);
    // The live engine is unaffected.
    expect(sys.units[1].rpm).toBeGreaterThan(2300);

    // On the ground: idle, then mixture to cut-off with the lever full forward. The engine runs down through
    // 800 rpm with the blades on the fine stop, the latches engage, and the loss of oil pressure, which would
    // take the blades to feather, is held off by them.
    const single = new Powerplant(singlePowerplant(constantSpeedUnit(1)));
    single.reset({ running: true, tanks: [100, 100], rpm: 800 });
    const ground = makeInput({ controls: { fuelSelector: 'on', throttle: 0, propeller: 1 } });
    single.settle(ground);
    advance(single, ground, 5);
    expect(single.units[0].bladePitch).toBe(CS.fineStop);
    ground.controls.mixture = 0;
    let lowestOil = Infinity;
    watch(single, ground, 60, (out) => (lowestOil = Math.min(lowestOil, out.engine.oilPressure)));
    expect(single.units[0].rpm).toBe(0);
    expect(lowestOil).toBeLessThan(1);
    expect(single.units[0].governor!.latched).toBe(true);
    expect(single.units[0].bladePitch).toBeLessThan(CS.feather!.latchAngle);
    expect(single.units[0].feathered).toBe(false);
  }, 30_000);

  it('a FADEC engine feathers with ENGINE MASTER off in the air, not on the ground', () => {
    const control = TWIN_DIESEL_POWERPLANT.engines[0].propeller.pitchControl as ConstantSpeed;
    const air = new Powerplant(TWIN_DIESEL_POWERPLANT);
    air.reset({ running: true, tanks: [70, 70], rpm: [3380, 3380] });
    const flying = makeInput({ ktas: 100, altitudeFt: 3000, engines: 2, controls: { fuelSelector: 'on', throttle: 0.6 } });
    air.settle(flying);
    setEngineControl(flying.controls, 0, 'engineMaster', false);
    advance(air, flying, 15);
    expect(air.units[0].feathered).toBe(true);
    expect(air.units[0].engine.firing).toBe(false);
    expect(air.units[1].engine.firing).toBe(true);

    // On the ground at idle the propeller turns below the 1300 rpm latch speed (da42.md section 5): master off
    // leaves the blades on the start locks.
    const ground = new Powerplant(singlePowerplant(dieselUnit(), TWIN_DIESEL_POWERPLANT));
    ground.reset({ running: true, tanks: [70, 70], rpm: 1200 });
    const parked = makeInput({ controls: { fuelSelector: 'on', throttle: 0 } });
    ground.settle(parked);
    advance(ground, parked, 3);
    expect(ground.units[0].state.propRpm).toBeLessThan(control.feather!.latchRpm);
    parked.controls.engineMaster = false;
    advance(ground, parked, 30);
    expect(ground.units[0].rpm).toBe(0);
    expect(ground.units[0].feathered).toBe(false);
    expect(ground.units[0].bladePitch).toBeLessThan(control.feather!.latchAngle);
  }, 30_000);

  it('unfeathers with the starter (no accumulator) and with the accumulator stroke (one, until recharged)', () => {
    // PA-34 air restart (POH emergency procedure): mixture rich, propeller lever forward, starter until the
    // propeller windmills. Cranking oil pressure drives the blades fine.
    const cs = new Powerplant(TWIN_CS_POWERPLANT);
    cs.reset({ running: [false, true], tanks: [100, 100], rpm: [0, 2300], feathered: [true, false] });
    const input = makeInput({ ktas: 100, altitudeFt: 3000, engines: 2, controls: { fuelSelector: 'on', throttle: 0.6, propeller: 0.9 } });
    setEngineControl(input.controls, 0, 'mixture', 0);
    advance(cs, input, 5);
    // Without the starter nothing happens: no oil pressure, the blades stay feathered, the propeller stopped.
    expect(cs.units[0].feathered).toBe(true);
    expect(cs.units[0].rpm).toBe(0);
    setEngineControl(input.controls, 0, 'starter', true);
    advance(cs, input, 4);
    setEngineControl(input.controls, 0, 'starter', false);
    advance(cs, input, 6);
    expect(cs.units[0].feathered).toBe(false);
    expect(cs.units[0].rpm).toBeGreaterThan(1000);

    // DA42 (da42.md section 5): the accumulator unfeathers once when ENGINE MASTER goes back on.
    const diesel = new Powerplant(TWIN_DIESEL_POWERPLANT);
    diesel.reset({ running: [false, true], tanks: [70, 70], rpm: [0, 3380], feathered: [true, false] });
    const flying = makeInput({ ktas: 100, altitudeFt: 3000, engines: 2, controls: { fuelSelector: 'on', throttle: 0.6 } });
    setEngineControl(flying.controls, 0, 'engineMaster', false);
    advance(diesel, flying, 3);
    expect(diesel.units[0].feathered).toBe(true);
    expect(diesel.units[0].governor!.accumulatorCharged).toBe(true);
    setEngineControl(flying.controls, 0, 'engineMaster', true);
    setEngineControl(flying.controls, 0, 'throttle', 0);
    advance(diesel, flying, 10);
    expect(diesel.units[0].feathered).toBe(false);
    expect(diesel.units[0].state.propRpm).toBeGreaterThan(600);
  }, 30_000);
});

describe('settle() with a governor', () => {
  // What settle() leaves is what the flight model starts from: a governed engine that is not at its governed
  // speed and blade angle would surge for 1-2 s after every airborne reset.
  it('leaves every governed unit steady: rpm within 30 rpm and thrust within 2 % over the first 3 s', () => {
    for (const def of [TWIN_CS_POWERPLANT, TWIN_DIESEL_POWERPLANT]) {
      const air = def.engines[0].engine.airStartRpm;
      for (const [ktas, altitudeFt, throttle, propeller] of [[120, 3000, 0.7, 0.8], [150, 8000, 1, 1], [90, 1000, 0.5, 0.6]]) {
        const sys = new Powerplant(def);
        sys.reset({ running: true, tanks: [70, 70], rpm: [air, air] });
        const input = makeInput({ ktas, altitudeFt, engines: 2, controls: { fuelSelector: 'on', throttle, propeller } });
        const out = sys.settle(input);
        const rpm0 = out.engines.map((e) => e.rpm), thrust0 = out.propellers.map((p) => p.thrust);
        let worstRpm = 0, worstThrust = 0;
        watch(sys, input, 3, (o) => {
          for (let i = 0; i < 2; i++) {
            worstRpm = Math.max(worstRpm, Math.abs(o.engines[i].rpm - rpm0[i]));
            worstThrust = Math.max(worstThrust, Math.abs(o.propellers[i].thrust / thrust0[i] - 1));
          }
        });
        console.log(`${def.engines[0].engine.name} ${ktas} kt ${altitudeFt} ft: ${rpm0[0].toFixed(0)} rpm, ${thrust0[0].toFixed(0)} N; over 3 s ${worstRpm.toFixed(1)} rpm, ${(worstThrust * 100).toFixed(2)} %`);
        expect(thrust0[0]).toBeGreaterThan(300);
        expect(worstRpm).toBeLessThan(30);
        expect(worstThrust).toBeLessThan(0.02);
      }
    }
  }, 60_000);

  it('pins the blades on the fine stop at low power and on the coarse stop when fast and powerful', () => {
    // A hub whose coarse stop is reached in a fast dive at full power and the lowest rpm.
    const control: ConstantSpeed = { ...CS, coarseStop: 21 * DEG };
    const def = singlePowerplant({ ...constantSpeedUnit(1), propeller: { ...CS_PROPELLER, pitchControl: control } });
    const sys = new Powerplant(def);
    const cases = [
      // Closed throttle in a slow descent: the propeller cannot be held at 2700 rpm, the blades go fine.
      { ktas: 80, throttle: 0, propeller: 1, stop: CS.fineStop, side: -1 },
      // Full power at 200 kt with the lever at the low end: overspeeds on the coarse stop.
      { ktas: 200, throttle: 1, propeller: PROP_FEATHER_GATE, stop: control.coarseStop, side: 1 },
    ];
    for (const c of cases) {
      sys.reset({ running: true, tanks: [100, 100], rpm: 2300 });
      const input = makeInput({ ktas: c.ktas, controls: { fuelSelector: 'on', throttle: c.throttle, propeller: c.propeller } });
      const out = sys.settle(input);
      const set = sys.units[0].governedSpeed / RPM;
      expect(out.propeller.bladePitch).toBe(c.stop);
      expect(Math.sign(out.engine.rpm - set)).toBe(c.side);
      expect(Math.abs(out.engine.rpm - set)).toBeGreaterThan(50);
      // The unit was stepped like a fixed-pitch one to its own steady speed: it stays there.
      const rpm0 = out.engine.rpm;
      const later = advance(sys, input, 3);
      expect(later.propeller.bladePitch).toBe(c.stop);
      expect(Math.abs(later.engine.rpm - rpm0)).toBeLessThan(30);
    }
  }, 30_000);

  it('restores tanks, battery and temperatures; leaves speed and blade angle; is a function of input and state', () => {
    const sys = new Powerplant(TWIN_CS_POWERPLANT);
    sys.reset({ running: true, tanks: [80, 60], rpm: [2300, 2300], batteryCharge: 0.7 });
    const input = makeInput({ ktas: 130, altitudeFt: 5000, engines: 2, controls: { fuelSelector: 'on', throttle: 0.75, propeller: 0.8 } });
    advance(sys, input, 2);
    const temps = sys.units.map((u) => [u.thermal.cht, u.thermal.oilTemp, u.thermal.egt, u.thermal.oilPressure]);
    const tanks = Array.from(sys.tankQuantities), charge = sys.batteryCharge;
    const out = sys.settle(input);
    expect(Array.from(sys.tankQuantities)).toEqual(tanks);
    expect(sys.batteryCharge).toBe(charge);
    sys.units.forEach((u, i) => expect([u.thermal.cht, u.thermal.oilTemp, u.thermal.egt, u.thermal.oilPressure]).toEqual(temps[i]));
    const pitch = out.propellers.map((p) => p.bladePitch), rpm = out.engines.map((e) => e.rpm);
    // Left: the governed speed and the blade angle that holds it (not the fine stop it was reset to).
    expect(sys.units[0].bladePitch).toBe(pitch[0]);
    expect(pitch[0]).toBeGreaterThan(CS.fineStop + 3 * DEG);
    expect(rpm[0]).toBeCloseTo(sys.units[0].governedSpeed / RPM, 3);
    // Settling again changes nothing.
    const again = sys.settle(input);
    expect(again.propellers[0].bladePitch).toBeCloseTo(pitch[0], 6);
    expect(again.engines[1].rpm).toBeCloseTo(rpm[1], 3);
  }, 30_000);
});

describe('a failed engine of a twin', () => {
  // The three states of contract 3.2. A failed engine that is not feathered windmills on its fine stop (the
  // certification Vmca condition); feathered it is stopped; a stopped fine-pitch propeller stays stopped,
  // because the air's torque on it at blue line is less than its breakaway torque.
  it('windmills above 600 rpm after 5 s at 45 m/s; feathered it is stopped; stopped unfeathered it stays stopped', () => {
    for (const def of [TWIN_CS_POWERPLANT, TWIN_DIESEL_POWERPLANT]) {
      const airStart = def.engines[0].engine.airStartRpm;
      const fine = (def.engines[0].propeller.pitchControl as ConstantSpeed).fineStop;
      const input = makeInput({ ktas: 45 / KT, altitudeFt: 3000, engines: 2, controls: { fuelSelector: 'on', throttle: 1, propeller: 1 } });
      const drag: number[] = [];
      for (const [rpm0, feathered] of [[airStart, false], [0, true], [0, false]] as const) {
        const input = makeInput({ ktas: 45 / KT, altitudeFt: 3000, engines: 2, controls: { fuelSelector: 'on', throttle: 1, propeller: 1 } });
        fail(def, input.controls);
        // Secured: propeller lever in feather; a FADEC engine's master off (with it on, the accumulator would unfeather).
        if (feathered) {
          setEngineControl(input.controls, 0, 'propeller', 0);
          setEngineControl(input.controls, 0, 'engineMaster', false);
        }
        const sys = new Powerplant(def);
        sys.reset({ running: [false, true], tanks: [70, 70], rpm: [rpm0, airStart], feathered: [feathered, false] });
        sys.settle(input);
        const out = advance(sys, input, 5);
        const dead = out.engines[0], prop = out.propellers[0];
        drag.push(-prop.thrust);
        console.log(`${def.engines[0].engine.name}: start ${rpm0} rpm, feathered ${feathered}: ${dead.propRpm.toFixed(0)} rpm, ${(prop.bladePitch / DEG).toFixed(1)} deg, drag ${(-prop.thrust).toFixed(0)} N`);
        expect(dead.running).toBe(false);
        expect(out.engines[1].running).toBe(true);
        if (rpm0 > 0) {
          expect(dead.propRpm).toBeGreaterThan(600);
          expect(prop.bladePitch).toBe(fine);
          expect(prop.feathered).toBe(false);
        } else {
          expect(dead.propRpm).toBe(0);
          expect(prop.feathered).toBe(feathered);
        }
      }
      // Feathering takes away nearly all of the drag of a dead propeller on its fine stop, turning or not.
      expect(drag[1]).toBeGreaterThan(0);
      expect(drag[0]).toBeGreaterThan(8 * drag[1]);
      expect(drag[2]).toBeGreaterThan(8 * drag[1]);
    }
  }, 60_000);

  // review-Bm-propulsion F5: the identify-verify-feather lesson needs a windmilling propeller on its fine stop to
  // be the HIGH-drag state, a stopped one well below it, a feathered one nearly nothing (contract 3.2; FAA AFH
  // ch. 12). At Vyse, failed as contract 3.4 fails an engine for the trims (throttle closed, fuel cut; FADEC:
  // master on), 20 s after the failure. With the 172's broadside drag coefficient (1.6) on these blades the
  // stopped propeller had 0.84 of the windmilling drag and broke away at 91 kt.
  it('at Vyse windmilling drags well over a stopped propeller, which stays stopped; feathered drags almost nothing', () => {
    const rows: string[] = [];
    for (const [def, ktas] of [[singlePowerplant(constantSpeedUnit(1)), 91], [singlePowerplant(dieselUnit(), TWIN_DIESEL_POWERPLANT), 85]] as const) {
      const diesel = def.engines[0].engine.kind === 'dieselFadec';
      const drag = (state: 'windmilling' | 'stopped' | 'feathered'): { drag: number; rpm: number } => {
        const input = makeInput({ ktas, controls: { throttle: 0, mixture: 0, fuelSelector: 'off', propeller: state === 'feathered' && !diesel ? 0 : 1 } });
        if (diesel) setEngineControl(input.controls, 0, 'engineMaster', state !== 'feathered');
        const sys = new Powerplant(def);
        sys.reset({ running: false, tanks: [70, 70], rpm: state === 'windmilling' ? def.engines[0].engine.airStartRpm : 0, feathered: [state === 'feathered'] });
        const out = advance(sys, input, 20);
        return { drag: -out.propeller.thrust, rpm: out.engine.propRpm };
      };
      const windmilling = drag('windmilling'), stopped = drag('stopped'), feathered = drag('feathered');
      rows.push(`${def.engines[0].engine.name} at ${ktas} kt: windmilling ${windmilling.drag.toFixed(0)} N at ${windmilling.rpm.toFixed(0)} rpm, stopped ${stopped.drag.toFixed(0)} N, feathered ${feathered.drag.toFixed(0)} N`);
      expect(windmilling.rpm).toBeGreaterThan(600);
      expect(stopped.rpm).toBe(0);
      expect(feathered.rpm).toBe(0);
      expect(windmilling.drag).toBeGreaterThan(1.4 * stopped.drag);
      expect(stopped.drag).toBeGreaterThan(8 * feathered.drag);
    }
    console.log(rows.join('\n'));
  }, 60_000);

  it('primeForTrim() puts every unfeathered unit at the crank speed asked for and a feathered one at rest', () => {
    const sys = new Powerplant(TWIN_DIESEL_POWERPLANT);
    sys.reset({ running: [false, true], tanks: [70, 70], rpm: [0, 0], feathered: [true, false] });
    sys.primeForTrim(3380);
    expect(sys.units[0].omega).toBe(0);
    expect(sys.units[0].feathered).toBe(true);
    // Through the 1.69 gear: 3380 crank rpm is 2000 propeller rpm.
    expect(sys.units[1].rpm).toBeCloseTo(3380, 9);
    expect(sys.units[1].omega / RPM).toBeCloseTo(3380 / 1.69, 9);
    sys.reset({ running: [false, true], tanks: [70, 70], rpm: [0, 0] });
    sys.primeForTrim(3380);
    expect(sys.units[0].rpm).toBeCloseTo(3380, 9);
  });
});

describe('the resume snapshot', () => {
  it('capture() and restore() carry a governed twin over: the copy flies on as the original', () => {
    const original = new Powerplant(TWIN_DIESEL_POWERPLANT);
    original.reset({ running: true, tanks: [70, 70], rpm: [3380, 3380] });
    const input = makeInput({ ktas: 120, altitudeFt: 5000, engines: 2, controls: { fuelSelector: 'on', throttle: 0.75 } });
    original.settle(input);
    setEngineControl(input.controls, 1, 'engineMaster', false);
    advance(original, input, 4);
    const snaps = original.capture();
    expect(snaps).toHaveLength(2);
    expect(snaps[1].bladePitch).toBeGreaterThan(snaps[0].bladePitch);
    expect(snaps[0].coolantTemp).toBeGreaterThan(60);
    expect(snaps[1].accumulatorCharged).toBe(true);

    const copy = new Powerplant(TWIN_DIESEL_POWERPLANT);
    copy.reset({ running: true, tanks: Array.from(original.tankQuantities), rpm: [3380, 3380], batteryCharge: original.batteryCharge });
    copy.restore(JSON.parse(JSON.stringify(snaps)));
    expect(copy.capture()).toEqual(snaps.map((s) => ({ ...s })));
    const a = advance(original, input, 3);
    const aRpm = a.engines.map((e) => e.propRpm), aPitch = a.propellers.map((p) => p.bladePitch);
    const b = advance(copy, input, 3);
    for (let i = 0; i < 2; i++) {
      // The lagged torque and the manifold's lag are not in the snapshot: they recover within a fraction of a second.
      expect(b.engines[i].propRpm).toBeCloseTo(aRpm[i], -1);
      expect(Math.abs(b.propellers[i].bladePitch - aPitch[i])).toBeLessThan(0.2 * DEG);
    }
  }, 30_000);
});
