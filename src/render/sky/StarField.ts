// Catalogue stars and the Milky Way's data (package P2 of the night-sky plan owns this file, glsl/stars.ts and
// glsl/milkyWay.ts).
//
// Interface (frozen by the scaffold; see the plan):
//   uniforms   dome-side uniforms (e.g. the Milky Way texture), spread into the sky dome's uniforms.
//   object     added to the main scene by SkySystem right after the dome (e.g. a THREE.Points of catalogue stars
//              with renderOrder just above the dome's); never added to the environment map's scene.
//   build()    called once by SkyDome with the dome's merged uniforms, so a separate material can share the same
//              uniform objects (uMoonDir, uMoonAngularRadius, uStarGain, uNight, uPixelAngle, transmittance LUT...).
//   update()   once per frame from SkyDome.update, after the Celestial has moved.

import * as THREE from 'three';
import type { SimContext } from '../../core/context';
import type { Celestial } from './celestial';

export class StarField {
  readonly uniforms: Record<string, THREE.IUniform> = {};
  readonly object = new THREE.Group();

  constructor() {
    this.object.name = 'starField';
  }

  build(_shared: Record<string, THREE.IUniform>): void {}

  update(_ctx: SimContext, _celestial: Celestial, _pixelAngle: number): void {}

  dispose(): void {}
}
