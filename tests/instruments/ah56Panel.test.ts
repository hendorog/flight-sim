// Lockheed AH-56A Cheyenne rear-seat pilot panel: markings, tapes, indicators and lamps (package PN). The panel is an AGENT
// RECONSTRUCTION (UNVERIFIED: no photograph of the rear panel exists); the band boundaries are the published limits of ASTA-72 (USAASTA
// 72-08 SoF para 5; ICS aircraft), AMCS-73 (USAASTA 72-44) and APE-I (USAASTA 70-02 SoF 1.1).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AH56_ANNUNCIATOR_LAMPS, AH56_INSTRUMENT_SYSTEMS, AH56_LAMP_IDS, AH56_PANEL, ah56CollectiveIndicatedDeg } from '../../src/aircraft/ah56/panel';
import { AH56_ASI_MARKS, AH56_BETA_INDICATOR, AH56_COLLECTIVE_INDICATOR, AH56_ENGINE_OIL, AH56_FUEL_SCALE, AH56_G_SCALE, AH56_HYDRAULIC, AH56_NF_NR_TAPE,
  AH56_NF_BANDS, AH56_NG_TAPE, AH56_TIT_TAPE, AH56_TORQUE_100_NM, AH56_TORQUE_TAPE, AH56_XMSN_OIL, ah56TorquePct } from '../../src/aircraft/ah56/panelMarkings';
import { Ah56AngleIndicator, Ah56GyroPlacard, Ah56HydraulicsGauge, Ah56TapeGauge } from '../../src/aircraft/ah56/panelGauges';
import { AH56_NF_100_RPM, AH56_NR_100, AH56_AMCS_NR_FRACTION, AH56_TORQUE_100_SHP } from '../../src/aircraft/ah56/facts';
import { AH56_REFERENCE as V } from '../../src/aircraft/ah56/reference';
import { DEG } from '../../src/core/math';
import { makeMockState } from '../../src/core/mockState';
import { defaultControls } from '../../src/core/types';
import { emptyRotorcraftState } from '../../src/physics/rotorcraft/definition';
import { InstrumentSet } from '../../src/instruments/dynamics/instrumentSet';
import { stubCanvas } from './stubCanvas';
import { ARC_COLORS } from '../../src/instruments/render/art';
import { buildHotspots } from '../../src/instruments/hotspots';
import { run } from './testbed';

afterEach(() => vi.unstubAllGlobals());

/** The lit seven-segment colour of the readouts (panelGauges.ts AMBER). */
const AMBER_SEGMENT = '#ffba35';

/** The AMCS aircraft in cruise: torque 80 %, TIT 650, Ng 92, Nf = Nr 97.5 %, the bus up, 18,300 lb. */
function fixture() {
  const s = makeMockState();
  s.rotorcraft = emptyRotorcraftState();
  const e = s.engine;
  e.running = true; e.rpm = AH56_AMCS_NR_FRACTION * AH56_NF_100_RPM; e.ng = 92; e.itt = 650; e.torque = 80 / 100 * AH56_TORQUE_100_NM; e.oilPressure = 60; e.oilTemp = 80;
  s.rotorcraft.rotorRpm = AH56_AMCS_NR_FRACTION * AH56_NR_100; s.electrical.busVoltage = 28.2; s.fuel.left = 500; s.fuel.right = 500; s.gLoad = 1.2;
  s.rotorcraft.transmission = { oilPressurePsi: 90, oilTemperatureC: 70, tailChips: false };
  const c = defaultControls(); c.masterBattery = true; c.alternator = true; c.collective = 0.5;
  const set = new InstrumentSet({ systems: AH56_INSTRUMENT_SYSTEMS });
  const step = (seconds = 5) => { run(set, seconds, s, c); return set.readings; };
  return { s, c, set, step };
}

