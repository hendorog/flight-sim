// AH-56A handling with the control gyro (AG, plan revision 2 section 7.2: G5-G9). The responses are AMCS-73 para 33's
// definitions: control response = the maximum rate per inch of stick, sensitivity = the maximum angular acceleration
// per inch; ASTA-72's pitch time constant = the time to 63 % of the maximum rate. The maximum rate is the FIRST PEAK of
// the held step (ah56Rig.firstPeak: no later sample exceeds it for 0.5 s): after it the attitude change carries the
// aircraft into another condition (the hover pitch rate creeps up past 30 deg of pitch). A row whose rate is still rising
// when the window closes (peaked false) is not a maximum and fails. Each row logs the measured number next
// to its target ([ah56] lines) and AH56_TRACE=<dir> writes the report. AMCS is the default configuration (AGENT).
import { afterAll, describe, expect, it } from 'vitest';
import { DEG, KT } from '../../src/core/math';
import { stepCentre, stepKeyAxis } from '../../src/input/virtualYoke';
import { AH56_INPUT } from '../../src/aircraft/ah56/input';
import { AH56_REST_CONTACTS } from '../../src/aircraft/ah56/gear';
import { hingelessBlade, hingelessSpring } from '../../src/physics/rotorcraft/hingeless';
import { d, gyroDef, margins, report, rig, rotorOf, run, stepResponse, stick, writeTrace, type StepResponse } from './ah56Rig';

const trace: Record<string, unknown> = {};
afterAll(() => writeTrace('ah56Handling', trace));
const r2 = (x: number) => +x.toFixed(2);
const summary = (s: StepResponse) => ({ max: r2(s.max), tMax: r2(s.tMax), peaked: s.peaked, window: s.window, offAtMax: r2(s.offAtMax),
  maxAcc: r2(s.maxAcc), at1: r2(s.at1), offAt1: r2(s.offAt1), tau63: +s.tau63.toFixed(3) });
const within = (x: number, target: number, tol: number) => x >= target * (1 - tol) && x <= target * (1 + tol);

describe('G5: AMCS control response and sensitivity (P AMCS-73 paras 33-34; Hoh-74 sect. 6.1)', () => {
  const rows: Record<string, ReturnType<typeof summary>> = {};
  for (const kt of [0, 100, 150]) for (const axis of ['lon', 'lat'] as const) {
    rows[`${axis}${kt}`] = summary(stepResponse(rig({ cfg: 'amcs', kt }), axis, 1, 3));
  }
  trace.G5 = rows;

  it('pitch (P AMCS-73 para 33): about 6 deg/s/in hover to 150 KCAS, sensitivity 9 deg/s^2/in, +/-30 %; every rate a first peak', () => {
    report('G5 AMCS pitch', { hoverDegPerSecPerIn: rows.lon0.max, hoverPeakS: rows.lon0.tMax, at100: rows.lon100.max, at100PeakS: rows.lon100.tMax,
      at150: rows.lon150.max, at150PeakS: rows.lon150.tMax, target6: '4.2-7.8', hoverMargin: margins(rows.lon0.max, 4.2, 7.8),
      at150Margin: margins(rows.lon150.max, 4.2, 7.8), hoverSensitivity: rows.lon0.maxAcc, at100Sensitivity: rows.lon100.maxAcc,
      target9: '6.3-11.7', sensitivityMargin: margins(rows.lon0.maxAcc, 6.3, 11.7) });
    for (const k of ['lon0', 'lon100', 'lon150']) { expect(rows[k].peaked).toBe(true); expect(rows[k].tMax).toBeLessThan(rows[k].window); }
    expect(within(rows.lon0.max, 6, 0.3)).toBe(true);
    expect(within(rows.lon100.max, 6, 0.3)).toBe(true);
    expect(within(rows.lon150.max, 6, 0.3)).toBe(true);
    expect(within(rows.lon0.maxAcc, 9, 0.3)).toBe(true);
    expect(within(rows.lon100.maxAcc, 9, 0.3)).toBe(true);
  });

  it.fails('G5 KNOWN GAP: Hohenemser\'s 9 deg/s/in at the hover (+/-30 %: >= 6.3) together with the 9 deg/s^2/in sensitivity', () => {
    // The hover's first-peak pitch rate is 6.08 deg/s/in (at 0.96 s), inside AMCS-73's "6, about constant" (P, tested at
    // 0 KCAS) but 3.5 % under Hoh-74's 9 - 30 %. No refit reaches both edges: the sensitivity per unit response is 1.91 /s at
    // every K_R from 6 to 7.5 kN m/rad (the band needs <= 11.7 / 6.3 = 1.86 /s), and from K_R 8 up the hover rate has no
    // first peak inside 3 s (docs/control-gyro-model.md section 6, the grid).
    expect(within(rows.lon0.max, 9, 0.3)).toBe(true);
    expect(within(rows.lon0.maxAcc, 9, 0.3)).toBe(true);
  });

  it('roll: 13-16 deg/s/in about constant; sensitivity 60 deg/s^2/in at the hover, 53 at 180 KCAS, +/-30 %', () => {
    report('G5 AMCS roll', { hover: rows.lat0.max, at100: rows.lat100.max, at150: rows.lat150.max, peakS: `${rows.lat0.tMax}/${rows.lat100.tMax}/${rows.lat150.tMax}`,
      target: '13-16 (+/-30 %: 9.1-20.8)', hoverMargin: margins(rows.lat0.max, 9.1, 20.8), hoverSensitivity: rows.lat0.maxAcc, target60: '42-78',
      hoverSensitivityMargin: margins(rows.lat0.maxAcc, 42, 78), at150Sensitivity: rows.lat150.maxAcc, target53: '37-69',
      at150SensitivityMargin: margins(rows.lat150.maxAcc, 37.1, 68.9) });
    for (const k of ['lat0', 'lat100', 'lat150']) {
      expect(rows[k].peaked).toBe(true);
      expect(rows[k].max).toBeGreaterThan(13 * 0.7); expect(rows[k].max).toBeLessThan(16 * 1.3);
    }
    expect(within(rows.lat0.maxAcc, 60, 0.3)).toBe(true);
    expect(within(rows.lat150.maxAcc, 53, 0.3)).toBe(true);
  });
});

