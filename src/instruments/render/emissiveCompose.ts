// The panel's self-illumination map, composed on the GPU: the panel texture times the light mask (in sRGB,
// as a 2D canvas 'multiply' would), with the dimmer mask's alpha tagging the dimmed circuits and blacking out
// what is not lit at all. Done with canvases it read the GPU-backed panel canvas back into a CPU canvas for
// every redrawn instrument, a pipeline stall each time: 50-70 ms per cockpit frame in Chrome/ANGLE Vulkan.
// Here the panel texture is already on the GPU, the masks go up once (the dimmer again when it changes),
// and one full-panel pass (about 1.7 Mpx) runs on the frames where a lit instrument was redrawn.

import * as THREE from 'three';

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
uniform sampler2D tPanel;
uniform sampler2D tMask;
uniform sampler2D tDimmer;
uniform bool uDimmer;
varying vec2 vUv;
vec3 toSrgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}
vec3 toLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}
void main() {
  vec3 lit = toLinear(toSrgb(texture2D(tPanel, vUv).rgb) * toSrgb(texture2D(tMask, vUv).rgb));
  float a = uDimmer ? texture2D(tDimmer, vUv).a : 1.0;
  // Where the dimmer mask is empty nothing glows (a canvas 'destination-in' leaves no colour there).
  gl_FragColor = vec4(a > 0.0 ? lit : vec3(0.0), a);
}
`;

export class PanelLightComposer {
  /** The composed map (same UVs and orientation as the panel's CanvasTexture). */
  readonly texture: THREE.Texture;
  private readonly target: THREE.WebGLRenderTarget;
  private readonly maskTexture: THREE.CanvasTexture;
  private readonly dimmerTexture: THREE.CanvasTexture | null;
  private readonly material: THREE.ShaderMaterial;
  private readonly mesh: THREE.Mesh;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private dirty = true;

  constructor(panel: THREE.Texture, mask: HTMLCanvasElement, dimmer: HTMLCanvasElement | null, anisotropy: number) {
    this.target = new THREE.WebGLRenderTarget(mask.width, mask.height, {
      depthBuffer: false,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      colorSpace: THREE.SRGBColorSpace,
      anisotropy,
    });
    this.texture = this.target.texture;
    this.texture.name = 'instrumentPanelEmissive';
    this.maskTexture = new THREE.CanvasTexture(mask);
    this.maskTexture.colorSpace = THREE.SRGBColorSpace;
    this.maskTexture.generateMipmaps = false;
    this.maskTexture.minFilter = THREE.NearestFilter;
    this.maskTexture.magFilter = THREE.NearestFilter;
    this.dimmerTexture = dimmer ? new THREE.CanvasTexture(dimmer) : null;
    if (this.dimmerTexture) {
      this.dimmerTexture.generateMipmaps = false;
      this.dimmerTexture.minFilter = THREE.NearestFilter;
      this.dimmerTexture.magFilter = THREE.NearestFilter;
    }
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        tPanel: { value: panel },
        tMask: { value: this.maskTexture },
        tDimmer: { value: this.dimmerTexture },
        uDimmer: { value: !!this.dimmerTexture },
      },
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  /** A lit part of the panel was redrawn: compose again on the next render(). */
  markDirty(): void {
    this.dirty = true;
  }

  /** The dimmer mask canvas was repainted. */
  dimmerChanged(): void {
    if (this.dimmerTexture) this.dimmerTexture.needsUpdate = true;
    this.dirty = true;
  }

  /** Compose if anything changed (after the panel texture's own upload for this frame). */
  render(renderer: THREE.WebGLRenderer | null | undefined): void {
    if (!this.dirty || !renderer?.setRenderTarget) return;
    this.dirty = false;
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(previous);
  }

  dispose(): void {
    this.target.dispose();
    this.maskTexture.dispose();
    this.dimmerTexture?.dispose();
    this.material.dispose();
    this.mesh.geometry.dispose();
  }
}
