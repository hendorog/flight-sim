// One engine inoperative, engine starts and the run-up on the twin turboshaft (TW, plan revision 2 section 5: T7a-c,
// T8, T14, T15). The twin rig (twinRig.ts) flies the Bo 105 with the installed 250-C20B (BO105_INSTALLED_C20B, twin.ts)
// and the Bo 105 airframe inertia; the test pilot holds attitude with the cyclic (pedals fixed unless stated), the
// collective is held. Pilot units: NR / N1 / N2 %, torque % (100 % = 298 kW), TOT C, yaw deg/s (+ nose right).
// ESTIMATE rows are the plan's (no source gives these transients); P = sense from the FM. TWIN_TRACE=<dir> writes the
// report. BO runs this file on the real Bo 105 definition once it lands (plan 10, BO guard list).
import { afterAll, describe, expect, it } from 'vitest';
import { DT, TWIN_DEF_MD500_ENGINE, attitudePilot, gauges, lever, LEVER, massForTorque, rig, run, writeTrace, type TwinRig } from './twinRig';

const report: Record<string, unknown> = {};
/** T7c: the surviving engine over every OEI run in this file. */
const survivor = { n1Max: 0, tqMax: 0 };
afterAll(() => writeTrace('twinOei', { ...report, T7c: survivor }));

/**
 * Engine 2 fails (its lever to OFF: fuel cut) `afterS` into the run at the rig's trimmed condition; `seconds` of flight
 * with the collective held, the cyclic holding attitude (and the heading with the pedals when `heading`). Returns the
 * trace's extremes and settled values.
 */
function failEngine2(r: TwinRig, seconds: number, heading = false, record = true) {
  const hold = attitudePilot(r, heading);
  run(r, 1, () => hold(DT));
  lever(r.c, 1, LEVER.off);
  const out = { nrMin: Infinity, t97: -1, tqMax: 0, n1Max: 0, totMax: 0, yawFirst: 0, yawLeftPeak: 0, yawRightPeak: 0,
    oeiAt: -1, lightWhenLow: true, settled: { nr: 0, tq: 0, n1: 0, tot: 0 }, nrAt: [] as number[] };
  let n = 0;
  run(r, seconds, (t) => {
    hold(DT);
    const g = gauges(r);
    out.nrMin = Math.min(out.nrMin, g.nr);
    if (out.t97 < 0 && out.nrMin < 97 && g.nr >= 97) out.t97 = t;
    out.tqMax = Math.max(out.tqMax, g.tq[0]); out.n1Max = Math.max(out.n1Max, g.n1[0]); out.totMax = Math.max(out.totMax, g.tot[0]);
    if (out.yawFirst === 0 && Math.abs(g.yawRate) > 1) out.yawFirst = Math.sign(g.yawRate);
    out.yawLeftPeak = Math.max(out.yawLeftPeak, -g.yawRate); out.yawRightPeak = Math.max(out.yawRightPeak, g.yawRate);
    if (out.oeiAt < 0 && g.oei) out.oeiAt = t;
    if (g.nr <= 95 && !(g.nrLowLight && g.nrLowTone && g.rpmLight && g.horn)) out.lightWhenLow = false;
    if (Math.round(t / DT) % 240 === 0) out.nrAt.push(+g.nr.toFixed(2));
    if (t >= seconds - 5) { n++; out.settled.nr += g.nr; out.settled.tq += g.tq[0]; out.settled.n1 += g.n1[0]; out.settled.tot += g.tot[0]; }
  });
  for (const k of ['nr', 'tq', 'n1', 'tot'] as const) out.settled[k] /= n;
  if (record) { survivor.n1Max = Math.max(survivor.n1Max, out.n1Max); survivor.tqMax = Math.max(survivor.tqMax, out.tqMax); }
  return out;
}

