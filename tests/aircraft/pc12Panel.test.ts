// The Pilatus PC-12/47 analogue panel, EIS, CAWS, UI, training and dev mock (src/aircraft/pc12/{panel,panelLayout,ui,training,
// checklists,devMock}.ts) against the facts and the code they read.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeMockState } from '../../src/core/mockState';
import { defaultControls, defaultWeather } from '../../src/core/types';
import { devMock } from '../../src/aircraft/pc12/devMock';
import {
  PC12_GEN_AMPS, PC12_ITT_C, PC12_NG_MAX, PC12_NP_PROHIBITED, PC12_NP_TRANSIENT, PC12_TORQUE_PSI, pc12TorquePsi, PC12_GEAR_RATIO, PC12_PSI_PER_NM,
} from '../../src/aircraft/pc12/facts';
import {
  PC12_ASI_MARKS, PC12_CABIN_SCHEDULE, PC12_CAWS_LAMPS, PC12_CAWS_MODELLED, PC12_INSTRUMENT_SYSTEMS, PC12_MAX_DIFF_PSI, PC12_PANEL,
} from '../../src/aircraft/pc12/panel';
import { PC12_CAWS, PC12_EIS, PC12_PANEL_PX_RECT, PC12_PANEL_SIZE, PC12_PEDESTAL, PC12_YOKES } from '../../src/aircraft/pc12/panelLayout';
import { PC12_REFERENCE } from '../../src/aircraft/pc12/reference';
import { PC12 } from '../../src/aircraft/pc12/training';
import { PC12_UI, pc12ConditionLabel, pc12PowerLabel } from '../../src/aircraft/pc12/ui';
import { PC12_EXTRA_CHECKLISTS, psiToFtLb } from '../../src/aircraft/pc12/checklists';
import { CabinDisplay, standardAltitudeFt, standardPressurePsi } from '../../src/instruments/dynamics/cabinDisplay';
import { InstrumentSet } from '../../src/instruments/dynamics/instrumentSet';
import { buildHotspots } from '../../src/instruments/hotspots';
import { InstrumentPanel } from '../../src/instruments/panel';
import type { Rect } from '../../src/instruments/panelDef';
import { panelLayoutProblems } from '../../src/instruments/panelLayout';
import { gaugeParts, panelParts } from '../../src/instruments/panelParts';
import type { PanelComponent } from '../../src/instruments/render/component';
import { EisWindow } from '../../src/instruments/render/eisWindow';
import { AttitudeGauge } from '../../src/instruments/render/gyroGauges';
import { fixedSections, fitPanel } from '../../src/instruments/fixedPanel';
import { livePredicate } from '../../src/ui/checklistModel';
import { stubCanvas } from '../instruments/stubCanvas';

afterEach(() => vi.unstubAllGlobals());

const ptNm = (psi: number): number => psi / (PC12_GEAR_RATIO * PC12_PSI_PER_NM);

/** A running PT6 at the given torque (psi), ITT and Ng, on a powered bus. */
function fixture(psi = 30, itt = 650, ng = 90) {
  const s = makeMockState(), c = defaultControls();
  s.engine.running = true; s.engine.rpm = 29_894; s.engine.propRpm = 1700;
  s.engine.torque = ptNm(psi); s.engine.itt = itt; s.engine.ng = ng; s.engine.oilPressure = 90; s.engine.oilTemp = 70; s.engine.fuelPressure = 30;
  s.electrical.busVoltage = 28.2; s.electrical.alternators[0] = 80; s.electrical.alternators[1] = 12;
  s.fuel.left = 140; s.fuel.right = 140;
  const set = new InstrumentSet({ systems: PC12_INSTRUMENT_SYSTEMS });
  const step = (seconds = 3) => {
    for (let t = 0; t < seconds; t += 1 / 60) set.step(1 / 60, s, c, defaultWeather());
    return set.readings;
  };
  return { s, c, set, step };
}

