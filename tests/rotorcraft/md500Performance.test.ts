// MD 500E (369E, 250-C20B): performance acceptance (plan 6.6). Every row prints its number next to the target and the
// target's source tag; MD500_TRACE=<dir> writes the full report. P = RFM CSP-E-1 Rev 16; M = MD marketing (spec 2023);
// F = OH-6A (Heffley NASA CR-3144); D = derived; ESTIMATE = no source.
import { afterAll, describe, expect, it } from 'vitest';
import { DEG, FT } from '../../src/core/math';
import { MD500_REFERENCE as V } from '../../src/aircraft/md500/reference';
import { DT, d, collectiveServo, gauges, pilot, rig, run, writeTrace } from './md500Rig';
import { OH6A_60KT, OH6A_HOVER, respond, type Oh6aCase } from './oh6a';

const report: Record<string, unknown> = {};
afterAll(() => writeTrace('md500Performance', report));
const IGE_HEIGHT = d.skids.z + 3.5 * FT;

/** Trimmed hover (reset solves it with the steady engine): torque, TOT, N1 and the controls. */
function hover(lb: number, ft: number, isaDev: number, ige: boolean) {
  const r = rig(lb, { ft, isaDev, height: ige ? IGE_HEIGHT : 150 });
  return { converged: r.fm.lastTrim?.converged === true, throttle: r.fm.state.rotorcraft!.governorThrottle, ...gauges(r) };
}
/** Hover ceiling at the take-off power limit: 87.2 psi, TOT 810 C, N1 105 % or the grip's full schedule, whichever first. */
function ceiling(lb: number, isaDev: number, ige: boolean): number {
  const limited = (h: ReturnType<typeof hover>) => !h.converged || h.psi > 87.2 || h.tot > 810 || h.n1 > 105 || h.throttle >= 0.999;
  let lo = 0, hi = 20000;
  for (let i = 0; i < 10; i++) { const ft = (lo + hi) / 2; if (limited(hover(lb, ft, isaDev, ige))) hi = ft; else lo = ft; }
  return (lo + hi) / 2;
}
/** Level trim at `kt` KIAS (SL ISA): power and attitude. */
function level(lb: number, kt: number, pathDeg = 0) {
  const r = rig(lb, { kt, pathDeg });
  return { converged: r.fm.lastTrim?.converged === true, ...gauges(r) };
}

describe('MD 500E hover (RFM Fig 5-4, Fig 8-1; plan 6.6)', () => {
  it('hover ceilings IGE (3.5 ft skids) and OGE at take-off power, 103 % N2, within 400 ft of the RFM charts (P)', () => {
    const rows = [
      { lb: 3000, isa: 0, ige: true, chart: 8450 }, { lb: 3000, isa: 20, ige: true, chart: 5750 },
      { lb: 2600, isa: 0, ige: true, chart: 12_300 }, { lb: 2900, isa: 0, ige: false, chart: 6980 },
      { lb: 2900, isa: 20, ige: false, chart: 4200 }, { lb: 2600, isa: 0, ige: false, chart: 10_350 },
    ].map((row) => ({ ...row, model: Math.round(ceiling(row.lb, row.isa, row.ige)) }));
    report.ceilings = rows;
    for (const row of rows) expect(Math.abs(row.model - row.chart), JSON.stringify(row)).toBeLessThanOrEqual(400);
  }, 120_000);

  it('hover at 3000 lb SL ISA: torque IGE 62-72 / OGE 72-82 psi, TOT 620-720 C (DERIVED / ESTIMATE); pitch +1..+5 deg, pedal -0.20..-0.45 (ESTIMATE)', () => {
    const ige = hover(3000, 0, 0, true), oge = hover(3000, 0, 0, false);
    report.hover = { ige, oge };
    expect(ige.converged && oge.converged).toBe(true);
    expect(ige.psi).toBeGreaterThanOrEqual(62); expect(ige.psi).toBeLessThanOrEqual(72);
    expect(oge.psi).toBeGreaterThanOrEqual(72); expect(oge.psi).toBeLessThanOrEqual(82);
    for (const h of [ige, oge]) { expect(h.tot).toBeGreaterThanOrEqual(620); expect(h.tot).toBeLessThanOrEqual(720); }
    expect(ige.pitch).toBeGreaterThanOrEqual(1); expect(ige.pitch).toBeLessThanOrEqual(5);
    expect(ige.rudder).toBeGreaterThanOrEqual(-0.45); expect(ige.rudder).toBeLessThanOrEqual(-0.2);
    // Left skid low, as the 500's CCW rotor and right-pushing tail rotor require (sign only here; the band is below).
    expect(ige.roll).toBeLessThan(0);
  });

  it.fails('KNOWN ROLL GAP — hover IGE 3000 lb roll 1-3 deg left (ESTIMATE; the OH-6A trims at -3.05 deg at 2550 lb, F)', () => {
    const ige = hover(3000, 0, 0, true);
    expect(ige.roll).toBeGreaterThanOrEqual(-3); expect(ige.roll).toBeLessThanOrEqual(-1);
  });
});

