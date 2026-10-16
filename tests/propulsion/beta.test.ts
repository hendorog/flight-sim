// The turbine core's beta and reverse, and the PT6 extras of the PC-12 (plan section 4, T1a acceptance 1-9): the
// beta valve and the reversing cam (static reverse thrust, the blade following the lever, Np on the topping
// governor's reverse reset, back to the gate, no NaN anywhere in the blade's travel, the settle solution), the
// latching start switch, the torque limiter with the PC-12's law, the overspeed governor, the propeller selected by
// the condition lever and the scheduled low-pitch stop. Test-beds (testbed.ts): PT6A67_POWERPLANT (a PT6A-67-like
// engine with the PC-12's extras, a four-blade reversing propeller) and BETA_TURBOPROP_POWERPLANT (the C208
// pattern with beta and reverse, hold-to-run starter).
//
// Each test prints its numbers ([beta] lines) so the measured values stand next to their targets in the log.

import { describe, expect, it } from 'vitest';
import { DEG, KT } from '../../src/core/math';
import { setEngineControl } from '../../src/core/types';
import type { PropulsionInput, PropulsionOutput } from '../../src/physics/interfaces';
import { Powerplant } from '../../src/physics/propulsion';
import type { PowerplantDef, PropellerDef } from '../../src/physics/propulsion/defs';
import { Propeller } from '../../src/physics/propulsion/propeller';
import { propellerCharacteristicsFor } from '../../src/physics/propulsion/propellerMap';
import { CUTOFF_BELOW } from '../../src/physics/propulsion/turbineEngine';
import { PC12_TORQUE_LIMITER, pc12TorquePsi } from '../../src/aircraft/pc12/facts';
import { DT, advance, makeInput } from './helpers';
import {
  BETA_TURBOPROP_POWERPLANT, PT6A67_ENGINE, PT6A67_NP, PT6A67_POWERPLANT, PT6A67_PROPELLER, PT6_BETA_PROPELLER,
  TURBOPROP_POWERPLANT,
} from './testbed';

type ConstantSpeed = Extract<PropellerDef['pitchControl'], { kind: 'constantSpeed' }>;
const CS = PT6A67_PROPELLER.pitchControl as ConstantSpeed;
const BETA = CS.beta!;
const CAM = PT6A67_ENGINE.turbine!.reversingCam!;
/** Condition lever at GROUND IDLE (low idle) and at FLIGHT IDLE (high idle). */
const GROUND_IDLE = CUTOFF_BELOW;
const FLIGHT_IDLE = 1;
const log = (line: string): void => console.log(`[beta] ${line}`);

/** Running at low idle on the gate, warm, on the ground (or as `def` says). */
function running(def: PowerplantDef = PT6A67_POWERPLANT): Powerplant {
  const sys = new Powerplant(def);
  sys.reset({ running: true, tanks: [400, 400], rpm: def.engines[0].engine.ratedRpm });
  return sys;
}

/** Steps `sys` for `seconds`, calling `each` after every step. */
function watch(sys: Powerplant, input: PropulsionInput, seconds: number, each: (out: PropulsionOutput, t: number) => void): PropulsionOutput {
  let out!: PropulsionOutput;
  const steps = Math.round(seconds / DT);
  for (let i = 1; i <= steps; i++) each((out = sys.step(input)), i * DT);
  return out;
}

const psiOf = (out: PropulsionOutput): number => pc12TorquePsi(out.engine.torque);
const pitchDeg = (out: PropulsionOutput): number => out.propeller.bladePitch / DEG;

describe('static reverse (acceptance 1)', () => {
  it('blades at -17.5 deg with the cam at its maximum: thrust negative, finite, 40-70 % of the static take-off thrust', () => {
    const sys = running();
    const input = makeInput({ controls: { throttle: 1, mixture: GROUND_IDLE, magnetos: 0 } });
    const takeoff = advance(sys, input, 30);
    const takeoffThrust = takeoff.propeller.thrust;
    log(`static take-off, lever 1 (torque limiter): ${takeoffThrust.toFixed(0)} N, ${psiOf(takeoff).toFixed(2)} psi, Ng ${takeoff.engine.ng!.toFixed(1)} %, Np ${takeoff.engine.propRpm.toFixed(0)}, blade ${pitchDeg(takeoff).toFixed(1)} deg`);
    input.controls.throttle = 0;
    input.controls.reverse = 1;
    const rev = advance(sys, input, 30);
    const turbine = sys.units[0].engine as { ngDemand: number };
    log(`static full reverse: ${rev.propeller.thrust.toFixed(0)} N (${(-rev.propeller.thrust / takeoffThrust * 100).toFixed(1)} % of take-off), ${psiOf(rev).toFixed(2)} psi, Ng ${rev.engine.ng!.toFixed(1)} %, Np ${rev.engine.propRpm.toFixed(0)}, blade ${pitchDeg(rev).toFixed(2)} deg, ITT ${rev.engine.itt!.toFixed(0)} C`);
    expect(pitchDeg(rev)).toBeCloseTo(BETA.reverse / DEG, 6);
    expect(rev.propeller.beta).toBe(true);
    expect(Number.isFinite(rev.propeller.thrust)).toBe(true);
    expect(rev.propeller.thrust).toBeLessThan(0);
    expect(-rev.propeller.thrust / takeoffThrust).toBeGreaterThan(0.4);
    expect(-rev.propeller.thrust / takeoffThrust).toBeLessThan(0.7);
    // The cam asks for more than the propeller takes at the reverse Np: the topping reset, not the cam, sets Ng.
    expect(turbine.ngDemand).toBeLessThan(CAM.maxReverseNg);
    expect(rev.engine.ng! / 100).toBeLessThan(CAM.maxReverseNg);
  }, 60_000);
});