describe('PC-12 panel layout', () => {
  it('has no layout problems, hotspots included, and keeps the shared names', () => {
    expect(panelLayoutProblems(PC12_PANEL, PC12_PANEL_PX_RECT, buildHotspots(PC12_PANEL))).toEqual([]);
    expect(PC12_PANEL.size).toEqual(PC12_PANEL_SIZE);
    expect(PC12_PANEL.keepOut).toHaveLength(2);
    expect(PC12_YOKES.xs[0]).toBe(PC12_PANEL_SIZE.w / 2 - 0.4 * 2000);
    expect(PC12_PEDESTAL.levers.power).toBeGreaterThan(PC12_PEDESTAL.x0);
    expect(PC12_PEDESTAL.levers.flaps).toBeLessThan(PC12_PEDESTAL.x1);
  });

  it('is a 3 x 3 EIS and a 6 x 8 CAWS with a lens for every cell', () => {
    const eis = PC12_PANEL.gauges.filter((g) => g.kind === 'eisWindow');
    expect(eis.map((g) => g.id)).toEqual(['eisTq', 'eisItt', 'eisNg', 'eisFuelFlow', 'eisFuelQty', 'eisNp', 'eisBat', 'eisGen', 'eisOil']);
    for (const g of eis) {
      const b = (g as { bounds: Rect }).bounds;
      expect(b.w).toBe(PC12_EIS.cell);
      expect(b.x).toBeGreaterThanOrEqual(PC12_EIS.x0);
      expect(b.x + b.w).toBeLessThanOrEqual(PC12_EIS.x0 + 3 * PC12_EIS.cell);
    }
    expect(PC12_CAWS_LAMPS).toHaveLength(PC12_CAWS.cols * PC12_CAWS.rows);
    expect(PC12_PANEL.annunciator?.columns).toBe(6);
    // Every modelled lens is a legend of the grid and a lamp of the instrument systems.
    const ids = new Set(PC12_INSTRUMENT_SYSTEMS.lamps.map((l) => l.id));
    for (const id of PC12_CAWS_MODELLED) { expect(PC12_CAWS_LAMPS.some((l) => l.id === id), id).toBe(true); expect(ids.has(id), id).toBe(true); }
    for (const l of PC12_CAWS_LAMPS) if (l.text) expect(ids.has(l.id), l.id).toBe(true);
  });

  it('keeps every placard inside the face and clear of instruments and controls', () => {
    const parts = panelParts(PC12_PANEL).flatMap((p) => p.paintRects ?? [p.rect]);
    const placed: Rect[] = [];
    const overlaps = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    for (const p of PC12_PANEL.background.placards) {
      const size = p.size ?? 7.5;
      const w = Math.max(...p.lines.map((l) => l.length)) * size * 0.52 + 14;
      const r = { x: p.x - w / 2, y: p.y, w, h: p.lines.length * (size + 3) + 10 };
      expect(r.x >= 0 && r.y >= 0 && r.x + r.w <= PC12_PANEL_SIZE.w && r.y + r.h <= PC12_PANEL_SIZE.h, p.lines[0]).toBe(true);
      for (const o of [...parts, ...placed]) expect(overlaps(r, o), p.lines[0]).toBe(false);
      placed.push(r);
    }
  });

  it('builds a flat Upper view with the EIS whole and the instruments at least 120 CSS px at 1366 x 768', () => {
    const sections = fixedSections(PC12_PANEL);
    const eis = { x: PC12_EIS.x0, y: PC12_EIS.y0, w: 3 * PC12_EIS.cell, h: 3 * PC12_EIS.cell };
    expect(sections.upper.panes.some((p) => p.source.x === eis.x && p.source.y === eis.y && p.source.w === eis.w && p.source.h === eis.h)).toBe(true);
    // The EIS windows are not placed a second time.
    expect(sections.lower.panes.some((p) => p.source.w === PC12_EIS.cell && p.source.h === PC12_EIS.cell)).toBe(false);
    expect(172 * fitPanel(sections.upper, 1366, 768).scale).toBeGreaterThanOrEqual(120);
  });

  it('draws every component in its bounds and prints the stabilised-propeller placard', () => {
    const stub = stubCanvas();
    const panel = new InstrumentPanel({ def: PC12_PANEL, systems: PC12_INSTRUMENT_SYSTEMS });
    const components = (panel as unknown as { components: PanelComponent[] }).components;
    // The rack units (radios, GPS) have an intrinsic size of their own.
    for (const g of PC12_PANEL.gauges.filter((x) => !['gps', 'navcom', 'xpdr'].includes(x.kind))) {
      const c = components.find((x) => x.id === g.id);
      expect(c, g.id).toBeDefined();
      expect(c!.bounds, g.id).toEqual(gaugeParts(g, PC12_PANEL.apertures, PC12_PANEL.instrumentScale)[0].rect);
    }
    expect(stub.texts.join(' ')).toContain('BETWEEN 350 AND 950 RPM IS PROHIBITED');
    panel.dispose();
  });
});

