// Fixes from the wave-3 playtest of the school UI (src/ui/school): the debrief trace's settled start and
// heading axis, and the key hints on checklist items. DOM-free.

import { describe, expect, it } from 'vitest';
import { C172S } from '../../src/training/aircraft/c172s';
import { checklistItemKeys } from '../../src/ui/school/checklistKeys';
import { angleTicks, headingTick, settledStart } from '../../src/ui/school/format';

describe('trace start', () => {
  it('skips a first sample taken before the reposition landed', () => {
    // The recorder's first sample on the apron (394 ft, 0 kt), then the lesson start at 3,500 ft and 100 kt.
    expect(settledStart({ altFt: [394, 3500, 3502, 3501], asiKt: [0, 100, 100, 101] })).toBe(1);
    // Two stale samples.
    expect(settledStart({ altFt: [0, 0, 1400, 1398, 1395], asiKt: [0, 0, 75, 75, 74] })).toBe(2);
  });

  it('keeps a trace that starts settled, and never looks past the first few samples', () => {
    expect(settledStart({ altFt: [3500, 3502, 3501], asiKt: [100, 100, 101] })).toBe(0);
    // A real 400 ft drop much later is flight data, not a start artefact.
    const alt = [3500, 3500, 3500, 3500, 3500, 3500, 3500, 3500, 3100];
    expect(settledStart({ altFt: alt, asiKt: alt.map(() => 100) })).toBe(0);
    expect(settledStart({})).toBe(0);
  });
});

describe('heading axis', () => {
  it('ticks on compass steps', () => {
    expect(angleTicks(50, 300, 3)).toEqual([90, 180, 270]);
    expect(angleTicks(190, 230, 3)).toEqual([195, 210, 225]);
    expect(angleTicks(-150, 250, 3)).toEqual([0, 180]);
    // More than a turn (a taxi that circled): 180 steps, so neighbouring labels differ (never "000°" twice).
    const wide = angleTicks(160, 900, 3);
    expect(wide).toEqual([180, 360, 540, 720, 900]);
    for (let i = 1; i < wide.length; i++) expect(headingTick(wide[i])).not.toBe(headingTick(wide[i - 1]));
  });

  it('labels unwrapped values as three-digit headings that read upward (000 below 090)', () => {
    expect(headingTick(0)).toBe('000°');
    expect(headingTick(90)).toBe('090°');
    expect(headingTick(-90)).toBe('270°');
    expect(headingTick(450)).toBe('090°');
  });
});

describe('checklist key hints', () => {
  it('names the key of each control a checklist item sets', () => {
    // The control's key, and Enter for an item that is already set (its key would flip it the wrong way).
    expect(checklistItemKeys('master')).toEqual([['W'], ['Enter']]);
    expect(checklistItemKeys('mixture')).toEqual([['Shift', 'M'], ['Enter']]);
    expect(checklistItemKeys('beacon')).toEqual([['Shift', 'O'], ['Enter']]);
    expect(checklistItemKeys('propArea')).toEqual([['Enter']]);
  });

  it('has a key for every C172S item verified from the controls (only gauges are answered with Enter)', () => {
    // Items whose check reads an instrument rather than a control the student sets with one key.
    const gauges = new Set(['oilPressure', 'suction', 'height']);
    for (const list of Object.values(C172S.checklists)) {
      for (const item of list.items) {
        if (!item.check || item.lookout || gauges.has(item.id)) continue;
        expect(checklistItemKeys(item.id), `${list.id}.${item.id}`).not.toEqual([['Enter']]);
      }
    }
  });
});
