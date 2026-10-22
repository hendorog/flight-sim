// Bo 105 CB-4 (BO, plan revision 2 section 6.2): performance on the REAL definition. Every row compares a measured
// number in pilot units with the plan's target and its tag: F = CB-5 FM performance (Type 2 blades, optimistic for the
// CB-4), S = Jane's, P5 = CB-5 FM used for the CB-4, D = derived, ESTIMATE = no source. Torque is per engine in % of
// 298 kW (synchronised, the two engines equal). BO105_TRACE=<dir> writes bo105Performance.json.
import { afterAll, describe, expect, it } from 'vitest';
import { FT, clamp } from '../../src/core/math';
import { BO105_REFERENCE as V } from '../../src/aircraft/bo105/reference';
import { DT, d, gauges, lever, LEVER, pilot, rig, run, writeTrace, type Gauges } from './bo105Rig';

const report: Record<string, unknown> = {};
afterAll(() => writeTrace('bo105Performance', report));
/** IGE: the skid soles 3 ft above the ground (P5 FM Fig 5-8). */
const IGE = d.skids.z + 3 * FT;

/** Trimmed hover (reset solves it with both engines steady): torque, TOT, N1 per engine and the collective. */
function hover(kg: number, ft: number, ige: boolean) {
  const r = rig(kg, { ft, height: ige ? IGE : 150 }), g = gauges(r);
  return { converged: r.fm.lastTrim?.converged === true, tq: Math.max(...g.tq), tot: Math.max(...g.tot), n1: Math.max(...g.n1),
    collective: g.collective, nr: g.nr };
}
/** Hover ceiling at take-off power: 86 % torque per engine, TOT 810 C, the 105 % N1 stop, collective full up or NR below
 *  99.5 %, whichever comes first (ISA, 100 % N2). */
function ceiling(kg: number, ige: boolean): number {
  const limited = (h: ReturnType<typeof hover>) => !h.converged || h.tq > 86 || h.tot > 810 || h.n1 >= 104.95 || h.collective >= 0.999 || h.nr < 99.5;
  let lo = 0, hi = 20000;
  for (let i = 0; i < 11; i++) { const ft = (lo + hi) / 2; if (limited(hover(kg, ft, ige))) hi = ft; else lo = ft; }
  return (lo + hi) / 2;
}
/** Level (or `pathDeg`) trim at `kt` TAS, SL ISA unless `ft`. */
function level(kg: number, kt: number, pathDeg = 0, o: { enginesRunning?: boolean[]; ft?: number } = {}) {
  const r = rig(kg, { kt, pathDeg, ...o });
  return { converged: r.fm.lastTrim?.converged === true, ...gauges(r) };
}
/** Steepest climb at `kt` with the running engine(s) at `pct` torque: the flight-path angle by bisection. */
function climb(kg: number, kt: number, pct: number, o: { enginesRunning?: boolean[] } = {}) {
  const engine = o.enginesRunning ? o.enginesRunning.indexOf(true) : 0;
  let lo = -15, hi = 35;
  for (let i = 0; i < 16; i++) {
    const deg = (lo + hi) / 2, t = level(kg, kt, deg, o);
    if (!t.converged || t.tq[engine] > pct || t.nr < 99) hi = deg; else lo = deg;
  }
  const t = level(kg, kt, lo, o);
  return { kg, kt, fpm: t.fpm, tq: t.tq[engine], tot: t.tot[engine], n1: t.n1[engine], pathDeg: lo };
}