describe('PC-12 markings', () => {
  it('has the airspeed arcs of the reference table and no yellow arc', () => {
    expect(PC12_ASI_MARKS.redLine).toBe(PC12_REFERENCE.vne);
    expect(PC12_ASI_MARKS.arcs).toContainEqual({ from: PC12_REFERENCE.vs1, to: PC12_REFERENCE.vne, color: 'green' });
    expect(PC12_ASI_MARKS.arcs.some((a) => a.color === 'yellow')).toBe(false);
    const kt = PC12_ASI_MARKS.scaleKt, deg = PC12_ASI_MARKS.scaleDeg;
    for (let i = 1; i < kt.length; i++) { expect(kt[i]).toBeGreaterThan(kt[i - 1]); expect(deg[i]).toBeGreaterThan(deg[i - 1]); }
  });

  it('marks the EIS dials with the limits of facts.ts', () => {
    const win = (id: string) => PC12_PANEL.gauges.find((g) => g.id === id) as Extract<(typeof PC12_PANEL.gauges)[number], { kind: 'eisWindow' }>;
    expect(win('eisTq').dial!.redLines).toEqual([PC12_TORQUE_PSI.takeoff]);
    expect(win('eisTq').dial!.arcs).toContainEqual({ from: 0, to: PC12_TORQUE_PSI.mcp, color: 'green' });
    expect(win('eisTq').dial!.arcs).toContainEqual({ from: PC12_TORQUE_PSI.transient, to: 70, color: 'red' });
    expect(win('eisItt').dial!.redLines).toEqual([PC12_ITT_C.takeoff, PC12_ITT_C.start]);
    expect(win('eisNg').dial!.redLines).toEqual([PC12_NG_MAX * 100]);
    expect(win('eisNp').dial!.arcs).toContainEqual({ from: PC12_NP_PROHIBITED[0], to: PC12_NP_PROHIBITED[1], color: 'red' });
    expect(win('eisNp').dial!.redLines).toEqual([PC12_NP_TRANSIENT]);
  });
});

describe('PC-12 EIS', () => {
  it('shows torque in psi through pc12TorquePsi, ITT, Ng and Np of the engine readings', () => {
    const stub = stubCanvas(); void stub;
    const { step, c } = fixture(36.95, 740, 98);
    c.alternator = true;
    const r = step(20);
    const comps = new Map<string, EisWindow>(PC12_PANEL.gauges.filter((g) => g.kind === 'eisWindow').map((g) => [g.id, new EisWindow(g as never)]));
    for (const w of comps.values()) w.sample(r, c, 0);
    expect(Math.abs(comps.get('eisTq')!.shown().readouts[0] - pc12TorquePsi(ptNm(36.95)))).toBeLessThan(0.06);
    expect(Math.abs(comps.get('eisTq')!.shown().readouts[0] - 36.95)).toBeLessThan(0.06);
    expect(comps.get('eisItt')!.shown().readouts[0]).toBeCloseTo(740, -1);
    expect(comps.get('eisNg')!.shown().readouts[0]).toBeCloseTo(98, 0);
    expect(comps.get('eisNp')!.shown().readouts[0]).toBeCloseTo(1700, -1);
    expect(comps.get('eisGen')!.shown().readouts[1]).toBeLessThan(PC12_GEN_AMPS[1]);
    expect(comps.get('eisFuelQty')!.shown().bars[0]).toBeGreaterThan(0);
  });

  it('is dark with the bus dead', () => {
    stubCanvas();
    const { s, step, c } = fixture();
    s.electrical.busVoltage = 0;
    const r = step();
    const w = new EisWindow(PC12_PANEL.gauges.find((g) => g.id === 'eisTq') as never);
    w.sample(r, c, 0);
    expect(w.shown().powered).toBe(false);
  });
});

