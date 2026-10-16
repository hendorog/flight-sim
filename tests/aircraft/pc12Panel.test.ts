import { describe, expect, it } from 'vitest';
import { PC12_PANEL, PC12_INSTRUMENT_SYSTEMS } from '../../src/aircraft/pc12/panel';
import { PC12_PANEL_PX_RECT } from '../../src/aircraft/pc12/panelLayout';
import { buildHotspots } from '../../src/instruments/hotspots';
import { panelLayoutProblems } from '../../src/instruments/panelLayout';

describe('PC-12 panel layout', () => {
  it('has no layout problems', () => {
    expect(panelLayoutProblems(PC12_PANEL, PC12_PANEL_PX_RECT, buildHotspots(PC12_PANEL))).toEqual([]);
    expect(PC12_INSTRUMENT_SYSTEMS.engines).toBe(1);
  });
});
