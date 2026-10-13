// The World chooser's pure side (Deep Time WP3): its rows, the address a choice reloads into, the confirmation,
// the menu gates (no School tab or tower camera in the Cretaceous), the loading and spawn text.

import { describe, expect, it } from 'vitest';
import { makeMockState } from '../../src/core/mockState';
import { aircraftChoiceUrl } from '../../src/ui/chooser';
import {
  ERA_LOADING_LINES,
  eraChoiceUrl,
  eraConfirmation,
  eraDefaultScenario,
  eraGates,
  eraLoadingTitle,
  eraRows,
  spawnWindAdvice,
} from '../../src/ui/eraChooser';
import { ERAS } from '../../src/world/era/registry';

describe('rows', () => {
  it('lists the present day and the Cretaceous with the flown one marked', () => {
    const rows = eraRows('cretaceous');
    expect(rows.map((r) => r.id)).toEqual(['present', 'cretaceous']);
    expect(rows.map((r) => r.current)).toEqual([false, true]);
    expect(rows[1].label).toBe('Late Cretaceous Laramidia');
    expect(rows[1].epoch).toBe('~67 Ma');
    expect(rows[1].blurb.length).toBeGreaterThan(20);
    expect(rows[0].epoch).toBe('');
  });
});

describe('addresses', () => {
  it('the era survives an aircraft switch', () => {
    const url = 'https://fs.local/index.html?era=cretaceous&aircraft=c152&scenario=final&cam=chase';
    expect(new URL(aircraftChoiceUrl(url)).searchParams.get('era')).toBe('cretaceous');
    expect(aircraftChoiceUrl(url)).toBe('https://fs.local/index.html?era=cretaceous&cam=chase');
  });

  it('a world switch drops what would undo it, keeps the aircraft, and names no scenario', () => {
    const url = 'https://fs.local/index.html?era=present&aircraft=c208&scenario=runway&resume=1&cam=chase#x';
    expect(eraChoiceUrl(url)).toBe('https://fs.local/index.html?aircraft=c208&cam=chase#x');
  });

  it('the Cretaceous starts the safari', () => {
    expect(eraDefaultScenario('cretaceous')).toBe('safari');
    expect(eraDefaultScenario('present')).toBeUndefined();
  });
});

describe('confirmation', () => {
  const rows = eraRows('present');
  const present = rows[0];
  const parked = makeMockState({ heightAGL: 0, tas: 0 });
  const flying = makeMockState({ heightAGL: 500, tas: 50 });

  it('asks only when moving or airborne, and says it reloads the world', () => {
    expect(eraConfirmation(parked, false, present, rows[1])).toBeNull();
    const ask = eraConfirmation(flying, false, present, rows[1]);
    expect(ask?.kind).toBe('flight');
    expect(ask?.text).toContain('Reloads the world');
    expect(ask?.text).toContain(present.label);
  });

  it('a lesson is abandoned first', () => {
    expect(eraConfirmation(parked, true, present, rows[1])?.kind).toBe('lesson');
  });
});

describe('gates', () => {
  it('hide the School tab and the tower camera in the Cretaceous only', () => {
    expect(eraGates(ERAS.present)).toEqual({ school: true, towerCamera: true });
    expect(eraGates(ERAS.cretaceous)).toEqual({ school: false, towerCamera: false });
    expect(eraGates(undefined)).toEqual({ school: true, towerCamera: true });
  });
});

describe('loading and spawn text', () => {
  it('names the era and rotates its lines; the present day keeps the usual screen', () => {
    expect(eraLoadingTitle(ERAS.present, 'Cessna 172S')).toBeNull();
    expect(eraLoadingTitle(ERAS.cretaceous, 'Cessna 172S')).toEqual({ title: 'Late Cretaceous Laramidia', tag: '~67 Ma · Cessna 172S' });
    expect(ERA_LOADING_LINES.cretaceous.length).toBeGreaterThanOrEqual(3);
    expect(ERA_LOADING_LINES.present).toEqual([]);
  });

  it('suggests the end into the wind, naming the volcano for 250', () => {
    expect(spawnWindAdvice(250, 8)).toBe('Wind 250/8 - take off heading 250 toward the volcano');
    expect(spawnWindAdvice(60, 10)).toBe('Wind 060/10 - take off heading 070');
    expect(spawnWindAdvice(100, 6)).toBe('Wind 100/6 - take off heading 070');
    expect(spawnWindAdvice(180, 1)).toContain('calm');
  });
});