describe('G6: AMCS attitude retention, no SAS (P Hoh-74: "no SAS was used")', () => {
  it('stick back to trim after a 10 deg bank disturbance at 80 KCAS, no SAS: the bank holds within 2 deg for 10 s', () => {
    // "No SAS was used" (Hoh-74): the AMCS's sideslip SAS and trim augmentor off. With the SAS on, the sideslip of the
    // uncoordinated turn (pedals fixed) rolls the aircraft level, as a SAS on sideslip should (logged below).
    const g = gyroDef.configs.amcs, saved = g.augmentation;
    (g as { augmentation?: typeof saved }).augmentation = undefined;
    const r = rig({ cfg: 'amcs', kt: 80 });
    const a0 = r.c.aileron;
    r.c.aileron = a0 + stick(r, 'lat', 1);
    let t = 0;
    while (r.fm.state.roll < 10 * DEG && t < 3) { run(r, 1 / 240); t += 1 / 240; }
    r.c.aileron = a0;
    run(r, 0.5);
    const bank0 = r.fm.state.roll;
    let worst = 0;
    run(r, 10, () => { worst = Math.max(worst, Math.abs(r.fm.state.roll - bank0)); });
    (g as { augmentation?: typeof saved }).augmentation = saved;
    report('G6 AMCS bank hold 80 KCAS (no SAS)', { bankDeg: bank0 / DEG, worstChangeDeg: worst / DEG, target: '<= 2', kias: r.fm.state.ias / KT });
    trace.G6 = { bankDeg: r2(bank0 / DEG), worstChangeDeg: r2(worst / DEG) };
    expect(bank0 / DEG).toBeGreaterThan(8);
    expect(worst / DEG).toBeLessThanOrEqual(2);
  });

  it('keyboard: a 0.3 s cyclic tap then hands off (the re-centring cyclic): the bank changes no more than 3 deg in the next 10 s', () => {
    const r = rig({ cfg: 'amcs', kt: 80 });
    const a0 = r.c.aileron, tuning = AH56_INPUT.assists.axes.aileron;
    let kb = 0, t = 0;
    run(r, 0.3, () => { t += 1 / 240; kb = stepKeyAxis(kb, 1, r.fm.state.ias, 1 / 240, tuning, t); r.c.aileron = a0 + kb; });
    run(r, 0.5, () => { kb = stepCentre(kb, 1 / 240); r.c.aileron = a0 + kb; });
    const bank0 = r.fm.state.roll;
    let worst = 0;
    run(r, 10, () => { worst = Math.max(worst, Math.abs(r.fm.state.roll - bank0)); });
    report('G6 AMCS keyboard tap', { peakKeyStick: kb, bankAfterTapDeg: bank0 / DEG, worstChangeDeg: worst / DEG, target: '<= 3' });
    trace.G6keyboard = { bankAfterTapDeg: r2(bank0 / DEG), worstChangeDeg: r2(worst / DEG) };
    expect(worst / DEG).toBeLessThanOrEqual(3);
  });
});

