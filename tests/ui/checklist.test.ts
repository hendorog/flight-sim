import { describe, expect, it } from 'vitest';
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
import { ChecklistSession, checklistSections, livePredicate } from '../../src/ui/checklistModel';
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
