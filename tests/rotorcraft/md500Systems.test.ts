// MD 500E (369E, 250-C20B): the turboshaft stage, the freewheel and the engine systems against plan 6.6. Each test
// flies the production flight model with ordinary controls (grip, collective, beep, switches) and reads the gauges.
// P = RFM CSP-E-1 Rev 16; D = derived; ESTIMATE = no source. MD500_TRACE=<dir> writes the report.
import { afterAll, describe, expect, it } from 'vitest';
import { DEG, FT, KT } from '../../src/core/math';
import { applyControls, cloneControls } from '../../src/core/types';
import { MD500_N1_PCT, MD500_NR_LIMITS, MD500_N2_PCT, MD500_XMSN_PRESS_SWITCH_PSI, MD500_ENGINE_OUT } from '../../src/aircraft/md500/facts';
import { buildScenario } from '../../src/sim/scenarios';
import { hoverScenario } from '../../src/sim/rotorcraft/starts';
import { SimPhysics } from '../../src/sim/SimPhysics';
import { parseSnapshot } from '../../src/sim/resume';
import type { ScenarioId } from '../../src/core/context';
import { calmWeather } from '../fdm/helpers';
import { DT, d, def, gauges, pilot, rig, run, ts, writeTrace, collectiveServo } from './md500Rig';

const report: Record<string, unknown> = {};
afterAll(() => writeTrace('md500Systems', report));
const GRIP = ts.grip;

describe('MD 500E reset, presets and spawns', () => {
  it('reset to hover: Nr 492 +/- 2, N2 103 +/- 0.3 %, no transient over 2 s (plan 6.2)', () => {
    const r = rig(3000, { height: 1500 }), g0 = gauges(r);
    let maxDn2 = 0, maxDnr = 0;
    run(r, 2, () => { const g = gauges(r); maxDn2 = Math.max(maxDn2, Math.abs(g.n2 - g0.n2)); maxDnr = Math.max(maxDnr, Math.abs(g.nrRpm - g0.nrRpm)); });
    report.resetHover = { start: g0, maxDn2, maxDnr };
    expect(Math.abs(g0.nrRpm - 492)).toBeLessThanOrEqual(2);
    expect(Math.abs(g0.n2 - 103)).toBeLessThanOrEqual(0.3);
    expect(maxDn2).toBeLessThan(0.3); expect(maxDnr).toBeLessThan(2);
    expect(r.c.throttle).toBe(1); expect(r.c.mixture).toBe(1); expect(r.c.magnetos).toBe(0);
  });

  it('every running spawn holds the grip FULL OPEN, fuel on, igniters off; cold is CUTOFF (plan 6.2)', () => {
    const sim = new SimPhysics({ aircraft: def, weather: calmWeather() });
    const rows: Record<string, unknown>[] = [];
    for (const id of ['runway', 'final', 'cruise', 'downwind', 'apron'] as ScenarioId[]) {
      sim.resetTo(buildScenario(id, sim.env, def));
      sim.step(0.5);
      const c = sim.controls, t = sim.state.rotorcraft!.turboshaft!;
      rows.push({ id, throttle: c.throttle, mixture: c.mixture, magnetos: c.magnetos, grip: t.grip, n2: t.n2Pct, crashed: sim.state.crashed });
      expect(sim.state.crashed, id).toBe(false);
      if (id === 'apron') { expect(c.throttle).toBeLessThan(GRIP.cutoffBelow); expect(t.grip).toBe('cutoff'); continue; }
      expect(c.throttle, id).toBe(1); expect(c.mixture, id).toBe(1); expect(c.magnetos, id).toBe(0);
      expect(t.grip, id).toBe('fullOpen'); expect(t.governorMode, id).toBe('governed');
      expect(Math.abs(t.n2Pct - 103), id).toBeLessThan(1.5);
    }
    sim.resetTo(hoverScenario(sim.env, d));
    sim.step(0.5);
    rows.push({ id: 'hover', throttle: sim.controls.throttle, n2: sim.state.rotorcraft!.turboshaft!.n2Pct });
    expect(sim.controls.throttle).toBe(1); expect(sim.state.rotorcraft!.turboshaft!.grip).toBe('fullOpen');
    report.spawns = rows;
  }, 60_000);

  it('on the ground: the 4.7 deg nose-up attitude with full fuel (RFM Fig 1-1 note 1) and the cyclic at its rigging neutral (RFM 4-12)', () => {
    const r = rig(2102, { onGround: true, running: false });
    // The pilot alone (the typical loading), full fuel.
    r.fm.setLoading(def.mass.loadings.typical);
    r.fm.reset({ position: { x: 0, y: 0, z: 0 }, heading: 0, airspeed: 0, onGround: true, engineRunning: false, fuelFraction: 1 }, r.env);
    r.c = cloneControls(r.fm.trimControls);
    run(r, 1);
    report.ground = { pitch: r.fm.state.pitch / DEG, elevator: r.c.elevator };
    expect(Math.abs(r.fm.state.pitch / DEG - 4.7)).toBeLessThanOrEqual(0.3);
    // A third of the travel from full aft: elevator 1 is full aft, -1 full forward.
    expect(Math.abs((1 - r.c.elevator) / 2 - 0.31)).toBeLessThan(0.01);
  });
});

