import { afterAll, describe, expect, it, vi } from 'vitest';
import { ChecklistPanel } from '../../src/ui/checklist';
import { FakeElement, installFakeDom } from './fakeDom';
import { C152_PRESENTATION } from '../../src/aircraft/c152/presentation';
import { R22_DEFINITION } from '../../src/aircraft/r22';
import { R22_TRAINING } from '../../src/aircraft/r22/training';
import { R44_TRAINING } from '../../src/aircraft/r44/training';
import { PA34_DEFINITION } from '../../src/aircraft/pa34';
import { PA34 } from '../../src/aircraft/pa34/training';
import { PA38 } from '../../src/aircraft/pa38/training';
import { C172S } from '../../src/training/aircraft/c172s';
import type { SimContext } from '../../src/core/context';
import { makeMockState } from '../../src/core/mockState';
import { defaultControls, defaultWeather, setEngineControl } from '../../src/core/types';
import { emptyRotorcraftState } from '../../src/physics/rotorcraft/definition';
import { ChecklistSession, checklistSections, livePredicate, newPhaseMemory, phaseSection, resolvePhase } from '../../src/ui/checklistModel';
import { C152 } from '../../src/aircraft/c152/training';
import { C152_DEFINITION } from '../../src/aircraft/c152';
import { FPM, FT, KT } from '../../src/core/math';
import { demoChecklistLink } from '../../src/ui/rotorcraftDemoGuide';
import { PHASE_ACTIONS, R22_DEMOS } from '../../src/sim/rotorcraft/flights';
import { audibleWarnings } from '../../src/ui/flightCues';
import { parseParams } from '../../src/sim/params';

function context(aircraft = R22_DEFINITION): SimContext {
  const state = makeMockState({ def: aircraft });
  if (aircraft.rotorcraft) state.rotorcraft = emptyRotorcraftState();
  return { aircraft, state, controls: defaultControls(aircraft), weather: defaultWeather(), simTime: 0 } as SimContext;
}