describe('the beta valve (acceptance 2)', () => {
  it('the blade angle follows the lever within 0.5 deg in 1.5 s at full oil, both ways, to every point of the travel', () => {
    const sys = running();
    const input = makeInput({ controls: { throttle: 0, mixture: GROUND_IDLE, magnetos: 0 } });
    advance(sys, input, 10);
    expect(sys.units[0].thermal.oilPressure).toBeGreaterThanOrEqual(25);
    const command = (r: number): number =>
      r <= BETA.pitchOnlyTravel ? CS.fineStop + (BETA.groundFine - CS.fineStop) * (r / BETA.pitchOnlyTravel)
        : BETA.groundFine + (BETA.reverse - BETA.groundFine) * ((r - BETA.pitchOnlyTravel) / (1 - BETA.pitchOnlyTravel));
    const rows: string[] = [];
    for (const r of [1, 0, BETA.pitchOnlyTravel, 0.7, 0.2, 1, 0.5 * BETA.pitchOnlyTravel, 0]) {
      input.controls.reverse = r;
      const out = advance(sys, input, 1.5);
      const error = Math.abs(out.propeller.bladePitch - command(r)) / DEG;
      rows.push(`${r.toFixed(3)} -> ${pitchDeg(out).toFixed(2)} deg (${error.toFixed(3)} off)`);
      expect(error).toBeLessThanOrEqual(0.5);
    }
    log(`lever -> blade after 1.5 s: ${rows.join('; ')}`);
  }, 60_000);

  it('with no oil the valve cannot drive the blades fine: a stopped engine stays feathered whatever the lever', () => {
    const sys = new Powerplant(PT6A67_POWERPLANT);
    sys.reset({ running: false, tanks: [400, 400], feathered: [true] });
    const input = makeInput({ controls: { throttle: 0, mixture: 0, magnetos: 0, reverse: 1 } });
    const out = advance(sys, input, 3);
    expect(out.propeller.bladePitch).toBeCloseTo(CS.feather!.angle, 6);
  });

  it('settle() honours feather and the oil as stepping does: a cold, stopped, feathered engine stays feathered with the lever in full reverse', () => {
    for (const mixture of [0, GROUND_IDLE]) {
      // CUT-OFF/FEATHER (feather selected), then GROUND IDLE with no oil (the springs hold the blades).
      const sys = new Powerplant(PT6A67_POWERPLANT);
      sys.reset({ running: false, tanks: [400, 400], feathered: [true] });
      const input = makeInput({ controls: { throttle: 0, mixture, magnetos: 0, reverse: 1 } });
      const out = sys.settle(input);
      log(`settle, cold and stopped, condition ${mixture === 0 ? 'CUT-OFF' : 'GROUND IDLE'}, reverse 1: blade ${pitchDeg(out).toFixed(1)} deg (feather ${(CS.feather!.angle / DEG).toFixed(1)}), Np ${out.engine.propRpm.toFixed(0)}`);
      expect(out.propeller.bladePitch).toBeCloseTo(CS.feather!.angle, 6);
      expect(out.propeller.feathered).toBe(true);
      expect(out.engine.propRpm).toBe(0);
    }
  }, 30_000);
});