describe('MD 500E start, idle and shutdown (RFM 4-15..4-17, 4-26)', () => {
  it('start trace at OAT 15 C: light-off, TOT peak 650-810 C, rotor turning by 25 % N1, release at 58-60 %, idle 64-65 % N1, XMSN OIL PRESS out within 30 s, ENG OUT on at BAT ON and out at 55 % N1', () => {
    const r = rig(2250, { onGround: true, running: false }), s = r.fm.state, rc = s.rotorcraft!, t = rc.turboshaft!;
    applyControls(r.c, def.sim.presets.cold);
    r.c.masterBattery = true;
    run(r, 0.1);
    const atBatteryOn = { light: t.engineOutLight, horn: t.engineOutHorn };
    r.c.starter = true;
    let opened = -1, lightOff = -1, released = -1, releasedAt = 0, n1AtRotor = -1, peak = 0, above810 = 0, xmsn = -1;
    let lightBelow55 = false, lightAbove55: boolean | undefined;
    run(r, 120, (time) => {
      const n1 = s.engine.ng ?? 0;
      // Placard 2-18: open the grip to ground idle at 15 % N1 (OAT 7 C and above); release START at 58-60 %.
      if (opened < 0 && n1 >= 15) { r.c.throttle = GRIP.groundIdle; opened = time; }
      if (released < 0 && n1 >= 58.5) { r.c.starter = false; released = time; releasedAt = n1; }
      if (lightOff < 0 && s.engine.lit) lightOff = time;
      if (n1AtRotor < 0 && rc.rotorRpm > 2) n1AtRotor = n1;
      peak = Math.max(peak, s.engine.itt ?? 0); if ((s.engine.itt ?? 0) > 810) above810 += DT;
      if (n1 >= 50 && n1 < 54.5) lightBelow55 = t.engineOutLight;
      if (lightAbove55 === undefined && n1 >= 55.5) lightAbove55 = t.engineOutLight;
      if (xmsn < 0 && lightOff > 0 && (rc.transmission?.oilPressurePsi ?? 0) > MD500_XMSN_PRESS_SWITCH_PSI) xmsn = time - lightOff;
    });
    const idle = gauges(r);
    report.start = { atBatteryOn, opened, lightOff, n1AtRotor, released, releasedAt, peak, above810, lightBelow55, lightAbove55, xmsnAfterLightOff: xmsn, idle };
    expect(atBatteryOn.light).toBe(true);
    // Late-generic harness: no horn with the generator switch OFF (the start configuration).
    expect(atBatteryOn.horn).toBe(false);
    expect(lightOff).toBeGreaterThanOrEqual(opened);
    expect(peak).toBeGreaterThanOrEqual(650); expect(peak).toBeLessThanOrEqual(810);
    expect(above810).toBeLessThanOrEqual(10);
    expect(n1AtRotor).toBeGreaterThan(0); expect(n1AtRotor).toBeLessThanOrEqual(25);
    expect(releasedAt).toBeGreaterThanOrEqual(58); expect(releasedAt).toBeLessThanOrEqual(60);
    expect(idle.n1).toBeGreaterThanOrEqual(MD500_N1_PCT.groundIdle[0]); expect(idle.n1).toBeLessThanOrEqual(MD500_N1_PCT.groundIdle[1]);
    expect(xmsn).toBeGreaterThan(0); expect(xmsn).toBeLessThanOrEqual(30);
    // ENG OUT on below 55 % N1 and out above it (the bus is above 18 V there; it sags below while cranking).
    expect(lightBelow55).toBe(true); expect(lightAbove55).toBe(false);
  }, 60_000);

  it('ground idle: N2 55-70 % (below the 75-88 % avoid band; ESTIMATE / P)', () => {
    const r = rig(2250, { onGround: true });
    r.c.throttle = GRIP.groundIdle;
    run(r, 90);
    const g = gauges(r);
    report.groundIdle = g;
    expect(g.n2).toBeGreaterThanOrEqual(55); expect(g.n2).toBeLessThanOrEqual(70);
    expect(g.n2).toBeLessThan(MD500_N2_PCT.avoid[0]);
    expect(g.split).toBe(false);
  }, 30_000);

  it('snap deceleration (RFM 4-19, 4-28): 103 % N2, collective down, GEN off, grip snapped to idle: N1 passes 65 % no sooner than 2.0 s, no flame-out', () => {
    const r = rig(2250, { onGround: true }), s = r.fm.state;
    run(r, 3);
    const from = gauges(r);
    r.c.alternator = false; r.c.throttle = GRIP.groundIdle;
    let passed = -1, lit = true;
    run(r, 10, (time) => { if (passed < 0 && (s.engine.ng ?? 0) < 65) passed = time; lit &&= s.engine.lit === true; });
    report.snapDecel = { from, passed };
    expect(from.n2).toBeCloseTo(103, 0);
    expect(passed).toBeGreaterThanOrEqual(2.0); expect(lit).toBe(true);
  });

  for (const from of ['103 %', 'ground idle'] as const) {
    it(`shutdown from ${from}, grip to CUTOFF: needles split within 2 s with the rotor lagging; ENG OUT lit by the time N1 passes 55 % (RFM 4-26)`, () => {
      const r = rig(2250, { onGround: true }), s = r.fm.state, t = s.rotorcraft!.turboshaft!;
      if (from === 'ground idle') { r.c.throttle = GRIP.groundIdle; run(r, 60); }
      r.c.throttle = 0;
      let split = -1, lag = true, lightAt55 = false;
      run(r, 20, (time) => {
        if (split < 0 && t.needlesSplit) split = time;
        if (split >= 0 && time < split + 5) lag &&= t.nrPct >= t.n2Pct - 1e-9;
        if ((s.engine.ng ?? 100) <= 100 * MD500_ENGINE_OUT.n1Below && !lightAt55) lightAt55 = t.engineOutLight;
      });
      report[`shutdown ${from}`] = { split, lightAt55 };
      expect(split).toBeGreaterThanOrEqual(0); expect(split).toBeLessThanOrEqual(2);
      expect(lag).toBe(true); expect(lightAt55).toBe(true);
    }, 30_000);
  }
});

