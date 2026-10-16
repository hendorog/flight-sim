// MD 500E panel, UI, checklists and training (package M3). Sources: RFM CSP-E-1 Rev 16 (Fig 2-5, 2-6, 3-1, 4-2).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MD500_ANNUNCIATOR_LAMPS, MD500_INSTRUMENT_SYSTEMS, MD500_LAMP_IDS, MD500_PANEL } from '../../src/aircraft/md500/panel';
import { MD500_PRESENTATION } from '../../src/aircraft/md500/presentation';
import { MD500_ASI_MARKS, MD500_N1_SCALE, MD500_SCALES as E, nrToDialPct } from '../../src/aircraft/md500/panelMarkings';
import { MD500_VNE_CARDS, MD500_VNE_ALTITUDES_KFT, MD500_VNE_OAT_C } from '../../src/aircraft/md500/panelPlacards';
import { Md500DualTach, md500TachAngle } from '../../src/aircraft/md500/panelTach';
import { Md500N1Gauge, md500N1Angle, md500N1VernierAngle } from '../../src/aircraft/md500/panelN1';
import { MD500_PANEL_CANVAS, MD500_PANEL_FACE, MD500_PANEL_OUTLINE, MD500_PANEL_PX_PER_M } from '../../src/aircraft/md500/panelLayout';
import { MD500_UI } from '../../src/aircraft/md500/ui';
import { MD500_TRAINING } from '../../src/aircraft/md500/training';
import { MD500_CHECKLISTS } from '../../src/aircraft/md500/checklists';
import { devMock } from '../../src/aircraft/md500/devMock';
import { MD500_FUEL, MD500_NR_100, MD500_N2_100_RPM, MD500_PSI_PER_NM, md500TorquePsi } from '../../src/aircraft/md500/facts';
import { MD500_REFERENCE as V } from '../../src/aircraft/md500/reference';
import { MD500_LB_PER_GAL } from '../../src/aircraft/md500/panelMarkings';
import { makeMockState } from '../../src/core/mockState';
import { defaultControls } from '../../src/core/types';
import { emptyRotorcraftState } from '../../src/physics/rotorcraft/definition';
import { InstrumentSet } from '../../src/instruments/dynamics/instrumentSet';
import { buildHotspots, hotspotAt } from '../../src/instruments/hotspots';
import { panelLayoutProblems } from '../../src/instruments/panelLayout';
import { stubCanvas } from '../instruments/stubCanvas';
import { run } from '../instruments/testbed';
import { livePredicate } from '../../src/ui/checklistModel';
import { checklistSections } from '../../src/ui/checklistModel';
import { compile } from '../../src/training/engine/predicates';

afterEach(() => vi.unstubAllGlobals());

function fixture() {
  const s = makeMockState();
  s.rotorcraft = emptyRotorcraftState();
  s.engine.running = true; s.engine.rpm = 1.03 * MD500_N2_100_RPM; s.engine.ng = 92; s.engine.itt = 700;
  s.engine.torque = 70 / MD500_PSI_PER_NM; s.rotorcraft.rotorRpm = 492;
  s.electrical.busVoltage = 28.2; s.fuel.left = 100; s.fuel.right = 90;
  s.rotorcraft.transmission = { oilPressurePsi: 38, oilTemperatureC: 60, tailChips: false };
  s.rotorcraft.turboshaft = { n2SetPct: 103, ptgIntegral: 0, grip: 'fullOpen', governorMode: 'governed', n2Pct: 103, nrPct: 103,
    torquePsi: 70, needlesSplit: false, engineOutLight: false, engineOutHorn: false, reignitionLight: false,
    overTorque: false, overTemp: false, avoidRange: false };
  const c = defaultControls(); c.alternator = true;
  const set = new InstrumentSet({ systems: MD500_INSTRUMENT_SYSTEMS });
  const step = (seconds = 5) => { run(set, seconds, s, c); return set.readings; };
  return { s, c, set, step };
}