describe('Np in reverse (acceptance 3)', () => {
  it('is held by the fuel topping governor at its reverse reset, 1650 rpm +- 2 %, static, rolling and part reverse', () => {
    const target = CAM.reverseNp * PT6A67_NP;
    const rows: string[] = [];
    for (const [ktas, r] of [[0, 1], [0, 0.75], [40, 1], [80, 1], [80, 0.75]] as const) {
      const sys = running();
      const input = makeInput({ ktas, controls: { throttle: 0, mixture: GROUND_IDLE, magnetos: 0, reverse: r } });
      const out = advance(sys, input, 20);
      rows.push(`${ktas} kt lever ${r}: Np ${out.engine.propRpm.toFixed(0)}, Ng ${out.engine.ng!.toFixed(1)} %, ${out.propeller.thrust.toFixed(0)} N`);
      console.log(rows[rows.length - 1]);
      expect(Math.abs(out.engine.propRpm - target) / target).toBeLessThanOrEqual(0.02);
      // Below the propeller governor's own set speed: it stays in underspeed and leaves the blades to the valve.
      expect(out.engine.propRpm).toBeLessThan(PT6A67_NP);
      expect(out.propeller.bladePitch).toBeLessThan(BETA.groundFine);
    }
    log(`Np in reverse (target ${target.toFixed(0)} +- 2 %): ${rows.join('; ')}`);
  }, 60_000);
});

describe('reverse back to the gate (acceptance 4)', () => {
  it('lever from full reverse to the gate at 0.5 /s: blades back on the stop, then the governor holds Np at full power; Np never above 106 %', () => {
    const sys = running();
    const input = makeInput({ ktas: 40, controls: { throttle: 0, mixture: GROUND_IDLE, magnetos: 0, reverse: 1 } });
    advance(sys, input, 15);
    let peak = 0;
    // The keyboard's reverse rate (plan 3.1): 0.5 of the travel per second.
    watch(sys, input, 2, (out) => {
      const r = (input.controls.reverse ?? 0) - 0.5 * DT;
      input.controls.reverse = r > 1e-9 ? r : 0;
      peak = Math.max(peak, out.engine.propRpm);
    });
    expect(input.controls.reverse).toBe(0);
    const gate = watch(sys, input, 3, (out) => (peak = Math.max(peak, out.engine.propRpm)));
    const onStop = pitchDeg(gate);
    expect(onStop).toBeCloseTo(CS.fineStop / DEG, 6);
    expect(gate.propeller.beta).toBe(false);
    // A go-around from the roll-out: power lever to full over 2 s.
    const full = watch(sys, input, 12, (out, t) => {
      input.controls.throttle = Math.min(1, t / 2);
      peak = Math.max(peak, out.engine.propRpm);
    });
    log(`reverse -> gate -> full power: blade on the stop ${onStop.toFixed(2)} deg; then Np ${full.engine.propRpm.toFixed(0)}, blade ${pitchDeg(full).toFixed(1)} deg, ${psiOf(full).toFixed(1)} psi; peak Np ${peak.toFixed(0)} (limit ${(1.06 * PT6A67_NP).toFixed(0)})`);
    expect(Math.abs(full.engine.propRpm - PT6A67_NP)).toBeLessThan(10);
    expect(full.propeller.bladePitch).toBeGreaterThan(CS.fineStop);
    expect(peak).toBeLessThanOrEqual(1.06 * PT6A67_NP);
  }, 60_000);

  it('even with the lever slammed from full reverse to the gate in one step', () => {
    const sys = running();
    const input = makeInput({ ktas: 40, controls: { throttle: 0, mixture: GROUND_IDLE, magnetos: 0, reverse: 1 } });
    advance(sys, input, 15);
    input.controls.reverse = 0;
    let peak = 0;
    const out = watch(sys, input, 6, (o) => (peak = Math.max(peak, o.engine.propRpm)));
    log(`slam reverse -> gate: peak Np ${peak.toFixed(0)}, blade ${pitchDeg(out).toFixed(2)} deg after 6 s`);
    expect(peak).toBeLessThanOrEqual(1.06 * PT6A67_NP);
    expect(pitchDeg(out)).toBeCloseTo(CS.fineStop / DEG, 6);
  }, 60_000);
});

