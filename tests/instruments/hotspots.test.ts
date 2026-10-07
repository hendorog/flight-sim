import { describe, expect, it } from 'vitest';
import { defaultControls, defaultWeather } from '../../src/core/types';
import { makeMockState } from '../../src/core/mockState';
import { hotspotAt, hotspotValue, PANEL_HOTSPOTS, pressHotspot, toggleHotspot, turnHotspot } from '../../src/instruments/hotspots';
import { InstrumentSet } from '../../src/instruments/dynamics/instrumentSet';
import { PANEL_HEIGHT, PANEL_LAYOUT, PANEL_WIDTH } from '../../src/instruments/panel';

describe('panel hotspots', () => {
  it('lie on the panel, do not overlap, and are found at their centres', () => {
    for (const h of PANEL_HOTSPOTS) {
      expect(h.x - h.hw).toBeGreaterThanOrEqual(0);
      expect(h.x + h.hw).toBeLessThanOrEqual(PANEL_WIDTH);
      expect(h.y + h.hh).toBeLessThanOrEqual(PANEL_HEIGHT);
      expect(hotspotAt(h.x, h.y)?.id).toBe(h.id);
    }
    expect(hotspotAt(5, 5)).toBeNull();
  });

  it('stay clear of the 3D yoke column boots', () => {
    const Y = PANEL_LAYOUT.yokes;
    for (const h of PANEL_HOTSPOTS)
      for (const x of Y.xs) expect(Math.hypot(h.x - x, h.y - Y.y)).toBeGreaterThan(Y.r);
  });

  it('switches toggle the matching controls', () => {
    const c = defaultControls();
    c.masterBattery = false;
    toggleHotspot('battery', c);
    expect(c.masterBattery).toBe(true);
    toggleHotspot('landing', c);
    expect(c.lights.landing).toBe(true);
    toggleHotspot('avionics', c);
    expect(c.avionics).toBe(false);
    expect(hotspotValue('avionics', c)).toBe('OFF');
  });

  it('knobs step in instrument detents and wrap / clamp', () => {
    const c = defaultControls();
    c.kollsmanHpa = 1013.25;
    turnHotspot('kollsman', 1, c);
    expect(c.kollsmanHpa / 33.8639).toBeCloseTo(29.93, 3);
    for (let i = 0; i < 1000; i++) turnHotspot('kollsman', 1, c);
    expect(c.kollsmanHpa / 33.8639).toBeCloseTo(31, 3);
    c.headingBugDeg = 359;
    turnHotspot('headingBug', 1, c);
    expect(c.headingBugDeg).toBe(0);
    c.obsDeg = 0;
    turnHotspot('obs', -1, c, 5);
    expect(c.obsDeg).toBe(355);
    c.magnetos = 3;
    turnHotspot('magnetos', 1, c);
    expect(c.magnetos).toBe(3);
    turnHotspot('magnetos', -1, c);
    expect(c.magnetos).toBe(2);
    pressHotspot('dgAlign', true, c);
    expect(c.dgAlign).toBe(true);
    pressHotspot('dgAlign', false, c);
    expect(c.dgAlign).toBe(false);
  });

  it('the altimeter reads the Kollsman knob, not the weather QNH', () => {
    const set = new InstrumentSet();
    const s = makeMockState();
    const w = defaultWeather();
    const c = defaultControls();
    c.kollsmanHpa = 1013.25 + 33.8639; // +1 inHg
    for (let i = 0; i < 50; i++) set.step(0.02, s, c, w);
    expect(set.readings.kollsmanInHg).toBeCloseTo(30.92, 2);
    set.followQnh = true;
    set.step(0.02, s, c, w);
    expect(set.readings.kollsmanInHg).toBeCloseTo(29.92, 2);
  });
});