describe('MD 500E panel (RFM Fig 4-2, LH command)', () => {
  it('keeps the face contract M2 reads and a clean layout with working click targets', () => {
    expect(MD500_PANEL.size).toBe(MD500_PANEL_CANVAS);
    expect(MD500_PANEL.background.outline).toBe(MD500_PANEL_OUTLINE);
    expect(MD500_PANEL_CANVAS.w / MD500_PANEL_PX_PER_M).toBe(MD500_PANEL_FACE.width);
    expect(MD500_PANEL_CANVAS.h / MD500_PANEL_PX_PER_M).toBe(MD500_PANEL_FACE.height);
    expect(MD500_PRESENTATION.panel).toBe(MD500_PANEL);
    expect(MD500_PANEL.id).toBe('md500');
    expect(panelLayoutProblems(MD500_PANEL)).toEqual([]);
    const spots = buildHotspots(MD500_PANEL);
    for (const h of spots) expect(hotspotAt(h.x, h.y, spots)?.id).toBe(h.id);
  });

  it('is the Fig 4-2 arrangement: 16 lenses, ASI over the dual tach, engine column, right column, no S269 leftovers', () => {
    expect(MD500_ANNUNCIATOR_LAMPS.map(l => l.text)).toEqual(['ENGINE OUT', 'XMSN OIL PRESS', 'XMSN OIL TEMP', 'BAT TEMP 160°', 'BAT TEMP 140°',
      'RE-IGN P RST', 'FUEL LEVEL LOW', 'FUEL FILTER', 'M/R XMSN CHIPS', 'T/R XMSN CHIPS', 'ENGINE CHIPS', 'GEN OUT', '', '', '', 'PRESS TO TEST']);
    expect(MD500_ANNUNCIATOR_LAMPS.filter(l => l.color === '#ff4538').map(l => l.id)).toEqual(['engineOut', 'xmsnOilPress', 'xmsnOilTemp', 'bat160']);
    expect(MD500_PANEL.annunciator!.cells).toHaveLength(16);
    const at = (id: string) => MD500_PANEL.gauges.find(g => g.id === id) as unknown as { at: [number, number] };
    expect(at('asi').at[0]).toBe(at('tach').at[0]); expect(at('asi').at[1]).toBeLessThan(at('tach').at[1]);
    const column = ['oilTemp', 'torque', 'tot', 'n1'].map(id => at(id).at);
    for (const p of column) expect(p[0]).toBe(column[0][0]);
    expect(column.map(p => p[1])).toEqual([...column.map(p => p[1])].sort((a, b) => a - b));
    expect(['oilPressure', 'fuel', 'amps', 'clock'].map(id => at(id).at[1])).toEqual(column.map(p => p[1]));
    expect(MD500_PANEL.gauges.some(g => g.kind === 'rotorTach' || g.id === 'carbHeat' || g.id === 'rotorClutch')).toBe(false);
    expect(JSON.stringify(MD500_PANEL.background.placards)).not.toMatch(/SCHWEIZER|300CB|PLACEHOLDER/);
    expect(MD500_PANEL.fixed!.flightRows.flat()).toEqual(expect.arrayContaining(['asi', 'tach', 'n1', 'altimeter', 'vsi']));
  });

  it('uses the RFM markings: ASI, torque, TOT, N1, oil, fuel and ammeter bands', () => {
    expect(MD500_ASI_MARKS.arcs).toEqual([{ from: 42, to: 152, color: 'green' }]);
    expect([MD500_ASI_MARKS.redLine, MD500_ASI_MARKS.crossHatchedLine]).toEqual([152, 130]);
    expect(E.torque.arcs!.slice(0, 2)).toEqual([{ from: 0, to: 81.3, color: 'green' }, { from: 81.3, to: 87.2, color: 'yellow' }]);
    expect(E.torque.redLines).toEqual([87.2]);
    const blue = E.torque.arcs!.find(a => a.color === 'blue')!; expect((blue.from + blue.to) / 2).toBeCloseTo(74.3, 6);
    expect(E.tot.arcs!.slice(0, 2)).toEqual([{ from: 3.6, to: 7.55, color: 'green' }, { from: 7.55, to: 8.1, color: 'yellow' }]);
    expect(E.tot.redLines).toEqual([8.1]);
    const totDots = E.tot.arcs!.slice(2).map(a => [a.color, (a.from + a.to) / 2]);
    expect(totDots[0][0]).toBe('blue'); expect(totDots[0][1]).toBeCloseTo(7.38, 6);
    expect(totDots[1][0]).toBe('red'); expect(totDots[1][1]).toBeCloseTo(8.43, 6);
    expect(MD500_N1_SCALE.green).toEqual([64, 105]); expect(MD500_N1_SCALE.redLines).toEqual([59, 105]);
    expect(E.oilPressure.arcs).toEqual([{ from: 50, to: 90, color: 'yellow' }, { from: 90, to: 130, color: 'green' }]);
    expect(E.oilPressure.redLines).toEqual([50, 130]); expect(E.oilTemp.arcs).toEqual([{ from: 0, to: 107, color: 'green' }]);
    expect(E.amps.arcs).toEqual([{ from: 0, to: 85, color: 'green' }, { from: 85, to: 150, color: 'yellow' }]); expect(E.amps.redLines).toEqual([150]);
    const fuelDot = E.fuel.arcs![1]; expect((fuelDot.from + fuelDot.to) / 2 * 100).toBeCloseTo(MD500_FUEL.lowLb, 6);
  });

  it('reproduces the three Vne cards cell for cell (RFM Fig 2-6), dashes as NO FLIGHT', () => {
    expect(MD500_VNE_CARDS.map(c => c.label)).toEqual(['UP TO 2000 LB', '2001 - 2500 LB', '2501 - 3000 LB']);
    expect(MD500_VNE_CARDS.map(c => c.autoMin)).toEqual([85, 90, 95]);
    for (const card of MD500_VNE_CARDS) {
      expect(card.kias).toHaveLength(MD500_VNE_OAT_C.length);
      for (const row of card.kias) {
        expect(row).toHaveLength(MD500_VNE_ALTITUDES_KFT.length);
        expect(Math.max(...row)).toBeLessThanOrEqual(V.vne);
        const finite = row.filter(v => v > 0);
        expect(row.slice(0, finite.length).every(v => v > 0)).toBe(true); // dashes only at the high end
        for (let j = 1; j < finite.length; j++) expect(finite[j]).toBeLessThanOrEqual(finite[j - 1]); // never faster higher up
      }
    }
    const cell = (k: number, oat: (typeof MD500_VNE_OAT_C)[number], alt: (typeof MD500_VNE_ALTITUDES_KFT)[number]) => MD500_VNE_CARDS[k].kias[MD500_VNE_OAT_C.indexOf(oat)][MD500_VNE_ALTITUDES_KFT.indexOf(alt)];
    expect([cell(0, -30, 0), cell(0, 45, 10), cell(0, 20, 6), cell(1, 45, 4), cell(1, -20, 16), cell(2, 30, 2), cell(2, 45, 10), cell(2, -30, 16)])
      .toEqual([141, 103, 151, 137, 84, 144, 69, 73]);
    // Fig 2-6 shows the same cold column on every card above 0 ft (weight only bites in the hot and high corner).
    expect(MD500_VNE_CARDS.map(c => c.kias[0].slice(0, 6).join())).toEqual(['141,136,131,127,122,118', '141,136,131,127,122,118', '141,136,131,127,122,115']);
    const text = JSON.stringify(MD500_PANEL.background.placards);
    expect(text).toContain('UP TO 2000 LB'); expect(text).toContain('95K MIN'); expect(text).toContain('—');
  });

  it('reads N2 and Nr on one angle law: needles superimpose in powered flight and split when the rotor overruns', () => {
    const { s, step } = fixture();
    let r = step();
    expect(r.engineRpmPct).toBeCloseTo(103, 1); expect(r.rotorRpmPct).toBeCloseTo(103, 1);
    expect(md500TachAngle(r.engineRpmPct)).toBeCloseTo(md500TachAngle(r.rotorRpmPct), 2);
    expect(md500TachAngle(nrToDialPct(492))).toBeCloseTo(md500TachAngle(103), 10);
    // Autorotation: N2 falls toward the governed idle, the rotor keeps turning.
    s.engine.rpm = 0.9 * MD500_N2_100_RPM; r = step();
    expect(Math.abs(md500TachAngle(r.engineRpmPct) - md500TachAngle(r.rotorRpmPct))).toBeGreaterThan(0.2);
    const stub = stubCanvas(); const tach = new Md500DualTach('tach', 100, 100, 74);
    expect(tach.sample(r)).toBe(true); tach.draw(stub.g); expect(tach.sample(r)).toBe(false);
    for (const label of ['N2 %', 'RPM ×100', 'ROTOR', '120', '5', 'R']) expect(stub.texts).toContain(label);
    // Tach generators are self-powered: they read with the bus dead.
    s.electrical.busVoltage = 0; r = step(); expect(r.rotorRpmPct).toBeCloseTo(0.9 * 0 + 103, 1);
  });

  it('reads N1 with the 0-9 vernier, TOT, and torque in psi through md500TorquePsi', () => {
    const { s, step } = fixture();
    const r = step(30);
    expect(r.engines[0].ngPct).toBeCloseTo(92, 3);
    expect(md500N1VernierAngle(92.4)).toBeCloseTo(0.48 * Math.PI, 6); // 2.4 on the units dial
    expect(md500N1VernierAngle(100)).toBeCloseTo(0, 10);
    expect(md500N1Angle(110)).toBeGreaterThan(md500N1Angle(105));
    expect(E.torque.read(r)).toBeCloseTo(md500TorquePsi(s.engine.torque), 3); expect(E.torque.read(r)).toBeCloseTo(70, 2);
    expect(E.tot.read(r)).toBeCloseTo(7.0, 3);
    const stub = stubCanvas(); const n1 = new Md500N1Gauge('n1', 100, 100, 51);
    expect(n1.sample(r)).toBe(true); n1.draw(stub.g); expect(stub.texts).toEqual(expect.arrayContaining(['N1 %', '100', '9']));
    s.electrical.busVoltage = 0; expect(E.torque.read(step())).toBeCloseTo(70, 2);
  });

  it('lights the lenses from the turboshaft state, the 35 lb fuel switch and the bus, as the RFM lists them', () => {
    const { s, c, step } = fixture();
    let r = step();
    expect(MD500_LAMP_IDS.filter(id => r.lamps[id])).toEqual([]);
    const ts = s.rotorcraft!.turboshaft!;
    ts.engineOutLight = true; ts.reignitionLight = true; r = step();
    expect(r.lamps.engineOut && r.lamps.reign).toBe(true);
    s.electrical.busVoltage = 0; r = step(); expect(MD500_LAMP_IDS.some(id => r.lamps[id])).toBe(false); // dead bus, dead lenses
    s.electrical.busVoltage = 28; ts.engineOutLight = false; ts.reignitionLight = false;
    // FUEL LEVEL LOW at 35 lb (RFM 3-23); the gauge is damped but the lamp reads the sender.
    s.fuel.left = 35 / MD500_LB_PER_GAL * 3.083 / 2 * 1.01; s.fuel.right = s.fuel.left; r = step(40);
    expect(r.lamps.fuelLow).toBe(false);
    s.fuel.left = s.fuel.right = 33 * 0.4536 / 2; r = step(40); expect(r.lamps.fuelLow).toBe(true);
    expect(E.fuel.read(r) * 100).toBeCloseTo(33, 0);
    // Before start: XMSN OIL PRESS and GEN OUT are on (RFM 4-13); GEN OUT goes with the generator running and switched on.
    s.rotorcraft!.transmission = { ...s.rotorcraft!.transmission!, oilPressurePsi: 0 }; c.alternator = false; r = step();
    expect(r.lamps.xmsnOilPress && r.lamps.genOut).toBe(true);
    c.alternator = true; s.rotorcraft!.transmission!.oilPressurePsi = 30; r = step();
    expect(r.lamps.xmsnOilPress).toBe(false); expect(r.lamps.genOut).toBe(false);
    // Press-to-test lights every lens; RE-IGN P RST pressed sets the lamp-test id the turboshaft stage clears the latch on.
    c.annunciatorTest = true; r = step(); expect(MD500_LAMP_IDS.every(id => r.lamps[id])).toBe(true);
    c.annunciatorTest = false;
    const lens = MD500_ANNUNCIATOR_LAMPS.find(l => l.id === 'reign')!;
    lens.press!(true, c); expect(c.lampTestId).toBe('reign'); r = step(); expect(r.lamps.reign).toBe(true); expect(r.lamps.engineOut).toBe(false);
    lens.press!(false, c); expect(c.lampTestId).toBeUndefined();
    MD500_ANNUNCIATOR_LAMPS.find(l => l.id === 'pressTest')!.press!(true, c); expect(c.annunciatorTest).toBe(true);
  });

  it('operates the fuel valve (pull = closed), the switches, START and the dimmers by hotspot', () => {
    const c = defaultControls(); c.fuelSelector = 'both';
    const h = new Map(buildHotspots(MD500_PANEL).map(h => [h.id, h]));
    h.get('fuelValve')!.turn!(1, c, 1); expect(c.fuelSelector).toBe('off');
    h.get('fuelValve')!.turn!(-1, c, 1); expect(c.fuelSelector).toBe('both');
    c.masterBattery = false; c.alternator = false;
    h.get('battery')!.toggle!(c); expect(c.masterBattery).toBe(true); expect(c.alternator).toBe(false);
    h.get('generator')!.toggle!(c); expect(c.alternator).toBe(true);
    h.get('startPump')!.toggle!(c); expect(c.fuelPump).toBe(true);
    expect(h.get('engine1Starter')!.hold).toEqual({ action: 'starter', engine: 0 });
    expect([...h.keys()].filter(k => /clutch|carb|mixture/i.test(k))).toEqual([]);
  });

  it('shows the dev mock script: lit before start, out at idle, split in autorotation', () => {
    const s = makeMockState(); s.rotorcraft = emptyRotorcraftState(); const c = defaultControls();
    const set = new InstrumentSet({ systems: MD500_INSTRUMENT_SYSTEMS });
    const at = (t: number) => { devMock(s, c, t, undefined); run(set, 3, s, c); return { r: set.readings, ts: s.rotorcraft!.turboshaft! }; };
    let x = at(3); expect(x.r.lamps.engineOut).toBe(false); // battery off: nothing lights
    x = at(15); expect(x.r.lamps.engineOut && x.r.lamps.xmsnOilPress && x.r.lamps.genOut).toBe(true);
    x = at(36); expect(x.r.lamps.engineOut).toBe(false); expect(x.r.engines[0].ngPct).toBeCloseTo(64.5, 1);
    x = at(100); expect(x.r.engines[0].ittC).toBeGreaterThan(600); expect(E.torque.read(x.r)).toBeGreaterThan(40);
    x = at(210); expect(x.ts.needlesSplit).toBe(true);
    expect(md500TachAngle(x.r.rotorRpmPct)).toBeGreaterThan(md500TachAngle(x.r.engineRpmPct));
    void MD500_NR_100;
  });
});