describe('MD 500E N2 governor (RFM 4-18, 4-22; plan 6.6)', () => {
  /** On the ground at flat pitch: beep the set point until N2 reads `target` %. */
  function beepTo(r: ReturnType<typeof rig>, target: number, seconds = 25) {
    const t = r.fm.state.rotorcraft!.turboshaft!;
    run(r, seconds, () => { r.c.n2Beep = Math.max(-1, Math.min(1, (target - t.n2Pct) * 4)); });
    r.c.n2Beep = 0; run(r, 3);
  }

  it('run-up beep range at flat pitch: high stop 104-105 %, low stop 98 % or less (RFM 4-18, P)', () => {
    const r = rig(2250, { onGround: true }), t = r.fm.state.rotorcraft!.turboshaft!;
    r.c.n2Beep = 1; run(r, 15); r.c.n2Beep = 0; run(r, 5);
    const high = t.n2Pct;
    r.c.n2Beep = -1; run(r, 15); r.c.n2Beep = 0; run(r, 5);
    const low = t.n2Pct;
    report.beepRange = { high, low };
    expect(high).toBeGreaterThanOrEqual(MD500_N2_PCT.beepHighMin); expect(high).toBeLessThanOrEqual(105);
    expect(low).toBeLessThanOrEqual(MD500_N2_PCT.beepLowMax);
  }, 30_000);

  it('steady: 103.0 % set at flat pitch, then 87 psi held in a climb: N2 103.5-104.0 % (RFM 4-22, P)', () => {
    const g = rig(2600, { onGround: true });
    beepTo(g, 103);
    const flat = gauges(g), set = flat.set;
    const r = rig(2600, { kt: 60 }), fly = pilot(r, 60);
    r.fm.state.rotorcraft!.turboshaft!.n2SetPct = set;
    run(r, 40, () => { fly(DT); collectiveServo(r.c, 0.02 * (87 - r.fm.state.rotorcraft!.turboshaft!.torquePsi), 1, DT, 0.1); });
    const climb = gauges(r);
    report.governorSteady = { flat, climb };
    expect(flat.n2).toBeCloseTo(103, 1);
    expect(Math.abs(climb.psi - 87)).toBeLessThan(1);
    expect(climb.n2).toBeGreaterThanOrEqual(103.5); expect(climb.n2).toBeLessThanOrEqual(104.0);
  }, 60_000);

  for (const ramp of [2, 1]) {
    it(`transient: hover to about 87 psi in ${ramp} s: N2 min >= ${ramp === 2 ? 100.5 : 98.5} %, no ENG OUT; back within 0.5 % of its steady value in 3 s; then a 1 s dump to flat pitch peaks N2 at most 106 % (ESTIMATE; Fig 2-2)`, () => {
      const r = rig(2600, { height: 1000 }), t = r.fm.state.rotorcraft!.turboshaft!, fly = pilot(r, 0);
      const c0 = r.c.collective!, c1 = c0 + 0.12, n2Before = t.n2Pct;
      let min = Infinity, engOut = false;
      const hist: number[] = [];
      run(r, ramp + 6, (time) => {
        fly(DT); r.c.collective = c0 + (c1 - c0) * Math.min(1, time / ramp);
        min = Math.min(min, t.n2Pct); engOut ||= t.engineOutLight; hist.push(t.n2Pct);
      });
      const settled = hist.at(-1)!, step = Math.round(1 / DT);
      // First time after the ramp from which N2 stays within 0.5 % of its settled value.
      let back = hist.length; for (let i = hist.length - 1; i >= 0 && Math.abs(hist[i] - settled) <= 0.5; i--) back = i;
      const psi = t.torquePsi, cc = r.c.collective!;
      let peak = 0;
      run(r, 8, (time) => { fly(DT); r.c.collective = cc * (1 - Math.min(1, time)); peak = Math.max(peak, t.n2Pct); });
      report[`transient ${ramp} s`] = { n2Before, min, settled, recoveredAfterRamp: Math.max(0, back / step - ramp), psi, dumpPeak: peak };
      expect(psi).toBeGreaterThan(84);
      expect(min).toBeGreaterThanOrEqual(ramp === 2 ? 100.5 : 98.5);
      expect(engOut).toBe(false);
      expect(back / step - ramp).toBeLessThanOrEqual(3);
      expect(peak).toBeLessThanOrEqual(106);
    }, 60_000);
  }
});