describe('PC-12 CAWS', () => {
  const lit = (id: string, r: Record<string, boolean>) => r[id];

  it('lights the modelled lenses from the state and leaves the rest unlit', () => {
    const { s, c, step } = fixture();
    let r = step();
    expect(lit('esntlBus', r.lamps)).toBe(false);
    expect(lit('propLowP', r.lamps)).toBe(false);
    expect(lit('gen1Off', r.lamps)).toBe(false);
    expect(lit('starter', r.lamps)).toBe(false);
    expect(lit('oilQty', r.lamps)).toBe(false);
    s.stickPusher = true; s.onGround = false; s.propellers[0].beta = true; c.starter = true; c.gearEmergency = true;
    s.electrical.alternators[0] = 0; s.fuel.left = 20;
    r = step(1);
    for (const id of ['pusher', 'propLowP', 'starter', 'ignition', 'hydr', 'gen1Off', 'leftFuelLow']) expect(lit(id, r.lamps), id).toBe(true);
    expect(lit('oilQty', r.lamps)).toBe(false);
    // PROP LOW P needs the air: on the ground in beta it stays out.
    s.onGround = true;
    expect(lit('propLowP', step(1).lamps)).toBe(false);
  });

  it('lights every lens for the lamp test, and none with the bus dead', () => {
    const { s, c, step } = fixture();
    c.annunciatorTest = true;
    const r = step(1);
    for (const l of PC12_CAWS_LAMPS) if (l.text) expect(r.lamps[l.id], l.id).toBe(true);
    s.electrical.busVoltage = 0;
    const dark = step(1);
    for (const l of PC12_CAWS_LAMPS) if (l.text) expect(dark.lamps[l.id], l.id).toBe(false);
  });

  it('lights ESNTL BUS and N ESSNTL BUS below 22 V', () => {
    const { s, step } = fixture();
    s.electrical.busVoltage = 21;
    const r = step(1);
    expect(r.lamps.esntlBus && r.lamps.nEssntlBus).toBe(true);
  });
});

