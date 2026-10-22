// MBB Bo 105 CB-4 pedestal: markings, bespoke gauges, readings and lamps (package PN). Sources: BO 105 CB-5/CBS-5 Flight Manual used
// for the CB-4 (P5) Fig 7-3, 2-18..2-21, Section 3; EASA TCDS R.011 p9-10 (P); TM 00-44 (P TM). Numbers asserted here are the published
// limits and the derived 100 % torque; dial spacing is not tested (ESTIMATE artwork).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BO105_ANNUNCIATOR_LAMPS, BO105_INSTRUMENT_SYSTEMS, BO105_KG_PER_GAL, BO105_LAMP_IDS, BO105_PANEL } from '../../src/aircraft/bo105/panel';
import { BO105_ASI_MARKS, BO105_FUEL_PRESSURE, BO105_FUEL_SCALES, BO105_N1_SCALE, BO105_OIL_PRESSURE, BO105_OIL_TEMP, BO105_TACH, BO105_TORQUE_SCALE,
  BO105_TOT_SCALE, bo105MastMomentLimit, bo105MastMomentPct, bo105N2Pct, bo105TorquePct, KPCM2_PER_PSI } from '../../src/aircraft/bo105/panelMarkings';
import { Bo105MastMomentGauge, Bo105TripleGauge, Bo105VerticalSpeedGauge, bo105VsiAngle, mastMomentAngle } from '../../src/aircraft/bo105/panelGauges';
import { BO105_N2_100_RPM, BO105_NR_100, BO105_PCT_PER_NM, BO105_TORQUE_100_NM, BO105_TORQUE_100_W } from '../../src/aircraft/bo105/facts';
import { makeMockState } from '../../src/core/mockState';
import { defaultControls, setEngineControl } from '../../src/core/types';
import { emptyRotorcraftState } from '../../src/physics/rotorcraft/definition';
import { InstrumentSet } from '../../src/instruments/dynamics/instrumentSet';
import { stubCanvas } from './stubCanvas';
import { run, twinControls } from './testbed';

afterEach(() => vi.unstubAllGlobals());

/** A twin in flight: both engines near 100 % N2, 70 % and 66 % torque, TOT about 700 C, NR 100 %, the bus up. */
function fixture() {
  const s = makeMockState({ engines: 2 });
  s.rotorcraft = emptyRotorcraftState();
  s.electrical.alternators[1] = s.electrical.alternators[0];
  const pct = [70, 66];
  s.engines.forEach((e, i) => {
    e.running = true; e.rpm = BO105_N2_100_RPM; e.propRpm = e.rpm; e.ng = 92 - i; e.itt = 700 + 10 * i; e.torque = pct[i] / BO105_PCT_PER_NM;
    e.oilPressure = 100; e.oilTemp = 80; e.fuelPressure = 14;
  });
  s.rotorcraft.rotorRpm = BO105_NR_100; s.electrical.busVoltage = 28.2; s.fuel.left = 70; s.fuel.right = 300;
  s.rotorcraft.transmission = { oilPressurePsi: 1.2 / KPCM2_PER_PSI, oilTemperatureC: 70, tailChips: false };
  const c = twinControls(); c.masterBattery = true; setEngineControl(c, 0, 'alternator', true); setEngineControl(c, 1, 'alternator', true);
  const set = new InstrumentSet({ systems: BO105_INSTRUMENT_SYSTEMS });
  const step = (seconds = 5) => { run(set, seconds, s, c); return set.readings; };
  return { s, c, set, step };
}

