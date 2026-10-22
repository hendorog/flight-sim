import { describe, expect, it } from 'vitest';
import { C172S_PANEL } from '../../src/aircraft/c172s/panel';
import { C152_PANEL } from '../../src/aircraft/c152/panel';
import { PA38_PANEL } from '../../src/aircraft/pa38/panel';
import { DA20_PANEL } from '../../src/aircraft/da20/panel';
import { PA34_PANEL } from '../../src/aircraft/pa34/panel';
import DA42 from '../../src/aircraft/da42/presentation';
import { R22_PANEL } from '../../src/aircraft/r22/panel';
import { R44_PANEL } from '../../src/aircraft/r44/panel';
import { S269_PANEL } from '../../src/aircraft/s269/panel';
import { PC12_PANEL } from '../../src/aircraft/pc12/panel';
import { MD500_PANEL } from '../../src/aircraft/md500/panel';
import { BO105_PANEL } from '../../src/aircraft/bo105/panel';
import { AH56_PANEL } from '../../src/aircraft/ah56/panel';
import { buildHotspots, hotspotAt } from '../../src/instruments/hotspots';
import { fitPanel, fixedSections, fixedPanelClient, fixedPanelPoint, nextPanelSection, isFixedPanel } from '../../src/instruments/fixedPanel';
import { gaugeParts } from '../../src/instruments/panelParts';
import { loadPanelView, savePanelView, PANEL_VIEW_PREF_KEY, type KeyValueStore } from '../../src/sim/resume';
import { actionForKey } from '../../src/input/bindings';
import { makeInputRig } from '../input/testbed';
import { C172S_INPUT } from '../../src/aircraft/c172s/input';

const panels = { c172s: C172S_PANEL, c152: C152_PANEL, pa38: PA38_PANEL, da20: DA20_PANEL,
  pa34: PA34_PANEL, da42: DA42.panel, pc12: PC12_PANEL, r22: R22_PANEL, r44: R44_PANEL, s269: S269_PANEL, md500: MD500_PANEL,
  bo105: BO105_PANEL, ah56: AH56_PANEL };
for (const [id, def] of Object.entries(panels)) describe(`${id} fixed panel`, () => {
  const sections = fixedSections(def), spots = buildHotspots(def);
  it.each([[1366, 768], [1920, 1080], [800, 600], [600, 900], [2400, 700]])('every hotspot operates in both directions at %ix%i', (width, height) => {
    for (const spot of spots) {
      // Both halves matter: clockwise/counterclockwise knobs and up/down lever selection.
      for (const [x, y] of [[spot.x, spot.y], [spot.x - spot.hw / 2, spot.y - spot.hh / 2], [spot.x + spot.hw / 2, spot.y + spot.hh / 2]]) {
        const section = Object.values(sections).find(s => s.panes.some(p => x >= p.source.x && y >= p.source.y && x <= p.source.x + p.source.w && y <= p.source.y + p.source.h));
        expect(section, spot.id).toBeDefined();
        const fit = fitPanel(section!, width, height);
        const client = fixedPanelClient(section!, fit, x, y)!;
        expect(client[0]).toBeGreaterThanOrEqual(0); expect(client[0]).toBeLessThanOrEqual(width);
        expect(client[1]).toBeGreaterThan(0); expect(client[1]).toBeLessThanOrEqual(height);
        const p = fixedPanelPoint(section!, fit, ...client)!;
        expect(p[0]).toBeCloseTo(x, 8); expect(p[1]).toBeCloseTo(y, 8);
        expect(hotspotAt(...p, spots)?.id, spot.id).toBe(spot.id);
      }
    }
  });
  it('shows every gauge and warning without cropping it and leaves the outside view clear', () => {
    const all = [...sections.upper.panes, ...sections.lower.panes];
    const lamps = def.annunciator ? def.annunciator.cells ?? [def.annunciator.bounds] : [];
    for (const rect of [...def.gauges.flatMap(g => gaugeParts(g, def.apertures, def.instrumentScale).map(p => p.rect)), ...lamps]) {
      expect(all.some(p => p.source.x <= rect.x && p.source.y <= rect.y && p.source.x + p.source.w >= rect.x + rect.w && p.source.y + p.source.h >= rect.y + rect.h)).toBe(true);
    }
    for (const section of Object.values(sections)) {
      const compass = section.compass!;
      expect(compass).toBeDefined();
      expect(compass.x + compass.w).toBeLessThanOrEqual(section.size.w);
      expect(compass.y + compass.h).toBeLessThanOrEqual(section.size.h);
      for (const p of section.panes) expect(compass.x >= p.target.x + p.target.w ||
        compass.x + compass.w <= p.target.x || compass.y >= p.target.y + p.target.h ||
        compass.y + compass.h <= p.target.y, 'compass must not cover a gauge or control').toBe(true);
      const fit = fitPanel(section, 1366, 768);
      expect(fit.top - 32).toBeGreaterThanOrEqual(768 * 0.52 - 0.001);
      expect(fixedPanelPoint(section, fit, 683, 100)).toBeNull();
      for (const [i, a] of section.panes.entries()) for (const b of section.panes.slice(i + 1)) {
        expect(a.target.x >= b.target.x + b.target.w || b.target.x >= a.target.x + a.target.w || a.target.y >= b.target.y + b.target.h || b.target.y >= a.target.y + a.target.h).toBe(true);
      }
    }
    // Primary instrument bezels remain at least 120 CSS px at the smaller requested laptop size.
    const fit = fitPanel(sections.upper, 1366, 768);
    expect(172 * (def.instrumentScale?.large ?? 1) * fit.scale).toBeGreaterThanOrEqual(120);
  });
});

