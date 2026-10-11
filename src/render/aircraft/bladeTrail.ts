import * as THREE from 'three';
import { gridGeometry } from './geometry';
import type { BladeBlurState } from './bladeBlur';

export interface BladeTrailSection {
  radius: number;
  chord: number;
  pitch: number;
  front: THREE.Color;
  back: THREE.Color;
}

/** One analytic, lit annulus, with no temporal samples or rotating copies. Each fragment
 * integrates the projected blade chord against a cubic shutter CDF. Its derivative
 * (3(1-t)^2) fades to zero at the trailing end, removing sector edges and sample bands.
 * The integral conserves angular coverage; wider trails become fainter. Real geometry
 * supplies the opaque blade while pursuit is possible. At full speed this mesh is hidden.
 */
export class BladeTrail {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.MeshStandardMaterial;
  private readonly uniforms = {
    trailSweep: { value: 0 },
    trailPitch: { value: 0 },
    trailCone: { value: 0 },
    trailDirection: { value: 1 },
    trailGap: { value: Math.PI },
  };

  /** y: rotor, blade along +X, positive spin about +Y.
   * z: propeller, blade along +Y, positive spin about -Z (the model's forward axis). */
  constructor(sections: readonly BladeTrailSection[], axis: 'y' | 'z', blades: number, direction: number) {
    this.uniforms.trailDirection.value = direction;
    this.uniforms.trailGap.value = 2 * Math.PI / blades;
    const cols = 97;
    const g = gridGeometry({ rows: sections.length, cols, wrap: true,
      position(i, j, out) {
        const r = sections[i].radius, a = j / (cols - 1) * 2 * Math.PI;
        if (axis === 'y') out.set(r * Math.cos(a), 0, -r * Math.sin(a));
        else out.set(r * Math.sin(a), r * Math.cos(a), 0);
      },
    });
    for (const [name, size] of [['trailSection', 2], ['trailFront', 3], ['trailBack', 3]] as const) {
      const values = new Float32Array(sections.length * cols * size);
      sections.forEach((s, i) => {
        for (let j = 0; j < cols; j++) {
          const offset = (i * cols + j) * size;
          if (name === 'trailSection') values.set([s.chord, s.pitch], offset);
          else (name === 'trailFront' ? s.front : s.back).toArray(values, offset);
        }
      });
      g.setAttribute(name, new THREE.BufferAttribute(values, size));
    }
    this.material = new THREE.MeshStandardMaterial({ name: 'bladeTrail', transparent: true,
      depthWrite: false, side: THREE.DoubleSide, roughness: 0.6, opacity: 0 });
    // A single pass is sufficient for a two-sided sheet, and prevents double alpha accumulation.
    this.material.forceSinglePass = true;
    this.material.customProgramCacheKey = () => `bladeTrail-${axis}`;
    this.material.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, this.uniforms);
      const varyings = `
        varying vec2 vTrailPlane;
        varying float vTrailChord;
        varying vec3 vTrailFront;
        varying vec3 vTrailBack;`;
      shader.vertexShader = `
        attribute vec2 trailSection;
        attribute vec3 trailFront;
        attribute vec3 trailBack;
        uniform float trailPitch;
        uniform float trailCone;
        ${varyings}
      ` + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
        #include <begin_vertex>
        vTrailPlane = ${axis === 'y' ? 'vec2(position.x, -position.z)' : 'vec2(position.y, position.x)'};
        float beta = trailSection.y + trailPitch;
        vTrailChord = trailSection.x * (abs(cos(beta)) + 0.12 * abs(sin(beta)));
        vTrailFront = trailFront;
        vTrailBack = trailBack;
        ${axis === 'y' ? 'transformed.y = length(vTrailPlane) * sin(trailCone);' : ''}
      `);
      shader.fragmentShader = `
        ${varyings}
        uniform float trailSweep;
        uniform float trailDirection;
        uniform float trailGap;
        float shutterCDF(float t) {
          float remaining = 1.0 - clamp(t, 0.0, 1.0);
          return 1.0 - remaining * remaining * remaining;
        }
        float coverage(float angle, float width, float sweep) {
          return shutterCDF((angle + width * 0.5) / sweep)
               - shutterCDF((angle - width * 0.5) / sweep);
        }
      ` + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
        #include <color_fragment>
        float radius = max(length(vTrailPlane), 0.001);
        float angle = mod(-trailDirection * atan(vTrailPlane.y, vTrailPlane.x), trailGap);
        float width = min(vTrailChord / radius, trailGap * 0.45);
        float sweep = max(trailSweep, 0.00001);
        float alpha = coverage(angle, width, sweep) + coverage(angle - trailGap, width, sweep);
        diffuseColor.rgb *= gl_FrontFacing ? vTrailFront : vTrailBack;
        diffuseColor.a *= alpha;
        if (diffuseColor.a == 0.0) discard;
      `);
    };
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.name = 'bladeTrail';
    this.mesh.frustumCulled = false; // Vertex shader applies coning.
    this.mesh.visible = false;
  }

  update(state: BladeBlurState, pitch = 0, cone = 0): void {
    this.uniforms.trailSweep.value = state.sweep;
    this.uniforms.trailPitch.value = pitch;
    this.uniforms.trailCone.value = cone;
    this.material.opacity = state.trail;
    this.mesh.visible = state.trail > 0;
  }

  /** The aircraft's scene traversal owns geometry disposal. */
  dispose(): void { this.material.dispose(); }
}

/** Fade shadow coverage with the real blade instead of dropping its shadow at the blur threshold. */
export function bladeShadowMaterial(): THREE.MeshDepthMaterial {
  return new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, alphaHash: true });
}
