// AH-56A stages 3-4 (AC): the compound's performance. Plan revision 2 section 7.3: C2-C3 (hover ceilings with the wing download
// and the prop at the -2.2 deg detent), C4 (V_H, TOW configuration), C5 (AMCS clean maximum level speed), C10-C11 (acceleration and
// deceleration), C12 (autorotation) and C24 (raising the collective reduces the power at 158 KTAS). Each row logs its numbers
// next to the target ([ah56] lines); AH56_TRACE=<dir> writes ah56CompoundPerformance.json.
//
// Two stand-ins, both recorded in docs/ah56-compound.md:
// - C24 (ASTA-72's ICS aircraft) and C4's Mach-placeholder reference are trimmed with the AMCS gyro's mechanics at the ICS's 246
//   rpm (the gyro does not enter the trim's power: the rotor, the prop and the drag do). C4 as flown is the ICS configuration
//   itself since the final fix round (wing section Cm and DATCOM downwash, compound.ts); before it the ICS gyro trim ran out of
//   forward stick above about 170-190 KCAS.
// - C4 is fitted with the provisional Mach drag rise (compound.ts PROVISIONAL_SECTION, not flown): the row runs both.
import { afterAll, describe, expect, it } from 'vitest';
import { DEG, FT, KT } from '../../src/core/math';
import { cloneControls } from '../../src/core/types';
import type { AircraftDefinition } from '../../src/aircraft/types';
import { AH56_DEFINITION } from '../../src/aircraft/ah56';
import { AH56_REFERENCE } from '../../src/aircraft/ah56/reference';
import { AH56_PROP_BETA_DEG, AH56_TIT_C } from '../../src/aircraft/ah56/facts';
import { FUSELAGE_DRAG_X, PROVISIONAL_SECTION } from '../../src/aircraft/ah56/compound';
import { ah56Loading } from '../../src/aircraft/ah56/mass';
import { createFlightModelFor } from '../../src/physics';
import type { BladeElementFlightModel } from '../../src/physics/flightModel';
import type { RotorcraftDefinition } from '../../src/physics/rotorcraft/definition';
import type { Rotorcraft } from '../../src/physics/rotorcraft/rotorcraft';
import type { GyroConfigId } from '../../src/physics/rotorcraft/controlGyro';
import { pusherBetaLever } from '../../src/physics/rotorcraft/pusher';
import { PRODUCTION_AIR_WIRED, collectiveServo, environment, gauges, pilot, report, run, writeTrace } from './ah56Rig';

const trace: Record<string, unknown> = {};
afterAll(() => writeTrace('ah56CompoundPerformance', trace));

const def = AH56_DEFINITION.rotorcraft!, p = def.pusher!;
const DT = 1 / 240;
const STAND_IN = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.AH56_AIRDATA !== 'off' &&
  !PRODUCTION_AIR_WIRED;
const variantOf = (base: AircraftDefinition, patch: (r: RotorcraftDefinition) => RotorcraftDefinition): AircraftDefinition =>
  ({ ...base, rotorcraft: patch(base.rotorcraft!) });
const withMach = (base: AircraftDefinition) => variantOf(base, (r) => ({ ...r, main: { ...r.main, section: PROVISIONAL_SECTION } }));
const clean = (base: AircraftDefinition) => variantOf(base, (r) => ({ ...r, wings: r.wings!.map((w) => ({ ...w, stores: undefined })) }));
/** The ICS configuration flown on the AMCS gyro's mechanics at 246 rpm (the stand-in above). */
const icsRpm = (base: AircraftDefinition) => variantOf(base, (r) => ({ ...r, controlGyro: { ...r.controlGyro!, configs: { ...r.controlGyro!.configs,
  ics: { ...r.controlGyro!.configs.amcs, nominalRpmFraction: 1, collectiveIndicatedOffset: 0 } } } }));
const fixedBeta = (deg: number, base: AircraftDefinition) => variantOf(base, (r) => ({ ...r, pusher: { ...r.pusher!,
  trimSchedule: { x: [0, 1], y: [deg * DEG, deg * DEG] }, trimScheduleByConfig: undefined } }));