describe('MD 500E freewheel and autorotation (RFM 4-17, 4-25, 4-26)', () => {
  it('grip FULL OPEN in autorotation at 60 KIAS, Nr held at 510 rpm: N2 holds the beep set +/- 1 %, never reaches 108 %; needles split (P / AGENT)', () => {
    const r = rig(3000, { kt: 60, height: 3000 }), t = r.fm.state.rotorcraft!.turboshaft!, fly = pilot(r, 60);
    r.c.collective = 0;
    const governed = t.n2Pct;
    let maxN2 = 0, last = r.fm.state.rotorcraft!.rotorRpm, trend = 0;
    run(r, 60, (time) => {
      fly(DT);
      const rpm = r.fm.state.rotorcraft!.rotorRpm;
      trend += ((rpm - last) / DT - trend) * (1 - Math.exp(-DT / 0.3)); last = rpm;
      collectiveServo(r.c, 0.003 * (rpm - 510) + 0.006 * trend, 1, DT, 0.2);
      if (time > 20) maxN2 = Math.max(maxN2, t.n2Pct);
    });
    const g = gauges(r);
    report.autorotationFullOpen = { ...g, maxN2, governedBefore: governed };
    expect(g.nrRpm).toBeGreaterThanOrEqual(MD500_NR_LIMITS.powerOff[0] + 75); expect(g.nrRpm).toBeLessThanOrEqual(MD500_NR_LIMITS.powerOff[1]);
    // Plan 6.6: N2 within 1 % of the beep set point (n2SetPct), the governor unloaded with N1 near ground idle.
    expect(Math.abs(g.n2 - g.set), `N2 ${g.n2.toFixed(2)} % against the set ${g.set.toFixed(2)} %`).toBeLessThanOrEqual(1);
    expect(maxN2).toBeLessThan(108);
    expect(g.split).toBe(true);
    expect(g.psi).toBeLessThan(1);
  }, 60_000);

  it('needles: split by more than 5 % in autorotation with the grip at idle; within 0.5 % in powered flight (RFM 4-17, 4-26, P)', () => {
    const a = rig(2250, { kt: 60, height: 3000 }), fly = pilot(a, 60);
    a.c.throttle = GRIP.groundIdle; a.c.collective = 0;
    run(a, 45, () => fly(DT));
    const idle = gauges(a);
    const p = rig(2600, { kt: 80 });
    run(p, 10);
    const powered = gauges(p);
    report.needles = { idle, powered };
    expect(idle.nr - idle.n2).toBeGreaterThan(5);
    expect(Math.abs(powered.nr - powered.n2)).toBeLessThanOrEqual(0.5);
  }, 60_000);
});

