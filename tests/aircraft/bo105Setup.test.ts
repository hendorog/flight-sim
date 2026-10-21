// MBB Bo 105 CB-4 panel, UI, checklists, training and dev mock (package PN). Sources: BO 105 CB-5/CBS-5 Flight Manual used for the CB-4
// (P5), Sections 2-4 and 7; EASA TCDS R.011; BO 105 Training Manual (P TM). Plan revision 2, section 6.4.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BO105_INSTRUMENT_SYSTEMS, BO105_PANEL } from '../../src/aircraft/bo105/panel';
import { BO105_PRESENTATION } from '../../src/aircraft/bo105/presentation';
import { BO105_COLS, BO105_PANEL_CANVAS, BO105_PANEL_FACE, BO105_PANEL_OUTLINE, BO105_PANEL_PX_PER_M, BO105_ROWS } from '../../src/aircraft/bo105/panelLayout';
import { BO105_UI } from '../../src/aircraft/bo105/ui';
import { BO105_TRAINING } from '../../src/aircraft/bo105/training';
import { BO105_CHECKLISTS } from '../../src/aircraft/bo105/checklists';
import { devMock } from '../../src/aircraft/bo105/devMock';
import { BO105_N2_100_RPM, BO105_NR_100, BO105_PCT_PER_NM, BO105_POWER_LEVER } from '../../src/aircraft/bo105/facts';
import { BO105_REFERENCE as V } from '../../src/aircraft/bo105/reference';
import { bo105MastMomentLimit, bo105TorquePct, KPCM2_PER_PSI } from '../../src/aircraft/bo105/panelMarkings';
import { makeMockState } from '../../src/core/mockState';
import { defaultControls, defaultWeather, engineControl } from '../../src/core/types';
import { emptyRotorcraftState } from '../../src/physics/rotorcraft/definition';
import { InstrumentSet } from '../../src/instruments/dynamics/instrumentSet';
import { buildHotspots, hotspotAt } from '../../src/instruments/hotspots';
import { fixedSections } from '../../src/instruments/fixedPanel';
import { panelLayoutProblems } from '../../src/instruments/panelLayout';
import { run, twinControls } from '../instruments/testbed';
import { ChecklistSession, checklistSections, livePredicate } from '../../src/ui/checklistModel';
import { BO105_DEFINITION } from '../../src/aircraft/bo105';
import type { SimContext } from '../../src/core/context';
import { compile } from '../../src/training/engine/predicates';

afterEach(() => vi.unstubAllGlobals());

function twinState() {
  const s = makeMockState({ engines: 2 });
  s.rotorcraft = emptyRotorcraftState();
  s.electrical.alternators[1] = s.electrical.alternators[0];
  s.engines.forEach((e, i) => { e.running = true; e.rpm = BO105_N2_100_RPM; e.ng = 92; e.itt = 700 + 10 * i; e.torque = (70 - 4 * i) / BO105_PCT_PER_NM; });
  s.rotorcraft.rotorRpm = BO105_NR_100; s.electrical.busVoltage = 28.2;
  s.rotorcraft.turboshaft = { n2SetPct: 100, ptgIntegral: 0, grip: 'fullOpen', governorMode: 'governed', n2Pct: 100, nrPct: 100, torquePsi: 0, needlesSplit: false,
    engineOutLight: false, engineOutHorn: false, reignitionLight: false, overTorque: false, overTemp: false, avoidRange: false };
  return s;
}