interface RigOptions { cfg?: GyroConfigId; kt?: number; lb?: number; ft?: number; height?: number; pathDeg?: number; gearDown?: boolean }
function rigOn(d: AircraftDefinition, o: RigOptions = {}) {
  const fm = createFlightModelFor(d) as BladeElementFlightModel, env = environment(o.ft ?? 0);
  fm.setLoading(ah56Loading(o.lb ?? 18_300, undefined, 1));
  const rotor = (fm as unknown as { rotorcraft: Rotorcraft }).rotorcraft;
  if (STAND_IN) rotor.gyro!.setAirData({ hub: { x: (o.kt ?? 0) * KT, y: 0, z: 0 }, density: env.atmosphere().density });
  fm.reset({ position: { x: 0, y: 0, z: -(o.height ?? (o.ft ?? 0) * FT + 1500 * FT) }, heading: 0, airspeed: (o.kt ?? 0) * KT,
    flightPathAngle: (o.pathDeg ?? 0) * DEG, onGround: false, engineRunning: true, fuelFraction: 1, rotorcraftConfig: o.cfg,
    gearDown: o.gearDown ?? (o.kt ?? 0) < 100 }, env);
  return { fm, c: cloneControls(fm.trimControls), env, cfg: o.cfg ?? 'amcs', airData: STAND_IN, rotor };
}
type CompoundRig = ReturnType<typeof rigOn>;
const collective075 = (r: CompoundRig) => (def.main.minPitch + (r.c.collective ?? 0) * (def.main.maxPitch - def.main.minPitch)) / DEG;

/** The level trim at `kt` with the prop set so the collective is `coll` deg at 0.75 R (secant on the blade angle, bracketed). */
function trimOnCollective(base: AircraftDefinition, o: RigOptions & { kt: number }, coll: number) {
  const at = (b: number) => { const r = rigOn(fixedBeta(b, base), o); return { b, r, e: collective075(r) - coll }; };
  let a = at(15), c = at(40.8);
  if (a.e * c.e > 0) return Math.abs(a.e) < Math.abs(c.e) ? a : c;
  for (let i = 0; i < 12; i++) {
    const s = c.b - c.e * (c.b - a.b) / (c.e - a.e);
    const m = at(Number.isFinite(s) && s > Math.min(a.b, c.b) && s < Math.max(a.b, c.b) ? s : (a.b + c.b) / 2);
    if (Math.abs(m.e) < 0.03 && m.r.fm.lastTrim!.converged) return m;
    if (m.e * a.e > 0) a = m; else c = m;
  }
  return Math.abs(a.e) < Math.abs(c.e) ? a : c;
}
/** The speed (KTAS) at which the trim on `coll` needs `torque` %: bisection between `lo` and `hi`. */
function speedAtTorque(base: AircraftDefinition, o: RigOptions, coll: number, torque: number, lo: number, hi: number) {
  const tq = (kt: number) => gauges(trimOnCollective(base, { ...o, kt }, coll).r).torque;
  let tlo = tq(lo), thi = tq(hi);
  for (let i = 0; i < 6 && tlo < torque && thi > torque; i++) {
    const mid = (lo + hi) / 2, t = tq(mid);
    if (t < torque) { lo = mid; tlo = t; } else { hi = mid; thi = t; }
  }
  return { kt: lo + (torque - tlo) / (thi - tlo) * (hi - lo), lo, hi, tlo, thi };
}