describe('AH-56A markings (ASTA-72 SoF para 5, AMCS-73, APE-I SoF 1.1)', () => {
  it('torque: 100 % is 3435 shp at 13,600 rpm = 1799 N m; green 0-114, red above; 114 % is the 3925 shp transmission limit', () => {
    expect(AH56_TORQUE_100_NM).toBeCloseTo(1798.5, 0);
    expect(ah56TorquePct(AH56_TORQUE_100_NM)).toBeCloseTo(100, 9);
    expect(ah56TorquePct(3925 * 745.699872 / (13_600 * Math.PI / 30))).toBeCloseTo(114.26, 1);
    expect(AH56_TORQUE_100_SHP * 114 / 100).toBeCloseTo(3915.9, 0);
    expect(AH56_TORQUE_TAPE.bands).toEqual([{ from: 0, to: 114, color: 'green' }, { from: 114, to: 130, color: 'red' }]);
  });

  it('TIT: green 300-740, yellow 740-780 (30 and 10 min), red from 785, radial 740, blue 720; Ng green 63-100, yellow to 101.5, red above', () => {
    expect(AH56_TIT_TAPE.bands).toEqual([{ from: 300, to: 740, color: 'green' }, { from: 740, to: 780, color: 'yellow' }, { from: 785, to: 900, color: 'red' }]);
    expect(AH56_TIT_TAPE.marks).toEqual([{ at: 740, color: 'red' }, { at: 720, color: 'blue' }]);
    expect(AH56_NG_TAPE.bands.map(b => [b.from, b.to, b.color])).toEqual([[63, 100, 'green'], [100, 101.5, 'yellow'], [101.5, 110, 'red']]);
    expect(AH56_NG_TAPE.marks.map(m => m.at)).toEqual([58, 101.5]);
  });

  it('Nf / Nr: the Nf band per configuration (ICS yellow 95-98 / green 98-105; AMCS green 95-105), Nr green 95-105 with radials 85 / 95 / 105 / 110', () => {
    expect(AH56_NF_NR_TAPE.firstBarBands!.ics).toEqual([{ from: 95, to: 98, color: 'yellow' }, { from: 98, to: 105, color: 'green' }]); // P ASTA-72 SoF para 5
    expect(AH56_NF_NR_TAPE.firstBarBands!.amcs).toEqual([{ from: 95, to: 105, color: 'green' }]); // ESTIMATE: the AMCS-73 power-on band
    expect(AH56_NF_NR_TAPE.firstBarBands).toBe(AH56_NF_BANDS);
    expect(AH56_NF_NR_TAPE.bands).toEqual([{ from: 95, to: 105, color: 'green' }]); // Nr, beside the R bar
    expect(AH56_NF_NR_TAPE.marks.map(m => m.at)).toEqual([85, 95, 105, 110]);
    // The normal points: AMCS 97.5 % Nf / Nr (AMCS-73 p 2) and ICS 100 % sit in green; the ICS 1972 yellow still covers 97.5.
    const colourAt = (bands: readonly { from: number; to: number; color: string }[], v: number) => bands.find(b => v >= b.from && v < b.to)?.color;
    expect(colourAt(AH56_NF_BANDS.amcs, AH56_AMCS_NR_FRACTION * 100)).toBe('green');
    expect(colourAt(AH56_NF_NR_TAPE.bands, AH56_AMCS_NR_FRACTION * 100)).toBe('green');
    expect(colourAt(AH56_NF_BANDS.ics, 100)).toBe('green');
    expect(colourAt(AH56_NF_BANDS.ics, 97.5)).toBe('yellow');
  });

  it('oil, hydraulics, fuel and g: the published bands', () => {
    expect(AH56_ENGINE_OIL.temp.arcs).toEqual([{ from: 0, to: 107, color: 'green' }, { from: 107, to: 150, color: 'yellow' }]);
    expect(AH56_ENGINE_OIL.pressure.redLines).toEqual([10, 83]);
    expect(AH56_XMSN_OIL.pressure.arcs).toEqual([{ from: 70, to: 110, color: 'green' }]); expect(AH56_XMSN_OIL.pressure.redLines).toEqual([70, 110]);
    expect(AH56_XMSN_OIL.temp.arcs).toEqual([{ from: 0, to: 113, color: 'green' }, { from: 113, to: 140, color: 'yellow' }]);
    expect(AH56_HYDRAULIC.normal).toEqual([2800, 3400]);
    expect(AH56_FUEL_SCALE.arcs).toEqual([{ from: 0, to: 3.9, color: 'red' }]); // 390 lb, scale in lb x 100
    expect(AH56_G_SCALE.arcs).toEqual([{ from: 0.25, to: 2.5, color: 'green' }]);
  });

  it('ASI: ESTIMATE green to the INF Vne 195 with the red radial there; the gear limit 130 is marked; numbers every 40 kt, ticks every 10', () => {
    expect(AH56_ASI_MARKS.redLine).toBe(V.vne); expect(V.vne).toBe(195); expect(AH56_ASI_MARKS.blueLine).toBe(130);
    expect(AH56_ASI_MARKS.numberStep).toBe(40); expect(AH56_ASI_MARKS.minorStep).toBe(10);
  });

  it('angle indicators carry the blade-angle detents: prop -12 / -2.2 / +8, collective cruise 13 (AMCS) and minimum 4.5', () => {
    expect(AH56_BETA_INDICATOR.marks.map(m => [m.label, m.at])).toEqual([['REV', -12], ['HOVER', -2.2], ['AUTO', 8]]);
    expect(AH56_BETA_INDICATOR.bands).toEqual([{ from: -17.2, to: 40.8, color: 'green' }]);
    expect(AH56_COLLECTIVE_INDICATOR.marks.map(m => [m.label, m.at])).toEqual([['CRUISE', 13], ['MIN', 4.5]]);
  });
});