describe('PC-12 cabin display', () => {
  /** Static pressure, Pa, of a standard-atmosphere pressure altitude, ft. */
  const staticPa = (ft: number): number => standardPressurePsi(ft) * 6894.757;

  it('follows the 47E schedule and the 5.75 psid limit', () => {
    const d = new CabinDisplay(PC12_CABIN_SCHEDULE);
    for (const [alt, cab] of [[30_000, 10_000], [25_000, 7379], [20_000, 5315], [15_000, 3680], [10_000, 2252]] as const) expect(d.target(alt)).toBeCloseTo(cab, 6);
    expect(d.target(0)).toBe(0);
    expect(d.target(1500)).toBe(1500);
    d.reset(30_000);
    expect(d.diffPsi(30_000)).toBeGreaterThan(5.5);
    expect(d.diffPsi(30_000)).toBeLessThanOrEqual(PC12_MAX_DIFF_PSI);
    expect(standardPressurePsi(0)).toBeCloseTo(14.696, 2);
    expect(standardAltitudeFt(standardPressurePsi(12_345))).toBeCloseTo(12_345, 3);
  });

  it('moves at no more than 500 ft/min while the differential is inside the limit', () => {
    const e = new CabinDisplay(PC12_CABIN_SCHEDULE);
    e.reset(10_000);
    for (let i = 0; i < 60; i++) e.step(1, 15_000);
    expect(e.cabinAltFt - 2252).toBeCloseTo(500, 3);
  });

  it('never shows more than 5.75 psid in a 1650 ft/min climb from sea level to FL300 (the valve relieves the cabin)', () => {
    const d = new CabinDisplay(PC12_CABIN_SCHEDULE);
    const fpm = 1650, dt = 0.1;
    let alt = 0, peak = 0, unclampedPeak = 0;
    const free = new CabinDisplay({ ...PC12_CABIN_SCHEDULE, maxDiffPsi: undefined });
    d.reset(0); free.reset(0);
    while (alt < 30_000) {
      alt = Math.min(30_000, alt + (fpm / 60) * dt);
      d.step(dt, alt); free.step(dt, alt);
      peak = Math.max(peak, d.diffPsi(alt));
      unclampedPeak = Math.max(unclampedPeak, free.diffPsi(alt));
      // The cabin pressure itself honours the limit, not only the needle.
      expect(standardPressurePsi(d.cabinAltFt) - standardPressurePsi(alt)).toBeLessThanOrEqual(PC12_MAX_DIFF_PSI + 1e-9);
    }
    expect(unclampedPeak).toBeGreaterThan(6); // the reviewer's 6.09 psid without the limit
    expect(peak).toBeCloseTo(PC12_MAX_DIFF_PSI, 6);
    // At FL300 the limit holds the cabin at or above 9981 ft (the schedule's 10 000 ft is 5.74 psid).
    expect(d.cabinAltFt).toBeGreaterThanOrEqual(standardAltitudeFt(standardPressurePsi(30_000) + PC12_MAX_DIFF_PSI) - 1e-6);
    expect(d.cabinAltFt).toBeGreaterThan(9975);
  });

  it('is stepped by the instruments in every view and put on the schedule by a reset (teleport, resume)', () => {
    const { s, set, step } = fixture();
    s.staticPressure = staticPa(30_000);
    set.reset(s);
    expect(set.readings.cabinAltFt).toBe(0); // published by the next step
    const r = step(1);
    expect(Math.abs(r.cabinAltFt - 10_000)).toBeLessThan(20); // the altimeter's pressure altitude, a few ft off the table
    expect(r.cabinDiffPsi).toBeGreaterThan(5.7);
    expect(r.cabinDiffPsi).toBeLessThanOrEqual(PC12_MAX_DIFF_PSI);
    // Descend to FL150: the cabin comes down at 500 ft/min, not at once.
    s.staticPressure = staticPa(15_000);
    const before = set.readings.cabinAltFt;
    expect(before - step(60).cabinAltFt).toBeCloseTo(500, 0);
    // The gauge scales read the readings.
    const cabin = PC12_PANEL.gauges.find((g) => g.id === 'cabin');
    expect(cabin?.kind).toBe('dual');
    if (cabin?.kind === 'dual') {
      expect(cabin.left.read?.(r)).toBeCloseTo(r.cabinAltFt / 1000, 9);
      expect(cabin.right.read?.(r)).toBe(r.cabinDiffPsi);
    }
  });
});

describe('PC-12 FUEL USED', () => {
  const LB_PER_GAL = 6.7;
  const used = (r: { fuelUsedGal: number }): number => r.fuelUsedGal * LB_PER_GAL;
  it('counts the drop since the last reset and re-bases to 0 on a refuel, also a partial one (400 -> 300 -> 350 gal)', () => {
    const { s, set, step } = fixture();
    const kg = PC12_INSTRUMENT_SYSTEMS.fuel.kgPerGal;
    const total = (gal: number) => { s.fuel.left = (gal / 2) * kg; s.fuel.right = (gal / 2) * kg; };
    total(400);
    expect(used(step(1))).toBeCloseTo(0, 6);
    total(300);
    expect(used(step(1))).toBeCloseTo(100 * LB_PER_GAL, 3);
    total(350); // partial refuel
    expect(used(step(1))).toBeCloseTo(0, 6);
    total(340);
    expect(used(step(1))).toBeCloseTo(10 * LB_PER_GAL, 3);
    set.reset(s);
    expect(used(set.readings)).toBe(0);
    total(330);
    expect(used(step(1))).toBeCloseTo(0, 6); // the first step after a reset bases at the quantity then
    // The EIS readout reads it.
    const ff = PC12_PANEL.gauges.find((g) => g.id === 'eisFuelFlow');
    if (ff?.kind !== 'eisWindow') throw new Error('eisFuelFlow');
    total(320);
    const r = step(1);
    expect(ff.readouts[1].read(r)).toBeCloseTo(10 * LB_PER_GAL, 3);
    // Two instrument sets do not share it (no module state).
    const other = fixture();
    expect(other.step(1).fuelUsedGal).toBe(0);
  });
});