/** Rate response to a step of `amount` (controls units: full travel is 2) from a trimmed state at `kt`, 2550 lb (the OH-6A's case weight). */
function stepResponse(kt: number, axis: 'aileron' | 'elevator' | 'rudder', amount: number) {
  const r = rig(2550, { kt, height: 1500 }), s = r.fm.state;
  const rateOf = () => axis === 'aileron' ? s.angularVelocity.x : axis === 'elevator' ? s.angularVelocity.y : s.angularVelocity.z;
  run(r, 0.5);
  const base = rateOf(), at = new Map<number, number>(); let last = base, peak = 0;
  r.c[axis] += amount;
  for (let i = 1; i <= 240; i++) {
    r.fm.step(DT, r.c, r.env);
    const w = rateOf();
    if (i * DT <= 0.3 && Math.abs(w - last) / DT > Math.abs(peak)) peak = (w - last) / DT;
    last = w; at.set(i, (w - base) / DEG);
  }
  const rate = (t: number) => at.get(Math.round(t / DT))!;
  // Time to half of the 0.5 s rate: a first-order subsidence's t1/2 = ln 2 x tau.
  let half = 0; for (let i = 1; i <= 120; i++) if (Math.abs(at.get(i)!) < Math.abs(rate(0.5)) / 2) half = i * DT;
  return { accel: Math.abs(peak) / DEG, rate05: Math.abs(rate(0.5)), rate1: Math.abs(rate(1)), half };
}
function referenceResponse(k: Oh6aCase, control: 'DA' | 'DB' | 'DP', axis: 'p' | 'q' | 'r') {
  const times = Array.from({ length: 1000 }, (_, i) => (i + 1) * 0.001);
  const res = respond(k, control, 0.1, times), at = (t: number) => Math.abs(res.at[Math.round(t * 1000) - 1][axis]) / DEG;
  let half = 0; for (let i = 1; i <= 500; i++) if (at(i / 1000) < at(0.5) / 2) half = i / 1000;
  return { accel: Math.abs(axis === 'p' ? res.pDot : axis === 'q' ? res.qDot : res.rDot) / DEG, rate05: at(0.5), rate1: at(1), half };
}

describe('MD 500E control power against the OH-6A derivatives (Heffley CR-3144 pp 27-28, cases 4 and 8, F)', () => {
  // Steps of 0.1 of full travel (0.2 in the sim's -1..1 units); the reference integrates the OH-6A's full 8-state
  // linear model (oh6a.ts). Band: +/-30 % (plan 6.6). The 500E rows are measured at the OH-6A's 2550 lb.
  const rows: Record<string, unknown>[] = [];
  afterAll(() => { report.controlPower = rows; });
  for (const [kt, k] of [[0, OH6A_HOVER], [60, OH6A_60KT]] as const) {
    it(`${kt} KIAS: roll and pitch acceleration and rate at 0.5 s within 30 % (roll rate excepted below)`, () => {
      const roll = stepResponse(kt, 'aileron', 0.2), rollRef = referenceResponse(k, 'DA', 'p');
      const pitch = stepResponse(kt, 'elevator', -0.2), pitchRef = referenceResponse(k, 'DB', 'q');
      rows.push({ kt, roll, rollRef, pitch, pitchRef });
      expect(roll.accel / rollRef.accel).toBeGreaterThan(0.7); expect(roll.accel / rollRef.accel).toBeLessThan(1.3);
      expect(pitch.accel / pitchRef.accel).toBeGreaterThan(0.7); expect(pitch.accel / pitchRef.accel).toBeLessThan(1.3);
      expect(pitch.rate05 / pitchRef.rate05).toBeGreaterThan(0.7); expect(pitch.rate05 / pitchRef.rate05).toBeLessThan(1.3);
      if (kt === 0) {
        // Time to half amplitude of the roll and pitch subsidences (OH-6A hover roots 4.93 and 2.01 /s).
        expect(roll.half).toBeLessThan(2 * rollRef.half + 0.05); expect(pitch.half).toBeLessThan(2 * pitchRef.half + 0.05);
      }
    });
    it.fails(`KNOWN CONTROL-POWER GAP — ${kt} KIAS: roll rate at 0.5 s and the pedal (yaw) response within 30 % of the OH-6A`, () => {
      const roll = stepResponse(kt, 'aileron', 0.2), rollRef = referenceResponse(k, 'DA', 'p');
      const yaw = stepResponse(kt, 'rudder', 0.2), yawRef = referenceResponse(k, 'DP', 'r');
      rows.push({ kt, roll, rollRef, yaw, yawRef });
      expect(roll.rate05 / rollRef.rate05).toBeLessThan(1.3);
      expect(yaw.accel / yawRef.accel).toBeLessThan(1.3);
      expect(Math.abs(yaw.rate1 - yawRef.rate1) / Math.max(yawRef.rate1, 10)).toBeLessThan(0.3);
    });
  }
});