describe('reference checklists', () => {
  it('does not substitute another type or empty data for unavailable procedures', () => {
    expect(checklistSections(C172S, 'da42', true)).toEqual([]);
    expect(checklistSections(undefined, 's269')).toEqual([]);
    expect(checklistSections(R22_TRAINING, 'r22').some(s => s.items.length === 0)).toBe(false);
    for (const type of [R22_TRAINING, R44_TRAINING]) {
      const sections = checklistSections(type, type.id);
      expect(sections.filter(s => s.category === 'emergency').map(s => s.id)).toEqual(expect.arrayContaining(['engineFailure', 'lowRpm', 'engineFire', 'electricalFire', 'electrical']));
      for (const section of sections) expect(section.sourceUrl).toMatch(/^https:\/\//);
    }
  });
  it('uses actual clutch engagement and light, independently of the switch', () => {
    const ctx = context(), m = new ChecklistSession(R22_TRAINING, 'r22', 1);
    m.select('afterStart'); ctx.controls.rotorClutch = true;
    ctx.state.rotorcraft!.clutchEngagement = 0.6; ctx.state.rotorcraft!.clutchLight = true;
    m.update(ctx); expect(m.mark('clutchReady')).toEqual({ done: false, mode: 'auto', overridden: false });
    ctx.state.rotorcraft!.clutchEngagement = 1;
    m.update(ctx); expect(m.mark('clutchReady').done).toBe(false);
    ctx.state.rotorcraft!.clutchLight = false;
    m.update(ctx); expect(m.mark('clutchReady').done).toBe(true);
    ctx.controls.rotorClutch = false;
    m.update(ctx); expect(m.mark('clutchReady').done).toBe(false);
  });
  it('checks both tachometers and permits a manual untick until reset', () => {
    const ctx = context(), m = new ChecklistSession(R22_TRAINING, 'r22', 1);
    m.select('runup'); const d = ctx.aircraft.rotorcraft!;
    ctx.state.engine.rpm = d.referenceRpm * d.engineRatio * 1.03;
    ctx.state.rotorcraft!.rotorRpm = d.referenceRpm * 0.96;
    m.update(ctx); expect(m.mark('flightRpm').done).toBe(false);
    ctx.state.rotorcraft!.rotorRpm = d.referenceRpm * 1.03;
    m.update(ctx); expect(m.mark('flightRpm').done).toBe(true);
    m.toggle('flightRpm'); m.update(ctx);
    expect(m.mark('flightRpm')).toEqual({ done: false, mode: 'manual', overridden: true });
    m.select('beforeStart'); m.select('runup'); m.update(ctx);
    expect(m.mark('flightRpm').done).toBe(false);
    m.reset(); m.update(ctx); expect(m.mark('flightRpm').done).toBe(true);
    expect(m.mark('doors').mode).toBe('manual');
    m.toggle('doors'); m.update(ctx); expect(m.mark('doors').done).toBe(true);
    m.reset(); expect(m.mark('doors').done).toBe(false);
  });
  it('requires each twin engine control, not just the shared input scalar', () => {
    const ctx = context(PA34_DEFINITION), m = new ChecklistSession(PA34, 'pa34', 2);
    m.select('forcedLandingSecurity'); ctx.controls.mixture = 0;
    setEngineControl(ctx.controls, 1, 'mixture', 1);
    m.update(ctx); expect(m.mark('mixtureCutoff').done).toBe(false);
    setEngineControl(ctx.controls, 1, 'mixture', 0);
    m.update(ctx); expect(m.mark('mixtureCutoff').done).toBe(true);
  });
  it('does not certify a tank choice, magneto sequence or combined climb-power check', () => {
    for (const id of ['fuelSelector', 'mags']) {
      const section = PA38.checklists.engineFailure;
      expect(livePredicate(section.items.find(i => i.id === id)!, section, PA38)).toBeNull();
    }
    const section = PA34.checklists.afterTakeoff;
    expect(livePredicate(section.items.find(i => i.id === 'climbPower')!, section, PA34)).toBeNull();
  });
  it('navigates sections without losing marks and highlights the next unchecked item', () => {
    const m = new ChecklistSession(R22_TRAINING, 'r22', 1);
    const first = m.section!.items[0].id;
    expect(m.currentItem).toBe(first); m.toggle(first); expect(m.currentItem).not.toBe(first);
    m.move(1); m.move(-1); expect(m.mark(first).done).toBe(true);
    m.select('engineFailure', 'flare'); expect(m.tab).toBe('emergency'); expect(m.currentItem).toBe('flare');
    m.changeTab('normal'); expect(m.currentItem).not.toBe('flare');
  });
  it('every scripted phase has a real checklist section and item', () => {
    for (const id of R22_DEMOS) for (const phase of Object.keys(PHASE_ACTIONS)) {
      const link = demoChecklistLink(id, phase, 0)!;
      expect(link, `${id}/${phase}`).not.toBeNull();
      expect(R22_TRAINING.checklists[link.section]?.items.some(i => i.id === link.item), `${id}/${phase}`).toBe(true);
      expect(link.next.length).toBeGreaterThan(0);
    }
  });
});

describe('checklist follows the flight', () => {
  const ids = checklistSections(C152, 'c152').map(s => s.id);
  const at = (ctx: SimContext, memory: ReturnType<typeof newPhaseMemory>) => resolvePhase(phaseSection(ctx, memory), ids);
  it('walks the C152 lists from parked to shutdown', () => {
    const ctx = context(C152_DEFINITION), s = ctx.state, c = ctx.controls, memory = newPhaseMemory();
    const ground = (gs: number, rpm: number, running = true) => {
      s.onGround = true; s.altitudeAGL = 0; s.verticalSpeed = 0; s.groundSpeed = gs * KT;
      s.engine.running = running; s.engine.rpm = rpm; s.engines = [s.engine];
    };
    const air = (agl: number, vs: number) => { s.onGround = false; s.altitudeAGL = agl * FT; s.verticalSpeed = vs * FPM; s.groundSpeed = 80 * KT; };
    ground(0, 0, false); c.masterBattery = false; expect(at(ctx, memory)).toBe('beforeStart');
    c.masterBattery = true; expect(at(ctx, memory)).toBe('engineStart');
    ground(0, 900); expect(at(ctx, memory)).toBe('afterStart');
    ground(8, 1000); expect(at(ctx, memory)).toBe('afterStart'); // the C152 has no taxi list
    ground(0, 1700); expect(at(ctx, memory)).toBe('beforeTakeoff'); // the run-up done
    ground(5, 1000); expect(at(ctx, memory)).toBe('beforeTakeoff');
    ground(45, 2300); expect(at(ctx, memory)).toBe('beforeTakeoff'); // no take-off list: the nearest one before it
    air(300, 700); expect(at(ctx, memory)).toBe('afterTakeoff');
    air(2000, 700); expect(at(ctx, memory)).toBe('climb');
    air(4000, 0); expect(at(ctx, memory)).toBe('cruise');
    air(3000, -500); expect(at(ctx, memory)).toBe('descent');
    air(1000, 0); c.flaps = 0.33; expect(at(ctx, memory)).toBe('downwind');
    air(400, -500); expect(at(ctx, memory)).toBe('final');
    ground(40, 1000); expect(at(ctx, memory)).toBe('final'); // the landing roll: no landing list
    ground(8, 1000); expect(at(ctx, memory)).toBe('afterLanding');
    ground(0, 0, false); expect(at(ctx, memory)).toBe('shutdown');
  });
  it('repeats the departure lists round the circuit: touch-and-go, full stop, taxi back, second departure', () => {
    const ctx = context(C152_DEFINITION), s = ctx.state, c = ctx.controls, memory = newPhaseMemory(), seen: string[] = [];
    const ground = (gs: number, rpm: number, throttle: number) => {
      s.onGround = true; s.altitudeAGL = 0; s.verticalSpeed = 0; s.groundSpeed = gs * KT;
      s.engine.running = true; s.engine.rpm = rpm; s.engines = [s.engine]; c.throttle = throttle;
    };
    const air = (agl: number, vs: number) => { s.onGround = false; s.altitudeAGL = agl * FT; s.verticalSpeed = vs * FPM; s.groundSpeed = 70 * KT; };
    const log = () => { const id = at(ctx, memory)!; if (seen[seen.length - 1] !== id) seen.push(id); };
    c.masterBattery = true; c.flaps = 0;
    ground(0, 900, 0.1); log(); ground(0, 1700, 0.5); log(); ground(50, 2300, 1); log();
    air(300, 700); log(); air(1000, 0); log(); c.flaps = 0.33; air(400, -500); log();
    ground(45, 2300, 1); log(); c.flaps = 0; air(300, 700); log(); air(1000, 0); c.flaps = 0.33; log(); air(400, -500); log();
    ground(40, 1000, 0.1); log(); ground(8, 1000, 0.1); log(); ground(0, 900, 0.1); log();
    ground(0, 1700, 0.5); log(); ground(50, 2300, 1); log(); c.flaps = 0; air(300, 700); log();
    expect(seen).toEqual(['afterStart', 'beforeTakeoff', 'afterTakeoff', 'downwind', 'final', 'beforeTakeoff', 'afterTakeoff',
      'downwind', 'final', 'afterLanding', 'beforeTakeoff', 'afterTakeoff']);
  });
  it('turns to the engine failure lists when the engine stops in the air', () => {
    const ctx = context(C152_DEFINITION), s = ctx.state, memory = newPhaseMemory();
    s.onGround = false; s.altitudeAGL = 3000 * FT; s.verticalSpeed = -600 * FPM; s.engine.running = false; s.engines = [s.engine];
    expect(at(ctx, memory)).toBe('engineFailure');
    s.altitudeAGL = 300 * FT; expect(at(ctx, memory)).toBe('powerFailure');
  });
  it('Shift+F steps through the normal lists, then the emergency lists, and round again', () => {
    const m = new ChecklistSession(C152, 'c152', 1), seen: string[] = [m.sectionId];
    for (let i = 0; i < m.sections.length; i++) { m.step(); seen.push(m.sectionId); }
    expect(seen[seen.length - 1]).toBe(seen[0]);
    expect(new Set(seen.slice(0, -1)).size).toBe(m.sections.length);
    const firstEmergency = seen.findIndex(id => m.sections.find(s => s.id === id)?.category === 'emergency');
    expect(seen.slice(firstEmergency, -1).every(id => m.sections.find(s => s.id === id)?.category === 'emergency')).toBe(true);
    expect(m.tab).toBe('normal');
  });
});

describe('checklist panel', () => {
  afterAll(() => vi.unstubAllGlobals());
  it('keeps a list a lesson or demonstration opened when the phase changes, and follows again after F', () => {
    installFakeDom();
    let now = 0; vi.stubGlobal('performance', { now: () => now });
    const ctx = { ...context(C152_DEFINITION), presentation: C152_PRESENTATION } as SimContext, s = ctx.state;
    s.onGround = true; s.groundSpeed = 0; s.engine.running = false; s.engines = [s.engine]; ctx.controls.masterBattery = false;
    const panel = new ChecklistPanel(new FakeElement('div') as unknown as HTMLElement);
    panel.init(ctx);
    const section = () => (panel as unknown as { model: ChecklistSession }).model.sectionId;
    const tick = (ms: number) => { for (let t = 0; t < ms; t += 100) { now += 100; panel.update(ctx, false); } };
    tick(2500); panel.open('engineFailure', 'mags'); expect(section()).toBe('engineFailure');
    ctx.controls.masterBattery = true; tick(3000); expect(section()).toBe('engineFailure');
    panel.toggle(); panel.toggle(); expect(section()).toBe('engineStart');
    ctx.controls.masterBattery = false; tick(3000); expect(section()).toBe('beforeStart');
  });
});

describe('muted flight guidance', () => {
  it('mute disables speech as well as simulator sound', () => {
    expect(parseParams('?mute=1&voice=1').school.voice).toBe(false);
    expect(parseParams('?voice=0').school.voice).toBe(false);
    expect(parseParams('').school.voice).toBe(true);
  });
  it('warning captions follow physics flags with no audio dependency', () => {
    const s = makeMockState(); s.stallWarning = true; s.gear.warning = true;
    expect(audibleWarnings(s)).toEqual(['STALL WARNING · Reduce angle of attack', 'GEAR WARNING · Check gear down and locked']);
    s.rotorcraft = emptyRotorcraftState(); s.rotorcraft.lowRpmHorn = true;
    expect(audibleWarnings(s)[0]).toContain('LOW ROTOR RPM');
    expect(audibleWarnings(s).some(t => t.includes('STALL'))).toBe(false);
    s.rotorcraft.lowRpmHorn = false; s.rotorcraft.lowRpmLight = true;
    expect(audibleWarnings(s)[0]).toContain('warning light');
    s.rotorcraft.lowRpmLight = false; s.gear.warning = false;
    expect(audibleWarnings(s)).toEqual([]);
  });
});
