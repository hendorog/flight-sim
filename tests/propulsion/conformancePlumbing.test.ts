// The conformance plumbing of beta and reverse (plan 3.2), on a whole aircraft: the C208 with the beta test-bed's
// range and a reversing cam grafted on (C208_BETA below; the C208's own beta data are its package's). The idle taxi
// measurement at the three lever positions, the landing roll with the power lever aft of the gate, the scripted
// pilot's roll-out lever (AutoflightProfile.rollout.reverse), and the plan's blocks for them (stall trip 'pusher',
// landing reverse / withReverse, idle taxi).

import { describe, expect, it } from 'vitest';
import { DEG, KT } from '../../src/core/math';
import type { AircraftDefinition } from '../../src/aircraft/types';
import C208_DEFINITION from '../../src/aircraft/c208/index';
import type { PropellerDef } from '../../src/physics/propulsion/defs';
import { CUTOFF_BELOW } from '../../src/physics/propulsion/turbineEngine';
import { Autoflight } from '../../src/sim/autoflight';
import { C172S_SIM } from '../../src/aircraft/c172s/sim';
import { flatEnvironment, makeRig, resetTo } from '../fdm/helpers';
import { flapLever, idleTaxi, landingRoll, runwayRig } from '../fdm/measure';
import { groundRollBlock, idleTaxiBlock, stallBlock } from '../conformance/plan';
import { band, range } from '../conformance/targets';
import { PT6_BETA_PROPELLER } from './testbed';

type ConstantSpeed = Extract<PropellerDef['pitchControl'], { kind: 'constantSpeed' }>;
const BETA = (PT6_BETA_PROPELLER.pitchControl as ConstantSpeed).beta!;
const log = (line: string): void => console.log(`[beta] ${line}`);

/** The C208 with the beta test-bed's range on its propeller (same blade; the test-bed's beta slices replace the C208's own) and a reversing cam (85 % Ng, 95 % Np). */
const C208_BETA: AircraftDefinition = (() => {
  const install = C208_DEFINITION.powerplant.engines[0];
  const pc = install.propeller.pitchControl as ConstantSpeed;
  const propeller: PropellerDef = {
    ...install.propeller,
    pitchControl: { ...pc, beta: BETA, pitchNodes: [...(PT6_BETA_PROPELLER.pitchControl as ConstantSpeed).pitchNodes.filter((n) => n < pc.fineStop), ...pc.pitchNodes.filter((n) => n >= pc.fineStop)] },
  };
  const engine = { ...install.engine, turbine: { ...install.engine.turbine!, reversingCam: { maxReverseNg: 0.85, reverseNp: 0.95 } } };
  return { ...C208_DEFINITION, powerplant: { ...C208_DEFINITION.powerplant, engines: [{ ...install, engine, propeller }] } };
})();