describe('no NaN in the blade travel (acceptance 5)', () => {
  it('the propeller gives finite loads from -20 to 90 deg at 0-150 kt, turning or stopped, in line and inclined', () => {
    for (const def of [PT6A67_PROPELLER, PT6_BETA_PROPELLER]) {
      const p = new Propeller(propellerCharacteristicsFor(def), 1);
      for (let pitch = -20; pitch <= 90; pitch += 2.5) {
        for (let kt = 0; kt <= 150; kt += 10) {
          for (const rpm of [0, 300, 1000, 1700, 2000]) {
            for (const inclined of [0, 0.2]) {
              const v = kt * KT;
              const l = p.evaluate({ x: -v * Math.cos(inclined), y: 0, z: -v * Math.sin(inclined) }, (rpm * Math.PI) / 30, 1.225, 340, pitch * DEG);
              for (const x of [l.thrust, l.torque, l.inPlaneForce.y, l.inPlaneForce.z, l.hubMoment.y, l.hubMoment.z]) expect(Number.isFinite(x)).toBe(true);
            }
          }
        }
      }
    }
  });

  it('the powerplant stays finite through a lever sweep from full forward to full reverse and back at 0-150 kt', () => {
    for (const kt of [0, 50, 100, 150]) {
      const sys = running();
      const input = makeInput({ ktas: kt, controls: { throttle: 1, mixture: FLIGHT_IDLE, magnetos: 0 } });
      // Lever: full forward -> idle -> full reverse -> gate, 4 s per leg.
      watch(sys, input, 16, (out, t) => {
        const leg = Math.floor(t / 4), f = (t % 4) / 4;
        input.controls.throttle = leg === 0 ? 1 - f : 0;
        input.controls.reverse = leg === 1 ? f : leg === 2 ? 1 - f : leg === 3 ? 0 : 0;
        for (const x of [out.force.x, out.force.y, out.force.z, out.moment.x, out.engine.propRpm, out.engine.ng!, out.propeller.bladePitch]) expect(Number.isFinite(x)).toBe(true);
      });
    }
  }, 60_000);
});

describe('settle in beta (acceptance 6)', () => {
  it('puts the blades at the valve\'s command (reverse 1 -> beta.reverse) and the shaft where the next 3 s keep it', () => {
    for (const def of [PT6A67_POWERPLANT, BETA_TURBOPROP_POWERPLANT]) {
      const beta = (def.engines[0].propeller.pitchControl as ConstantSpeed).beta!;
      for (const [r, angle] of [[1, beta.reverse], [beta.pitchOnlyTravel, beta.groundFine], [1 - 0.5 * (1 - beta.pitchOnlyTravel), 0.5 * (beta.groundFine + beta.reverse)]] as const) {
        const sys = running(def);
        const input = makeInput({ ktas: 50, controls: { throttle: 0, mixture: GROUND_IDLE, magnetos: 0, reverse: r } });
        const settled = sys.settle(input);
        const np = settled.engine.propRpm, thrust = settled.propeller.thrust;
        expect(settled.propeller.bladePitch).toBeCloseTo(angle, 9);
        expect(settled.propeller.beta).toBe(true);
        const after = advance(sys, input, 3);
        log(`${def.engines[0].engine.name}, lever ${r.toFixed(2)}: settle Np ${np.toFixed(1)} -> ${after.engine.propRpm.toFixed(1)} after 3 s, thrust ${thrust.toFixed(0)} -> ${after.propeller.thrust.toFixed(0)} N`);
        expect(Math.abs(after.engine.propRpm - np) / np).toBeLessThan(0.01);
        expect(after.propeller.bladePitch).toBeCloseTo(angle, 6);
      }
    }
  }, 60_000);
});

describe('settle in beta without fuel', () => {
  it('with the fuel off the speed search finds no root and the shaft is stepped from where it was: it runs down (a reversed blade does not windmill at 50 kt)', () => {
    const sys = running(BETA_TURBOPROP_POWERPLANT);
    const input = makeInput({ ktas: 50, controls: { throttle: 0, mixture: GROUND_IDLE, magnetos: 0, reverse: 1, fuelSelector: 'off' } });
    sys.primeForTrim(BETA_TURBOPROP_POWERPLANT.engines[0].engine.ratedRpm);
    const out = sys.settle(input);
    log(`settle, full reverse, fuel off, 50 kt: Np ${out.engine.propRpm.toFixed(0)}, blade ${pitchDeg(out).toFixed(1)} deg, thrust ${out.propeller.thrust.toFixed(0)} N`);
    for (const x of [out.engine.propRpm, out.propeller.thrust, out.propeller.bladePitch]) expect(Number.isFinite(x)).toBe(true);
    expect(out.engine.propRpm).toBeLessThan(50);
    expect(out.propeller.thrust).toBeLessThan(0);
  }, 30_000);
});