describe('MD 500E engine failure (RFM 3-3; rotor energy, docs/md500-flight-model.md)', () => {
  /** Cruise power at 120 KIAS (the cruise of the sim profile; about 200 kW, the power of the derivation), 3000 lb,
   * then the engine quits (the fuel control shut: an instant flame-out); `downAfter` s later the collective goes
   * fully down in 0.5 s. */
  function failure(downAfter?: number) {
    const r = rig(3000, { kt: 120 }), s = r.fm.state, fly = pilot(r, 120);
    run(r, 2, () => fly(DT));
    // After the failure the pilot slows toward the autorotation speeds (RFM 3-3: 60-80 KIAS) with aft cyclic.
    const glide = pilot(r, 80);
    const before = gauges(r), heading0 = s.heading, c0 = r.c.collective!;
    r.c.throttle = 0;
    const trace: { t: number; nr: number; yaw: number }[] = [];
    let horn = -1, at410 = -1, minNr = Infinity, minAt = 0, backIn = -1;
    run(r, 6, (time) => {
      // Collective held; cyclic and pedals frozen for the first second (the startle), then the pilot's.
      if (time > 1) (downAfter === undefined ? fly : glide)(DT);
      if (downAfter !== undefined && time >= downAfter) r.c.collective = Math.max(0, c0 * (1 - (time - downAfter) / 0.5));
      const nr = s.rotorcraft!.rotorRpm;
      if (horn < 0 && s.rotorcraft!.turboshaft!.engineOutHorn) horn = time;
      if (at410 < 0 && nr < 410) at410 = time;
      if (nr < minNr) { minNr = nr; minAt = time; backIn = -1; }
      if (downAfter !== undefined && backIn < 0 && time > minAt && nr >= 410) backIn = time;
      if (Math.round(time / DT) % 24 === 0) trace.push({ t: time, nr, yaw: Math.atan2(Math.sin(s.heading - heading0), Math.cos(s.heading - heading0)) / DEG });
    });
    return { before, horn, at410, minNr, backIn, trace, yaw1s: trace.find((p) => p.t >= 0.5)!.yaw };
  }

  it('cruise power, collective held: the nose yaws LEFT; Nr 492 -> 468 (horn) in 0.15-0.35 s and -> 410 in 0.7-1.2 s (P sign and horn / DERIVED times)', () => {
    const f = failure();
    report.failureHeld = { before: f.before, horn: f.horn, at410: f.at410, yawHalfSecond: f.yaw1s };
    expect(f.before.nrRpm).toBeCloseTo(492, 0);
    expect(f.yaw1s).toBeLessThan(0);
    expect(f.horn).toBeGreaterThanOrEqual(0.15); expect(f.horn).toBeLessThanOrEqual(0.35);
    expect(f.at410).toBeGreaterThanOrEqual(0.7); expect(f.at410).toBeLessThanOrEqual(1.2);
  });

  it('collective fully down 1.0 s after the failure: Nr minimum at least 380 rpm, back inside 410-523 within 3 s (DERIVED / ESTIMATE)', () => {
    const f = failure(1.0);
    report.failureRecovery = { minNr: f.minNr, backIn: f.backIn, trace: f.trace };
    expect(f.minNr).toBeGreaterThanOrEqual(380);
    expect(f.backIn).toBeGreaterThan(0); expect(f.backIn - 1.0).toBeLessThanOrEqual(3);
  });
});