describe('idle taxi (measure.ts idleTaxi)', () => {
  it('on the gate at high idle the aircraft runs away; ground fine holds it near a stop with |static thrust| < 500 N; half beta between', () => {
    const rig = () => makeRig({ def: C208_BETA, loading: 'maxGross', env: flatEnvironment() });
    // On the gate at HIGH idle (the clear runaway: 3.5 kN); the beta positions at low idle. Half beta (1.35 kN at
    // LOW IDLE since the C208's low idle went from 20 to 40 shp) is still accelerating at 150 s (20.1 kt) and settles
    // at about 22.7 kt by 400 s: it gets the longer window.
    const gate = idleTaxi(rig(), { reverse: 0, condition: 1 });
    const fine = idleTaxi(rig(), { reverse: BETA.pitchOnlyTravel, condition: CUTOFF_BELOW });
    const half = idleTaxi(rig(), { reverse: 0.5 * BETA.pitchOnlyTravel, condition: CUTOFF_BELOW, seconds: 400 });
    for (const [name, r] of [['high idle, gate', gate], ['low idle, ground fine', fine], ['low idle, half beta', half]] as const) {
      log(`C208 + beta test-bed, ${name}: static ${r.staticThrustN.toFixed(0)} N, Np ${r.staticNp.toFixed(0)}, Ng ${r.staticNg.toFixed(1)} %, ITT ${r.staticIttC.toFixed(0)} C; unbraked ${r.speedKt.toFixed(1)} kt (Np ${r.np.toFixed(0)}, steady ${r.steady})`);
      for (const x of [r.staticThrustN, r.staticNp, r.staticNg, r.staticIttC, r.speedKt, r.np]) expect(Number.isFinite(x)).toBe(true);
    }
    // High idle on the gate never settles to a taxi speed (3.5 kN: the reason PT6 aircraft taxi in beta).
    expect(gate.steady).toBe(false);
    expect(gate.speedKt).toBeGreaterThan(30);
    expect(fine.steady).toBe(true);
    expect(half.steady).toBe(true);
    expect(gate.staticThrustN).toBeGreaterThan(1000);
    expect(Math.abs(fine.staticThrustN)).toBeLessThan(500);
    expect(gate.speedKt).toBeGreaterThan(half.speedKt);
    expect(half.speedKt).toBeGreaterThan(fine.speedKt - 0.5);
    expect(Math.abs(fine.speedKt)).toBeLessThan(5);
  }, 120_000);
});

describe('landing roll with the power lever aft of the gate (LandingOptions.rollReverse)', () => {
  it('full reverse shortens the roll; a lever left on the gate (0) is the roll without the option, step for step', () => {
    const o = { approachKt: 80, flapLever: flapLever(C208_BETA, 30), touchdownPitch: 4 * DEG };
    const plain = landingRoll(runwayRig(C208_BETA, 'maxGross'), o);
    const gate = landingRoll(runwayRig(C208_BETA, 'maxGross'), { ...o, rollReverse: 0 });
    const fine = landingRoll(runwayRig(C208_BETA, 'maxGross'), { ...o, rollReverse: BETA.pitchOnlyTravel });
    // Out of reverse to ground fine below 40 KIAS (held into the stop with full brakes, this grafted C208 sat back
    // and collapsed a main leg at walking pace: a hand-over in docs/turbine-model.md).
    const full = landingRoll(runwayRig(C208_BETA, 'maxGross'), { ...o, rollReverse: 1, rollReverseCancel: { kias: 40, to: BETA.pitchOnlyTravel } });
    log(`C208 + beta test-bed landing roll, flaps 30, full braking: gate ${plain.roll.toFixed(0)} m, ground fine ${fine.roll.toFixed(0)} m, full reverse to 40 KIAS ${full.roll.toFixed(0)} m`);
    expect(gate.roll).toBe(plain.roll);
    expect(fine.roll).toBeLessThan(plain.roll);
    expect(full.roll).toBeLessThan(fine.roll);
    for (const r of [plain, fine, full]) expect(r.crashed).toBe(false);
  }, 120_000);
});

describe('the scripted pilot\'s roll-out (AutoflightProfile.rollout.reverse)', () => {
  it('takes the lever aft after touchdown, back to the gate below the cancel speed and when stopped; a profile without it never writes the control', () => {
    const rig = makeRig();
    resetTo(rig, { onGround: true });
    const s = rig.fm.state;
    const c = rig.controls;
    const profile = { ...C172S_SIM.autoflight, rollout: { ...C172S_SIM.autoflight.rollout, reverse: { lever: 0.8, cancelKias: 40 } } };
    const af = new Autoflight(profile);
    af.plan = { kind: 'approach', kias: 65 };
    af.phase = 'rollout';
    s.ias = 60 * KT;
    s.groundSpeed = 30;
    af.update(1 / 60, s, c);
    expect(c.reverse).toBe(0.8);
    s.ias = 35 * KT;
    s.groundSpeed = 18;
    af.update(1 / 60, s, c);
    expect(c.reverse).toBe(0);
    s.ias = 60 * KT;
    af.update(1 / 60, s, c);
    s.ias = 0;
    s.groundSpeed = 0.1;
    af.update(1 / 60, s, c);
    expect(af.phase).toBe('stopped');
    expect(c.reverse).toBe(0);

    const plain = makeRig();
    resetTo(plain, { onGround: true });
    const before = plain.controls.reverse;
    const af2 = new Autoflight(C172S_SIM.autoflight);
    af2.plan = { kind: 'approach', kias: 65 };
    af2.phase = 'rollout';
    plain.fm.state.ias = 60 * KT;
    plain.fm.state.groundSpeed = 30;
    af2.update(1 / 60, plain.fm.state, plain.controls);
    expect(plain.controls.reverse).toBe(before);
  });
});

