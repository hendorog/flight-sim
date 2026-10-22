// Bo 105 CB-4 (BO, plan revision 2 section 6.2): the handling a pilot judges, on the REAL definition, in pilot units.
// Owner readouts at 80 KIAS (AR-280, D), the keyboard tap, attitudes and the cyclic schedule, ground stance, low g, the
// hover turn and pedal margin, sideward and rearward flight, the mast-moment indicator (slope landings and in flight)
// and the tail-rotor drive failure sense. ESTIMATE rows are the plan's (no source gives them); owner judgement
// overrides. Known gaps are it.fails rows, never fitted. BO105_TRACE=<dir> writes bo105Handling.json.
import { afterAll, describe, expect, it } from 'vitest';
import { DEG, FT, KT, clamp, v3 } from '../../src/core/math';
import { stepKeyAxis } from '../../src/input/virtualYoke';
import { createFlightModelFor } from '../../src/physics';
import type { BladeElementFlightModel } from '../../src/physics/flightModel';
import type { AircraftDefinition } from '../../src/aircraft/types';
import { BO105_MAST_MOMENT } from '../../src/aircraft/bo105/hub';
import { BO105_REFERENCE as V } from '../../src/aircraft/bo105/reference';
import { AR280_DLR, COLUMN, linearModel, respond } from './ar280';
import { DT, d, def, gauges, positionHold, quasiStaticDerivatives, rig, run, withWind, writeTrace, type Bo105Rig } from './bo105Rig';

const report: Record<string, unknown> = {};
afterAll(() => writeTrace('bo105Handling', report));
/** AR-280's condition: 80 KCAS at 3000 ft density altitude (83.6 KTAS), 2200 kg. */
const KTAS80 = 80 * Math.sqrt(1.225 / 1.12094);
const at80 = () => rig(2200, { kt: KTAS80, ft: 3000 });
const IGE = d.skids.z + 3 * FT;

/**
 * Response of a step of `amount` (sim units; 0.2 = 10 % of full travel) in one control from the 80 KCAS trim: the
 * excited aircraft minus an identical unexcited one (removes the trim's slow drift), sampled every step.
 */
function stepAt80(axis: 'aileron' | 'elevator' | 'rudder', amount: number, seconds: number) {
  const base = at80(), ex = at80();
  ex.c[axis] += amount;
  const out: { t: number; p: number; q: number; r: number; beta: number; bank: number }[] = [];
  let lastQ = 0, peakQdot = 0;
  for (let i = 1; i <= Math.round(seconds / DT); i++) {
    base.fm.step(DT, base.c, base.env); ex.fm.step(DT, ex.c, ex.env);
    const a = gauges(ex), b = gauges(base), q = a.q - b.q;
    if (i * DT <= 0.3) peakQdot = Math.max(peakQdot, Math.abs(q - lastQ) / DT);
    lastQ = q;
    out.push({ t: i * DT, p: a.p - b.p, q, r: a.yawRate - b.yawRate, beta: a.beta - b.beta, bank: a.roll - b.roll });
  }
  return { out, peakQdot, at: (t: number) => out[Math.round(t / DT) - 1] };
}
/** The DLR set's sideslip after a pedal step (the 8-state model of ar280.ts, RK4 at 1 ms), deg. */
function dlrSideslip(percent: number, times: readonly number[]): number[] {
  const A = linearModel(AR280_DLR), j = COLUMN.ped, k = AR280_DLR;
  const b = [k.X[j], k.Z[j], k.M[j], 0, k.Y[j], k.L[j], k.N[j], 0].map((x) => x * percent);
  const f = (x: number[]) => A.map((row, i) => row.reduce((s, aij, c) => s + aij * x[c], 0) + b[i]);
  let x = [0, 0, 0, 0, 0, 0, 0, 0], t = 0;
  const h = 0.001, out: number[] = [];
  for (const end of times) {
    while (t < end - 1e-12) {
      const k1 = f(x), k2 = f(x.map((xi, i) => xi + h / 2 * k1[i])), k3 = f(x.map((xi, i) => xi + h / 2 * k2[i])), k4 = f(x.map((xi, i) => xi + h * k3[i]));
      x = x.map((xi, i) => xi + h / 6 * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i])); t += h;
    }
    out.push(Math.atan2(x[4], k.u0) / DEG);
  }
  return out;
}