// ---------------------------------------------------------------------------------------------------------- C2 C3
describe('C2-C3: hover ceilings, standard day, prop at the -2.2 deg detent (P ASTA-72 paras 11-12; ICS)', () => {
  /** Hover trimmed at `ft` (OGE, or 10 ft wheel height IGE): within the 10-minute rating (TIT 780 C), the transmission's 114 %
   *  and the fuel control's travel (as G10, AG). */
  function hover(ft: number, lb: number, ige: boolean) {
    const r = rigOn(AH56_DEFINITION, { kt: 0, cfg: 'ics', lb, ft, height: ige ? 10 * FT + def.skids.z : ft * FT + 300 });
    const g = gauges(r), throttle = r.fm.state.rotorcraft!.governorThrottle;
    const ok = r.fm.lastTrim!.converged && g.torque <= 114 && throttle < 0.999 && g.ng <= 101.5 && g.tit <= AH56_TIT_C.yellow10min;
    return { ft, ok, torque: g.torque, ng: g.ng, tit: g.tit, throttle };
  }
  function ceiling(lb: number, ige: boolean) {
    let lo = 0, hi = 16_000;
    expect(hover(lo, lb, ige).ok).toBe(true);
    for (let i = 0; i < 7; i++) { const mid = (lo + hi) / 2; if (hover(mid, lb, ige).ok) lo = mid; else hi = mid; }
    return { ceilingFt: Math.round(lo), at: hover(lo, lb, ige), above: hover(hi, lb, ige) };
  }
  it('C2: OGE at 18,750 lb: 8,500 ft +/- 1,000 (P para 12)', () => {
    const c = ceiling(18_750, false);
    report('C2 HOGE 18,750 lb', { ceilingFt: c.ceilingFt, torque: c.at.torque, ng: c.at.ng, titC: c.at.tit, target: AH56_REFERENCE.hogeFt18750 + ' +/- 1000' });
    trace.C2 = c;
    expect(Math.abs(c.ceilingFt - AH56_REFERENCE.hogeFt18750)).toBeLessThanOrEqual(1000);
  }, 1_800_000);
  it('C3: 20,500 lb: OGE 6,000 ft and IGE (10 ft wheels) 9,300 ft, +/- 1,000 (P para 11)', () => {
    const oge = ceiling(20_500, false), ige = ceiling(20_500, true);
    report('C3 hover ceilings 20,500 lb', { ogeFt: oge.ceilingFt, igeFt: ige.ceilingFt, target: `${AH56_REFERENCE.hoge20500Ft} / ${AH56_REFERENCE.hige20500Ft} +/- 1000` });
    trace.C3 = { oge, ige };
    expect(Math.abs(oge.ceilingFt - AH56_REFERENCE.hoge20500Ft)).toBeLessThanOrEqual(1000);
    expect(Math.abs(ige.ceilingFt - AH56_REFERENCE.hige20500Ft)).toBeLessThanOrEqual(1000);
  }, 1_800_000);
});

// ---------------------------------------------------------------------------------------------------------- C4 C5
describe('C4-C5: maximum level speed at the transmission limit (114 % = 3925 shp, P)', () => {
  // C4 on the ICS configuration itself (it trims at V_H since the final fix round's wing section Cm and DATCOM downwash); the
  // provisional Mach placeholder is still flown on the AMCS gyro's mechanics at 246 rpm (icsRpm above), its stage-4 reference.
  it('C4: V_H 194 KTAS +/- 5 %: TOW configuration (stores), 18,750 lb, SL, collective 5 deg (P ASTA-72 para 14)', () => {
    const o = { cfg: 'ics' as const, lb: 18_750 };
    const mach = speedAtTorque(icsRpm(withMach(AH56_DEFINITION)), o, 5, 114, 186, 200);
    const flown = speedAtTorque(AH56_DEFINITION, o, 5, 114, 186, 204);
    report('C4 V_H', { withMachPlaceholderKtas: mach.kt, asFlownKtas: flown.kt, fuselageFlatPlateM2: FUSELAGE_DRAG_X, target: '194 +/- 5 % (184.3-203.7)' });
    trace.C4 = { mach, flown };
    expect(Math.abs(mach.kt / AH56_REFERENCE.vh - 1)).toBeLessThanOrEqual(0.05);
    expect(Math.abs(flown.kt / AH56_REFERENCE.vh - 1)).toBeLessThanOrEqual(0.05);
  }, 1_800_000);
  it('C5: AMCS clean (no stores, AMCS-73 test condition e, P), 18,300 lb, 13 deg indicated: 210-225 KTAS (P Hoh-74 220; S 215)', () => {
    const o = { cfg: 'amcs' as const, lb: 18_300 };
    const flown = speedAtTorque(clean(AH56_DEFINITION), o, 6, 114, 200, 216);
    const mach = speedAtTorque(clean(withMach(AH56_DEFINITION)), o, 6, 114, 200, 216);
    const stores = speedAtTorque(AH56_DEFINITION, o, 6, 114, 190, 206);
    report('C5 AMCS maximum level speed', { cleanKtas: flown.kt, cleanWithMachKtas: mach.kt, withStoresKtas: stores.kt,
      target: '210-225 (clean)', note: 'the prop reaches its 40.8 deg stop at about 210 KTAS (1674 rpm)' });
    trace.C5 = { flown, mach, stores };
    expect(flown.kt).toBeGreaterThanOrEqual(210); expect(flown.kt).toBeLessThanOrEqual(225);
  }, 1_800_000);
});