describe('Bo 105 markings (FM 2-18 .. 2-21, TCDS p9-10)', () => {
  it('ASI: 10-150 kt with yellow 10-45, green 45-145, red radial 145 and the blue radial at 100', () => {
    expect(BO105_ASI_MARKS.scaleKt).toEqual([10, 150]);
    expect(BO105_ASI_MARKS.arcs).toEqual([{ from: 10, to: 45, color: 'yellow' }, { from: 45, to: 145, color: 'green' }]);
    expect([BO105_ASI_MARKS.redLine, BO105_ASI_MARKS.blueLine]).toEqual([145, 100]);
  });

  it('dual torque is a percent of 298 kW per engine: green 0-86, red radials 86 and 95; 100 % is 298 kW at 6016 rpm', () => {
    expect(BO105_TORQUE_100_W).toBe(298e3);
    expect(BO105_TORQUE_100_NM).toBeCloseTo(473.0, 0);
    expect(bo105TorquePct(BO105_TORQUE_100_NM)).toBeCloseTo(100, 9);
    // TCDS: 257 kW = 86 % and 283 kW = 95 % at 100 % N2.
    expect(bo105TorquePct(257e3 / (BO105_N2_100_RPM * Math.PI / 30))).toBeCloseTo(86.2, 0);
    expect(bo105TorquePct(283e3 / (BO105_N2_100_RPM * Math.PI / 30))).toBeCloseTo(95.0, 0);
    expect(BO105_TORQUE_SCALE.arcs).toEqual([{ from: 0, to: 86, color: 'green' }]);
    expect(BO105_TORQUE_SCALE.redLines).toEqual([86, 95]);
  });

  it('TOT green 0-779, yellow 779-810, red radial 810, red dots 843 and 927 (x100 C); N1 green 59-105, red 105', () => {
    expect(BO105_TOT_SCALE.arcs!.slice(0, 2)).toEqual([{ from: 0, to: 7.79, color: 'green' }, { from: 7.79, to: 8.1, color: 'yellow' }]);
    expect(BO105_TOT_SCALE.redLines).toEqual([8.1]);
    const dots = BO105_TOT_SCALE.arcs!.slice(2).map(a => [a.color, (a.from + a.to) / 2]);
    expect(dots[0][0]).toBe('red'); expect(dots[0][1]).toBeCloseTo(8.43, 9);
    expect(dots[1][0]).toBe('red'); expect(dots[1][1]).toBeCloseTo(9.27, 9);
    expect(BO105_N1_SCALE.arcs).toEqual([{ from: 59, to: 105, color: 'green' }]);
    expect(BO105_N1_SCALE.redLines).toEqual([105]);
  });

  it('triple tach: N2 red dot 95, radial 98, green 98-102, radial 102, dot 105; NR power-off 85-110 green with radials', () => {
    expect(BO105_TACH.n2.green).toEqual([98, 102]); expect(BO105_TACH.n2.redLines).toEqual([98, 102]); expect(BO105_TACH.n2.redDots).toEqual([95, 105]);
    expect(BO105_TACH.nr.green).toEqual([85, 110]); expect(BO105_TACH.nr.redLines).toEqual([85, 110]);
  });

  it('oil, fuel pressure and fuel: kp/cm2 bands as the FM lists them; the supply tank LOW FUEL mark at 60 kg', () => {
    expect(BO105_OIL_TEMP.engine.arcs).toEqual([{ from: 30, to: 107, color: 'green' }]); expect(BO105_OIL_TEMP.engine.redLines).toEqual([107]);
    expect(BO105_OIL_TEMP.transmission.arcs).toEqual([{ from: 30, to: 105, color: 'green' }]); expect(BO105_OIL_TEMP.transmission.redLines).toEqual([105]);
    expect(BO105_OIL_PRESSURE.engine.arcs).toEqual([{ from: 3.5, to: 6.3, color: 'yellow' }, { from: 6.3, to: 9.1, color: 'green' }]);
    expect(BO105_OIL_PRESSURE.engine.redLines).toEqual([3.5, 9.1]);
    expect(BO105_OIL_PRESSURE.transmission.arcs).toEqual([{ from: 0.5, to: 0.8, color: 'yellow' }, { from: 0.8, to: 2, color: 'green' }]);
    expect(BO105_FUEL_PRESSURE.arcs).toEqual([{ from: 0, to: 0.6, color: 'yellow' }, { from: 0.6, to: 1.7, color: 'green' }]); expect(BO105_FUEL_PRESSURE.redLines).toEqual([1.7]);
    const dot = BO105_FUEL_SCALES.supply.arcs![0]; expect((dot.from + dot.to) / 2).toBeCloseTo(60, 9);
    expect(KPCM2_PER_PSI).toBeCloseTo(1 / 14.2233, 5);
  });
});

