// Twin turboshaft governors, warning unit, reset and resume (TW, plan revision 2 section 5: T5, T6, T9, T10, T11,
// T16). Each row flies the twin rig (twinRig.ts) with ordinary controls (levers, collective, ENGINE TRIM) and reads the
// gauges; T9 drives the warning unit through its thresholds directly. P = TCDS / TM, P5 = CB-5 FM; ESTIMATE = no
// source. TWIN_TRACE=<dir> writes the report.
import { afterAll, describe, expect, it } from 'vitest';
import { defaultControls } from '../../src/core/types';
import { Rotorcraft } from '../../src/physics/rotorcraft/rotorcraft';
import { publishTwin } from '../../src/physics/rotorcraft/twinTurboshaft';
import { TurbineEngine } from '../../src/physics/propulsion/turbineEngine';
import type { EngineUnit } from '../../src/physics/propulsion/engineUnit';
import type { AircraftDefinition } from '../../src/aircraft/types';
import { BO105_WARNINGS } from '../../src/aircraft/bo105/facts';
import { hoverScenario } from '../../src/sim/rotorcraft/starts';
import { SimPhysics } from '../../src/sim/SimPhysics';
import { parseSnapshot } from '../../src/sim/resume';
import { calmWeather } from '../fdm/helpers';
import { HelicopterAutopilot } from '../../src/sim/rotorcraft/autopilot';
import { defaultAutopilotSettings } from '../../src/physics/autopilot';
import { KT } from '../../src/core/math';
import { DT, TWIN_DEF, d, gauges, lever, LEVER, rig, run, ts, twin, writeTrace } from './twinRig';

const report: Record<string, unknown> = {};
afterAll(() => writeTrace('twinGovernor', report));
const split = (r: ReturnType<typeof rig>) => { const g = gauges(r); return g.tq[1] - g.tq[0]; };

describe('load sharing and ENGINE TRIM (T5, T6)', () => {
  it('T5 matched rigging: hover torque split <= 1 %; with the rig mismatch after a run-up (split unsynchronised): 4 +/- 2 % (AGENT / ESTIMATE)', () => {
    const matched: AircraftDefinition = { ...TWIN_DEF, rotorcraft: { ...d, systems: { ...d.systems, twinTurboshaft: { ...twin, rigMismatch: 0 } } } };
    const a = rig({ kg: 2200, def: matched });
    a.fm.state.rotorcraft!.twinTurboshaft!.splitPct = 0;
    run(a, 15);
    const b = rig({ kg: 2200 });
    b.fm.state.rotorcraft!.twinTurboshaft!.splitPct = 0;
    run(b, 15);
    report.T5 = { matched: { tq: gauges(a).tq, split: split(a) }, mismatch: { tq: gauges(b).tq, split: split(b) } };
    expect(Math.abs(split(a))).toBeLessThanOrEqual(1);
    expect(split(b)).toBeGreaterThanOrEqual(2); expect(split(b)).toBeLessThanOrEqual(6);
  }, 30_000);

  it('T5 ENGINE TRIM left held: the split crosses zero at 1.5-3 % torque/s; let go there, synchronised within 1 % (ESTIMATE)', () => {
    const r = rig({ kg: 2200 });
    r.fm.state.rotorcraft!.twinTurboshaft!.splitPct = 0;
    run(r, 15);
    const start = split(r);
    r.c.n2BeepSplit = -1;
    let crossed = -1, before = start, t = 0;
    const history: [number, number][] = [];
    run(r, 10, (time) => {
      const s = split(r);
      history.push([time, s]);
      if (crossed < 0 && before > 0 && s <= 0) { crossed = time; r.c.n2BeepSplit = 0; }
      before = s; t = time;
    });
    void t;
    const at = (time: number) => history.reduce((best, h) => (Math.abs(h[0] - time) < Math.abs(best[0] - time) ? h : best))[1];
    const slope = (at(crossed - 0.5) - at(crossed)) / 0.5;
    run(r, 10);
    const settled = split(r);
    report.T5trim = { start, crossedS: crossed, slopePctPerS: slope, settled, splitPct: gauges(r).splitPct };
    expect(crossed).toBeGreaterThan(0);
    expect(slope).toBeGreaterThanOrEqual(1.5); expect(slope).toBeLessThanOrEqual(3);
    expect(Math.abs(settled)).toBeLessThanOrEqual(1);
  }, 30_000);

  it('T6 ENGINE TRIM fore/aft: both N2 move together, 98-102 % at about 1 %/s (ESTIMATE; FM normal band P5); at the 2200 kg hover N2 within 0.2 % of the set point at both stops (the twin compensator rigging)', () => {
    const r = rig({ kg: 2200 });
    run(r, 2);
    const set0 = gauges(r).set[0];
    r.c.n2Beep = 1;
    run(r, 1);
    const rate = gauges(r).set[0] - set0;
    run(r, 6);
    run(r, 0); r.c.n2Beep = 0;
    run(r, 8);
    const high = gauges(r);
    r.c.n2Beep = -1;
    run(r, 8);
    r.c.n2Beep = 0;
    run(r, 8);
    const low = gauges(r);
    report.T6 = { ratePctPerS: rate, high: { set: high.set, n2: high.n2, nr: high.nr }, low: { set: low.set, n2: low.n2, nr: low.nr } };
    expect(rate).toBeGreaterThanOrEqual(0.8); expect(rate).toBeLessThanOrEqual(1.2);
    expect(high.set).toEqual([102, 102]); expect(low.set).toEqual([98, 98]);
    for (const g of [high, low]) expect(Math.abs(g.n2[0] - g.n2[1])).toBeLessThan(0.05);
    for (const g of [high, low]) for (const k of [0, 1]) expect(Math.abs(g.n2[k] - g.set[k])).toBeLessThanOrEqual(0.2);
    expect(high.nr).toBeGreaterThanOrEqual(101); expect(high.nr).toBeLessThanOrEqual(103);
    expect(low.nr).toBeGreaterThanOrEqual(97); expect(low.nr).toBeLessThanOrEqual(99);
  }, 30_000);
});