// ---------------------------------------------------------------------------------------------------------- C24
describe('C24: raising the collective from 3 to 7 deg at 158 KTAS (the prop re-trimmed) reduces the power required (P ASTA-72 para 14)', () => {
  it('torque on 7 deg below torque on 3 deg', () => {
    const o = { cfg: 'ics' as const, lb: 18_750, kt: 158 };
    const at3 = trimOnCollective(icsRpm(AH56_DEFINITION), o, 3), at7 = trimOnCollective(icsRpm(AH56_DEFINITION), o, 7);
    const g3 = gauges(at3.r), g7 = gauges(at7.r);
    report('C24 158 KTAS', { torqueAt3Pct: g3.torque, torqueAt7Pct: g7.torque, betaAt3: at3.b, betaAt7: at7.b, pitchAt3: g3.pitch, pitchAt7: g7.pitch,
      target: 'torque at 7 < torque at 3' });
    trace.C24 = { g3, g7, b3: at3.b, b7: at7.b };
    expect(at3.r.fm.lastTrim!.converged && at7.r.fm.lastTrim!.converged).toBe(true);
    expect(g7.torque).toBeLessThan(g3.torque);
  }, 1_800_000);
});

// ---------------------------------------------------------------------------------------------------------- C12
describe('C12: steady autorotation, 19,700 lb, 2,700 ft DA, 95 KCAS, prop at +8 deg (P ASTA-72 para 69: about 2,200 ft/min)', () => {
  let c12Fpm = NaN;
  it('the zero-torque autorotation trims at 100 % Nr inside the collective travel (ICS); its rate is reported', () => {
    const base = fixedBeta(AH56_PROP_BETA_DEG.autorotation, AH56_DEFINITION);
    const torqueAt = (pathDeg: number) => {
      const r = rigOn(base, { kt: 95, cfg: 'ics', lb: 19_700, ft: 2_700, pathDeg, gearDown: false });
      return { pathDeg, torque: r.fm.state.rotorcraft!.torque, r };
    };
    let lo = torqueAt(-20), hi = torqueAt(0);
    // A path the trim cannot hold (the collective at its bottom stop below about -16 deg: lastTrim not converged, its torque on
    // no branch) counts as too steep: the bisection keeps the converged zero-torque crossing.
    for (let i = 0; i < 18; i++) { const m = torqueAt((lo.pathDeg + hi.pathDeg) / 2); if (m.r.fm.lastTrim!.converged && m.torque > 0) hi = m; else lo = m; }
    const r = hi.r, g = gauges(r), fpm = 95 * KT * Math.sin(-hi.pathDeg * DEG) / FT * 60;
    report('C12 autorotation', { descentFtPerMin: fpm, pathDeg: hi.pathDeg, collectiveDeg075: collective075(r), pitchDeg: g.pitch, nrPct: g.nr,
      shaftTorqueNm: hi.torque, propThrustKN: r.fm.state.rotorcraft!.pusher!.thrust / 1e3, target: '2200 +/- 300' });
    trace.C12 = { fpm, pathDeg: hi.pathDeg, collective: collective075(r) };
    expect(r.fm.lastTrim!.converged).toBe(true);
    expect(collective075(r)).toBeGreaterThan(def.main.minPitch / DEG);
    c12Fpm = fpm;
  }, 1_800_000);
  // KNOWN GAP since stage 5 (integrator, at the AH merge): 2,508 ft/min, 8 ft/min outside (stage 4: 2,492, inside). The stage-5
  // section's post-stall drag (0.156 / 0.221 / 0.302 against Report 530's 0.127 / 0.195 / 0.275) with the disc root stalled is one
  // candidate. Owner options (AGENT, not decided): fit the post-stall drag (AH), re-fit the autorotation drag (AC), or keep this row.
  it.fails('C12 KNOWN GAP: 2,200 +/- 300 ft/min (P ASTA-72 para 69)', () => {
    expect(Math.abs(c12Fpm - 2200)).toBeLessThanOrEqual(300);
  });
});

