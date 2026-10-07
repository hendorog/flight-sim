// Decision D5 in TrainingSystem: lessons are flown in the C172S only. Starting or resuming a lesson while
// another type is flown is refused with the offer to change aircraft; a resume block of another type than the
// one flown is discarded; the offer calls commands.setAircraft('c172s', { open: 'school' }). The shell is a
// fake through TrainingShell.aircraftId (C2 implements it in Simulator) and the school UI a recorder (no DOM).

import { describe, expect, it, vi } from 'vitest';
import type { SimContext } from '../../src/core/context';
import type { AircraftId } from '../../src/core/types';
import type { SchoolParams } from '../../src/sim/params';
import { TrainingSystem, type TrainingShell } from '../../src/training/TrainingSystem';
import type { TrainingResumeBlock } from '../../src/training/types';
import type { SchoolCareer } from '../../src/ui/school/models';
import type { SchoolUi } from '../../src/ui/school/schoolUi';

/** Thrown by the fake school's close(): the lesson start got past the guard. */
class Proceeded extends Error {}

function rig(flown?: AircraftId) {
  const params: SchoolParams = {
    open: null, lesson: null, phase: null, brief: true, voice: false, standard: null, memoryStore: true, unlock: false, autoStudent: false,
  };
  const shell = { params, ...(flown ? { aircraftId: () => flown } : {}) } as unknown as TrainingShell;
  const ts = new TrainingSystem(shell);
  const calls = { toasts: [] as string[], opened: [] as string[], careers: [] as SchoolCareer[] };
  const school = {
    toast: (t: string) => calls.toasts.push(t),
    open: (s: string) => calls.opened.push(s),
    setCareer: (c: SchoolCareer) => calls.careers.push(c),
    close: () => {
      throw new Proceeded();
    },
  };
  ts.school = school as unknown as SchoolUi;
  const setAircraft = vi.fn();
  (ts as unknown as { ctx: Partial<SimContext> }).ctx = { commands: { setAircraft } as unknown as SimContext['commands'] };
  return { ts, calls, setAircraft };
}

const block = (aircraftId?: string): TrainingResumeBlock => ({ lessonId: 'L01', ...(aircraftId ? { aircraftId } : {}) }) as unknown as TrainingResumeBlock;

describe('Flight School type guard (D5)', () => {
  it('another type: start is refused, the home screen opens with the offer to change', async () => {
    const { ts, calls } = rig('c152');
    expect(ts.aircraftId).toBe('c152');
    await ts.start('L01');
    expect(ts.inLesson).toBe(false);
    expect(calls.toasts).toEqual(['Lessons are flown in the Cessna 172S']);
    expect(calls.opened).toEqual(['home']);
    expect(calls.careers.at(-1)?.aircraft).toEqual({
      flown: { id: 'c152', name: 'Cessna 152' }, supported: false, school: { id: 'c172s', name: 'Cessna 172S' },
    });
  });

  it('another type: resume is refused the same way', async () => {
    const { ts, calls } = rig('da42');
    await ts.resume(block());
    expect(ts.inLesson).toBe(false);
    expect(calls.toasts).toEqual(['Lessons are flown in the Cessna 172S']);
    expect(calls.opened).toEqual(['home']);
  });

  it('the offer reloads into the school in the C172S', () => {
    const { ts, setAircraft } = rig('pa34');
    ts.command({ kind: 'switchAircraft', aircraftId: 'c172s' });
    expect(setAircraft).toHaveBeenCalledWith('c172s', { open: 'school' });
  });

  it('the C172S (and a shell that does not say): the guard lets the lesson start', async () => {
    for (const flown of ['c172s', undefined] as const) {
      const { ts, calls } = rig(flown);
      expect(ts.aircraftId).toBe('c172s');
      await expect(ts.start('L01')).rejects.toBeInstanceOf(Proceeded);
      expect(calls.toasts).toEqual([]);
      expect(calls.careers.at(-1)?.aircraft?.supported).toBe(true);
    }
  });

  it('a resume block of another type than the one flown is discarded', async () => {
    const { ts, calls } = rig('c172s');
    await ts.resume(block('c152'));
    expect(ts.inLesson).toBe(false);
    expect(calls.toasts).toEqual([]);
    expect(calls.opened).toEqual([]);
  });
});
