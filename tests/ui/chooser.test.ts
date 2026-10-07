// The aircraft chooser: the address a choice reloads into (contract 2.5: aircraft, scenario, lesson, phase,
// brief and resume removed; school=1 added to open the Flight School), the rows it lists, and when it asks
// before leaving the current flight.

import { describe, expect, it } from 'vitest';
import { AIRCRAFT_CATALOGUE, aircraftSummary } from '../../src/aircraft/registry';
import type { AircraftSummary } from '../../src/aircraft/types';
import { makeMockState } from '../../src/core/mockState';
import { aircraftChoiceUrl, choiceConfirmation, chooserRows } from '../../src/ui/chooser';

describe('navigation URL', () => {
  it('drops the parameters that would undo the choice and keeps the rest', () => {
    const url = 'https://fs.local/index.html?aircraft=c152&scenario=final&lesson=L03&phase=2&brief=0&resume=1&cam=chase&mute=1#x';
    expect(aircraftChoiceUrl(url)).toBe('https://fs.local/index.html?cam=chase&mute=1#x');
  });

  it('adds school=1 when the Flight School is to open', () => {
    expect(aircraftChoiceUrl('https://fs.local/?aircraft=da20&lesson=L01', { open: 'school' })).toBe('https://fs.local/?school=1');
    expect(aircraftChoiceUrl('https://fs.local/?school=0&q=1', { open: 'school' })).toBe('https://fs.local/?school=1&q=1');
    expect(aircraftChoiceUrl('https://fs.local/')).toBe('https://fs.local/');
  });
});

describe('rows', () => {
  const all: AircraftSummary[] = AIRCRAFT_CATALOGUE.map((r) => ({ ...r, available: true }));

  it('lists nothing while the flown type is the only available one', () => {
    expect(chooserRows(AIRCRAFT_CATALOGUE.filter((r) => r.id === 'c172s' || !r.available), 'c172s')).toEqual([]);
  });

  it('lists the available types, the flown one first', () => {
    const rows = chooserRows(all, 'pa34');
    expect(rows.map((r) => r.id)).toEqual(['pa34', 'c172s', 'c152', 'pa38', 'da20', 'da42']);
    const some = all.map((r) => ({ ...r, available: r.id !== 'da42' }));
    expect(chooserRows(some, 'c172s').map((r) => r.id)).not.toContain('da42');
  });
});

describe('confirmation', () => {
  const c172s = aircraftSummary('c172s');
  const da20 = aircraftSummary('da20');

  it('asks nothing on the ground at rest', () => {
    expect(choiceConfirmation(makeMockState({ heightAGL: 0 }), false, c172s, da20)).toBeNull();
  });

  it('asks before leaving a flight that is airborne or moving', () => {
    const air = choiceConfirmation(makeMockState({ heightAGL: 300, tas: 50 }), false, c172s, da20);
    expect(air).toEqual({ kind: 'flight', text: `Leave this flight? It is saved and resumes when you return to the ${c172s.shortName}.` });
    const taxi = makeMockState({ heightAGL: 0 });
    taxi.groundSpeed = 3;
    expect(choiceConfirmation(taxi, false, c172s, da20)?.kind).toBe('flight');
  });

  it('asks to abandon a lesson, even at rest', () => {
    const ask = choiceConfirmation(makeMockState({ heightAGL: 0 }), true, c172s, da20);
    expect(ask?.kind).toBe('lesson');
    expect(ask?.text).toBe(`Abandon the lesson and fly the ${da20.shortName}? The flight so far is logged.`);
  });
});