describe('Bo 105 readings through the instrument set', () => {
  it('reads each engine\'s torque %, N2 %, N1 and TOT on its own pointer, and NR from the rotor', () => {
    const { step } = fixture();
    const r = step(40);
    expect(bo105TorquePct(r.engines[0].torqueNm)).toBeCloseTo(70, 1); expect(bo105TorquePct(r.engines[1].torqueNm)).toBeCloseTo(66, 1);
    expect(bo105N2Pct(r.engines[0].rpm)).toBeCloseTo(100, 0); expect(bo105N2Pct(r.engines[1].rpm)).toBeCloseTo(100, 0);
    expect([r.engines[0].ngPct, r.engines[1].ngPct].map(Math.round)).toEqual([92, 91]);
    expect([r.engines[0].ittC, r.engines[1].ittC].map(Math.round)).toEqual([700, 710]);
    expect(r.rotorRpmPct).toBeCloseTo(100, 0);
    expect(BO105_TOT_SCALE.read(r)).toBeCloseTo(7.0, 1);
    // The fuel gauge is calibrated in kg: S = fuel.left, M = fuel.right (BO builds the supply and main tanks into them).
    expect(r.fuelGal[0] * BO105_KG_PER_GAL).toBeCloseTo(70, 0); expect(r.fuelGal[1] * BO105_KG_PER_GAL).toBeCloseTo(300, -1);
  });

  it('turns the rotorcraft state into the bespoke readings: mast moment % of LIMIT, transmission oil', () => {
    const { s, step } = fixture();
    const { limit, yellow } = bo105MastMomentLimit();
    s.rotorcraft!.mastMoment = 0.4 * limit;
    let r = step();
    expect(r.extra!.mastMomentPct).toBeCloseTo(40, 6); expect(r.extra!.mastMomentYellowPct).toBeCloseTo(100 * yellow, 9);
    expect(bo105MastMomentPct(s)).toBeCloseTo(40, 6);
    expect(r.extra!.xmsnOilTempC).toBe(70); expect(r.extra!.xmsnOilKp).toBeCloseTo(1.2, 6);
    delete s.rotorcraft!.mastMoment; r = step(); expect(r.extra!.mastMomentPct).toBe(0); expect(bo105MastMomentPct(s)).toBeNull();
  });

  it('mast-moment gauge: needle follows the moment, TEST drives it to LIMIT with the lamp, LIMIT lights at 100 %, a dead bus blanks it', () => {
    const { s, c, step } = fixture();
    s.rotorcraft!.mastMoment = 0.6 * bo105MastMomentLimit().limit;
    let r = step();
    expect(Bo105MastMomentGauge.shown(r)).toEqual({ pct: expect.closeTo(60, 6), limit: false });
    s.rotorcraft!.mastMoment = 1.05 * bo105MastMomentLimit().limit; r = step();
    expect(Bo105MastMomentGauge.shown(r).limit).toBe(true);
    s.rotorcraft!.mastMoment = 0.1 * bo105MastMomentLimit().limit; c.lampTestId = 'mmTest'; r = step();
    expect(Bo105MastMomentGauge.shown(r)).toEqual({ pct: 100, limit: true });
    c.lampTestId = undefined; s.electrical.busVoltage = 0; r = step();
    expect(Bo105MastMomentGauge.shown(r)).toEqual({ pct: 0, limit: false });
    expect(mastMomentAngle(100)).toBeGreaterThan(mastMomentAngle(50)); expect(mastMomentAngle(0)).toBeCloseTo(-135 * Math.PI / 180, 9);
    const stub = stubCanvas(); const g = new Bo105MastMomentGauge('mm', 100, 100, 74);
    s.electrical.busVoltage = 28.2; s.rotorcraft!.mastMoment = 0.3 * bo105MastMomentLimit().limit; r = step();
    expect(g.sample(r)).toBe(true); g.draw(stub.g); expect(g.sample(r)).toBe(false);
    for (const label of ['MAST', 'MOMENT', 'CAL', 'TEST']) expect(stub.texts).toContain(label);
  });

  it('triple tach paints N2 and NR scales and moves with the readings; electric dials go to rest without bus power', () => {
    const { s, step } = fixture();
    const spec = (id: string) => (BO105_PANEL.gauges.find(g => g.id === id) as unknown as { create(id: string, x: number, y: number, a: number): Bo105TripleGauge });
    const stub = stubCanvas();
    const tach = spec('tach').create('tach', 100, 100, 74), oil = spec('oilTemp').create('oilTemp', 100, 100, 74);
    let r = step();
    expect(tach.sample(r)).toBe(true); tach.draw(stub.g); expect(tach.sample(r)).toBe(false);
    expect(stub.texts).toEqual(expect.arrayContaining(['N2 / NR', '100', '120', '1', '2', 'R']));
    expect(oil.sample(r)).toBe(true); oil.draw(stub.g); expect(stub.texts).toEqual(expect.arrayContaining(['OIL TEMP', '150']));
    s.engines[1].rpm = 0.9 * BO105_N2_100_RPM; r = step(); expect(tach.sample(r)).toBe(true); // the N2 2 pointer moved
    s.electrical.busVoltage = 0; r = step(); expect(oil.sample(r)).toBe(true); expect(tach.sample(r)).toBe(false); // tach generators are self-powered
  });

  it('VSI reads +/-6000 ft/min, zero at 9 o\'clock, linear', () => {
    expect(bo105VsiAngle(0)).toBeCloseTo(-Math.PI / 2, 9);
    expect(bo105VsiAngle(6000) - bo105VsiAngle(0)).toBeCloseTo(170 * Math.PI / 180, 9);
    expect(bo105VsiAngle(-3000)).toBeCloseTo(bo105VsiAngle(0) - 85 * Math.PI / 180, 9);
    const stub = stubCanvas(); const g = new Bo105VerticalSpeedGauge('vsi', 100, 100, 74); const { step } = fixture();
    expect(g.sample(step())).toBe(true); g.draw(stub.g); expect(stub.texts).toEqual(expect.arrayContaining(['6', 'UP', 'DOWN']));
  });
});