describe('MD 500E skid gear touchdowns (pilot review 2026-10-17)', () => {
  // From a 3000 lb hover at a 4 deg nose-up attitude, the collective cut to a fraction of its hover value at a set
  // skid height (the FAR 27.725 drop shape: rotor lift below the weight); the contact sink is the last airborne
  // step's. The limit drop (13 in, about 2.55 m/s) and a 2-2.5 m/s touchdown (type experience) survive: ESTIMATE.
  for (const [hFt, frac, minSink] of [[4, 0.75, 1.9], [5, 0.7, 2.45]] as const) {
    it(`drop from ${hFt} ft at ${frac} x hover collective, 3000 lb: contact at ${minSink} m/s or more, no crash, the dampers inside their stroke`, () => {
      const r = rig(3000, { height: d.skids.z + hFt * FT }), s = r.fm.state, fly = pilot(r, 0);
      run(r, 1, () => fly(DT, 4 * DEG));
      r.c.collective = r.c.collective! * frac;
      let sink = NaN, last = 0, maxCompression = 0;
      run(r, 8, () => {
        fly(DT, 4 * DEG);
        if (!s.onGround && !s.crashed) last = -s.verticalSpeed;
        else if (Number.isNaN(sink)) sink = last;
        if (!Number.isNaN(sink)) r.c.collective = Math.max(0, r.c.collective! - 0.3 * DT);
        for (const w of s.wheels) maxCompression = Math.max(maxCompression, w.compression);
      });
      report[`drop${hFt}ft`] = { sink, maxCompression, crashed: s.crashed, reason: s.crashReason };
      expect(sink).toBeGreaterThanOrEqual(minSink);
      expect(s.crashed, s.crashReason).toBe(false);
      expect(maxCompression).toBeLessThan(d.skids.oleo!.maxStroke);
    }, 60_000);
  }
  it('power-off run-on at 30 kt, 3000 lb, about 1 m/s at contact: no crash, stopped on the skids within 10 s (RFM 4-25 technique)', () => {
    const r = rig(3000, { kt: 30, height: d.skids.z + 6 * FT }), s = r.fm.state, fly = pilot(r, 30);
    run(r, 1, () => fly(DT, 2 * DEG));
    r.c.throttle = 0;
    let td = NaN, sink = NaN, gs = NaN, stopped = NaN;
    run(r, 20, () => {
      if (Number.isNaN(td)) { fly(DT, 2 * DEG); collectiveServo(r.c, 0.8 * (-0.6 - s.verticalSpeed), 1, DT, 0.8); }
      else { fly(DT, 3 * DEG); r.c.collective = Math.max(0, r.c.collective! - 0.3 * DT); }
      if (Number.isNaN(td) && s.onGround) { td = s.time; sink = -s.verticalSpeed; gs = s.groundSpeed / KT; }
      if (!Number.isNaN(td) && Number.isNaN(stopped) && s.groundSpeed < 0.5) stopped = s.time - td;
    });
    report.runOn = { sink, gs, stopped, crashed: s.crashed, reason: s.crashReason };
    expect(gs).toBeGreaterThan(27);
    expect(sink).toBeGreaterThan(0.6);
    expect(s.crashed, s.crashReason).toBe(false);
    expect(stopped).toBeLessThan(10);
  }, 60_000);
});

