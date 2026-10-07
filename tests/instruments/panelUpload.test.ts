import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Latch } from '../../src/instruments/render/component';
import { DirtyRectUploader } from '../../src/instruments/render/dirtyUpload';

describe('Latch.track (analogue pointers)', () => {
  it('ignores noise that straddles a rounding boundary', () => {
    const l = new Latch(1);
    l.track(0, 0.0015, 0.002);
    l.take();
    let redraws = 0;
    // set() would flip between 0.002 and 0 every frame for this +/-0.0001 ripple around 0.001.
    for (let i = 0; i < 100; i++) {
      l.track(0, 0.001 + (i % 2 ? 1e-4 : -1e-4), 0.002);
      if (l.take()) redraws++;
    }
    expect(redraws).toBe(0);
    const s = new Latch(1);
    let setRedraws = 0;
    for (let i = 0; i < 100; i++) {
      s.set(0, 0.001 + (i % 2 ? 1e-4 : -1e-4), 0.002);
      if (s.take()) setRedraws++;
    }
    expect(setRedraws).toBeGreaterThan(90);
  });

  it('follows a moving value within one quantum and latches the exact value', () => {
    const l = new Latch(1);
    let redraws = 0;
    for (let i = 0; i <= 1000; i++) {
      const v = i * 1e-4;
      const shown = l.track(0, v, 0.002);
      expect(Math.abs(shown - v)).toBeLessThan(0.002);
      if (l.take()) redraws++;
    }
    expect(Math.abs(l.get(0) - 0.1)).toBeLessThan(0.002);
    expect(redraws).toBeGreaterThanOrEqual(50);
    expect(redraws).toBeLessThanOrEqual(52);
  });
});

describe('DirtyRectUploader', () => {
  const makeTexture = (): THREE.Texture => {
    const t = new THREE.Texture({ width: 2080, height: 800 } as unknown as HTMLCanvasElement);
    return t;
  };

  it('falls back to a full three.js upload until the texture exists on the GPU', () => {
    const t = makeTexture();
    const u = new DirtyRectUploader(t as THREE.CanvasTexture);
    const v0 = t.version;
    u.flush(null);
    expect(t.version).toBe(v0); // nothing marked: nothing to do
    u.add({ x: 10, y: 10, w: 100, h: 100 });
    expect(u.pending).toBe(1);
    u.flush(null);
    expect(t.version).toBe(v0 + 1);
    expect(u.pending).toBe(0);
    expect(u.fullUploads).toBe(1);
    // A renderer that has not uploaded the texture yet (no GL texture): still a full upload.
    const renderer = { properties: { get: () => ({}) } } as unknown as THREE.WebGLRenderer;
    u.add({ x: 0, y: 0, w: 5, h: 5 });
    u.flush(renderer);
    expect(t.version).toBe(v0 + 2);
  });
});