describe('hover (ceilings derived for the CB-4 from the CB-5 FM, F/ESTIMATE; plan 6.2)', () => {
  it('hover ceilings at 2500 kg, ISA, take-off power: HOGE 3,850 ft and HIGE 6,200 ft +/-1,500 (CB-5 F 5,550 / 7,900 less 1,700 ft, ESTIMATE); HIGE at 2300 kg 8,900 ft +/-1,500 (S Jane\'s CBS-4)', () => {
    const rows = { hoge2500: { model: ceiling(2500, false), target: V.hoge2500Ft }, hige2500: { model: ceiling(2500, true), target: V.hige2500Ft },
      hige2300: { model: ceiling(2300, true), target: V.hige2300Ft } };
    report.ceilings = rows;
    for (const [k, row] of Object.entries(rows)) expect(Math.abs(row.model - row.target), k).toBeLessThanOrEqual(1500);
  }, 120_000);
  it('hover torque per engine, SL ISA (D from the ceiling row): 2500 kg OGE 79-83 %, IGE 72-78 %; 2200 kg OGE 67-74 %, IGE 61-69 %', () => {
    const rows = { oge2500: hover(2500, 0, false), ige2500: hover(2500, 0, true), oge2200: hover(2200, 0, false), ige2200: hover(2200, 0, true) };
    report.hoverTorque = rows;
    const band = { oge2500: [79, 83], ige2500: [72, 78], oge2200: [67, 74], ige2200: [61, 69] } as const;
    for (const [k, [lo, hi]] of Object.entries(band)) {
      const h = rows[k as keyof typeof rows];
      expect(h.converged, k).toBe(true);
      expect(h.tq, k).toBeGreaterThanOrEqual(lo); expect(h.tq, k).toBeLessThanOrEqual(hi);
    }
  });
  it('OEI hover (D): at 2200 kg OGE one engine cannot hover (it would need 2 x the AEO torque, above 95 %); at 1400 kg one engine holds an IGE hover at <= 95 %', () => {
    const oge = hover(2200, 0, false);
    const r = rig(1400, { height: IGE, enginesRunning: [true, false] });
    run(r, 20);
    const g = gauges(r);
    report.oeiHover = { aeoPerEngine2200: oge.tq, oneEngineNeeds2200: 2 * oge.tq, survivor1400: { tq: g.tq[0], nr: g.nr, fpm: g.fpm,
      height: -r.fm.state.position.z } };
    expect(2 * oge.tq).toBeGreaterThan(95);
    expect(g.tq[0]).toBeLessThanOrEqual(95);
    expect(g.nr).toBeGreaterThanOrEqual(97);
    expect(Math.abs(g.fpm)).toBeLessThan(50);
  }, 30_000);
  /** Engine 2 fails in a 3 ft IGE hover at 2200 kg; the collective held, then raised 0.05 of its travel in the last 0.25 m. */
  function oeiIge() {
    const r = rig(2200, { height: IGE });
    run(r, 1);
    lever(r.c, 1, LEVER.off);
    const c0 = r.c.collective ?? 0;
    let touch = -1, sink = 0, tqMax = 0, nrMin = Infinity;
    run(r, 5, (t) => {
      const g = gauges(r);
      tqMax = Math.max(tqMax, g.tq[0]); nrMin = Math.min(nrMin, g.nr);
      const height = -r.fm.state.position.z - d.skids.z;
      r.c.collective = Math.min(1, c0 + (height < 0.25 ? 0.05 * Math.min(1, (0.25 - height) / 0.1) : 0));
      if (touch < 0 && r.fm.state.onGround) { touch = t; sink = r.fm.state.verticalSpeed; }
    });
    return { touchdownS: touch, sinkMs: -sink, survivorTqMax: tqMax, nrMin, crashed: r.fm.state.crashed };
  }
  it('OEI in a 3 ft IGE hover at 2200 kg, collective raised to cushion: on the skids within 3 s at <= 2 m/s (ESTIMATE)', () => {
    const o = oeiIge();
    report.oeiIge = o;
    expect(o.touchdownS).toBeGreaterThan(0); expect(o.touchdownS).toBeLessThanOrEqual(3);
    expect(o.sinkMs).toBeLessThanOrEqual(2);
    expect(o.crashed).toBe(false);
  }, 30_000);
  /**
   * KNOWN OEI-TORQUE GAP (ESTIMATE bound): with the survivor at its N1 stop the torque gauge follows the 250-C20B's
   * power-turbine law (torque = T100 x (3 - 2 N2), md500/powerplant.ts), so as the cushion pulls NR down to about 91 % the
   * survivor reads about 114 %. The plan's "<= 105 %" holds only while NR stays above about 95 % (docs/twin-turboshaft.md
   * section 7 has the same arithmetic).
   */
  it.fails('KNOWN OEI-TORQUE GAP — the survivor stays at or below 105 % torque through the OEI IGE cushion', () => {
    const o = oeiIge();
    expect(o.survivorTqMax, `survivor ${o.survivorTqMax} % at NR down to ${o.nrMin} %`).toBeLessThanOrEqual(105);
  }, 30_000);
});