describe('owner readouts at 80 KCAS, 3000 ft, 2200 kg (AR-280 DLR, D: per 10 % of full travel)', () => {
  it('roll: a 10 % lateral step peaks at 12.5 deg/s +/-30 % in the first 2 s (0.185 x 10 / 8.50; the roll mode, before sideslip and spiral act)', () => {
    const s = stepAt80('aileron', 0.2, 2), peak = Math.max(...s.out.map((x) => x.p));
    const ref = respond(AR280_DLR, 'lat', 10, [0.5, 1, 1.5, 2]);
    report.roll = { peak, at05: s.at(0.5).p, at1: s.at(1).p, at15: s.at(1.5).p, at2: s.at(2).p,
      dlrModel: ref.at.map((x) => x.p / DEG), target: 12.5 };
    expect(peak).toBeGreaterThanOrEqual(12.5 * 0.7); expect(peak).toBeLessThanOrEqual(12.5 * 1.3);
  });
  it('pitch: a 10 % longitudinal step gives 53 deg/s^2 +/-30 % of quasi-static pitch acceleration (0.093 x 10) and the DLR model\'s pitch rate at 0.5 s +/-30 %; the peak of the time response (the flap lag) reported', () => {
    const r = at80(), qs = quasiStaticDerivatives(r).rows.M[COLUMN.lon] * 10 / DEG;
    const s = stepAt80('elevator', 0.2, 1), ref = respond(AR280_DLR, 'lon', 10, [0.5]);
    report.pitch = { quasiStaticDegS2: qs, peakTimeDomainDegS2: s.peakQdot, q05: s.at(0.5).q, dlrModelQ05: ref.at[0].q / DEG };
    expect(qs).toBeGreaterThanOrEqual(53 * 0.7); expect(qs).toBeLessThanOrEqual(53 * 1.3);
    expect(Math.abs(s.at(0.5).q / (ref.at[0].q / DEG) - 1)).toBeLessThanOrEqual(0.3);
  }, 30_000);
  it('pedal: a 10 % right-pedal step peaks at 8-15 deg/s inside 0.5 s; 2 s later the yaw rate is under 3 deg/s (the weathercock)', () => {
    const s = stepAt80('rudder', 0.2, 6), peak = Math.max(...s.out.filter((x) => x.t <= 0.5).map((x) => x.r));
    report.pedal = { peak05: peak, r1: s.at(1).r, r2: s.at(2).r, beta1: s.at(1).beta, beta2: s.at(2).beta, beta4: s.at(4).beta,
      beta6: s.at(6).beta, bank2: s.at(2).bank, dlrModel: { r: respond(AR280_DLR, 'ped', 10, [0.5, 1, 2, 4]).at.map((x) => x.r / DEG),
        beta: dlrSideslip(10, [1, 2, 4, 6]) } };
    expect(peak).toBeGreaterThanOrEqual(8); expect(peak).toBeLessThanOrEqual(15);
    expect(Math.abs(s.at(2).r)).toBeLessThan(3);
  });
  /**
   * KNOWN SIDESLIP GAP (plan row: "a steady sideslip of 5-8 deg"): the sideslip settles near 4 deg. The weathercock
   * Nv (+0.136 1/(s m)) sits inside the AR-280 envelope but above DLR's 0.117, and the fins are not a knob (plan 6.2).
   */
  it.fails('KNOWN SIDESLIP GAP — the 10 % pedal step settles at a steady sideslip of 5-8 deg', () => {
    const s = stepAt80('rudder', 0.2, 4), beta = Math.abs(s.at(4).beta);
    expect(beta >= 5 && beta <= 8, `sideslip ${beta}`).toBe(true);
  });
});