describe('AH-56A readings through the instrument set', () => {
  it('reads torque %, TIT, Ng, Nf and Nr', () => {
    const { step } = fixture();
    const r = step(10);
    expect(r.extra!.torquePct).toBeCloseTo(80, 6);
    expect(r.engines[0].ittC).toBeCloseTo(650, 0); expect(r.engines[0].ngPct).toBeCloseTo(92, 0);
    expect(r.engines[0].rpm / AH56_NF_100_RPM * 100).toBeCloseTo(97.5, 0); expect(r.rotorRpmPct).toBeCloseTo(97.5, 0);
    expect(r.extra!.fuelLb).toBeCloseTo(1000 * 2.2046226, 3);
    expect(r.extra!.gLoad).toBe(1.2);
  });

  it('indicates the collective per configuration: AMCS 4.5-21.5, 13 at the middle; the ICS 7 deg less', () => {
    const { s, c } = fixture();
    c.collective = 0; expect(ah56CollectiveIndicatedDeg(s, c)).toBeCloseTo(4.5, 9);
    c.collective = 1; expect(ah56CollectiveIndicatedDeg(s, c)).toBeCloseTo(21.5, 9);
    c.collective = 0.5; expect(ah56CollectiveIndicatedDeg(s, c)).toBeCloseTo(13, 9);
    s.rotorcraft!.controlGyro = { mode: 'ics', pitch: 0, roll: 0, pitchRate: 0, rollRate: 0 };
    expect(ah56CollectiveIndicatedDeg(s, c)).toBeCloseTo(6, 9); // "13 deg AMCS = 6 deg ICS"
    s.rotorcraft!.controlGyro.mode = 'amcs'; expect(ah56CollectiveIndicatedDeg(s, c)).toBeCloseTo(13, 9);
  });

  it('shows the prop blade angle in degrees, blank without the pusher, and the gyro mode', () => {
    const { s, step } = fixture();
    let r = step(); expect(Number.isNaN(r.extra!.propBetaDeg)).toBe(true); expect(r.extra!.gyroMode).toBe(0);
    s.rotorcraft!.pusher = { lever: 0.4, beta: -2.2 * DEG, betaCommand: -2.2 * DEG, deltaBeta: false, rpm: 1600, thrust: 0, torque: 0 };
    s.rotorcraft!.controlGyro = { mode: 'ics', pitch: 0, roll: 0, pitchRate: 0, rollRate: 0 };
    r = step(); expect(r.extra!.propBetaDeg).toBeCloseTo(-2.2, 6); expect(r.extra!.gyroMode).toBe(1);
  });

  it('draws the tapes, indicators, hydraulics and the placard of the control system in use', () => {
    const { s, c, step } = fixture();
    const make = (id: string) => (AH56_PANEL.gauges.find(g => g.id === id) as unknown as { bounds: { x: number; y: number; w: number; h: number }; create(id: string, b: unknown): { sample(r: unknown, c: unknown, t: number): boolean; draw(g: unknown): void; drawStatic(g: unknown): void } });
    const stub = stubCanvas();
    let r = step(10);
    for (const id of ['torqueTape', 'titTape', 'ngTape', 'nfNrTape', 'collective', 'propBeta', 'hydraulics', 'gyroPlacard']) {
      const spec = make(id), part = spec.create(id, spec.bounds);
      expect(part.sample(r, c, 0), id).toBe(true); part.drawStatic(stub.g); part.draw(stub.g); expect(part.sample(r, c, 0), id).toBe(false);
    }
    expect(stub.texts).toEqual(expect.arrayContaining(['TORQUE', 'TIT', 'Ng', 'Nf  Nr', 'COLL', 'PROP β', 'HYD PSI', 'AMCS', 'STICK RELEASED = ATTITUDE HELD', 'NOT FITTED']));
    expect(stub.texts).toEqual(expect.arrayContaining(['REV', 'HOVER', 'AUTO', 'CRUISE']));
    s.rotorcraft!.controlGyro = { mode: 'ics', pitch: 0, roll: 0, pitchRate: 0, rollRate: 0 }; r = step();
    const placard = make('gyroPlacard').create('p', make('gyroPlacard').bounds);
    const icsStub = stubCanvas(); placard.sample(r, c, 0); placard.draw(icsStub.g);
    expect(icsStub.texts).toEqual(expect.arrayContaining(['ICS', 'ROLL COMP', 'PITCH DESENS', 'STIRS > 0.5 Hz PROHIBITED']));
    // The tapes are bus-gated only where they are electric: TIT and Ng are thermocouple / tach generator, torque and rotor speeds likewise.
    expect(Ah56TapeGauge).toBeDefined(); expect(Ah56AngleIndicator).toBeDefined(); expect(Ah56HydraulicsGauge).toBeDefined(); expect(Ah56GyroPlacard).toBeDefined();
  });

  it('paints the Nf strip of the configuration in use: no yellow on the AMCS aircraft at 97.5 %, the 1972 yellow band on the ICS', () => {
    const { s, c, step } = fixture();
    const spec = AH56_PANEL.gauges.find(g => g.id === 'nfNrTape') as unknown as { bounds: { x: number; y: number; w: number; h: number }; create(id: string, b: unknown): { sample(r: unknown, c: unknown, t: number): boolean; draw(g: unknown): void; drawStatic(g: unknown): void } };
    const tape = spec.create('nfNrTape', spec.bounds);
    const stat = stubCanvas(); tape.drawStatic(stat.g); expect(stat.fills).not.toContain(ARC_COLORS.yellow); // the static strip is Nr's (green only)
    let r = step(); tape.sample(r, c, 0); const amcs = stubCanvas(); tape.draw(amcs.g);
    expect(amcs.fills).toContain(ARC_COLORS.green); expect(amcs.fills).not.toContain(ARC_COLORS.yellow);
    s.rotorcraft!.controlGyro = { mode: 'ics', pitch: 0, roll: 0, pitchRate: 0, rollRate: 0 }; r = step();
    expect(tape.sample(r, c, 0)).toBe(true); // a configuration change redraws the tape
    const ics = stubCanvas(); tape.draw(ics.g); expect(ics.fills).toContain(ARC_COLORS.yellow);
  });

  it('dark readouts without bus power: the tapes keep their self-powered bars, no digit of a tape or a blade-angle indicator is lit', () => {
    const { s, c, step } = fixture();
    s.electrical.busVoltage = 0; c.masterBattery = false;
    const r = step();
    expect(r.busPowered).toBe(false);
    for (const id of ['torqueTape', 'titTape', 'ngTape', 'nfNrTape', 'collective', 'propBeta']) {
      const spec = AH56_PANEL.gauges.find(g => g.id === id) as unknown as { bounds: { x: number; y: number; w: number; h: number }; create(id: string, b: unknown): { sample(r: unknown, c: unknown, t: number): boolean; draw(g: unknown): void } };
      const part = spec.create(id, spec.bounds), stub = stubCanvas();
      part.sample(r, c, 0); part.draw(stub.g);
      expect(stub.fills, id).not.toContain(AMBER_SEGMENT);
      if (id.endsWith('Tape')) expect(stub.fills, id).toContain('#d9d7cc'); // the bar itself (self-powered) is still drawn
    }
    // Power back: the digits light.
    s.electrical.busVoltage = 28.2; c.masterBattery = true;
    const spec = AH56_PANEL.gauges.find(g => g.id === 'torqueTape') as unknown as { bounds: { x: number; y: number; w: number; h: number }; create(id: string, b: unknown): { sample(r: unknown, c: unknown, t: number): boolean; draw(g: unknown): void } };
    const part = spec.create('torqueTape', spec.bounds), stub = stubCanvas(); part.sample(step(), c, 0); part.draw(stub.g); expect(stub.fills).toContain(AMBER_SEGMENT);
  });

  it('hydraulics: 3000 psi in the normal band with the rotor turning, zero with it stopped; dark without bus power', () => {
    const { s, step } = fixture();
    let r = step(); expect(r.extra!.hydPsi).toBe(3000); expect(3000).toBeGreaterThan(AH56_HYDRAULIC.normal[0]); expect(3000).toBeLessThan(AH56_HYDRAULIC.normal[1]);
    s.rotorcraft!.rotorRpm = 0; r = step(); expect(r.extra!.hydPsi).toBe(0);
  });
});