describe('PC-12 slip indication', () => {
  it('puts an inclinometer on the pilot, co-pilot and standby attitude indicators, and the ball moves with the slip', () => {
    const adis = PC12_PANEL.gauges.filter((g) => g.kind === 'attitude');
    expect(adis.map((g) => g.id).sort()).toEqual(['attitude', 'attitude2', 'attitudeSb']);
    for (const g of adis) expect(g.kind === 'attitude' && g.inclinometer, g.id).toBe(true);
    const { s, step } = fixture();
    const gauge = new AttitudeGauge('attitude', 400, 300, 74, true);
    gauge.sample(step(1));
    expect(gauge.sample(step(0.1))).toBe(false);
    s.slipBall = 0.5;
    expect(gauge.sample(step(2))).toBe(true);
    expect(step(2).ball).toBeCloseTo(0.5, 2);
    const [x0] = gauge.tubePoint(0), [x1, y1] = gauge.tubePoint(0.5);
    expect(x1).toBeGreaterThan(x0); // ball right for a right slip indication
    expect(y1).toBeLessThan(gauge.tubePoint(0)[1]); // and up the curved tube
    // An attitude indicator without the flag latches no ball.
    const plain = new AttitudeGauge('a', 400, 300, 74);
    plain.sample(step(1));
    s.slipBall = -0.5;
    expect(plain.sample(step(2))).toBe(false);
  });
});

describe('PC-12 training speeds', () => {
  it('Vs1 is the flaps-up pusher speed, Vr the flaps-15 one is above Vs0, low-and-slow sits under Vref', () => {
    expect(PC12.vspeeds.Vs1).toBe(95);
    expect(PC12.vspeeds.Vs1).toBe(PC12_REFERENCE.vs1);
    expect(PC12.vspeeds.Vr).toBeGreaterThanOrEqual(PC12.vspeeds.Vs0);
    const low = PC12.envelope.lowAndSlow.belowKias;
    expect(low).toEqual({ vspeed: 'Vs0', add: 10 });
    expect(PC12.vspeeds.Vs0 + 10).toBeLessThan(PC12.vspeeds.Vref);
  });
});

describe('PC-12 UI', () => {
  it('has no propeller lever bar and letters BETA / REV aft of the gate', () => {
    expect(PC12_UI.hud.levers.map((l) => l.label)).toEqual(['PWR', 'COND', 'FLAPS', 'TRIM']);
    const c = defaultControls();
    expect(pc12PowerLabel(c, 0.2)).toBe('IDLE');
    c.throttle = 0.5;
    expect(pc12PowerLabel(c, 0.2)).toBe('50%');
    c.throttle = 0; c.reverse = 0.3;
    expect(pc12PowerLabel(c, 0.1)).toBe('BETA');
    expect(pc12PowerLabel(c, -0.1)).toBe('REV');
  });

  it('letters the condition lever detents', () => {
    expect([0, 0.1, 0.3, 0.7, 1].map(pc12ConditionLabel)).toEqual(['CUT-OFF', 'GND IDLE', 'GND IDLE', '70%', 'FLT IDLE']);
  });

  it('reads torque in psi, and advises the PC-12 start', () => {
    const s = makeMockState();
    s.engine.torque = ptNm(44.34);
    expect(PC12_UI.hud.readouts.find((r) => r.label === 'TRQ')!.text(s)).toBe('44.3');
    const c = defaultControls();
    c.masterBattery = false;
    expect(PC12_UI.starterAdvice(c, 0)).toMatch(/battery/i);
    c.masterBattery = true; c.throttle = 0.5;
    expect(PC12_UI.starterAdvice(c, 0)).toMatch(/IDLE/);
    c.throttle = 0; c.fuelPump = false;
    expect(PC12_UI.starterAdvice(c, 0)).toMatch(/FUEL PUMPS/);
    c.fuelPump = true; c.mixture = 0;
    expect(PC12_UI.starterAdvice(c, 0)).toBe('Press STARTER once; condition lever to GROUND IDLE at 13 % Ng (Shift+M briefly); the starter cuts out at 50 % Ng. ITT 1000 °C for 5 s at most.');
    c.mixture = 0.3;
    expect(PC12_UI.starterAdvice(c, 0)).toBeNull();
  });
});