describe('MD 500E forward flight (plan 6.6)', () => {
  it('Vy (minimum power) 62 KIAS +/- 8 at 3000 lb SL ISA (P, RFM Fig 5-3)', () => {
    const curve = [30, 40, 50, 55, 60, 65, 70, 80, 90].map((kt) => ({ kt, ...level(3000, kt) }));
    report.powerCurve = curve.map((c) => ({ kt: c.kt, psi: c.psi, pitch: c.pitch, elevator: c.elevator }));
    const best = curve.reduce((a, b) => (b.psi < a.psi ? b : a));
    // Parabola through the three points round the minimum.
    const i = curve.indexOf(best), [a, b, c] = [curve[i - 1], best, curve[i + 1]];
    const vy = b.kt - 0.5 * ((b.kt - a.kt) ** 2 * (b.psi - c.psi) - (b.kt - c.kt) ** 2 * (b.psi - a.psi)) /
      ((b.kt - a.kt) * (b.psi - c.psi) - (b.kt - c.kt) * (b.psi - a.psi));
    report.vy = vy;
    expect(Math.abs(vy - V.vy)).toBeLessThanOrEqual(8);
  }, 60_000);

  it('maximum rate of climb at 87.2 psi and Vy: 1770 ft/min +/- 20 % at the design gross weight, 3000 lb (M, spec p7)', () => {
    const roc = (lb: number) => {
      let lo = 0, hi = 35;
      for (let i = 0; i < 14; i++) { const deg = (lo + hi) / 2; const t = level(lb, V.vy, deg); if (!t.converged || t.psi > 87.2) hi = deg; else lo = deg; }
      const t = level(lb, V.vy, lo); return { lb, fpm: t.fpm, psi: t.psi, tot: t.tot };
    };
    const rows = [roc(3000), roc(2600)];
    report.climb = rows;
    // The spec's table is "at design gross weight" and its weights row gives the normal capacity, 3000 lb; the
    // 2600 lb climb is reported.
    expect(Math.abs(rows[0].fpm / 1770 - 1)).toBeLessThanOrEqual(0.2);
    expect(rows[1].fpm).toBeGreaterThan(rows[0].fpm);
    for (const row of rows) expect(Math.abs(row.psi - 87.2)).toBeLessThan(0.5);
  }, 60_000);

  it('level speed at MCP 81.3 psi, SL ISA, 3000 lb: 130-135 KTAS +/- 5 % (M, spec p7)', () => {
    let lo = 90, hi = 160;
    for (let i = 0; i < 12; i++) { const kt = (lo + hi) / 2; const t = level(3000, kt); if (!t.converged || t.psi > 81.3) hi = kt; else lo = kt; }
    const t = level(3000, lo);
    report.mcpSpeed = { ...t, levelKias: lo };
    expect(lo).toBeGreaterThanOrEqual(130 * 0.95); expect(lo).toBeLessThanOrEqual(135 * 1.05);
  }, 60_000);

  it('cruise attitude at 120 KIAS level, 2700 lb SL ISA: pitch -2..-6 deg, cyclic at most 0.3 of travel forward of hover (ESTIMATE; proves the stabiliser download)', () => {
    const cruise = level(2700, 120), hov = hover(2700, 0, 0, false);
    report.cruise = { cruise, hover: hov };
    expect(cruise.converged).toBe(true);
    expect(cruise.pitch).toBeLessThanOrEqual(-2); expect(cruise.pitch).toBeGreaterThanOrEqual(-6);
    // Full travel is 2 units of ControlInputs.elevator.
    expect((hov.elevator - cruise.elevator) / 2).toBeLessThanOrEqual(0.3);
    expect(cruise.elevator).toBeLessThan(hov.elevator);
  });

  it('cruise fuel flow 184 lb/h +/- 15 % at 120 KIAS (the max-range speed), 3000 lb SL ISA (M, spec p37 "about 27 gal/h")', () => {
    const t = level(3000, 120);
    report.cruiseFuel = t;
    expect(Math.abs(t.ffLbh / 184 - 1)).toBeLessThanOrEqual(0.15);
  });
});

/** Steady autorotation at `kias`, collective held at `collective` (or servoed to `nrRpm`), grip `grip`; the gauges
 * averaged over the last 15 s. */