// ---------------------------------------------------------------------------------------------------------- C10 C11
describe('C10-C11: forward acceleration and deceleration, 19,200 lb, stores, 1500 ft DA (P ASTA-72 para 15, Table 3; AMCS)', () => {
  const opts = { cfg: 'amcs' as const, lb: 19_200, ft: 1_500 };
  const crashOf = (r: CompoundRig) => (r.fm as unknown as { crashReason: string }).crashReason;
  /** C10's flight (P technique): from the hover, the prop to +10 deg, the nose low (-6 deg) with the collective holding height and
   *  capped at 114 % torque; from 80 KCAS the collective on the AMCS SoF (13 deg indicated) and the prop holding 114 %, the cyclic
   *  holding height; gear up at 95 KCAS. Times to 165 and 188 KTAS. */
  function accelerate() {
    const r = rigOn(AH56_DEFINITION, { ...opts, kt: 0 });
    const hold = pilot(r);
    const z0 = r.fm.state.position.z, offset = def.controlGyro!.configs.amcs.collectiveIndicatedOffset / DEG;
    const lever075 = (deg: number) => (deg * DEG - def.main.minPitch) / (def.main.maxPitch - def.main.minPitch);
    r.c.propLever = pusherBetaLever(p, 10 * DEG);
    let t = 0, t165 = NaN, t188 = NaN, gearUpAt = NaN, maxTorque = 0, onSchedule = false;
    while (t < 160 && Number.isNaN(t188) && !crashOf(r)) {
      run(r, 0.25, () => {
        t += DT;
        const s = r.fm.state, g = gauges(r), kias = s.ias / KT, tas = Math.hypot(s.velocity.x, s.velocity.y) / KT;
        const low = s.position.z - z0, sink = s.velocity.z;
        maxTorque = Math.max(maxTorque, g.torque);
        if (kias >= 80) onSchedule = true;
        if (!onSchedule) {
          collectiveServo(r.c, 0.05 * low + 0.1 * sink - (g.torque > 113 ? 0.2 : 0), 1, DT);
          hold(DT, -6 * DEG);
        } else {
          const sched = lever075(13 - offset);
          r.c.collective = (r.c.collective ?? 0) + Math.max(-0.05 * DT, Math.min(0.05 * DT, sched - (r.c.collective ?? 0)));
          r.c.propLever = Math.max(0, Math.min(1, r.c.propLever! + (113.5 - g.torque) * 0.002 * DT));
          hold(DT, Math.max(-8 * DEG, Math.min(6 * DEG, -2 * DEG + 0.006 * low + 0.03 * sink)));
        }
        if (Number.isNaN(gearUpAt) && kias >= 95) { r.c.gearLever = 'up'; gearUpAt = t; }
        if (Number.isNaN(t165) && tas >= 165) t165 = t;
        if (Number.isNaN(t188) && tas >= 188) t188 = t;
      });
    }
    return { t165, t188, gearUpAt, maxTorque, heightChangeFt: (z0 - r.fm.state.position.z) / FT, crash: crashOf(r) };
  }
  /** C11's flight (P technique): from a trim at 196 KTAS (8 kt above the dash speed), the prop to -12 deg in 4 s ("a smooth motion
   *  at a moderate rate"), the cyclic holding height, gear down at 120 KCAS, the collective raised to hold height from 50 KTAS and the
   *  nose eased level, the prop to -2.2 deg at the hover. */
  function decelerate() {
    const r = rigOn(AH56_DEFINITION, { ...opts, kt: 196, gearDown: false });
    const hold = pilot(r);
    const z0 = r.fm.state.position.z, x0 = r.fm.state.position.x, lever0 = r.c.propLever!, pitch0 = r.fm.state.pitch;
    let t = 0, t165 = NaN, tStop = NaN, gearDownAt = NaN, raised = false, x165 = NaN;
    while (t < 90 && Number.isNaN(tStop) && !crashOf(r)) {
      run(r, 0.25, () => {
        t += DT;
        const s = r.fm.state, kias = s.ias / KT, tas = Math.hypot(s.velocity.x, s.velocity.y) / KT, low = s.position.z - z0, sink = s.velocity.z;
        r.c.propLever = tas < 8 ? pusherBetaLever(p, -2.2 * DEG) : Math.max(0, lever0 * (1 - t / 4));
        if (tas < 50) raised = true;
        const level = raised ? Math.min(1, tas / 50) : 1;
        hold(DT, Math.max(-8 * DEG, Math.min(25 * DEG, pitch0 + level * (0.006 * low + 0.03 * sink) + (1 - level) * 3 * DEG)));
        // The pilot's torque limit (as C10's): the collective does not rise past 114 % (above it the stage-5 rotor stalls and the
        // Nr droops to 87 % at full collective).
        if (raised) { const before = r.c.collective ?? 0; collectiveServo(r.c, 0.05 * low + 0.1 * sink, 1, DT); if (gauges(r).torque > 114) r.c.collective = Math.min(r.c.collective ?? 0, before); }
        if (Number.isNaN(gearDownAt) && kias <= 120) { r.c.gearLever = 'down'; gearDownAt = t; }
        if (Number.isNaN(t165) && tas <= 165) { t165 = t; x165 = s.position.x; }
        if (Number.isNaN(tStop) && tas <= 3) tStop = t;
      });
    }
    const s = r.fm.state;
    return { t165, tStop, distanceFt: (s.position.x - x0) / FT, distanceTo165Ft: (x165 - x0) / FT, gearDownAt, heightChangeFt: (z0 - s.position.z) / FT,
      kiasAt90: s.ias / KT, crash: crashOf(r) };
  }
  let acc: ReturnType<typeof accelerate> | undefined, dec: ReturnType<typeof decelerate> | undefined;

  it('C10 (segment): hover to 165 KTAS at maximum power in 53 s +/- 20 % (P Table 3: 107 s to 188, of which 54 s from 165)', () => {
    acc = accelerate();
    report('C10 acceleration', { secondsTo165Ktas: acc.t165, secondsTo188Ktas: acc.t188, seconds165to188: acc.t188 - acc.t165, gearUpAtS: acc.gearUpAt,
      maxTorquePct: acc.maxTorque, heightChangeFt: acc.heightChangeFt, crash: acc.crash || 'none', P: '107 s to 188 KTAS (0.09 g); 165-188 in 54 s (0.02 g)' });
    trace.C10 = acc;
    expect(acc.crash).toBe('');
    expect(acc.t165).toBeGreaterThanOrEqual(53 * 0.8); expect(acc.t165).toBeLessThanOrEqual(53 * 1.2);
    expect(acc.t188).toBeLessThan(160);
  }, 1_800_000);

  it.fails('C10 KNOWN GAP: 0 -> 188 KTAS in 107 s +/- 20 % (the model has more excess power from 165 to 188: 23 s against 54 s)', () => {
    // V_H at this condition is about 197 KTAS in the model (C4: 196.9 with the Mach placeholder, 198.7 as flown) where the P
    // aircraft's was nearer 190, and the scripted pilot holds 114 % throughout ("maximum power could not be used throughout the
    // maneuver because of the high pilot workload", P para 10).
    expect(acc!.t188).toBeGreaterThanOrEqual(107 * 0.8); expect(acc!.t188).toBeLessThanOrEqual(107 * 1.2);
  });

  it('C11 (segment): 196 to 165 KTAS in 5.4 s +/- 20 % (P Table 3: 0.18 g) on the reverse prop', () => {
    dec = decelerate();
    report('C11 deceleration', { seconds196to165: dec.t165, secondsToHover: dec.tStop, distanceFt: dec.distanceFt, gearDownAtS: dec.gearDownAt,
      heightChangeFt: dec.heightChangeFt, crash: dec.crash || 'none', P: '196-165 in 5.4 s (0.18 g); to a hover in 33 s (0.31 g), under 4,000 ft' });
    trace.C11 = dec;
    expect(dec.crash).toBe('');
    expect(dec.t165).toBeGreaterThanOrEqual(5.4 * 0.8); expect(dec.t165).toBeLessThanOrEqual(5.4 * 1.2);
    expect(Math.abs(dec.heightChangeFt)).toBeLessThan(200);
  }, 1_800_000);

  it.fails('C11 KNOWN GAP: 196 KTAS to a hover in 33 s +/- 20 %, under 4,000 ft', () => {
    // Below about 150 KTAS the model decelerates at 0.15-0.2 g: the reverse prop gives 8-12 kN there, and on 13 deg indicated the
    // rotor holds the weight at a level attitude, so holding height with the cyclic never flares it. The P average of 0.31 g from
    // 165 KTAS needs about 26 kN of retarding force.
    expect(dec!.tStop).toBeGreaterThanOrEqual(33 * 0.8); expect(dec!.tStop).toBeLessThanOrEqual(33 * 1.2);
    expect(dec!.distanceFt).toBeLessThan(4000);
  });
});