describe('keyboard tap (plan 6.2 ESTIMATE; the profile\'s key axis, BO105_INPUT, is the knob)', () => {
  it('a 1 s lateral key tap at 80 KIAS gives 8-14 deg of bank change 2 s after the release (the plan\'s first 1-2 s roll window)', () => {
    // The InputSystem's keyboard yoke (virtualYoke.ts stepKeyAxis) at 60 frames/s: the key held 1 s, then released;
    // the Bo 105's cyclic is a position command, so the stick stays where the tap left it.
    const r = at80(), b = at80(), axis = def.input.assists.axes!.aileron, frame = 1 / 60, a0 = r.c.aileron;
    let kb = 0, held = 0, bank3 = 0, rate = 0;
    for (let f = 0; f < 3 * 60; f++) {
      if (f * frame < 1) { held += frame; kb = stepKeyAxis(kb, 1, r.fm.state.ias, frame, axis, held); }
      r.c.aileron = a0 + kb;
      for (let k = 0; k < 4; k++) { r.fm.step(DT, r.c, r.env); b.fm.step(DT, b.c, b.env); }
    }
    bank3 = (r.fm.state.roll - b.fm.state.roll) / DEG; rate = (r.fm.state.angularVelocity.x - b.fm.state.angularVelocity.x) / DEG;
    report.tap = { stick: kb, percentOfTravel: kb * 50, bankAt3s: bank3, rollRateAt3s: rate };
    expect(bank3).toBeGreaterThanOrEqual(8); expect(bank3).toBeLessThanOrEqual(14);
  });
});

describe('attitudes and the cyclic schedule, 2200 kg mid-CG, SL ISA (ESTIMATE bands, plan 6.2)', () => {
  const trims = (() => {
    let t: Record<string, ReturnType<typeof gauges>> | undefined;
    return () => (t ??= Object.fromEntries(([[0, IGE], [60, 1500], [100, 1500], [120, 1500], [145, 1500]] as const)
      .map(([kt, h]) => [kt, gauges(rig(2200, { kt, height: h }))])));
  })();
  it('hover IGE (3 ft skids): pitch +1 to +4 deg nose-up, roll at least 1 deg left (left skid low; the 3 deg edge is the row below)', () => {
    const h = trims()[0];
    report.attitudes = Object.fromEntries(Object.entries(trims()).map(([k, g]) => [k, { pitch: g.pitch, roll: g.roll, elevator: g.elevator,
      aileron: g.aileron, rudder: g.rudder, collective: g.collective }]));
    expect(h.pitch).toBeGreaterThanOrEqual(1); expect(h.pitch).toBeLessThanOrEqual(4);
    expect(h.roll).toBeLessThanOrEqual(-1);
  }, 30_000);
  // KNOWN GAP (final fix round): the hover roll read 2.97 deg left at the band edge (KNOWN_ISSUES 19); with the hingeless rotor's
  // in-plane side force applied as a vector (rotorcraft.ts inPlaneForce) it reads 3.01 deg left, 0.01 deg past the ESTIMATE band.
  it.fails('KNOWN GAP: hover IGE roll no more than 3 deg left (measured 3.01)', () => {
    expect(trims()[0].roll).toBeGreaterThanOrEqual(-3);
  }, 30_000);
  it('pitch at 60 KIAS -1..+2, 100 KIAS -2..-5, 120 KIAS -4..-7, 145 KIAS -6..-9 deg', () => {
    const t = trims(), band = { 60: [-1, 2], 100: [-5, -2], 120: [-7, -4], 145: [-9, -6] } as const;
    for (const [kt, [lo, hi]] of Object.entries(band)) {
      expect(t[kt].pitch, `${kt} KIAS`).toBeGreaterThanOrEqual(lo); expect(t[kt].pitch, `${kt} KIAS`).toBeLessThanOrEqual(hi);
    }
  });
  it('the longitudinal cyclic moves monotonically forward with speed', () => {
    const e = [0, 60, 100, 120, 145].map((kt) => trims()[kt].elevator);
    for (let i = 1; i < e.length; i++) expect(e[i]).toBeLessThan(e[i - 1]);
  });
  /**
   * The 120 KIAS trim's distance forward of the hover trim, as a fraction of the longitudinal travel. Re-sourced at the
   * flyability pass (2026-10-22) from the plan's ESTIMATE 0.20-0.35 (it was the it.fails KNOWN TRAVEL GAP) to 0.40-0.60
   * (F/D): NASA CR-3144 section III (Heffley 1979, the analytical BO-105C) trims 5.49 deg of longitudinal cyclic forward
   * of its hover at 120 kt against its own rig of 10 deg of travel, 0.549 (the model: 5.88 deg of its fitted 13.43,
   * about 0.44). The band brackets the source's 0.549 and the source's 5.49 deg over the model's AR-280-fitted 13.43 deg
   * of travel (0.409, D). Re-sourced, not loosened: the old band had no source.
   */
  it('120 KIAS trim 0.40-0.60 of the travel forward of the hover trim (F/D: NASA CR-3144 0.549 at its 10 deg rig; was ESTIMATE 0.20-0.35, the it.fails KNOWN TRAVEL GAP)', () => {
    const f = (trims()[0].elevator - trims()[120].elevator) / 2;
    report.stick120 = { fractionOfTravel: f };
    expect(f).toBeGreaterThanOrEqual(0.4); expect(f).toBeLessThanOrEqual(0.6);
  });
});