describe('the plan\'s blocks', () => {
  const def = () => C208_BETA;
  const stall = { flapDeg: 0, entryKt: 80, vs1gKcas: band(60, 3, 'test'), warningMarginKt: range(5, 10, 'test') };
  it('a pusher type is judged by its first stick push and the shaker margin above it', () => {
    const labels = stallBlock({ stall: { clean: stall, landing: { ...stall, flapDeg: 30 }, trip: 'pusher' } }, def).items.map((i) => i.label);
    expect(labels).toEqual([
      'stall speed clean (flaps 0), forward CG (first stick push)', 'stick shaker margin above the push clean',
      'stall speed landing flap (flaps 30), forward CG (first stick push)', 'stick shaker margin above the push landing flap',
    ]);
    // Without the trip: the aerodynamic V_S1g, as before.
    expect(stallBlock({ stall: { clean: stall, landing: stall } }, def).items[0].label).toBe('stall speed clean (flaps 0), forward CG (V_S1g)');
  });

  it('a landing with the lever aft of the gate, and a second roll with reverse judged on its band and its ratio', () => {
    const takeoff = { flapDeg: 20, rotateKias: 70, pitchDeg: 8, staticRunUp: true, groundRollM: band(400, 40, 'test') };
    const plainLanding = { flapDeg: 30, approachKt: 80, touchdownPitchDeg: 4, groundRollM: band(300, 30, 'test') };
    expect(groundRollBlock({ takeoff, landing: plainLanding }, def).items.map((i) => i.label)).toEqual([
      'take-off ground roll, flaps 20, rotate 70 KIAS', 'take-off: no crash, climbing', 'landing ground roll, flaps 30, maximum braking', 'landing: no crash',
    ]);
    const landing = { ...plainLanding, reverse: 0.4, withReverse: { reverse: 1, groundRollM: band(250, 30, 'test'), ratio: band(0.72, 0.08, 'test') } };
    expect(groundRollBlock({ takeoff, landing }, def).items.map((i) => i.label)).toEqual([
      'take-off ground roll, flaps 20, rotate 70 KIAS', 'take-off: no crash, climbing',
      'landing ground roll, flaps 30, maximum braking, power lever aft 0.4', 'landing: no crash',
      'landing ground roll, flaps 30, power lever aft 1', 'landing ground roll, power lever aft 1 / the first', 'landing, power lever aft 1: no crash',
    ]);
  });

  it('the idle-taxi block has an item per limit a case gives (flown tier)', () => {
    const block = idleTaxiBlock([
      { label: 'on the gate', reverse: 0, condition: 0.1, idleTaxiKt: range(15, 30, 'test'), idleNp: range(900, 1200, 'test') },
      { label: 'ground fine', reverse: 0.4, condition: 0.1, staticThrustN: range(-500, 500, 'test') },
    ], def);
    expect(block.tier).toBe('flown');
    expect(block.items.map((i) => i.label)).toEqual([
      'idle taxi, on the gate (reverse 0, condition 0.1): Np on the parking brake',
      'idle taxi, on the gate (reverse 0, condition 0.1): steady unbraked ground speed',
      'idle taxi, on the gate (reverse 0, condition 0.1): the speed settled',
      'idle taxi, ground fine (reverse 0.4, condition 0.1): static thrust on the parking brake',
    ]);
  });
});