describe('G6 variant: what the AMCS holds against a STEADY disturbance moment (AG; informational, no plan band)', () => {
  it('a steady 625 N m roll moment (the hover in-plane force\'s, KNOWN_ISSUES #2): the bank precesses at about K_R beta / H, it is not held', () => {
    // The AMCS feedback is K_R x first-harmonic flap, which nulls the HUB moment, not the attitude error: a steady external
    // moment M needs a steady hub moment -M, i.e. a flap beta = M / K_hub, and K_R beta precesses the gyro (and the aircraft
    // following it) at K_R beta / H. So the G6 attitude retention holds only with zero residual moment (G6's disturbance is
    // a stick-induced bank, which leaves none). Recorded at the hover and at G6's 80 KCAS (sideslip SAS and weathercock on).
    const g = gyroDef.configs.amcs, fb = g.feedback;
    if (fb.mode !== 'flapping') throw new Error('AMCS flapping feedback expected');
    // K_hub = (B/2)(e M_beta Omega^2 + K_beta) at the AMCS's governed 97.5 % (ah56GyroModes G2 (i)), H = I_g x spin.
    const omega = d.nominalRpm * Math.PI / 30 * g.nominalRpmFraction, hub = d.hubModel;
    if (hub?.kind !== 'hingeless') throw new Error('hingeless hub expected');
    const kHub = d.main.blades / 2 * (hub.equivalentHingeOffset * hingelessBlade(d).flapFirst * omega ** 2 + hingelessSpring(d));
    const h = g.inertia * g.spinRatio * omega;
    const out: Record<string, number> = {};
    for (const kt of [0, 80]) {
      const r = rig({ cfg: 'amcs', kt }), rotor = rotorOf(r), orig = rotor.compute.bind(rotor);
      (rotor as unknown as { compute: typeof orig }).compute = (...a: Parameters<typeof orig>) => { const f = orig(...a); f.moment.x += 625; return f; };
      const roll0 = r.fm.state.roll;
      let rollAt2 = 0, rollAt3 = 0, rollAt10 = 0, t = 0;
      run(r, 20, () => {
        t += 1 / 240;
        if (Math.abs(t - 2) < 1 / 480) rollAt2 = r.fm.state.roll;
        if (Math.abs(t - 3) < 1 / 480) rollAt3 = r.fm.state.roll;
        if (Math.abs(t - 10) < 1 / 480) rollAt10 = r.fm.state.roll;
      });
      out[`kt${kt}Rate2to3DegPerSec`] = (rollAt3 - rollAt2) / DEG;
      out[`kt${kt}BankChange10sDeg`] = (rollAt10 - roll0) / DEG;
      out[`kt${kt}BankChange20sDeg`] = (r.fm.state.roll - roll0) / DEG;
      out[`kt${kt}RollRate20sDegPerSec`] = r.fm.state.angularVelocity.x / DEG;
    }
    const predicted = fb.gain * (625 / kHub) / h / DEG;
    report('G6 variant: steady 625 N m roll moment, AMCS', { ...out, kHubKNmPerRad: kHub / 1e3, predictedDegPerSec: predicted, perKNm: out.kt0Rate2to3DegPerSec / 0.625 });
    trace.G6steadyMoment = { ...out, predictedDegPerSec: predicted };
    // Self-consistency only: the early precession is of the K_R beta / H order (the attitude change and the translation
    // follow). Not an attitude-hold pass.
    expect(out.kt0Rate2to3DegPerSec / predicted).toBeGreaterThan(0.5);
    expect(out.kt0Rate2to3DegPerSec / predicted).toBeLessThan(1.5);
  });
});