describe('MD 500E warnings and resume', () => {
  it('ENGINE OUT: horn needs the generator switch ON; RE-IGN latches with transmission pressure and resets with the light pressed once N1 and Nr are back (RFM 1-12, 3-25)', () => {
    const r = rig(2600, { kt: 60, height: 2000 }), t = r.fm.state.rotorcraft!.turboshaft!, fly = pilot(r, 60), c0 = r.c.collective!;
    expect(t.engineOutLight).toBe(false);
    // A flame-out (the fuel control shut for an instant), the grip back to FULL OPEN at once; the pilot lowers the
    // collective for 2 s, then flies on.
    r.c.throttle = 0; run(r, 0.05); r.c.throttle = 1; r.c.collective = 0.1;
    run(r, 1, () => fly(DT));
    expect(t.engineOutLight).toBe(true); expect(t.engineOutHorn).toBe(true); expect(t.reignitionLight).toBe(true);
    r.c.alternator = false; run(r, 0.1, () => fly(DT));
    expect(t.engineOutHorn).toBe(false);
    // The igniter fires while RE-IGN is lit: the engine relights on its own and the governor brings it back.
    r.c.alternator = true;
    run(r, 25, (time) => { fly(DT); if (time > 1) r.c.collective = c0; })
    const relit = { lit: r.fm.state.engine.lit, n1: r.fm.state.engine.ng, light: t.engineOutLight, reign: t.reignitionLight };
    r.c.lampTestId = 'reign'; run(r, 0.1); r.c.lampTestId = undefined;
    report.warnings = { relit, reignAfterReset: t.reignitionLight };
    expect(relit.lit).toBe(true); expect(relit.light).toBe(false); expect(relit.reign).toBe(true);
    expect(t.reignitionLight).toBe(false);
  }, 30_000);

  it('low rotor in flight: full collective with the grip at idle from a 3000 lb hover: ENG OUT light and horn stay on however low Nr falls while airborne (RFM 3-3, P / AGENT)', () => {
    const r = rig(3000, { height: 1500 }), s = r.fm.state, t = s.rotorcraft!.turboshaft!;
    r.c.throttle = GRIP.groundIdle; r.c.collective = 1;
    let lit = -1, minRpm = Infinity, offWhileLow = 0, airborne = true, minN1 = Infinity;
    run(r, 6, (time) => {
      const rpm = s.rotorcraft!.rotorRpm;
      if (lit < 0 && t.engineOutLight) lit = time;
      if (lit >= 0) { minRpm = Math.min(minRpm, rpm); minN1 = Math.min(minN1, s.engine.ng ?? 0); airborne &&= !s.onGround;
        if (rpm < MD500_ENGINE_OUT.nrBelowRpm && !(t.engineOutLight && t.engineOutHorn)) offWhileLow += DT; }
    });
    report.lowRotorInFlight = { lit, minRpm, minNrPct: 100 * minRpm / d.referenceRpm, minN1, offWhileLow, airborne };
    expect(lit).toBeGreaterThanOrEqual(0);
    expect(airborne).toBe(true);
    // The case the review reproduced: below 70 % Nr (334 rpm) with N1 well above 55 %.
    expect(minRpm).toBeLessThan(0.7 * d.referenceRpm); expect(minN1).toBeGreaterThan(55);
    expect(offWhileLow).toBe(0);
  }, 30_000);

  it('low rotor on the ground: grip to ground idle from 103 %: the ENG OUT light and horn go out as Nr runs down to idle (RFM 4-16, P)', () => {
    const r = rig(2250, { onGround: true }), s = r.fm.state, t = s.rotorcraft!.turboshaft!;
    r.c.throttle = GRIP.groundIdle;
    let litOnTheWay = false;
    run(r, 60, () => { litOnTheWay ||= t.engineOutLight; });
    const g = gauges(r);
    report.lowRotorOnGround = { litOnTheWay, nr: g.nr, n1: g.n1, light: t.engineOutLight, horn: t.engineOutHorn, onGround: s.onGround };
    expect(s.onGround).toBe(true);
    expect(g.nr).toBeLessThan(70);
    expect(t.engineOutLight).toBe(false); expect(t.engineOutHorn).toBe(false);
  }, 30_000);

  it('resume: a mid-hover snapshot through JSON restores with no Nr or N1 step above 0.2 % and the five-blade pose accepted (AGENT)', () => {
    const w = calmWeather();
    const a = new SimPhysics({ aircraft: def, weather: w });
    a.resetTo(hoverScenario(a.env, d));
    a.step(5);
    const snap = a.captureSnapshot({ weather: w, cameraMode: 'chase', quality: 'high', renderScale: null, resume: true, now: 1_800_000_000_000 });
    expect(snap.systems.rotorcraft?.articulated?.blades.length).toBe(5);
    expect(snap.systems.rotorcraft?.turboshaft).toBeDefined();
    snap.controls.n2Beep = 1;
    const back = parseSnapshot(JSON.stringify(snap));
    expect(back).not.toBeNull();
    expect(back!.controls.n2Beep).toBe(0);
    const b = new SimPhysics({ aircraft: def, weather: { ...back!.weather } });
    b.restore(back!);
    const nr0 = a.state.rotorcraft!.rotorRpm, n10 = a.state.engine.ng!;
    const nrB = b.state.rotorcraft!.rotorRpm;
    b.step(0.5); a.step(0.5);
    const after = { nrA: a.state.rotorcraft!.rotorRpm, nrB: b.state.rotorcraft!.rotorRpm, n1A: a.state.engine.ng!, n1B: b.state.engine.ng! };
    report.resume = { nr0, n10, nrB, after };
    expect(Math.abs(nrB / nr0 - 1)).toBeLessThan(0.002);
    expect(Math.abs(after.nrB / after.nrA - 1)).toBeLessThan(0.002);
    expect(Math.abs(after.n1B / after.n1A - 1)).toBeLessThan(0.002);
    // A corrupt turboshaft block or a set point outside the beep range is rejected.
    const bad = JSON.parse(JSON.stringify(snap));
    bad.systems.rotorcraft.turboshaft.n2SetPct = 120;
    expect(parseSnapshot(JSON.stringify(bad))).toBeNull();
    const badReverse = JSON.parse(JSON.stringify(snap)); badReverse.controls.reverse = 2;
    expect(parseSnapshot(JSON.stringify(badReverse))).toBeNull();
  }, 30_000);

  it('resume mid collective transient: the governor rate term is persisted, the restored torque follows the original within 0.01 psi over 1 s (AGENT)', () => {
    const w = calmWeather();
    const a = new SimPhysics({ aircraft: def, weather: w });
    // The typical payload: a snapshot does not carry the payload and restore() reloads the default (typical), so the
    // demo hover's max-gross payload (1361 kg) would come back at 953 kg and confound the comparison. That gap is older
    // than the turboshaft (main) and affects every type's resume of a non-default payload.
    a.resetTo({ ...hoverScenario(a.env, d), payload: 'typical' });
    a.step(3);
    // A brisk collective raise: N2 droops and the governor's rate term is working when the snapshot is taken (0.1 s
    // in). Without the persisted rate the restored torque leaves the original by 0.19 psi and N1 by 0.014 % within 1 s.
    a.controls.collective = (a.controls.collective ?? 0) + 0.08;
    a.step(0.1);
    const snap = a.captureSnapshot({ weather: w, cameraMode: 'chase', quality: 'high', renderScale: null, resume: true, now: 1_800_000_000_000 });
    const t = snap.systems.rotorcraft!.turboshaft!;
    expect(Math.abs(t.n2Rate ?? 0)).toBeGreaterThan(1e-4);
    const back = parseSnapshot(JSON.stringify(snap));
    expect(back).not.toBeNull();
    const b = new SimPhysics({ aircraft: def, weather: { ...back!.weather } });
    b.restore(back!);
    let maxDpsi = 0;
    for (let i = 0; i < 20; i++) {
      a.step(0.05); b.step(0.05);
      maxDpsi = Math.max(maxDpsi, Math.abs(a.state.rotorcraft!.turboshaft!.torquePsi - b.state.rotorcraft!.turboshaft!.torquePsi));
    }
    report.resumeTransient = { n2Rate: t.n2Rate, maxDpsi };
    expect(maxDpsi).toBeLessThan(0.01);
    // A non-finite or negative governor memory is rejected.
    const bad = JSON.parse(JSON.stringify(snap)); bad.systems.rotorcraft.turboshaft.n2Last = -1;
    expect(parseSnapshot(JSON.stringify(bad))).toBeNull();
  }, 30_000);
});