describe('the latching start switch (acceptance 7)', () => {
  /** Cold and feathered, condition at CUT-OFF; one press of STARTER, the condition lever to GROUND IDLE at 13 % Ng. */
  function startOnce(o: { interruptAtNg?: number; fuel?: boolean } = {}) {
    const sys = new Powerplant(PT6A67_POWERPLANT);
    sys.reset({ running: false, tanks: [400, 400], feathered: [true] });
    const input = makeInput({ controls: { throttle: 0, mixture: 0, magnetos: 0 } });
    const unit = sys.units[0];
    let cutout = NaN, cutoutNg = NaN, cutoutT = NaN, peakItt = 0, interrupted = false;
    setEngineControl(input.controls, 0, 'starter', true);
    watch(sys, input, 100, (out, t) => {
      // The switch is momentary: released after one step.
      if (t > DT) setEngineControl(input.controls, 0, 'starter', false);
      const ng = out.engine.ng!;
      if ((o.fuel ?? true) && input.controls.mixture < CUTOFF_BELOW && ng >= 13) input.controls.mixture = GROUND_IDLE;
      if (o.interruptAtNg !== undefined && !interrupted && ng >= o.interruptAtNg) {
        interrupted = true;
        setEngineControl(input.controls, 0, 'starter', true);
      }
      peakItt = Math.max(peakItt, out.engine.itt!);
      if (Number.isNaN(cutout) && !unit.starterEngaged && t > 2 * DT) {
        cutout = t;
        cutoutNg = ng;
        cutoutT = t;
      }
    });
    return { sys, cutout, cutoutNg, cutoutT, peakItt, unit };
  }

  it('one press: the starter runs on alone and cuts out at 50 +- 1 % Ng; the engine reaches ground idle', () => {
    const s = startOnce();
    const e = s.sys.units[0].state;
    log(`one press: starter cut out at ${s.cutoutNg.toFixed(2)} % Ng after ${s.cutoutT.toFixed(1)} s; peak ITT ${s.peakItt.toFixed(0)} C; idle Ng ${e.ng!.toFixed(1)} %, Np ${e.propRpm.toFixed(0)}`);
    expect(Math.abs(s.cutoutNg - 100 * PT6A67_ENGINE.starterLatch!.cutoutNg)).toBeLessThanOrEqual(1);
    expect(e.running).toBe(true);
    expect(e.ng! / 100).toBeCloseTo(PT6A67_ENGINE.turbine!.gasGenerator.fcu.lowIdleNg, 2);
    expect(s.sys.units[0].feathered).toBe(false);
  }, 60_000);

  it('a second press (the interrupt) disengages it: the start hangs below the self-sustaining speed', () => {
    const s = startOnce({ interruptAtNg: 20 });
    log(`interrupted at 20 % Ng: starter out at ${s.cutoutNg.toFixed(2)} %, Ng ${s.sys.units[0].state.ng!.toFixed(1)} % after 100 s`);
    expect(s.cutoutNg).toBeLessThan(21);
    expect(s.sys.units[0].state.running).toBe(false);
  }, 60_000);

  it('without fuel (a dry motoring run) the starter times out after cutoutSeconds', () => {
    const s = startOnce({ fuel: false });
    log(`dry motoring: starter out after ${s.cutoutT.toFixed(2)} s at ${s.cutoutNg.toFixed(1)} % Ng (cutoutSeconds ${PT6A67_ENGINE.starterLatch!.cutoutSeconds})`);
    expect(s.cutoutT).toBeCloseTo(PT6A67_ENGINE.starterLatch!.cutoutSeconds, 1);
    expect(s.cutoutNg).toBeLessThan(50);
  }, 60_000);

  it('a type without the latch stays hold-to-run: the starter stops when the switch is let go', () => {
    const sys = new Powerplant(TURBOPROP_POWERPLANT);
    sys.reset({ running: false, tanks: [400, 400], feathered: [true] });
    const input = makeInput({ controls: { throttle: 0, mixture: 0, magnetos: 0 } });
    setEngineControl(input.controls, 0, 'starter', true);
    const held = advance(sys, input, 5).engine.ng!;
    setEngineControl(input.controls, 0, 'starter', false);
    const let_go = advance(sys, input, 10).engine.ng!;
    expect(held).toBeGreaterThan(10);
    expect(let_go).toBeLessThan(held - 5);
    // A latching unit pressed once and held 5 s behaves alike while held.
    const latch = new Powerplant(PT6A67_POWERPLANT);
    latch.reset({ running: false, tanks: [400, 400], feathered: [true] });
    setEngineControl(input.controls, 0, 'starter', true);
    expect(advance(latch, input, 5).engine.ng!).toBeGreaterThan(10);
    expect(latch.units[0].starterEngaged).toBe(true);
  }, 60_000);

  it('EngineState.starter publishes the latch (on after the switch is let go, off at the cut-out); absent on a hold-to-run type', () => {
    const sys = new Powerplant(PT6A67_POWERPLANT);
    sys.reset({ running: false, tanks: [400, 400], feathered: [true] });
    expect(sys.units[0].state.starter).toBe(false);
    const input = makeInput({ controls: { throttle: 0, mixture: 0, magnetos: 0 } });
    setEngineControl(input.controls, 0, 'starter', true);
    expect(sys.step(input).engine.starter).toBe(true);
    setEngineControl(input.controls, 0, 'starter', false);
    let offNg = NaN;
    watch(sys, input, 60, (out) => {
      if (input.controls.mixture < CUTOFF_BELOW && out.engine.ng! >= 13) input.controls.mixture = GROUND_IDLE;
      if (Number.isNaN(offNg) && !out.engine.starter) offNg = out.engine.ng!;
      if (out.engine.ng! < 45) expect(out.engine.starter).toBe(true);
    });
    log(`EngineState.starter: on with the switch released, off at ${offNg.toFixed(2)} % Ng`);
    expect(Math.abs(offNg - 100 * PT6A67_ENGINE.starterLatch!.cutoutNg)).toBeLessThanOrEqual(1);
    const plain = new Powerplant(TURBOPROP_POWERPLANT);
    plain.reset({ running: false, tanks: [400, 400], feathered: [true] });
    expect('starter' in plain.step(input).engine).toBe(false);
  }, 60_000);

  it('a start resumed mid-way runs on: capture() and restore() carry the latch, its timer and the switch', () => {
    /** One press, then capture when `when` says; restored into a fresh unit reset as a resume resets it; on to 100 s. */
    function resumed(fuel: boolean, when: (ng: number, t: number) => boolean) {
      const a = new Powerplant(PT6A67_POWERPLANT);
      a.reset({ running: false, tanks: [400, 400], feathered: [true] });
      const input = makeInput({ controls: { throttle: 0, mixture: 0, magnetos: 0 } });
      setEngineControl(input.controls, 0, 'starter', true);
      let t = 0, ng = 0;
      for (; t < 100 && !(t > DT && when(ng, t)); t += DT) {
        ng = a.step(input).engine.ng!;
        if (t >= DT) setEngineControl(input.controls, 0, 'starter', false);
        if (fuel && input.controls.mixture < CUTOFF_BELOW && ng >= 13) input.controls.mixture = GROUND_IDLE;
      }
      const snap = a.capture();
      const b = new Powerplant(PT6A67_POWERPLANT);
      b.reset({ running: false, tanks: [400, 400], feathered: [true] });
      b.restore(snap);
      expect(b.units[0].state.starter).toBe(true);
      const capturedAt = { ng, t };
      let cutoutNg = NaN, cutoutT = NaN;
      watch(b, input, 100, (out, s) => {
        if (fuel && input.controls.mixture < CUTOFF_BELOW && out.engine.ng! >= 13) input.controls.mixture = GROUND_IDLE;
        if (Number.isNaN(cutoutNg) && !out.engine.starter) {
          cutoutNg = out.engine.ng!;
          cutoutT = capturedAt.t + s;
        }
      });
      return { capturedAt, cutoutNg, cutoutT, end: b.units[0].state };
    }
    const start = resumed(true, (ng) => ng >= 20);
    log(`resumed at ${start.capturedAt.ng.toFixed(1)} % Ng: starter out at ${start.cutoutNg.toFixed(2)} % Ng; idle Ng ${start.end.ng!.toFixed(1)} %, running ${start.end.running}`);
    expect(Math.abs(start.cutoutNg - 100 * PT6A67_ENGINE.starterLatch!.cutoutNg)).toBeLessThanOrEqual(1);
    expect(start.end.running).toBe(true);
    expect(start.end.ng! / 100).toBeCloseTo(PT6A67_ENGINE.turbine!.gasGenerator.fcu.lowIdleNg, 2);
    // Dry motoring captured at 10 s: the timer came across, so it still times out at cutoutSeconds from the press.
    const dry = resumed(false, (_ng, t) => t >= 10);
    log(`dry motoring resumed at ${dry.capturedAt.t.toFixed(2)} s: starter out at ${dry.cutoutT.toFixed(2)} s (cutoutSeconds ${PT6A67_ENGINE.starterLatch!.cutoutSeconds})`);
    expect(dry.cutoutT).toBeCloseTo(PT6A67_ENGINE.starterLatch!.cutoutSeconds, 1);
  }, 60_000);
});