describe('forward flight (plan 6.2)', () => {
  it('Vy (minimum power) 60 KIAS +/- 8 kt at 2200 kg SL ISA (P5 FM 3-21, Fig 5-14)', () => {
    const curve = [30, 40, 50, 55, 60, 65, 70, 80, 90].map((kt) => ({ kt, ...level(2200, kt) }));
    report.powerCurve = curve.map((c) => ({ kt: c.kt, tq: c.tq[0], pitch: c.pitch, elevator: c.elevator }));
    const best = curve.reduce((a, b) => (b.tq[0] < a.tq[0] ? b : a));
    const i = curve.indexOf(best), [a, b, c] = [curve[i - 1], best, curve[i + 1]];
    const vy = b.kt - 0.5 * ((b.kt - a.kt) ** 2 * (b.tq[0] - c.tq[0]) - (b.kt - c.kt) ** 2 * (b.tq[0] - a.tq[0])) /
      ((b.kt - a.kt) * (b.tq[0] - c.tq[0]) - (b.kt - c.kt) * (b.tq[0] - a.tq[0]));
    report.vy = vy;
    expect(Math.abs(vy - V.vy)).toBeLessThanOrEqual(8);
  }, 60_000);
  /**
   * KNOWN CLIMB GAP: the AEO climb comes out about a third above the band (2200 kg about 2,100 ft/min, 2500 kg about
   * 1,640) while the OEI climb, the hover torque, Vy and the cruise speed sit inside theirs. The power required at 60 KIAS
   * (about 42 % per engine at 2200 kg) is about 18 % below what the CB-5 chart's AEO climb implies, and no listed knob moves
   * it without moving the hover torque (docs/bo105-flight-model.md "Climb").
   */
  it.fails('KNOWN CLIMB GAP — climb AEO at take-off power (2 x 86 %), 60 KIAS SL ISA: 2200 kg 1,575 ft/min +/-20 % (S Jane\'s CB); 2500 kg 1,150-1,400 (ESTIMATE; CB-5 F 1,380 the upper bound)', () => {
    const rows = [climb(2200, 60, 86), climb(2500, 60, 86)];
    report.climbAeo = rows;
    const ok = Math.abs(rows[0].fpm / V.rocAeo2200Fpm - 1) <= 0.2 && rows[1].fpm >= 1150 && rows[1].fpm <= 1400;
    expect(ok, `2200 kg ${rows[0].fpm.toFixed(0)}, 2500 kg ${rows[1].fpm.toFixed(0)} ft/min`).toBe(true);
  }, 120_000);
  it('climb OEI at 95 %, 60 KIAS SL ISA: 2500 kg -100..+250 ft/min, 2200 kg +300..+650 (ESTIMATE from CB-5 F +250 / +650)', () => {
    const rows = [climb(2500, 60, 95, { enginesRunning: [true, false] }), climb(2200, 60, 95, { enginesRunning: [true, false] })];
    report.climbOei = rows;
    expect(rows[0].fpm).toBeGreaterThanOrEqual(-100); expect(rows[0].fpm).toBeLessThanOrEqual(250);
    expect(rows[1].fpm).toBeGreaterThanOrEqual(300); expect(rows[1].fpm).toBeLessThanOrEqual(650);
  }, 120_000);
  it('maximum cruise at MCP (2 x 86 % or 779 C), SL ISA, 2500 kg: 125-135 KTAS (S Jane\'s 131 / F)', () => {
    let lo = 90, hi = 160;
    for (let i = 0; i < 12; i++) {
      const kt = (lo + hi) / 2, t = level(2500, kt);
      if (!t.converged || t.tq[0] > 86 || t.tot[0] > 779) hi = kt; else lo = kt;
    }
    const t = level(2500, lo);
    report.maxCruise = { ktas: lo, tq: t.tq[0], tot: t.tot[0], pitch: t.pitch };
    expect(lo).toBeGreaterThanOrEqual(125); expect(lo).toBeLessThanOrEqual(135);
  }, 60_000);
  it('fuel flow at 90 KCAS, SL ISA, 2500 kg: 143 kg/h +/-15 % (D from the CB-5 FM range example: 286 NM / 90 kt on 456 kg, F)', () => {
    const t = level(2500, 90);
    report.fuel90 = { kgPerHour: t.fuelKgH, tq: t.tq[0] };
    expect(Math.abs(t.fuelKgH / V.fuelFlow90KcasKgH - 1)).toBeLessThanOrEqual(0.15);
  });
});