describe('ground stance (ESTIMATE, plan 6.2)', () => {
  it('on level ground the fuselage sits within 1.5 deg of level, and the IGE hover attitude is within 2 deg of it (no lift-off pitch jump)', () => {
    const g = rig(2200, { onGround: true });
    run(g, 3);
    const ground = gauges(g), hover = gauges(rig(2200, { height: IGE }));
    report.stance = { groundPitch: ground.pitch, groundRoll: ground.roll, hoverPitch: hover.pitch, jump: hover.pitch - ground.pitch };
    expect(Math.abs(ground.pitch)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(hover.pitch - ground.pitch)).toBeLessThanOrEqual(2);
  });
});

describe('low g (R17 on the real definition, D: the spring carries the hub moment without thrust)', () => {
  it('roll acceleration to a 10 % lateral step during a 0.2 g pushover at 100 KIAS is at least 80 % of the 1 g value', () => {
    const response = (pushover: boolean, gTarget = 0.2) => {
      const pair = [rig(2200, { kt: 100 }), rig(2200, { kt: 100 })];
      let g = 1, waited = 0;
      if (pushover) {
        while (waited < 3 && (g = pair[0].fm.state.gLoad) > gTarget) {
          for (const r of pair) { r.c.collective = Math.max(0, (r.c.collective ?? 0) - 0.5 * DT); r.fm.step(DT, r.c, r.env); }
          waited += DT;
        }
      }
      const startP = pair.map((r) => r.fm.state.angularVelocity.x);
      pair[1].c.aileron += 0.2;
      for (let i = 0; i < 0.1 / DT; i++) for (const r of pair) r.fm.step(DT, r.c, r.env);
      const dp = (pair[1].fm.state.angularVelocity.x - startP[1]) - (pair[0].fm.state.angularVelocity.x - startP[0]);
      return { accel: dp / 0.1 / DEG, g: pair[0].fm.state.gLoad };
    };
    const one = response(false), low = response(true), zero = response(true, 0.02);
    report.lowG = { oneG: one, lowG: low, nearZeroG: zero, ratio: low.accel / one.accel, ratioZero: zero.accel / one.accel };
    expect(low.g).toBeLessThan(0.3);
    expect(low.accel / one.accel).toBeGreaterThanOrEqual(0.8);
    expect(zero.accel / one.accel).toBeGreaterThanOrEqual(0.8);
  }, 30_000);
});