describe('the torque limiter (acceptance 8)', () => {
  const limitAt = (ft: number, ng: number): number => {
    const l = PC12_TORQUE_LIMITER;
    let i = 0;
    while (i < l.lapse.altFt.length - 2 && ft > l.lapse.altFt[i + 1]) i++;
    const f = (ft - l.lapse.altFt[i]) / (l.lapse.altFt[i + 1] - l.lapse.altFt[i]);
    const lapse = l.lapse.psi[i] + f * (l.lapse.psi[i + 1] - l.lapse.psi[i]);
    return lapse - l.taperPsi * Math.min(1, Math.max(0, (ng - l.ngTaper[0]) / (l.ngTaper[1] - l.ngTaper[0])));
  };

  it('power lever full: the limit psi at sea level, the lapse table at 10 000 and 20 000 ft (+- 0.5 psi); Ng never above 104 %', () => {
    const rows: string[] = [];
    for (const [ft, kias] of [[0, 0], [10_000, 150], [20_000, 150]] as const) {
      const sys = running();
      // 150 KIAS as TAS at the ISA altitude (incompressible sigma: 174 / 205 kt; close enough for a ram source).
      const sigma = Math.pow(1 - 6.8756e-6 * ft, 4.2559);
      const input = makeInput({ altitudeFt: ft, ktas: kias / Math.sqrt(sigma), controls: { throttle: 0, mixture: FLIGHT_IDLE, magnetos: 0 } });
      advance(sys, input, 5);
      let peakNg = 0;
      // Power lever slammed full: the worst case for an overshoot.
      input.controls.throttle = 1;
      const out = watch(sys, input, 30, (o) => (peakNg = Math.max(peakNg, o.engine.ng!)));
      const psi = psiOf(out), ng = out.engine.ng! / 100, limit = limitAt(ft, ng);
      rows.push(`${ft} ft ${kias} KIAS: ${psi.toFixed(2)} psi (limit ${limit.toFixed(2)}), Ng ${(100 * ng).toFixed(1)} % (peak ${peakNg.toFixed(1)}), ITT ${out.engine.itt!.toFixed(0)} C, Np ${out.engine.propRpm.toFixed(0)}`);
      expect(Math.abs(psi - limit)).toBeLessThanOrEqual(0.5);
      expect(peakNg).toBeLessThanOrEqual(104 + 1e-9);
      // The settled solution agrees with the time loop.
      const settled = sys.settle(input);
      expect(Math.abs(psiOf(settled) - limit)).toBeLessThanOrEqual(0.5);
    }
    log(`torque limiter, power lever full: ${rows.join('; ')}`);
  }, 60_000);

  it('a part lever below the limit is the pilot\'s: the limiter does nothing there', () => {
    const sys = running();
    const input = makeInput({ ktas: 150, controls: { throttle: 0.6, mixture: FLIGHT_IDLE, magnetos: 0 } });
    const out = advance(sys, input, 20);
    const turbine = sys.units[0].engine as { torqueLimited: boolean };
    expect(psiOf(out)).toBeLessThan(PC12_TORQUE_LIMITER.psi - 2);
    expect(turbine.torqueLimited).toBe(false);
  }, 30_000);

  it('high and hot, where Ng reaches the taper, the limit falls by up to taperPsi and Ng stops at 104 %', () => {
    const sys = running();
    const input = makeInput({ altitudeFt: 28_000, ktas: 250, controls: { throttle: 1, mixture: FLIGHT_IDLE, magnetos: 0 } });
    input.atmosphere = { ...input.atmosphere, temperature: input.atmosphere.temperature + 25 };
    let peakNg = 0;
    const out = watch(sys, input, 30, (o) => (peakNg = Math.max(peakNg, o.engine.ng!)));
    const ng = out.engine.ng! / 100;
    log(`28 000 ft ISA+25, lever full: ${psiOf(out).toFixed(2)} psi (limit at this Ng ${limitAt(28_000, ng).toFixed(2)}), Ng ${(100 * ng).toFixed(2)} % (peak ${peakNg.toFixed(2)})`);
    expect(peakNg).toBeLessThanOrEqual(104 + 1e-9);
    expect(psiOf(out)).toBeLessThanOrEqual(limitAt(28_000, ng) + 0.5);
  }, 30_000);
});

