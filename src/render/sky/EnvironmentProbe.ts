// scene.environment: a PMREM of the current sky (with ground below the horizon) so PBR materials get
// sky ambient and reflections. A refresh is spread over seven frames - one cube face per frame, then the
// PMREM filtering - into a back buffer that is swapped in when complete, so there is never a hitch.

import * as THREE from 'three';

export class EnvironmentProbe {
  private readonly scene = new THREE.Scene();
  private readonly cubeTarget: THREE.WebGLCubeRenderTarget;
  private readonly cubeCamera: THREE.CubeCamera;
  private readonly pmrem: THREE.PMREMGenerator;
  private front: THREE.WebGLRenderTarget | null = null;
  private back: THREE.WebGLRenderTarget | null = null;
  /** Next cube face to render, 6 = filter and swap, -1 = idle. */
  private step = -1;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    skyMesh: THREE.Mesh,
    size: number,
  ) {
    this.scene.add(skyMesh);
    this.cubeTarget = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: false, depthBuffer: false });
    this.cubeCamera = new THREE.CubeCamera(0.1, 10, this.cubeTarget);
    this.cubeCamera.coordinateSystem = renderer.coordinateSystem;
    this.cubeCamera.updateCoordinateSystem();
    this.cubeCamera.updateMatrixWorld(true);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.pmrem.compileCubemapShader();
  }

  /** The current environment texture (null until the first refresh completes). */
  get texture(): THREE.Texture | null {
    return this.front?.texture ?? null;
  }

  get busy(): boolean {
    return this.step >= 0;
  }

  /** Start a refresh if none is running. */
  requestRefresh(): void {
    if (this.step < 0) this.step = 0;
  }

  /** Do one frame's share of a pending refresh. Returns true when a new texture was swapped in. */
  advance(): boolean {
    if (this.step < 0) return false;
    if (this.step < 6) {
      this.renderFace(this.step++);
      return false;
    }
    this.finish();
    return true;
  }

  /** Complete a refresh immediately (start-up). */
  refreshNow(): void {
    for (let f = 0; f < 6; f++) this.renderFace(f);
    this.finish();
  }

  private renderFace(face: number): void {
    const prev = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.cubeTarget, face);
    this.renderer.render(this.scene, this.cubeCamera.children[face] as THREE.PerspectiveCamera);
    this.renderer.setRenderTarget(prev);
  }

  private finish(): void {
    const result = this.pmrem.fromCubemap(this.cubeTarget.texture, this.back);
    this.back = this.front;
    this.front = result;
    this.step = -1;
  }

  dispose(): void {
    this.cubeTarget.dispose();
    this.front?.dispose();
    this.back?.dispose();
    this.pmrem.dispose();
  }
}
