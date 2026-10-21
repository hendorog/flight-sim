// Lockheed AH-56A Cheyenne panel, UI, checklists, training and dev mock (package PN). Sources: USAASTA 72-08 (ASTA-72, ICS),
// 72-44 (AMCS-73) and 70-02 (APE-I). The rear panel is an AGENT reconstruction, UNVERIFIED. Plan revision 2, section 7.6.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AH56_INSTRUMENT_SYSTEMS, AH56_PANEL, ah56CollectiveIndicatedDeg } from '../../src/aircraft/ah56/panel';
import { AH56_PRESENTATION } from '../../src/aircraft/ah56/presentation';
import { AH56_PANEL_CANVAS, AH56_PANEL_FACE, AH56_PANEL_OUTLINE, AH56_PANEL_PX_PER_M, AH56_TAPE_STACK } from '../../src/aircraft/ah56/panelLayout';
import { AH56_UI } from '../../src/aircraft/ah56/ui';
import { AH56_TRAINING } from '../../src/aircraft/ah56/training';
import { AH56_CHECKLISTS } from '../../src/aircraft/ah56/checklists';
import { devMock } from '../../src/aircraft/ah56/devMock';
import { AH56_NF_100_RPM, AH56_NR_100 } from '../../src/aircraft/ah56/facts';
import { AH56_TORQUE_100_NM } from '../../src/aircraft/ah56/panelMarkings';
import { AH56_REFERENCE as V } from '../../src/aircraft/ah56/reference';
import { DEG } from '../../src/core/math';
import { makeMockState } from '../../src/core/mockState';
import { defaultControls, defaultWeather } from '../../src/core/types';
import { emptyRotorcraftState } from '../../src/physics/rotorcraft/definition';
import { InstrumentSet } from '../../src/instruments/dynamics/instrumentSet';
import { buildHotspots, hotspotAt } from '../../src/instruments/hotspots';
import { fixedSections } from '../../src/instruments/fixedPanel';
import { panelLayoutProblems } from '../../src/instruments/panelLayout';
import { gaugeParts } from '../../src/instruments/panelParts';
import { run } from '../instruments/testbed';
import { ChecklistSession, checklistSections, livePredicate } from '../../src/ui/checklistModel';
import { AH56_DEFINITION } from '../../src/aircraft/ah56';
import type { SimContext } from '../../src/core/context';
import { compile } from '../../src/training/engine/predicates';

afterEach(() => vi.unstubAllGlobals());

function state() {
  const s = makeMockState();
  s.rotorcraft = emptyRotorcraftState();
  s.engine.running = true; s.engine.rpm = 0.975 * AH56_NF_100_RPM; s.engine.ng = 92; s.engine.itt = 650; s.engine.torque = 80 / 100 * AH56_TORQUE_100_NM;
  s.rotorcraft.rotorRpm = 0.975 * AH56_NR_100; s.electrical.busVoltage = 28.2; s.gLoad = 1.25;
  s.rotorcraft.turboshaft = { n2SetPct: 100, ptgIntegral: 0, grip: 'fullOpen', governorMode: 'governed', n2Pct: 97.5, nrPct: 97.5, torquePsi: 80, needlesSplit: false,
    engineOutLight: false, engineOutHorn: false, reignitionLight: false, overTorque: false, overTemp: false, avoidRange: false };
  return s;
}