describe('the overspeed governor (acceptance 9)', () => {
  /** The PT6A-67-like unit with a failed primary governor (set far above the overspeed governor: it only drives fine). */
  function failedGovernor(overspeed: boolean): PowerplantDef {
    const governor = { ...CS.governor, minRpm: 2600, maxRpm: 2600, overspeedRpm: overspeed ? CS.governor.overspeedRpm : undefined };
    const propeller: PropellerDef = { ...PT6A67_PROPELLER, pitchControl: { ...CS, governor } };
    return { ...PT6A67_POWERPLANT, engines: [{ ...PT6A67_POWERPLANT.engines[0], propeller }] };
  }

  it('holds Np within 2 % of 1802 rpm in a full-power dive with the primary governor failed; without it the topping governor (1853) is all there is', () => {
    const peaks: number[] = [];
    for (const fitted of [true, false]) {
      const sys = running(failedGovernor(fitted));
      const input = makeInput({ altitudeFt: 5000, ktas: 120, controls: { throttle: 1, mixture: FLIGHT_IDLE, magnetos: 0 } });
      let peak = 0;
      // Full power, accelerating from 120 to 260 kt over 20 s, then held.
      watch(sys, input, 40, (out, t) => {
        input.airVelocityBody.x = -Math.min(260, 120 + 7 * t) * KT;
        peak = Math.max(peak, out.engine.propRpm);
      });
      peaks.push(peak);
    }
    const os = CS.governor.overspeedRpm!;
    log(`failed primary governor, full-power dive to 260 kt: peak Np ${peaks[0].toFixed(0)} with the overspeed governor (limit ${(1.02 * os).toFixed(0)}), ${peaks[1].toFixed(0)} without`);
    expect(peaks[0]).toBeLessThanOrEqual(1.02 * os);
    expect(peaks[1]).toBeGreaterThan(1.02 * os);
  }, 60_000);
});