it('269 puts the concentric tach, flight/engine instruments and warnings above, console controls below', () => {
  const sections = fixedSections(S269_PANEL);
  for (const gauge of S269_PANEL.gauges) {
    const upper = ['asi', 'vsi', 'altimeter', 'tach', 'map', 'fuelCht', 'oil', 'amps', 'cat'].includes(gauge.id);
    for (const { rect } of gaugeParts(gauge, S269_PANEL.apertures, S269_PANEL.instrumentScale)) {
      expect(sections[upper ? 'upper' : 'lower'].panes.some(p => p.source.x <= rect.x && p.source.y <= rect.y &&
        p.source.x + p.source.w >= rect.x + rect.w && p.source.y + p.source.h >= rect.y + rect.h), gauge.id).toBe(true);
    }
  }
  for (const spot of buildHotspots(S269_PANEL)) {
    const section = spot.id === 'kollsman' || spot.id.endsWith('Test') && spot.id !== 'lampTest' ? sections.upper : sections.lower;
    expect(fixedPanelClient(section, fitPanel(section, 1366, 768), spot.x, spot.y), spot.id).not.toBeNull();
  }
});

describe('sections and preference', () => {
  it('cycles Upper, Lower, hidden, Upper and enters fixed from 3D', () => {
    expect((['3d', 'upper', 'lower', 'hidden'] as const).map(nextPanelSection)).toEqual(['upper', 'lower', 'hidden', 'upper']);
    expect(isFixedPanel({ cameraMode: 'chase', panelView: 'upper' })).toBe(false);
    expect(isFixedPanel({ cameraMode: 'cockpit' })).toBe(false);
    expect(isFixedPanel({ cameraMode: 'cockpit', panelView: 'hidden' })).toBe(true);
  });
  it('routes real keys while paused and returns to the previous section without changing aircraft controls', () => {
    expect(actionForKey('KeyV', false)).toBe('viewRecentre');
    expect(actionForKey('KeyV', true)).toBe('panelToggle');
    expect(actionForKey('BracketRight', false)).toBe('panelSection');
    expect(actionForKey('BracketRight', true)).toBeNull(); // shell owns simulation rate
    const r = makeInputRig(C172S_INPUT); r.ctx.paused = true;
    r.ctx.commands.setPanelView = view => { r.ctx.panelView = view; r.ctx.cameraMode = 'cockpit'; };
    r.tap('KeyV', true); expect(r.ctx.panelView).toBe('upper');
    r.tap('BracketRight'); expect(r.ctx.panelView).toBe('lower');
    r.tap('KeyV', true); expect(r.ctx.panelView).toBe('3d');
    r.tap('KeyV', true); expect(r.ctx.panelView).toBe('lower');
    r.tap('BracketRight'); expect(r.ctx.panelView).toBe('hidden');
    r.tap('BracketRight'); expect(r.ctx.panelView).toBe('upper');
    expect(r.c.masterBattery).toBe(true);
  });
  it('round-trips all choices with the existing preference store and survives inaccessible storage', () => {
    const data = new Map<string, string>();
    const store: KeyValueStore = { getItem: k => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); }, removeItem: k => { data.delete(k); } };
    expect(loadPanelView(store)).toBe('3d');
    for (const v of ['3d', 'upper', 'lower', 'hidden'] as const) { savePanelView(store, v); expect(loadPanelView(store)).toBe(v); }
    data.set(PANEL_VIEW_PREF_KEY, 'broken'); expect(loadPanelView(store)).toBe('3d');
    const denied: KeyValueStore = { getItem() { throw Error('denied'); }, setItem() { throw Error('quota'); }, removeItem() {} };
    expect(loadPanelView(denied)).toBe('3d'); expect(() => savePanelView(denied, 'upper')).not.toThrow();
    expect(loadPanelView(null)).toBe('3d'); expect(() => savePanelView(null, 'lower')).not.toThrow();
  });
});