describe('Bo 105 panel (FM Fig 7-3 pedestal, plan 6.4)', () => {
  it('keeps the frozen face and has a clean layout with working click targets', () => {
    expect(BO105_PANEL.size).toBe(BO105_PANEL_CANVAS);
    expect(BO105_PANEL.background.outline).toBe(BO105_PANEL_OUTLINE);
    expect(BO105_PANEL_CANVAS.w / BO105_PANEL_PX_PER_M).toBe(BO105_PANEL_FACE.width);
    expect(BO105_PANEL_CANVAS.h / BO105_PANEL_PX_PER_M).toBe(BO105_PANEL_FACE.height);
    expect(BO105_PRESENTATION.panel).toBe(BO105_PANEL); expect(BO105_PRESENTATION.instrumentSystems).toBe(BO105_INSTRUMENT_SYSTEMS);
    expect(BO105_PANEL.id).toBe('bo105');
    expect(panelLayoutProblems(BO105_PANEL)).toEqual([]);
    const spots = buildHotspots(BO105_PANEL);
    for (const h of spots) expect(hotspotAt(h.x, h.y, spots)?.id).toBe(h.id);
    expect(BO105_INSTRUMENT_SYSTEMS.engines).toBe(2); expect(BO105_PANEL.ignition.kind === 'toggles' && BO105_PANEL.ignition.engines).toBe(2);
  });

  it('puts the seven rows of Fig 7-3 on the frozen grid: ASI | altimeter, clock | VSI, MM | torque | tach, oil T | TOT | TOT, N1 | N1, oil P | fuel | fuel P', () => {
    const at = (id: string) => (BO105_PANEL.gauges.find(g => g.id === id) as unknown as { at: [number, number] }).at;
    const [c0, c1, c2] = BO105_COLS, [, r1, r2, r3, r4, r5, r6] = BO105_ROWS;
    expect([at('asi'), at('altimeter')]).toEqual([[c0, r1], [c2, r1]]);
    expect([at('clock'), at('vsi')]).toEqual([[c1, r2], [c2, r2]]);
    expect([at('mm'), at('torque'), at('tach')]).toEqual([[c0, r3], [c1, r3], [c2, r3]]);
    expect([at('oilTemp'), at('tot1'), at('tot2')]).toEqual([[c0, r4], [c1, r4], [c2, r4]]);
    expect([at('n1a'), at('n1b')]).toEqual([[c1, r5], [c2, r5]]);
    expect([at('oilPressure'), at('fuel'), at('fuelPressure')]).toEqual([[c0, r6], [c1, r6], [c2, r6]]);
    // The AGENT attitude indicator and DG sit above the engine block, beside the caution block (TM 00-26), clear of the instrument rows.
    expect(at('attitude')[1]).toBeLessThan(r1); expect(at('heading')[1]).toBeLessThan(r1);
    expect(BO105_PANEL.annunciator!.lamps!.length).toBe(18);
    const kinds = Object.fromEntries(BO105_PANEL.gauges.map(g => [g.id, g.kind]));
    expect(kinds.torque).toBe('twinNeedle'); expect(kinds.mm).toBe('customRound'); expect(kinds.tach).toBe('customRound');
  });

  it('moves the overhead power levers (OFF - IDLE - FLIGHT) by hotspot, per engine, on the FM / TM stops', () => {
    const c = twinControls();
    const h = new Map(buildHotspots(BO105_PANEL).map(x => [x.id, x]));
    // Hotspots of pwr1: FLIGHT, IDLE, OFF from the top.
    h.get('pwr10')!.toggle!(c); expect([engineControl(c, 0, 'throttle'), engineControl(c, 1, 'throttle')]).toEqual([1, c.engines[1].throttle ?? c.throttle]);
    h.get('pwr21')!.toggle!(c); expect(engineControl(c, 1, 'throttle')).toBe(BO105_POWER_LEVER.groundIdle);
    h.get('pwr12')!.toggle!(c); expect(engineControl(c, 0, 'throttle')).toBe(0);
    expect(h.get('pwr10')!.value(c)).toBe('OFF'); expect(h.get('pwr20')!.value(c)).toBe('IDLE');
    h.get('pwr20')!.toggle!(c); expect(h.get('pwr20')!.value(c)).toBe('FLIGHT');
    expect(h.get('engine1Starter')!.hold).toEqual({ action: 'starter', engine: 0 });
    expect(h.get('engine2Starter')!.hold).toEqual({ action: 'starter', engine: 1 });
    expect(h.get('engine1Ignition')).toBeDefined(); expect(h.get('engine2Ignition')).toBeDefined();
  });

  it('operates the per-engine generators, pumps and guarded emergency fuel valves from the switch strip', () => {
    const c = twinControls(); c.masterBattery = false;
    const h = new Map(buildHotspots(BO105_PANEL).map(x => [x.id, x]));
    h.get('battery')!.toggle!(c); expect(c.masterBattery).toBe(true);
    for (const [id, key, e] of [['gen1', 'alternator', 0], ['gen2', 'alternator', 1], ['pump1', 'fuelPump', 0], ['pump2', 'fuelPump', 1]] as const) {
      const before = engineControl(c, e, key), other = engineControl(c, 1 - e, key);
      h.get(id)!.toggle!(c); expect(engineControl(c, e, key)).toBe(!before);
      expect(engineControl(c, 1 - e, key)).toBe(other); // the other engine did not move
    }
    h.get('valve1')!.toggle!(c); expect(engineControl(c, 0, 'fuelSelector')).toBe('off'); expect(engineControl(c, 1, 'fuelSelector')).not.toBe('off');
    h.get('valve1')!.toggle!(c); expect(engineControl(c, 0, 'fuelSelector')).toBe('both');
    expect(h.get('panelDimmer')).toBeDefined();
  });

  it('shows the flight instruments and the engine-power ones in Upper and the rest in Lower, with every lens reachable', () => {
    const sections = fixedSections(BO105_PANEL);
    const parts = (s: typeof sections.upper) => s.panes.map(p => `${p.source.x},${p.source.y}`);
    expect(sections.upper.panes.length).toBeGreaterThan(12);
    expect(sections.lower.panes.length).toBeGreaterThan(8);
    expect(BO105_PANEL.fixed!.flightRows.flat()).toEqual(expect.arrayContaining(['asi', 'attitude', 'altimeter', 'vsi', 'tach', 'mm', 'torque', 'tot1', 'tot2']));
    expect(parts(sections.upper)).toContain(`${BO105_PANEL.annunciator!.cells![3].x},${BO105_PANEL.annunciator!.cells![3].y}`);
    expect(sections.upper.size.h).toBeLessThan(470);
  });

  it('plays the dev mock: dead panel, two starts, flight with a mast-moment spike, then engine 2 fails', () => {
    const s = makeMockState({ engines: 2 }); s.rotorcraft = emptyRotorcraftState(); const c = twinControls();
    const set = new InstrumentSet({ systems: BO105_INSTRUMENT_SYSTEMS });
    const at = (t: number) => { devMock(s, c, t, undefined); run(set, 3, s, c); return set.readings; };
    let r = at(3); expect(Object.values(r.lamps).some(Boolean)).toBe(false);
    r = at(22); expect(r.lamps.gen1).toBe(true); expect(r.engines[0].ngPct).toBeGreaterThan(30);
    r = at(100);
    expect([r.engines[0].ngPct, r.engines[1].ngPct].every(n => n > 85)).toBe(true);
    expect(bo105TorquePct(r.engines[0].torqueNm)).toBeGreaterThan(55); expect(r.rotorRpmPct).toBeCloseTo(100, 0);
    expect(r.lamps.gen1 || r.lamps.gen2 || r.lamps.rpm).toBe(false);
    r = at(152); expect(r.extra!.mastMomentPct).toBeGreaterThan(100); expect(r.lamps.mmTest).toBe(false);
    r = at(215); expect(r.engines[1].ngPct).toBeLessThan(40); expect(bo105TorquePct(r.engines[0].torqueNm)).toBeGreaterThan(85); expect(r.lamps.gen2).toBe(true);
    expect(s.rotorcraft!.twinTurboshaft!.oei).toBe(true);
    expect(bo105MastMomentLimit().limit).toBeGreaterThan(0);
  });
});