describe('AH-56A rear panel (AGENT reconstruction, plan 7.6)', () => {
  it('keeps the frozen face and has a clean layout with working click targets', () => {
    expect(AH56_PANEL.size).toBe(AH56_PANEL_CANVAS); expect(AH56_PANEL.background.outline).toBe(AH56_PANEL_OUTLINE);
    expect(AH56_PANEL_CANVAS.w / AH56_PANEL_PX_PER_M).toBe(AH56_PANEL_FACE.width); expect(AH56_PANEL_CANVAS.h / AH56_PANEL_PX_PER_M).toBe(AH56_PANEL_FACE.height);
    expect(AH56_PRESENTATION.panel).toBe(AH56_PANEL); expect(AH56_PRESENTATION.instrumentSystems).toBe(AH56_INSTRUMENT_SYSTEMS); expect(AH56_PANEL.id).toBe('ah56');
    expect(panelLayoutProblems(AH56_PANEL)).toEqual([]);
    const spots = buildHotspots(AH56_PANEL);
    for (const h of spots) expect(hotspotAt(h.x, h.y, spots)?.id).toBe(h.id);
    expect(AH56_INSTRUMENT_SYSTEMS.engines).toBe(1);
  });

  it('puts the four vertical tapes in the frozen stack, the basic T on the left, the blade-angle indicators and the gear controls', () => {
    const rect = (id: string) => gaugeParts(AH56_PANEL.gauges.find(g => g.id === id)!, AH56_PANEL.apertures, AH56_PANEL.instrumentScale)[0].rect;
    const tapes = ['torqueTape', 'titTape', 'ngTape', 'nfNrTape'].map(rect);
    for (const r of tapes) { expect(r.x).toBeGreaterThanOrEqual(AH56_TAPE_STACK.x); expect(r.x + r.w).toBeLessThanOrEqual(AH56_TAPE_STACK.x + AH56_TAPE_STACK.w); expect(r.h).toBeGreaterThan(300); expect(r.w).toBeLessThan(r.h / 5); }
    expect(tapes.map(r => r.x)).toEqual([...tapes.map(r => r.x)].sort((a, b) => a - b)); // torque | TIT | Ng | Nf / Nr, left to right
    const at = (id: string) => (AH56_PANEL.gauges.find(g => g.id === id) as unknown as { at: [number, number] }).at;
    expect(at('asi')[1]).toBe(at('attitude')[1]); expect(at('attitude')[1]).toBe(at('altimeter')[1]); expect(at('hsi')[0]).toBe(at('attitude')[0]); expect(at('hsi')[1]).toBeGreaterThan(at('attitude')[1]);
    expect(at('asi')[0]).toBeLessThan(at('attitude')[0]); expect(at('attitude')[0]).toBeLessThan(at('altimeter')[0]);
    const kinds = new Map(AH56_PANEL.gauges.map(g => [g.id, g.kind]));
    expect(kinds.get('torqueTape')).toBe('customRect'); expect(kinds.get('gear')).toBe('gearLights'); expect(kinds.get('tailWheel')).toBe('positionSwitch');
    expect(kinds.get('collective')).toBe('customRect'); expect(kinds.get('propBeta')).toBe('customRect'); expect(kinds.get('hydraulics')).toBe('customRect');
    // The UNVERIFIED notice is told to the pilot in the hints, not printed on the simulated panel face (gate-0 look review).
    expect(JSON.stringify(AH56_PANEL.background.placards)).not.toContain('UNVERIFIED');
    expect(JSON.stringify(AH56_UI.hints)).toContain('UNVERIFIED');
    // The unmodelled engine, rotor and hydraulic controls are drawn, with no hotspot (nothing to operate).
    expect(kinds.get('inertControls')).toBe('customRect');
    expect(buildHotspots(AH56_PANEL).some(h => h.id === 'inertControls')).toBe(false);
  });

  it('operates the gear lever, the tail-wheel lock lever, the switches and the starter by hotspot', () => {
    const c = defaultControls(); c.gearLever = 'down'; c.masterBattery = false;
    const h = new Map(buildHotspots(AH56_PANEL).map(x => [x.id, x]));
    h.get('gearLever')!.step!(-1, c); expect(c.gearLever).toBe('up'); h.get('gearLever')!.step!(1, c); expect(c.gearLever).toBe('down');
    expect(h.get('tailWheel0')!.value(c)).toBe('UNLOCKED'); h.get('tailWheel0')!.toggle!(c); expect(c.tailWheelLock).toBe(true); expect(h.get('tailWheel0')!.value(c)).toBe('LOCKED');
    h.get('tailWheel1')!.toggle!(c); expect(c.tailWheelLock).toBe(false);
    h.get('battery')!.toggle!(c); expect(c.masterBattery).toBe(true);
    c.alternator = false; h.get('generator')!.toggle!(c); expect(c.alternator).toBe(true);
    expect(h.get('engine1Starter')!.hold).toEqual({ action: 'starter', engine: 0 });
  });

  it('shows the basic T, the blade-angle indicators and the tapes in Upper, and gear, tail wheel, hydraulics and switches in Lower', () => {
    const sections = fixedSections(AH56_PANEL);
    const has = (section: keyof typeof sections, x: number, y: number) => sections[section].panes.some(p => p.source.x <= x && p.source.y <= y && p.source.x + p.source.w >= x && p.source.y + p.source.h >= y);
    expect(has('upper', 130, 150)).toBe(true); // ASI
    expect(has('upper', AH56_TAPE_STACK.x + 100, 500)).toBe(true); // the tape stack crop
    expect(has('upper', 89, 541)).toBe(true); // collective indicator
    expect(has('lower', 1096, 170)).toBe(true); // gear handle
    expect(has('lower', 1200, 170)).toBe(true); // tail-wheel lever
    expect(has('lower', 100, 830)).toBe(true); // hydraulics
    expect(has('lower', 1000, 860)).toBe(true); // switches
    expect(sections.upper.size.h).toBeLessThan(460);
  });

  it('plays the dev mock: dead panel, start, hover at the detent, acceleration with beta rising, engine failure with the delta-beta cut', () => {
    const s = makeMockState(); s.rotorcraft = emptyRotorcraftState(); const c = defaultControls();
    const set = new InstrumentSet({ systems: AH56_INSTRUMENT_SYSTEMS });
    const at = (t: number) => { devMock(s, c, t, undefined); run(set, 3, s, c); return set.readings; };
    let r = at(3); expect(Object.values(r.lamps).some(Boolean)).toBe(false);
    r = at(15); expect(r.engines[0].ngPct).toBeGreaterThan(20);
    r = at(50); expect(r.extra!.propBetaDeg).toBeCloseTo(-2.2, 6); expect(r.extra!.collectiveDeg).toBeCloseTo(11, 6);
    r = at(150); expect(r.extra!.propBetaDeg).toBeCloseTo(22, 6); expect(r.extra!.collectiveDeg).toBeCloseTo(13, 6); expect(r.extra!.torquePct).toBeGreaterThan(90);
    expect(r.rotorRpmPct).toBeCloseTo(97.5, 0);
    r = at(210); expect(r.extra!.propBetaDeg).toBeCloseTo(8, 6); expect(r.extra!.torquePct).toBeLessThan(2); expect(s.rotorcraft!.pusher!.deltaBeta).toBe(false);
    devMock(s, c, 201.5, undefined); expect(s.rotorcraft!.pusher!.deltaBeta).toBe(true); expect(s.rotorcraft!.pusher!.beta / DEG).toBeLessThan(22);
  });

  it('plays the gear in the dev mock: down and locked, retraction with GEAR UNSAFE lit, up and locked, extension, down again before the failure', () => {
    const s = makeMockState(); s.rotorcraft = emptyRotorcraftState(); const c = defaultControls();
    const set = new InstrumentSet({ systems: AH56_INSTRUMENT_SYSTEMS });
    const at = (t: number) => { devMock(s, c, t, undefined); run(set, 0.5, s, c); return set.readings; };
    const gear = () => [s.gear.lever, c.gearLever, s.gear.inTransit, s.gear.locked.every(Boolean), s.gear.extension[0]];
    let r = at(50); expect(s.gear.retractable).toBe(true); expect(gear()).toEqual(['down', 'down', false, true, 1]); expect(r.lamps.gear).toBe(false);
    r = at(74); expect(gear().slice(0, 4)).toEqual(['up', 'up', true, false]); expect(r.lamps.gear).toBe(true); expect(r.lamps.master).toBe(true);
    r = at(150); expect(gear()).toEqual(['up', 'up', false, false, 0]); expect(r.lamps.gear).toBe(false);
    r = at(189); expect(gear().slice(0, 4)).toEqual(['down', 'down', true, false]); expect(r.lamps.gear).toBe(true);
    r = at(196); expect(gear()).toEqual(['down', 'down', false, true, 1]); expect(r.lamps.gear).toBe(false);
    r = at(210); expect(gear()).toEqual(['down', 'down', false, true, 1]);
  });
});