describe('MD 500E UI, checklists and training', () => {
  it('shows grip, N2 set and the turboshaft read-outs, and gives the start advice of RFM 4-3', () => {
    const { s, c } = fixture();
    const lever = (l: string) => MD500_UI.hud.levers.find(x => x.label === l)!;
    expect(lever('GRIP').text!(c, s)).toBe('FLY'); s.rotorcraft!.turboshaft!.grip = 'cutoff'; expect(lever('GRIP').text!(c, s)).toBe('CUTOFF');
    s.rotorcraft!.turboshaft!.grip = 'groundIdle'; expect(lever('GRIP').text!(c, s)).toBe('IDLE');
    expect(lever('N2 SET').text!(c, s)).toBe('103.0%');
    const reading = (l: string) => MD500_UI.hud.readouts.find(x => x.label === l)!.text(s);
    expect(reading('N1')).toBe('92.0%'); expect(reading('TOT')).toBe('700 °C'); expect(reading('TQ')).toBe('70 psi'); expect(reading('N2/NR')).toBe('103 / 103%');
    s.rotorcraft!.turboshaft!.needlesSplit = true; expect(reading('N2/NR')).toContain('SPLIT');
    c.masterBattery = true; c.collective = 0; c.fuelSelector = 'both';
    expect(MD500_UI.starterAdvice(c, 0)).toBe('Hold START; roll the grip to GROUND IDLE at 12–15 % N1; release at 58–60 %');
    c.masterBattery = false; expect(MD500_UI.starterAdvice(c, 0)).toContain('BAT');
  });

  it('carries the RFM speeds and real checklists, with checks the live checker accepts', () => {
    const t = MD500_TRAINING;
    expect(t.id).toBe('md500'); expect(t.school?.syllabus).toBe(false);
    expect(t.vspeeds.Vne).toBe(152); expect(t.vspeeds.Vy).toBe(62); expect([t.vspeeds.Vglide, t.vspeeds.Vdescent]).toEqual([80, 60]);
    for (const id of ['Vs0', 'Vs1', 'Vr', 'Vfe10', 'VfeFull', 'Vno'] as const) { expect(t.vspeeds[id]).toBe(0); expect(t.unavailableVSpeeds).toContain(id); }
    const sections = checklistSections(t, 'md500');
    expect(sections.map(s => s.id)).toEqual(expect.arrayContaining(['beforeStart', 'engineStart', 'afterStart', 'runup', 'beforeTakeoff', 'shutdown',
      'engineFailure', 'lowRotor', 'governorFailure', 'generator']));
    expect(sections.filter(s => s.category === 'emergency').map(s => s.id)).toEqual(['engineFailure', 'lowRotor', 'governorFailure', 'generator']);
    const live = Object.values(MD500_CHECKLISTS).flatMap(s => s.items.filter(i => i.live));
    expect(live.length).toBeGreaterThan(15);
    for (const section of sections) for (const item of section.items) {
      const pred = livePredicate(item, section, t);
      if (pred) expect(() => compile(pred)).not.toThrow();
    }
    const all = JSON.stringify(MD500_CHECKLISTS);
    expect(all).toContain('64–65 % N1'); expect(all).toContain('58–60 % N1'); expect(all).toContain('410 and 523');
    expect(all).not.toMatch(/Schweizer|clutch|mixture|propeller/i);
  });
});