describe('Bo 105 warning lenses (FM 3-2..3-19, TM 00-44)', () => {
  it('has the Fig 7-3 segments in order, two F lights outboard, all red except the lamp test', () => {
    expect(BO105_ANNUNCIATOR_LAMPS.map(l => l.text)).toEqual(['F TEST', 'LOW FUEL', 'HY BLOCK', 'RPM', 'T OIL', 'GEN 1', 'GEN 2', 'FILT 1', 'FILT 2', 'HYD 1', 'HYD 2',
      'MAG PLUG 1', 'MAG PLUG 2', 'BAT 60', 'BAT 70', 'OIL COOL', 'LAMP TEST', 'F TEST']);
    expect(BO105_ANNUNCIATOR_LAMPS.filter(l => l.color !== '#ff4538').map(l => l.id)).toEqual(['pressTest']);
    expect(BO105_PANEL.annunciator!.cells).toHaveLength(18);
  });

  it('lights only what the state says: out in normal flight, GEN on the switch and engine, LOW FUEL under 60 kg, T OIL on pressure and temperature', () => {
    const { s, c, step } = fixture();
    let r = step();
    expect(BO105_LAMP_IDS.filter(id => r.lamps[id])).toEqual([]);
    setEngineControl(c, 1, 'alternator', false); r = step(); expect(r.lamps.gen2).toBe(true); expect(r.lamps.gen1).toBe(false);
    setEngineControl(c, 1, 'alternator', true); s.engines[0].running = false; r = step(); expect(r.lamps.gen1).toBe(true); s.engines[0].running = true;
    s.fuel.left = 61; r = step(); expect(r.lamps.lowFuel).toBe(false); s.fuel.left = 59; r = step(); expect(r.lamps.lowFuel).toBe(true); s.fuel.left = 70;
    s.rotorcraft!.transmission!.oilPressurePsi = 0.4 / KPCM2_PER_PSI; r = step(); expect(r.lamps.tOil).toBe(true);
    s.rotorcraft!.transmission!.oilPressurePsi = 1.2 / KPCM2_PER_PSI; s.rotorcraft!.transmission!.oilTemperatureC = 106; r = step(); expect(r.lamps.tOil).toBe(true);
    s.rotorcraft!.transmission!.oilTemperatureC = 70; r = step(); expect(r.lamps.tOil).toBe(false);
    // Fail-dark: without a transmission state the lens stays out (it must not burn for a whole flight on a missing block).
    const xmsn = s.rotorcraft!.transmission; delete s.rotorcraft!.transmission; r = step(); expect(r.lamps.tOil).toBe(false); s.rotorcraft!.transmission = xmsn;
    s.rotorcraft!.rotorRpm = 0.1 * BO105_NR_100; r = step(); expect(r.lamps.oilCool).toBe(true);
  });

  it('flashes the RPM lens on the twin warning unit\'s flags (N1 split, NR low, NR high) and goes dark with the bus', () => {
    const { s, step } = fixture();
    const base = { second: s.rotorcraft!.turboshaft as never, splitPct: 0, n1SplitLight: false, nrLowLight: false, nrLowTone: false, nrHighLight: false, nrHighTone: false, oei: false, oeiSeconds: 0 };
    s.rotorcraft!.twinTurboshaft = { ...base, n1SplitLight: true };
    const seen = new Set<boolean>();
    for (let k = 0; k < 8; k++) { s.time = k * 0.25; seen.add(step(0.2).lamps.rpm); }
    expect(seen).toEqual(new Set([true, false]));
    s.time = 0; s.rotorcraft!.twinTurboshaft = { ...base, nrHighLight: true }; expect(step(0.2).lamps.rpm).toBe(true);
    s.electrical.busVoltage = 0; expect(step(0.2).lamps.rpm).toBe(false);
  });

  it('lamp test lights every segment except the F lights, MM LIMIT and LOW FUEL (FM 4-9); each F lens and MM TEST test their own', () => {
    const { c, step } = fixture();
    c.annunciatorTest = true; let r = step();
    expect(BO105_LAMP_IDS.filter(id => !r.lamps[id])).toEqual(['fire1', 'lowFuel', 'fire2', 'mmTest']);
    c.annunciatorTest = false;
    for (const id of ['fire1', 'fire2', 'lowFuel']) {
      BO105_ANNUNCIATOR_LAMPS.find(l => l.id === id)!.press!(true, c); r = step(); expect(r.lamps[id]).toBe(true);
      expect(BO105_LAMP_IDS.filter(k => r.lamps[k])).toEqual([id]);
      BO105_ANNUNCIATOR_LAMPS.find(l => l.id === id)!.press!(false, c);
    }
    expect(c.lampTestId).toBeUndefined();
    const press = BO105_PANEL.gauges.find(g => g.id === 'mmTest') as unknown as { press(down: boolean, c: import('../../src/core/types').ControlInputs): void };
    press.press(true, c); r = step(); expect(r.lamps.mmTest).toBe(true); press.press(false, c); expect(c.lampTestId).toBeUndefined();
  });
});