describe('G7 / G7a: ICS response (D: tau = Lambda I / H, formula checked on the XH-51A; P ASTA-72 paras 59-60)', () => {
  const ics: Record<string, ReturnType<typeof summary>> = {};
  for (const kt of [0, 150]) for (const axis of ['lon', 'lat'] as const) ics[`${axis}${kt}`] = summary(stepResponse(rig({ cfg: 'ics', kt }), axis, 1, 4));
  trace.G7 = ics;

  it('roll: initial acceleration about 34 deg/s^2/in (+/-40 %)', () => {
    report('G7 ICS roll', { tau63Hover: ics.lat0.tau63, target: '0.3-0.7', tauMargin: margins(ics.lat0.tau63, 0.3, 0.7), maxAccHover: ics.lat0.maxAcc,
      target34: '20-48', accMargin: margins(ics.lat0.maxAcc, 20.4, 47.6), maxRateHover: ics.lat0.max, maxRate150: ics.lat150.max, targetRate: '11-16' });
    expect(within(ics.lat0.maxAcc, 34, 0.4)).toBe(true);
  });

  it.fails('G7 KNOWN GAP: ICS roll time constant 0.3-0.7 s (D, tau = Lambda Ixx / H = 0.48 s)', () => {
    // The 63 % crossing, interpolated between the 1/240 s samples, is 0.295 s: 1.7 % under the edge (it read 0.30 s exactly
    // when quantised to the sample). The roll is quicker than the derivation, as the pitch is (KNOWN_ISSUES #4).
    expect(ics.lat0.tau63).toBeGreaterThanOrEqual(0.3); expect(ics.lat0.tau63).toBeLessThanOrEqual(0.7);
  });

  it('pitch: initial acceleration about 5.4 deg/s^2/in (+/-40 %)', () => {
    report('G7 ICS pitch', { maxAccHover: ics.lon0.maxAcc, target: '3.2-7.6', tau63Hover: ics.lon0.tau63, targetTauHover: '1.5-3.5',
      tau63At150: ics.lon150.tau63, targetTau150: '0.8-2.0', maxRateHover: ics.lon0.max, maxRate150: ics.lon150.max, targetRate: '9-14' });
    expect(within(ics.lon0.maxAcc, 5.4, 0.4)).toBe(true);
  });

  it.fails('G7 KNOWN GAP: pitch time constant 1.5-3.5 s at the hover and the steady rates 9-14 / 11-16 deg/s/in', () => {
    // The derived steady rate (M_stick - K_s theta_rel)/H is not reached: with the ICS's physical 4100 ft-lb/rad spring the
    // gyro precesses sideways under the spring (CR-114362 App C) and the hover attitude change cuts the rise off; the
    // maximum comes early (docs/control-gyro-model.md, "ICS response").
    expect(ics.lon0.tau63).toBeGreaterThanOrEqual(1.5);
    expect(ics.lon0.max).toBeGreaterThanOrEqual(9);
    expect(ics.lat0.max).toBeGreaterThanOrEqual(11);
  });

  it('G7a: full lateral stick from trim at 120 KCAS: steady 40-65 deg/s; right/left 1.5-1.9 from the trim offset', () => {
    const go = (dir: 1 | -1) => {
      const r = rig({ cfg: 'ics', kt: 120 });
      const trimIn = r.c.aileron * gyroDef.configs.ics.stickTravel.lateral / 0.0254;
      r.c.aileron = dir;
      let max = 0;
      run(r, 1.5, () => { max = Math.max(max, dir * r.fm.state.angularVelocity.x / DEG); });
      return { max, trimIn };
    };
    const right = go(1), left = go(-1);
    report('G7a ICS full lateral 120 KCAS', { rightDegPerSec: right.max, leftDegPerSec: left.max, ratio: right.max / left.max,
      trimLateralIn: right.trimIn, targetRate: '40-65', targetRatio: '1.5-1.9', P: '77 R / 42 L at 122 KCAS (compound)' });
    trace.G7a = { right: r2(right.max), left: r2(left.max), ratio: r2(right.max / left.max), trimIn: r2(right.trimIn) };
    // The symmetric rate "before trim asymmetry" is the right rate: the trim offset (stick left of centre) shortens the
    // left throw and lengthens the right one, and the ratio carries the asymmetry. The mean (40.5) would sit 1 % above 40.
    report('G7a margins', { rightRate: margins(right.max, 40, 65), ratio: margins(right.max / left.max, 1.5, 1.9) });
    expect(right.max).toBeGreaterThanOrEqual(40); expect(right.max).toBeLessThanOrEqual(65);
    expect(right.max / left.max).toBeGreaterThanOrEqual(1.5); expect(right.max / left.max).toBeLessThanOrEqual(1.9);
  });
});