describe('warning unit K-DW02/01 (T9, P TM 00-44 / P5 FM 3-16)', () => {
  /** A gas producer at N1 `n1` (fraction): the unit reads only the turbine's N1, TOT and flame. */
  const turbine = (n1: number) => Object.create(TurbineEngine.prototype, { ng: { value: n1 }, ittC: { value: 600 }, firing: { value: n1 > 0.5 } }) as TurbineEngine;
  const unit = (n1: number, n2Omega: number) => ({ omega: n2Omega, inertia: 0.11, gearRatio: 1, engine: turbine(n1),
    install: { engine: { ratedRpm: 6016 } }, state: { rpm: 0, torque: 100 } }) as unknown as EngineUnit;
  const at = (nrPct: number, n1: [number, number], volts = 28, onGround = false) => {
    const rotor = new Rotorcraft(d);
    rotor.reset(true);
    rotor.state.rotorRpm = nrPct / 100 * d.referenceRpm;
    rotor.state.omega = rotor.state.rotorRpm * Math.PI / 30;
    const n2 = rotor.state.omega * d.engineRatio;
    publishTwin(rotor.turboshaft!, rotor.state, DT, defaultControls(TWIN_DEF), [unit(n1[0], n2), unit(n1[1], n2)], volts, onGround);
    return { tw: rotor.state.twinTurboshaft!, s: rotor.state };
  };

  it('N1 split >= 12 % -> light (and beeping); 11.9 % -> none', () => {
    const on = at(100, [0.9, 0.78]), off = at(100, [0.9, 0.781]);
    expect(on.tw.n1SplitLight).toBe(true); expect(on.s.lowRpmLight).toBe(true);
    expect(off.tw.n1SplitLight).toBe(false); expect(off.s.lowRpmLight).toBe(false);
  });

  it('NR <= 95 % -> light + 650 Hz tone (nrLowTone, lowRpmHorn), on the ground down to the 75 % floor, in flight at any NR; NR >= 103 % -> light; >= 108 % -> 2600 Hz tone', () => {
    const cases: [number, boolean][] = [[94.99, false], [95, false], [95.01, false], [75, true], [74.99, true], [60, true], [60, false],
      [74.99, false], [102.99, false], [103, false], [107.99, false], [108, false]];
    const rows = cases.map(([nr, onGround]) => {
      const { tw, s } = at(nr, [0.9, 0.9], 28, onGround);
      return { nr, onGround, low: tw.nrLowLight, tone: tw.nrLowTone, horn: s.lowRpmHorn, high: tw.nrHighLight, highTone: tw.nrHighTone, light: s.lowRpmLight };
    });
    report.T9 = rows;
    const row = (nr: number, onGround = false) => rows.find((x) => x.nr === nr && x.onGround === onGround)!;
    for (const [nr, g] of [[94.99, false], [95, false], [75, true], [74.99, false], [60, false]] as const) {
      expect(row(nr, g), `${nr} % ${g ? 'on the ground' : 'airborne'}`).toMatchObject({ low: true, tone: true, horn: true, light: true });
    }
    for (const [nr, g] of [[95.01, false], [74.99, true], [60, true], [102.99, false]] as const) {
      expect(row(nr, g), `${nr} % ${g ? 'on the ground' : 'airborne'}`).toMatchObject({ low: false, tone: false, light: false, high: false });
    }
    expect(row(103)).toMatchObject({ high: true, highTone: false, light: true, tone: false });
    expect(row(107.99).highTone).toBe(false);
    expect(row(108)).toMatchObject({ high: true, highTone: true, light: true });
    expect(BO105_WARNINGS.nrLowPct).toBe(95); expect(BO105_WARNINGS.nrHighPct).toBe(103); expect(BO105_WARNINGS.nrHighTonePct).toBe(108);
  });

  it('the unit needs the bus: no light or tone at 18 V or less', () => {
    const { tw, s } = at(90, [0.9, 0.6], 18);
    expect([tw.n1SplitLight, tw.nrLowLight, tw.nrLowTone, s.lowRpmLight, s.lowRpmHorn]).toEqual([false, false, false, false, false]);
    expect(s.lowRpm).toBe(true);
  });
});

