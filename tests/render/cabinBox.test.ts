import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { C172S_VISUAL } from '../../src/aircraft/c172s/visual';
import { C208_VISUAL } from '../../src/aircraft/c208/visual';
import { frd } from '../../src/render/aircraft/geometry';
import { cabinFromModel } from '../../src/render/post/PostPipeline';

/** As the tone map's outside mask: a surface point (aircraft model space) inside the cabin box. */
function inCabin(m: THREE.Matrix4, x: number, y: number, z: number): boolean {
  const b = frd(x, y, z).applyMatrix4(m);
  return Math.abs(b.x) < 1 && Math.abs(b.y) < 1 && Math.abs(b.z) < 1;
}

describe('tone map cabin box', () => {
  it('holds the whole C172 cabin, the rear seats and bulkhead included, and nothing outside it', () => {
    const m = cabinFromModel(C172S_VISUAL.cockpit.box);
    const [ex, ey, ez] = C172S_VISUAL.cockpit.pilotEye;
    expect(inCabin(m, ex, ey, ez)).toBe(true);
    // Rear seat back and the baggage bulkhead, ~1.5-2.5 m behind the eye: beyond the old 1.3 m depth cutoff.
    expect(inCabin(m, -1.4, -0.3, 0)).toBe(true);
    expect(inCabin(m, -2.05, 0, 0)).toBe(true);
    // Door lining, floor and headliner.
    expect(inCabin(m, 0, -0.52, 0)).toBe(true);
    expect(inCabin(m, 0, 0, 0.56)).toBe(true);
    expect(inCabin(m, 0, 0, -0.6)).toBe(true);
    // Outside: the cowling ahead of the windscreen, the wing strut and the wing's lower surface out past the door.
    expect(inCabin(m, 1.6, 0, -0.2)).toBe(false);
    expect(inCabin(m, 0, -1.2, 0)).toBe(false);
    expect(inCabin(m, 0, -2.5, -0.8)).toBe(false);
    expect(inCabin(m, -3.5, 0, 0)).toBe(false);
  });

  it('follows each type: the Caravan’s cabin reaches far past the C172’s', () => {
    const c208 = C208_VISUAL.cockpit.box;
    const m = cabinFromModel(c208);
    expect(c208.rear).toBeLessThan(C172S_VISUAL.cockpit.box.rear);
    expect(inCabin(m, c208.rear + 0.2, 0, 0)).toBe(true);
    expect(inCabin(m, c208.rear - 0.3, 0, 0)).toBe(false);
  });
});