describe('Bo 105 UI, checklists and training', () => {
  it('shows PWR 1 / 2, N2 set, split and the per-engine read-outs, and gives the start advice of FM 4-12', () => {
    const s = twinState(), c = twinControls(); c.engines = [{ throttle: 1 }, { throttle: 1 }];
    const lever = (l: string) => BO105_UI.hud.levers.find(x => x.label === l)!;
    expect(BO105_UI.hud.levers.map(l => l.label)).toEqual(['COLL', 'PWR 1', 'PWR 2', 'N2 SET', 'SPLIT']);
    expect([lever('PWR 1').text!(c, s), lever('PWR 2').text!(c, s)]).toEqual(['FLIGHT', 'FLIGHT']);
    for (const [t, word] of [[0, 'OFF'], [0.25, 'IDLE'], [0.5, 'IDLE'], [0.7, 'FLIGHT']] as const) {
      c.engines[0].throttle = t; expect(lever('PWR 1').text!(c, s)).toBe(word); expect(lever('PWR 1').read(c, s)).toBe(t);
    }
    expect(lever('N2 SET').text!(c, s)).toBe('100.0%');
    expect(lever('SPLIT').text!(c, s)).toBe('—'); // no twin block yet: a dash, not a crash
    s.rotorcraft!.twinTurboshaft = { second: s.rotorcraft!.turboshaft!, splitPct: 1.25, n1SplitLight: false, nrLowLight: false, nrLowTone: false, nrHighLight: false, nrHighTone: false, oei: false, oeiSeconds: 0 };
    expect(lever('SPLIT').text!(c, s)).toBe('+1.3%'); expect(lever('SPLIT').read(c, s)).toBeGreaterThan(0.5);
    const reading = (l: string) => BO105_UI.hud.readouts.find(x => x.label === l)!.text(s);
    expect(BO105_UI.hud.readouts.map(r => r.label)).toEqual(expect.arrayContaining(['TQ 1/2', 'TOT 1/2', 'N1 1/2', 'N2/NR', 'MAST MOM']));
    expect(reading('TQ 1/2')).toBe('70 / 66%'); expect(reading('TOT 1/2')).toBe('700 / 710 °C'); expect(reading('N1 1/2')).toBe('92 / 92%'); expect(reading('N2/NR')).toBe('100 / 100%');
    s.engines[0].torque = 90 / BO105_PCT_PER_NM; expect(reading('TQ 1/2')).toContain('OEI RANGE'); s.engines[0].torque = 97 / BO105_PCT_PER_NM; expect(reading('TQ 1/2')).toContain('LIMIT');
    expect(reading('MAST MOM')).toBe('—'); s.rotorcraft!.mastMoment = 1.02 * bo105MastMomentLimit().limit; expect(reading('MAST MOM')).toBe('102% LIMIT');
    s.rotorcraft!.twinTurboshaft.n1SplitLight = true; expect(reading('N2/NR')).toContain('N1 SPLIT');
    c.masterBattery = true; c.collective = 0;
    expect(BO105_UI.starterAdvice(c, 0)).toBe('STARTER/GEN to START; at 12–15 % N1 lever to IDLE; rotor turning by 25 %; starter off at 58 %');
    c.masterBattery = false; expect(BO105_UI.starterAdvice(c, 1)).toContain('BAT');
    expect(BO105_UI.hints.some(h => /ENGINE TRIM/.test(h[0]))).toBe(true);
  });

  it('carries the FM speeds and the Section 3-4 checklists, with checks the live checker accepts', () => {
    const t = BO105_TRAINING;
    expect(t.id).toBe('bo105'); expect(t.classRating).toBeNull(); expect(t.school?.syllabus).toBe(false);
    expect(t.vspeeds.Vne).toBe(145); expect(t.vspeeds.Vy).toBe(60); expect(t.vspeeds.Vdescent).toBe(75); expect(t.vspeeds.Vglide).toBe(100);
    expect([t.vspeeds.Vne, t.vspeeds.Vy, V.autorotationKias]).toEqual([V.vne, V.vy, 75]);
    for (const id of ['Vs0', 'Vs1', 'Vr', 'Vfe10', 'VfeFull', 'Vno'] as const) { expect(t.vspeeds[id]).toBe(0); expect(t.unavailableVSpeeds).toContain(id); }
    const sections = checklistSections(t, 'bo105');
    expect(sections.filter(s => s.category === 'normal').map(s => s.id)).toEqual(['beforeStart', 'engineStart', 'afterStart', 'runup', 'beforeTakeoff', 'afterTakeoff', 'cruise', 'afterLanding', 'shutdown', 'deceleration']);
    const emergencies = sections.filter(s => s.category === 'emergency').map(s => s.id);
    expect(emergencies).toEqual(expect.arrayContaining(['engineFailure', 'powerFailure', 'tailRotor', 'governorFailure', 'lowRpm', 'hydraulic', 'engineFire', 'lowFuel']));
    const live = Object.values(BO105_CHECKLISTS).flatMap(s => s.items.filter(i => i.live));
    expect(live.length).toBeGreaterThan(20);
    for (const section of sections) for (const item of section.items) {
      const pred = livePredicate(item, section, t);
      if (pred) expect(() => compile(pred)).not.toThrow();
    }
    const all = JSON.stringify(BO105_CHECKLISTS);
    for (const text of ['12 – 15 % N1', '58 % N1', '927', 'N2', '75 KIAS', '60 KIAS', 'OEI', '98 – 102', 'Left yaw']) expect(all).toContain(text);
    expect(all).not.toMatch(/twist grip|mixture|propeller|clutch/i);
  });

  it('checks each engine on its own: both levers at FLIGHT, N1 and N2 per engine, the rotor once', () => {
    const def = BO105_DEFINITION;
    const s = twinState(); const ctx = { aircraft: def, state: s, controls: twinControls(), weather: defaultWeather(), simTime: 0 } as SimContext;
    ctx.controls.engines = [{ throttle: 1 }, { throttle: 1 }];
    const m = new ChecklistSession(BO105_TRAINING, 'bo105', 2);
    m.select('runup');
    m.update(ctx); expect(m.mark('leversFlight').done).toBe(true);
    ctx.controls.engines[1].throttle = BO105_POWER_LEVER.groundIdle; m.update(ctx); expect(m.mark('leversFlight').done).toBe(false);
    // The start items need both engines to be in the state: engine 2 at 40 % N1 fails the "idle" mark of the second engine.
    s.engines[0].ng = 64; s.engines[1].ng = 64; ctx.controls.engines = [{}, {}]; m.select('engineStart'); m.update(ctx); expect(m.mark('idle').done).toBe(true);
    s.engines[1].ng = 40; m.update(ctx); expect(m.mark('idle').done).toBe(false);
    m.select('runup'); m.mark('torque'); expect(m.mark('torque').mode).toBe('manual'); // "synchronise" compares two engines: manual
    expect(BO105_PANEL).toBeDefined(); expect(KPCM2_PER_PSI).toBeGreaterThan(0.07);
  });
});