describe('G7b: the pitch desensitizer (ICS) and the constant AMCS response', () => {
  // 4 s: the ICS hover pitch rate peaks at 2.48 s (G7); the AMCS rates peak inside 1 s.
  const rate = (cfg: 'amcs' | 'ics', kt: number) => stepResponse(rig({ cfg, kt }), 'lon', 1, 4);
  const rows = { ics0: rate('ics', 0), ics120: rate('ics', 120), ics150: rate('ics', 150), amcs0: rate('amcs', 0), amcs100: rate('amcs', 100),
    amcs150: rate('amcs', 150) };
  trace.G7b = Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, summary(v)]));

  it('ICS: the measured ratios (logged; the desensitizer itself is checked at the gyro block, ah56Gyro.test.ts)', () => {
    const x = rows.ics0.max;
    report('G7b ICS', { hoverMax: x, ratio120: rows.ics120.max / x, target120: '0.8-1.0', ratio150: rows.ics150.max / x, target150: '0.6-0.8',
      at1Ratio120: rows.ics120.at1 / rows.ics0.at1, at1Ratio150: rows.ics150.at1 / rows.ics0.at1, tau63Hover: rows.ics0.tau63,
      tau63At150: rows.ics150.tau63 });
    expect(rows.ics150.max).toBeLessThan(x);
  });

  it.fails('G7b KNOWN GAP: the ICS maximum pitch rate per inch at 0.8-1.0 X (120 KCAS) and 0.6-0.8 X (150 KCAS)', () => {
    // Measured 0.47 X at 120 and 0.45 X at 150 KCAS on the maximum rate (ASTA-72 para 59's "control response"); the plan's
    // rate at 1 s gives the at1Ratio rows logged above. The airframe's pitch damping at speed (the rate peaks within
    // 0.5 s and decays) and the ICS feedback's speed terms (the droop x in-plane and Cm0 paths) cut it more than the 2:1
    // desensitizer does (docs: "ICS response").
    const x = rows.ics0.max;
    expect(rows.ics120.max / x).toBeGreaterThan(0.8 * 0.9); expect(rows.ics120.max / x).toBeLessThan(1.0 * 1.1);
    expect(rows.ics150.max / x).toBeGreaterThan(0.6 * 0.9); expect(rows.ics150.max / x).toBeLessThan(0.8 * 1.1);
  });

  it.fails('G7b KNOWN GAP (plan rows disagree): the ICS time to 63 % of the peak rate grows with speed', () => {
    // G7 derives tau = Lambda I / H falling from 2.5 s (hover) to 1.1 s (150 KCAS, the stabiliser's Mq); G7b asks it to grow
    // from 0.15-0.3 to 0.4-0.7 s (ASTA-72 para 59's "slow above 170 KCAS"). The model follows G7's trend.
    expect(rows.ics150.tau63).toBeGreaterThan(rows.ics0.tau63);
  });

  it('AMCS: about constant 6 deg/s/in (+/-30 %) hover to 150 KCAS (AMCS-73 para 33: maximum rate per inch, tested at 0, 60, 150, 180 KCAS)', () => {
    report('G7b AMCS', { hoverMax: rows.amcs0.max, at100Max: rows.amcs100.max, at150Max: rows.amcs150.max, target: '4.2-7.8',
      peakS: `${rows.amcs0.tMax}/${rows.amcs100.tMax}/${rows.amcs150.tMax}`, at150Margin: margins(rows.amcs150.max, 4.2, 7.8),
      at150Sensitivity: rows.amcs150.maxAcc, P: 9 });
    for (const k of ['amcs0', 'amcs100', 'amcs150'] as const) {
      expect(rows[k].peaked).toBe(true); expect(rows[k].tMax).toBeLessThan(rows[k].window);
      expect(within(rows[k].max, 6, 0.3)).toBe(true);
    }
  });
});