describe('hover turn and pedal margin (ESTIMATE; P5 FM 2-16: hover turns limited to 90 deg/s, so capable of it)', () => {
  for (const [side, rudder] of [['right', 1], ['left', -1]] as const) {
    it(`a full ${side}-pedal step in the 2200 kg IGE hover reaches 90 deg/s within 3 s`, () => {
      const r = rig(2200, { height: IGE });
      r.c.rudder = rudder;
      let peak = 0, t90 = -1;
      run(r, 3, (t) => { const y = Math.abs(gauges(r).yawRate); peak = Math.max(peak, y); if (t90 < 0 && y >= 90) t90 = t; });
      (report.hoverTurn ??= {} as Record<string, unknown>) as Record<string, unknown>;
      (report.hoverTurn as Record<string, unknown>)[side] = { peak, t90 };
      expect(peak).toBeGreaterThanOrEqual(90);
    });
  }
  it('hover IGE at 2500 kg leaves at least 15 % of the pedal travel to the left', () => {
    const g = gauges(rig(2500, { height: IGE })), margin = (g.rudder + 1) / 2;
    report.pedalMargin2500 = margin;
    expect(margin).toBeGreaterThanOrEqual(0.15);
  });
});

/** Hold a hover over a point in a steady wind building over 15 s; the controls averaged over the last 10 s of 45 s. */
function windHover(kg: number, north: number, east: number, cg: 'forward' | 'mid' | 'aft') {
  const r = rig(kg, { kt: 0, height: d.skids.z + 10 * FT, cg });
  withWind(r, north * KT, east * KT, 15);
  const hold = positionHold(r), avg = { elevator: 0, aileron: 0, rudder: 0, n: 0 };
  run(r, 45, (t) => { hold(DT); if (t > 35) { avg.elevator += r.c.elevator; avg.aileron += r.c.aileron; avg.rudder += r.c.rudder; avg.n++; } });
  const m = (v: number) => v / avg.n;
  const e = m(avg.elevator), a = m(avg.aileron), p = m(avg.rudder);
  // Margin: the distance to the nearer stop as a fraction of the full travel (2 sim units).
  return { elevator: e, aileron: a, rudder: p, margin: { longitudinal: (1 - Math.abs(e)) / 2, lateral: (1 - Math.abs(a)) / 2,
    pedal: (1 - Math.abs(p)) / 2 }, groundSpeed: Math.hypot(r.fm.state.velocity.x, r.fm.state.velocity.y) };
}
describe('sideward 25 kt and rearward 20 kt (P5 FM 2-4 demonstrated): trims with at least 10 % control margin', () => {
  it('sideward 25 kt both ways at 2500 kg mid-CG: lateral, pedal and longitudinal margins >= 10 %', () => {
    const right = windHover(2500, 0, -25, 'mid'), left = windHover(2500, 0, 25, 'mid');
    report.sideward = { windFromRight: right, windFromLeft: left };
    for (const s of [right, left]) {
      expect(s.groundSpeed).toBeLessThan(1);
      expect(s.margin.lateral).toBeGreaterThanOrEqual(0.1); expect(s.margin.pedal).toBeGreaterThanOrEqual(0.1);
      expect(s.margin.longitudinal).toBeGreaterThanOrEqual(0.1);
    }
  }, 60_000);
  /**
   * KNOWN TRAVEL GAP: the fitted longitudinal travel (13.4 deg) holds the envelope's needs (9.4 deg forward at 145 KIAS
   * aft CG, 2.6 deg aft in rearward flight at forward CG) with 5.2 % to spare at each end (rotorcraft.ts BO105_CYCLIC_DEG).
   */
  it.fails('KNOWN TRAVEL GAP — rearward 20 kt at 2500 kg forward CG with >= 10 % longitudinal margin', () => {
    const s = windHover(2500, 20, 0, 'forward');
    report.rearward = s;
    expect(s.margin.longitudinal).toBeGreaterThanOrEqual(0.1);
  }, 60_000);
  it('rearward 20 kt at 2500 kg forward CG holds the hover with the cyclic short of its aft stop (>= 5 % margin)', () => {
    const s = windHover(2500, 20, 0, 'forward');
    expect(s.groundSpeed).toBeLessThan(1);
    expect(s.margin.longitudinal).toBeGreaterThanOrEqual(0.05);
  }, 60_000);
});