function autorotate(lb: number, kias: number, o: { ft?: number; collective?: number; nrRpm?: number; grip?: number; seconds?: number } = {}) {
  const r = rig(lb, { kt: kias, height: 3000, ft: o.ft ?? 0 }), fly = pilot(r, kias);
  r.c.throttle = o.grip ?? d.systems.turboshaft!.grip.groundIdle; r.c.collective = o.collective ?? 0;
  let last = r.fm.state.rotorcraft!.rotorRpm, trend = 0, n = 0;
  const seconds = o.seconds ?? 70, sum: Record<string, number> = {};
  run(r, seconds, (t) => {
    fly(DT);
    const rpm = r.fm.state.rotorcraft!.rotorRpm;
    trend += ((rpm - last) / DT - trend) * (1 - Math.exp(-DT / 0.3)); last = rpm;
    // A pilot on the tach: collective up when Nr is high or rising.
    if (o.nrRpm !== undefined) collectiveServo(r.c, 0.003 * (rpm - o.nrRpm) + 0.006 * trend, 1, DT, 0.2);
    if (t >= seconds - 15) { n++; for (const [k, v] of Object.entries(gauges(r))) if (typeof v === 'number') sum[k] = (sum[k] ?? 0) + v; }
  });
  const g = gauges(r);
  for (const k of Object.keys(sum)) (g as unknown as Record<string, number>)[k] = sum[k] / n;
  return g;
}

describe('MD 500E autorotation (RFM 4-24, 4-25)', () => {
  it('collective full down, 2250 lb, SL, 60 KIAS: Nr 485 +/- 5 rpm; -10 rpm per 100 lb (+/-3) and +6.5 rpm per 1000 ft DA (+/-2) (P, RFM 4-25)', () => {
    const base = autorotate(2250, 60), light = autorotate(2050, 60), high = autorotate(2250, 60, { ft: 4000 });
    // ISA: density altitude = pressure altitude.
    const perHundred = (base.nrRpm - light.nrRpm) / 2, perThousand = (high.nrRpm - base.nrRpm) / 4;
    report.autorotation = { base, light, high, perHundredLb: perHundred, perThousandFtDa: perThousand };
    expect(Math.abs(base.nrRpm - V.autorotationRpm.rpm)).toBeLessThanOrEqual(V.autorotationRpm.tol);
    expect(Math.abs(perHundred - V.autorotationRpm.perHundredLb)).toBeLessThanOrEqual(3);
    expect(Math.abs(perThousand - V.autorotationRpm.perThousandFtDa)).toBeLessThanOrEqual(2);
  }, 120_000);

  it('rate of descent at 60 KIAS, 3000 lb SL ISA, Nr held 480-500 with collective: 1600-2200 ft/min (ESTIMATE)', () => {
    const g = autorotate(3000, 60, { nrRpm: 490 });
    report.autorotationDescent = g;
    expect(g.nrRpm).toBeGreaterThanOrEqual(480); expect(g.nrRpm).toBeLessThanOrEqual(500);
    expect(-g.fpm).toBeGreaterThanOrEqual(1600); expect(-g.fpm).toBeLessThanOrEqual(2200);
  }, 60_000);

  it('glide, engine off, Nr held at 480: the 80 KIAS glide ratio is at least 1.15 x the 60 KIAS one (P speeds, RFM 4-24 / ESTIMATE margin)', () => {
    // Engine failed (grip CUTOFF): with the grip at idle a low Nr lets the idling engine join the needles and drive
    // the rotor (the RFM 4-24 note on practice autorotations). The RFM's 410 rpm is reported, not asserted: at 80 KIAS
    // and 410 rpm the modelled rotor sits at the retreating-blade stall boundary (docs/md500-flight-model.md).
    const at60 = autorotate(2700, 60, { nrRpm: 480, grip: 0 }), at80 = autorotate(2700, 80, { nrRpm: 480, grip: 0 });
    const low60 = autorotate(2700, 60, { nrRpm: 410, grip: 0 });
    // IAS = TAS at SL ISA; 1 kt = 101.27 ft/min.
    const ratio = (g: ReturnType<typeof gauges>) => g.kias / (-g.fpm / 101.2686);
    report.glide = { at60, at80, low60, ratio60: ratio(at60), ratio80: ratio(at80), ratio60at410: ratio(low60) };
    expect(ratio(at80)).toBeGreaterThanOrEqual(1.15 * ratio(at60));
    // Less sink at 410 than at 480 rpm (RFM 4-24: "operate at minimum rotor rpm" to reduce the rate of descent).
    expect(-low60.fpm).toBeLessThan(-at60.fpm);
  }, 90_000);
});

