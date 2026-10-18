// The post-TAA overlay slot (PostPipeline.addOverlay, renderOverlays): order, target alternation, size propagation
// and disposal, with a fake renderer (no WebGL).

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { SceneEffect, SimContext } from '../../src/core/context';
import { PostPipeline, renderOverlays } from '../../src/render/post/PostPipeline';

interface Call {
  name: string;
  input: THREE.Texture;
  output: THREE.WebGLRenderTarget;
}

function fakeOverlay(name: string, calls: Call[]): SceneEffect & { sizes: [number, number][]; disposed: number } {
  return {
    name,
    sizes: [],
    disposed: 0,
    setSize(w, h) {
      this.sizes.push([w, h]);
    },
    render(_r, input, _depth, output) {
      calls.push({ name, input, output });
    },
    dispose() {
      this.disposed++;
    },
  };
}

function fakeRenderer(width = 320, height = 200): THREE.WebGLRenderer {
  const r = {
    getDrawingBufferSize: (v: THREE.Vector2) => v.set(width, height),
    setRenderTarget: () => undefined,
    getRenderTarget: () => null,
    render: () => undefined,
    clear: () => undefined,
  };
  return r as unknown as THREE.WebGLRenderer;
}

const ctx = {} as unknown as SimContext;
const depth = new THREE.DepthTexture(4, 4);

describe('renderOverlays', () => {
  const targets = [new THREE.WebGLRenderTarget(4, 4), new THREE.WebGLRenderTarget(4, 4)];
  const r = fakeRenderer();

  it('returns the input unchanged with no overlays', () => {
    const src = new THREE.Texture();
    expect(renderOverlays([], r, src, depth, targets, ctx, 0.016)).toBe(src);
  });

  it('runs overlays in order, each reading the previous output, alternating targets', () => {
    const calls: Call[] = [];
    const overlays = ['a', 'b', 'c'].map((n) => fakeOverlay(n, calls));
    const src = new THREE.Texture();
    const out = renderOverlays(overlays, r, src, depth, targets, ctx, 0.016);
    expect(calls.map((c) => c.name)).toEqual(['a', 'b', 'c']);
    expect(calls[0].input).toBe(src);
    expect(calls[0].output).toBe(targets[0]);
    expect(calls[1].input).toBe(targets[0].texture);
    expect(calls[1].output).toBe(targets[1]);
    expect(calls[2].input).toBe(targets[1].texture);
    expect(calls[2].output).toBe(targets[0]);
    expect(out).toBe(targets[0].texture);
  });

  it('never writes the target its input belongs to', () => {
    for (const k of [0, 1]) {
      const calls: Call[] = [];
      renderOverlays([fakeOverlay('a', calls), fakeOverlay('b', calls)], r, targets[k].texture, depth, targets, ctx, 0);
      for (const c of calls) expect(c.output.texture).not.toBe(c.input);
      expect(calls[0].output).toBe(targets[1 - k]);
    }
  });
});

describe('PostPipeline.addOverlay', () => {
  it('sizes an overlay when added and on resize, and disposes it with the pipeline', () => {
    const post = new PostPipeline(fakeRenderer(320, 200), new THREE.Scene(), new THREE.PerspectiveCamera());
    const o = fakeOverlay('o', []);
    post.addOverlay(o);
    expect(o.sizes).toEqual([[320, 200]]);
    post.setSize(640, 360);
    expect(o.sizes).toEqual([
      [320, 200],
      [640, 360],
    ]);
    post.dispose();
    expect(o.disposed).toBe(1);
  });

  it('cabinFromView without a cabin box is the depth slab nearer than 1.3 m', () => {
    const post = new PostPipeline(fakeRenderer(), new THREE.Scene(), new THREE.PerspectiveCamera());
    const m = new THREE.Matrix4();
    expect(post.cabinFromView({} as unknown as SimContext, m)).toBe(m);
    const inside = (z: number) => Math.abs(new THREE.Vector3(5, -3, z).applyMatrix4(m).z) < 1;
    expect(inside(-1.0)).toBe(true);
    expect(inside(-1.5)).toBe(false);
    post.dispose();
  });
});