describe('one engine inoperative (T7a-c)', () => {
  it('T7a: from 2 x 45 % at 60 KIAS, collective held, pedals fixed: NR min >= 92 %, >= 97 % within 4 s, survivor settles <= 95 % torque, N1 <= 105 %, RPM light and 650 Hz while NR <= 95 %, OEI flagged, nose yaws LEFT first, <= 10 deg/s (ESTIMATE / P sense FM 3-34)', () => {
    const kg = massForTorque(45, 60);
    const r = rig({ kg, kt: 60 });
    const start = gauges(r);
    const o = failEngine2(r, 15);
    report.T7a = { kg, start: { tq: start.tq, n1: start.n1, tot: start.tot }, ...o };
    expect(start.tq[0]).toBeCloseTo(45, 0); expect(start.tq[1]).toBeCloseTo(45, 0);
    expect(o.nrMin).toBeGreaterThanOrEqual(92);
    if (o.nrMin < 97) expect(o.t97).toBeLessThanOrEqual(4);
    expect(o.settled.tq).toBeLessThanOrEqual(95);
    expect(o.n1Max).toBeLessThanOrEqual(105);
    expect(o.lightWhenLow).toBe(true);
    expect(o.oeiAt).toBeGreaterThan(0); expect(o.oeiAt).toBeLessThanOrEqual(3);
    expect(o.yawFirst).toBe(-1);
    expect(o.yawLeftPeak).toBeLessThanOrEqual(10);
    expect(gauges(r).split).toEqual([false, true]);
  }, 60_000);

  it('T7b: from 2 x 55 % in the hover, collective held: NR settles 93-96 % within 5 s and stays, survivor at the 105 % N1 stop, <= 105 % torque, TOT reaches 810 C; collective down at 2 %/s brings NR >= 97 % and the low-NR warning out (ESTIMATE / P5 FM 3-21)', () => {
    const kg = massForTorque(55, 0);
    const r = rig({ kg, kt: 0 });
    const o = failEngine2(r, 12, true);
    // The FM 3-21 action: collective down at about 2 % of its travel per second until NR is back.
    const hold = attitudePilot(r, true);
    let back = -1;
    run(r, 8, (t) => {
      hold(DT);
      const g = gauges(r);
      if (back < 0 && g.nr >= 97) back = t; else if (back < 0) r.c.collective = Math.max(0, (r.c.collective ?? 0) - 0.02 * DT);
    });
    const after = gauges(r);
    report.T7b = { kg, ...o, recovery: { seconds: back, nr: after.nr, nrLowLight: after.nrLowLight, tone: after.nrLowTone, tq: after.tq[0], collective: after.collective } };
    // From 5 s after the failure: inside the band.
    for (const nr of o.nrAt.slice(5)) { expect(nr).toBeGreaterThanOrEqual(93); expect(nr).toBeLessThanOrEqual(96); }
    expect(o.n1Max).toBeGreaterThanOrEqual(104.5); expect(o.n1Max).toBeLessThanOrEqual(106);
    expect(o.tqMax).toBeLessThanOrEqual(105);
    expect(o.totMax).toBeGreaterThanOrEqual(805);
    expect(back).toBeGreaterThan(0);
    expect(after.nr).toBeGreaterThanOrEqual(97);
    expect(after.nrLowLight).toBe(false); expect(after.nrLowTone).toBe(false);
  }, 60_000);

  it.fails('T7b KNOWN GAP: the RPM light and 650 Hz are on while NR is settled (NR settles at about 95.6 %, just above the unit\'s 95 % threshold)', () => {
    const r = rig({ kg: massForTorque(55, 0), kt: 0 });
    failEngine2(r, 12, true, false);
    const g = gauges(r);
    expect(g.nrLowLight && g.nrLowTone).toBe(true);
  }, 60_000);

  it('T7c: over every OEI run above, the surviving engine never exceeds 106 % N1 or 105 % torque (exact)', () => {
    expect(survivor.n1Max).toBeGreaterThan(0);
    expect(survivor.n1Max).toBeLessThanOrEqual(106);
    expect(survivor.tqMax).toBeLessThanOrEqual(105);
  });

  it('report: the same hover OEI on the MD 500E engine map (the shared ALLISON_250_C20B) tops above 105 % torque, below 810 C, without the NR droop: why the Bo 105 needs its installed map', () => {
    const def = TWIN_DEF_MD500_ENGINE;
    const r = rig({ kg: massForTorque(55, 0, { def }), kt: 0, def });
    const o = failEngine2(r, 12, true, false);
    report.T7bMd500EngineMap = o;
    expect(o.tqMax).toBeGreaterThan(105);
  }, 60_000);
});

