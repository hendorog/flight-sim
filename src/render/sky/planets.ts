// Naked-eye planets (package P3 of the night-sky plan owns this file and glsl/planets.ts).
//
// Interface (frozen by the scaffold; see the plan): `uniforms` is spread into the sky dome's uniforms; update()
// runs once per frame from SkyDome.update, after the Celestial has moved.

import type * as THREE from 'three';
import type { SimContext } from '../../core/context';
import type { Celestial } from './celestial';

export class PlanetModel {
  readonly uniforms: Record<string, THREE.IUniform> = {};

  update(_ctx: SimContext, _celestial: Celestial): void {}
}
