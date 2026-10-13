// AirportSystem bare mode (Deep Time, the Flats): no airport exists, so nothing is built and updating is free.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { SimContext } from '../../src/core/context';
import { AirportSystem } from '../../src/world/airport/AirportSystem';

describe('AirportSystem bare', () => {
  it('builds no lights and no meshes beyond the root, and updates without touching anything', () => {
    const scene = new THREE.Scene();
    const sys = new AirportSystem({ heightAt: () => 0, bare: true });
    // init() must not even ask the renderer for anything: only the scene is given.
    const ctx = { scene } as unknown as SimContext;
    sys.init(ctx);
    expect(scene.children).toEqual([sys.root]);
    // The root and its (empty) airport-local frame: no mesh, points, light or any other object.
    const objects: THREE.Object3D[] = [];
    sys.root.traverse((o) => objects.push(o));
    expect(objects).toEqual([sys.root, sys.local]);
    expect(sys.local.children).toHaveLength(0);
    expect(sys.lights).toHaveLength(0);
    // update() and the helpers are inert (ctx has no sky, renderer or weather).
    sys.update(0.016, ctx);
    expect(sys.artificialIlluminance(new THREE.Vector3(0, 100, 0))).toBe(0);
    sys.setLightIntensity(2);
    sys.dispose();
    expect(scene.children).toHaveLength(0);
  });
});
