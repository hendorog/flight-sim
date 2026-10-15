// Deep Time inc 2 (WP7): C / Shift+C cycle the cameras; an era with no airport tower (the Cretaceous Flats,
// EraWorld.towerCamera false) leaves the tower out of the cycle instead of offering a refused mode.
import { afterEach, describe, expect, it } from 'vitest';
import type { CameraMode } from '../../src/core/context';
import { setEra } from '../../src/world/era/eraState';
import { makeRig } from './keyboardPilot';

afterEach(() => void setEra('present'));

/** Press C (or Shift+C) `presses` times through the real InputSystem; the modes it asked for, in order. */
function cycle(presses: number, shift: boolean): CameraMode[] {
  const r = makeRig();
  const modes: CameraMode[] = [];
  r.ctx.cameraMode = 'cockpit';
  (r.ctx.commands as { setCameraMode: (m: CameraMode) => void }).setCameraMode = (m) => {
    modes.push(m);
    r.ctx.cameraMode = m;
  };
  for (let k = 0; k < presses; k++) {
    r.input.keyDown('KeyC', shift);
    r.input.update(1 / 60, r.ctx);
    r.input.keyUp('KeyC');
    r.input.update(1 / 60, r.ctx);
  }
  return modes;
}

describe('camera cycle', () => {
  it('in the Cretaceous, 5 presses of next never give the tower and return to the start', () => {
    setEra('cretaceous');
    const modes = cycle(5, false);
    expect(modes).toHaveLength(5);
    expect(modes).not.toContain('tower');
    expect(modes.slice(0, 4)).toEqual(['chase', 'orbit', 'flyby', 'cockpit']);
    expect(modes).toContain('cockpit');
  });

  it('in the Cretaceous, 5 presses of previous never give the tower and return to the start', () => {
    setEra('cretaceous');
    const modes = cycle(5, true);
    expect(modes).toHaveLength(5);
    expect(modes).not.toContain('tower');
    expect(modes.slice(0, 4)).toEqual(['flyby', 'orbit', 'chase', 'cockpit']);
  });

  it('in the present day the cycle includes the tower, both ways', () => {
    expect(cycle(5, false)).toEqual(['chase', 'orbit', 'flyby', 'tower', 'cockpit']);
    expect(cycle(5, true)).toEqual(['tower', 'flyby', 'orbit', 'chase', 'cockpit']);
  });
});