describe('G8: off-axis response to a pure longitudinal stick (hover, 100 KCAS)', () => {
  const off = (cfg: 'amcs' | 'ics', kt: number) => { const s = stepResponse(rig({ cfg, kt }), 'lon', 1, 1.5); return s.offAt1 / s.at1; };
  const rows = { amcs0: off('amcs', 0), amcs100: off('amcs', 100), ics0: off('ics', 0), ics100: off('ics', 100) };
  trace.G8 = Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, r2(v)]));

  it('AMCS: roll rate within 20 % of the pitch rate', () => {
    report('G8 AMCS p/q at 1 s', { hover: rows.amcs0, at100: rows.amcs100, target: '|p/q| <= 0.2' });
    expect(Math.abs(rows.amcs0)).toBeLessThanOrEqual(0.2);
    expect(Math.abs(rows.amcs100)).toBeLessThanOrEqual(0.2);
  });

  it('ICS: the fitted input rotation (13 deg advanced) balances the hover and 100 KCAS coupling', () => {
    report('G8 ICS p/q at 1 s', { hover: rows.ics0, at100: rows.ics100, target: '|p/q| <= 0.2', inputRotationDeg: gyroDef.configs.ics.inputRotation / DEG,
      P: 36, feedbackRotationDeg: gyroDef.configs.ics.feedbackRotation / DEG, Pcant: 33 });
    expect(Math.abs(rows.ics0)).toBeLessThanOrEqual(0.3);
    expect(Math.abs(rows.ics100)).toBeLessThanOrEqual(0.3);
  });

  it.fails('G8 KNOWN GAP: ICS within 20 % at both speeds with the input rotation within 15 deg of the P 36 deg', () => {
    // No single input rotation meets 20 % at both speeds (hover needs 2.5-12 deg, 100 KCAS 14-22 deg advanced), and the P 36
    // deg gives about 1.6 deg/s of roll per deg/s of pitch in this model (docs: "Input rotation").
    expect(Math.abs(rows.ics0)).toBeLessThanOrEqual(0.2);
    expect(Math.abs(rows.ics100)).toBeLessThanOrEqual(0.2);
    expect(Math.abs(gyroDef.configs.ics.inputRotation / DEG - 36)).toBeLessThanOrEqual(15);
  });
});

describe('G9: hover attitude, 18,300 lb, in ground effect', () => {
  it('roll 2-7 deg left wing low (P APE-I "about 5 deg left"); pitch -1 to +4 deg (ESTIMATE)', () => {
    const out: Record<string, number> = {};
    for (const cfg of ['amcs', 'ics'] as const) {
      // Wheels about 10 ft above the ground (P ASTA-72's IGE hover height).
      const r = rig({ cfg, height: AH56_REST_CONTACTS.left.z + 3.05, gearDown: true });
      out[`${cfg}Roll`] = r.fm.state.roll / DEG; out[`${cfg}Pitch`] = r.fm.state.pitch / DEG;
    }
    report('G9 hover attitude IGE', { ...out, rollTarget: '-7..-2', pitchTarget: '-1..+4' });
    trace.G9 = out;
    for (const cfg of ['amcs', 'ics']) {
      expect(out[`${cfg}Roll`]).toBeLessThanOrEqual(-2); expect(out[`${cfg}Roll`]).toBeGreaterThanOrEqual(-7);
      expect(out[`${cfg}Pitch`]).toBeGreaterThanOrEqual(-1); expect(out[`${cfg}Pitch`]).toBeLessThanOrEqual(4);
    }
  });
});