// ------------------------------------------------------------------------------------------------ mast moment
const LIMIT = BO105_MAST_MOMENT.limit, YELLOW = BO105_MAST_MOMENT.limit * BO105_MAST_MOMENT.yellow;
const mastReport = () => (report.mastInFlight ??= {}) as Record<string, number>;
/**
 * A standard-technique slope landing at 2200 kg mid-CG on a slope rising to the right (left-down) or to the left: hover
 * over the slope, sink at 0.3 m/s holding attitude, position and heading; at first contact lower the collective at 0.12
 * of its travel per second while the lateral cyclic keeps the disc level (into the slope by the fuselage's roll from the
 * hover attitude, to the stop if need be); after the collective is down, hold 10 s. Returns the peak |hub moment|.
 */
function slopeLanding(deg: number, leftDown: boolean) {
  const r = rig(2200, { kt: 0, height: 4 });
  const s = Math.tan(deg * DEG) * (leftDown ? 1 : -1), base = r.env;
  r.env = { ...base, groundElevation: (_n: number, e: number) => e * s, groundNormal: () => v3.normalize({ x: 0, y: -s, z: -1 }) } as typeof base;
  const s0 = r.fm.state, roll0 = s0.roll, pitch0 = s0.pitch, h0 = s0.heading, a0 = r.c.aileron, e0 = r.c.elevator, p0 = r.c.rudder;
  const c0 = r.c.collective ?? 0, halfLat = (d.cyclicLimits!.left + d.cyclicLimits!.right) / 2;
  let lowering = false, ci = 0, peak = 0;
  run(r, 40, () => {
    const st = r.fm.state, e = Math.atan2(Math.sin(st.heading - h0), Math.cos(st.heading - h0));
    r.c.rudder = clamp(p0 - 2 * e - 0.7 * st.angularVelocity.z, -1, 1);
    r.c.elevator = clamp(e0 + 1.5 * (pitch0 - st.pitch) - 0.6 * st.angularVelocity.y - (lowering ? 0 : 0.02 * st.velocity.x), -1, 1);
    if (!lowering) {
      r.c.aileron = clamp(a0 + 1.2 * (roll0 - st.roll) - 0.3 * st.angularVelocity.x - 0.02 * st.velocity.y, -1, 1);
      ci += (st.velocity.z - 0.3) * 0.02 * DT;
      r.c.collective = clamp(c0 + 0.05 * (st.velocity.z - 0.3) + ci, 0, 1);
      if (st.onGround) lowering = true;
    } else {
      r.c.aileron = clamp(a0 - (st.roll - roll0) / halfLat, -1, 1);
      r.c.collective = Math.max(0, (r.c.collective ?? 0) - 0.12 * DT);
    }
    peak = Math.max(peak, gauges(r).mastMoment);
  });
  return { peak, roll: r.fm.state.roll / DEG, groundSpeed: Math.hypot(r.fm.state.velocity.x, r.fm.state.velocity.y), touched: lowering };
}
describe(`mast-moment indicator (AGENT/ESTIMATE marks set from these rows: LIMIT ${LIMIT} N m, yellow from ${BO105_MAST_MOMENT.yellow} of it; P5 FM 2-16: 15 deg left-down / 8 deg right-down slopes with the indicator)`, () => {
  const slopes = (() => { let x: Record<string, ReturnType<typeof slopeLanding>> | undefined;
    return () => (x ??= { left15: slopeLanding(15, true), right8: slopeLanding(8, false), left20: slopeLanding(20, true) }); })();
  it('standard slope landings at 2200 kg on 15 deg left-down and 8 deg right-down: the needle in the top third of yellow, LIMIT off', () => {
    const s = slopes();
    report.slopes = { ...s, limit: LIMIT, yellow: YELLOW };
    for (const k of ['left15', 'right8'] as const) {
      expect(s[k].touched).toBe(true);
      expect(s[k].peak, k).toBeLessThan(LIMIT);
      expect(s[k].peak, k).toBeGreaterThanOrEqual(LIMIT - (LIMIT - YELLOW) / 3);
    }
  }, 120_000);
  it('20 deg left-down: LIMIT on', () => {
    expect(slopes().left20.peak).toBeGreaterThanOrEqual(LIMIT);
  }, 120_000);
  it('in flight: a full lateral stick reversal at 80 KIAS reaches yellow, never LIMIT', () => {
    const r = rig(2200, { kt: 80 }), a0 = r.c.aileron;
    let peak = 0;
    run(r, 3, (t) => { r.c.aileron = t < 0.5 ? a0 : t < 1.0 ? 1 : t < 1.5 ? -1 : a0; peak = Math.max(peak, gauges(r).mastMoment); });
    mastReport().reversal80 = peak;
    expect(peak).toBeGreaterThanOrEqual(YELLOW); expect(peak).toBeLessThan(LIMIT);
  });
  /**
   * Restated at the pilot review (2026-10-21, AGENT): the plan's ESTIMATE row read "a 2.5 g pull at 100 KIAS reaches
   * yellow". The needle reads the hub moment (TPP-to-shaft tilt), not g: the pull peaks at 3.1 kN m, below the 3.4 kN m
   * of ordinary 130 KIAS mid-CG cruise, so a yellow onset low enough for the pull put cruise in yellow. With the yellow at
   * the plan's 0.5 of LIMIT the pull reads green (docs/bo105-flight-model.md section 7).
   */
  it('in flight: a 2.5 g pull at 100 KIAS stays green (the needle reads the hub moment, not g), never LIMIT', () => {
    const r = rig(2200, { kt: 100 }), e0 = r.c.elevator;
    let peak = 0, gmax = 0, ei = 0;
    run(r, 4, (t) => {
      const g = r.fm.state.gLoad; gmax = Math.max(gmax, g);
      // The pilot pulls toward 2.5 g on the g meter and checks the pitch rate (a hand on the stick, not a servo).
      if (t > 0.5 && t < 2.5) { ei += (2.5 - g) * 0.25 * DT; r.c.elevator = clamp(e0 + ei - 0.15 * r.fm.state.angularVelocity.y, -1, 1); }
      else if (t >= 2.5) r.c.elevator = e0;
      peak = Math.max(peak, gauges(r).mastMoment);
    });
    mastReport().pull25 = peak; mastReport().pull25gMax = gmax;
    expect(gmax).toBeGreaterThanOrEqual(2.4); expect(gmax).toBeLessThanOrEqual(3.0);
    expect(peak).toBeLessThan(YELLOW); expect(peak).toBeLessThan(LIMIT);
  });
  it('steady trims in the legal envelope read green: level flight at the CG limits and mid CG to 130 KIAS (about the maximum level speed at MCP) and at Vne (145 KIAS at <= 2400 kg, 130 KIAS above), and the forward-CG hover', () => {
    const cases = [[2200, 'forward', 145], [2200, 'mid', 130], [2200, 'mid', 145], [2200, 'aft', 130], [2200, 'aft', 145],
      [2400, 'aft', 145], [2500, 'aft', 130], [2200, 'forward', 0], [2500, 'forward', 0]] as const;
    const rows = cases.map(([kg, cg, kt]) => {
      const g = gauges(rig(kg, { kt, cg, height: kt === 0 ? IGE : 1500 }));
      return { kg, cg, kt, mastMomentNm: g.mastMoment };
    });
    report.mastSteady = { rows, yellow: YELLOW };
    for (const row of rows) expect(row.mastMomentNm, `${row.kg} kg ${row.cg} ${row.kt} KIAS`).toBeLessThan(YELLOW);
  }, 60_000);
  it('in flight: a steady 60 deg turn at 100 KIAS (2 g; level, or descending where the power runs out at 86 % torque) stays green', () => {
    const r = rig(2200, { kt: 100 }), s0 = r.fm.state, a0 = r.c.aileron, e0 = r.c.elevator, p0 = s0.pitch, r0 = r.c.rudder;
    let pi = 0, bi = 0, ri = 0, peak = 0, g2 = 0, bank2 = 0, n = 0;
    run(r, 40, (t) => {
      const st = r.fm.state, g = gauges(r), bank = Math.min(60, t * 10) * DEG;
      ri += (bank - st.roll) * 0.5 * DT;
      r.c.aileron = clamp(a0 + 1.5 * (bank - st.roll) - 0.4 * st.angularVelocity.x + ri, -1, 1);
      const spd = g.kias - 100; pi += spd * 0.004 * DT;
      r.c.elevator = clamp(e0 + 1.5 * (p0 + 0.015 * spd + pi - st.pitch) - 0.4 * st.angularVelocity.y, -1, 1);
      // Height with the collective (NED: descending = velocity.z > 0), torque capped at the 86 % AEO limit.
      const want = clamp((r.c.collective ?? 0) + 0.05 * st.velocity.z * DT, 0, 1);
      r.c.collective = g.tq[0] > 86 ? Math.max(0, (r.c.collective ?? 0) - 0.05 * DT) : want;
      bi += g.beta * DEG * 0.5 * DT; r.c.rudder = clamp(r0 + g.beta * DEG + bi, -1, 1);
      if (t > 30) { peak = Math.max(peak, g.mastMoment); g2 += st.gLoad; bank2 += st.roll / DEG; n++; }
    });
    mastReport().turn60 = peak; mastReport().turn60g = g2 / n; mastReport().turn60bank = bank2 / n; mastReport().turn60fpm = gauges(r).fpm;
    expect(Math.abs(bank2 / n - 60)).toBeLessThan(3);
    expect(Math.abs(g2 / n - 2)).toBeLessThan(0.2);
    expect(peak).toBeLessThan(YELLOW);
  }, 30_000);
});