describe('autopilot hold on one engine (T13)', () => {
  it('T13 the helicopter hold engages and flies with engine 1 shut down and engine 2 running (and refuses with both out)', () => {
    const r = rig({ kg: 2200, kt: 60, enginesRunning: [false, true] });
    const ap = new HelicopterAutopilot(d);
    const st = { ...defaultAutopilotSettings(), altitude: r.fm.state.altitudeMSL, heading: r.fm.state.heading, airspeed: 60 * KT };
    expect(r.fm.state.engine.running).toBe(false);
    expect(ap.engage(r.fm.state, r.c), ap.reason).toBe(true);
    let held = true;
    run(r, 10, () => { held = held && ap.update(DT, r.fm.state, r.c, st); });
    report.T13 = { engaged: true, heldFor10s: held, altitudeErrorM: r.fm.state.altitudeMSL - st.altitude, reason: ap.reason };
    expect(held, ap.reason).toBe(true);
    const out = rig({ kg: 2200, kt: 60, enginesRunning: [false, false], running: false });
    expect(new HelicopterAutopilot(d).engage(out.fm.state, out.c)).toBe(false);
  }, 30_000);
});

describe('reset, resume and one lever at IDLE (T10, T11, T16)', () => {
  for (const kt of [0, 60, 120]) {
    it(`T10 airborne reset at ${kt} KIAS: torques equal +/- 1 %, N2 steady, no Nr or N2 transient > 0.3 % over 2 s${kt === 0 ? '; the N2 set point reads 100 +/- 0.2 % (the compensator rigging point)' : ''}`, () => {
      const r = rig({ kg: 2200, kt });
      const g0 = gauges(r);
      let worst = 0;
      run(r, 2, () => { const g = gauges(r); worst = Math.max(worst, Math.abs(g.nr - g0.nr), Math.abs(g.n2[0] - g0.n2[0]), Math.abs(g.n2[1] - g0.n2[1])); });
      const g = gauges(r);
      (report.T10 ??= {} as Record<string, unknown>) as Record<string, unknown>;
      (report.T10 as Record<string, unknown>)[kt] = { tq: g0.tq, n1: g0.n1, n2: g0.n2, set: g0.set, nr: g0.nr, collective: g0.collective, worstStepPct: worst, after: { tq: g.tq, n2: g.n2 } };
      if (kt === 0) expect(Math.abs(g0.set[0] - 100)).toBeLessThanOrEqual(0.2);
      expect(Math.abs(g0.tq[0] - g0.tq[1])).toBeLessThanOrEqual(1);
      expect(Math.abs(g.tq[0] - g.tq[1])).toBeLessThanOrEqual(1);
      expect(worst).toBeLessThanOrEqual(0.3);
      expect(g0.split).toEqual([false, false]);
    }, 30_000);
  }

  it('T10 enginesRunning [true, false]: engine 2 cut (lever OFF, N1 wound down, needles split), engine 1 carries the trim, OEI', () => {
    const r = rig({ kg: 2200, kt: 60, enginesRunning: [true, false] });
    const g0 = gauges(r);
    let worst = 0;
    run(r, 2, () => { const g = gauges(r); worst = Math.max(worst, Math.abs(g.nr - g0.nr)); });
    const g = gauges(r);
    report.T10oei = { tq: g.tq, n1: g.n1, n2: g.n2, split: g.split, oei: g.oei, lever: r.c.engines[1], worstNrPct: worst };
    expect(r.c.engines[1].throttle).toBe(0);
    expect(g0.n1[1]).toBe(0); expect(g.split).toEqual([false, true]);
    expect(g0.oei).toBe(true); expect(g.oei).toBe(true);
    expect(g.tq[0]).toBeGreaterThan(60); expect(Math.abs(g.tq[1])).toBeLessThan(1);
    expect(worst).toBeLessThanOrEqual(0.3);
  }, 30_000);

  it('T10 enginesRunning [false, true]: engine 1 cut, engine 2 carries the trim, no transient > 0.3 % over 2 s', () => {
    const r = rig({ kg: 2200, kt: 60, enginesRunning: [false, true] });
    const g0 = gauges(r);
    let worst = 0;
    run(r, 2, () => { const g = gauges(r); worst = Math.max(worst, Math.abs(g.nr - g0.nr), Math.abs(g.n2[1] - g0.n2[1])); });
    const g = gauges(r);
    report.T10engine1out = { tq: g.tq, n1: g.n1, split: g.split, oei: g.oei, lever: r.c.engines[0], worstPct: worst };
    expect(r.c.engines[0].throttle).toBe(0);
    expect(g.split).toEqual([true, false]); expect(g.oei).toBe(true);
    expect(g.tq[1]).toBeGreaterThan(60); expect(Math.abs(g.tq[0])).toBeLessThan(1);
    expect(worst).toBeLessThanOrEqual(0.3);
  }, 30_000);

  it('T11 resume: a snapshot mid-OEI through JSON restores with no Nr or N1 step > 0.2 %', () => {
    const w = calmWeather();
    const a = new SimPhysics({ aircraft: TWIN_DEF, weather: w });
    a.resetTo({ ...hoverScenario(a.env, d), payload: 'typical' });
    a.step(2);
    lever(a.controls, 1, LEVER.off);
    a.step(1.5);
    const snap = a.captureSnapshot({ weather: w, cameraMode: 'chase', quality: 'high', renderScale: null, resume: true, now: 1_800_000_000_000 });
    expect(snap.systems.rotorcraft?.twinTurboshaft).toBeDefined();
    snap.controls.n2BeepSplit = 1;
    const back = parseSnapshot(JSON.stringify(snap));
    expect(back).not.toBeNull();
    expect(back!.controls.n2BeepSplit).toBe(0);
    const b = new SimPhysics({ aircraft: TWIN_DEF, weather: { ...back!.weather } });
    b.restore(back!);
    // Nr is restored as saved; the gauges' N1 is republished by the first step.
    const nrStep = 100 * Math.abs(b.state.rotorcraft!.rotorRpm / a.state.rotorcraft!.rotorRpm - 1);
    let worst = 0;
    for (let i = 0; i < 10; i++) {
      a.step(0.05); b.step(0.05);
      worst = Math.max(worst, 100 * Math.abs(b.state.rotorcraft!.rotorRpm / a.state.rotorcraft!.rotorRpm - 1),
        ...[0, 1].map((k) => Math.abs((b.state.engines[k].ng ?? 0) - (a.state.engines[k].ng ?? 0))));
    }
    report.T11 = { nrStepAtRestorePct: nrStep, worstPctOver05s: worst, oei: b.state.rotorcraft!.twinTurboshaft!.oei };
    expect(nrStep).toBeLessThanOrEqual(0.2);
    expect(worst).toBeLessThanOrEqual(0.2);
  }, 30_000);

  it('T16 one lever at IDLE in flight (OEI training): that engine reads needles split and torque 0; the other carries the load', () => {
    const r = rig({ kg: 2200, kt: 60 });
    const total = gauges(r).tq[0] + gauges(r).tq[1];
    lever(r.c, 0, LEVER.idle);
    run(r, 15);
    const g = gauges(r);
    report.T16 = { totalBefore: total, tq: g.tq, split: g.split, nr: g.nr, n1: g.n1, oei: g.oei };
    expect(g.split).toEqual([true, false]);
    expect(Math.abs(g.tq[0])).toBeLessThan(0.5);
    expect(Math.abs(g.tq[1] - total)).toBeLessThanOrEqual(0.06 * total);
    expect(g.nr).toBeGreaterThanOrEqual(98);
    // At IDLE the gas producer runs at idle N1: not "out" (no OEI flag), as in a training OEI.
    expect(g.oei).toBe(false);
    expect(ts.engineOut.n1Below * 100).toBeLessThan(g.n1[0]);
  }, 30_000);
});