describe('PC-12 training data', () => {
  it('takes its speeds from the reference table', () => {
    const v = PC12.vspeeds, R = PC12_REFERENCE;
    expect([v.Vs0, v.Vr, v.Vx, v.Vy, v.Vref, v.Vapp, v.Vne, v.Vno, v.Va, v.Vglide]).toEqual([R.vs0, R.vr, R.vx, R.vy, R.vref, R.vapp, R.vne, R.vne, R.va, R.vglide]);
    expect(v.Vne).toBe(236);
    expect(PC12.school?.syllabus).toBe(false);
    expect(PC12.flapDetentsDeg).toEqual([0, 15, 30, 40]);
    expect(PC12.flapLeverForDeg[40]).toBe(1);
  });

  it('has no propeller-lever or fuel-selector item anywhere', () => {
    for (const list of Object.values(PC12.checklists)) for (const it of list.items) {
      expect(`${it.challenge} ${it.response}`, `${list.id}.${it.id}`).not.toMatch(/propeller lever|fuel (tank )?selector/i);
      expect(String(it.key ?? ''), `${list.id}.${it.id}`).not.toMatch(/prop(Increase|Decrease|Feather)|fuelSelector/);
    }
    expect(PC12.checklists.landing.items.map((i) => i.response).join(' ')).toMatch(/reverse/i);
    expect(PC12.checklists.taxi.items.map((i) => i.response).join(' ')).toMatch(/beta/i);
    expect(PC12.checklists.takeoff.items.map((i) => i.challenge + i.response).join(' ')).toMatch(/RUDDER TRIM/);
  });

  it('cites the 47E POH as paraphrase', () => {
    for (const list of Object.values(PC12.checklists)) expect((list as { source?: string }).source, list.id).toMatch(/PC-12\/47E POH|TCDS/);
    expect(PC12_EXTRA_CHECKLISTS.landing.source).toMatch(/paraphrased/);
  });

  it('turns the live predicates on for the audited lever items and not for the start sequence', () => {
    const section = PC12.checklists.engineStart;
    const idle = PC12.checklists.beforeStart.items.find((i) => i.id === 'powerIdle')!;
    expect(livePredicate(idle, PC12.checklists.beforeStart, PC12)).not.toBeNull();
    const cond = PC12.checklists.beforeStart.items.find((i) => i.id === 'conditionCutoff')!;
    expect(livePredicate(cond, PC12.checklists.beforeStart, PC12)).not.toBeNull();
    const starter = section.items.find((i) => i.id === 'conditionStart')!;
    expect(livePredicate(starter, section, PC12)).toBeNull();
    const up = PC12.checklists.afterTakeoff.items.find((i) => i.id === 'flapsUp')!;
    expect(livePredicate(up, PC12.checklists.afterTakeoff, PC12)).toBeNull();
    const gear = PC12.checklists.final.items.find((i) => i.id === 'gear')!;
    expect(livePredicate(gear, PC12.checklists.final, PC12)).toEqual({ sig: 'checklist.gearDown', eq: true });
    expect(psiToFtLb(44.34)).toBeCloseTo(3708, 3);
  });
});

describe('PC-12 dev mock', () => {
  it('writes turboprop readings the EIS shows, and the beta flag aft of the gate', () => {
    stubCanvas();
    vi.stubGlobal('location', { search: '?reverse=0.5' });
    const s = makeMockState(), c = defaultControls();
    s.engine.running = true; s.engine.rpm = 2000; s.onGround = true;
    devMock(s, c, 60, undefined);
    expect(c.reverse).toBe(0.5);
    expect(s.propellers[0].beta).toBe(true);
    expect(pc12TorquePsi(s.engine.torque)).toBeCloseTo(34.25 * 0.5, 1);
    vi.stubGlobal('location', { search: '' });
    c.throttle = 1;
    devMock(s, c, 60, undefined);
    expect(pc12TorquePsi(s.engine.torque)).toBeCloseTo(PC12_TORQUE_PSI.takeoff, 1);
    expect(s.engine.itt).toBeLessThanOrEqual(PC12_ITT_C.takeoff);
  });
});