describe('the propeller of a condition lever (PC-12)', () => {
  it('governs at its one speed whatever ControlInputs.propeller says, and feathers only with the condition lever at CUT-OFF', () => {
    const sys = running();
    const input = makeInput({ ktas: 150, controls: { throttle: 0.7, mixture: FLIGHT_IDLE, magnetos: 0, propeller: 0 } });
    const out = advance(sys, input, 15);
    expect(out.engine.propRpm).toBeCloseTo(PT6A67_NP, -1);
    expect(sys.units[0].feathered).toBe(false);
    input.controls.mixture = 0;
    advance(sys, input, 15);
    expect(sys.units[0].feathered).toBe(true);
    expect(sys.units[0].featherCommanded).toBe(true);
  }, 30_000);
});

describe('the scheduled low-pitch stop', () => {
  it('rises with the power lever (lowPitchSchedule), slews the blades up to it, and settle() starts its search there', () => {
    const schedule = { lever: [0, 1], angle: [CS.fineStop, CS.fineStop + 8 * DEG] };
    const propeller: PropellerDef = { ...PT6A67_PROPELLER, pitchControl: { ...CS, beta: { ...BETA, lowPitchSchedule: schedule } } };
    const def: PowerplantDef = { ...PT6A67_POWERPLANT, engines: [{ ...PT6A67_POWERPLANT.engines[0], propeller }] };
    const sys = running(def);
    // A descent at a part lever: too little power for the governor, so the blades sit on the (scheduled) stop.
    const input = makeInput({ ktas: 90, altitudeFt: 3000, controls: { throttle: 0.5, mixture: FLIGHT_IDLE, magnetos: 0 } });
    const settled = sys.settle(input);
    log(`scheduled stop at lever 0.5: ${(CS.fineStop / DEG + 4).toFixed(1)} deg; settle -> blade ${pitchDeg(settled).toFixed(2)} deg, Np ${settled.engine.propRpm.toFixed(0)}`);
    expect(settled.propeller.bladePitch).toBeGreaterThanOrEqual(CS.fineStop + 4 * DEG - 1e-9);
    const stepped = advance(sys, input, 5);
    expect(stepped.propeller.bladePitch).toBeGreaterThanOrEqual(CS.fineStop + 4 * DEG - 1e-9);
    // The lever to idle: the stop drops back to fineStop and the governor may take the blades down to it.
    input.controls.throttle = 0;
    expect(advance(sys, input, 5).propeller.bladePitch).toBeLessThan(CS.fineStop + 4 * DEG);
  }, 30_000);
});

describe('state and resume', () => {
  it('PropellerState.beta exists only on a hub with beta; capture() and restore() carry a reversed blade over', () => {
    const plain = new Powerplant(TURBOPROP_POWERPLANT);
    plain.reset({ running: true, tanks: [400, 400], rpm: 33_000 });
    expect('beta' in plain.step(makeInput({ controls: { throttle: 0, mixture: GROUND_IDLE, reverse: 1 } })).propeller).toBe(false);
    const a = running();
    const input = makeInput({ ktas: 60, controls: { throttle: 0, mixture: GROUND_IDLE, magnetos: 0, reverse: 1 } });
    advance(a, input, 10);
    const snap = a.capture();
    expect(snap[0].bladePitch).toBeCloseTo(BETA.reverse, 9);
    const b = new Powerplant(PT6A67_POWERPLANT);
    b.reset({ running: true, tanks: [400, 400], rpm: 0 });
    b.restore(snap);
    expect(b.units[0].bladePitch).toBeCloseTo(BETA.reverse, 9);
    const ea = a.step(input), pa = ea.engine.propRpm, ta = ea.propeller.thrust;
    const eb = b.step(input);
    expect(eb.engine.propRpm).toBeCloseTo(pa, 6);
    expect(eb.propeller.thrust).toBeCloseTo(ta, 3);
  }, 30_000);
});