/**
 * Autorotation at `kias`, SL ISA, both power levers OFF (both engines failed), the collective held at `collective` (or
 * servoed to `nrPct`), the test pilot holding speed and heading; the gauges averaged over the last 10 s of `seconds`.
 */
function autorotate(kg: number, kias: number, o: { collective?: number; nrPct?: number; seconds?: number } = {}) {
  const r = rig(kg, { kt: kias, height: 3000 }), fly = pilot(r, kias);
  lever(r.c, 0, LEVER.off); lever(r.c, 1, LEVER.off);
  r.c.collective = o.collective ?? 0;
  const seconds = o.seconds ?? 50, sum: Record<string, number> = {};
  let integral = 0, n = 0;
  run(r, seconds, (t) => {
    fly(DT);
    // A pilot on the tach: collective up when NR is high (proportional and integral on the NR %).
    if (o.nrPct !== undefined) {
      const error = gauges(r).nr - o.nrPct;
      integral += error * DT;
      r.c.collective = clamp(0.01 * error + 0.004 * integral, 0, 1);
    }
    if (t >= seconds - 10) { n++; for (const [k, v] of Object.entries(gauges(r))) if (typeof v === 'number') sum[k] = (sum[k] ?? 0) + v; }
  });
  const g = gauges(r) as Gauges & Record<string, number>;
  for (const k of Object.keys(sum)) (g as Record<string, number>)[k] = sum[k] / n;
  return g;
}

