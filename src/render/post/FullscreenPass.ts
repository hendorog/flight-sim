// A single full-screen triangle for image passes. The vertex shader passes vUv in [0,1]; fragment
// shaders are written in GLSL ES 3.0 with three's compatibility macros (texture2D, gl_FragColor).

import * as THREE from 'three';

export const FULLSCREEN_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const geometry = new THREE.BufferGeometry();
geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

/** Shader material preset for full-screen passes: no depth, no blending unless asked. */
export function passMaterial(params: {
  fragmentShader: string;
  uniforms: Record<string, THREE.IUniform>;
  defines?: Record<string, string | number>;
  blending?: THREE.Blending;
}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: FULLSCREEN_VERT,
    fragmentShader: params.fragmentShader,
    uniforms: params.uniforms,
    defines: params.defines ?? {},
    depthTest: false,
    depthWrite: false,
    blending: params.blending ?? THREE.NoBlending,
    toneMapped: false,
  });
}

export class FullscreenPass {
  private readonly mesh: THREE.Mesh;

  constructor() {
    this.mesh = new THREE.Mesh(geometry);
    this.mesh.frustumCulled = false;
  }

  /** Draw `material` over the whole of `target` (null = canvas), or into one layer of a 3D target. */
  render(renderer: THREE.WebGLRenderer, material: THREE.Material, target: THREE.WebGLRenderTarget | null, layer = 0): void {
    this.mesh.material = material;
    // A full-screen draw covers every pixel, and additive passes must keep the target's contents.
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(target, layer);
    renderer.render(this.mesh, camera);
    renderer.autoClear = autoClear;
  }
}