describe('AH-56A UI, checklists and training', () => {
  it('shows the collective in degrees with prop beta beside it, the condition grip, gear, tail wheel and gyro mode', () => {
    const s = state(), c = defaultControls(); c.collective = 0.5;
    const lever = (l: string) => AH56_UI.hud.levers.find(x => x.label === l)!;
    expect(AH56_UI.hud.levers.map(l => l.label)).toEqual(['COLL', 'PROP β', 'GRIP', 'Nf SET', 'GEAR', 'TAIL WHL']);
    // Mid lever on AG's physical range -2.5..18.5 deg (integrator, at the AG merge; the S0 stub read 13.0 / 6.0).
    expect(lever('COLL').text!(c, s)).toBe('15.0°');
    s.rotorcraft!.controlGyro = { mode: 'ics', pitch: 0, roll: 0, pitchRate: 0, rollRate: 0 }; expect(lever('COLL').text!(c, s)).toBe('8.0°');
    expect(lever('PROP β').text!(c, s)).toBe('—');
    s.rotorcraft!.pusher = { lever: 0.4, beta: 8 * DEG, betaCommand: 8 * DEG, deltaBeta: false, rpm: 1600, thrust: 0, torque: 0 }; expect(lever('PROP β').text!(c, s)).toBe('8.0°');
    expect(lever('GRIP').text!(c, s)).toBe('RUN'); s.rotorcraft!.turboshaft!.grip = 'groundIdle'; expect(lever('GRIP').text!(c, s)).toBe('IDLE');
    expect(lever('TAIL WHL').text!(c, s)).toBe('UNLOCKED'); c.tailWheelLock = true; expect(lever('TAIL WHL').text!(c, s)).toBe('LOCKED');
    s.gear = { retractable: true, lever: 'down', extension: [1, 1, 1], locked: [true, true, true], inTransit: false, warning: false }; expect(lever('GEAR').text!(c, s)).toBe('DOWN');
    s.gear.inTransit = true; expect(lever('GEAR').text!(c, s)).toBe('IN TRANSIT');
    const reading = (l: string) => AH56_UI.hud.readouts.find(x => x.label === l)!.text(s);
    expect(reading('TQ')).toBe('80%'); expect(reading('TIT')).toBe('650 °C'); expect(reading('Ng')).toBe('92.0%'); expect(reading('Nf/Nr')).toBe('98 / 98%'); expect(reading('CONTROL')).toBe('ICS'); expect(reading('G')).toBe('1.25');
    s.engine.torque = 115 / 100 * AH56_TORQUE_100_NM; expect(reading('TQ')).toContain('LIMIT'); s.engine.itt = 745; expect(reading('TIT')).toContain('LIMIT');
    expect(ah56CollectiveIndicatedDeg(s, c)).toBeCloseTo(8, 9); // ICS, mid lever (S0 stub: 6)
    c.masterBattery = true; c.collective = 0; expect(AH56_UI.starterAdvice(c, 0)).toContain('20 % Ng'); c.masterBattery = false; expect(AH56_UI.starterAdvice(c, 0)).toContain('BAT');
  });

  it('carries the three hints the plan names: snap keys -2.2 / +8 / -12, stirs over 0.5 Hz prohibited (ICS), stick released = attitude held (AMCS)', () => {
    const text = JSON.stringify(AH56_UI.hints);
    expect(text).toContain('-2.2'); expect(text).toContain('+8'); expect(text).toContain('-12');
    expect(text).toContain('Avoid cyclic stirs above 0.5 Hz'); expect(text).toContain('stick released = attitude held');
  });

  it('carries the speeds and the SoF-based checklists, with checks the live checker accepts', () => {
    const t = AH56_TRAINING;
    expect(t.id).toBe('ah56'); expect(t.classRating).toBeNull(); expect(t.school?.syllabus).toBe(false); expect(t.icaoType).toBe('ZZZZ');
    expect(t.vspeeds.Vne).toBe(V.vne); expect(t.vspeeds.Vdescent).toBe(90); // the middle of 85 - 95 KCAS
    for (const id of ['Vs0', 'Vs1', 'Vr', 'Vfe10', 'VfeFull', 'Vno'] as const) { expect(t.vspeeds[id]).toBe(0); expect(t.unavailableVSpeeds).toContain(id); }
    const sections = checklistSections(t, 'ah56');
    expect(sections.filter(s => s.category === 'normal').map(s => s.id)).toEqual(['beforeStart', 'engineStart', 'afterStart', 'runup', 'beforeTakeoff', 'afterTakeoff', 'cruise', 'landing', 'afterLanding', 'shutdown']);
    expect(sections.filter(s => s.category === 'emergency').map(s => s.id)).toEqual(expect.arrayContaining(['engineFailure', 'propFailure', 'stickCentring', 'engineControl', 'momentStall', 'halfPHop']));
    const live = Object.values(AH56_CHECKLISTS).flatMap(s => s.items.filter(i => i.live));
    expect(live.length).toBeGreaterThan(18);
    for (const section of sections) for (const item of section.items) {
      const pred = livePredicate(item, section, t);
      if (pred) expect(() => compile(pred)).not.toThrow();
    }
    const all = JSON.stringify(AH56_CHECKLISTS);
    for (const text of ['DECR for at least 5 s', '20 % Ng', 'Under 320 °C', 'Below 40 % Nr', 'Relax the back pressure', 'Hands still', 'UNVERIFIED', '85 – 95 KCAS']) expect(all).toContain(text);
    expect(all).not.toMatch(/mixture|clutch|carb/i); // a turboshaft with a prop twist grip: no piston-engine items
  });

  it('checks tail wheel, gear and the Nr band live; the ICS-only lists are marked ICS', () => {
    // Rotor % is of referenceRpm: pin it to the AH-56A's 246 rpm (AG's value) so the test does not depend on the scaffold stub.
    const def = { ...AH56_DEFINITION, rotorcraft: { ...AH56_DEFINITION.rotorcraft!, referenceRpm: AH56_NR_100 } };
    const s = state(); const ctx = { aircraft: def, state: s, controls: defaultControls(def), weather: defaultWeather(), simTime: 0 } as SimContext;
    const m = new ChecklistSession(AH56_TRAINING, 'ah56', 1);
    m.select('beforeTakeoff');
    s.gear = { retractable: true, lever: 'down', extension: [1, 1, 1], locked: [true, true, true], inTransit: false, warning: false };
    ctx.controls.tailWheelLock = false; m.update(ctx); expect([m.mark('tailWheel').done, m.mark('gear').done]).toEqual([false, true]);
    ctx.controls.tailWheelLock = true; m.update(ctx); expect(m.mark('tailWheel').done).toBe(true);
    m.select('runup');
    s.rotorcraft!.rotorRpm = 0.975 * AH56_NR_100; m.update(ctx); expect(m.mark('nr').done).toBe(true);
    s.rotorcraft!.rotorRpm = 0.9 * AH56_NR_100; m.update(ctx); expect(m.mark('nr').done).toBe(false);
    m.select('shutdown'); m.update(ctx); expect(m.mark('brake').mode).toBe('auto');
    expect(AH56_CHECKLISTS.momentStall.title).toContain('ICS'); expect(AH56_CHECKLISTS.halfPHop.title).toContain('ICS');
  });
});