const descent: { at60?: number } = {};
describe('autorotation (P5 FM 3-34..3-37; the NR law is the repo\'s sqrt(W), ESTIMATE; minPitch is the knob)', () => {
  it('collective full down, 75 KIAS, SL ISA: NR 104-110 % at 2200 kg; 83-88 % at 1400 kg; 111-117 % at 2500 kg', () => {
    const rows = { kg2200: autorotate(2200, 75), kg1400: autorotate(1400, 75), kg2500: autorotate(2500, 75) };
    report.autorotationNr = Object.fromEntries(Object.entries(rows).map(([k, g]) => [k, { nr: g.nr, fpm: g.fpm, kias: g.kias }]));
    const band = { kg2200: [104, 110], kg1400: [83, 88], kg2500: [111, 117] } as const;
    for (const [k, [lo, hi]] of Object.entries(band)) {
      const g = rows[k as keyof typeof rows];
      expect(g.nr, k).toBeGreaterThanOrEqual(lo); expect(g.nr, k).toBeLessThanOrEqual(hi);
    }
  }, 120_000);
  /**
   * KNOWN COLLECTIVE-RANGE GAP (ESTIMATE band): 100 % NR at 2500 kg / 75 KIAS takes about 0.08 of the collective's travel,
   * not 0.15-0.35: the travel (19.2 deg of blade pitch) is the Z_col fit to AR-280 per % of full travel and the low
   * stop is the 2200 kg NR-law fit, so 1.6 deg above the stop is a small fraction of it (docs/bo105-flight-model.md).
   */
  it.fails('KNOWN COLLECTIVE-RANGE GAP — 100 % NR at 2500 kg / 75 KIAS takes 0.15-0.35 of the collective travel', () => {
    const heavy = autorotate(2500, 75, { nrPct: 100, seconds: 60 });
    report.autorotationHeavy = { nr: heavy.nr, collective: heavy.collective, fpm: heavy.fpm };
    expect(Math.abs(heavy.nr - 100) < 1 && heavy.collective >= 0.15 && heavy.collective <= 0.35, `collective ${heavy.collective}`).toBe(true);
  }, 120_000);
  it('pilot row: at 1400 kg / 60 KIAS the collective full down holds NR >= 85 % (the pilot slows rather than raise the collective)', () => {
    const light = autorotate(1400, 60);
    report.autorotationLight = { nr: light.nr, fpm: light.fpm };
    expect(light.nr).toBeGreaterThanOrEqual(85);
  }, 120_000);
  it('descent with NR held at 100 % by the collective, 2200 kg: 60 KIAS 1,800-2,400 ft/min, 75 KIAS 2,000-2,600 ft/min; 100 KIAS at 85 % NR descends faster than 60 KIAS (ESTIMATE / P5 order: minimum descent 60, maximum glide 100 KIAS)', () => {
    const at60 = autorotate(2200, 60, { nrPct: 100, seconds: 60 }), at75 = autorotate(2200, 75, { nrPct: 100, seconds: 60 });
    const fast = autorotate(2200, 100, { nrPct: 85, seconds: 60 });
    descent.at60 = at60.fpm;
    report.autorotationDescent = { at60: { fpm: at60.fpm, nr: at60.nr }, at75: { fpm: at75.fpm, nr: at75.nr }, fast100at85: { fpm: fast.fpm, nr: fast.nr },
      glideRatio60: 60 / (-at60.fpm / 101.27), glideRatio100: 100 / (-fast.fpm / 101.27) };
    expect(Math.abs(at60.nr - 100)).toBeLessThan(1); expect(Math.abs(at75.nr - 100)).toBeLessThan(1);
    expect(-at60.fpm).toBeGreaterThanOrEqual(1800); expect(-at60.fpm).toBeLessThanOrEqual(2400);
    expect(-at75.fpm).toBeGreaterThanOrEqual(2000); expect(-at75.fpm).toBeLessThanOrEqual(2600);
    expect(-fast.fpm).toBeGreaterThan(-at60.fpm);
  }, 180_000);
  /**
   * KNOWN WEIGHT-EFFECT GAP (ESTIMATE, plan 6.2 "2500 kg +8 %", D from sqrt(disc loading)): with NR held at 100 % the
   * 2500 kg descent at 60 KIAS is within about 1 % of the 2200 kg one. At 60 KIAS the rotor's profile and the airframe's
   * drag, which do not grow with weight, make most of the power in the descent, so the sink barely grows with weight here.
   */
  it.fails('KNOWN WEIGHT-EFFECT GAP — the 2500 kg autorotative descent at 60 KIAS (NR 100 %) is 3-15 % above the 2200 kg one', () => {
    const heavy = autorotate(2500, 60, { nrPct: 100, seconds: 60 });
    const light = descent.at60 ?? autorotate(2200, 60, { nrPct: 100, seconds: 60 }).fpm;
    report.autorotationWeight = { fpm2500: heavy.fpm, fpm2200: light, ratio: heavy.fpm / light };
    expect(heavy.fpm / light >= 1.03 && heavy.fpm / light <= 1.15, `ratio ${heavy.fpm / light}`).toBe(true);
  }, 120_000);
});