describe('AH-56A caution lenses', () => {
  it('has MASTER CAUTION and a small caution panel, in the AGENT order, lit only from the state', () => {
    expect(AH56_ANNUNCIATOR_LAMPS.map(l => l.text)).toEqual(['MASTER CAUTION', 'LOW FUEL', 'XMSN OIL PRESS', 'ENG OIL PRESS', 'TIT HIGH', 'NR LOW', 'GEAR UNSAFE', 'TORQUE HIGH', 'LAMP TEST']);
    const { s, step } = fixture();
    let r = step();
    expect(AH56_LAMP_IDS.filter(id => r.lamps[id])).toEqual([]);
    s.fuel.left = 80; s.fuel.right = 80; r = step(); expect(r.lamps.lowFuel).toBe(true); expect(r.lamps.master).toBe(true); // 160 kg = 353 lb under 390
    s.fuel.left = s.fuel.right = 500; s.engine.itt = 745; r = step(); expect(r.lamps.tit).toBe(true); expect(r.lamps.master).toBe(true);
    s.engine.itt = 650; s.rotorcraft!.transmission!.oilPressurePsi = 60; r = step(); expect(r.lamps.xmsnOil).toBe(true);
    s.rotorcraft!.transmission!.oilPressurePsi = 90; s.engine.torque = 115 / 100 * AH56_TORQUE_100_NM; r = step(); expect(r.lamps.torque).toBe(true);
    s.engine.torque = 80 / 100 * AH56_TORQUE_100_NM; s.rotorcraft!.rotorRpm = 0.93 * AH56_NR_100; r = step(); expect(r.lamps.nr).toBe(true);
    s.rotorcraft!.rotorRpm = AH56_AMCS_NR_FRACTION * AH56_NR_100; r = step(); expect(r.lamps.nr).toBe(false);
    s.engine.oilPressure = 5; r = step(); expect(r.lamps.engOil).toBe(true); s.engine.oilPressure = 60;
    s.gear = { retractable: true, lever: 'up', extension: [0.5, 0.5, 0.5], locked: [false, false, false], inTransit: true, warning: false }; r = step(); expect(r.lamps.gear).toBe(true);
  });

  it('MASTER CAUTION has no press (on the aircraft it cancels, it is no lamp test); LAMP TEST and the lens presses still work', () => {
    const lamp = (id: string) => AH56_ANNUNCIATOR_LAMPS.find(l => l.id === id)!;
    expect(lamp('master').press).toBeUndefined();
    const c = defaultControls(); lamp('pressTest').press!(true, c); expect(c.annunciatorTest).toBe(true); lamp('pressTest').press!(false, c);
    lamp('nr').press!(true, c); expect(c.lampTestId).toBe('nr');
    expect(buildHotspots(AH56_PANEL).some(h => h.id === 'masterTest')).toBe(false);
  });

  it('lamp test lights every lens; a dead bus lights none', () => {
    const { s, c, step } = fixture();
    c.annunciatorTest = true; let r = step(); expect(AH56_LAMP_IDS.every(id => r.lamps[id])).toBe(true);
    s.electrical.busVoltage = 0; r = step(); expect(AH56_LAMP_IDS.some(id => r.lamps[id])).toBe(false);
  });
});