describe('engine starts and the run-up (T8, T14, T15)', () => {
  /** The FM 4-9..4-14 start of engine `i`: starter on; at 13 % N1 the lever to IDLE; starter off at 58 % N1. */
  function start(r: TwinRig, i: number, seconds: number, each?: (t: number, g: ReturnType<typeof gauges>, phase: { opened: number; released: number; engaged: number }) => void) {
    r.c.engines[i] = { ...r.c.engines[i], starter: true, fuelSelector: 'on' };
    const phase = { opened: -1, released: -1, engaged: -1 };
    run(r, seconds, (t) => {
      const g = gauges(r);
      if (phase.opened < 0 && g.n1[i] >= 13) { lever(r.c, i, LEVER.idle); phase.opened = t; }
      if (phase.released < 0 && g.n1[i] >= 58) { r.c.engines[i] = { ...r.c.engines[i], starter: false }; phase.released = t; }
      if (phase.engaged < 0 && !g.split[i] && g.n2[i] > 10) phase.engaged = t;
      each?.(t, g, phase);
    });
    return phase;
  }

  it('T8 in-flight start of engine 2 (60 KIAS, engine 1 driving): the freewheel engages as N2 reaches NR, NR transient <= 0.5 % (ESTIMATE)', () => {
    const r = rig({ kg: 2200, kt: 60, enginesRunning: [true, false] });
    const hold = attitudePilot(r, true);
    run(r, 2, () => hold(DT));
    const nr0 = gauges(r).nr;
    let flight = -1, n2AtEngage = 0, nrAtEngage = 0;
    const nr: [number, number][] = [];
    const phase = start(r, 1, 70, (t, g, p) => {
      hold(DT);
      // 10 s at IDLE after the starter is off, then the lever to FLIGHT over 10 s.
      if (p.released > 0 && flight < 0 && t > p.released + 10) flight = t;
      if (flight > 0) lever(r.c, 1, Math.min(1, LEVER.idle + (1 - LEVER.idle) * (t - flight) / 10));
      if (p.engaged > 0 && nrAtEngage === 0) { n2AtEngage = g.n2[1]; nrAtEngage = g.nr; }
      nr.push([t, g.nr]);
    });
    const g = gauges(r);
    // The engagement: NR from 2 s before to 2 s after, against NR before the start.
    const window = nr.filter(([t]) => Math.abs(t - phase.engaged) <= 2).map(([, v]) => v);
    const transient = Math.max(...window.map((v) => Math.abs(v - nr0)));
    // The whole run: with two engines sharing the load each governor droops less, so NR settles higher (the pilot beeps
    // it back, FM 4-16); reported, not part of the engagement row.
    const all = nr.map(([, v]) => v);
    report.T8 = { nr0, transientPct: transient, nrRange: [Math.min(...all), Math.max(...all)], ...phase, flight, n2AtEngage, nrAtEngage,
      end: { tq: g.tq, n1: g.n1, nr: g.nr, split: g.split, n1SplitLight: g.n1SplitLight } };
    expect(phase.engaged).toBeGreaterThan(phase.released);
    expect(Math.abs(n2AtEngage - nrAtEngage)).toBeLessThanOrEqual(1);
    expect(transient).toBeLessThanOrEqual(0.5);
    expect(Math.max(...all) - nr0).toBeLessThanOrEqual(1); expect(nr0 - Math.min(...all)).toBeLessThanOrEqual(0.5);
    expect(g.split).toEqual([false, false]);
    expect(Math.abs(g.tq[0] - g.tq[1])).toBeLessThanOrEqual(5);
  }, 60_000);

  it('T14 ground start of engine 2 with engine 1 at IDLE: N2 2 catches NR with an NR dip <= 1 %; no N1-split light 10 s after', () => {
    const r = rig({ kg: 2200, onGround: true, enginesRunning: [true, false] });
    lever(r.c, 0, LEVER.idle);
    run(r, 40);
    const nr0 = gauges(r).nr;
    let nrMin = Infinity, totPeak = 0, lightAfter: boolean | undefined;
    const phase = start(r, 1, 60, (t, g, p) => {
      nrMin = Math.min(nrMin, g.nr); totPeak = Math.max(totPeak, g.tot[1]);
      if (p.engaged > 0 && lightAfter === undefined && t >= p.engaged + 10) lightAfter = g.n1SplitLight;
    });
    const g = gauges(r);
    report.T14 = { nr0, nrMin, dip: nr0 - nrMin, totPeak, ...phase, lightAfter, end: { nr: g.nr, n1: g.n1, tq: g.tq } };
    expect(phase.engaged).toBeGreaterThan(0);
    expect(nr0 - nrMin).toBeLessThanOrEqual(1);
    expect(lightAfter).toBe(false);
  }, 60_000);

  /** Both engines started and at IDLE on the ground (NR about 59 %). */
  function bothIdle() {
    const r = rig({ kg: 2200, onGround: true });
    lever(r.c, 0, LEVER.idle); lever(r.c, 1, LEVER.idle);
    run(r, 60);
    return r;
  }

  it('T15 both levers IDLE -> FLIGHT over 5 s: no NR overshoot > 102 %, split <= 5 % before synchronising, TOT < 779 C throughout', () => {
    const r = bothIdle();
    const nr0 = gauges(r).nr;
    let t98 = -1, peak = 0, totMax = 0, splitMax = 0;
    run(r, 30, (t) => {
      const v = LEVER.idle + (LEVER.flight - LEVER.idle) * Math.min(1, t / 5);
      lever(r.c, 0, v); lever(r.c, 1, v);
      const g = gauges(r);
      if (t98 < 0 && g.nr >= 98) t98 = t;
      peak = Math.max(peak, g.nr); totMax = Math.max(totMax, ...g.tot); splitMax = Math.max(splitMax, Math.abs(g.tq[0] - g.tq[1]));
    });
    report.T15 = { nr0, t98, peak, totMax, splitMax, end: gauges(r).nr };
    expect(nr0).toBeGreaterThanOrEqual(55); expect(nr0).toBeLessThanOrEqual(65);
    expect(t98).toBeGreaterThan(0);
    expect(peak).toBeLessThanOrEqual(102);
    expect(totMax).toBeLessThan(779);
    expect(splitMax).toBeLessThanOrEqual(5);
  }, 60_000);

  it.fails('T15 KNOWN GAP: NR 60 -> 98 % takes 10-20 s (NR follows the levers: 98 % about 4.4 s after they start to move)', () => {
    const r = bothIdle();
    let t98 = -1;
    run(r, 30, (t) => {
      const v = LEVER.idle + (LEVER.flight - LEVER.idle) * Math.min(1, t / 5);
      lever(r.c, 0, v); lever(r.c, 1, v);
      if (t98 < 0 && gauges(r).nr >= 98) t98 = t;
    });
    expect(t98).toBeGreaterThanOrEqual(10);
    expect(t98).toBeLessThanOrEqual(20);
  }, 60_000);
});