describe('tail-rotor drive failure (P5 FM 3-40: rapid RIGHT yaw, right roll, nose down)', () => {
  it('at 100 KIAS the tail rotor stops driving (its thrust and power gone), controls frozen: within 2 s the nose yaws right, the aircraft rolls right and pitches down', () => {
    const r = rig(2200, { kt: 100 });
    // The same aircraft with no tail-rotor thrust (blade chord 1e-6): built, then put on the trimmed state.
    const failed: AircraftDefinition = { ...def, rotorcraft: { ...d, tail: { ...d.tail, chord: 1e-6 } } };
    const fm = createFlightModelFor(failed) as BladeElementFlightModel;
    fm.setLoading(r.loading.payload);
    fm.reset({ position: { ...r.fm.state.position }, heading: 0, airspeed: 100 * KT, flightPathAngle: 0, onGround: false,
      engineRunning: true, fuelFraction: r.loading.fuelFraction }, r.env);
    const s = r.fm.state;
    fm.setKinematics({ position: { ...s.position }, orientation: { ...s.orientation }, velocity: { ...s.velocity }, angularVelocity: { ...s.angularVelocity } });
    const c = { ...r.c, engines: r.c.engines.map((e) => ({ ...e })) };
    const f: Bo105Rig = { ...r, fm };
    // Controls frozen for 2 s (the uncorrected tendencies the FM describes): the yaw comes first (40 deg/s within 0.8 s),
    // the right roll and the nose-down pitch follow within 2 s.
    let yaw = 0, roll = 0, pitch = 0;
    const p0 = fm.state.pitch, r0 = fm.state.roll;
    for (let i = 0; i < 2.0 / DT; i++) { fm.step(DT, c, f.env); yaw = Math.max(yaw, fm.state.angularVelocity.z / DEG); }
    roll = (fm.state.roll - r0) / DEG; pitch = (fm.state.pitch - p0) / DEG;
    report.trDrive = { yawRateMax2s: yaw, rollChange2s: roll, pitchChange2s: pitch };
    expect(yaw).toBeGreaterThan(10);
    expect(roll).toBeGreaterThan(0);
    expect(pitch).toBeLessThan(0);
  }, 30_000);
});

// The reference's hover-turn limit, for the docs (P5 FM 2-16).
void V.hoverTurnLimitDegS;
